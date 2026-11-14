// node.targets: per-BitNode target Source-File levels, BN12 default target 0, BN15, all-targets-met, early warning
// (spec: docs/specs/node-targets.md). The golden file was generated from lib/nodectl.js BEFORE node.targets existed.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { importGame } from "./helpers/game-import.js";
import { defaults, coerce, SCHEMA, BY_KEY, emptyFile, applyPatch, serialize, parseFile, effective, BN_COUNT, TARGET_CAP } from "../game/lib/settings-schema.js";
import { controlsFromSchema } from "../game/lib/ui/settings-model.js";
import { computeKpis } from "../game/lib/kpi.js";
import { OWNER_DECISION } from "../server/checkin.js";
import { NOW, latest, ring, autopilot, ramStatus, augPlan, pred2Tail } from "./fixtures/dashboard-data.js";

const { pickNextBn, decideNode, ALL_MET_FLAG, orderExhaustedFlag, orderOutlook, orderWarning, ORDER_LOW, ORDER_LOW_AT } = await importGame("lib/nodectl.js");
const A = await importGame("lib/augplan.js");
const { SF_MAX, ALL_MET, READY_FLAG, DEFAULT_BN_ORDER, firstAvailable, bnAvailable, targetOf, defaultTarget, recommendNextBn, sfLevels } = A;
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
  for (const [raw, want] of [[{ 12: 5 }, { 12: 5 }], ['{"12":5}', { 12: 5 }], ["12:5,3:0", { 3: 0, 12: 5 }], [" 12 : 5 , 3 : 0 ", { 3: 0, 12: 5 }], ["", {}], ["  ", {}], [{}, {}], ["{}", {}], [{ 15: 3, 1: 0 }, { 1: 0, 15: 3 }], [{ 12: 1000 }, { 12: 1000 }]])
    assert.deepEqual(coerce("node.targets", raw), { ok: true, value: want }, JSON.stringify(raw));
});
test("schema: coerce rejects invalid targets (never clamps)", () => {
  const bad = [[{ 16: 1 }, /unknown BitNode/], [{ 0: 1 }, /unknown BitNode/], [{ x: 1 }, /unknown BitNode/], [{ "03": 1 }, /unknown BitNode/], [{ "-1": 1 }, /unknown BitNode/],
    [{ 3: 4 }, /BN3: target must be <= 3/], [{ 12: 1001 }, /BN12: target must be <= 1000/], [{ 3: -1 }, /integer >= 0/], [{ 3: 1.5 }, /integer >= 0/], [{ 3: "2" }, /integer >= 0/],
    [{ 3: null }, /integer >= 0/], [{ 3: NaN }, /integer >= 0/], [{ 3: Infinity }, /integer >= 0|<=/], [[1, 2], /expected a JSON object/], [null, /expected a JSON object/], [5, /expected a JSON object/],
    [true, /expected a JSON object/], ["[1]", /expected a JSON object/], ["{bad json", /expected a JSON object/], ["3", /expected a JSON object/], ["3:1,3:2", /listed twice/],
    ["12:x", /expected a JSON object/], ["12:", /expected a JSON object/], ["a:1", /expected a JSON object/], ["3:1:2", /expected a JSON object/], ["16:1", /unknown BitNode/], ["3:4", /<= 3/]];
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
  const snap = { bn: 13, sourceFiles: sfAll(3, { 12: 0 }) };
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

// ---------------- 4. BN15 ----------------
test("BN15 is a selectable BitNode: SF_MAX 3, available below 3, last in the default order, 0 and 16 are not BitNodes", () => {
  assert.equal(SF_MAX(15), 3); assert.equal(defaultTarget(15), 3); assert.equal(A.BN_MAX, 15);
  assert.equal(DEFAULT_BN_ORDER.at(-1), 15); assert.equal(DEFAULT_BN_ORDER.length, 15); assert.equal(new Set(DEFAULT_BN_ORDER).size, 15);
  for (const l of [0, 1, 2]) assert.equal(bnAvailable(15, { 15: l }), true, `SF15 ${l}`);
  assert.equal(bnAvailable(15, { 15: 3 }), false);
  for (const n of [0, 16, -1, 1.5, "15", null, undefined, NaN]) assert.equal(bnAvailable(n, {}, { 12: 5 }), false, String(n));
  assert.equal(firstAvailable([16, 0, 15], {}), 15);
  assert.equal(pickNextBn({ bn: 13, sourceFiles: [{ n: 15, lvl: 2 }] }, S({ "node.autoSelect": true, "node.order": [15] })).nextBn, 15);
  assert.equal(pickNextBn({ bn: 15, sourceFiles: [{ n: 15, lvl: 2 }] }, S({ "node.autoSelect": true, "node.order": [15], "node.fallback": "stop" })).nextBn, null, "the destroy in progress takes SF15 to 3");
  assert.deepEqual(coerce("node.order", "15,2"), { ok: true, value: [15, 2] }, "node.order accepts BN15");
  for (const bad of ["16", "0", [16]]) assert.equal(coerce("node.order", bad).ok, false, JSON.stringify(bad));
});
test("BN15: the recommendation reaches it only after every other target is met; {\"15\":0} switches it off", () => {
  const sf = sfAll(3, { 15: 0, 12: 0 });
  const rec = recommendNextBn({ bn: 14, sourceFiles: sf }, S());
  assert.equal(rec.bn, 15); assert.match(rec.why, /BN15/); assert.match(rec.why, /SF15 0 -> 1/);
  assert.equal(recommendNextBn({ bn: 14, sourceFiles: sf }, S({ "node.targets": { 15: 0 } })).bn, null);
  assert.deepEqual(coerce("node.targets", { 15: 3 }), { ok: true, value: { 15: 3 } });
});

// ---------------- 5. every target met ----------------
const MET = { bn: 13, sourceFiles: sfAll(3, { 12: 0 }) };               // BN13 in progress, everything else at 3, BN12 at its default target
const R = (o = {}) => ({ ready: true, now: golden.T0, request: null, ack: null, ...MET, ...o });
test("all targets met: the planner recommends nothing, with the explicit text", () => {
  const rec = recommendNextBn(MET, S());
  assert.equal(rec.bn, null); assert.equal(rec.why, ALL_MET); assert.equal(ALL_MET, "every BitNode target is met");
  assert.match(ALL_MET_FLAG, /^every BitNode target is met — nothing left to select/); assert.match(ALL_MET_FLAG, /node\.targets/);
  // the destroy in progress counts: BN7 at SF7 2 is the last open one and the current node
  const last = { bn: 7, sourceFiles: sfAll(3, { 12: 0, 7: 2 }) };
  assert.equal(recommendNextBn(last, S()).bn, null);
  assert.equal(recommendNextBn({ bn: 7, sourceFiles: sfAll(3, { 12: 0, 7: 1 }) }, S()).bn, 7, "SF7 1 -> 2 is still below 3");
});
test("all targets met + ready: flag, source, no request, never 'autoSelect off' (recommend and stop, autoSelect on and off)", () => {
  for (const fb of ["recommend", "stop"]) for (const sel of [true, false]) {
    const s = S({ "node.autoDestroy": true, "node.autoSelect": sel, "node.fallback": fb, "node.order": [10] });
    const d = decideNode(R(), s), tag = `${fb} autoSelect=${sel}`;
    assert.equal(d.action, "flag", tag); assert.equal(d.writeRequest, null, tag); assert.equal(d.nextBn, null, tag);
    assert.deepEqual(d.attention, [READY_FLAG, ALL_MET_FLAG], tag);
    assert.equal(d.node.source, "all-targets-met", tag); assert.equal(d.node.recommended.bn, null, tag);
    assert.match(d.node.pending.detail, /every BitNode target is met/, tag); assert.doesNotMatch(d.node.pending.detail, /autoSelect off|BNnull|BN\?|BNundefined/, tag);
    // dedupe: the same text on later loops and later clocks
    for (const now of [golden.T0 + 60_000, golden.T0 + 5 * 3600_000]) assert.deepEqual(decideNode(R({ now }), s).attention, d.attention, tag);
    // an open request is cancelled
    const req = { id: "r1", action: "destroy", bn: 13, nextBn: 1, at: golden.T0 - 1000 };
    const c = decideNode(R({ request: req, ack: { id: "r1", backupOk: true, at: golden.T0 - 500 } }), s);
    assert.equal(c.action, "cancel", tag); assert.equal(c.writeRequest.action, "cancel"); assert.deepEqual(c.attention, [READY_FLAG, ALL_MET_FLAG], tag);
  }
});
test("all targets met + autoDestroy off: the owner is told (READY + all-met flag); not ready: nothing", () => {
  const off = decideNode(R(), S());
  assert.equal(off.action, "flag"); assert.deepEqual(off.attention, [READY_FLAG, ALL_MET_FLAG]); assert.match(off.node.pending.detail, /every BitNode target is met/);
  const req = { id: "r1", action: "destroy", bn: 13, nextBn: 1, at: golden.T0 - 1000 };
  assert.deepEqual(decideNode(R({ request: req }), S()).attention, [READY_FLAG, ALL_MET_FLAG]);
  const nr = decideNode(R({ ready: false }), S({ "node.autoDestroy": true, "node.autoSelect": true }));
  assert.equal(nr.action, "none"); assert.deepEqual(nr.attention, []); assert.equal(nr.node.pending.detail, "w0r1d_d43m0n not ready");
});
test("an explicit BN12 target ends the all-met state: BN12 is selected again until SF12 reaches the target", () => {
  const s = S({ "node.autoDestroy": true, "node.autoSelect": true, "node.order": [10], "node.targets": { 12: 5 } });
  const d = decideNode(R(), s);
  assert.equal(d.action, "request"); assert.equal(d.writeRequest.nextBn, 12); assert.ok(!("source" in d.node)); assert.deepEqual(d.attention, []);
  const reached = decideNode(R({ sourceFiles: sfAll(3, { 12: 5 }) }), s);
  assert.equal(reached.action, "flag"); assert.deepEqual(reached.attention, [READY_FLAG, ALL_MET_FLAG]);
});
test("all targets met is not the order-exhausted flag: with something left to recommend the old flag is unchanged", () => {
  const sf = sfAll(3, { 12: 0, 9: 0 });
  const d = decideNode(R({ sourceFiles: sf }), S({ "node.autoDestroy": true, "node.autoSelect": true, "node.fallback": "stop", "node.order": [10] }));
  assert.equal(d.node.source, "order-exhausted"); assert.equal(d.node.recommended.bn, 9);
  assert.deepEqual(d.attention, [READY_FLAG, orderExhaustedFlag(d.node.recommended)]);
});
test("owner-decision matchers: server OWNER_DECISION and the dashboard KPI treat the all-met flag like READY", () => {
  assert.ok(OWNER_DECISION.some((re) => re.test(ALL_MET_FLAG)));
  assert.ok(!OWNER_DECISION.some((re) => re.test("destroy blocked: no backup ack")));
  const input = (node, flags) => ({ latest, ring, ramStatus, augPlan: { ...augPlan, node }, autopilot: { ...autopilot, flags }, pred2Tail, settings: S({ "node.autoDestroy": true }), now: NOW });
  const k = computeKpis(input({ ...augPlan.node, autoDestroy: true, source: "all-targets-met" }, [READY_FLAG, ALL_MET_FLAG]));
  assert.equal(k.kpis.destroy.display, "READY · every target met"); assert.equal(k.kpis.destroy.status, "warn");
  const a = k.attention.find((x) => x.text === ALL_MET_FLAG);
  assert.ok(a); assert.equal(a.level, "warn"); assert.equal(a.view, "node");
});

// ---------------- 6. early warning ----------------
const SEL = { "node.autoSelect": true };
const W = (bn, sf, o = {}) => orderWarning({ bn, sourceFiles: toSf(sf) }, S({ ...SEL, ...o }));
const sfs = (o) => Array.from({ length: 15 }, (_, i) => o[i + 1] ?? 0);
test("early warning fires at 2 or fewer destroys left in node.order, not at 3 (levels counted after the destroy in progress)", () => {
  assert.equal(ORDER_LOW_AT, 2); assert.equal(ORDER_LOW, "node.order running low");
  const o = { "node.order": [7] };
  assert.equal(W(5, sfs({}), o), null, "3 left");
  for (const [sf7, left] of [[1, 2], [2, 1], [3, 0]]) {
    const w = W(5, sfs({ 7: sf7 }), o);
    assert.ok(w, `SF7 ${sf7}`); assert.ok(w.startsWith(`${ORDER_LOW} (${left} left: ${left ? `BN7 x${left}` : "none"})`), w);
  }
  // the destroy in progress counts: in BN7 with SF7 0 the destroy takes it to 1, so 2 are left
  assert.match(W(7, sfs({}), o), /\(2 left: BN7 x2\)/);
  assert.equal(W(7, sfs({}), { "node.order": [7, 6] }), null, "BN6 x3 + BN7 x2 left = 5");
  // the live order at the start of its walk is far from the threshold
  assert.equal(W(2, sfs({ 2: 2 }), { "node.order": LIVE }), null);
  assert.match(W(7, sfs({ 2: 3, 3: 3, 11: 3, 6: 3, 7: 0 }), { "node.order": LIVE }), /\(2 left: BN7 x2\)/);
  assert.match(W(6, sfs({ 2: 3, 3: 3, 11: 3, 6: 2, 7: 1 }), { "node.order": LIVE }), /\(2 left: BN7 x2\)/);
});
test("early warning: what is left, in node.order's own order, each BitNode once; targets and invalid entries are respected", () => {
  const w = W(5, sfs({ 3: 2, 6: 2 }), { "node.order": [6, 3, 6, 99, 0, 1.5, 7], "node.targets": { 7: 0 } });
  assert.match(w, /\(2 left: BN6 x1, BN3 x1\)/, w);
  assert.equal(W(5, sfs({}), { "node.order": [12], "node.targets": { 12: 1000 } }), null, "BN12 with a big explicit target never runs low");
  assert.match(W(5, sfs({ 12: 4 }), { "node.order": [12], "node.targets": { 12: 5 } }), /\(1 left: BN12 x1\)/);
  assert.match(W(5, sfs({}), { "node.order": [12] }), /\(0 left: none\)/, "BN12 at its default target 0 has nothing left");
  const o = orderOutlook({ bn: 5, sourceFiles: toSf(sfs({ 6: 2 })) }, S({ "node.order": [6, 6] }));
  assert.deepEqual(o.left, [{ bn: 6, levels: 1 }]); assert.equal(o.remaining, 1);
});
test("early warning: only with node.autoSelect on; an empty order warns only with node.fallback=stop", () => {
  assert.equal(orderWarning({ bn: 5, sourceFiles: [] }, S({ "node.order": [7], "node.targets": { 7: 0 } })), null, "autoSelect off");
  assert.equal(W(5, sfs({}), {}), null, "empty order, recommend: the planner is in charge by design");
  const stop = W(5, sfs({}), { "node.fallback": "stop" });
  assert.ok(stop.startsWith(`${ORDER_LOW} (empty) — node.fallback=stop will then stop and flag the owner`), stop);
});
test("early warning names the planner recommendation that takes over, per node.fallback (and every-target-met when nothing is left)", () => {
  const sf = sfs({ 2: 3, 3: 3, 11: 3, 6: 3, 7: 2 });
  const rec = W(5, sf, { "node.order": LIVE }), stop = W(5, sf, { "node.order": LIVE, "node.fallback": "stop" });
  assert.match(rec, /^node\.order running low \(1 left: BN7 x1\) — then the planner's recommendation takes over: BN1: /, rec);
  assert.match(stop, /^node\.order running low \(1 left: BN7 x1\) — node\.fallback=stop will then stop and flag the owner; the planner would recommend BN1: /, stop);
  assert.doesNotMatch(rec + stop, /BN1: BN1|BNnull|undefined/);
  // the recommendation is the one after the order is used up: BN1/4/5/10/9 are maxed, so BN8 comes next, not BN1
  const sf2 = sfs({ 1: 3, 4: 3, 5: 3, 10: 3, 9: 3, 2: 3, 3: 3, 11: 3, 6: 3, 7: 2 });
  assert.match(W(5, sf2, { "node.order": LIVE }), /takes over: BN8: /);
  // BN12 is not recommended by default, but is with an explicit target
  assert.match(W(5, sf2, { "node.order": LIVE, "node.targets": { 12: 4 } }), /takes over: BN12: /);
  // nothing left to recommend either
  const all = sfs({ 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 2, 8: 3, 9: 3, 10: 3, 11: 3, 13: 3, 14: 3, 15: 3 });
  assert.equal(W(5, all, { "node.order": LIVE }), `${ORDER_LOW} (1 left: BN7 x1) — then the planner's recommendation takes over: ${ALL_MET}, nothing left to select`);
  assert.match(W(5, all, { "node.order": LIVE, "node.fallback": "stop" }), /stop and flag the owner; every BitNode target is met$/);
});
test("early warning text is stable (dedupes like READY) and only changes when Source-File levels change", () => {
  const a = W(5, sfs({ 7: 2 }), { "node.order": [7] });
  for (let i = 0; i < 3; i++) assert.equal(W(5, sfs({ 7: 2 }), { "node.order": [7] }), a);
  assert.notEqual(W(5, sfs({ 7: 3 }), { "node.order": [7] }), a);
  assert.equal(W(5, sfs({ 7: 2 }), { "node.order": [7] }), a, "does not depend on the current time or on READY");
});
test("early warning is an owner decision: server OWNER_DECISION and the dashboard attention level treat it like READY", () => {
  const w = W(5, sfs({ 7: 2 }), { "node.order": [7] });
  assert.ok(OWNER_DECISION.some((re) => re.test(w)));
  assert.ok(!OWNER_DECISION.some((re) => re.test("node.order is fine")));
  const k = computeKpis({ latest, ring, ramStatus, augPlan, autopilot: { ...autopilot, flags: [w] }, pred2Tail, settings: S(), now: NOW });
  const a = k.attention.find((x) => x.text === w);
  assert.ok(a); assert.equal(a.level, "warn"); assert.equal(a.view, "node");
});
test("autopilot wiring: nodeOrderStep pushes the warning into flags (the check-in attention path); the loop calls it", async () => {
  const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "game", "agent", "autopilot.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbnt-")), tmp = path.join(dir, "autopilot.mjs");
  fs.copyFileSync(src, tmp);
  let ap; try { ap = await import(pathToFileURL(tmp).href); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const flags = [], ri = (n, sf) => ({ currentNode: n, ownedSF: new Map(Object.entries(sf).map(([k, v]) => [Number(k), v])) });
  assert.equal(ap.nodeOrderStep(ri(5, {}), S({ ...SEL, "node.order": [7] }), flags), null); assert.deepEqual(flags, []);
  const w = ap.nodeOrderStep(ri(5, { 7: 2 }), S({ ...SEL, "node.order": [7] }), flags);
  assert.deepEqual(flags, [w]); assert.match(w, /^node\.order running low \(1 left: BN7 x1\)/);
  assert.equal(ap.nodeOrderStep({ currentNode: 5 }, S({ ...SEL, "node.fallback": "stop" }), flags) != null, true, "no ownedSF is tolerated");
  const text = fs.readFileSync(src, "utf8");
  assert.match(text, /nodeOrderStep\(ns\.getResetInfo\(\), readSettings\(ns\), flags\)/, "the main loop calls the step");
});

// ---------------- runner ----------------
let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} node-targets test(s) failed`); process.exit(1); }
console.log(`node-targets: ${tests.length} passed`);
