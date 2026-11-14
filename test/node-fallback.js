// node.fallback: "stop" keeps the bot from auto-picking a BitNode outside node.order (spec: docs/specs/node-fallback.md).
// "recommend" (default) must stay byte-identical to the behavior before the setting existed (fixtures/node-fallback-golden.json).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { importGame, fakeFsNs, GAME } from "./helpers/game-import.js";
import { defaults, coerce, SCHEMA, SETTINGS_FILE, emptyFile, applyPatch, serialize, parseFile, effective } from "../game/lib/settings-schema.js";
import { CASES, mkState, T0, SF_MIX, SF_ALL, ON } from "./helpers/node-fallback-cases.js";
import { computeKpis } from "../game/lib/kpi.js";
import { OWNER_DECISION } from "../server/checkin.js";
import { NOW, latest, ring, autopilot, ramStatus, augPlan, pred2Tail } from "./fixtures/dashboard-data.js";

const { decideNode, pickNextBn, ORDER_EXHAUSTED, orderExhaustedFlag } = await importGame("lib/nodectl.js");
const { READY_FLAG, recommendNextBn } = await importGame("lib/augplan.js");
const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/node-fallback-golden.json", import.meta.url), "utf8"));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const S = (o = {}) => ({ ...defaults(), ...o });
const STOP = { ...ON, "node.fallback": "stop" };
// live node.order from the incident: after BN2, BN3 x3 and BN11 x3 every entry is maxed
const LIVE_ORDER = [10, 2, 3, 11];
const EXH = { bn: 11, sourceFiles: SF_MIX };           // SF10/2/3/11 all at 3 -> node.order [10,2,3,11] has nothing left
const roundtrip = (o) => JSON.parse(JSON.stringify(o));

// ---------------- 1. recommend (default) is unchanged ----------------
test("schema: node.fallback defaults to recommend, enum recommend|stop, owned by the autopilot", () => {
  const f = SCHEMA.find((x) => x.key === "node.fallback");
  assert.ok(f);
  assert.equal(f.type, "enum"); assert.equal(f.default, "recommend"); assert.deepEqual(f.options, ["recommend", "stop"]);
  assert.equal(f.group, "node"); assert.equal(f.ui, "select"); assert.ok(f.label && f.help);
  assert.equal(defaults()["node.fallback"], "recommend");
});
test("golden: with the default (and with explicit recommend) pickNextBn / decideNode equal the pre-change outputs", () => {
  for (const c of CASES) {
    for (const extra of [{}, { "node.fallback": "recommend" }]) {
      const s = S({ ...c.s, ...extra }), st = mkState(c.st), g = golden[c.name];
      assert.ok(g, c.name);
      assert.deepEqual(roundtrip(pickNextBn(st, s)), g.pick, `${c.name}: pick`);
      const req = { id: "r1", action: "destroy", bn: st.bn, nextBn: 1, at: st.now - 1000 };
      for (const [got, want, label] of [[decideNode(st, s), g.decide, "decide"], [decideNode({ ...st, request: req }, s), g.decideOpen, "decide(open)"]]) {
        const a = roundtrip(got);
        assert.deepEqual(a, want, `${c.name}: ${label}`);
      }
      assert.ok(!("source" in decideNode(st, s).node), `${c.name}: the default node block has no source key`);
    }
  }
});
test("recommend + order exhausted still falls back to the recommendation and requests a destroy (today's behavior)", () => {
  const s = S({ ...ON, "node.order": LIVE_ORDER });
  const p = pickNextBn(EXH, s);
  assert.equal(p.source, "recommendation"); assert.equal(p.nextBn, 1 === recommendNextBn(EXH).bn ? 1 : recommendNextBn(EXH).bn);
  assert.equal(p.nextBn, 9); // BN1/4/2/5/10 are maxed in SF_MIX, so BN9 is first: the incident's outcome
  const d = decideNode(mkState(EXH), s);
  assert.equal(d.action, "request"); assert.equal(d.writeRequest.nextBn, 9);
});

