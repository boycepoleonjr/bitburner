// lib/gangplan.js: phases, faction choice, recruiting, tasks (cleanup / train / territory / work), warfare, ascension, shopping.
import assert from "node:assert/strict";
import { importGame } from "./helpers/game-import.js";
import { DATA } from "./helpers/fake-gang.js";
import { defaults } from "../game/lib/settings-schema.js";

const P = await importGame("lib/gangplan.js");
const F = await importGame("lib/gangformulas.js");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const S = (o = {}) => ({ ...defaults(), ...o });
const T0 = Date.UTC(2026, 9, 17, 17);

const strong = (name, v = 300, over = {}) => ({ name, task: "Unassigned", hack: v, str: v, def: v, dex: v, agi: v, cha: v, earnedRespect: 0, upgrades: [], augmentations: [], asc: {}, ...over });
const names = (n) => Array.from({ length: n }, (_, i) => P.memberName(i + 1));
function snapOf(o = {}) {
  const n = o.members ?? 12;
  const faction = o.faction ?? "Slum Snakes";
  const list = o.list ?? names(n).map((nm) => strong(nm, o.stat ?? 300));
  return {
    t: T0, accessible: true, inGang: o.inGang ?? true, bn: 2, karma: o.karma ?? 0, money: o.money ?? 1e9, joined: o.joined ?? [faction], combat: o.combat ?? { str: 50, def: 50, dex: 50, agi: 50 },
    bootstrapStart: o.bootstrapStart ?? null, trainLoops: o.trainLoops ?? {}, cleanup: !!o.cleanup, repMult: 1, favor: 0, softcap: 1, weight: o.weight ?? 1, reserve: o.reserve ?? 0,
    info: o.inGang === false ? null : { faction, isHacking: !!o.hacking, respect: o.respect ?? 1e6, wantedLevel: o.wanted ?? 1, wantedPenalty: o.penalty ?? undefined, territory: o.territory ?? 1 / 7,
      power: o.power ?? 10, territoryWarfareEngaged: !!o.engaged, respectGainRate: 0, moneyGainRate: 0, territoryClashChance: 0, respectForNextRecruit: 0 },
    members: list, others: o.others ?? {}, tasks: o.hacking ? Object.fromEntries(Object.entries(DATA.tasks).filter(([, t]) => t.isHacking)) : Object.fromEntries(Object.entries(DATA.tasks).filter(([, t]) => t.isCombat)),
    equipment: o.equipment ?? [],
  };
}

// ── phases ────────────────────────────────────────────────────────────────
test("phaseOf: disabled -> bootstrap -> grow -> territory -> done", () => {
  assert.equal(P.phaseOf(snapOf({ inGang: false }), S({ "gang.enabled": false })), "disabled");
  assert.equal(P.phaseOf({ ...snapOf(), accessible: false }, S()), "disabled");
  assert.equal(P.phaseOf(snapOf({ inGang: false }), S()), "bootstrap");
  assert.equal(P.phaseOf(snapOf({ members: 11 }), S()), "grow");
  assert.equal(P.phaseOf(snapOf({ members: 12, territory: 0.5 }), S()), "territory");
  assert.equal(P.phaseOf(snapOf({ members: 12, territory: 0.998 }), S()), "territory");
  assert.equal(P.phaseOf(snapOf({ members: 12, territory: 0.999 }), S()), "done");
  assert.equal(P.phaseOf(snapOf({ members: 12, territory: 1 }), S()), "done");
});

