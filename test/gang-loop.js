// agent/gang.js against a fake ns (test/helpers/fake-gang.js): bootstrap -> create -> recruit -> tasks -> shop, kill switch, dry run, failures.
import assert from "node:assert/strict";
import { importGame } from "./helpers/game-import.js";
import { fakeGang, settingsFile, MUTATING, DATA } from "./helpers/fake-gang.js";
import { defaults } from "../game/lib/settings-schema.js";

const GANG = await importGame("agent/gang.js");
const PLAN = await importGame("lib/gangplan.js");
const ACT = await importGame("agent/gang-act.js");
const SHOP = await importGame("agent/gang-shop.js");
const INFO = await importGame("agent/gang-info.js");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const scripts = { "agent/gang-act.js": ACT.main, "agent/gang-shop.js": SHOP.main, "agent/gang-info.js": INFO.main, "agent/gang.js": GANG.main };
const S = (o = {}) => ({ ...defaults(), ...o });
const newState = (ns) => { ns.write("data/gang-state.txt", "", "w"); return GANG.step && { v: 1, bootstrapStart: null, trainLoops: {}, lastAscend: null, deaths: 0, names: [], cleanup: false, loop: 0, seenAct: 0, seenShop: 0 }; };
const status = (g) => JSON.parse(g.files["data/gang-status.txt"]);
const mutating = (g) => g.calls.filter((c) => MUTATING.has(c));
const members = (n, stat = 300, over = {}) => Array.from({ length: n }, (_, i) => ({ name: `g${String(i + 1).padStart(2, "0")}`, str: stat, def: stat, dex: stat, agi: stat, hack: stat, cha: stat, ...over }));

