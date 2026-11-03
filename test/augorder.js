// lib/augorder.js: golden equivalence with the pre-feature orders (planner ownerOrder, autopilot place()), then the feature:
// pinned / last / exclude / precedence / recursive prerequisites / blocked / cycles / unknown names / sorts / projectedCost,
// strict-mode state machine, catalog helpers.
import assert from "node:assert/strict";
import { importGame } from "./helpers/game-import.js";
import { BN5, clone, fresh } from "./helpers/aug-cases.js";

const O = await importGame("lib/augorder.js");
const { orderAugs, projectedCost, DEFAULT_ORDER_CFG: DEF, cfgFromSettings, isDefaultCfg } = O;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const fin = (n, d = 0) => (typeof n === "number" && Number.isFinite(n) ? n : d);

// ── the pre-feature algorithms, copied verbatim (do not "improve" these: they are the golden reference) ──
/** lib/augplan.js ownerOrder as of 5430129 (planner: ties by name, depth cap 10) */
function legacyOwnerOrder(names, augs, have = new Set()) {
  const set = new Set(names), order = [];
  const sorted = [...set].sort((a, b) => fin(augs[b]?.repReq) - fin(augs[a]?.repReq) || a.localeCompare(b));
  const place = (a, depth = 0) => {
    if (depth > 10 || have.has(a) || order.includes(a)) return;
    for (const p of augs[a]?.prereqs || []) if (!have.has(p) && set.has(p)) place(p, depth + 1);
    order.push(a);
  };
  for (const a of sorted) place(a);
  return order;
}
/** agent/autopilot.js buyBatch ordering as of 5430129 (ties in discovery order, depth cap 5, only candidates as prereqs).
 * `cands` = [{a, f, rr}] in discovery order (possibly with duplicates, as when two factions sell the same aug). */
function legacyAutopilotOrder(cands, prereqOf, have = new Set()) {
  const uniq = [...new Map(cands.map((x) => [x.a, x])).values()].sort((x, y) => y.rr - x.rr);
  const byName = new Map(uniq.map((x) => [x.a, x]));
  const order = [];
  const place = (x, depth = 0) => {
    if (depth > 5 || have.has(x.a) || order.includes(x)) return;
    for (const p of prereqOf(x.a)) if (!have.has(p) && byName.has(p)) place(byName.get(p), depth + 1);
    order.push(x);
  };
  for (const x of uniq) place(x);
  return order.map((x) => x.a);
}

/** Candidate list the way buyBatch builds it from a snapshot: joined factions in order, each faction's augs, rep-met, unowned. */
function discover(snap, have, rep) {
  const out = [];
  for (const [f, fi] of Object.entries(snap.factions)) {
    if (!fi.joined) continue;
    for (const a of fi.augs) if (!have.has(a) && !a.startsWith("NeuroFlux") && snap.augs[a].repReq <= rep(f)) out.push({ a, f, rr: snap.augs[a].repReq });
  }
  return out;
}
const prereqsOf = (snap) => (a) => snap.augs[a]?.prereqs || [];

// deterministic PRNG for the fuzz cases
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
/** Random acyclic catalog with many equal repReq (tie-heavy) and prerequisite chains < 5 deep. */
function synthetic(seed, n = 40) {
  const r = rng(seed), names = Array.from({ length: n }, (_, i) => `Aug ${String.fromCharCode(65 + (i * 7) % 26)}${i}`);
  const augs = {}, depthOf = {};
  names.forEach((a, i) => {
    const prereqs = [];
    for (let k = 0; k < 2; k++) if (i > 0 && r() < 0.35) { const p = names[Math.floor(r() * i)]; if (!prereqs.includes(p) && (depthOf[p] ?? 0) < 3) prereqs.push(p); }
    depthOf[a] = prereqs.length ? 1 + Math.max(...prereqs.map((p) => depthOf[p] ?? 0)) : 0;
    augs[a] = { repReq: [1e3, 1e3, 5e3, 5e3, 2e4][Math.floor(r() * 5)], price: Math.round(1e6 * (1 + r() * 9)), prereqs };
  });
  // flatten to transitive prerequisites like the real game data, then check chain depth
  const trans = (a, seen = new Set()) => { for (const p of augs[a].prereqs) if (!seen.has(p)) { seen.add(p); trans(p, seen); } return seen; };
  for (const a of names) augs[a].prereqs = [...trans(a)];
  return { names, augs };
}
const chainDepth = (augs) => { const d = (a, seen = new Set()) => { const p = (augs[a]?.prereqs || []).filter((x) => !seen.has(x)); return p.length ? 1 + Math.max(...p.map((x) => d(x, new Set([...seen, a])))) : 0; }; return Math.max(0, ...Object.keys(augs).map((a) => d(a))); };