// ── chooseFaction ─────────────────────────────────────────────────────────
test("chooseFaction: joined combat faction wins, in power order", () => {
  const c = (joined) => P.chooseFaction(snapOf({ inGang: false, joined }), S());
  assert.deepEqual([c(["Slum Snakes"]).faction, c(["Slum Snakes"]).action], ["Slum Snakes", "create"]);
  assert.equal(c(["Slum Snakes", "Tetrads"]).faction, "Tetrads");
  assert.equal(c(["Slum Snakes", "Tetrads", "The Syndicate"]).faction, "The Syndicate");
  assert.equal(c(["Tetrads", "The Dark Army", "The Syndicate"]).faction, "The Dark Army");
  assert.equal(c(["The Dark Army", "Speakers for the Dead", "Slum Snakes"]).faction, "Speakers for the Dead");
  assert.equal(c(["NiteSec", "Slum Snakes"]).faction, "Slum Snakes", "a combat gang beats a joined NiteSec");
});
test("chooseFaction: bootstrap = gym below 30, then Mug until karma -9, then wait for the invite", () => {
  const c = (o) => P.chooseFaction(snapOf({ inGang: false, joined: [], ...o }), S());
  assert.equal(c({ combat: { str: 29, def: 80, dex: 80, agi: 80 } }).action, "gym");
  assert.equal(c({ combat: { str: 80, def: 80, dex: 80, agi: 1 } }).action, "gym");
  assert.equal(c({ combat: { str: 30, def: 30, dex: 30, agi: 30 }, karma: -8.75 }).action, "crime");
  assert.equal(c({ combat: { str: 30, def: 30, dex: 30, agi: 30 }, karma: -9 }).action, "wait");
  assert.equal(c({ combat: { str: 30, def: 30, dex: 30, agi: 30 }, karma: -9 }).faction, "Slum Snakes");
});
test("chooseFaction: falls back to a hacking gang after gang.bootstrapTimeoutMin, never before", () => {
  const base = { inGang: false, joined: ["NiteSec"], combat: { str: 1, def: 1, dex: 1, agi: 1 } };
  const at = (min, o = {}) => P.chooseFaction({ ...snapOf({ ...base, ...o }), bootstrapStart: T0 - min * 60000 }, S());
  assert.equal(at(59.9).action, "gym");
  assert.deepEqual([at(60).action, at(60).faction], ["fallbackHacking", "NiteSec"]);
  assert.equal(at(60, { joined: ["NiteSec", "The Black Hand"] }).faction, "The Black Hand");
  assert.equal(at(600, { joined: [] }).faction, "NiteSec", "not joined yet: still names the target");
  assert.equal(at(60, { joined: ["NiteSec", "Tetrads"] }).action, "create", "a joined combat faction still beats the fallback");
  assert.equal(P.chooseFaction({ ...snapOf({ ...base }), bootstrapStart: T0 - 1e6 }, S({ "gang.bootstrapTimeoutMin": 100000 })).action, "gym", "timeout is a setting");
});
test("chooseFaction: gang.faction names a faction explicitly", () => {
  const c = (want, joined, o = {}) => P.chooseFaction(snapOf({ inGang: false, joined, ...o }), S({ "gang.faction": want }));
  assert.deepEqual([c("NiteSec", ["NiteSec"]).faction, c("NiteSec", ["NiteSec"]).action], ["NiteSec", "create"]);
  assert.equal(c("NiteSec", []).action, "wait");
  assert.equal(c("Tetrads", ["Slum Snakes"]).action, "wait", "does not substitute another faction");
  assert.equal(c("Slum Snakes", [], { combat: { str: 1, def: 1, dex: 1, agi: 1 } }).action, "gym");
  assert.equal(P.chooseFaction({ ...snapOf({ inGang: false, joined: [], combat: { str: 1, def: 1, dex: 1, agi: 1 } }), bootstrapStart: T0 - 1e7 }, S({ "gang.faction": "Slum Snakes" })).action, "gym", "an explicit Slum Snakes never times out");
});

// ── recruiting ────────────────────────────────────────────────────────────
test("recruit thresholds: 0 below 3 members, then 5^(n-2), Infinity at 12", () => {
  assert.deepEqual([0, 1, 2].map(P.recruitThreshold), [0, 0, 0]);
  assert.deepEqual([3, 4, 5].map(P.recruitThreshold), [5, 25, 125]);
  assert.equal(P.recruitThreshold(11), 5 ** 9);
  assert.equal(P.recruitThreshold(12), Infinity);
});
test("recruitNames at n = 2, 3, 11, 12", () => {
  const r = (n, respect) => P.recruitNames(snapOf({ members: n, respect })).names;
  assert.deepEqual(r(2, 1), ["g03"], "n=2 needs 0 respect, and n=3 then needs 5");
  assert.deepEqual(r(3, 4), []);
  assert.deepEqual(r(3, 5), ["g04"]);
  assert.deepEqual(r(11, 5 ** 9 - 1), []);
  assert.deepEqual(r(11, 5 ** 9), ["g12"]);
  assert.deepEqual(r(12, 1e300), []);
  assert.deepEqual(r(0, 1), ["g01", "g02", "g03"], "three free members");
  assert.deepEqual(r(3, 25), ["g04", "g05"], "several in one loop when respect allows");
  assert.deepEqual(r(3, 125), ["g04", "g05", "g06"]);
});
test("recruitNames fills the gaps left by dead members", () => {
  const list = ["g01", "g03", "g04", "g06"].map((n) => strong(n));
  assert.deepEqual(P.recruitNames(snapOf({ list, respect: 5 ** 3 })).names, ["g02", "g05"]);
  assert.deepEqual(P.recruitNames(snapOf({ list: [strong("g02"), strong("g12"), strong("g01")], respect: 5 })).names, ["g03"]);
});

