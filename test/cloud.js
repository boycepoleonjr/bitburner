// lib/cloud.js: buy/upgrade planning, spend fraction, limit, freeze window, ns execution.
import assert from "node:assert/strict";
import { importGame } from "./helpers/game-import.js";
import { fakeGame } from "./helpers/fake-game.js";
import { defaults } from "../game/lib/settings-schema.js";

const { planCloud, cloudFreeze, cloudTick } = await importGame("lib/cloud.js");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const costOf = (r) => r * 1000;
const upgradeCostOf = (servers) => (h, r) => { const s = servers.find((x) => x.host === h); return s && r > s.ram ? (r - s.ram) * 1000 : -1; };

test("plan: buys the largest affordable power of two, names cloud-NN, respects the limit", () => {
  const { actions } = planCloud({ servers: [], limit: 3, ramLimit: 2 ** 20, budget: 3 * 1024 * 1000 + 5, costOf, upgradeCostOf: upgradeCostOf([]) });
  const buys = actions.filter((a) => a.op === "buy");
  assert.deepEqual(buys.map((a) => [a.host, a.ram]), [["cloud-00", 2048], ["cloud-01", 1024]]);
  const all = planCloud({ servers: [], limit: 25, ramLimit: 2 ** 20, budget: 1e15, costOf, upgradeCostOf: upgradeCostOf([]) });
  assert.equal(all.actions.length, 25);
  assert.ok(all.actions.every((a) => a.op === "buy" && a.ram === 2 ** 20));
});
test("plan: spend never exceeds the budget; nothing affordable -> nothing", () => {
  const r = planCloud({ servers: [], limit: 25, ramLimit: 2 ** 20, budget: 1e7, costOf, upgradeCostOf: upgradeCostOf([]) });
  assert.ok(r.spent <= 1e7);
  assert.equal(planCloud({ servers: [], limit: 25, ramLimit: 2 ** 20, budget: 1000, costOf, upgradeCostOf: upgradeCostOf([]) }).actions.length, 0);
});
test("plan: at the limit, upgrades smallest first, skips maxed, stops when broke", () => {
  const servers = [{ host: "cloud-00", ram: 64 }, { host: "cloud-01", ram: 8 }, { host: "cloud-02", ram: 2 ** 20 }];
  const r = planCloud({ servers, limit: 3, ramLimit: 2 ** 20, budget: 200_000, costOf, upgradeCostOf: upgradeCostOf(servers) });
  assert.equal(r.actions[0].op, "upgrade");
  assert.equal(r.actions[0].host, "cloud-01");
  assert.ok(r.actions.every((a) => a.host !== "cloud-02"));
  assert.ok(r.spent <= 200_000);
});
test("plan: name collisions skip used indices", () => {
  const servers = [{ host: "cloud-00", ram: 2 ** 20 }];
  const r = planCloud({ servers, limit: 2, ramLimit: 2 ** 20, budget: 1e12, costOf, upgradeCostOf: upgradeCostOf(servers) });
  assert.equal(r.actions[0].host, "cloud-01");
});
test("freeze: inside window freezes; outside, past or missing ETA does not", () => {
  const now = 1e12;
  assert.equal(cloudFreeze(JSON.stringify({ installEtaMs: now + 5 * 60_000 }), 10, now).frozen, true);
  assert.equal(cloudFreeze(JSON.stringify({ installEtaMs: now + 30 * 60_000 }), 10, now).frozen, false);
  assert.equal(cloudFreeze(JSON.stringify({ installEtaMs: now - 1 }), 10, now).frozen, false);
  const miss = cloudFreeze("", 10, now);
  assert.equal(miss.frozen, false); assert.match(miss.reason, /no install ETA/);
});
test("cloudTick: buys all 25 at 1 PB with BN5-scale cash; spend fraction honored", () => {
  const g = fakeGame({ cash: 145e15, gbCost: 706_000 });
  const S = defaults();
  const r = cloudTick(g.ns, S, { autopilotRaw: "", now: g.now });
  assert.deepEqual([r.count, r.minGb, r.maxGb], [25, 2 ** 20, 2 ** 20]);
  assert.ok(r.spentThisLoop <= 145e15 * S["ram.cloud.maxSpendFraction"]);
  const poor = fakeGame({ cash: 1e6, gbCost: 55_000 });
  const p = cloudTick(poor.ns, S, { now: poor.now });
  assert.ok(p.spentThisLoop <= 1e6 * 0.1);
  assert.equal(p.count, 0); // 0.1 × $1m < cheapest server (2GB = $110k)
});
test("cloudTick: disabled or frozen buys nothing", () => {
  const g = fakeGame({ cash: 1e18 });
  assert.equal(cloudTick(g.ns, { ...defaults(), "ram.cloud.enabled": false }, { now: g.now }).count, 0);
  const fr = cloudTick(g.ns, defaults(), { autopilotRaw: JSON.stringify({ installEtaMs: g.now + 60_000 }), now: g.now });
  assert.equal(fr.count, 0); assert.ok(fr.reasons.some((x) => /frozen/.test(x)));
  assert.equal(g.log.buy.length, 0);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} cloud test(s) failed`); process.exit(1); }
console.log(`cloud: ${tests.length} passed`);
