// lib/kpi.js: KPI math from fixtures, missing / partial / garbage inputs, provenance; server GET /api/dashboard.
import assert from "node:assert/strict";
import { computeKpis, slope, KPI_KEYS, STALE_MS } from "../game/lib/kpi.js";
import { defaults } from "../game/lib/settings-schema.js";
import { createDashboardApi, formatDashboard } from "../server/dashboard.js";
import { NOW, latest, ring, autopilot, ramStatus, augPlan, pred2Tail } from "./fixtures/dashboard-data.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const S = defaults();
const full = () => computeKpis({ latest, ring, ramStatus, augPlan, autopilot, pred2Tail, settings: S, now: NOW });

test("full fixture: every KPI has a value, display, status and non-empty sources + formula", () => {
  const r = full();
  for (const k of KPI_KEYS) {
    const x = r.kpis[k];
    assert.ok(x, k);
    assert.notEqual(x.value, null, `${k} value`);
    assert.ok(x.display && x.display !== "—", `${k} display`);
    assert.ok(["good", "warn", "bad", "none"].includes(x.status), `${k} status`);
    assert.ok(Array.isArray(x.sources) && x.sources.length && x.sources.every((s) => s.file && s.field), `${k} sources`);
    assert.ok(x.formula, `${k} formula`);
  }
  assert.equal(r.bn, 5);
});
test("money/s from script income; rep/s from the ring slope of the work faction", () => {
  const r = full();
  assert.equal(r.kpis.moneyPerSec.value, latest.income);
  assert.ok(Math.abs(r.kpis.repPerSec.value - 2400) < 1e-6, String(r.kpis.repPerSec.value));
  assert.match(r.kpis.repPerSec.formula, /The Black Hand/);
});
test("RAM util prefers ram-status ema5; falls back to telemetry net when ram-status is missing or stale", () => {
  assert.equal(full().kpis.ramUtil.value, 0.95);
  assert.equal(full().kpis.ramUtil.status, "good");
  const noRs = computeKpis({ latest, ring, settings: S, now: NOW });
  assert.ok(Math.abs(noRs.kpis.ramUtil.value - latest.net.used / latest.net.max) < 1e-12);
  assert.equal(noRs.kpis.ramUtil.status, "bad");
  assert.match(noRs.kpis.ramUtil.formula, /net\.used/);
  const stale = computeKpis({ latest, ramStatus: { ...ramStatus, t: NOW - STALE_MS - 1 }, settings: S, now: NOW });
  assert.match(stale.kpis.ramUtil.formula, /stale/);
  assert.equal(noRs.kpis.targets.value, null);
  assert.equal(full().kpis.targets.value, 2);
});
test("destroy: READY awaiting decision by default, auto-destroy shows good", () => {
  const r = full();
  assert.equal(r.kpis.destroy.value, 0);
  assert.match(r.kpis.destroy.display, /awaiting decision/);
  assert.equal(r.kpis.destroy.status, "warn");
  const auto = computeKpis({ latest, augPlan, autopilot, settings: { ...S, "node.autoDestroy": true }, now: NOW });
  assert.equal(auto.kpis.destroy.status, "good");
});
test("destroy: falls back to the autopilot READY flag without aug-plan; ETA from pred2 when not ready", () => {
  assert.equal(computeKpis({ latest, autopilot, settings: S, now: NOW }).kpis.destroy.value, 0);
  const notReady = { ...augPlan, worldDaemon: { req: 4800, hack: 4000, ready: false }, node: { ...augPlan.node, ready: false } };
  const r = computeKpis({ latest, augPlan: notReady, autopilot: { ...autopilot, flags: [] }, pred2Tail, settings: S, now: NOW });
  assert.equal(r.kpis.destroy.value, 90 * 60000);
  assert.match(r.kpis.destroy.formula, /pred2/);
  const unknown = computeKpis({ latest, augPlan: notReady, autopilot: { ...autopilot, flags: [] }, pred2Tail: [], settings: S, now: NOW });
  assert.match(unknown.kpis.destroy.display, /4000 \/ 4800/);
});
test("phase + next install from aug-plan; install falls back to autopilot buyable vs augs.installAt", () => {
  const r = full();
  assert.equal(r.kpis.phase.value, "late");
  assert.match(r.kpis.phase.display, /late · 100% · w 1\.00/);
  assert.match(r.kpis.nextInstall.display, /NeuroFlux batch/);
  const fb = computeKpis({ latest, autopilot: { ...autopilot, augs: { buyable: 6 } }, settings: S, now: NOW });
  assert.equal(fb.kpis.nextInstall.display, "6/6 buyable");
  assert.equal(fb.kpis.nextInstall.status, "warn");
});
test("attention: autopilot flags, stale telemetry, RAM reasons", () => {
  const r = computeKpis({ latest: { ...latest, t: NOW - STALE_MS - 1 }, ramStatus, autopilot, settings: S, now: NOW });
  const texts = r.attention.map((a) => a.text).join("\n");
  assert.match(texts, /w0r1d_d43m0n READY/);
  assert.match(texts, /telemetry is stale/);
  assert.match(texts, /RAM: surplus/);
  assert.equal(r.attention.find((a) => /READY/.test(a.text)).view, "node");
  assert.equal(r.kpis.money.status, "warn");
});
test("everything missing: never throws, all KPIs null/none, files marked missing", () => {
  for (const input of [{}, undefined, null, { latest: null, ring: null, ramStatus: "x", augPlan: 5, autopilot: [] }]) {
    const r = computeKpis(input);
    for (const k of KPI_KEYS) if (k !== "nextInstall") assert.equal(r.kpis[k].status, "none", `${k} with ${JSON.stringify(input)}`);
    assert.ok(Object.values(r.files).every((f) => f.missing || f.stale));
  }
});
test("garbage numbers never leak NaN/Infinity into values", () => {
  const bad = { ...latest, money: NaN, income: Infinity, lvl: { hacking: "x" }, net: { max: 0, used: 5 } };
  const r = computeKpis({ latest: bad, ring: [{ t: NaN }, null, { t: NOW, money: "a" }], ramStatus: { t: NOW, util: { ema5: NaN } }, settings: S, now: NOW });
  for (const k of KPI_KEYS) { const v = r.kpis[k].value; assert.ok(v === null || typeof v !== "number" || Number.isFinite(v), `${k}=${v}`); }
});
test("slope: restarts after a drop (install reset / spend) and needs 2 points", () => {
  const pts = [{ t: 0, v: 10 }, { t: 1000, v: 20 }, { t: 2000, v: 0 }, { t: 3000, v: 5 }, { t: 4000, v: 10 }];
  assert.equal(slope(pts, (r) => r.v, 1e9, 4000), 5);
  assert.equal(slope(pts.slice(0, 1), (r) => r.v, 1e9, 4000), null);
});