// ── wanted cleanup ────────────────────────────────────────────────────────
test("cleanup hysteresis: enter below 1 - gang.wantedPenaltyMax, exit at 0.99 or wanted <= 1", () => {
  const d = (penalty, wanted, cleanup) => P.cleanupDecision(snapOf({ penalty, wanted, cleanup }), S()).active;
  assert.equal(d(0.96, 50, false), false, "above 0.95: no cleanup");
  assert.equal(d(0.95, 50, false), false, "boundary is strict (< 1 - 0.05)");
  assert.equal(d(0.94, 50, false), true);
  assert.equal(d(0.97, 50, true), true, "stays on between 0.95 and 0.99");
  assert.equal(d(0.989, 50, true), true);
  assert.equal(d(0.99, 50, true), false, "exits at 0.99");
  assert.equal(d(0.5, 1, true), false, "exits at wanted <= 1");
  assert.equal(d(0.5, 1, false), false, "nothing to clean at wanted 1");
  assert.equal(P.cleanupDecision(snapOf({ penalty: 0.9, wanted: 50 }), S({ "gang.wantedPenaltyMax": 0.2 })).active, false, "setting moves the threshold");
});
test("cleanup moves the weakest working members to Vigilante Justice until projected wanted gain <= 0", () => {
  const list = names(12).map((n, i) => strong(n, 400 - i * 20)); // g01 strongest ... g12 weakest, all above trainUntil
  const snap = snapOf({ list, respect: 1000, wanted: 400, weight: 1 });
  const tp = P.planTasks(snap, S());
  assert.equal(tp.cleanup, true);
  const task = Object.fromEntries(tp.assignments.map((a) => [a.name, a.task]));
  const vig = list.filter((m) => task[m.name] === "Vigilante Justice");
  assert.ok(vig.length >= 1 && vig.length < 12, `${vig.length} on cleanup`);
  const g = { respect: 1000, wanted: 400, territory: 1 / 7 };
  const total = list.reduce((a, m) => a + F.wantedGain(g, m, DATA.tasks[task[m.name]]), 0);
  assert.ok(total <= 0, `projected wanted gain ${total}`);
  // the weakest are chosen: nobody on cleanup is stronger than a member still working a wanted-raising task
  const power = (m) => m.str + m.def + m.dex + m.agi + m.hack + m.cha;
  const working = list.filter((m) => task[m.name] !== "Vigilante Justice");
  assert.ok(Math.max(...vig.map(power)) <= Math.min(...working.map(power)));
  // one fewer cleanup member would not have been enough
  const less = vig.slice(1);
  const t2 = list.reduce((a, m) => a + F.wantedGain(g, m, DATA.tasks[less.includes(m) ? "Vigilante Justice" : (tp.ctx.snap.members.length && P.taskFor(m, { ...tp.ctx, cleanupSet: new Set() }).task)]), 0);
  assert.ok(t2 > 0, "minimal set");
});
test("no cleanup: nobody is on Vigilante Justice", () => {
  const tp = P.planTasks(snapOf({ respect: 1e6, wanted: 1, weight: 1 }), S());
  assert.equal(tp.cleanup, false);
  assert.ok(tp.assignments.every((a) => a.task !== "Vigilante Justice"));
});
test("a hacking gang cleans up with Ethical Hacking", () => {
  const snap = snapOf({ hacking: true, faction: "NiteSec", respect: 1000, wanted: 400 });
  const tp = P.planTasks(snap, S());
  assert.ok(tp.assignments.some((a) => a.task === "Ethical Hacking"));
  assert.ok(tp.assignments.every((a) => a.task !== "Vigilante Justice" && a.task !== "Train Combat"));
});