// ---------------- 2. stop ----------------
test("stop: an available node.order entry is still picked from the order", () => {
  const s = S({ ...STOP, "node.order": [10, 2] });
  const p = pickNextBn({ bn: 5, sourceFiles: [{ n: 10, lvl: 3 }] }, s);
  assert.equal(p.nextBn, 2); assert.equal(p.source, "node.order");
  assert.equal(pickNextBn({ bn: 5, sourceFiles: [] }, s).nextBn, 10);
  const d = decideNode(mkState({ bn: 5, sourceFiles: [] }), s);
  assert.equal(d.action, "request"); assert.equal(d.writeRequest.nextBn, 10); assert.ok(!("source" in d.node));
  assert.ok(!d.attention.some((a) => a.includes(ORDER_EXHAUSTED)));
  // the current BN counts +1 on destroy: BN2 at SF2 2 -> 3 leaves it unavailable, at 1 -> 2 still allowed
  assert.equal(pickNextBn({ bn: 2, sourceFiles: [{ n: 2, lvl: 1 }] }, S({ ...STOP, "node.order": [2] })).nextBn, 2);
  assert.equal(pickNextBn({ bn: 2, sourceFiles: [{ n: 2, lvl: 2 }] }, S({ ...STOP, "node.order": [2] })).nextBn, null);
});
test("stop + order exhausted: nextBn null, source order-exhausted, recommendation still reported (incident scenario)", () => {
  const s = S({ ...STOP, "node.order": LIVE_ORDER });
  const p = pickNextBn(EXH, s);
  assert.equal(p.nextBn, null); assert.equal(p.source, "order-exhausted");
  assert.equal(p.recommended.bn, 9); assert.match(p.recommended.why, /BN9/);
  assert.deepEqual(p.recommended, recommendNextBn(EXH, s));
});
test("stop + order exhausted: decideNode flags once, never requests or destroys, READY stays", () => {
  const s = S({ ...STOP, "node.order": LIVE_ORDER }), st = mkState(EXH);
  const d = decideNode(st, s);
  assert.equal(d.action, "flag"); assert.equal(d.writeRequest, null); assert.equal(d.nextBn, null);
  assert.deepEqual(d.attention, [READY_FLAG, orderExhaustedFlag(d.node.recommended)]);
  assert.match(d.attention[1], /^node\.order exhausted/);
  assert.match(d.attention[1], /recommended BN9/); assert.match(d.attention[1], /hacknet/); // names the node and why
  assert.equal(d.node.source, "order-exhausted"); assert.equal(d.node.ready, true); assert.equal(d.node.recommended.bn, 9);
  assert.equal(d.node.pending.stage, "none"); assert.equal(d.node.pending.id, ""); assert.match(d.node.pending.detail, /node\.order exhausted/);
  // dedupe: later loops (and a later clock) give the identical flag, exactly one exhausted entry
  for (const now of [T0, T0 + 60_000, T0 + 3 * 3600_000]) {
    const again = decideNode({ ...st, now }, s);
    assert.deepEqual(again.attention, d.attention);
    assert.equal(again.attention.filter((a) => a.includes(ORDER_EXHAUSTED)).length, 1);
    assert.equal(again.action, "flag");
  }
  // other destroy knobs cannot turn it into a request
  for (const o of [{ "node.backupBeforeDestroy": false }, { "node.destroyDelayMin": 0 }]) {
    const x = decideNode(st, S({ ...STOP, "node.order": LIVE_ORDER, ...o }));
    assert.equal(x.action, "flag"); assert.equal(x.writeRequest, null);
  }
});
test("stop + empty node.order counts as exhausted (never picks outside the owner's list)", () => {
  const s = S({ ...STOP }), st = mkState({ bn: 5, sourceFiles: [{ n: 1, lvl: 1 }] });
  const p = pickNextBn(st, s);
  assert.equal(p.nextBn, null); assert.equal(p.source, "order-exhausted"); assert.equal(p.recommended.bn, 1);
  const d = decideNode(st, s);
  assert.equal(d.action, "flag"); assert.equal(d.writeRequest, null); assert.match(d.node.pending.detail, /node\.order is empty/);
  assert.match(d.attention[1], /recommended BN1/);
});
test("stop + order exhausted + an open request: the request is cancelled, nothing is destroyed", () => {
  const s = S({ ...STOP, "node.order": LIVE_ORDER });
  const req = { id: "destroy-bn11-to-9-1", action: "destroy", bn: 11, nextBn: 9, at: T0 - 1000 };
  const ack = { id: req.id, backupOk: true, at: T0 - 500 };
  const d = decideNode(mkState({ ...EXH, request: req, ack, now: T0 + 3600_000 }), s);
  assert.equal(d.action, "cancel"); assert.equal(d.writeRequest.action, "cancel"); assert.equal(d.writeRequest.id, req.id);
  assert.equal(d.nextBn, null); assert.deepEqual(d.attention, [READY_FLAG, orderExhaustedFlag(d.node.recommended)]);
  // a request left over from a previous BitNode is ignored: plain flag, no cancel churn
  const old = decideNode(mkState({ ...EXH, request: { ...req, bn: 4 } }), s);
  assert.equal(old.action, "flag"); assert.equal(old.writeRequest, null);
});
test("stop + order exhausted but not ready / autoDestroy off: nothing new (owner decides anyway)", () => {
  const s = S({ ...STOP, "node.order": LIVE_ORDER });
  const nr = decideNode(mkState({ ...EXH, ready: false }), s);
  assert.equal(nr.action, "none"); assert.deepEqual(nr.attention, []); assert.equal(nr.node.source, "order-exhausted"); // dashboard sees it early
  const off = decideNode(mkState(EXH), S({ "node.autoSelect": true, "node.fallback": "stop", "node.order": LIVE_ORDER }));
  assert.equal(off.action, "flag"); assert.deepEqual(off.attention, [READY_FLAG]); assert.equal(off.writeRequest, null);
});
test("stop + node.autoSelect false: identical to recommend (manual, nothing changes)", () => {
  for (const c of CASES.filter((x) => !x.s["node.autoSelect"])) {
    const st = mkState(c.st);
    const a = decideNode(st, S({ ...c.s, "node.fallback": "stop" })), b = decideNode(st, S({ ...c.s, "node.fallback": "recommend" }));
    assert.deepEqual(a, b, c.name);
    assert.equal(pickNextBn(st, S({ ...c.s, "node.fallback": "stop" })).source, "manual");
  }
});
test("stop with an unknown stored value behaves as recommend (only the exact string stop stops)", () => {
  for (const v of ["", "STOP", "halt", null, true, 1]) {
    const p = pickNextBn(EXH, S({ ...ON, "node.order": LIVE_ORDER, "node.fallback": v }));
    assert.equal(p.source, "recommendation", String(v)); assert.equal(p.nextBn, 9);
  }
});

