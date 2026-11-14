// node.targets: per-BitNode target Source-File levels, BN12 default target 0, BN15, all-targets-met, early warning
// (spec: docs/specs/node-targets.md). The golden file was generated from lib/nodectl.js BEFORE node.targets existed.
import assert from "node:assert/strict";
import fs from "node:fs";
import { importGame } from "./helpers/game-import.js";
import { defaults, coerce, SCHEMA, BY_KEY, emptyFile, applyPatch, serialize, parseFile, effective, BN_COUNT, TARGET_CAP } from "../game/lib/settings-schema.js";
import { controlsFromSchema } from "../game/lib/ui/settings-model.js";

const { pickNextBn, decideNode } = await importGame("lib/nodectl.js");
const A = await importGame("lib/augplan.js");
const { SF_MAX, DEFAULT_BN_ORDER, firstAvailable, bnAvailable, targetOf, defaultTarget, recommendNextBn, sfLevels } = A;
const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/node-targets-golden.json", import.meta.url), "utf8"));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const S = (o = {}) => ({ ...defaults(), ...o });
const rt = (o) => JSON.parse(JSON.stringify(o));
const toSf = (a) => a.map((lvl, i) => ({ n: i + 1, lvl })).filter((x) => x.lvl > 0);
const LIVE = [2, 3, 11, 6, 7];
const sfAll = (lvl, except = {}) => Array.from({ length: BN_COUNT }, (_, i) => ({ n: i + 1, lvl: except[i + 1] ?? lvl }));

// ---------------- 1. golden: defaults + the live node.order are unchanged ----------------
test("golden: default node.targets gives the pre-change pickNextBn output wherever BN12 was not involved (live node.order [2,3,11,6,7])", () => {
  let same = 0, changed = 0;
  for (const vn of Object.keys(golden.variants)) {
    golden.states.forEach((st, i) => {
      const old = golden.pick[vn][i], s = S(golden.variants[vn]), x = { bn: st.bn, sourceFiles: toSf(st.sf) };
      const now = rt(pickNextBn(x, s));
      if (old.recommended.bn === 12 || old.nextBn === 12) {
        changed++;
        assert.notEqual(now.nextBn, 12, `${vn}[${i}]: BN12 is never picked by default`);
        assert.notEqual(now.recommended.bn, 12, `${vn}[${i}]: BN12 is never recommended by default`);
        return;
      }
      same++;
      assert.deepEqual(now, old, `${vn}[${i}] bn${st.bn} ${JSON.stringify(st.sf)}`);
    });
  }
  assert.ok(same > 400 && changed > 20, `grid sizes ${same}/${changed}`);
});
test("golden: decideNode (autoDestroy on, ready) is unchanged for the live order, recommend and stop", () => {
  let n = 0;
  for (const vn of ["liveRecommend", "liveStop"]) {
    golden.states.forEach((st, i) => {
      const old = golden.decide[vn][i], pk = golden.pick[vn][i];
      if (pk.recommended.bn === 12 || pk.nextBn === 12) return;
      const s = S({ ...golden.variants[vn], "node.autoDestroy": true });
      assert.deepEqual(rt(decideNode({ ready: true, bn: st.bn, sourceFiles: toSf(st.sf), now: golden.T0, request: null, ack: null }, s)), old, `${vn}[${i}]`);
      n++;
    });
  }
  assert.ok(n > 200, String(n));
});
test("live order [2,3,11,6,7] walks BN2 -> 3 -> 11 -> 6 -> 7 with default settings (byte-identical picks)", () => {
  const s = S({ "node.autoSelect": true, "node.order": LIVE });
  // SF2 at 2 (BN2 in progress), others 0: the destroy takes SF2 to 3, so the next pick is BN3
  assert.equal(pickNextBn({ bn: 2, sourceFiles: [{ n: 2, lvl: 2 }] }, s).nextBn, 3);
  assert.equal(pickNextBn({ bn: 3, sourceFiles: [{ n: 2, lvl: 3 }, { n: 3, lvl: 2 }] }, s).nextBn, 11);
  assert.equal(pickNextBn({ bn: 11, sourceFiles: [{ n: 2, lvl: 3 }, { n: 3, lvl: 3 }, { n: 11, lvl: 2 }] }, s).nextBn, 6);
  assert.equal(pickNextBn({ bn: 6, sourceFiles: [{ n: 2, lvl: 3 }, { n: 3, lvl: 3 }, { n: 11, lvl: 3 }, { n: 6, lvl: 2 }] }, s).nextBn, 7);
});