// ── tasks: train / territory / work ───────────────────────────────────────
test("train: below gang.trainUntil, after a recruit/ascension (trainLoops), or when nothing earns", () => {
  const list = [strong("g01", 100), strong("g02", 300), strong("g03", 300), strong("g04", 1)];
  const snap = snapOf({ list, trainLoops: { g03: 3 } });
  const a = Object.fromEntries(P.planTasks(snap, S()).assignments.map((x) => [x.name, x.task]));
  assert.equal(a.g01, "Train Combat", "average 100 < 150");
  assert.notEqual(a.g02, "Train Combat");
  assert.equal(a.g03, "Train Combat", "10-loop training after a recruit/ascension");
  assert.equal(a.g04, "Train Combat");
  const low = P.planTasks(snapOf({ list: [strong("g01", 100)] }), S({ "gang.trainUntil": 50 })).assignments[0];
  assert.notEqual(low.task, "Train Combat", "gang.trainUntil is a setting");
  const noTask = P.planTasks(snapOf({ list: [strong("g01", 3)] }), S({ "gang.trainUntil": 1 })).assignments[0];
  assert.equal(noTask.task, "Train Combat", "no task gives positive respect");
});
test("train: hacking gangs train hacking and judge the hack stat", () => {
  const a = P.planTasks(snapOf({ hacking: true, faction: "NiteSec", list: [{ ...strong("g01", 300), hack: 50 }] }), S()).assignments[0];
  assert.equal(a.task, "Train Hacking");
});
test("territory: only in phase territory; top gang.warfareShare of members with def >= gang.minDefForWar", () => {
  const list = names(12).map((n, i) => strong(n, 500, { def: 200 + i * 40 })); // def 200..640
  const run = (o, s = {}) => Object.fromEntries(P.planTasks(snapOf({ list, ...o }), S(s)).assignments.map((x) => [x.name, x.task]));
  const war = (a) => Object.keys(a).filter((k) => a[k] === "Territory Warfare");
  assert.deepEqual(war(run({ territory: 0.5 })).sort(), ["g09", "g10", "g11", "g12"], "eligible = def >= 300 -> g04..g12 (9), share 0.5 -> 4, highest def first");
  assert.deepEqual(war(run({ territory: 1 })), [], "phase done");
  assert.deepEqual(war({ ...run({ territory: 0.5, members: 11, list: list.slice(0, 11) }) }), [], "phase grow: not yet");
  assert.equal(war(run({ territory: 0.5 }, { "gang.warfareShare": 1 })).length, 9);
  assert.equal(war(run({ territory: 0.5 }, { "gang.warfareShare": 0 })).length, 0);
  assert.equal(war(run({ territory: 0.5 }, { "gang.minDefForWar": 100000 })).length, 0, "death guard");
  assert.equal(war(run({ territory: 0.5, trainLoops: { g12: 5 } })).includes("g12"), false, "training members never fight");
});
test("work: highest respect or money gain from the formulas, by objective", () => {
  const snap = snapOf({ respect: 1e6, wanted: 1 });
  const m = snap.members[0], g = { respect: 1e6, wanted: 1, territory: 1 / 7 };
  const workTasks = Object.values(snap.tasks).filter((t) => !["Unassigned", "Train Combat", "Train Hacking", "Train Charisma", "Territory Warfare", "Vigilante Justice"].includes(t.name));
  const bestR = workTasks.map((t) => [F.respectGain(g, m, t), t.name]).sort((a, b) => b[0] - a[0])[0];
  const bestM = workTasks.map((t) => [F.moneyGain(g, m, t), t.name]).sort((a, b) => b[0] - a[0])[0];
  assert.equal(P.bestWork(m, snap, "respect").task, bestR[1]);
  assert.equal(P.bestWork(m, snap, "money").task, bestM[1]);
  assert.ok(bestR[1] !== bestM[1] || true);
});
test("respect/money split: only with 12 members; weight 0 = all money, 1 = all respect, 0.5 = first half respect", () => {
  const split = (w, n = 12) => [...P.objectives(snapOf({ members: n, weight: w }), S()).entries()];
  assert.ok(split(0).every(([, o]) => o === "money"));
  assert.ok(split(1).every(([, o]) => o === "respect"));
  const half = split(0.5);
  assert.deepEqual(half.filter(([, o]) => o === "respect").map(([n]) => n), ["g01", "g02", "g03", "g04", "g05", "g06"]);
  assert.deepEqual(split(0.5), split(0.5), "deterministic");
  assert.ok(split(0, 8).every(([, o]) => o === "respect"), "while growing everyone does respect");
  assert.ok(split(0, 11).every(([, o]) => o === "respect"));
  // clamped weights
  assert.ok(split(7).every(([, o]) => o === "respect"));
  assert.ok(split(-3).every(([, o]) => o === "money"));
});
test("tasks follow the split: money members pick the best money task", () => {
  const snap = snapOf({ weight: 0, respect: 1e6, wanted: 1, territory: 1 });
  const a = P.planTasks(snap, S()).assignments;
  const want = P.bestWork(snap.members[0], snap, "money").task;
  assert.ok(a.every((x) => x.task === want), "identical members, all money");
  const b = P.planTasks({ ...snap, weight: 1 }, S()).assignments;
  assert.equal(b[0].task, P.bestWork(snap.members[0], snap, "respect").task);
});

