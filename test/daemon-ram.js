// daemon.js + RAM manager on a fake network: rollback equality with the pre-manager daemon, target growth, worker
// safety, hysteresis, cloud supersession, live settings, status contract, and a 10-minute utilization simulation.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importGame } from "./helpers/game-import.js";
import { fakeGame, testConfig, runTicks } from "./helpers/fake-game.js";

const { tick } = await importGame("daemon.js");
const { DEFAULTS, merge, managedConfig } = await importGame("lib/config.js");
const { freshState } = await importGame("lib/state.js");
const { defaults } = await importGame("lib/settings-schema.js");
const BASE = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/daemon-baseline.json"), "utf8"));
const NETS = { small: { homeRam: 512, targets: 12 }, huge: { homeRam: 2 ** 22, targets: 40 } }; // same nets as the fixture
const cfg = testConfig(DEFAULTS, merge);
const settingsFile = (values) => ({ "data/settings.txt": JSON.stringify({ version: 1, rev: 1, updatedAt: 0, updatedBy: "test", values }) });
const OFF = settingsFile({ "ram.manager.enabled": false });
const FACTION = (g) => JSON.stringify({ t: g.now, work: "FACTION:The Black Hand" });
const HGW = /^workers\/(hack|grow|weaken)\.js$/;
const LOOP = /^workers\/(share|xp)-loop\.js$/;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("rollback: ram.manager.enabled=false reproduces the pre-manager daemon exactly (small + huge RAM)", () => {
  for (const [name, opts] of Object.entries(NETS)) {
    const g = fakeGame({ ...opts, files: { ...OFF } });
    const got = runTicks(g, tick, cfg, freshState(), 20);
    assert.deepEqual(got, BASE[name], `${name}: decisions differ from test/fixtures/daemon-baseline.json`);
    assert.equal(g.log.buy.length + g.log.upgrade.length, 0);
    const st = JSON.parse(g.files["data/ram-status.txt"]);
    assert.equal(st.enabled, false);
  }
});
test("managedConfig: settings win when on, cfg untouched when off", () => {
  const S = { ...defaults(), "ram.homeReserveGb": 999, "ram.batches.max": 7, "ram.xp.target": "n00dles" };
  const m = managedConfig(cfg, S);
  assert.equal(m.homeReserveGb, 999); assert.equal(m.farm.maxBatches, 7); assert.equal(m.xp.target, "n00dles");
  assert.equal(m.xp.enabled, false); assert.equal(m.hooks.purchasedServers.enabled, false);
  assert.equal(managedConfig(m, { ...S, "ram.batches.max": 0 }).farm.maxBatches, Number.MAX_SAFE_INTEGER);
  assert.equal(managedConfig(cfg, { ...S, "ram.manager.enabled": false }), cfg);
});
test("manager on, small RAM: same floor target set as the old daemon", () => {
  const g = fakeGame({ ...NETS.small, files: settingsFile({ "ram.homeReserveGb": 64 }) });
  const got = runTicks(g, tick, cfg, freshState(), 20);
  assert.equal(got.at(-1).primary, BASE.small.at(-1).primary);
  for (const h of BASE.small.at(-1).secondaries) assert.ok(got.at(-1).secondaries.includes(h), `floor target ${h} kept`);
});
test("manager on, huge RAM: every viable target becomes active; buckets match allocate", () => {
  const g = fakeGame({ ...NETS.huge, files: {} });
  const st = freshState();
  runTicks(g, tick, cfg, st, 6);
  const moneyServers = [...g.servers.values()].filter((x) => x.maxMoney > 0 && !x.purchased).length; // 40 + joesguns
  assert.equal(st.secondaries.length + 1, moneyServers, `all ${moneyServers} money targets active (old daemon: 7)`);
  const rs = JSON.parse(g.files["data/ram-status.txt"]);
  assert.equal(rs.enabled, true);
  assert.ok(Math.abs(rs.alloc.money + rs.alloc.share + rs.alloc.xp - rs.usableGb) < 1e-6 * rs.usableGb);
  assert.equal(rs.alloc.share, 0, "no faction work -> no share");
  assert.ok(rs.running.xp > 0.8 * rs.alloc.xp, "xp loops fill the surplus");
});
test("manager on: faction work + late weight puts RAM into share; strategy.late=0 moves it back within 2 loops", () => {
  const g = fakeGame({ homeRam: 2 ** 22, targets: 10, ownedAugs: ["The Red Pill"] });
  const st = freshState();
  g.files["data/autopilot-status.txt"] = FACTION(g);
  runTicks(g, tick, cfg, st, 3);
  let rs = JSON.parse(g.files["data/ram-status.txt"]);
  assert.equal(rs.phase, "late"); assert.equal(rs.weight, 1); assert.equal(rs.repActive, true);
  assert.ok(rs.running.share > 0.9 * rs.usableGb * 0.9, "share holds the RAM");
  assert.equal(rs.alloc.money, 0, "weight 1 = all faction rep");
  const moneyBefore = rs.running.money;
  g.files["data/settings.txt"] = settingsFile({ "strategy.late": 0 })["data/settings.txt"];
  g.files["data/autopilot-status.txt"] = FACTION(g);
  runTicks(g, tick, cfg, st, 2);
  rs = JSON.parse(g.files["data/ram-status.txt"]);
  assert.equal(rs.weight, 0);
  assert.ok(rs.alloc.money > 0, "money gets its full target demand back");
  assert.ok(rs.running.money > moneyBefore, "hacking waves relaunched within 2 loops");
  assert.ok(rs.alloc.share <= rs.usableGb - rs.alloc.money + 1e-6, "share keeps only the surplus");
  assert.ok(g.log.killFiles.length > 0 && g.log.killFiles.every((f) => LOOP.test(f)), "only share/xp loops were killed to make room");
});
test("manager never kills in-flight hack/grow/weaken workers when resizing loops", () => {
  const g = fakeGame({ homeRam: 2 ** 22, targets: 10 });
  const st = freshState();
  runTicks(g, tick, cfg, st, 3);
  const hgw = new Set(g.live().filter((p) => HGW.test(p.filename)).map((p) => p.pid));
  // flip the surplus from xp to share: every loop gets resized
  g.files["data/autopilot-status.txt"] = FACTION(g);
  const k0 = g.log.kill.length;
  runTicks(g, tick, cfg, st, 3);
  const killed = g.log.kill.slice(k0);
  assert.ok(killed.length > 0, "loops were resized");
  for (const pid of killed) assert.ok(!hgw.has(pid), `killed in-flight H/G/W pid ${pid}`);
});
test("resize hysteresis: a <10% change neither kills nor respawns loops", () => {
  const g = fakeGame({ homeRam: 2 ** 22, targets: 10 });
  const st = freshState();
  runTicks(g, tick, cfg, st, 4);
  const loops = () => g.live().filter((p) => LOOP.test(p.filename)).map((p) => p.pid).sort().join();
  const before = loops();
  // usable grows ~3% (a new empty executor): the xp/share targets move by < 10%, so loops stay as they are
  g.servers.set("extra", { ...g.servers.get("joesguns"), host: "extra", maxRam: 0.03 * 2 ** 22, maxMoney: 0, staticUsed: 0 });
  const e0 = g.log.exec.length;
  runTicks(g, tick, cfg, st, 3);
  assert.equal(loops(), before, "no loop killed");
  assert.ok(g.log.exec.slice(e0).every((e) => !LOOP.test(e[0])), "no loop respawned");
});
test("cloud: manager buys (once per server); legacy pserv hook never double-buys", () => {
  const legacyOn = testConfig(DEFAULTS, merge, { hooks: { purchasedServers: { enabled: true } } });
  const g = fakeGame({ homeRam: 2 ** 22, targets: 6, cash: 145e15, gbCost: 706_000 });
  runTicks(g, tick, legacyOn, freshState(), 3);
  assert.equal(g.log.buy.length, 25);
  assert.ok(g.log.buy.every(([h, r]) => /^cloud-\d\d$/.test(h) && r === 2 ** 20), "only lib/cloud.js names; no pserv-*");
  const rs = JSON.parse(g.files["data/ram-status.txt"]);
  assert.deepEqual([rs.cloud.count, rs.cloud.limit], [25, 25]);
  const off = fakeGame({ homeRam: 2 ** 22, targets: 6, cash: 145e15, gbCost: 706_000, files: { ...OFF } });
  runTicks(off, tick, cfg, freshState(), 3);
  assert.equal(off.log.buy.length, 0, "manager off + legacy hook off: nothing bought");
});
test("manager off kills leftover share/xp loops (rollback leaves no RAM held)", () => {
  const g = fakeGame({ homeRam: 2 ** 22, targets: 6 });
  const st = freshState();
  runTicks(g, tick, cfg, st, 2);
  assert.ok(g.live().some((p) => LOOP.test(p.filename)));
  g.files["data/settings.txt"] = OFF["data/settings.txt"];
  runTicks(g, tick, cfg, st, 1);
  assert.equal(g.live().filter((p) => LOOP.test(p.filename)).length, 0);
});
test("stale work signal => repActive false (no share)", () => {
  const g = fakeGame({ homeRam: 2 ** 22, targets: 6, ownedAugs: ["The Red Pill"] });
  g.files["data/autopilot-status.txt"] = JSON.stringify({ t: g.now - 10 * 60_000, work: "FACTION:x" });
  runTicks(g, tick, cfg, freshState(), 2);
  const rs = JSON.parse(g.files["data/ram-status.txt"]);
  assert.equal(rs.repActive, false); assert.equal(rs.alloc.share, 0);
  assert.ok(rs.reasons.some((r) => /work signal: stale/.test(r)));
});
test("utilization: 10 simulated minutes at huge RAM keep the time-average >= 90%", () => {
  const g = fakeGame({ homeRam: 2 ** 26, targets: 40, filler: [["n1", 1024], ["n2", 512]] });
  const st = freshState();
  runTicks(g, tick, cfg, st, 6); // warm-up (30 s)
  let acc = 0, n = 0;
  for (let i = 0; i < 120; i++) { // 10 min of 5 s loops
    runTicks(g, tick, cfg, st, 1);
    const rs = JSON.parse(g.files["data/ram-status.txt"]);
    acc += rs.util.instant; n++;
  }
  const avg = acc / n;
  const rs = JSON.parse(g.files["data/ram-status.txt"]);
  console.log(`    sim: avg util ${(avg * 100).toFixed(1)}%, ema5 ${(rs.util.ema5 * 100).toFixed(1)}%, targets ${rs.activeTargets.length}`);
  assert.ok(avg >= 0.9, `avg utilization ${avg}`);
  assert.ok(rs.util.ema5 >= 0.9);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} daemon-ram test(s) failed`); process.exit(1); }
console.log(`daemon-ram: ${tests.length} passed`);