// ── golden ────────────────────────────────────────────────────────────────
test("golden: the real catalog's prerequisite chains are shorter than the autopilot's depth cap (5)", () => {
  assert.ok(chainDepth(BN5.augs) < 5, `max chain depth ${chainDepth(BN5.augs)}`);
});
test("golden: tie 'name' equals legacy ownerOrder on the real catalog (all augs, subsets, with owned prereqs)", () => {
  const all = Object.keys(BN5.augs).filter((a) => !a.startsWith("NeuroFlux"));
  const r = rng(7);
  const subsets = [all, all.filter((_, i) => i % 2), all.filter((_, i) => i % 3 === 0), all.slice(0, 15), []];
  for (let k = 0; k < 20; k++) subsets.push(all.filter(() => r() < 0.5));
  for (const names of subsets) for (const have of [new Set(), new Set(all.filter((_, i) => i % 5 === 0))]) {
    assert.deepEqual(orderAugs(names, DEF, BN5.augs, have, { tie: "name" }).order, legacyOwnerOrder(names, BN5.augs, have));
  }
});
test("golden: tie 'input' equals the legacy autopilot order on the real catalog at several rep levels", () => {
  for (const rep of [1e3, 2e4, 5e4, 2e5, 1e6, 1e9]) for (const have of [new Set(), new Set(Object.keys(BN5.augs).filter((_, i) => i % 4 === 0))]) {
    const cands = discover(BN5, have, () => rep);
    const names = [...new Map(cands.map((x) => [x.a, x])).values()].map((x) => x.a); // discovery order, de-duplicated
    const got = orderAugs(names, DEF, BN5.augs, have, { tie: "input" }).order;
    assert.deepEqual(got, legacyAutopilotOrder(cands, prereqsOf(BN5), have), `rep ${rep}`);
  }
});
test("golden: per-faction rep (only some factions rep-met) and duplicate sellers keep discovery order", () => {
  const rep = (f) => ({ CyberSec: 1e6, NiteSec: 1e3, "The Black Hand": 3e4, BitRunners: 5e5 }[f] ?? 0);
  const cands = discover(BN5, new Set(), rep);
  assert.ok(cands.length > 10);
  const names = [...new Map(cands.map((x) => [x.a, x])).values()].map((x) => x.a);
  assert.deepEqual(orderAugs(names, DEF, BN5.augs, new Set(), { tie: "input" }).order, legacyAutopilotOrder(cands, prereqsOf(BN5)));
});
test("golden: tie-heavy synthetic catalogs (seeded) match both legacy orders", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const { names, augs } = synthetic(seed);
    assert.ok(chainDepth(augs) < 5, `seed ${seed} depth`);
    const have = new Set(names.filter((_, i) => i % 9 === 0));
    const rs = rng(seed * 31), shuffled = [...names];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rs() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    assert.deepEqual(orderAugs(shuffled, DEF, augs, have, { tie: "name" }).order, legacyOwnerOrder(shuffled, augs, have), `planner seed ${seed}`);
    const cands = shuffled.map((a) => ({ a, f: "F", rr: augs[a].repReq }));
    assert.deepEqual(orderAugs(shuffled, DEF, augs, have, { tie: "input" }).order, legacyAutopilotOrder(cands, (a) => augs[a].prereqs, have), `autopilot seed ${seed}`);
  }
});
test("golden: default cfg given as settings objects (cfgFromSettings of {}) is the default", () => {
  assert.equal(isDefaultCfg(cfgFromSettings({})), true);
  assert.equal(isDefaultCfg(cfgFromSettings({ "augs.order.sort": "price" })), false);
  assert.equal(isDefaultCfg(cfgFromSettings({ "augs.order.strict": true })), false);
  assert.equal(isDefaultCfg(cfgFromSettings({ "augs.order.pinned": ["A"] })), false);
  const names = Object.keys(BN5.augs).filter((a) => !a.startsWith("NeuroFlux"));
  assert.deepEqual(orderAugs(names, cfgFromSettings({}), BN5.augs, new Set()).order, orderAugs(names, DEF, BN5.augs, new Set()).order);
});

