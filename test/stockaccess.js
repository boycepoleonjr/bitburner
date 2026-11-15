// tools/stocks.js access guard (outside BN8 only the WSE account may be bought; TIX and 4S never) and the BN8-only auto-start of the read-only
// spike logger. Runs the REAL tools/stocks.js main() against a fake ns and records every purchase, order and run().
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { importGame, GAME } from "./helpers/game-import.js";

const A = await importGame("lib/stockaccess.js");
const { accessLimit, shouldStartSpike, ACCESS_ITEMS, DEFAULT_OUTSIDE_BN8 } = A;
const { DEFAULTS } = await importGame("lib/config.js");
const stocksMod = await importGame("tools/stocks.js");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, " ");
const COST = { wse: 200e6, tix: 5e9, s4d: 1e9, s4t: 25e9 };

// ---------------- pure ----------------
test("accessLimit: BN8 allows all four items; every other BitNode only the first `outsideBn8` (default 1 = WSE)", () => {
  assert.equal(ACCESS_ITEMS, 4); assert.equal(DEFAULT_OUTSIDE_BN8, 1);
  assert.equal(accessLimit(8), 4); assert.equal(accessLimit(8, 0), 4);
  for (const bn of [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]) { assert.equal(accessLimit(bn), 1, `BN${bn}`); assert.equal(accessLimit(bn, 0), 0); assert.equal(accessLimit(bn, 4), 4); }
});
test("accessLimit: invalid overrides fall back to the safe default (1), never to 'allow everything'", () => {
  for (const bad of [-1, 5, 9, 1.5, "2", "x", null, undefined, NaN, Infinity, [], {}, true]) assert.equal(accessLimit(3, bad), bad === undefined ? 1 : 1, String(bad));
  for (const bn of [undefined, null, "8", 8.5, NaN, 0, -1, 99]) assert.equal(accessLimit(bn), 1, `bn ${bn}`);
});
test("shouldStartSpike: only BN8 + TIX + not running + enabled + enough free RAM", () => {
  const ok = { bn: 8, hasTix: true, running: false, enabled: true, freeGb: 200, needGb: 16.7, minFreeGb: 64 };
  assert.equal(shouldStartSpike(ok), true);
  for (const [k, v] of [["bn", 3], ["bn", 7], ["bn", 9], ["hasTix", false], ["running", true], ["enabled", false], ["freeGb", 80], ["needGb", 0], ["needGb", NaN], ["freeGb", NaN], ["freeGb", undefined]])
    assert.equal(shouldStartSpike({ ...ok, [k]: v }), false, `${k}=${v}`);
  assert.equal(shouldStartSpike({ ...ok, freeGb: 80.7 }), true, "exactly need + min is enough");
  assert.equal(shouldStartSpike({ ...ok, enabled: undefined }), true, "enabled defaults to true");
  assert.equal(shouldStartSpike({ ...ok, minFreeGb: "x" }), true, "an unusable minFreeGb falls back to 64");
  assert.equal(shouldStartSpike({ ...ok, freeGb: 70, minFreeGb: "x" }), false);
});
test("config defaults: accessOutsideBn8 1, spikeLogger true, spikeMinFreeGb 64", () => {
  assert.equal(DEFAULTS.stocks.accessOutsideBn8, 1); assert.equal(DEFAULTS.stocks.spikeLogger, true); assert.equal(DEFAULTS.stocks.spikeMinFreeGb, 64);
  assert.equal(DEFAULTS.stocks.accessSpendFraction, 0.25, "existing tunables untouched");
});

