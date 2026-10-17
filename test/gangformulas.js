// lib/gangformulas.js against values worked out by hand from bitburner-src Gang/formulas/formulas.ts
// (constants below were computed independently with a calculator, not with this library).
import assert from "node:assert/strict";
import { importGame } from "./helpers/game-import.js";
import { DATA } from "./helpers/fake-gang.js";

const F = await importGame("lib/gangformulas.js");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const near = (a, b, rel = 1e-9) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const ALL100 = { hack: 100, str: 100, def: 100, dex: 100, agi: 100, cha: 100 };
const SEVEN = 1 / 7; // every gang starts with 1/7 of the territory
const mug = DATA.tasks["Mug People"], vig = DATA.tasks["Vigilante Justice"], terror = DATA.tasks.Terrorism;

test("wantedPenalty = respect / (respect + wanted)", () => {
  near(F.wantedPenalty({ respect: 100, wanted: 25 }), 0.8);
  near(F.wantedPenalty({ respect: 100, wantedLevel: 25 }), 0.8, 1e-12);
  near(F.wantedPenalty({ respect: 1, wanted: 1 }), 0.5);
});
test("respectGain: Mug People, stats 100, 1/7 territory, respect 100 wanted 1 -> 0.0172904504", () => {
  // stat weight 25+25+25+10+15 = 100% of 100, minus 4 x difficulty 1 = 96; territory mult (100/7)^1 / 100 = 1/7;
  // wanted penalty 100/101; exponent (0.2/7 + 0.8) = 0.828571...
  near(F.respectGain({ respect: 100, wanted: 1, territory: SEVEN }, ALL100, mug), 0.017290450434014542);
});
test("respectGain: GangSoftcap multiplies the exponent", () => {
  near(F.respectGain({ respect: 100, wanted: 1, territory: SEVEN }, ALL100, mug, 0.5), 0.13149315736575246);
});
test("wantedGain: positive base wanted uses 7 x base / (3 x weight x territory)^0.8, weight - 3.5 x difficulty", () => {
  near(F.wantedGain({ respect: 100, wanted: 1, territory: SEVEN }, ALL100, mug), 1.7816714545714566e-05);
});
test("wantedGain: negative base wanted (Vigilante Justice) is 0.4 x base x weight x territory^0.9", () => {
  near(F.wantedGain({ respect: 100, wanted: 1, territory: SEVEN }, ALL100, vig), -0.004226677078570797);
});
test("moneyGain: Mug People -> 95.8777552317", () => {
  near(F.moneyGain({ respect: 100, wanted: 1, territory: SEVEN }, ALL100, mug), 95.87775523172309);
});
test("a task the member is too weak for gains nothing (weight <= k x difficulty)", () => {
  const weak = { hack: 1, str: 1, def: 1, dex: 1, agi: 1, cha: 1 };
  const g = { respect: 100, wanted: 1, territory: SEVEN };
  assert.equal(F.respectGain(g, weak, terror), 0);
  assert.equal(F.wantedGain(g, weak, terror), 0);
  assert.equal(F.moneyGain(g, weak, DATA.tasks["Traffick Illegal Arms"]), 0);
  assert.equal(F.respectGain(g, ALL100, vig), 0, "no base respect");
  assert.equal(F.moneyGain(g, ALL100, vig), 0, "no base money");
});
test("territory multiplier is floored at 0.005", () => {
  near(F.respectGain({ respect: 100, wanted: 1, territory: 0 }, ALL100, mug), 0.0013608994622555787);
});
test("positive wanted gain is capped at 100", () => {
  const tiny = { hack: 0, str: 3.6 + 1e-12, def: 0, dex: 0, agi: 0, cha: 0 };
  const t = { ...terror, strWeight: 100, hackWeight: 0, defWeight: 0, dexWeight: 0, chaWeight: 0, difficulty: 1, baseWanted: 6 };
  assert.equal(F.wantedGain({ respect: 1, wanted: 1, territory: 1 }, { ...tiny, str: 3.5 + 1e-9 }, t), 100);
});
test("ascension: points = max(0, exp - 1000); mult = max(1, sqrt(points / 2000))", () => {
  assert.equal(F.ascensionPointsGain(500), 0);
  assert.equal(F.ascensionPointsGain(3000), 2000);
  assert.equal(F.ascensionMult(0), 1);
  assert.equal(F.ascensionMult(2000), 1);
  assert.equal(F.ascensionMult(8000), 2);
  near(F.ascensionMult(18000), 3);
});
test("constants match Gang/data/Constants.ts", () => {
  assert.deepEqual({ ...F.GANG }, { maxMembers: 12, freeMembers: 3, recruitBase: 5, respectToRep: 75, installAscensionPenalty: 0.95 });
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} gangformulas test(s) failed`); process.exit(1); }
console.log(`gangformulas: ${tests.length} passed`);