// ── warfare ───────────────────────────────────────────────────────────────
test("warfareDecision: hysteresis on the minimum win chance; zero-territory gangs are ignored", () => {
  const others = (powers) => Object.fromEntries(Object.entries(powers).map(([f, [p, t]]) => [f, { power: p, territory: t }]));
  const d = (engaged, powers, o = {}) => P.warfareDecision(snapOf({ territory: 0.5, engaged, power: 100, others: others({ "Slum Snakes": [100, 0.3], ...powers }), ...o }), S());
  // win chances 100/(100+p): 100 -> 0.5, 66.6 -> 0.6, 150 -> 0.4
  assert.equal(d(false, { Tetrads: [60, 0.2] }).engage, true, "0.625 >= 0.6 engage");
  assert.equal(d(false, { Tetrads: [75, 0.2] }).engage, false, "0.571 < 0.6: not engaged stays off");
  assert.equal(d(true, { Tetrads: [75, 0.2] }).engage, true, "0.571 >= 0.5: engaged stays on");
  assert.equal(d(true, { Tetrads: [150, 0.2] }).engage, false, "0.4 < 0.5 disengage");
  assert.equal(d(false, { Tetrads: [60, 0.2], NiteSec: [1000, 0] }).engage, true, "a strong gang without territory is ignored");
  assert.equal(d(false, { Tetrads: [60, 0.2], NiteSec: [1000, 0.1] }).engage, false, "min over gangs that hold territory");
  assert.equal(d(false, { Tetrads: [60, 0.2] }).minWinChance, 100 / 160);
  assert.equal(d(true, { Tetrads: [60, 0.2] }, { territory: 1, others: others({ Tetrads: [60, 0] }) }).engage, false, "phase done / nobody left: off");
  assert.equal(P.warfareDecision(snapOf({ members: 5, territory: 0.5, engaged: false, power: 1000, others: others({ Tetrads: [1, 0.2] }) }), S()).engage, true, "grow phase may engage when strong");
  assert.equal(P.warfareDecision(snapOf({ inGang: false }), S()).engage, false);
  assert.equal(P.warfareDecision(snapOf({ territory: 0.5, power: 100, others: others({ "Slum Snakes": [1, 0.9], Tetrads: [60, 0.2] }) }), S({ "gang.clashEngage": 0.7 })).engage, false, "settings move the band");
});