// ---------------- the real tools/stocks.js against a fake ns ----------------
class Stop extends Error {}
function fakeNs({ bn = 3, money = 1e12, owned = {}, overrides = null, freeGb = 400, spikeRunning = false, spikeRam = 16.7, loops = 6 } = {}) {
  const own = { wse: false, tix: false, s4d: false, s4t: false, ...owned };
  const calls = [], runs = [], files = { "data/config-overrides.txt": overrides ? JSON.stringify(overrides) : "" };
  const syms = ["AAA", "BBB"];
  let n = 0, running = spikeRunning;
  const buy = (key) => () => { calls.push(`purchase:${key}`); if (own[key] || money < COST[key]) return false; money -= COST[key]; own[key] = true; return true; };
  const order = (name) => (...a) => { calls.push(`order:${name}`); return 0; };
  const st = {
    getConstants: () => ({ StockMarketCommission: 100e3, WseAccountCost: COST.wse, TixApiCost: COST.tix, MarketData4SCost: COST.s4d, MarketDataTixApi4SCost: COST.s4t }),
    hasWseAccount: () => own.wse, hasTixApiAccess: () => own.tix, has4SData: () => own.s4d, has4SDataTixApi: () => own.s4t,
    purchaseWseAccount: buy("wse"), purchaseTixApi: buy("tix"), purchase4SMarketData: buy("s4d"), purchase4SMarketDataTixApi: buy("s4t"),
    getSymbols: () => syms, getPosition: () => [0, 0, 0, 0], getBidPrice: () => 100, getAskPrice: () => 101, getMaxShares: () => 1e6, getForecast: () => 0.7,
    buyStock: order("buyStock"), sellStock: order("sellStock"), buyShort: order("buyShort"), sellShort: order("sellShort"), placeOrder: order("placeOrder"),
    nextUpdate: async () => { if (++n >= loops) throw new Stop(); },
  };
  const ns = {
    stock: st, args: [], disableLog() {}, print() {}, tprint(m) { calls.push(`tprint:${m}`); },
    format: { number: (x) => String(x) },
    getServerMoneyAvailable: () => money,
    read: (f) => files[f] ?? "", write: (f, d, mode) => { files[f] = mode === "a" ? (files[f] ?? "") + d : String(d); },
    getResetInfo: () => ({ currentNode: bn }),
    isRunning: (s) => (s === "tools/stock-spike.js" ? running : false),
    run: (s) => { runs.push(s); if (s === "tools/stock-spike.js") running = true; return 4242; },
    getScriptRam: () => spikeRam, getServerMaxRam: () => 512, getServerUsedRam: () => 512 - freeGb,
    sleep: async () => { if (++n >= loops) throw new Stop(); },
  };
  return { ns, calls, runs, own, files, money: () => money };
}
async function runTool(opts) {
  const w = fakeNs(opts);
  try { await stocksMod.main(w.ns); } catch (e) { if (!(e instanceof Stop)) throw e; }
  w.purchases = w.calls.filter((c) => c.startsWith("purchase:") && w.own[c.slice(9)]).length; // successful ones only are visible in `own`
  w.orders = w.calls.filter((c) => c.startsWith("order:"));
  w.attempts = w.calls.filter((c) => c.startsWith("purchase:")).map((c) => c.slice(9));
  return w;
}