// ---------------- 2. schema ----------------
test("schema: node.targets is an intMap, default {}, group node, owned by the autopilot; defaults() returns fresh copies", () => {
  const f = BY_KEY["node.targets"];
  assert.ok(f); assert.equal(f.type, "intMap"); assert.deepEqual(f.default, {}); assert.equal(f.group, "node"); assert.equal(f.owner, "autopilot"); assert.ok(f.label && f.help);
  const a = defaults(), b = defaults();
  a["node.targets"]["12"] = 5;
  assert.deepEqual(b["node.targets"], {}); assert.deepEqual(BY_KEY["node.targets"].default, {});
  const e = effective({ "node.targets": { 12: 5 } }); e["node.targets"]["3"] = 1;
  assert.deepEqual(effective({ "node.targets": { 12: 5 } })["node.targets"], { 12: 5 });
});
test("schema: coerce accepts object, JSON string, short form and empty; sorts keys", () => {
  for (const [raw, want] of [[{ 12: 5 }, { 12: 5 }], ['{"12":5}', { 12: 5 }], ["12:5,3:0", { 3: 0, 12: 5 }], [" 12 : 5 , 3 : 0 ", { 3: 0, 12: 5 }], ["", {}], ["  ", {}], [{}, {}], ["{}", {}], [{ 14: 3, 1: 0 }, { 1: 0, 14: 3 }], [{ 12: 1000 }, { 12: 1000 }]])
    assert.deepEqual(coerce("node.targets", raw), { ok: true, value: want }, JSON.stringify(raw));
});
test("schema: coerce rejects invalid targets (never clamps)", () => {
  const bad = [[{ 15: 1 }, /unknown BitNode/], [{ 0: 1 }, /unknown BitNode/], [{ x: 1 }, /unknown BitNode/], [{ "03": 1 }, /unknown BitNode/], [{ "-1": 1 }, /unknown BitNode/],
    [{ 3: 4 }, /BN3: target must be <= 3/], [{ 12: 1001 }, /BN12: target must be <= 1000/], [{ 3: -1 }, /integer >= 0/], [{ 3: 1.5 }, /integer >= 0/], [{ 3: "2" }, /integer >= 0/],
    [{ 3: null }, /integer >= 0/], [{ 3: NaN }, /integer >= 0/], [{ 3: Infinity }, /integer >= 0|<=/], [[1, 2], /expected a JSON object/], [null, /expected a JSON object/], [5, /expected a JSON object/],
    [true, /expected a JSON object/], ["[1]", /expected a JSON object/], ["{bad json", /expected a JSON object/], ["3", /expected a JSON object/], ["3:1,3:2", /listed twice/],
    ["12:x", /expected a JSON object/], ["12:", /expected a JSON object/], ["a:1", /expected a JSON object/], ["3:1:2", /expected a JSON object/], ["15:1", /unknown BitNode/], ["3:4", /<= 3/]];
  for (const [raw, re] of bad) { const r = coerce("node.targets", raw); assert.equal(r.ok, false, JSON.stringify(raw)); assert.match(r.error, re, JSON.stringify(raw)); assert.match(r.error, /^node\.targets: /); }
});
test("schema: TARGET_CAP / BN_COUNT agree with augplan SF_MAX (BN12 has no game cap)", () => {
  assert.equal(BN_COUNT, A.BN_MAX);
  for (let n = 1; n <= BN_COUNT; n++) assert.equal(TARGET_CAP(n), Math.min(SF_MAX(n), 1000), `BN${n}`);
});
test("settings: round trip (patch -> serialize -> parse -> effective), unset returns to default, bad stored value warns and defaults", () => {
  const r = applyPatch(emptyFile(), { set: { "node.targets": "12:5,3:0" } }, { actor: "cli", now: 5 });
  assert.equal(r.ok, true); assert.deepEqual(r.changed, [{ key: "node.targets", from: {}, to: { 3: 0, 12: 5 } }]);
  const back = parseFile(serialize(r.file));
  assert.deepEqual(back.warnings, []); assert.deepEqual(effective(back.values)["node.targets"], { 3: 0, 12: 5 });
  const un = applyPatch(r.file, { unset: ["node.targets"] }, { actor: "cli", now: 6 });
  assert.equal(un.ok, true); assert.deepEqual(effective(un.file.values)["node.targets"], {});
  // setting the default explicitly changes nothing visible but is stored; setting it twice is a no-op
  const same = applyPatch(r.file, { set: { "node.targets": { 3: 0, 12: 5 } } }, { actor: "cli", now: 7 });
  assert.equal(same.file, r.file);
  const bad = parseFile(JSON.stringify({ version: 1, rev: 1, values: { "node.targets": { 12: 5000 } } }));
  assert.equal(bad.warnings.length, 1); assert.match(bad.warnings[0], /node\.targets/); assert.deepEqual(effective(bad.values)["node.targets"], {});
  const badSet = applyPatch(emptyFile(), { set: { "node.targets": { 99: 1 }, "node.fallback": "stop" } }, { actor: "t", now: 1 });
  assert.equal(badSet.ok, false); assert.deepEqual(badSet.file.values, {});
});
test("dashboard: the settings model shows an intMap as JSON text, with a text control", () => {
  const c = controlsFromSchema(SCHEMA, defaults(), {}).find((x) => x.key === "node.targets");
  assert.equal(c.control, "text"); assert.equal(c.shown, "{}"); assert.equal(c.type, "intMap");
  const d = controlsFromSchema(SCHEMA, S({ "node.targets": { 12: 5 } }), { "node.targets": { 12: 5 } }).find((x) => x.key === "node.targets");
  assert.equal(d.shown, '{"12":5}'); assert.equal(d.overridden, true); assert.equal(d.differsFromDefault, true);
  assert.equal(controlsFromSchema(SCHEMA, defaults(), {}, { "node.targets": "12:" }).find((x) => x.key === "node.targets").shown, "12:");
});

