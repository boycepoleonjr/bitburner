// Unit tests for the GitHub-side monitor (.github/scripts/monitor.js): which issues it wants open, and the sync plan.
import assert from "node:assert/strict";
import { attentionKey, desiredProblems, planSync, issueBody, STALE_MIN } from "../.github/scripts/monitor.js";

const report = (attention, extra = {}) => ({ ageMin: 10, stale: false, latest: { ok: true, t: "2026-10-07T00:00:00Z", report: "| r |", attention }, ...extra });
const issue = (number, key, title = "x") => ({ number, title, body: `<!-- bb-monitor:${key} -->\nbody` });
const keys = (d) => d.problems.map((p) => p.key);

// Same problem with different numbers keeps its issue.
assert.equal(attentionKey("5 augs buyable (top A, B)"), attentionKey("6 augs buyable (top A, B)"));
assert.notEqual(attentionKey("telemetry down"), attentionKey("save backup failed: x"));

// Down: only the unreachable incident, attention unknown (open attention issues stay open).
let d = desiredProblems({ up: false, healthError: "timeout", report: null });
assert.deepEqual(keys(d), ["incident-unreachable"]);
assert.equal(d.attentionKnown, false);

// Up without a token: nothing to report, nothing known.
d = desiredProblems({ up: true, report: null });
assert.deepEqual(d, { problems: [], attentionKnown: false, checked: ["incident-unreachable"] });

// Fresh report: one issue per attention item; owner-decision items labelled as such.
d = desiredProblems({ up: true, report: report(["telemetry down", "w0r1d_d43m0n READY — agent decides BitNode destruction"]) });
assert.equal(d.attentionKnown, true);
assert.deepEqual(d.problems.map((p) => p.kind), ["attention", "owner-decision"]);

// Items that differ only in numbers share one issue.
d = desiredProblems({ up: true, report: report(["5 augs buyable", "6 augs buyable"]) });
assert.equal(d.problems.length, 1);

// One failed check-in (fresh but !ok) or a stale flag: no incident, attention unknown.
d = desiredProblems({ up: true, report: { ageMin: 3, stale: true, latest: { ok: false, t: "t", error: "rpc down", attention: [] } } });
assert.deepEqual(d, { problems: [], attentionKnown: false, checked: ["incident-unreachable", "incident-stale"] });

// Check-in loop stopped: stalled incident.
d = desiredProblems({ up: true, report: report([], { ageMin: STALE_MIN + 1, stale: true }) });
assert.deepEqual(keys(d), ["incident-stale"]);
d = desiredProblems({ up: true, report: { ageMin: null, stale: true, latest: null } });
assert.deepEqual(keys(d), ["incident-stale"]);

// Sync: create new, retitle changed, close cleared; keep existing.
const tele = desiredProblems({ up: true, report: report(["telemetry down", "6 augs buyable"]) });
const [teleKey, augKey] = keys(tele);
let plan = planSync([issue(1, teleKey, "Attention: telemetry down"), issue(2, augKey, "Attention: 5 augs buyable"), issue(3, "incident-unreachable"), issue(4, attentionKey("gone"))], tele);
assert.deepEqual(plan.create, []);
assert.deepEqual(plan.retitle, [{ number: 2, title: "Attention: 6 augs buyable" }]);
assert.deepEqual(plan.close.map((c) => c.number).sort(), [3, 4]);

// Down: attention issues stay and so does "stalled" (not evaluated), so it doesn't flap.
plan = planSync([issue(1, teleKey), issue(5, "incident-stale")], desiredProblems({ up: false, report: null }));
assert.deepEqual(plan.create.map((p) => p.key), ["incident-unreachable"]);
assert.deepEqual(plan.close, []);

// Up but /api/report unavailable: "stalled" stays open; "unreachable" is evaluated and closes.
plan = planSync([issue(5, "incident-stale"), issue(6, "incident-unreachable")], desiredProblems({ up: true, report: null }));
assert.deepEqual(plan.close.map((c) => c.number), [6]);

// Fresh report: "stalled" is evaluated and closes.
plan = planSync([issue(5, "incident-stale")], desiredProblems({ up: true, report: report([]) }));
assert.deepEqual(plan.close.map((c) => c.number), [5]);

// Report text is redacted before it is posted to the public repo.
assert.doesNotMatch(issueBody({ key: "att-x", detail: "d", t: "now", report: "see https://x.example/a Bearer abc123 token=zzz" }), /x\.example|abc123|zzz/);

// Issues without the marker (opened by people) are never touched.
plan = planSync([{ number: 9, title: "t", body: "manual" }], desiredProblems({ up: true, report: report([]) }));
assert.deepEqual(plan, { create: [], retitle: [], close: [] });

// Body carries the marker so the next run finds the issue.
assert.match(issueBody(tele.problems[0]), new RegExp(`<!-- bb-monitor:${teleKey} -->`));

console.log("MONITOR OK");