// ── features ──────────────────────────────────────────────────────────────
const mini = {
  A: { repReq: 100, price: 10, prereqs: [] }, B: { repReq: 500, price: 50, prereqs: ["C"] }, C: { repReq: 50, price: 5, prereqs: [] },
  D: { repReq: 300, price: 30, prereqs: [] }, E: { repReq: 300, price: 20, prereqs: [] },
};
const names5 = ["A", "B", "C", "D", "E"];
test("default order: highest rep first, prerequisite immediately before, ties by name", () => {
  assert.deepEqual(orderAugs(names5, DEF, mini, new Set()).order, ["C", "B", "D", "E", "A"]);
});
test("pinned: bought first in list order; unknown pinned names are ignored and warned; a pinned name outside the batch is skipped", () => {
  const r = orderAugs(names5, { pinned: ["A", "Z", "E"] }, mini, new Set());
  assert.deepEqual(r.order, ["A", "E", "C", "B", "D"]);
  assert.deepEqual(r.warnings, ["unknown aug in pinned: Z"]);
  assert.equal(r.tags.A, "pinned"); assert.equal(r.tags.C, "prereq"); assert.equal(r.tags.D, "auto");
  assert.deepEqual(orderAugs(["B", "D"], { pinned: ["A"] }, mini, new Set()).order, ["B", "D"], "pinned A is not in the batch");
});
test("pinned aug with a prerequisite: the prerequisite goes right before it, even when the prerequisite is 'last'", () => {
  const r = orderAugs(names5, { pinned: ["B"], last: ["C"] }, mini, new Set());
  assert.deepEqual(r.order.slice(0, 2), ["C", "B"]);
  assert.equal(r.tags.C, "prereq");
});
test("last: after everything else, in list order, before NeuroFlux (which is never passed in)", () => {
  assert.deepEqual(orderAugs(names5, { last: ["B", "D"] }, mini, new Set()).order, ["E", "A", "C", "B", "D"]);
});
test("precedence: exclude > pinned > last, with a warning", () => {
  const r = orderAugs(names5, { pinned: ["A", "D"], last: ["A", "E"], exclude: ["D"] }, mini, new Set());
  assert.deepEqual(r.excluded, ["D"]);
  assert.ok(!r.order.includes("D"));
  assert.equal(r.order[0], "A"); assert.equal(r.order.at(-1), "E");
  assert.ok(r.warnings.includes("D is in exclude and pinned: exclude wins"));
  assert.ok(r.warnings.includes("A is in pinned and last: pinned wins"));
});
test("exclude: removed from the order and reported; excluding an owned/absent aug is a no-op", () => {
  const r = orderAugs(names5, { exclude: ["E", "Q"] }, mini, new Set());
  assert.deepEqual(r.order, ["C", "B", "D", "A"]); assert.deepEqual(r.excluded, ["E"]);
  assert.deepEqual(r.warnings, ["unknown aug in exclude: Q"]);
});
test("blocked: an aug whose unowned prerequisite is excluded is dropped and reported; owned prerequisite does not block", () => {
  const r = orderAugs(names5, { exclude: ["C"] }, mini, new Set());
  assert.deepEqual(r.order, ["D", "E", "A"]);
  assert.deepEqual(r.blocked, [{ aug: "B", by: "C" }]);
  assert.deepEqual(r.warnings, ["B blocked: prerequisite C excluded"]);
  const r2 = orderAugs(["B", "D", "E", "A"], { exclude: ["C"] }, mini, new Set(["C"]));
  assert.deepEqual(r2.blocked, []); assert.ok(r2.order.includes("B"));
});
test("blocked applies to pinned augs too and cascades through dependents", () => {
  const info = { X: { repReq: 1, prereqs: [] }, Y: { repReq: 2, prereqs: ["X"] }, Z: { repReq: 3, prereqs: ["Y", "X"] } };
  const r = orderAugs(["Y", "Z"], { pinned: ["Z"], exclude: ["X"] }, info, new Set());
  assert.deepEqual(r.order, []); assert.deepEqual(r.blocked.map((b) => b.aug).sort(), ["Y", "Z"]);
});
test("a prerequisite that is not in the batch keeps the aug (the caller's 'prereq missing' skip handles it)", () => {
  const r = orderAugs(["B"], DEF, mini, new Set());
  assert.deepEqual(r.order, ["B"]); assert.deepEqual(r.blocked, []);
});
test("Gen I before Gen II regression (the 2026-09-27 bug): Gen II never precedes Gen I under any sort or pin", () => {
  const info = { "Gen I": { repReq: 10, price: 1e6, prereqs: [] }, "Gen II": { repReq: 99, price: 2e6, prereqs: ["Gen I"] }, Other: { repReq: 50, price: 3e6, prereqs: [] } };
  for (const sort of ["rep", "price", "cheap", "name"]) for (const cfg of [{ sort }, { sort, pinned: ["Gen II"] }, { sort, last: ["Gen I"] }, { sort, pinned: ["Other"], last: ["Gen I"] }]) {
    const o = orderAugs(["Gen II", "Gen I", "Other"], cfg, info, new Set()).order;
    assert.ok(o.indexOf("Gen I") < o.indexOf("Gen II"), `${JSON.stringify(cfg)} -> ${o}`);
    assert.deepEqual([...o].sort(), ["Gen I", "Gen II", "Other"]);
  }
});
test("cycles and depth: a prerequisite cycle terminates and places each aug once; a 15-deep chain is placed without recursion errors", () => {
  const cyc = { P: { repReq: 1, prereqs: ["Q"] }, Q: { repReq: 2, prereqs: ["P"] } };
  const r = orderAugs(["P", "Q"], DEF, cyc, new Set());
  assert.deepEqual([...r.order].sort(), ["P", "Q"]);
  const chain = {}; const ns = Array.from({ length: 15 }, (_, i) => `N${i}`);
  ns.forEach((n, i) => { chain[n] = { repReq: i, prereqs: i ? [ns[i - 1]] : [] }; });
  const o = orderAugs(ns, DEF, chain, new Set()).order;
  assert.equal(o.length, 15); assert.equal(new Set(o).size, 15);
  assert.deepEqual(orderAugs(["A", "A", "A"], DEF, mini, new Set()).order, ["A"], "duplicates in names");
});
test("sorts: rep (default), price (most expensive first), cheap, name; prerequisites still first", () => {
  assert.deepEqual(orderAugs(["A", "D", "E"], { sort: "price" }, mini, new Set()).order, ["D", "E", "A"]);
  assert.deepEqual(orderAugs(["A", "D", "E"], { sort: "cheap" }, mini, new Set()).order, ["A", "E", "D"]);
  assert.deepEqual(orderAugs(["E", "D", "A"], { sort: "name" }, mini, new Set()).order, ["A", "D", "E"]);
  assert.deepEqual(orderAugs(names5, { sort: "price" }, mini, new Set()).order, ["C", "B", "D", "E", "A"], "B (50) pulls C (5) in front of itself");
  assert.deepEqual(orderAugs(names5, { sort: "bogus" }, mini, new Set()).order, orderAugs(names5, DEF, mini, new Set()).order, "unknown sort = default");
});
test("tie 'input' keeps the order of names inside equal keys; tie 'name' sorts them", () => {
  const info = { Z: { repReq: 1 }, M: { repReq: 1 }, A: { repReq: 1 } };
  assert.deepEqual(orderAugs(["Z", "M", "A"], DEF, info, new Set(), { tie: "input" }).order, ["Z", "M", "A"]);
  assert.deepEqual(orderAugs(["Z", "M", "A"], DEF, info, new Set(), { tie: "name" }).order, ["A", "M", "Z"]);
});
test("price sort minimises the total under the ramp (and projectedCost is the sequence sum)", () => {
  const info = { a: { price: 1 }, b: { price: 10 }, c: { price: 100 } };
  assert.equal(projectedCost(["a", "b", "c"], info, 2), 1 + 20 + 400);
  assert.equal(projectedCost([], info, 2), 0);
  assert.equal(projectedCost(["zz"], info, 2), 0);
  const exp = orderAugs(["a", "b", "c"], { sort: "price" }, info, new Set()).order;
  assert.deepEqual(exp, ["c", "b", "a"]);
  assert.ok(projectedCost(exp, info, 1.9) < projectedCost(["a", "b", "c"], info, 1.9));
});
test("orderAugs does not mutate its inputs", () => {
  const cfg = { sort: "price", pinned: ["A"], last: ["D"], exclude: ["E"] }, c0 = JSON.stringify(cfg), n = [...names5], i0 = JSON.stringify(mini);
  orderAugs(n, cfg, mini, new Set());
  assert.equal(JSON.stringify(cfg), c0); assert.deepEqual(n, names5); assert.equal(JSON.stringify(mini), i0);
});
test("cfgFromSettings tolerates garbage", () => {
  const c = cfgFromSettings({ "augs.order.sort": 7, "augs.order.pinned": "x", "augs.order.last": [1, "A"], "augs.order.strictMaxWaitMin": "no" });
  assert.deepEqual(c, { sort: "rep", pinned: [], last: ["A"], exclude: [], strict: false, strictMaxWaitMin: 120, drivesWork: false });
});