// ---------------- 3. targets in the selector ----------------
test("targetOf / defaultTarget: 3 for every node, 0 for BN12; explicit entries win, are capped, bad ones are ignored", () => {
  for (let n = 1; n <= 14; n++) assert.equal(defaultTarget(n), n === 12 ? 0 : 3);
  assert.equal(targetOf(12), 0); assert.equal(targetOf(12, {}), 0); assert.equal(targetOf(3, {}), 3); assert.equal(targetOf(3, undefined), 3); assert.equal(targetOf(3, null), 3);
  assert.equal(targetOf(12, { 12: 5 }), 5); assert.equal(targetOf(12, { 12: 0 }), 0); assert.equal(targetOf(3, { 3: 0 }), 0); assert.equal(targetOf(3, { 3: 1 }), 1);
  assert.equal(targetOf(3, { 3: 7 }), 3, "capped at SF_MAX");
  for (const bad of [-1, 1.5, "2", NaN, null, undefined, [], {}, true]) { assert.equal(targetOf(3, { 3: bad }), 3, String(bad)); assert.equal(targetOf(12, { 12: bad }), 0, String(bad)); }
  assert.equal(targetOf(3, "junk"), 3); assert.equal(targetOf(3, [3]), 3);
});
test("BN12 is never available, picked or recommended by default; an explicit target opens it until SF12 reaches it", () => {
  assert.equal(bnAvailable(12, {}), false); assert.equal(bnAvailable(12, { 12: 0 }, {}), false); assert.equal(firstAvailable([12], {}), null);
  assert.equal(bnAvailable(12, {}, { 12: 5 }), true); assert.equal(bnAvailable(12, { 12: 4 }, { 12: 5 }), true); assert.equal(bnAvailable(12, { 12: 5 }, { 12: 5 }), false);
  assert.equal(bnAvailable(12, { 12: 50 }, { 12: 1000 }), true);
  // recommendation: with everything else maxed the default has nothing, an explicit target recommends BN12
  const snap = { bn: 13, sourceFiles: sfAll(3, { 12: 0 }).filter((x) => x.n <= 14) };
  assert.equal(recommendNextBn(snap, S()).bn, null);
  const rec = recommendNextBn(snap, S({ "node.targets": { 12: 5 } }));
  assert.equal(rec.bn, 12); assert.match(rec.why, /BN12/);
  // node.order [12] with autoSelect
  const s = S({ "node.autoSelect": true, "node.order": [12], "node.fallback": "stop" });
  assert.equal(pickNextBn({ bn: 5, sourceFiles: [] }, s).nextBn, null); assert.equal(pickNextBn({ bn: 5, sourceFiles: [] }, s).source, "order-exhausted");
  assert.equal(pickNextBn({ bn: 5, sourceFiles: [] }, { ...s, "node.targets": { 12: 2 } }).nextBn, 12);
  assert.equal(pickNextBn({ bn: 12, sourceFiles: [{ n: 12, lvl: 1 }] }, { ...s, "node.targets": { 12: 2 } }).nextBn, null, "the destroy in progress counts: SF12 1 -> 2 meets the target");
  assert.equal(pickNextBn({ bn: 12, sourceFiles: [{ n: 12, lvl: 1 }] }, { ...s, "node.targets": { 12: 3 } }).nextBn, 12);
});
test("default recommendation skips BN12 and keeps the rest of DEFAULT_BN_ORDER in order", () => {
  assert.equal(DEFAULT_BN_ORDER.indexOf(12), 8, "12 keeps its position");
  assert.deepEqual(DEFAULT_BN_ORDER.slice(0, 8), [1, 4, 2, 5, 10, 9, 3, 11]);
  const maxed = sfAll(3, { 12: 0 }).filter((x) => [1, 4, 2, 5, 10, 9, 3, 11].includes(x.n));
  assert.equal(recommendNextBn({ bn: 11, sourceFiles: maxed }, S()).bn, 6, "after BN11 comes BN6 (not BN12)");
  assert.equal(recommendNextBn({ bn: 11, sourceFiles: maxed }, S({ "node.targets": { 12: 5 } })).bn, 12, "an explicit target puts BN12 back in its old position");
});
test("per-node targets: {\"3\":0} skips BN3, {\"3\":1} stops after one SF3, targets beyond SF_MAX are capped", () => {
  const s = (t) => S({ "node.autoSelect": true, "node.order": [3, 2], "node.targets": t });
  assert.equal(pickNextBn({ bn: 5, sourceFiles: [] }, s({ 3: 0 })).nextBn, 2);
  assert.equal(pickNextBn({ bn: 5, sourceFiles: [{ n: 3, lvl: 0 }] }, s({ 3: 1 })).nextBn, 3);
  assert.equal(pickNextBn({ bn: 5, sourceFiles: [{ n: 3, lvl: 1 }] }, s({ 3: 1 })).nextBn, 2);
  assert.equal(pickNextBn({ bn: 5, sourceFiles: [{ n: 3, lvl: 3 }] }, s({ 3: 9 })).nextBn, 2, "SF3 is maxed even though the target says 9");
  // the recommendation respects targets as well
  assert.equal(recommendNextBn({ bn: 5, sourceFiles: [] }, S({ "node.targets": { 1: 0, 4: 0 } })).bn, 2);
  // invalid stored targets (not an object, junk values) fall back to the defaults without throwing
  for (const t of [null, "junk", [], [1], { 3: "x" }, { 99: 2 }]) assert.equal(pickNextBn({ bn: 5, sourceFiles: [] }, S({ "node.autoSelect": true, "node.order": [3], "node.targets": t })).nextBn, 3, JSON.stringify(t));
});
test("empty node.order: the recommendation (default order, BN12 skipped) is used in recommend mode; stop mode stops", () => {
  const sf = [{ n: 1, lvl: 1 }];
  assert.equal(pickNextBn({ bn: 5, sourceFiles: sf }, S({ "node.autoSelect": true })).nextBn, 1);
  assert.equal(pickNextBn({ bn: 5, sourceFiles: sf }, S({ "node.autoSelect": true, "node.fallback": "stop" })).source, "order-exhausted");
  assert.equal(sfLevels(sf, 5)[5], 1);
});

// ---------------- runner ----------------
let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} node-targets test(s) failed`); process.exit(1); }
console.log(`node-targets: ${tests.length} passed`);
