// BN8 spike (docs/specs/bn8-spike.md): the pure estimator/analyzer, the report CLI, and static guarantees about the read-only logger.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { importGame, GAME } from "./helpers/game-import.js";
import { simulate } from "./helpers/stock-sim.js";

const SP = await importGame("lib/stockspike.js");
const { moveSigns, streamEstimator, estimateForecast, backtest, parseSpikeLog, analyze, formatReport, GATES } = SP;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, " ");

// ---------------- pure functions ----------------
test("moveSigns: +1 up, -1 down, 0 flat and for bad prices; short or empty input is empty", () => {
  assert.deepEqual(moveSigns([10, 11, 11, 9, 9.5]), [1, 0, -1, 1]);
  assert.deepEqual(moveSigns([10, NaN, 5, 0, -1, 4, Infinity]), [0, 0, 0, 0, 0, 0]);
  for (const x of [[], [5], null, undefined]) assert.deepEqual(moveSigns(x), []);
});
test("streamEstimator: no data is 0.5; all ups approach but stay below 1; all downs above 0; zeros do not count; memory fades", () => {
  const e = streamEstimator();
  assert.equal(e.value(), 0.5); assert.equal(e.weight(), 0);
  for (let i = 0; i < 200; i++) e.push(1);
  assert.ok(e.value() > 0.85 && e.value() < 1);
  const d = streamEstimator(); for (let i = 0; i < 200; i++) d.push(-1);
  assert.ok(d.value() < 0.15 && d.value() > 0);
  const z = streamEstimator(); for (let i = 0; i < 50; i++) z.push(0); assert.equal(z.value(), 0.5);
  // memory: a long run of ups then a long run of downs ends on the down side
  const m = streamEstimator({ halfLife: 20 }); for (let i = 0; i < 100; i++) m.push(1); for (let i = 0; i < 100; i++) m.push(-1);
  assert.ok(m.value() < 0.3);
  // a longer half-life remembers longer
  const a = streamEstimator({ halfLife: 5 }), b = streamEstimator({ halfLife: 200 });
  for (let i = 0; i < 100; i++) { a.push(1); b.push(1); } for (let i = 0; i < 20; i++) { a.push(-1); b.push(-1); }
  assert.ok(a.value() < b.value());
  // degenerate parameters do not produce NaN
  for (const o of [{ halfLife: 0 }, { halfLife: -3 }, { prior: 0 }]) { const x = streamEstimator(o); x.push(1); x.push(-1); assert.ok(Number.isFinite(x.value())); }
});
test("estimateForecast: rising prices give f > 0.5, falling give f < 0.5, short history stays near 0.5", () => {
  const up = Array.from({ length: 60 }, (_, i) => 100 + i), down = up.slice().reverse();
  assert.ok(estimateForecast(up).f > 0.8); assert.ok(estimateForecast(down).f < 0.2);
  assert.ok(Math.abs(estimateForecast([100, 101]).f - 0.5) < 0.1);
  assert.equal(estimateForecast([]).f, 0.5);
});

// ---------------- simulator sanity (the real rules) ----------------
test("simulator: deterministic per seed, 33 stocks, forecasts in [0,1], per-tick log move never exceeds ln(1 + volatility)", () => {
  const a = simulate({ seed: 7, ticks: 300 }), b = simulate({ seed: 7, ticks: 300 }), c = simulate({ seed: 8, ticks: 300 });
  assert.equal(a.text, b.text); assert.notEqual(a.text, c.text);
  assert.equal(a.ticks[0].p.length, 33);
  for (const t of a.ticks) for (const f of t.f) assert.ok(f >= 0 && f <= 1);
  for (let t = 1; t < a.ticks.length; t++) for (let i = 0; i < 33; i++) {
    const m = Math.abs(Math.log(a.ticks[t].p[i] / a.ticks[t - 1].p[i]));
    assert.ok(m <= Math.log(1 + a.ticks[t].v[i]) * (1 + 1e-6), `stock ${i} tick ${t}`);
  }
});
test("simulator: the empirical up-share of a stock follows its forecast (the sign model of the spec)", () => {
  const sim = simulate({ seed: 3, ticks: 4000 });
  let ups = 0, expect = 0, n = 0;
  for (let t = 1; t < sim.ticks.length; t++) for (let i = 0; i < 33; i++) { ups += sim.ticks[t].p[i] > sim.ticks[t - 1].p[i] ? 1 : 0; expect += sim.ticks[t - 1].f[i]; n++; }
  assert.ok(Math.abs(ups / n - expect / n) < 0.01, `${ups / n} vs ${expect / n}`);
});