// ---------------- 3. dead-end text ----------------
// SF_MAX(12) is Infinity, so with the real SF_MAX a recommendation always exists (BN12) and the dead end cannot be reached in the game.
// The text is still fixed, so exercise it against a copy of the real modules whose SF_MAX is 3 for every node.
async function maxedModule() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbnf-"));
  const ap = fs.readFileSync(path.join(GAME, "lib/augplan.js"), "utf8");
  assert.ok(ap.includes("export const SF_MAX = (n) => (n === 12 ? Infinity : 3);"), "SF_MAX line changed: update this test");
  fs.writeFileSync(path.join(dir, "augplan.js"), ap.replace("export const SF_MAX = (n) => (n === 12 ? Infinity : 3);", "export const SF_MAX = () => 3;"));
  fs.writeFileSync(path.join(dir, "nodectl.js"), fs.readFileSync(path.join(GAME, "lib/nodectl.js"), "utf8").replace('from "lib/augplan.js"', 'from "./augplan.js"'));
  return import(pathToFileURL(path.join(dir, "nodectl.js")).href);
}
test("every target met: the pending detail says so (recommend and stop), not autoSelect off", async () => {
  const M = await maxedModule();
  const st = mkState({ bn: 13, sourceFiles: SF_ALL.concat([{ n: 12, lvl: 3 }]) });
  for (const fb of ["recommend", "stop"]) {
    const d = M.decideNode(st, S({ ...ON, "node.fallback": fb, "node.order": [10] }));
    assert.equal(d.action, "flag", fb); assert.equal(d.writeRequest, null); assert.equal(d.nextBn, null);
    assert.match(d.node.pending.detail, /every BitNode target is met/, fb);
    assert.doesNotMatch(d.node.pending.detail, /autoSelect off/, fb);
    assert.equal(d.node.recommended.bn, null);
    assert.equal(d.node.source, "all-targets-met");
    // its own flag next to READY; in stop mode it replaces the (redundant) order-exhausted flag
    assert.deepEqual(d.attention, [READY_FLAG, M.ALL_MET_FLAG], fb);
    assert.doesNotMatch(d.attention.join("|"), /BNundefined|BN\?|BNnull|autoSelect/);
  }
  assert.match(M.orderExhaustedFlag(null), /every BitNode target is met/);
  // an open request in that state is cancelled with the same honest text
  const req = { id: "r1", action: "destroy", bn: 13, nextBn: 1, at: T0 - 1000 };
  const c = M.decideNode({ ...st, request: req }, S({ ...ON }));
  assert.equal(c.action, "cancel"); assert.match(c.node.pending.detail, /every BitNode target is met/); assert.deepEqual(c.attention, [READY_FLAG, M.ALL_MET_FLAG]);
  // autoSelect really off (and something left to select) keeps the autoSelect text, in the real and the patched module
  const open = mkState({ bn: 13, sourceFiles: [{ n: 1, lvl: 3 }] });
  assert.match(decideNode(open, S({ "node.autoDestroy": true, "node.order": [10], "node.autoSelect": false })).node.pending.detail, /autoSelect off/);
  assert.match(M.decideNode(open, S({ "node.autoDestroy": true })).node.pending.detail, /autoSelect off/);
});
test("real SF_MAX: with an explicit BN12 target stop + node.order [12] is not exhausted (BN12 has no game cap; default target is 0, see node-targets)", () => {
  const s = S({ ...STOP, "node.order": [12], "node.targets": { 12: 1000 } });
  for (const lvl of [0, 3, 40]) assert.equal(pickNextBn({ bn: 5, sourceFiles: [{ n: 12, lvl }] }, s).nextBn, 12);
});

