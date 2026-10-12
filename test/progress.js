// lib/progress.js: fl1ght.exe progress, phase thresholds, strategy weights.
import assert from "node:assert/strict";
import { flightProgress, phaseOf, weightFor, strategyNow } from "../game/lib/progress.js";
import { defaults } from "../game/lib/settings-schema.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const S = defaults();

test("flightProgress: mean of capped parts; met only when all three are", () => {
  const r = flightProgress({ augsInstalled: 15, augsReq: 30, money: 100e9, moneyReq: 100e9, hack: 5000, hackReq: 2500 });
  assert.deepEqual(r.parts, { augs: 0.5, money: 1, hack: 1 });
  assert.equal(r.progress, 2.5 / 3);
  assert.equal(r.met, false);
  assert.equal(flightProgress({ augsInstalled: 30, augsReq: 30, money: 1e12, moneyReq: 1e11, hack: 2500, hackReq: 2500 }).met, true);
});
test("flightProgress: garbage and missing inputs never produce NaN", () => {
  for (const p of [{}, { augsInstalled: NaN, augsReq: 30 }, { money: -5, moneyReq: 1 }, undefined]) {
    const r = flightProgress(p);
    assert.ok(Number.isFinite(r.progress) && r.progress >= 0 && r.progress <= 1);
  }
  assert.equal(flightProgress({ augsReq: 0, moneyReq: 0, hackReq: 0 }).progress, 1); // no requirements
});
test("phaseOf: below / at / above thresholds, Red Pill override, custom thresholds", () => {
  assert.equal(phaseOf(0, false, S), "early");
  assert.equal(phaseOf(0.3399, false, S), "early");
  assert.equal(phaseOf(0.34, false, S), "mid");
  assert.equal(phaseOf(0.8999, false, S), "mid");
  assert.equal(phaseOf(0.9, false, S), "late");
  assert.equal(phaseOf(0.1, true, S), "late");
  assert.equal(phaseOf(NaN, false, S), "early");
  assert.equal(phaseOf(0.5, false, { ...S, "strategy.phase.midAt": 0.6 }), "early");
});
test("weightFor: defaults 0 / 0.5 / 1, settings override, clamped", () => {
  assert.equal(weightFor("early", S), 0);
  assert.equal(weightFor("mid", S), 0.5);
  assert.equal(weightFor("late", S), 1);
  assert.equal(weightFor("mid", { ...S, "strategy.mid": 0.2 }), 0.2);
  assert.equal(weightFor("late", { "strategy.late": 7 }), 1);
  assert.equal(weightFor("late", {}), 1);
});
test("strategyNow: combines progress, phase and weight", () => {
  const r = strategyNow({ augsInstalled: 30, augsReq: 30, money: 1, moneyReq: 1e11, hack: 1, hackReq: 2500 }, false, S);
  assert.equal(r.phase, "early"); // (1 + ~0 + ~0) / 3 < 0.34
  assert.equal(r.weight, 0);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} progress test(s) failed`); process.exit(1); }
console.log(`progress: ${tests.length} passed`);