// ---------------- estimator vs ground truth ----------------
test("backtest on 4000 simulated ticks: the default estimator meets G1 and G2, beats nothing-at-all, and the oracle earns more", () => {
  const sim = simulate({ seed: 11, ticks: 4000 });
  const r = backtest(sim.ticks, { spread: sim.info.ask.map((a, i) => (a - sim.info.bid[i]) / (a + sim.info.bid[i])) });
  console.log(`     G1 share ${(r.withinShare * 100).toFixed(1)}%  G2 share ${(r.sideShare * 100).toFixed(1)}%  mean abs err ${r.meanAbsErr.toFixed(3)}  gross est ${r.grossPerStockTick.estimator.toExponential(2)} oracle ${r.grossPerStockTick.oracle.toExponential(2)}`);
  assert.ok(r.withinShare >= GATES.withinShare, `G1 ${r.withinShare}`);
  assert.ok(r.sideShare >= GATES.sideShare, `G2 ${r.sideShare}`);
  assert.equal(r.g1, true); assert.equal(r.g2, true);
  assert.ok(r.grossPerStockTick.oracle > r.grossPerStockTick.estimator);
  assert.ok(r.grossPerStockTick.estimator > 0, "following the estimate is profitable gross of spread");
});
test("backtest: a deliberately bad estimator (tiny half-life, huge prior) fails G2 and the gates report it, never throws", () => {
  const sim = simulate({ seed: 12, ticks: 1500 });
  const bad = backtest(sim.ticks, {}, { estimator: { halfLife: 1, prior: 0 } });
  assert.equal(bad.g2, false);
  const flat = backtest(sim.ticks, {}, { estimator: { halfLife: 30, prior: 1e9 } });
  assert.equal(flat.g2, false, "an estimator that always says 0.5 never picks a side");
});
test("backtest: empty, one-tick, missing forecasts and NaN prices give nulls, not exceptions", () => {
  for (const x of [[], [{ p: [1, 2] }], [{ p: [1, 2], f: [0.5, 0.5] }], null]) {
    const r = backtest(x);
    assert.equal(r.pairs, 0); assert.equal(r.g1, null); assert.equal(r.g2, null);
  }
  const t = Array.from({ length: 100 }, () => ({ p: [NaN, 5], f: [0.5, 0.6] }));
  assert.doesNotThrow(() => backtest(t));
});

// ---------------- log parsing ----------------
test("parseSpikeLog: reads info and ticks, counts unreadable lines, drops ticks of a different width, never throws", () => {
  const sim = simulate({ seed: 2, ticks: 50 });
  const text = sim.text + "garbage line\n{\"k\":\"x\"}\n\n" + JSON.stringify({ k: "t", t: 1, p: [1, 2, 3] }) + "\n[1,2]\nnull\n";
  const p = parseSpikeLog(text);
  assert.equal(p.infos.length, 1); assert.equal(p.ticks.length, 50); assert.equal(p.skipped, 5);
  for (const bad of [null, undefined, "", 42, "\n\n"]) assert.deepEqual(parseSpikeLog(bad).ticks, []);
});

// ---------------- analyzer + gates ----------------
test("analyze on a simulated log with forecasts: every gate evaluates and passes", () => {
  const sim = simulate({ seed: 21, ticks: 2600 });
  const rep = analyze(parseSpikeLog(sim.text));
  assert.equal(rep.ticks, 2600); assert.equal(rep.stocks, 33); assert.equal(rep.hasForecasts, true);
  assert.deepEqual(rep.gates, { G1: true, G2: true, G3: true, G4: true });
  assert.equal(rep.pass, true);
  assert.equal(rep.cadence.medianMs, 6000);
  assert.ok(rep.vol.eligible === 33 && rep.vol.matched === 33, JSON.stringify([rep.vol.eligible, rep.vol.matched]));
  assert.ok(rep.spread.median > 0 && rep.spread.min <= rep.spread.max);
  const txt = formatReport(rep);
  for (const s of ["G1 estimator      PASS", "G2 direction      PASS", "G3 volatility     PASS", "G4 tick cadence   PASS", "verdict: all gates pass"]) assert.ok(txt.includes(s), s);
});
test("analyze: a log without forecasts evaluates only the cadence; the verdict says not everything could be evaluated", () => {
  const sim = simulate({ seed: 22, ticks: 300 });
  const text = [JSON.stringify({ ...sim.info, has4S: false }), ...sim.ticks.map((t) => JSON.stringify({ k: "t", t: t.t, p: t.p }))].join("\n");
  const rep = analyze(parseSpikeLog(text));
  assert.deepEqual(rep.gates, { G1: null, G2: null, G3: null, G4: true }); assert.equal(rep.pass, null); assert.equal(rep.hasForecasts, false);
  assert.match(formatReport(rep), /not every gate could be evaluated/);
});
test("analyze: wrong volatility units (a percent instead of a decimal) fail G3; a slow clock fails G4; the verdict is FAIL", () => {
  const sim = simulate({ seed: 23, ticks: 2300 });
  const wrongV = sim.ticks.map((t) => JSON.stringify({ ...t, v: t.v.map((x) => x * 100) }));
  const rep = analyze(parseSpikeLog([JSON.stringify(sim.info), ...wrongV].join("\n")));
  assert.equal(rep.gates.G3, false); assert.equal(rep.pass, false); assert.match(formatReport(rep), /gate FAILS/);
  const slow = sim.ticks.map((t, i) => JSON.stringify({ ...t, t: t.t + i * 20000 }));
  assert.equal(analyze(parseSpikeLog([JSON.stringify(sim.info), ...slow].join("\n"))).gates.G4, false);
  const fast = sim.ticks.map((t, i) => JSON.stringify({ ...t, t: sim.info.t + i * 1000 }));
  assert.equal(analyze(parseSpikeLog([JSON.stringify(sim.info), ...fast].join("\n"))).gates.G4, false);
});
test("analyze: too few ticks for G3 (under 2000) leaves it null; empty and garbage logs do not throw", () => {
  const sim = simulate({ seed: 24, ticks: 500 });
  assert.equal(analyze(parseSpikeLog(sim.text)).gates.G3, null);
  for (const t of ["", "x\ny\n", JSON.stringify({ k: "i", s: ["A"] })]) {
    const r = analyze(parseSpikeLog(t));
    assert.equal(r.pass, null); assert.doesNotThrow(() => formatReport(r));
  }
});