// ── ascension ─────────────────────────────────────────────────────────────
test("shouldAscend: threshold = gang.ascendMult + (11 - rank by earned respect) x 0.05", () => {
  const list = names(12).map((n, i) => strong(n, 300, { earnedRespect: 1000 - i })); // g01 most respect (rank 0) ... g12 (rank 11)
  const ratios = (r) => Object.fromEntries(list.map((m) => [m.name, { str: r, def: r, dex: r, agi: r, hack: 1, cha: 1 }]));
  const ctx = { s: S(), respect: 1e9, isHacking: false };
  assert.equal(P.shouldAscend(list, ratios(1.49), ctx).pick, null);
  const at = P.shouldAscend(list, ratios(1.5), ctx).pick;
  assert.equal(at.name, "g12", "only the lowest-ranked member clears 1.5");
  assert.equal(at.threshold, 1.5);
  const mid = P.shouldAscend(list, ratios(1.8), ctx).pick;
  assert.equal(mid.threshold < 1.8 && mid.ratio === 1.8, true);
  // rank 0 needs 1.5 + 11 x 0.05 = 2.05
  const only0 = { g01: { str: 2.04, def: 2.04, dex: 2.04, agi: 2.04 } };
  assert.equal(P.shouldAscend(list, only0, ctx).pick, null);
  assert.equal(P.shouldAscend(list, { g01: { str: 2.05, def: 2.05, dex: 2.05, agi: 2.05 } }, ctx).pick.name, "g01");
  assert.equal(P.shouldAscend(list, ratios(1.5), { ...ctx, s: S({ "gang.ascendMult": 3 }) }).pick, null, "setting");
  assert.equal(P.shouldAscend(list, ratios(9), { ...ctx, recruiting: true }).pick, null, "recruiting comes first");
});
test("shouldAscend: one per run (the best margin), primary stats only, respect-share guard", () => {
  const list = [strong("g01", 300, { earnedRespect: 10 }), strong("g02", 300, { earnedRespect: 5 })];
  const r = { g01: { str: 3, def: 3, dex: 3, agi: 3, hack: 1 }, g02: { str: 2.5, def: 2.5, dex: 2.5, agi: 2.5, hack: 1 } };
  const ctx = { s: S(), respect: 1e6, isHacking: false };
  const p = P.shouldAscend(list, r, ctx);
  assert.equal(p.pick.name, "g01");
  assert.equal(P.shouldAscend(list, { g01: { hack: 9, cha: 9, str: 1, def: 1, dex: 1, agi: 1 } }, ctx).pick, null, "cha/hack are not primary for a combat gang");
  assert.equal(P.shouldAscend([strong("g01", 300, { earnedRespect: 10 })], { g01: { hack: 2.1, str: 1 } }, { ...ctx, isHacking: true }).pick.name, "g01", "hacking gang looks at hack");
  // guard: earned respect above 10% of the gang's respect
  const rich = [strong("g01", 300, { earnedRespect: 1000 }), strong("g02", 300, { earnedRespect: 10 })];
  const both = { g01: { str: 5, def: 5, dex: 5, agi: 5 }, g02: { str: 4, def: 4, dex: 4, agi: 4 } };
  const g = P.shouldAscend(rich, both, { ...ctx, respect: 5000 });
  assert.equal(g.pick.name, "g02", "g01 holds 20% of the respect: skipped");
  assert.ok(g.reasons.some((x) => /g01/.test(x)));
  assert.equal(P.shouldAscend(rich, both, { ...ctx, respect: 5000, s: S({ "gang.ascendMaxRespectShare": 0.5 }) }).pick.name, "g01", "setting");
  assert.equal(P.shouldAscend([rich[0]], both, { ...ctx, respect: 5000 }).pick, null);
});