// ---------------- server ----------------
test("api: GET /api/dashboard computes the same KPIs from rpc reads and never reads telemetry.txt", async () => {
  const files = {
    "data/telemetry-latest.txt": JSON.stringify(latest), "data/telemetry-ring.txt": ring.map((r) => JSON.stringify(r)).join("\n"),
    "data/ram-status.txt": JSON.stringify(ramStatus), "data/aug-plan.txt": JSON.stringify(augPlan), "data/autopilot-status.txt": JSON.stringify(autopilot),
    "data/pred2.txt": pred2Tail.map((r) => JSON.stringify(r)).join("\n") + "\n{bad", "data/settings.txt": "",
  };
  const asked = [];
  const rpc = async (op, a) => { asked.push(a.file); return { ok: true, value: files[a.file] ?? "" }; };
  const r = await createDashboardApi({ rpc, nowMs: () => NOW }).get();
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.kpis, full().kpis);
  assert.ok(!asked.includes("data/telemetry.txt"));
  assert.equal(r.value.bytes["data/aug-plan.txt"], files["data/aug-plan.txt"].length);
  const txt = formatDashboard(r.value);
  assert.match(txt, /BitNode destroy\s+READY/);
  assert.match(txt, /Attention:/);
  await assert.rejects(createDashboardApi({ rpc: async () => ({ ok: false, error: "down" }) }).get(), (e) => e.status === 502);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} kpi test(s) failed`); process.exit(1); }
console.log(`kpi: ${tests.length} passed`);