// ── pinnedBlocker / strictDecision ────────────────────────────────────────
const ctxOf = (sellersMap, o = {}) => ({ pinned: ["P1", "P2"], exclude: [], owned: new Set(), gangFaction: "Gang", sellers: (a) => sellersMap[a] || [], ...o });
test("pinnedBlocker: first pinned aug that is unowned, sold by a joined non-gang faction and not rep-met", () => {
  const m = { P1: [{ faction: "F1", rep: 10, repReq: 100 }], P2: [{ faction: "F2", rep: 0, repReq: 50 }] };
  assert.deepEqual(O.pinnedBlocker(ctxOf(m)), { aug: "P1", faction: "F1", gap: 90 });
  assert.equal(O.pinnedBlocker(ctxOf(m, { owned: new Set(["P1"]) })).aug, "P2");
  assert.equal(O.pinnedBlocker(ctxOf(m, { exclude: ["P1"] })).aug, "P2");
  assert.equal(O.pinnedBlocker(ctxOf(m, { skip: new Set(["P1"]) })).aug, "P2");
  assert.equal(O.pinnedBlocker(ctxOf({ P1: [{ faction: "F1", rep: 100, repReq: 100 }], P2: m.P2 })).aug, "P2", "rep-met is not a blocker");
  assert.equal(O.pinnedBlocker(ctxOf({ P1: [{ faction: "F1", rep: 1, repReq: 100 }, { faction: "F9", rep: 100, repReq: 100 }], P2: [] })), null, "met in any seller");
  assert.equal(O.pinnedBlocker(ctxOf({})), null, "not sold by a joined faction: not a blocker");
});
test("pinnedBlocker: the gang faction is ignored (its rep cannot be worked)", () => {
  const m = { P1: [{ faction: "Gang", rep: 0, repReq: 1e6 }], P2: [] };
  assert.equal(O.pinnedBlocker(ctxOf(m)), null);
  assert.equal(O.pinnedBlocker(ctxOf(m, { gangFaction: null })).aug, "P1", "no gang: it is a normal faction");
  const both = { P1: [{ faction: "Gang", rep: 0, repReq: 1e6 }, { faction: "F1", rep: 0, repReq: 5e6 }] };
  assert.equal(O.pinnedBlocker(ctxOf(both)).faction, "F1");
});
test("strictDecision: holds, audits strictHold once, times out after the cap (strictTimeout once), then moves to the next pinned aug", () => {
  const m = { P1: [{ faction: "F1", rep: 0, repReq: 100 }], P2: [{ faction: "F2", rep: 0, repReq: 100 }] };
  const ctx = ctxOf(m), min = 60000, cap = 120;
  let st = O.emptyStrictState(111);
  let r = O.strictDecision(st, ctx, 0, cap);
  assert.equal(r.hold, true); assert.equal(r.blocker.aug, "P1");
  assert.deepEqual(r.events.map((e) => e.kind), ["strictHold"]); assert.equal(r.events[0].data.blocker, "P1");
  st = r.state;
  r = O.strictDecision(st, ctx, 60 * min, cap);
  assert.equal(r.hold, true); assert.deepEqual(r.events, [], "no repeat audit");
  assert.equal(r.waitedMin, 60);
  r = O.strictDecision(st, ctx, 120 * min, cap);
  assert.deepEqual(r.events.map((e) => e.kind), ["strictTimeout", "strictHold"], "P1 times out, P2 starts its own timer");
  assert.equal(r.hold, true); assert.equal(r.blocker.aug, "P2"); assert.deepEqual(r.state.timedOut, ["P1"]);
  st = r.state;
  r = O.strictDecision(st, ctx, 241 * min, cap);
  assert.equal(r.hold, false); assert.deepEqual(r.events.map((e) => e.kind), ["strictTimeout"]); assert.deepEqual(r.state.timedOut, ["P1", "P2"]);
  r = O.strictDecision(r.state, ctx, 300 * min, cap);
  assert.equal(r.hold, false); assert.deepEqual(r.events, [], "timeouts are not re-audited");
});
test("strictDecision: cap 0 times out at once; a blocker that becomes rep-met releases the hold", () => {
  const m = { P1: [{ faction: "F1", rep: 0, repReq: 100 }] };
  let r = O.strictDecision(O.emptyStrictState(1), ctxOf(m), 5, 0);
  assert.equal(r.hold, false); assert.deepEqual(r.events.map((e) => e.kind), ["strictTimeout"]);
  r = O.strictDecision(O.emptyStrictState(1), ctxOf(m), 5, 10);
  assert.equal(r.hold, true);
  r = O.strictDecision(r.state, ctxOf({ P1: [{ faction: "F1", rep: 100, repReq: 100 }] }), 6, 10);
  assert.equal(r.hold, false); assert.deepEqual(r.events, []);
});
test("parseStrictState: another install cycle (reset differs), corrupt and malformed files all start fresh", () => {
  const good = JSON.stringify({ reset: 5, first: { P1: 7 }, timedOut: ["P0"] });
  assert.deepEqual(O.parseStrictState(good, 5), { reset: 5, first: { P1: 7 }, timedOut: ["P0"] });
  assert.deepEqual(O.parseStrictState(good, 6), O.emptyStrictState(6));
  for (const bad of ["", "{", "null", "[]", JSON.stringify({ reset: 5 }), JSON.stringify({ reset: 5, first: {}, timedOut: "x" })]) assert.deepEqual(O.parseStrictState(bad, 5), O.emptyStrictState(5), bad);
});