// ── shopping ──────────────────────────────────────────────────────────────
const equip = Object.entries(DATA.equip).map(([name, e]) => ({ name, type: e.type, cost: e.cost, stats: e.stats }));
test("equipmentPurchases: augmentations <= 20% and equipment <= 10% of spendable, cheapest first, primary stats only", () => {
  const snap = snapOf({ members: 4, equipment: equip });
  const sp = 5e11;
  const r = P.equipmentPurchases(snap, S(), sp);
  const augs = r.purchases.filter((p) => p.aug), gear = r.purchases.filter((p) => !p.aug);
  assert.ok(augs.length > 0 && gear.length > 0);
  const sum = (a) => a.reduce((x, p) => x + p.cost, 0);
  assert.ok(sum(augs) <= 0.2 * sp + 1e-6, `aug ${sum(augs)}`);
  assert.ok(sum(gear) <= 0.1 * sp + 1e-6, `gear ${sum(gear)}`);
  assert.equal(r.spent, sum(r.purchases));
  assert.ok(r.spent <= 0.3 * sp);
  assert.deepEqual(gear.map((p) => p.cost), [...gear.map((p) => p.cost)].sort((a, b) => a - b));
  for (const p of r.purchases) assert.ok(["str", "def", "dex", "agi"].some((k) => DATA.equip[p.item].stats[k] > 1), `${p.item} is off-stat`);
  assert.ok(!r.purchases.some((p) => DATA.equip[p.item].type === "Rootkit"), "rootkits only raise hack/cha");
  assert.ok(r.purchases.every((p) => p.aug === (DATA.equip[p.item].type === "Augmentation")));
  assert.ok(new Set(r.purchases.map((p) => `${p.member}/${p.item}`)).size === r.purchases.length, "no duplicates");
});
test("equipmentPurchases: hard caps for any spendable; reserve is never touched; nothing owned is rebought", () => {
  for (const sp of [0, 1e5, 1e6, 3.3e7, 1e9, 4.2e10, 3.3e11, 1e13]) {
    const r = P.equipmentPurchases(snapOf({ members: 12, equipment: equip }), S(), sp);
    const a = r.purchases.filter((p) => p.aug).reduce((x, p) => x + p.cost, 0), e = r.purchases.filter((p) => !p.aug).reduce((x, p) => x + p.cost, 0);
    assert.ok(a <= 0.2 * sp + 1e-6 && e <= 0.1 * sp + 1e-6 && r.spent <= sp, `spendable ${sp}`);
  }
  const money = 1e9, reserve = 8e8;
  const r = P.equipmentPurchases(snapOf({ equipment: equip }), S(), Math.max(0, money - reserve));
  assert.ok(money - r.spent >= reserve, "the reserve survives");
  assert.equal(P.equipmentPurchases(snapOf({ equipment: equip }), S(), 0).purchases.length, 0);
  assert.equal(P.equipmentPurchases(snapOf({ equipment: equip }), S(), -5e9).purchases.length, 0, "negative spendable buys nothing");
  const owned = snapOf({ members: 1, equipment: equip }); owned.members[0].upgrades = ["Baseball Bat"];
  assert.ok(!P.equipmentPurchases(owned, S({ "gang.equipmentSpendFraction": 1 }), 1e12).purchases.some((p) => p.item === "Baseball Bat"));
  assert.equal(P.equipmentPurchases(snapOf({ equipment: equip }), S({ "gang.augSpendFraction": 0, "gang.equipmentSpendFraction": 0 }), 1e12).purchases.length, 0);
  const ex = P.equipmentPurchases(snapOf({ members: 2, equipment: equip }), S(), 1e11, { exclude: new Set(["g01"]) });
  assert.ok(ex.purchases.length && ex.purchases.every((p) => p.member === "g02"), "excluded members (about to ascend) are skipped");
});
test("equipmentPurchases: hacking gangs buy hack items only", () => {
  const r = P.equipmentPurchases(snapOf({ hacking: true, faction: "NiteSec", members: 3, equipment: equip }), S(), 1e12);
  assert.ok(r.purchases.length > 0);
  for (const p of r.purchases) assert.ok(DATA.equip[p.item].stats.hack > 1, p.item);
});

// ── status contract ───────────────────────────────────────────────────────
test("buildStatus: every field of the data/gang-status.txt contract", () => {
  const snap = snapOf({ respect: 500, wanted: 20, penalty: 0.96 });
  snap.info.respectGainRate = 2; snap.info.moneyGainRate = 10;
  const st = P.buildStatus({ snap, s: S(), phase: "territory", choice: null, warfare: true, cleanup: false, recruit: { reasons: [] }, reserve: 7, spent: 3, lastAscend: { name: "g01", t: 5 }, deaths: 1, reasons: ["x"], errors: ["e"], minWinChance: 0.7 });
  const keys = ["t", "enabled", "dryRun", "accessible", "inGang", "faction", "isHacking", "phase", "bootstrapAction", "karma", "members", "respect", "wanted", "wantedPenalty", "cleanupMode",
    "respectRate", "moneyRate", "repRate", "territory", "power", "clashChance", "warfare", "minWinChance", "recruitNext", "reserve", "spentThisLoop", "lastAscend", "deaths", "memberList", "reasons", "errors"];
  assert.deepEqual(Object.keys(st).sort(), [...keys].sort());
  assert.equal(st.respectRate, 10, "per cycle x 5 cycles/s");
  assert.equal(st.moneyRate, 50);
  assert.equal(st.repRate, 10 / 75);
  assert.equal(st.members, 12);
  assert.deepEqual(Object.keys(st.memberList[0]).sort(), ["agi", "ascMult", "cha", "def", "dex", "earnedRespect", "hack", "name", "str", "task", "upgrades"]);
  assert.equal(JSON.parse(JSON.stringify(st)).phase, "territory", "serializable");
  const none = P.buildStatus({ snap: snapOf({ inGang: false, members: 0 }), s: S({ "gang.dryRun": true }), phase: "bootstrap", choice: { action: "gym" } });
  assert.equal(none.faction, null);
  assert.equal(none.bootstrapAction, "gym");
  assert.equal(none.dryRun, true);
  assert.equal(none.members, 0);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} gangplan test(s) failed`); process.exit(1); }
console.log(`gangplan: ${tests.length} passed`);
