// Gang integration with the rest of the stack: aug planner, autopilot, sl-work / sl-crime / sl-plan, post-install, daemon-lite
// helpers, settings and the dashboard KPIs. Everything runs against fakes; nothing touches a live game.
import assert from "node:assert/strict";
import fs from "node:fs";
import { importGame } from "./helpers/game-import.js";
import { fakeGang, settingsFile } from "./helpers/fake-gang.js";
import { SCHEMA, GROUPS, defaults, coerce } from "../game/lib/settings-schema.js";
import { computeKpis, KPI_KEYS, GANG_KPI_KEYS } from "../game/lib/kpi.js";
import { HOT_FILES, RAW_FILES } from "../game/lib/data-sources.js";
import { createDashboardApi, formatDashboard } from "../server/dashboard.js";
import { NOW, latest, ring, autopilot, ramStatus, augPlan, pred2Tail } from "./fixtures/dashboard-data.js";

const AUG = await importGame("lib/augplan.js");
const AP = await importGame("agent/autopilot.js");
const SLWORK = await importGame("agent/sl-work.js");
const SLCRIME = await importGame("agent/sl-crime.js");
const SLPLAN = await importGame("agent/sl-plan.js");
const POST = await importGame("agent/post-install.js");
const PLAN = await importGame("lib/gangplan.js");
const DL = await (async () => { // daemon-lite has no package.json type either: import a temp copy, like test/daemon-lite.js
  const os = await import("node:os"), path = await import("node:path"), url = await import("node:url");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbgi-")), tmp = path.join(dir, "daemon-lite.mjs");
  fs.copyFileSync(new URL("../game/agent/daemon-lite.js", import.meta.url), tmp);
  try { return await import(url.pathToFileURL(tmp).href); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();
const { RED_PILL, NFG } = AUG;
const BN5 = JSON.parse(fs.readFileSync(new URL("./fixtures/bn5-snapshot.json", import.meta.url), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const S = (o = {}) => ({ ...defaults(), ...o });
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ── aug planner ───────────────────────────────────────────────────────────
/** BN2 after the gang exists: fresh BitNode, Slum Snakes is the gang faction and (BN2 only) sells The Red Pill. */
function gangSnap({ gangRep = 5e5, favor = 0, joinedGang = true, withGangFlag = true, daedalus = false } = {}) {
  const f = clone(BN5);
  Object.assign(f, { bn: 2, installed: [], owned: [], hack: 200, money: 5e9, income: 2e6, invites: [], worldDaemon: { exists: false, req: null, root: false } });
  for (const x of Object.values(f.factions)) Object.assign(x, { joined: false, rep: 0, favor: 0, repRate: 0 });
  f.factions["Slum Snakes"] = { joined: joinedGang, rep: gangRep, favor, repRate: 100, augs: [...new Set([...f.factions["Slum Snakes"].augs, RED_PILL, NFG])] };
  if (daedalus) Object.assign(f.factions.Daedalus, { joined: true, rep: 1e3 });
  if (withGangFlag) f.gangFaction = "Slum Snakes";
  return f;
}
test("augplan: The Red Pill comes from the gang faction and the Daedalus step is gone", () => {
  const p = AUG.plan(gangSnap(), S());
  const rp = p.steps.find((x) => x.aug === RED_PILL);
  assert.ok(rp, "Red Pill is in the plan");
  assert.equal(rp.faction, "Slum Snakes");
  assert.notEqual(rp.status, "blocked");
  assert.ok(!p.steps.some((x) => /Daedalus needs/.test(x.why)), "no 'Daedalus needs N installed augs' filler");
  assert.equal(p.redPill.rep, 5e5, "redPill.rep is the gang faction's");
  // control: the same data without a gang faction and without the Red Pill listed anywhere is the old Daedalus path
  const old = clone(BN5); old.installed = []; old.owned = []; old.hack = 900; old.money = 5e9; old.income = 2e7; old.worldDaemon = { exists: false, req: null, root: false };
  for (const x of Object.values(old.factions)) Object.assign(x, { rep: x.joined ? 5e4 : 0, favor: 0, repRate: 50 });
  old.factions.Daedalus.joined = false; old.invites = [];
  const po = AUG.plan(old, S());
  assert.ok(po.steps.some((x) => /Daedalus needs/.test(x.why)), "control keeps the Daedalus filler steps");
  assert.equal(po.steps.find((x) => x.aug === RED_PILL).faction, "Daedalus");
});
test("augplan: with Daedalus joined too, the gang faction is still preferred for The Red Pill", () => {
  const withGang = AUG.plan(gangSnap({ gangRep: 10, daedalus: true }), S()).steps.find((x) => x.aug === RED_PILL);
  assert.equal(withGang.faction, "Slum Snakes");
  const noFlag = AUG.plan(gangSnap({ gangRep: 10, daedalus: true, withGangFlag: false }), S()).steps.find((x) => x.aug === RED_PILL);
  assert.equal(noFlag.faction, "Daedalus", "without the gang flag the old best-rep rule applies");
});
test("augplan: the gang faction is never donated to; other factions still are", () => {
  const snap = gangSnap({ gangRep: 100, favor: 1000 });
  const p = AUG.plan(snap, S());
  const rp = p.steps.find((x) => x.aug === RED_PILL);
  assert.equal(rp.status, "needRep", "rep gap on the gang faction waits for respect, it cannot be bought");
  assert.ok(!/donate/.test(rp.why));
  assert.equal(AUG.canDonateTo({ faction: "Slum Snakes", joined: true, favor: 1000 }, snap, S()), false);
  assert.equal(AUG.canDonateTo({ faction: "CyberSec", joined: true, favor: 1000 }, snap, S()), true);
  assert.equal(AUG.canDonateTo({ faction: "CyberSec", joined: true, favor: 10 }, snap, S()), false);
  assert.equal(AUG.canDonateTo({ faction: "Slum Snakes", joined: true, favor: 1000 }, { ...snap, gangFaction: null }, S()), true, "no gang, no exception");
});
test("augplan: a gang faction that is not joined yet is named in the blocked Red Pill step", () => {
  const snap = gangSnap({ joinedGang: false });
  snap.factions["Slum Snakes"].joined = false;
  const rp = AUG.plan(snap, S()).steps.find((x) => x.aug === RED_PILL);
  assert.equal(rp.faction, "Slum Snakes");
  assert.match(rp.why, /gang faction/);
});
test("augplan: nextPurchaseCost = price of the first buyable / needMoney step; 0 when none; held steps ignored", () => {
  assert.equal(AUG.nextPurchaseCost([]), 0);
  assert.equal(AUG.nextPurchaseCost([{ status: "needRep", price: 5, why: "" }, { status: "needMoney", price: 7e9, why: "" }, { status: "buyable", price: 9, why: "" }]), 7e9);
  assert.equal(AUG.nextPurchaseCost([{ status: "buyable", price: 123.4, why: "" }]), 123);
  assert.equal(AUG.nextPurchaseCost([{ status: "buyable", price: 0, why: "" }, { status: "needMoney", price: 42, why: "" }]), 42, "free steps (The Red Pill) are skipped");
  assert.equal(AUG.nextPurchaseCost([{ status: "buyable", price: 5, why: "held: near the finish" }, { status: "needRep", price: 1, why: "" }]), 0);
  const p = AUG.plan(gangSnap({ gangRep: 1e10, favor: 0 }), S());
  const first = p.steps.find((x) => (x.status === "buyable" || x.status === "needMoney") && x.price > 0 && !/^held/.test(x.why));
  assert.equal(p.nextPurchaseCost, first ? Math.round(first.price) : 0);
  assert.ok(p.nextPurchaseCost > 0);
});

// ── autopilot ─────────────────────────────────────────────────────────────
/** One autopilot loop against a fake singularity. Returns the singularity calls that matter. */
async function autopilotLoop({ gangStatus = null, work = null, cfg = {}, factions = ["Slum Snakes", "CyberSec"], settings = {}, running = true, bn = 2, ownedSF = new Map(), karma = 0 } = {}) {
  const files = { "data/autopilot-config.txt": JSON.stringify({ work: "auto-faction", factionPriority: ["Slum Snakes", "CyberSec"], programs: false, homeRam: false, homeCores: false, backdoors: false, autoInstall: false, ...cfg }) };
  if (gangStatus) files["data/gang-status.txt"] = JSON.stringify(gangStatus);
  if (Object.keys(settings).length) files["data/settings.txt"] = settingsFile(settings);
  const calls = [], runs = [];
  const rec = (name, ret) => (...a) => { calls.push([name, ...a]); return ret; };
  const AUGS = { "Slum Snakes": ["Snake Aug", NFG], CyberSec: ["Cyber Aug"] }, REQ = { "Snake Aug": 1000, "Cyber Aug": 2000, [NFG]: 500 };
  const Sg = {
    hasTorRouter: () => true, checkFactionInvitations: () => [], getOwnedAugmentations: () => [], getAugmentationsFromFaction: (f) => AUGS[f] || [], getFactionRep: () => 0,
    getAugmentationRepReq: (a) => REQ[a] ?? 0, getAugmentationPrice: () => 1e6, getAugmentationPrereq: () => [], getFactionFavor: () => 500, getCurrentWork: () => work,
    workForFaction: rec("workForFaction", true), donateToFaction: rec("donateToFaction", true), getUpgradeHomeRamCost: () => Infinity, getUpgradeHomeCoresCost: () => Infinity,
    purchaseAugmentation: () => false, joinFaction: rec("joinFaction", true),
  };
  let loops = 0;
  const ns = {
    singularity: Sg, args: [], disableLog() {}, read: (f) => files[f.replace(/^\//, "")] ?? "", write: (f, d, m) => { const k = f.replace(/^\//, ""); files[k] = m === "w" ? d : (files[k] ?? "") + d; },
    getHackingLevel: () => 100, getPlayer: () => ({ factions, mults: { faction_rep: 1 }, exp: { hacking: 1 } }), getResetInfo: () => ({ currentNode: bn, ownedSF, lastAugReset: 0 }), heart: { break: () => karma },
    gang: { inGang: () => !!gangStatus?.inGang }, isRunning: (s) => (s === "agent/gang.js" ? running : s === "agent/sl-crime.js" ? false : true),
    run: (s) => { runs.push(s); return 7; }, fileExists: () => true, getServerMoneyAvailable: () => 1e12, getFavorToDonate: () => 150, serverExists: () => false,
    getServerMaxRam: () => 1024, getServerUsedRam: () => 0, getScriptRam: () => 4, getMoneySources: () => ({ sinceInstall: {} }), format: { number: (x) => String(x) },
    sleep: async () => { if (++loops >= 1) throw new Error("STOP"); }, getServer: () => ({ cpuCores: 1 }), getServerRequiredHackingLevel: () => 1, hasRootAccess: () => false, scan: () => [],
  };
  try { await AP.main(ns); } catch (e) { if (!/STOP/.test(String(e))) throw e; }
  return { calls, runs, files };
}
const GS = { inGang: true, faction: "Slum Snakes", t: Date.now(), phase: "grow" };
test("autopilot: never works for the gang faction (picks the next one); control without a gang does", async () => {
  const withGang = await autopilotLoop({ gangStatus: GS });
  assert.deepEqual(withGang.calls.filter((c) => c[0] === "workForFaction").map((c) => c[1]), ["CyberSec"]);
  const control = await autopilotLoop({});
  assert.deepEqual(control.calls.filter((c) => c[0] === "workForFaction").map((c) => c[1]), ["Slum Snakes"], "the exclusion is what changes the pick");
  const onlyGang = await autopilotLoop({ gangStatus: GS, factions: ["Slum Snakes"] });
  assert.deepEqual(onlyGang.calls.filter((c) => c[0] === "workForFaction"), [], "nothing else to work for: idle, not an error");
  const fixed = await autopilotLoop({ gangStatus: GS, cfg: { work: "faction:Slum Snakes" } });
  assert.deepEqual(fixed.calls.filter((c) => c[0] === "workForFaction"), [], "even an explicit faction:<gang> setting");
});
test("autopilot: never donates to the gang faction (the game refuses)", async () => {
  const work = { type: "FACTION", factionName: "Slum Snakes", factionWorkType: "hacking" };
  const withGang = await autopilotLoop({ gangStatus: GS, work, cfg: { work: "keep", donate: true } });
  assert.deepEqual(withGang.calls.filter((c) => c[0] === "donateToFaction"), []);
  const control = await autopilotLoop({ work, cfg: { work: "keep", donate: true } });
  assert.deepEqual(control.calls.filter((c) => c[0] === "donateToFaction").map((c) => c[1]), ["Slum Snakes"], "control donates, so the harness would have caught it");
  const other = await autopilotLoop({ gangStatus: GS, work: { ...work, factionName: "CyberSec" }, cfg: { work: "keep", donate: true } });
  assert.deepEqual(other.calls.filter((c) => c[0] === "donateToFaction").map((c) => c[1]), ["CyberSec"], "other factions still get donations");
});
test("autopilot: combat bootstrap (gym / crime) runs sl-crime instead of faction work; a stale or dry-run status does not", async () => {
  const fresh = { inGang: false, phase: "bootstrap", bootstrapAction: "gym", dryRun: false, t: Date.now() };
  const r = await autopilotLoop({ gangStatus: fresh });
  assert.ok(r.runs.includes("agent/sl-crime.js"));
  assert.deepEqual(r.calls.filter((c) => c[0] === "workForFaction"), [], "no faction work meanwhile");
  assert.ok(!(await autopilotLoop({ gangStatus: { ...fresh, t: Date.now() - 5 * 60000 } })).runs.includes("agent/sl-crime.js"), "stale status");
  assert.ok(!(await autopilotLoop({ gangStatus: { ...fresh, dryRun: true } })).runs.includes("agent/sl-crime.js"), "dry run changes nothing");
  const done = await autopilotLoop({ gangStatus: { ...fresh, bootstrapAction: "create" } });
  assert.ok(!done.runs.includes("agent/sl-crime.js"));
  assert.equal(done.calls.filter((c) => c[0] === "workForFaction").length, 1, "back to faction work");
});
test("autopilot: restarts agent/gang.js when it is missing, only if enabled and possible", async () => {
  assert.ok((await autopilotLoop({ running: false })).runs.includes("agent/gang.js"), "BN2: restarted");
  assert.ok(!(await autopilotLoop({ running: true })).runs.includes("agent/gang.js"));
  assert.ok(!(await autopilotLoop({ running: false, settings: { "gang.enabled": false } })).runs.includes("agent/gang.js"), "gang.enabled=false");
  const memo = { failed: false }, acts = [];
  const e = (o) => AP.ensureGang({ enabled: true, possible: true, running: () => false, run: () => 0, act: (m) => acts.push(m), memo, ...o });
  assert.equal(e({}), 0); assert.equal(e({}), 0);
  assert.equal(acts.length, 1, "a failed start is logged once");
  assert.equal(e({ run: () => 9 }), 9);
  assert.equal(memo.failed, false);
  assert.equal(AP.ensureGang({ enabled: true, possible: false, running: () => false, run: () => 9, act() {}, memo }), 0, "not possible in this BitNode");
  assert.deepEqual(AP.workable(["a", "b", "c"], "b"), ["a", "c"]);
  assert.deepEqual(AP.workable(["a", "b"], null), ["a", "b"]);
});

test("regression: gang.js is not restarted where the gang API is unavailable (BN5 with SF2, no gang) and needs karma <= -54000 outside BN2", async () => {
  const sf2 = new Map([[2, 1]]);
  const restarts = async (o) => (await autopilotLoop({ running: false, ...o })).runs.filter((r) => r === "agent/gang.js").length;
  assert.equal(await restarts({ bn: 5, ownedSF: sf2, karma: 0 }), 0, "BN5, SF2, karma 0: the case that restarted gang.js every 30 s");
  assert.equal(await restarts({ bn: 5, ownedSF: sf2, karma: -53999.9 }), 0, "just short of the karma requirement");
  assert.equal(await restarts({ bn: 5, ownedSF: new Map(), karma: -99999 }), 0, "karma without SF2");
  assert.equal(await restarts({ bn: 5, ownedSF: sf2, karma: -54000 }), 1, "SF2 + karma at the boundary");
  assert.equal(await restarts({ bn: 5, ownedSF: sf2, karma: -1e6 }), 1);
  assert.equal(await restarts({ bn: 2, ownedSF: new Map(), karma: 0 }), 1, "BN2 needs no karma");
  assert.equal(await restarts({ bn: 5, ownedSF: sf2, karma: 0, gangStatus: { inGang: true, faction: "Tetrads", t: Date.now(), phase: "grow" } }), 1, "an existing gang is managed in any BitNode");
  assert.equal(await restarts({ bn: 2, settings: { "gang.enabled": false } }), 0, "gang.enabled=false still wins");
});
test("regression: gangPossible truth table (Map and object SF forms, missing karma)", () => {
  const g = (o) => PLAN.gangPossible({ bn: 5, inGang: false, ownedSF: new Map(), karma: 0, ...o });
  assert.equal(g({}), false);
  assert.equal(g({ ownedSF: new Map([[2, 1]]) }), false);
  assert.equal(g({ ownedSF: new Map([[2, 1]]), karma: undefined }), false, "missing karma counts as 0");
  assert.equal(g({ ownedSF: new Map([[2, 1]]), karma: -54000 }), true);
  assert.equal(g({ ownedSF: { 2: 1 }, karma: -54000 }), true);
  assert.equal(g({ ownedSF: { 2: 1 }, karma: -53999 }), false);
  assert.equal(g({ ownedSF: new Map([[1, 3]]), karma: -54000 }), false);
  assert.equal(g({ ownedSF: undefined, karma: -54000 }), false);
  assert.equal(g({ bn: 2 }), true);
  assert.equal(g({ inGang: true }), true);
  assert.equal(PLAN.GANG_KARMA, -54000);
});
test("regression: daemon-lite's inline gate matches lib/gangplan.js gangPossible", () => {
  for (const bn of [1, 2, 5]) for (const inGang of [false, true]) for (const sf2 of [false, true]) for (const karma of [0, -53999, -54000, -1e6]) {
    const want = PLAN.gangPossible({ bn, inGang, ownedSF: sf2 ? new Map([[2, 1]]) : new Map(), karma });
    assert.equal(DL.gangWantedHere({ on: true, bn, inGang, hasSF2: sf2, karma }), want, JSON.stringify({ bn, inGang, sf2, karma }));
    assert.equal(DL.gangWantedHere({ on: false, bn, inGang, hasSF2: sf2, karma }), false, "gang.enabled=false");
  }
});

// ── sl-work / sl-crime ────────────────────────────────────────────────────
function slns({ factions, invites = [], skills, karma = 0, city = "Sector-12", work = null }) {
  const calls = [], ports = [];
  const rec = (n, r) => (...a) => { calls.push([n, ...a]); return typeof r === "function" ? r(...a) : r; };
  const Sg = {
    checkFactionInvitations: () => invites, joinFaction: rec("joinFaction", true), getOwnedAugmentations: () => [], getAugmentationsFromFaction: () => ["X"], getAugmentationRepReq: () => 1000, getFactionRep: () => 0,
    getCurrentWork: () => work, workForFaction: rec("workForFaction", true), gymWorkout: rec("gymWorkout", true), commitCrime: rec("commitCrime", 4000), travelToCity: rec("travelToCity", true),
  };
  return { calls, ports, ns: { singularity: Sg, args: [], getPlayer: () => ({ factions, city, skills }), heart: { break: () => karma }, writePort: (p, d) => ports.push([p, JSON.parse(d)]) } };
}
test("sl-work: never works for the gang faction passed by daemon-lite", async () => {
  const a = slns({ factions: ["Slum Snakes", "CyberSec"] });
  a.ns.args = [JSON.stringify({ prio: ["Slum Snakes", "CyberSec"], gang: "Slum Snakes" })];
  await SLWORK.main(a.ns);
  assert.deepEqual(a.calls.filter((c) => c[0] === "workForFaction").map((c) => c[1]), ["CyberSec"]);
  const b = slns({ factions: ["Slum Snakes", "CyberSec"] });
  b.ns.args = [JSON.stringify({ prio: ["Slum Snakes", "CyberSec"] })];
  await SLWORK.main(b.ns);
  assert.deepEqual(b.calls.filter((c) => c[0] === "workForFaction").map((c) => c[1]), ["Slum Snakes"], "control");
  const c = slns({ factions: ["Slum Snakes"] });
  c.ns.args = [JSON.stringify({ gang: "Slum Snakes" })];
  await SLWORK.main(c.ns);
  assert.deepEqual(c.calls.filter((x) => x[0] === "workForFaction"), []);
  assert.equal(c.ports[0][1].op, "work");
});
test("sl-crime: gym on the lowest combat stat below 30, then Mug until karma -9, then done; joins non-city invites", async () => {
  const sk = (o) => ({ strength: 30, defense: 30, dexterity: 30, agility: 30, ...o });
  let t = slns({ factions: [], skills: sk({ agility: 7, defense: 12 }), invites: ["Slum Snakes", "Aevum", "NiteSec"] });
  await SLCRIME.main(t.ns);
  assert.deepEqual(t.calls.find((c) => c[0] === "gymWorkout"), ["gymWorkout", "Powerhouse Gym", "agi", false]);
  assert.deepEqual(t.calls.filter((c) => c[0] === "joinFaction").map((c) => c[1]), ["Slum Snakes", "NiteSec"], "city factions are left to sl-work/autopilot");
  assert.deepEqual([t.ports[0][0], t.ports[0][1].op, t.ports[0][1].mode, t.ports[0][1].stat], [21, "crime", "gym", "agility"]);
  t = slns({ factions: [], skills: sk({ strength: 5 }), city: "Aevum" });
  await SLCRIME.main(t.ns);
  assert.ok(t.calls.some((c) => c[0] === "travelToCity" && c[1] === "Sector-12"), "Powerhouse Gym is in Sector-12");
  t = slns({ factions: [], skills: sk({ strength: 5 }), work: { type: "CLASS", classType: "GYMSTRENGTH" } });
  await SLCRIME.main(t.ns);
  assert.equal(t.calls.filter((c) => c[0] === "gymWorkout").length, 0, "already training the right stat: not restarted");
  t = slns({ factions: [], skills: sk({}), karma: -3 });
  await SLCRIME.main(t.ns);
  assert.deepEqual(t.calls.find((c) => c[0] === "commitCrime"), ["commitCrime", "Mug", false]);
  assert.equal(t.ports[0][1].mode, "crime");
  t = slns({ factions: [], skills: sk({}), karma: -3, work: { type: "CRIME", crimeType: "Mug" } });
  await SLCRIME.main(t.ns);
  assert.equal(t.calls.filter((c) => c[0] === "commitCrime").length, 0, "already mugging");
  t = slns({ factions: [], skills: sk({}), karma: -9.5 });
  await SLCRIME.main(t.ns);
  assert.equal(t.ports[0][1].mode, "done");
  assert.equal(t.calls.filter((c) => c[0] === "commitCrime" || c[0] === "gymWorkout").length, 0);
  t = slns({ factions: [], skills: sk({ strength: 1 }), city: "Aevum" });
  t.ns.singularity.travelToCity = () => false;
  await SLCRIME.main(t.ns);
  assert.match(t.ports[0][1].err, /travel/);
});

// ── sl-plan ───────────────────────────────────────────────────────────────
test("sl-plan: faction union has no duplicates and keeps FACTIONS order", () => {
  const u = SLPLAN.factionUnion(SLPLAN.FACTIONS, ["Slum Snakes", "CyberSec", "Some New Faction"]);
  assert.equal(new Set(u).size, u.length);
  assert.deepEqual(u.slice(0, SLPLAN.FACTIONS.length), SLPLAN.FACTIONS);
  assert.deepEqual(u.slice(SLPLAN.FACTIONS.length), ["Some New Faction"]);
  assert.deepEqual(SLPLAN.factionUnion(SLPLAN.FACTIONS, undefined), SLPLAN.FACTIONS);
  assert.ok(SLPLAN.FACTIONS.includes("Slum Snakes") && SLPLAN.FACTIONS.includes("The Black Hand") && SLPLAN.FACTIONS.includes("NiteSec"), "the 7 gang factions are already listed");
});
test("sl-plan: main snapshots the gang faction and the plan takes The Red Pill from it", async () => {
  const files = {};
  const AUGS = { "Slum Snakes": [RED_PILL, "Snake Aug", NFG], CyberSec: ["Cyber Aug"] };
  const info = { [RED_PILL]: [2.5e6, 0], "Snake Aug": [1000, 1e6], [NFG]: [500, 5e6], "Cyber Aug": [2000, 2e6] };
  const Sg = {
    checkFactionInvitations: () => [], getAugmentationsFromFaction: (f) => { if (!AUGS[f]) throw new Error("no such faction"); return AUGS[f]; }, getFactionRep: (f) => (f === "Slum Snakes" ? 3e6 : 0),
    getFactionFavor: () => 0, getAugmentationRepReq: (a) => info[a][0], getAugmentationPrice: (a) => info[a][1], getAugmentationPrereq: () => [], getAugmentationStats: () => ({}), getOwnedAugmentations: () => [],
  };
  const ns = {
    singularity: Sg, args: [], read: (f) => files[f.replace(/^\//, "")] ?? "", write: (f, d, m) => { const k = f.replace(/^\//, ""); files[k] = m === "w" ? d : (files[k] ?? "") + d; },
    getPlayer: () => ({ factions: ["Slum Snakes", "CyberSec"], mults: { faction_rep: 1 } }), getHackingLevel: () => 500, getServerMoneyAvailable: () => 1e10, getTotalScriptIncome: () => [1e6],
    getResetInfo: () => ({ currentNode: 2, ownedSF: new Map(), lastAugReset: 0 }), getBitNodeMultipliers: () => ({ DaedalusAugsRequirement: 30, WorldDaemonDifficulty: 5 }), getFavorToDonate: () => 150,
    serverExists: () => false, getServerRequiredHackingLevel: () => 15000, hasRootAccess: () => false,
    gang: { inGang: () => true, getGangInformation: () => ({ faction: "Slum Snakes" }) }, getScriptName: () => "agent/sl-plan.js",
  };
  await SLPLAN.main(ns);
  const out = JSON.parse(files["data/aug-plan.txt"]);
  const rp = out.steps.find((x) => x.aug === RED_PILL);
  assert.equal(rp.faction, "Slum Snakes");
  assert.equal(rp.status, "buyable");
  assert.ok(!out.steps.some((x) => /Daedalus needs/.test(x.why)));
  assert.ok(out.nextPurchaseCost >= 0 && Number.isFinite(out.nextPurchaseCost));
  const noGang = { ...ns, gang: { inGang: () => false, getGangInformation: () => { throw new Error("not in a gang"); } } };
  await SLPLAN.main(noGang);
  assert.equal(JSON.parse(files["data/aug-plan.txt"]).steps.find((x) => x.aug === RED_PILL).faction, "Slum Snakes", "joined factions are still planned without the flag");
});

// ── post-install ──────────────────────────────────────────────────────────
test("post-install: starts gang.js only when gang.enabled and a gang is possible", async () => {
  const run = async ({ settings = {}, bn = 2, inGang = false, ownedSF = new Map(), homeRam = 32, karma = 0 } = {}) => {
    const files = { "data/settings.txt": Object.keys(settings).length ? settingsFile(settings) : "" }, started = [];
    const ns = {
      read: (f) => files[f.replace(/^\//, "")] ?? "", write: () => {}, sleep: async () => {}, isRunning: () => false, run: (s) => { started.push(s); return 1; }, getServerMaxRam: () => homeRam,
      getScriptRam: () => 8, getResetInfo: () => ({ currentNode: bn, ownedSF }), gang: { inGang: () => inGang }, heart: { break: () => karma },
    };
    await POST.main(ns);
    return started;
  };
  const on = await run();
  assert.ok(on.includes("agent/gang.js"));
  assert.ok(on.indexOf("agent/gang.js") > on.indexOf("agent/rpc.js"), "after rpc.js");
  assert.ok(!(await run({ settings: { "gang.enabled": false } })).includes("agent/gang.js"), "disabled");
  assert.ok(!(await run({ bn: 1 })).includes("agent/gang.js"), "BN1, no gang, no SF2");
  assert.ok((await run({ bn: 1, inGang: true })).includes("agent/gang.js"), "an existing gang is managed anywhere");
  assert.ok(!(await run({ bn: 5, ownedSF: new Map([[2, 1]]) })).includes("agent/gang.js"), "BN5 with SF2 but no gang and karma 0: no gang API");
  assert.ok((await run({ bn: 5, ownedSF: new Map([[2, 1]]), karma: -54000 })).includes("agent/gang.js"), "SF2 + karma <= -54000");
  assert.ok(!(await run({ bn: 5, ownedSF: new Map([[2, 1]]), karma: -53999 })).includes("agent/gang.js"), "one karma short");
  assert.ok(on.includes("agent/daemon-lite.js") && on.includes("agent/rpc.js"), "the rest of the stack is unchanged");
});

// ── daemon-lite helpers ───────────────────────────────────────────────────
test("daemon-lite: gang RAM reserve and the crime gate (same rule as lib/gangplan.js)", () => {
  assert.equal(DL.gangReserve({ wanted: false, running: false, gangRam: 13.6, shotRam: 9.6 }), 0);
  assert.equal(DL.gangReserve({ wanted: true, running: false, gangRam: 13.6, shotRam: 9.6 }), 23.2, "room for gang.js and its biggest one-shot");
  assert.equal(DL.gangReserve({ wanted: true, running: true, gangRam: 13.6, shotRam: 9.6 }), 9.6, "gang.js already counts as used RAM");
  const now = Date.now();
  for (const st of [null, {}, { phase: "grow" }, { phase: "bootstrap", bootstrapAction: "wait", t: now }, { phase: "bootstrap", bootstrapAction: "gym", t: now - 3 * 60000 },
    { phase: "bootstrap", bootstrapAction: "gym", t: now, dryRun: true }, { phase: "bootstrap", bootstrapAction: "gym", t: now }, { phase: "bootstrap", bootstrapAction: "crime", t: now - 1000 }]) {
    assert.equal(DL.gangCrimeFromStatus(JSON.stringify(st), now), PLAN.gangCrimeAction(st, now), JSON.stringify(st));
  }
  assert.equal(DL.gangCrimeFromStatus("not json", now), null);
  assert.equal(DL.gangCrimeFromStatus("", now), null);
  assert.equal(PLAN.gangFactionFromStatus(JSON.stringify({ inGang: true, faction: "Tetrads" })), "Tetrads");
  assert.equal(PLAN.gangFactionFromStatus(JSON.stringify({ inGang: false, faction: "Tetrads" })), null);
  assert.equal(PLAN.gangFactionFromStatus("garbage"), null);
});

// ── settings ──────────────────────────────────────────────────────────────
test("settings: the gang group exists with the spec's keys, defaults and owner", () => {
  assert.ok(GROUPS.some((g) => g.id === "gang" && g.label === "Gang"));
  const want = { "gang.enabled": true, "gang.dryRun": false, "gang.faction": "auto", "gang.bootstrapTimeoutMin": 60, "gang.trainUntil": 150, "gang.ascendMult": 1.5, "gang.ascendMaxRespectShare": 0.1,
    "gang.clashEngage": 0.6, "gang.clashDisengage": 0.5, "gang.warfareShare": 0.5, "gang.minDefForWar": 300, "gang.wantedPenaltyMax": 0.05, "gang.augSpendFraction": 0.2, "gang.equipmentSpendFraction": 0.1 };
  const d = defaults();
  for (const [k, v] of Object.entries(want)) { assert.equal(d[k], v, k); assert.equal(SCHEMA.find((f) => f.key === k).group, "gang"); assert.equal(SCHEMA.find((f) => f.key === k).owner, "gang"); }
  assert.equal(SCHEMA.filter((f) => f.group === "gang").length, Object.keys(want).length);
  assert.equal(coerce("gang.faction", "Tetrads").ok, true);
  assert.equal(coerce("gang.faction", "Daedalus").ok, false);
  assert.equal(coerce("gang.dryRun", "true").value, true);
  assert.equal(coerce("gang.clashEngage", 1.5).ok, false);
});

// ── dashboard KPIs ────────────────────────────────────────────────────────
const GANG = { t: NOW - 1000, inGang: true, phase: "territory", territory: 0.42, respectRate: 12.5, moneyRate: 3.2e6, errors: ["x failed", "y failed", "z failed"] };
const base = () => computeKpis({ latest, ring, ramStatus, augPlan, autopilot, pred2Tail, settings: defaults(), now: NOW });
test("kpi: gangTerritory / gangRespectPerSec / gangMoneyPerSec from data/gang-status.txt", () => {
  const r = computeKpis({ latest, ring, ramStatus, augPlan, autopilot, pred2Tail, gang: GANG, settings: defaults(), now: NOW });
  assert.equal(r.kpis.gangTerritory.value, 0.42);
  assert.match(r.kpis.gangTerritory.display, /42\.0%.*territory/);
  assert.equal(r.kpis.gangRespectPerSec.value, 12.5);
  assert.equal(r.kpis.gangMoneyPerSec.value, 3.2e6);
  assert.match(r.kpis.gangMoneyPerSec.display, /\/s$/);
  for (const k of GANG_KPI_KEYS) { const x = r.kpis[k]; assert.ok(["good", "warn"].includes(x.status), k); assert.ok(x.sources.every((s) => s.file === "data/gang-status.txt" && !s.missing) && x.formula, k); }
  assert.deepEqual(r.attention.filter((a) => /^gang:/.test(a.text)).map((a) => a.text), ["gang: x failed", "gang: y failed"], "first two gang errors surface");
  assert.equal(computeKpis({ gang: { ...GANG, territory: 1 }, settings: defaults(), now: NOW }).kpis.gangTerritory.status, "good");
  assert.equal(computeKpis({ gang: { ...GANG, t: NOW - 10 * 60000 }, settings: defaults(), now: NOW }).kpis.gangTerritory.status, "warn", "stale: gang.js not running");
  for (const k of KPI_KEYS) assert.ok(k in base().kpis, `existing KPI ${k} unchanged`);
});
test("kpi: empty state when the file is missing, garbage, or there is no gang", () => {
  for (const gang of [null, undefined, "garbage", 42, [], {}, { inGang: false, territory: 0.5 }, { inGang: true }]) {
    const r = computeKpis({ latest, ring, ramStatus, augPlan, autopilot, pred2Tail, gang, settings: defaults(), now: NOW });
    for (const k of GANG_KPI_KEYS) {
      if (gang && gang.inGang === true) continue;
      assert.equal(r.kpis[k].value, null, `${k} with ${JSON.stringify(gang)}`);
      assert.equal(r.kpis[k].status, "none");
      assert.equal(r.kpis[k].display, "—");
      assert.ok(r.kpis[k].sources[0].missing, "source flagged missing");
    }
  }
  const half = computeKpis({ gang: { inGang: true }, settings: defaults(), now: NOW });
  for (const k of GANG_KPI_KEYS) assert.ok(half.kpis[k].value == null || Number.isFinite(half.kpis[k].value), k);
});
test("data sources: the dashboard reads data/gang-status.txt every tick and offers it in Raw", () => {
  assert.equal(HOT_FILES.gang, "data/gang-status.txt");
  assert.ok(RAW_FILES.includes("data/gang-status.txt"));
});
test("GET /api/dashboard includes gang KPIs when the file exists, `bb dashboard` prints them only then", async () => {
  const files = { "data/telemetry-latest.txt": JSON.stringify(latest), "data/telemetry-ring.txt": ring.map((r) => JSON.stringify(r)).join("\n"), "data/ram-status.txt": JSON.stringify(ramStatus), "data/aug-plan.txt": JSON.stringify(augPlan),
    "data/autopilot-status.txt": JSON.stringify(autopilot), "data/settings.txt": "", "data/pred2.txt": "" };
  const api = (extra) => createDashboardApi({ rpc: async (op, a) => ({ ok: true, value: { ...files, ...extra }[a.file] ?? "" }), nowMs: () => NOW });
  const withGang = (await api({ "data/gang-status.txt": JSON.stringify(GANG) }).get()).value;
  assert.equal(withGang.kpis.gangTerritory.value, 0.42);
  assert.match(formatDashboard(withGang), /Gang territory/);
  const without = (await api({}).get()).value;
  assert.equal(without.kpis.gangTerritory.value, null);
  assert.doesNotMatch(formatDashboard(without), /Gang territory/);
  assert.ok("data/gang-status.txt" in without.bytes);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} gang-integration test(s) failed`); process.exit(1); }
console.log(`gang-integration: ${tests.length} passed`);