test("bootstrap: creates the gang once Slum Snakes is joined (BN2, no karma needed)", async () => {
  const g = fakeGang({ bn: 2, joined: [], scripts, karma: 0 });
  const st = newState(g.ns);
  let s = await GANG.step(g.ns, st, S());
  assert.equal(s.phase, "bootstrap");
  assert.equal(s.bootstrapAction, "gym", "combat stats are 1");
  assert.equal(g.gang, null);
  assert.equal(mutating(g).length, 0);
  assert.ok(st.bootstrapStart > 0, "bootstrap clock started");
  g.joined.push("Slum Snakes");
  s = await GANG.step(g.ns, st, S());
  assert.ok(g.gang, "gang created");
  assert.equal(g.gang.faction, "Slum Snakes");
  assert.equal(g.gang.isHacking, false);
  assert.deepEqual(g.runs.map((r) => r[0]), ["agent/gang-act.js"]);
  s = await GANG.step(g.ns, st, S());
  assert.equal(s.inGang, true);
  assert.equal(s.faction, "Slum Snakes");
  assert.equal(s.phase, "grow");
  assert.equal(g.gang.members.length, 3, "three free members");
});
test("bootstrap: no gang outside BN2 without SF2 + karma <= -54000", async () => {
  const g = fakeGang({ bn: 1, joined: ["Slum Snakes"], scripts });
  const s = await GANG.step(g.ns, newState(g.ns), S());
  assert.equal(s.accessible, false);
  assert.equal(s.phase, "disabled");
  assert.equal(g.gang, null);
  assert.equal(mutating(g).length, 0);
  const g2 = fakeGang({ bn: 1, joined: ["Slum Snakes"], scripts, ownedSF: [2], karma: -54000 });
  assert.equal((await GANG.step(g2.ns, newState(g2.ns), S())).accessible, true);
  assert.equal(PLAN.gangPossible({ bn: 1, inGang: false, ownedSF: new Map() }), false);
  assert.equal(PLAN.gangPossible({ bn: 2, inGang: false, ownedSF: new Map() }), true);
  assert.equal(PLAN.gangPossible({ bn: 1, inGang: true, ownedSF: new Map() }), true);
  assert.equal(PLAN.gangPossible({ bn: 1, inGang: false, ownedSF: new Map([[2, 1]]) }), true);
});
test("fallback: creates a hacking gang on NiteSec after the timeout", async () => {
  const g = fakeGang({ bn: 2, joined: ["NiteSec"], scripts });
  const st = newState(g.ns);
  await GANG.step(g.ns, st, S());
  assert.equal(g.gang, null, "still bootstrapping Slum Snakes");
  st.bootstrapStart = Date.now() - 61 * 60000;
  await GANG.step(g.ns, st, S());
  assert.equal(g.gang?.faction, "NiteSec");
  assert.equal(g.gang?.isHacking, true);
});
test("grow: recruits up to 12 as respect allows, with a task for everyone", async () => {
  const g = fakeGang({ bn: 2, scripts, gang: { faction: "Slum Snakes", respect: 5 ** 11, members: members(3, 1) } });
  const st = newState(g.ns);
  const s = await GANG.step(g.ns, st, S());
  assert.equal(g.gang.members.length, 12);
  assert.deepEqual(g.gang.members.map((m) => m.name), Array.from({ length: 12 }, (_, i) => `g${String(i + 1).padStart(2, "0")}`));
  await GANG.step(g.ns, st, S());
  assert.ok(g.gang.members.every((m) => m.task !== "Unassigned"));
  assert.ok(g.gang.members.slice(3).every((m) => m.task === "Train Combat"), "fresh recruits train first");
  assert.equal(s.phase, "grow");
});
test("grow: respect gates recruiting (5^(n-2))", async () => {
  const g = fakeGang({ bn: 2, scripts, gang: { faction: "Slum Snakes", respect: 24, members: members(4, 300) } });
  const st = newState(g.ns);
  await GANG.step(g.ns, st, S());
  assert.equal(g.gang.members.length, 4, "n=4 needs 25");
  g.gang.respect = 25;
  await GANG.step(g.ns, st, S());
  assert.equal(g.gang.members.length, 5);
});
test("tasks: setMemberTask only when the task changes; warfare only when it changes", async () => {
  const g = fakeGang({ bn: 2, scripts, gang: { faction: "Slum Snakes", respect: 1e6, members: members(12, 300, { def: 400 }), territory: 0.5, power: 1000 } });
  g.others.Tetrads = { power: 10, territory: 0.2 };
  const st = newState(g.ns);
  await GANG.step(g.ns, st, S());
  const first = g.calls.filter((c) => c === "setMemberTask").length;
  assert.equal(first, 12);
  assert.equal(g.gang.engaged, true, "win chance far above 0.6 engages");
  const before = g.calls.length;
  await GANG.step(g.ns, st, S());
  assert.equal(g.calls.slice(before).filter((c) => c === "setMemberTask" || c === "setTerritoryWarfare").length, 0, "steady state: no writes");
  assert.deepEqual(g.runs.filter((r) => r[0] === "agent/gang-act.js").length, 1, "one act run only");
  g.others.Tetrads.power = 1e9; // rival suddenly dwarfs us -> disengage
  const b2 = g.calls.length;
  await GANG.step(g.ns, st, S());
  assert.equal(g.calls.slice(b2).filter((c) => c === "setTerritoryWarfare").length, 1);
  assert.equal(g.gang.engaged, false);
});
test("status: written every loop with the full contract and live member data", async () => {
  const g = fakeGang({ bn: 2, scripts, gang: { faction: "Slum Snakes", respect: 1e6, members: members(12, 300) } });
  const s = await GANG.step(g.ns, newState(g.ns), S());
  assert.deepEqual(JSON.parse(g.files["data/gang-status.txt"]), JSON.parse(JSON.stringify(s)));
  for (const k of ["t", "enabled", "dryRun", "accessible", "inGang", "faction", "isHacking", "phase", "bootstrapAction", "karma", "members", "respect", "wanted", "wantedPenalty", "cleanupMode", "respectRate", "moneyRate", "repRate", "territory", "power", "clashChance", "warfare", "minWinChance", "recruitNext", "reserve", "spentThisLoop", "lastAscend", "deaths", "memberList", "reasons", "errors"]) assert.ok(k in s, k);
  assert.equal(s.memberList.length, 12);
  assert.equal(s.memberList[0].name, "g01");
  assert.ok(g.files["data/gang-tasks.txt"], "static task cache written by gang-info.js");
  const c = JSON.parse(g.files["data/gang-tasks.txt"]);
  assert.equal(c.isHacking, false);
  assert.ok(c.tasks["Mug People"] && c.equip["Katana"].type === "Weapon");
  assert.equal(g.runs.filter((r) => r[0] === "agent/gang-info.js").length, 1);
  await GANG.step(g.ns, newState(g.ns), S());
  assert.equal(g.runs.filter((r) => r[0] === "agent/gang-info.js").length, 1, "cached after the first time");
});
test("kill switch: gang.enabled=false makes no gang calls at all and the script exits", async () => {
  const g = fakeGang({ bn: 2, joined: ["Slum Snakes"], scripts, files: { "data/settings.txt": settingsFile({ "gang.enabled": false }) } });
  await GANG.main(g.ns);
  assert.deepEqual(g.calls, []);
  assert.equal(g.gang, null);
  assert.equal(status(g).phase, "disabled");
  const g2 = fakeGang({ bn: 2, scripts, files: { "data/settings.txt": settingsFile({ "gang.enabled": false }) }, gang: { faction: "Tetrads", members: members(3) } });
  await GANG.main(g2.ns);
  assert.deepEqual(g2.calls, [], "even with a gang running");
  assert.deepEqual(g2.runs, []);
});
test("dry run: decisions are logged, nothing mutates, no act/shop one-shots", async () => {
  const g = fakeGang({ bn: 2, joined: ["Slum Snakes"], scripts, money: 1e12, files: { "data/settings.txt": settingsFile({ "gang.dryRun": true }) } });
  const st = newState(g.ns);
  const dry = S({ "gang.dryRun": true });
  let s = await GANG.step(g.ns, st, dry);
  assert.equal(g.gang, null, "would create, did not");
  assert.ok(s.reasons.some((r) => /dryRun: would apply .*create/.test(r)), s.reasons.join("|"));
  assert.equal(s.dryRun, true);
  g.startGang("Slum Snakes", { respect: 5 ** 11, members: members(3, 300) });
  for (let i = 0; i < 16; i++) s = await GANG.step(g.ns, st, dry);
  assert.deepEqual(mutating(g), [], "no mutating gang call in dry run");
  assert.equal(g.gang.members.length, 3, "no recruit");
  assert.ok(g.runs.every((r) => r[0] === "agent/gang-info.js"), `only the read-only cache job runs: ${g.runs.map((r) => r[0])}`);
  assert.ok(s.reasons.some((r) => /dryRun: would apply/.test(r)));
  assert.equal(g.log.filter((l) => l[0] === "buy").length, 0);
});
test("failures: a throwing ns call is reported in errors[] and the loop carries on", async () => {
  const g = fakeGang({ bn: 2, scripts, gang: { faction: "Slum Snakes", respect: 1e6, members: members(12, 300) } });
  const st = newState(g.ns);
  g.throwOn.add("getAllGangInformation");
  let s = await GANG.step(g.ns, st, S());
  assert.ok(s.errors.some((e) => /getAllGangInformation/.test(e)), s.errors.join("|"));
  assert.equal(s.members, 12, "the rest of the loop still ran");
  g.throwOn.clear(); g.throwOn.add("getMemberInformation");
  s = await GANG.step(g.ns, st, S());
  assert.ok(s.errors.length >= 12);
  g.throwOn.clear(); g.throwOn.add("getGangInformation");
  s = await GANG.step(g.ns, st, S());
  assert.ok(s.errors.some((e) => /getGangInformation/.test(e)));
  g.throwOn.clear(); g.throwOn.add("setMemberTask");
  const g2 = fakeGang({ bn: 2, scripts, gang: { faction: "Slum Snakes", respect: 1e6, members: members(3, 300) } });
  g2.throwOn.add("setMemberTask");
  await GANG.step(g2.ns, newState(g2.ns), S());
  const s2 = await GANG.step(g2.ns, newState(g2.ns), S());
  assert.ok(s2.errors.some((e) => /setMemberTask/.test(e)), "act failures surface on the next loop: " + s2.errors.join("|"));
  g.throwOn.clear();
  s = await GANG.step(g.ns, st, S());
  assert.deepEqual(s.errors, [], "recovers");
});
test("failures: no RAM for a one-shot is an error, retried next loop", async () => {
  const g = fakeGang({ bn: 2, scripts, gang: { faction: "Slum Snakes", respect: 1e6, members: members(3, 300) } });
  const st = newState(g.ns);
  g.noRam = true;
  const s = await GANG.step(g.ns, st, S());
  assert.ok(s.errors.some((e) => /not enough RAM/.test(e)));
  g.noRam = false;
  await GANG.step(g.ns, st, S());
  await GANG.step(g.ns, st, S());
  assert.ok(g.gang.members.length > 3 && g.gang.members.every((m) => m.task !== "Unassigned"));
});
test("single instance: a second copy exits without touching the game", async () => {
  const g = fakeGang({ bn: 2, scripts, gang: { faction: "Slum Snakes", members: members(3) } });
  g.procs.set(50, { pid: 50, script: "agent/gang.js" });
  await GANG.main(g.ns);
  assert.deepEqual(g.calls, []);
  assert.equal(g.files["data/gang-status.txt"], undefined);
});
test("main loop: runs until disabled, using nextUpdate in a gang and a short sleep before one", async () => {
  const g = fakeGang({ bn: 2, scripts, gang: { faction: "Slum Snakes", respect: 1e6, members: members(12, 300) } });
  g.files["data/settings.txt"] = settingsFile({});
  const done = GANG.main(g.ns);
  for (let i = 0; i < 50 && (g.ticks || 0) < 3; i++) await new Promise((r) => setImmediate(r));
  assert.ok((g.ticks || 0) >= 3, "kept looping");
  g.files["data/settings.txt"] = settingsFile({ "gang.enabled": false });
  await done;
  assert.equal(status(g).phase, "disabled", "exits within one loop of the switch");
});
test("dead members: counted from the member list and the name is reused", async () => {
  const g = fakeGang({ bn: 2, scripts, gang: { faction: "Slum Snakes", respect: 5 ** 11, members: members(12, 300) } });
  const st = newState(g.ns);
  await GANG.step(g.ns, st, S());
  g.gang.members = g.gang.members.filter((m) => m.name !== "g05");
  const s = await GANG.step(g.ns, st, S());
  assert.equal(s.deaths, 1);
  assert.ok(g.gang.members.some((m) => m.name === "g05"), "recruited again");
  assert.equal((await GANG.step(g.ns, st, S())).deaths, 1, "counted once");
});
test("shop: every 15 loops, budgets and the planner's reserve are respected", async () => {
  const money = 1e12, reserve = 9.5e11;
  const g = fakeGang({ bn: 2, scripts, money, gang: { faction: "Slum Snakes", respect: 1e6, members: members(12, 300) } });
  g.files["data/aug-plan.txt"] = JSON.stringify({ t: Date.now(), phase: "late", nextPurchaseCost: reserve });
  const st = newState(g.ns);
  let s;
  for (let i = 0; i < 14; i++) s = await GANG.step(g.ns, st, S());
  assert.equal(g.runs.filter((r) => r[0] === "agent/gang-shop.js").length, 0, "not before the 15th loop");
  s = await GANG.step(g.ns, st, S());
  assert.equal(g.runs.filter((r) => r[0] === "agent/gang-shop.js").length, 1);
  const spent = money - g.money;
  assert.ok(spent > 0 && spent <= 0.3 * (money - reserve) + 1e-6, `spent ${spent}`);
  assert.ok(g.money >= reserve, "reserve intact");
  assert.equal(s.reserve, reserve);
  assert.ok(s.spentThisLoop > 0 && s.spentThisLoop <= 0.3 * (money - reserve));
  for (let i = 0; i < 15; i++) await GANG.step(g.ns, st, S());
  assert.equal(g.runs.filter((r) => r[0] === "agent/gang-shop.js").length, 2, "again 15 loops later");
  assert.ok(g.money >= reserve);
  // stale plans are ignored
  const g2 = fakeGang({ bn: 2, scripts, money, gang: { faction: "Slum Snakes", respect: 1e6, members: members(12, 300) } });
  g2.files["data/aug-plan.txt"] = JSON.stringify({ t: Date.now() - 3600e3, phase: "late", nextPurchaseCost: reserve });
  const st2 = newState(g2.ns);
  let s2; for (let i = 0; i < 15; i++) s2 = await GANG.step(g2.ns, st2, S());
  assert.equal(s2.reserve, 0);
});
test("shop: ascends one member, remembers it, and retrains it", async () => {
  const list = members(12, 300).map((m) => ({ ...m, earnedRespect: 10, hack_exp: 0, str_exp: 0, def_exp: 0, dex_exp: 0, agi_exp: 0 }));
  list[11] = { ...list[11], str_exp: 9000, def_exp: 9000, dex_exp: 9000, agi_exp: 9000 }; // 4x points -> big ratio
  const g = fakeGang({ bn: 2, scripts, money: 1e6, gang: { faction: "Slum Snakes", respect: 1e6, members: list } });
  const st = newState(g.ns);
  let s;
  for (let i = 0; i < 15; i++) s = await GANG.step(g.ns, st, S());
  assert.equal(g.runs.filter((r) => r[0] === "agent/gang-shop.js").length, 1);
  const m = g.gang.members.find((x) => x.name === "g12");
  assert.equal(m.str_exp, 0, "ascended");
  assert.ok(m.str_asc_points > 0);
  assert.equal(g.gang.members.filter((x) => x.str_asc_points > 0).length, 1, "only one per run");
  s = await GANG.step(g.ns, st, S());
  assert.equal(s.lastAscend?.name, "g12");
  assert.equal(g.gang.members.find((x) => x.name === "g12").task, "Train Combat", "retrains after an ascension");
});
test("shop: no ascension in a run where a recruit is possible (recruiting comes first)", async () => {
  const list = members(10, 300).map((m) => ({ ...m, earnedRespect: 1, str_exp: 90000, def_exp: 90000, dex_exp: 90000, agi_exp: 90000 }));
  const g = fakeGang({ bn: 2, scripts, money: 1e6, gang: { faction: "Slum Snakes", respect: 5 ** 8, members: list } });
  const st = newState(g.ns);
  for (let i = 0; i < 14; i++) await GANG.step(g.ns, st, S());
  assert.equal(g.gang.members.length, 11, "g11 recruited on loop 1; g12 needs 5^9");
  g.gang.respect = 5 ** 9;
  await GANG.step(g.ns, st, S()); // loop 15: shop run, but a recruit is possible
  assert.equal(g.gang.members.length, 12);
  assert.equal(g.gang.members.filter((x) => x.str_asc_points > 0).length, 0);
  for (let i = 0; i < 15; i++) await GANG.step(g.ns, st, S());
  assert.equal(g.gang.members.filter((x) => x.str_asc_points > 0).length, 1, "the next shop run ascends");
});
test("shop: hacking gangs buy hack items only", async () => {
  const g = fakeGang({ bn: 2, scripts, money: 1e12, gang: { faction: "NiteSec", respect: 1e6, members: members(12, 300) } });
  const st = newState(g.ns);
  for (let i = 0; i < 15; i++) await GANG.step(g.ns, st, S());
  const buys = g.log.filter((l) => l[0] === "buy");
  assert.ok(buys.length > 0);
  for (const [, , item] of buys) assert.ok(DATA.equip[item].stats.hack > 1, item);
});
test("one-shots: gang-act and gang-shop wrap every call; gang-info writes the static cache", async () => {
  const g = fakeGang({ bn: 2, joined: ["Slum Snakes"], gang: { faction: "Slum Snakes", members: members(2, 300) }, scripts });
  g.throwOn.add("recruitMember");
  const ns = g.make("agent/gang-act.js", [JSON.stringify({ recruit: ["g03"], tasks: { g01: "Mug People", nobody: "Mug People" }, warfare: true })]);
  await ACT.main(ns);
  const r = JSON.parse(g.files["data/gang-act.txt"]).results;
  assert.deepEqual(r.map((x) => [x.op, x.ok]), [["recruit g03", false], ["task g01=Mug People", true], ["task nobody=Mug People", false], ["warfare true", true]]);
  assert.ok(r[0].err.includes("injected"));
  const ns2 = g.make("agent/gang-shop.js", [JSON.stringify({ ascend: "g01", buy: [{ member: "g01", item: "Katana" }, { member: "zz", item: "Katana" }] })]);
  await SHOP.main(ns2);
  const sh = JSON.parse(g.files["data/gang-shop.txt"]);
  assert.equal(sh.bought, 1);
  assert.equal(sh.ascended, null, "nothing to ascend yet");
  assert.equal(sh.errors.length, 2);
  await ACT.main(g.make("agent/gang-act.js", ["not json"]));
  assert.deepEqual(JSON.parse(g.files["data/gang-act.txt"]).results, []);
  await INFO.main(g.make("agent/gang-info.js", []));
  const c = JSON.parse(g.files["data/gang-tasks.txt"]);
  assert.equal(Object.keys(c.tasks).length, Object.values(DATA.tasks).filter((t) => t.name === "Unassigned" || t.isCombat).length);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} gang-loop test(s) failed`); process.exit(1); }
console.log(`gang-loop: ${tests.length} passed`);