// ---------------- 4. settings: validation + round trip ----------------
test("settings: invalid node.fallback values are rejected, valid ones accepted (never clamped)", () => {
  assert.deepEqual(coerce("node.fallback", "stop"), { ok: true, value: "stop" });
  assert.deepEqual(coerce("node.fallback", "recommend"), { ok: true, value: "recommend" });
  for (const bad of ["Stop", "halt", "", " stop", true, 1, null, undefined, ["stop"]]) {
    const r = coerce("node.fallback", bad);
    assert.equal(r.ok, false, String(bad)); assert.match(r.error, /^node\.fallback: expected one of recommend\|stop/);
  }
  const f = applyPatch(emptyFile(), { set: { "node.fallback": "nope" } }, { actor: "t", now: 1 });
  assert.equal(f.ok, false); assert.deepEqual(f.file?.values ?? {}, {});
});
test("settings: round trip (patch -> serialize -> parse -> effective), unset returns to default, bad stored value warns + defaults", () => {
  const r = applyPatch(emptyFile(), { set: { "node.fallback": "stop", "node.order": LIVE_ORDER } }, { actor: "cli", now: 5 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed.map((c) => [c.key, c.from, c.to]).find((c) => c[0] === "node.fallback"), ["node.fallback", "recommend", "stop"]);
  const back = parseFile(serialize(r.file));
  assert.deepEqual(back.warnings, []); assert.equal(back.values["node.fallback"], "stop");
  assert.equal(effective(back.values)["node.fallback"], "stop");
  const un = applyPatch(back, { unset: ["node.fallback"] }, { actor: "cli", now: 6 });
  assert.equal(un.ok, true); assert.equal(effective(un.file.values)["node.fallback"], "recommend"); assert.ok(!("node.fallback" in un.file.values));
  const corrupt = parseFile(JSON.stringify({ version: 1, rev: 1, updatedAt: 1, updatedBy: "x", values: { "node.fallback": "halt" } }));
  assert.ok(corrupt.warnings.some((w) => /node\.fallback/.test(w)));
  assert.equal(effective(corrupt.values)["node.fallback"], "recommend");
});
test("settings: in-game readSettings/writeSettings carry the key into decideNode", async () => {
  const { readSettings, writeSettings } = await importGame("lib/settings.js");
  const ns = fakeFsNs();
  assert.equal(readSettings(ns)["node.fallback"], "recommend");
  assert.equal(writeSettings(ns, { set: { "node.fallback": "stop", "node.autoSelect": true, "node.autoDestroy": true, "node.order": LIVE_ORDER } }, "cli").ok, true);
  const s = readSettings(ns);
  assert.equal(s["node.fallback"], "stop");
  assert.equal(decideNode(mkState(EXH), s).action, "flag");
  assert.equal(JSON.parse(ns.files[SETTINGS_FILE.replace(/^\//, "")]).values["node.fallback"], "stop");
  assert.equal(writeSettings(ns, { set: { "node.fallback": "later" } }).ok, false);
  assert.equal(readSettings(ns)["node.fallback"], "stop");
  assert.equal(writeSettings(ns, { unset: ["node.fallback"] }, "cli").ok, true);
  assert.equal(readSettings(ns)["node.fallback"], "recommend");
});

// ---------------- 5. consumers: server escalation + dashboard ----------------
test("server: the exhausted flag is an owner decision (held back like READY), the stuck-destroy flags still escalate", async () => {
  const flag = orderExhaustedFlag({ bn: 9, why: "BN9: hacknet servers (SF9 0 -> 1)" });
  assert.ok(OWNER_DECISION.some((re) => re.test(flag)));
  assert.ok(OWNER_DECISION.some((re) => re.test(READY_FLAG)));
  assert.ok(!OWNER_DECISION.some((re) => re.test("destroy blocked: no backup ack")));
  assert.ok(!OWNER_DECISION.some((re) => re.test("node.order is fine")));
});
test("dashboard KPI: destroy tile and attention show node.order exhausted; unchanged otherwise", () => {
  const input = (node, flags) => ({ latest, ring, ramStatus, augPlan: { ...augPlan, node }, autopilot: { ...autopilot, flags }, pred2Tail, settings: S(STOP), now: NOW });
  const flag = orderExhaustedFlag({ bn: 9, why: "BN9: hacknet servers" });
  const ex = computeKpis(input({ ...augPlan.node, autoSelect: true, autoDestroy: true, source: "order-exhausted" }, [READY_FLAG, flag]));
  assert.equal(ex.kpis.destroy.display, "READY · node.order exhausted"); assert.equal(ex.kpis.destroy.status, "warn");
  const fl = ex.attention.find((a) => a.text === flag);
  assert.ok(fl); assert.equal(fl.level, "warn"); assert.equal(fl.view, "node");
  const plain = computeKpis(input({ ...augPlan.node, autoDestroy: true }, [READY_FLAG]));
  assert.equal(plain.kpis.destroy.display, "READY · auto-destroy on"); assert.equal(plain.kpis.destroy.status, "good");
  const off = computeKpis({ ...input({ ...augPlan.node }, [READY_FLAG]), settings: S() });
  assert.equal(off.kpis.destroy.display, "READY · awaiting decision"); assert.equal(off.kpis.destroy.status, "warn");
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} node-fallback test(s) failed`); process.exit(1); }
console.log(`node-fallback: ${tests.length} passed`);
