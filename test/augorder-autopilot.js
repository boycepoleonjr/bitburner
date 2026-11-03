// agent/autopilot.js with augs.order.*: default buy sequence equals the legacy order, pinned / last / exclude / strict /
// drivesWork / fallback / NeuroFlux-last / leftover cash / one settings read per batch. Fake singularity, no live game.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { importGame, GAME } from "./helpers/game-import.js";
import { settingsFile } from "./helpers/fake-gang.js";
import { BN5, clone } from "./helpers/aug-cases.js";

const AP = await importGame("agent/autopilot.js");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const NFG = "NeuroFlux Governor";
const MIN = 60000;

/**
 * Runs the autopilot for `loops` loops against a fake game.
 * world: { factions: {F: {rep, augs:[...]}}, augs: {name: {repReq, price, prereqs}}, owned: [], money }
 */
async function run({ world, settings = {}, cfg = {}, files = {}, loops = 1, step = 30000, lastAugReset = 1, gangFaction = null, work = null, flakyPrice = false, homeRamCost = Infinity, startClock = Date.UTC(2026, 10, 2, 12) } = {}) {
  const F = { ...files };
  F["data/autopilot-config.txt"] = JSON.stringify({ work: "keep", programs: false, homeRam: !!isFinite(homeRamCost), homeCores: false, backdoors: false, joinFactions: false, donate: false, ...cfg });
  F["data/settings.txt"] = settingsFile({ "augs.installAt": 2, ...settings });
  if (gangFaction) F["data/gang-status.txt"] = JSON.stringify({ inGang: true, faction: gangFaction, t: startClock, phase: "grow" });
  const st = { money: world.money, queued: [], installed: false, calls: [], purchases: [], worked: [], settingsReads: [], throwPrice: flakyPrice, ramBought: 0, clock: startClock };
  const installedAugs = new Set(world.owned || []);
  const mult = () => 1.9 ** st.queued.length;
  const price = (a) => { if (st.throwPrice && st.inInfo) { st.throwPrice = false; throw new Error("boom"); } return world.augs[a].price * mult(); };
  const Sg = {
    hasTorRouter: () => true, checkFactionInvitations: () => [], getOwnedAugmentations: (q) => [...installedAugs, ...(q ? st.queued : [])],
    getAugmentationsFromFaction: (f) => world.factions[f].augs, getFactionRep: (f) => world.factions[f].rep, getAugmentationRepReq: (a) => world.augs[a].repReq,
    getAugmentationPrice: (a) => { st.inInfo = new Error().stack.includes("orderCands"); return price(a); }, getAugmentationPrereq: (a) => world.augs[a].prereqs || [],
    getFactionFavor: () => 0, getCurrentWork: () => work, workForFaction: (f, t) => { st.worked.push(f); return true; }, donateToFaction: () => false,
    getUpgradeHomeRamCost: () => (st.ramBought < 3 ? homeRamCost : Infinity), getUpgradeHomeCoresCost: () => Infinity,
    upgradeHomeRam: () => { if (st.money < homeRamCost) return false; st.money -= homeRamCost; st.ramBought++; st.purchases.push("home RAM"); return true; },
    joinFaction: () => true,
    purchaseAugmentation: (f, a) => { const p = price(a); if (st.money < p) return false; st.money -= p; st.queued.push(a); st.purchases.push(a); return true; },
    installAugmentations: () => { st.installed = true; },
  };
  const read = (f) => { const k = f.replace(/^\//, ""); if (k === "data/settings.txt") st.settingsReads.push(st.marks ?? 0); if (k === "data/config-overrides.txt") st.marks = (st.marks ?? 0) + 1; return F[k] ?? ""; };
  let n = 0;
  const ns = {
    singularity: Sg, args: [], disableLog() {}, read, write: (f, d, m) => { const k = f.replace(/^\//, ""); F[k] = m === "w" ? String(d) : (F[k] ?? "") + String(d); },
    getHackingLevel: () => 100, getPlayer: () => ({ factions: Object.keys(world.factions), mults: { faction_rep: 1 }, exp: { hacking: 1 } }),
    getResetInfo: () => ({ currentNode: 10, ownedSF: new Map(), lastAugReset }), heart: { break: () => 0 }, gang: { inGang: () => !!gangFaction },
    isRunning: () => true, run: () => 7, fileExists: () => true, getServerMoneyAvailable: () => st.money, getFavorToDonate: () => 150, serverExists: () => false,
    getServerMaxRam: () => 1024, getServerUsedRam: () => 0, getScriptRam: () => 4, getMoneySources: () => ({ sinceInstall: {} }), format: { number: (x) => String(x) },
    getServer: () => ({ cpuCores: 1 }), getServerRequiredHackingLevel: () => 1, hasRootAccess: () => false, scan: () => [],
    sleep: async (ms) => { st.clock += step; if (++n >= loops) throw new Error("STOP"); },
  };
  const realNow = Date.now; Date.now = () => st.clock;
  try { await AP.main(ns); } catch (e) { if (!/STOP/.test(String(e))) throw e; } finally { Date.now = realNow; }
  const audit = (F["data/audit.txt"] || "").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const status = F["data/autopilot-status.txt"] ? JSON.parse(F["data/autopilot-status.txt"]) : null;
  return { st, F, audit, status, bought: st.purchases.filter((p) => p !== "home RAM"), events: F["data/events.txt"] || "", liquidate: (() => { try { return JSON.parse(F["data/config-overrides.txt"]).stocks.liquidate; } catch { return undefined; } })() };
}
const LIQ = { "data/config-overrides.txt": JSON.stringify({ stocks: { liquidate: true } }) }; // install trigger already liquidated stocks: buyBatch runs this loop
const mk = (list, o = {}) => { // list: [name, repReq, price, prereqs?, faction?]
  const augs = {}, factions = {};
  for (const [name, repReq, price, prereqs = [], f = "F1"] of list) { augs[name] = { repReq, price, prereqs }; (factions[f] ||= { rep: 1e9, augs: [] }).augs.push(name); }
  for (const [f, v] of Object.entries(o.factions || {})) factions[f] = { ...(factions[f] || { augs: [] }), ...v };
  return { augs, factions, money: o.money ?? 1e15, owned: o.owned || [] };
};
const W = () => mk([["Aa", 100, 1e6], ["Bb", 900, 1e6, ["Cc"]], ["Cc", 50, 1e6], ["Dd", 500, 1e6], ["Ee", 500, 1e6], ["Ff", 300, 1e6]]);

test("default config: buy sequence equals the legacy order (prerequisite immediately before, ties in discovery order)", async () => {
  const world = W();
  const r = await run({ world, files: LIQ });
  assert.equal(r.st.installed, true);
  assert.deepEqual(r.bought, ["Cc", "Bb", "Dd", "Ee", "Ff", "Aa"]);
  const cands = Object.entries(world.factions).flatMap(([f, v]) => v.augs.map((a) => ({ a, f, rr: world.augs[a].repReq })));
  assert.deepEqual(r.bought, AP.legacyOrder(cands, (a) => world.augs[a].prereqs, new Set()).map((x) => x.a));
  const plan = r.audit.find((x) => x.kind === "plan");
  assert.equal(plan.cfg, "default"); assert.deepEqual(plan.plan.map((x) => x.a), r.bought);
  assert.ok(!r.audit.some((x) => x.kind === "orderFallback"));
});
test("default config on the real catalog: the buy sequence equals the legacy order (several rep levels, two factions selling the same aug)", async () => {
  const names = Object.keys(BN5.augs).filter((a) => !a.startsWith("NeuroFlux") && a !== "The Red Pill").slice(0, 40);
  for (const rep of [1500, 6000, 25000, 1e6]) {
    const augs = {}; for (const a of names) augs[a] = { repReq: BN5.augs[a].repReq, price: 1e5, prereqs: BN5.augs[a].prereqs };
    const factions = { F1: { rep, augs: names.filter((_, i) => i % 2 === 0) }, F2: { rep, augs: names.filter((_, i) => i % 3 !== 1) } };
    const world = { augs, factions, money: 1e30, owned: [] };
    const r = await run({ world, files: LIQ });
    const rr = (a) => augs[a].repReq;
    const cands = Object.entries(factions).flatMap(([f, v]) => v.augs.filter((a) => rr(a) <= rep).map((a) => ({ a, f, rr: rr(a) })));
    const want = AP.legacyOrder(cands, (a) => augs[a].prereqs, new Set()).map((x) => x.a);
    if (rep === 1e6) assert.ok(want.length > 10);
    const have = new Set(), expected = [];
    for (const a of want) if (augs[a].prereqs.every((p) => have.has(p))) { have.add(a); expected.push(a); } // "prereq missing" skip, as in buyBatch
    assert.deepEqual(r.bought, expected, `rep ${rep} order`);
    // every purchased aug is bought from the same faction the legacy code picked (the later seller wins)
    const legacyFac = new Map(AP.legacyOrder(cands, (a) => augs[a].prereqs, new Set()).map((x) => [x.a, x.f]));
    const plan = r.audit.find((x) => x.kind === "plan").plan;
    for (const x of plan) assert.equal(x.f, legacyFac.get(x.a), x.a);
  }
});
test("pinned: bought first in list order (prerequisites still immediately before); the rest keep the default order", async () => {
  const r = await run({ world: W(), files: LIQ, settings: { "augs.order.pinned": ["Aa", "Bb"] } });
  assert.deepEqual(r.bought, ["Aa", "Cc", "Bb", "Dd", "Ee", "Ff"]);
  assert.notEqual(r.audit.find((x) => x.kind === "plan").cfg, "default");
});
test("last: bought after all others", async () => {
  const r = await run({ world: W(), files: LIQ, settings: { "augs.order.last": ["Dd"] } });
  assert.deepEqual(r.bought, ["Cc", "Bb", "Ee", "Ff", "Aa", "Dd"]);
});
test("sort=cheap / price follow the sort key", async () => {
  const world = mk([["Aa", 1, 5e6], ["Bb", 2, 1e6], ["Cc", 3, 9e6]]);
  assert.deepEqual((await run({ world: clone(world), files: LIQ, settings: { "augs.order.sort": "price" } })).bought, ["Cc", "Aa", "Bb"]);
  assert.deepEqual((await run({ world: clone(world), files: LIQ, settings: { "augs.order.sort": "cheap" } })).bought, ["Bb", "Aa", "Cc"]);
});
test("exclude: never bought; counts nowhere toward the install trigger; an aug with an excluded prerequisite is not bought", async () => {
  const r = await run({ world: W(), files: LIQ, settings: { "augs.order.exclude": ["Dd", "Cc"] } });
  assert.deepEqual(r.bought, ["Ee", "Ff", "Aa"], "Dd excluded, Cc excluded so Bb (needs Cc) is blocked");
  // trigger count: 6 buyable, 4 excluded -> 2 buyable < installAt 3 -> no trigger, nothing bought
  const withRepWork = () => { const w = W(); w.augs.Zz = { repReq: 1e12, price: 1e6, prereqs: [] }; w.factions.F1.augs.push("Zz"); return w; }; // keeps the 'all rep-complete' stall trigger off
  const q = await run({ world: withRepWork(), files: LIQ, settings: { "augs.installAt": 3, "augs.order.exclude": ["Aa", "Bb", "Cc", "Dd"] } });
  assert.equal(q.st.installed, false); assert.deepEqual(q.bought, []); assert.equal(q.status.augs.buyable, 2);
  const control = await run({ world: withRepWork(), files: LIQ, settings: { "augs.installAt": 3 } });
  assert.equal(control.st.installed, true);
});
test("augs.top (aug report) follows the order config and drops excluded augs", async () => {
  const r = await run({ world: W(), settings: { "augs.autoInstall": false, "augs.order.pinned": ["Aa"], "augs.order.exclude": ["Dd"] } });
  assert.deepEqual(r.status.augs.top.map((x) => x.split("@")[0]), ["Aa", "Cc", "Bb", "Ee", "Ff"]);
  assert.equal(r.status.augs.buyable, 5);
});
test("NeuroFlux stays last and leftover cash still goes to home RAM", async () => {
  const world = mk([["Aa", 1, 1e6], ["Bb", 2, 1e6], [NFG, 10, 1e6]], { money: 5e8 });
  const r = await run({ world, files: LIQ, settings: { "augs.order.pinned": ["Aa"], "augs.order.last": ["Bb"] }, homeRamCost: 1e6 });
  assert.equal(r.bought.at(-1), NFG, JSON.stringify(r.bought));
  assert.deepEqual(r.bought.slice(0, 2), ["Aa", "Bb"]);
  const i = r.st.purchases.lastIndexOf(NFG); assert.ok(r.st.purchases.slice(i + 1).every((p) => p === "home RAM") && r.st.purchases.includes("home RAM"), "RAM after NeuroFlux");
});
test("strict: holds the batch and the install, re-enables stocks, audits strictHold once; times out at the cap and buys soft", async () => {
  const world = mk([["Aa", 100, 1e6], ["Ab", 200, 1e6], ["Pin", 5000, 1e6]], { factions: { F1: { rep: 1000 } } });
  const settings = { "augs.order.pinned": ["Pin"], "augs.order.strict": true, "augs.order.strictMaxWaitMin": 60 };
  // loop 1 (t0): held. loops 2..: still held, no repeat audit. Step = 20 min => loop 4 is at t0+60 = the cap
  const r = await run({ world, files: LIQ, settings, loops: 3, step: 20 * MIN });
  assert.equal(r.st.installed, false); assert.deepEqual(r.st.purchases, []);
  assert.equal(r.liquidate, false, "stock trading re-enabled");
  assert.equal(r.audit.filter((x) => x.kind === "strictHold").length, 1);
  assert.equal(r.audit.find((x) => x.kind === "strictHold").blocker, "Pin");
  assert.ok(!r.audit.some((x) => x.kind === "strictTimeout"));
  assert.ok(/install held/.test(r.events));
  const state = JSON.parse(r.F["data/aug-order-state.txt"]); assert.equal(state.reset, 1); assert.deepEqual(state.timedOut, []);
  // continue past the cap with the persisted state: the same world, the liquidate flag set again (the trigger fires again)
  const r2 = await run({ world: mk([["Aa", 100, 1e6], ["Ab", 200, 1e6], ["Pin", 5000, 1e6]], { factions: { F1: { rep: 1000 } } }), files: { ...LIQ, "data/aug-order-state.txt": r.F["data/aug-order-state.txt"] }, settings, loops: 1, startClock: Date.UTC(2026, 10, 2, 12) + 90 * MIN });
  assert.equal(r2.st.installed, true, "after the cap the soft order proceeds");
  assert.deepEqual(r2.bought, ["Ab", "Aa"]);
  assert.equal(r2.audit.filter((x) => x.kind === "strictTimeout").length, 1);
  assert.ok(!r2.audit.some((x) => x.kind === "strictHold"));
});
test("strict: a rep-met pinned aug is bought first and does not hold", async () => {
  const world = mk([["Aa", 100, 1e6], ["Pin", 50, 1e6]]);
  const r = await run({ world, files: LIQ, settings: { "augs.order.pinned": ["Pin"], "augs.order.strict": true } });
  assert.equal(r.st.installed, true); assert.deepEqual(r.bought, ["Pin", "Aa"]);
  assert.ok(!r.audit.some((x) => x.kind === "strictHold"));
});
test("strict: strict=false never holds even with an unreachable pinned aug (soft order)", async () => {
  const world = mk([["Aa", 100, 1e6], ["Ab", 200, 1e6], ["Pin", 5000, 1e6]], { factions: { F1: { rep: 1000 } } });
  const r = await run({ world, files: LIQ, settings: { "augs.order.pinned": ["Pin"] } });
  assert.deepEqual(r.bought, ["Ab", "Aa"]); assert.equal(r.st.installed, true);
});
test("strict: state from another install cycle (lastAugReset differs) is discarded, so the hold starts over", async () => {
  const world = mk([["Aa", 100, 1e6], ["Ab", 200, 1e6], ["Pin", 5000, 1e6]], { factions: { F1: { rep: 1000 } } });
  const old = JSON.stringify({ reset: 1, first: { Pin: Date.UTC(2026, 10, 1) }, timedOut: ["Pin"] });
  const r = await run({ world, files: { ...LIQ, "data/aug-order-state.txt": old }, lastAugReset: 2, settings: { "augs.order.pinned": ["Pin"], "augs.order.strict": true } });
  assert.equal(r.st.installed, false, "held again: the old timeout belonged to the previous cycle");
  const s = JSON.parse(r.F["data/aug-order-state.txt"]); assert.equal(s.reset, 2); assert.deepEqual(s.timedOut, []);
  const same = await run({ world: mk([["Aa", 100, 1e6], ["Ab", 200, 1e6], ["Pin", 5000, 1e6]], { factions: { F1: { rep: 1000 } } }), files: { ...LIQ, "data/aug-order-state.txt": old }, lastAugReset: 1, settings: { "augs.order.pinned": ["Pin"], "augs.order.strict": true } });
  assert.equal(same.st.installed, true, "same cycle: Pin already timed out, soft order buys");
});
test("strict: a corrupt state file resets state instead of crashing", async () => {
  const world = mk([["Aa", 100, 1e6], ["Ab", 200, 1e6], ["Pin", 5000, 1e6]], { factions: { F1: { rep: 1000 } } });
  const r = await run({ world, files: { ...LIQ, "data/aug-order-state.txt": "{{{{" }, settings: { "augs.order.pinned": ["Pin"], "augs.order.strict": true } });
  assert.equal(r.st.installed, false); assert.equal(r.audit.filter((x) => x.kind === "strictHold").length, 1);
  assert.deepEqual(JSON.parse(r.F["data/aug-order-state.txt"]).timedOut, []);
});
test("strict: a pinned aug sold only by the gang faction is ignored (its rep cannot be worked)", async () => {
  const world = mk([["Aa", 100, 1e6], ["Ab", 200, 1e6], ["GangPin", 5000, 1e6, [], "Snakes"]], { factions: { F1: { rep: 1000 }, Snakes: { rep: 10 } } });
  const settings = { "augs.order.pinned": ["GangPin"], "augs.order.strict": true };
  const r = await run({ world, files: LIQ, settings, gangFaction: "Snakes" });
  assert.equal(r.st.installed, true); assert.ok(!r.audit.some((x) => x.kind === "strictHold"));
  const ctl = await run({ world: mk([["Aa", 100, 1e6], ["Ab", 200, 1e6], ["GangPin", 5000, 1e6, [], "Snakes"]], { factions: { F1: { rep: 1000 }, Snakes: { rep: 10 } } }), files: LIQ, settings });
  assert.equal(ctl.st.installed, false, "without the gang flag it is a normal faction and holds");
});
test("fallback: if orderAugs throws, the legacy order is used, orderFallback is audited, an attention flag is raised and buying continues", async () => {
  const r = await run({ world: W(), files: LIQ, flakyPrice: true });
  assert.equal(r.st.installed, true);
  assert.deepEqual(r.bought, ["Cc", "Bb", "Dd", "Ee", "Ff", "Aa"], "legacy order");
  const fb = r.audit.filter((x) => x.kind === "orderFallback"); assert.equal(fb.length, 1); assert.match(fb[0].err, /boom/);
  // the flag path: without an install the status file carries it
  const f = await run({ world: W(), settings: { "augs.autoInstall": false }, flakyPrice: true });
  assert.ok(f.status.flags.some((x) => /^aug order fallback: .*boom/.test(x)), JSON.stringify(f.status.flags));
  assert.equal(f.status.augs.buyable, 6, "the aug report still works");
});
test("drivesWork: auto-faction works for the highest-ranked pinned aug's faction, never the gang faction; off by default", async () => {
  const mkw = () => mk([["Aa", 100, 1e6], ["PinB", 8000, 1e6, [], "F2"]], { factions: { F1: { rep: 90 }, F2: { rep: 10 } } });
  const cfg = { work: "auto-faction", factionPriority: ["F1", "F2"] };
  const off = await run({ world: mkw(), cfg, settings: { "augs.order.pinned": ["PinB"], "augs.autoInstall": false } });
  assert.deepEqual(off.st.worked, ["F1"], "default: factionPriority decides");
  const on = await run({ world: mkw(), cfg, settings: { "augs.order.pinned": ["PinB"], "augs.order.drivesWork": true, "augs.autoInstall": false } });
  assert.deepEqual(on.st.worked, ["F2"]); assert.match(on.events, /working for F2 \(pinned aug PinB\)/);
  const gw = mk([["Aa", 100, 1e6], ["GangPin", 8000, 1e6, [], "F2"]], { factions: { F1: { rep: 90 }, F2: { rep: 10 } } });
  const g = await run({ world: gw, cfg, gangFaction: "F2", settings: { "augs.order.pinned": ["GangPin"], "augs.order.drivesWork": true, "augs.autoInstall": false } });
  assert.ok(!g.st.worked.includes("F2"), "never the gang faction");
  const done = mkw(); done.factions.F2.rep = 1e9;
  const d = await run({ world: done, cfg, settings: { "augs.order.pinned": ["PinB"], "augs.order.drivesWork": true, "augs.autoInstall": false } });
  assert.deepEqual(d.st.worked, ["F1"], "pinned aug rep-met: the existing logic runs unchanged");
  const nokeep = await run({ world: mkw(), cfg: { work: "keep" }, settings: { "augs.order.pinned": ["PinB"], "augs.order.drivesWork": true, "augs.autoInstall": false } });
  assert.deepEqual(nokeep.st.worked, [], "only inside work=auto-faction");
});
test("buyBatch reads data/settings.txt at most once per batch", async () => {
  const r = await run({ world: W(), files: LIQ, settings: { "augs.order.pinned": ["Aa"] } });
  assert.equal(r.st.installed, true);
  // marks counts data/config-overrides.txt reads; the batch starts right after the last one before installing
  const last = r.st.marks, inBatch = r.st.settingsReads.filter((m) => m === last).length;
  assert.ok(inBatch <= 1, `${inBatch} settings reads inside buyBatch`);
});
test("static: autopilot's import of lib/augorder.js adds no RAM-costing identifiers and no DOM/timers", () => {
  const costly = new Set(JSON.parse(fs.readFileSync(new URL("./fixtures/ns-costly-names.json", import.meta.url), "utf8")));
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, " ");
  const src = fs.readFileSync(path.join(GAME, "lib/augorder.js"), "utf8");
  assert.ok(!/^\s*import\b/m.test(src), "augorder.js has no imports");
  const ids = new Set(strip(src).match(/[A-Za-z_$][\w$]*/g) || []);
  assert.deepEqual([...ids].filter((i) => costly.has(i)), []);
  for (const bad of ["window", "document", "setInterval", "setTimeout", "ns"]) assert.ok(!ids.has(bad), bad);
  const ap = fs.readFileSync(path.join(GAME, "agent/autopilot.js"), "utf8");
  assert.match(ap, /from "lib\/augorder\.js"/);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} augorder-autopilot test(s) failed`); process.exit(1); }
console.log(`augorder-autopilot: ${tests.length} passed`);