// ---------------- report CLI ----------------
test("server/stockspike-report.js: prints the report, --json prints JSON, exit 1 when a gate fails, 2 for usage and unreadable files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbss-")), f = path.join(dir, "spike.txt");
  try {
    const run = (...a) => spawnSync(process.execPath, [path.join(ROOT, "server/stockspike-report.js"), ...a], { encoding: "utf8" });
    fs.writeFileSync(f, simulate({ seed: 31, ticks: 2300 }).text);
    const ok = run(f); assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /verdict: all gates pass/);
    assert.equal(JSON.parse(run(f, "--json").stdout).pass, true);
    const sim = simulate({ seed: 32, ticks: 2300 });
    fs.writeFileSync(f, [JSON.stringify(sim.info), ...sim.ticks.map((t) => JSON.stringify({ ...t, v: t.v.map((x) => x * 100) }))].join("\n"));
    assert.equal(run(f).status, 1);
    assert.equal(run().status, 2); assert.equal(run(path.join(dir, "missing.txt")).status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------- static guarantees ----------------
const LOGGER = fs.readFileSync(path.join(GAME, "tools/stock-spike.js"), "utf8");
test("logger is read-only: only whitelisted ns.stock getters, no order or purchase function anywhere in the source", () => {
  const code = strip(LOGGER);
  const used = new Set([...code.matchAll(/\bst\.(\w+)/g)].map((m) => m[1]).concat([...code.matchAll(/\bns\.stock\.(\w+)/g)].map((m) => m[1])));
  const allowed = new Set(["hasTixApiAccess", "has4SDataTixApi", "getSymbols", "getMaxShares", "getAskPrice", "getBidPrice", "getPrice", "getForecast", "getVolatility", "nextUpdate"]);
  for (const n of used) assert.ok(allowed.has(n), `ns.stock.${n} is not allowed in the read-only logger`);
  assert.ok(used.size >= 8);
  for (const bad of ["buyStock", "sellStock", "buyShort", "sellShort", "placeOrder", "cancelOrder", "purchaseWseAccount", "purchaseTixApi", "purchase4SMarketData", "purchase4SMarketDataTixApi", "setLiquidate", "liquidate"])
    assert.ok(!new RegExp(`\\b${bad}\\b`).test(code), bad);
  // the only mutating ns call is writing its own data file
  for (const m of code.matchAll(/\bns\.(\w+)/g)) assert.ok(["disableLog", "stock", "args", "read", "write", "tprint"].includes(m[1]), `ns.${m[1]}`);
  assert.ok(!/^\s*import\s/m.test(code), "no imports");
});
test("nothing in game/ imports the spike files, and lib/stockspike.js has no RAM-costing names, DOM globals or imports", () => {
  const costly = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/ns-costly-names.json"), "utf8")));
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(GAME).filter((x) => !x.endsWith("stock-spike.js") && !x.endsWith("stockspike.js"))) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(!/stockspike|stock-spike/.test(src.replace(/\/\/.*$/gm, "")) || f.endsWith(".txt") || f.endsWith("README.txt"), `${f} references the spike files`);
  }
  const lib = strip(fs.readFileSync(path.join(GAME, "lib/stockspike.js"), "utf8"));
  const ids = new Set(lib.match(/[A-Za-z_$][\w$]*/g));
  assert.deepEqual([...ids].filter((i) => costly.has(i)), []);
  for (const bad of ["window", "document", "setInterval", "setTimeout"]) assert.ok(!ids.has(bad), bad);
  assert.ok(!/^\s*import\s/m.test(lib));
});
test("the logger's cap argument is clamped and the file name is data/stock-spike.txt (the path the report CLI documents)", () => {
  assert.match(LOGGER, /Math\.max\(100, Math\.min\(50000/); assert.match(LOGGER, /const FILE = "data\/stock-spike\.txt"/);
  assert.match(fs.readFileSync(path.join(ROOT, "server/stockspike-report.js"), "utf8"), /stock-spike\.txt/);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} stockspike test(s) failed`); process.exit(1); }
console.log(`stockspike: ${tests.length} passed`);