// ── catalog ───────────────────────────────────────────────────────────────
test("buildCatalog: one entry per aug with factions, prices, prerequisites and owned/installed flags; sameCatalog ignores t", () => {
  const snap = fresh(); snap.installed = ["Neuralstimulator"]; snap.owned = ["Neuralstimulator", "BitWire"];
  const cat = O.buildCatalog(snap);
  assert.equal(cat.augs.length, Object.keys(snap.augs).length);
  const byName = Object.fromEntries(cat.augs.map((a) => [a.name, a]));
  assert.deepEqual(Object.keys(byName.BitWire).sort(), ["factions", "installed", "name", "owned", "prereqs", "price", "repReq"]);
  assert.equal(byName.BitWire.owned, true); assert.equal(byName.BitWire.installed, false);
  assert.equal(byName.Neuralstimulator.installed, true);
  assert.ok(byName.BitWire.factions.length >= 1 && byName.BitWire.factions.every((f) => typeof f.f === "string" && typeof f.joined === "boolean"));
  assert.deepEqual(cat.augs.map((a) => a.name), [...cat.augs.map((a) => a.name)].sort(), "stable order");
  assert.equal(O.sameCatalog(JSON.stringify({ t: 1, ...cat }), { t: 2, ...cat }), true);
  const changed = clone(cat); changed.augs[0].price += 1;
  assert.equal(O.sameCatalog(JSON.stringify({ t: 1, ...cat }), changed), false);
  assert.equal(O.sameCatalog("", cat), false); assert.equal(O.sameCatalog("not json", cat), false);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} augorder test(s) failed`); process.exit(1); }
console.log(`augorder: ${tests.length} passed`);
