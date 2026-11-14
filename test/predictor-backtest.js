// scripts/predictor-backtest.js: scoring, censoring, bootstrap CI, folds and the end-to-end report on synthetic data.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BT = await import("../scripts/predictor-backtest.js");
const PC = await import("../game/lib/predcal.js");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function synthLog(n = 240, seed = 9) {
  let s = seed; const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const g = () => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
  const lines = [], t0 = 1.79e12;
  for (let i = 0; i < n; i++) {
    const made = t0 + i * 15 * 6e4, lastAug = t0 + Math.floor(i / 40) * 40 * 15 * 6e4, D = 60 * 6e4 * Math.exp(0.4 * g()), actual = D * Math.exp(0.25 * g());
    const preds = { s5: D * Math.exp(0.4 * g()), s15: D * Math.exp(0.1 * g()), s45: D * Math.exp(0.2 * g() + 0.1) };
    const eta = made + D, lo = made + D * 0.95, hi = made + D * 1.05; // a deliberately too-narrow "v2" band
    lines.push({ type: "p", id: `x${i}`, made, lastAug, spec: { kind: i % 3 ? "rep" : "money", target: 1000 + i }, T: 1000 + i, preds, bucket: PC.bucketOfPreds(preds), eta, lo, hi });
    if (i % 17 === 5) lines.push({ type: "r", id: `x${i}`, at: made + 3.6e6, void: "install" });
    else lines.push({ type: "r", id: `x${i}`, at: made + actual + 6e4, actual: made + actual, inBand: made + actual >= lo && made + actual <= hi });
  }
  return lines.map((o) => JSON.stringify(o)).join("\n") + "\n";
}