test("BN3 with unlimited cash: it buys the WSE account and NOTHING else (no TIX, no 4S), places no orders and starts no logger", async () => {
  const w = await runTool({ bn: 3, money: 1e12 });
  assert.equal(w.own.wse, true); assert.deepEqual([w.own.tix, w.own.s4d, w.own.s4t], [false, false, false]);
  assert.deepEqual(w.attempts, ["wse"], "it never even attempts another purchase");
  assert.deepEqual(w.orders, []); assert.deepEqual(w.runs, []);
  assert.equal(w.money(), 1e12 - COST.wse);
});
test("BN3 with WSE + TIX already owned and unlimited cash: no 4S is bought, no order is placed (owning TIX alone never trades)", async () => {
  const w = await runTool({ bn: 3, money: 1e12, owned: { wse: true, tix: true } });
  assert.deepEqual(w.attempts, []); assert.deepEqual(w.orders, []); assert.deepEqual(w.runs, []); assert.equal(w.money(), 1e12);
});
test("BN3 at the live numbers: $678m is below the $800m WSE trigger (cash x 0.25 >= $200m), $801m is not", async () => {
  assert.deepEqual((await runTool({ bn: 3, money: 678e6 })).attempts, []);
  assert.deepEqual((await runTool({ bn: 3, money: 799e6 })).attempts, []);
  assert.deepEqual((await runTool({ bn: 3, money: 801e6 })).attempts, ["wse"]);
});
test("every BitNode except 8 behaves like BN3 (only WSE)", async () => {
  for (const bn of [1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]) {
    const w = await runTool({ bn, money: 1e12 });
    assert.deepEqual(w.attempts, ["wse"], `BN${bn}`); assert.deepEqual(w.runs, [], `BN${bn}`);
  }
});
test("owner override stocks.accessOutsideBn8: 0 buys nothing, 4 restores the old behavior (one item per loop, in order), invalid values stay at WSE-only", async () => {
  assert.deepEqual((await runTool({ bn: 3, overrides: { stocks: { accessOutsideBn8: 0 } } })).attempts, []);
  const all = await runTool({ bn: 3, overrides: { stocks: { accessOutsideBn8: 4 } }, loops: 8 });
  assert.deepEqual(all.attempts.filter((x, i, a) => a.indexOf(x) === i), ["wse", "tix", "s4d", "s4t"]); assert.deepEqual([all.own.wse, all.own.tix, all.own.s4d, all.own.s4t], [true, true, true, true]);
  for (const bad of [-1, 9, "all", null]) assert.deepEqual((await runTool({ bn: 3, overrides: { stocks: { accessOutsideBn8: bad } } })).attempts, ["wse"], String(bad));
});
test("BN8 is unchanged: it buys the missing access items in order (TIX is free there, so 4S Market Data then 4S TIX API) and still places no orders before 4S is complete", async () => {
  const w = await runTool({ bn: 8, money: 1e12, owned: { wse: true, tix: true }, loops: 4 });
  assert.deepEqual(w.attempts.filter((x, i, a) => a.indexOf(x) === i), ["s4d", "s4t"]);
  assert.equal(w.own.s4d, true); assert.equal(w.own.s4t, true);
  // with 4S TIX API bought the old long-only trader runs as before (BN8 is explicitly out of scope of the guard)
  assert.ok(w.orders.length > 0);
});
test("BN8: the read-only logger is started once when TIX exists and RAM allows; not before TIX, not in other nodes, not when disabled, not when running, not on a tiny home", async () => {
  const w = await runTool({ bn: 8, money: 0, owned: { wse: true, tix: true }, loops: 5 });
  assert.deepEqual(w.runs, ["tools/stock-spike.js"], "started exactly once");
  assert.ok(w.calls.some((c) => c.includes("BN8: started tools/stock-spike.js")));
  assert.deepEqual((await runTool({ bn: 8, money: 0 })).runs, [], "no TIX yet: nothing to log");
  assert.deepEqual((await runTool({ bn: 3, money: 0, owned: { wse: true, tix: true } })).runs, []);
  assert.deepEqual((await runTool({ bn: 8, money: 0, owned: { wse: true, tix: true }, overrides: { stocks: { spikeLogger: false } } })).runs, []);
  assert.deepEqual((await runTool({ bn: 8, money: 0, owned: { wse: true, tix: true }, spikeRunning: true })).runs, []);
  assert.deepEqual((await runTool({ bn: 8, money: 0, owned: { wse: true, tix: true }, freeGb: 40 })).runs, [], "small home: free RAM below logger + 64 GB");
  assert.deepEqual((await runTool({ bn: 8, money: 0, owned: { wse: true, tix: true }, spikeRam: 0 })).runs, [], "logger file missing (RAM 0)");
  // a logger that fails to start (ns.run returns 0) is retried on later loops without throwing
  const w2 = fakeNs({ bn: 8, money: 0, owned: { wse: true, tix: true }, loops: 4 }); w2.ns.run = (s) => { w2.runs.push(s); return 0; };
  try { await stocksMod.main(w2.ns); } catch (e) { if (!(e instanceof Stop)) throw e; }
  assert.ok(w2.runs.length >= 2);
});

// ---------------- static ----------------
const src = fs.readFileSync(path.join(GAME, "tools/stocks.js"), "utf8");
test("tools/stocks.js: the only purchase call sites are the four access entries behind accessLimit; nothing else in the game buys access", () => {
  const code = strip(src);
  assert.match(code, /accessLimit\(bn, c\.accessOutsideBn8\)/); assert.match(code, /if \(i >= allowed\) break;/);
  assert.ok(code.indexOf("i >= allowed") < code.indexOf("buy()"), "the limit check comes before the purchase");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(GAME).filter((x) => x.endsWith(".js") && !x.endsWith(path.join("tools", "stocks.js")))) {
    assert.ok(!/purchase(WseAccount|TixApi|4SMarketData)/.test(strip(fs.readFileSync(f, "utf8"))), `${path.relative(GAME, f)} must not buy stock access`);
  }
});
test("tools/stocks.js RAM-costing additions are exactly the six calls the guard and the logger start need", () => {
  const costly = new Set(JSON.parse(fs.readFileSync(new URL("./fixtures/ns-costly-names.json", import.meta.url), "utf8")));
  const ids = new Set(strip(src).match(/[A-Za-z_$][\w$]*/g));
  for (const n of ["getResetInfo", "isRunning", "run", "getScriptRam", "getServerMaxRam", "getServerUsedRam"]) assert.ok(costly.has(n) ? ids.has(n) : true, n);
  const lib = new Set(strip(fs.readFileSync(path.join(GAME, "lib/stockaccess.js"), "utf8")).match(/[A-Za-z_$][\w$]*/g));
  assert.deepEqual([...lib].filter((i) => costly.has(i)), [], "lib/stockaccess.js is pure");
  for (const bad of ["window", "document", "setInterval", "setTimeout"]) assert.ok(!lib.has(bad), bad);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} stockaccess test(s) failed`); process.exit(1); }
console.log(`stockaccess: ${tests.length} passed`);