test("scoreOne: in band, early miss, late miss, interval score and pinball are correct", () => {
  const s = { actualMs: 100 }, p = { d: 100, lo: 50, hi: 200 };
  const a = BT.scoreOne(s, p);
  assert.equal(a.inBand, true); assert.equal(a.err, 0); assert.ok(Math.abs(a.is - Math.log(4)) < 1e-12); assert.ok(Math.abs(a.pit - 0.5) < 1e-9);
  const e = BT.scoreOne({ actualMs: 25 }, p), l = BT.scoreOne({ actualMs: 400 }, p);
  assert.equal(e.early, true); assert.equal(l.late, true); assert.equal(e.inBand || l.inBand, false);
  assert.ok(Math.abs(e.is - (Math.log(4) + 10 * Math.log(2))) < 1e-9, "miss penalty 2/alpha * distance");
  assert.ok(e.pit < 0.1 && l.pit > 0.9);
  assert.equal(BT.scoreOne({ actualMs: null }, p), null); assert.equal(BT.scoreOne(s, null), null);
});
test("normCdf and acf1 sanity", () => {
  assert.ok(Math.abs(BT.normCdf(0) - 0.5) < 1e-7); assert.ok(Math.abs(BT.normCdf(1.2816) - 0.9) < 1e-3); assert.ok(Math.abs(BT.normCdf(-1.2816) - 0.1) < 1e-3);
  assert.equal(BT.acf1([1, 2]), null); assert.ok(BT.acf1([1, 2, 3, 4, 5, 6]) > 0.4); assert.ok(BT.acf1([1, -1, 1, -1, 1, -1]) < -0.5);
});
test("coverageCI: deterministic, brackets the point estimate, null with fewer than two blocks", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ block: i % 10, inBand: i % 5 !== 0 }));
  const a = BT.coverageCI(rows), b = BT.coverageCI(rows);
  assert.deepEqual(a, b); assert.ok(a[0] <= 0.8 && 0.8 <= a[1]);
  assert.equal(BT.coverageCI(rows.map((r) => ({ ...r, block: 1 }))), null);
});
test("attachCensor: first install after the prediction, else the resolution time; non-censored untouched", () => {
  const S = [{ censored: true, made: 100, knownAt: 900 }, { censored: true, made: 100, knownAt: 300 }, { censored: true, made: 950, knownAt: 2000 }, { censored: false, made: 1 }];
  BT.attachCensor(S, [50, 400, 1000]);
  assert.deepEqual(S.map((s) => s.censorMs), [300, 200, 50, undefined]);
  BT.attachCensor([{ censored: true, made: 1, knownAt: null }], []);
});
test("censoredMisses: a band ending before the install is a definite miss", () => {
  const rows = [{ s: { censored: true, censorMs: 500 }, p: { hi: 100 } }, { s: { censored: true, censorMs: 50 }, p: { hi: 100 } }, { s: { censored: true, censorMs: 50 }, p: null }, { s: { censored: false }, p: { hi: 1 } }];
  assert.deepEqual(BT.censoredMisses(rows), { n: 2, definiteMiss: 1, unknown: 1, definiteMissRate: 0.5 });
  assert.equal(BT.censoredMisses([]).definiteMissRate, null);
});
test("baseline v2 replays the logged band exactly; aggregate / groupBy / folds on synthetic data", () => {
  const samples = PC.samplesFromLog(synthLog());
  const rows = BT.score(BT.runCandidate(samples, BT.CANDIDATES.v2));
  const resolved = rows.filter((r) => r.sc);
  assert.ok(resolved.length > 200);
  assert.ok(resolved.every((r) => r.p.lo === r.s.logged.lo && r.p.hi === r.s.logged.hi));
  const agg = BT.aggregate(rows);
  assert.ok(agg.coverage < 0.4, "the deliberately narrow band covers little");
  assert.equal(agg.pit.reduce((a, b) => a + b, 0), agg.n);
  assert.ok(Object.keys(BT.groupBy(rows, (r) => (r.sc ? r.s.kind : null))).length === 2);
  assert.equal(BT.folds(rows, 4).length, 4);
  assert.deepEqual(BT.aggregate([]), { n: 0 });
});
test("report(): v3 beats the too-narrow baseline on coverage and interval score, deterministic, held-out after the cut", () => {
  const samples = PC.samplesFromLog(synthLog(360));
  const r1 = BT.report(samples, { tune: false, candidates: ["v2", "v3"] }), r2 = BT.report(samples, { tune: false, candidates: ["v2", "v3"] });
  assert.deepEqual(r1, r2);
  const v2 = r1.candidates.v2.heldOut, v3 = r1.candidates.v3.heldOut;
  assert.ok(v3.coverage > v2.coverage + 0.3, `${v3.coverage} vs ${v2.coverage}`);
  assert.ok(v3.intervalScore < v2.intervalScore, `${v3.intervalScore} vs ${v2.intervalScore}`);
  assert.ok(v2.n < r1.nResolved, "held-out is only part of the timeline");
  assert.ok(BT.render(r1).includes("Held-out, overall"));
});
test("objective penalises coverage outside 78-82% and an empty aggregate is never chosen", () => {
  assert.equal(BT.objective({ n: 0 }), Infinity);
  assert.equal(BT.objective({ n: 10, intervalScore: 2, coverage: 0.81 }), 2);
  assert.ok(BT.objective({ n: 10, intervalScore: 2, coverage: 0.6 }) > 3.5);
  assert.ok(BT.GRID.length > 10 && BT.GRID.every((g) => g.pointMode));
});
test("CLI: usage error without a file; runs end to end on a small log with --no-tune and --json", () => {
  const cli = path.resolve("scripts/predictor-backtest.js");
  assert.equal(spawnSync(process.execPath, [cli]).status, 2);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-")), log = path.join(dir, "pred2.txt"), out = path.join(dir, "out.json");
  fs.writeFileSync(log, synthLog(150));
  const r = spawnSync(process.execPath, [cli, log, "--no-tune", "--json", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("# Predictor backtest"));
  assert.ok(JSON.parse(fs.readFileSync(out, "utf8")).candidates.v3);
  fs.rmSync(dir, { recursive: true, force: true });
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} predictor-backtest test(s) failed`); process.exit(1); }
console.log(`predictor-backtest: ${tests.length} passed`);
