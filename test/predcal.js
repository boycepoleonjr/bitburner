// Predictor v3 (lib/predcal.js) + its wiring in agent/predictor.txt and agent/checkin-lib.txt.
// Synthetic data only (no game data is committed). Spec: docs/specs/predictor-v3.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GAME } from "./helpers/game-import.js";

const PC = await import("../game/lib/predcal.js");
const SRC = fs.readFileSync(path.join(GAME, "lib/predcal.js"), "utf8");
const costly = new Set(JSON.parse(fs.readFileSync(new URL("./fixtures/ns-costly-names.json", import.meta.url), "utf8")));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, " ");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- deterministic synthetic data ----------
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function gauss(r) { const u = Math.max(r(), 1e-12), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
/**
 * n predictions, one every 20 min, each resolved `lagMin` after its actual outcome. True duration D; models report
 * D * exp(noise_m + bias_m). sigma(i) lets a test change the noise scale over time.
 */
function synth({ n = 600, seed = 1, kind = "rep", baseMin = 90, sigma = () => 0.2, bias = { s5: 0.3, s15: 0, s45: 0, quad: -0.2 }, noise = { s5: 0.5, s15: 0.15, s45: 0.05, quad: 0.3 }, lagMin = 5 } = {}) {
  const r = rng(seed), out = [], t0 = 1.79e12;
  for (let i = 0; i < n; i++) {
    const made = t0 + i * 20 * 6e4, D = baseMin * 6e4 * Math.exp(0.3 * gauss(r));
    const actual = D * Math.exp(sigma(i) * gauss(r)), preds = {};
    for (const m of Object.keys(noise)) preds[m] = D * Math.exp(bias[m] + noise[m] * gauss(r));
    const p = { id: `p${i}`, made, lastAug: t0, spec: { kind }, preds };
    out.push(PC.toSample(p, { at: made + actual + lagMin * 6e4, actual: made + actual }));
  }
  return out;
}
const coverage = (scored, from = 0) => { const xs = scored.slice(from).filter(({ s, p }) => p && s.actualMs); return xs.filter(({ s, p }) => s.actualMs >= p.lo && s.actualMs <= p.hi).length / xs.length; };

// ---------- static guarantees ----------
test("lib/predcal.js is import-free, has no RAM-costing Netscript names and no DOM globals", () => {
  assert.ok(!/^\s*import\s/m.test(strip(SRC)), "no imports (the page loader cannot resolve them)");
  const ids = new Set(strip(SRC).match(/[A-Za-z_$][\w$]*/g) || []);
  assert.deepEqual([...ids].filter((i) => costly.has(i)), []);
  for (const bad of ["window", "document", "ns", "setInterval", "setTimeout"]) assert.ok(!ids.has(bad), bad);
});
test("page loader: loadPredcal(source) returns the same API as the ES module", () => {
  const L = PC.loadPredcal(SRC);
  for (const k of Object.keys(PC.PREDCAL)) assert.equal(typeof L[k], typeof PC.PREDCAL[k], k);
  const s = synth({ n: 120 }), a = PC.replay(s).snapshot, b = L.replay(s).snapshot;
  assert.deepEqual(a, b);
  // the inline loader in agent/predictor.txt is the same transformation
  const pred = fs.readFileSync(path.join(GAME, "agent/predictor.txt"), "utf8");
  assert.ok(pred.includes('bb.read("lib/predcal.js")') && pred.includes("return PREDCAL;"));
});
test("settings: predictor.version defaults to v2 (rollout and rollback are one setting)", async () => {
  const { defaults, BY_KEY, coerce } = await import("../game/lib/settings-schema.js");
  assert.equal(defaults()["predictor.version"], "v2");
  assert.deepEqual(BY_KEY["predictor.version"].options, ["v2", "v3"]);
  assert.equal(coerce("predictor.version", "v4").ok, false);
  assert.equal(defaults()["predictor.alertWindow"], 50);
  assert.equal(defaults()["predictor.alertMinN"], 30);
});

// ---------- primitives ----------
test("wquantile and sortedQuantile agree; empty / zero weight -> null", () => {
  const r = rng(3), xs = Array.from({ length: 200 }, () => gauss(r)), ws = xs.map(() => r());
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]), sx = idx.map((i) => xs[i]), cw = []; let c = 0; for (const i of idx) { c += ws[i]; cw.push(c); }
  for (const p of [0, 0.05, 0.1, 0.5, 0.9, 0.95, 1]) assert.equal(PC.wquantile(xs, ws, p), PC.sortedQuantile(sx, cw, p), `p=${p}`);
  assert.equal(PC.wquantile([], [], 0.5), null);
  assert.equal(PC.wquantile([1, 2], [0, 0], 0.5), null);
  assert.equal(PC.sortedQuantile([], [], 0.5), null);
  assert.equal(PC.wquantile([1, 2, 3], [1, 1, 1], 0.5), 2);
});
test("bucketOf / cycleOf boundaries match v2 and the spec", () => {
  assert.equal(PC.bucketOf(19.99 * 6e4), "<20m"); assert.equal(PC.bucketOf(20 * 6e4), "20-60m");
  assert.equal(PC.bucketOf(60 * 6e4), "1-3h"); assert.equal(PC.bucketOf(180 * 6e4), ">3h"); assert.equal(PC.bucketOf(Infinity), ">3h");
  assert.equal(PC.cycleOf(0), "c0"); assert.equal(PC.cycleOf(3.6e6), "c1"); assert.equal(PC.cycleOf(4 * 3.6e6), "c2"); assert.equal(PC.cycleOf(undefined), "c0");
  assert.equal(PC.bucketOfPreds({ a: 10 * 6e4, b: 30 * 6e4, med: 25 * 6e4 }), "20-60m");
  assert.equal(PC.bucketOfPreds({}), null);
});
test("cell hierarchy: keys, depth and parents", () => {
  assert.deepEqual(PC.cellKeys("rep", "<20m", "c0", true), ["rep|<20m|c0", "rep|<20m", "rep|all", "all"]);
  assert.deepEqual(PC.cellKeys("rep", "<20m", "c0", false), ["rep|<20m", "rep|all", "all"]);
  assert.equal(PC.parentOf("rep|<20m|c0"), "rep|<20m"); assert.equal(PC.parentOf("rep|<20m"), "rep|all");
  assert.equal(PC.parentOf("rep|all"), "all"); assert.equal(PC.parentOf("all"), null);
  assert.deepEqual(["rep|<20m|c0", "all", "rep|<20m", "rep|all"].map(PC.depthOf), [3, 0, 2, 1]);
});
test("logPreds: base models + median member + optional v2 member; bad values dropped; dispersion", () => {
  const lp = PC.logPreds({ s5: 100, s15: 400, s45: -3, quad: NaN, med: 999 }, 200);
  assert.deepEqual(Object.keys(lp).sort(), ["med", "s15", "s5", "v2"]);
  assert.ok(Math.abs(lp.med - Math.log(200)) < 1e-12);
  assert.equal(PC.dispersion({ s5: 1 }), 0);
  assert.ok(PC.dispersion(PC.logPreds({ s5: 1, s15: Math.E })) > 0.7);
});

// ---------- log parsing ----------
test("samplesFromLog: resolved, voided (censored), open, garbage lines; v2 vs v3 records", () => {
  const lines = [
    { type: "p", id: "a", made: 1000, lastAug: 0, spec: { kind: "rep" }, preds: { s5: 60000, s15: 60000 }, bucket: "1-3h", eta: 61000, lo: 50000, hi: 70000 },
    { type: "r", id: "a", at: 70000, actual: 66000, inBand: true },
    { type: "p", id: "b", made: 2000, lastAug: 0, spec: { kind: "money" }, preds: { s5: 6e6 } },
    { type: "r", id: "b", at: 9e6, void: "install" },
    { type: "p", id: "c", made: 3000, lastAug: 0, spec: { kind: "level" }, preds: { s5: 6e5 } },
    { type: "p", id: "d", made: 4000, lastAug: 0, v: "v3", spec: { kind: "rep" }, preds: { s5: 6e4 }, eta: 9000, lo: 8000, hi: 10000, v2eta: 7000, v2lo: 6000, v2hi: 8000 },
  ].map((o) => JSON.stringify(o));
  const S = PC.samplesFromLog([...lines, "not json", "", "{\"type\":\"r\"}"].join("\n"));
  assert.deepEqual(S.map((s) => s.id), ["a", "b", "c", "d"]);
  const [a, b, c, d] = S;
  assert.equal(a.actualMs, 65000); assert.equal(a.knownAt, 70000); assert.equal(a.censored, false); assert.equal(a.bucket, "1-3h");
  assert.deepEqual(a.logged, { d: 60000, lo: 49000, hi: 69000 }); assert.equal(a.v2d, 60000);
  assert.equal(b.censored, true); assert.equal(b.actualMs, null); assert.equal(b.bucket, "<20m".replace("<20m", PC.bucketOf(6e6)));
  assert.equal(c.knownAt, null); assert.equal(c.actualMs, null);
  assert.deepEqual(d.logged, { d: 3000, lo: 2000, hi: 4000 }, "v3 record: baseline = its v2 fields"); assert.equal(d.v2d, 3000);
  assert.deepEqual(PC.samplesFromLog(""), []); assert.deepEqual(PC.samplesFromLog(null), []);
  assert.equal(PC.toSample(null), null); assert.equal(PC.toSample({ id: "x", made: 1 }), null);
});

// ---------- the model ----------
test("replay has no look-ahead: changing outcomes not yet known at a prediction does not change it", () => {
  const s = synth({ n: 300, seed: 5 }), base = PC.replay(s).scored;
  const k = 200, cut = s[k].made, s2 = s.map((x) => (x.knownAt > cut ? { ...x, actualMs: x.actualMs * 7 } : x));
  const alt = PC.replay(s2).scored;
  for (let i = 0; i <= k; i++) assert.deepEqual(alt[i].p, base[i].p, `prediction ${i} changed`);
  assert.notDeepEqual(alt[k + 20].p, base[k + 20].p, "later predictions do see the changed outcomes");
});
test("first predictions (nothing resolved yet) return null so the caller falls back to v2", () => {
  const { scored } = PC.replay(synth({ n: 10, lagMin: 1e6 }));
  assert.ok(scored.every(({ p }) => p === null));
});
test("stationary data: held-out coverage of the nominal 80% band is within 75-85%", () => {
  const { scored } = PC.replay(synth({ n: 1500, seed: 11 }), { gamma: 0.01 });
  const c = coverage(scored, 500);
  assert.ok(c >= 0.75 && c <= 0.85, `coverage ${c}`);
});
test("regime shift: ACI + quantile tracking recover coverage after the noise doubles; without them it stays low", () => {
  const sig = (i) => (i < 600 ? 0.15 : 0.45), s = synth({ n: 1400, seed: 21, sigma: sig });
  const adaptive = coverage(PC.replay(s, { gamma: 0.03, track: 0.05, halfLifeH: 72 }).scored, 900);
  const frozen = coverage(PC.replay(s, { gamma: 0, track: 0, halfLifeH: 0, maxObs: 4000 }).scored, 900);
  assert.ok(adaptive >= 0.72, `adaptive ${adaptive}`);
  assert.ok(adaptive > frozen + 0.05, `adaptive ${adaptive} vs frozen ${frozen}`);
});
test("ensemble learns the accurate model: point error is far below the median of the models", () => {
  const s = synth({ n: 900, seed: 31, sigma: () => 0.02 });
  const { scored } = PC.replay(s, { pointMode: "ensemble", tau: 0.05 });
  const err = (f) => { const e = scored.slice(400).filter(({ p }) => p).map(f).sort((a, b) => a - b); return e[Math.floor(e.length / 2)]; };
  const ens = err(({ s: x, p }) => Math.abs(Math.log(x.actualMs / p.d)));
  const med = err(({ s: x }) => Math.abs(Math.log(x.actualMs) - PC.logPreds(x.preds).med));
  const s45 = err(({ s: x }) => Math.abs(Math.log(x.actualMs / x.preds.s45)));
  assert.ok(ens < 0.75 * med, `ensemble ${ens} vs median ${med}`);
  assert.ok(ens < 1.15 * s45, `ensemble ${ens} close to the best model ${s45}`);
  const last = scored[scored.length - 1].p;
  assert.ok(Object.keys(last.weights).some((m) => m.startsWith("s45")), JSON.stringify(last.weights));
});
test("point modes: median ignores fitted weights; best picks one member", () => {
  const s = synth({ n: 400, seed: 41 });
  const m = PC.replay(s, { pointMode: "median" }).scored.at(-1).p, b = PC.replay(s, { pointMode: "best" }).scored.at(-1).p;
  assert.equal(m.model, "median"); assert.equal(Object.keys(b.weights).length, 1);
});
test("hierarchical shrinkage: a sparse cell borrows its parent's band; shrinkK 0 uses its own", () => {
  const dense = synth({ n: 400, seed: 51, kind: "rep", baseMin: 90 });
  const sparse = synth({ n: 6, seed: 52, kind: "rep", baseMin: 10, sigma: () => 2 }).map((x, i) => ({ ...x, id: `q${i}`, made: dense[100 + i * 40].made + 1, knownAt: dense[100 + i * 40].made + 2 }));
  const all = [...dense, ...sparse];
  const sh = PC.replay(all, { shrinkK: 30 }).snapshot.cells, no = PC.replay(all, { shrinkK: 0 }).snapshot.cells;
  const w = (c) => c.qhi - c.qlo;
  assert.ok(w(no["rep|<20m"]) > w(sh["rep|<20m"]), "shrunk band is pulled toward the narrower parent");
});
test("applySnapshot: empty / missing input -> null; falls back from a missing cell to its parent; JSON round-trip is exact", () => {
  assert.equal(PC.applySnapshot(null, { kind: "rep", preds: { s5: 1 } }), null);
  assert.equal(PC.applySnapshot({ cells: {} }, { kind: "rep", preds: { s5: 6e4 } }), null);
  assert.equal(PC.applySnapshot({ cells: { all: { qlo: -1, qhi: 1 } } }, { kind: "rep", preds: {} }), null);
  const snap = PC.replay(synth({ n: 300, kind: "rep" })).snapshot;
  const p = PC.applySnapshot(snap, { kind: "money", preds: { s5: 3.6e6, s15: 3.6e6 } });
  assert.ok(p && p.cell === "all", "unknown kind uses the root cell");
  const q = { kind: "rep", preds: { s5: 5e6, s15: 5.2e6, s45: 5.1e6, quad: 4e6 }, sinceAug: 1e6 };
  assert.deepEqual(PC.applySnapshot(JSON.parse(JSON.stringify(snap)), q), PC.applySnapshot(snap, q));
  const r = PC.applySnapshot(snap, q); assert.ok(r.lo <= r.d && r.d <= r.hi && r.lo > 0);
});
test("validateSnapshot: every failure path has a code; a fresh replay is ok", () => {
  const now = 2e12, good = { ...PC.replay(synth({ n: 200 })).snapshot, t: now };
  assert.deepEqual(PC.validateSnapshot(good, now), { ok: true, code: "ok", reason: "ok" });
  const code = (s, t = now) => PC.validateSnapshot(s, t).code;
  assert.equal(code(null), "missing"); assert.equal(code("x"), "missing");
  assert.equal(code({ ...good, v: 2 }), "invalid");
  assert.equal(code({ ...good, t: undefined }), "invalid");
  assert.equal(code(good, now + 7 * 3.6e6), "stale");
  assert.equal(PC.validateSnapshot(good, now + 7 * 3.6e6, 8 * 3.6e6).ok, true, "maxAge is a parameter");
  assert.equal(code({ ...good, t: now + 3.6e6 }), "invalid", "future timestamp");
  assert.equal(code({ ...good, cells: {} }), "invalid");
  assert.equal(code({ ...good, cells: { all: null } }), "invalid");
  assert.equal(code({ ...good, cells: { all: { qlo: NaN, qhi: 1 } } }), "invalid");
  assert.equal(code({ ...good, cells: { all: { qlo: 0, qhi: 1, models: { s5: { bias: "x" } } } } }), "invalid");
  assert.equal(code({ ...good, cells: { all: { qlo: 0, qhi: 1, members: { s5: { loss: null } } } } }), "invalid");
});
test("liveCoverage: windows, minN gate, both alert directions, version filter, bad rows skipped", () => {
  const rows = (kind, bucket, hits, n, v) => Array.from({ length: n }, (_, i) => ({ kind, bucket, inBand: i < hits, v }));
  assert.deepEqual(PC.liveCoverage([]).alerts, []); assert.deepEqual(PC.liveCoverage(null).cells, {});
  const r = PC.liveCoverage([...rows("rep", ">3h", 10, 40), ...rows("rep", "<20m", 40, 40), ...rows("money", "1-3h", 32, 40), ...rows("level", ">3h", 1, 10), { kind: "rep" }, null, { kind: "rep", bucket: "x", inBand: "yes" }], { win: 50, minN: 30 });
  assert.deepEqual(r.alerts.map((a) => a.cell).sort(), ["rep|<20m", "rep|>3h"], "25% and 100% alert, 80% does not, n=10 is below minN");
  assert.equal(r.cells["level|>3h"].n, 10);
  const w = PC.liveCoverage([...rows("rep", ">3h", 0, 100), ...rows("rep", ">3h", 50, 50)], { win: 50 });
  assert.equal(w.cells["rep|>3h"].cov, 1, "window keeps only the newest 50"); assert.equal(w.cells["rep|>3h"].total, 150);
  const v = PC.liveCoverage([...rows("rep", ">3h", 0, 40, undefined), ...rows("rep", ">3h", 32, 40, "v3")], { version: "v3" });
  assert.equal(v.cells["rep|>3h"].n, 40); assert.deepEqual(v.alerts, []);
  assert.equal(PC.liveCoverage(rows("rep", ">3h", 0, 40, undefined), { version: "v2" }).alerts.length, 1, "records without v count as v2");
});

// ---------- agent/predictor.txt wiring (fake page: window + bb) ----------
function page({ settings = {}, predcal = SRC, cal = null, log = "" } = {}) {
  const files = { "/data/settings.txt": JSON.stringify({ version: 1, rev: 1, values: settings }), "lib/predcal.js": predcal, "/data/pred2.txt": log };
  if (cal) files["/data/pred-calib.txt"] = JSON.stringify(cal);
  const t0 = Date.now() - 60 * 6e4, tele = [];
  for (let i = 0; i <= 60; i++) tele.push(JSON.stringify({ t: t0 + i * 6e4, lastAug: t0 - 3.6e6, money: 1e6, income: 0, exp: { hacking: 1e4 }, lvl: { hacking: 100 }, rep: { X: 1000 + 50 * i }, work: { type: "FACTION", name: "X" } }));
  files["/data/telemetry.txt"] = tele.join("\n");
  const g = { files, window: {} };
  g.bb = { read: (f) => files[f] ?? files[f.replace(/^\//, "")] ?? files["/" + f] ?? "", write: (f, d, m) => { files[f] = m === "w" ? d : (files[f] || "") + d; } };
  new Function("window", "bb", fs.readFileSync(path.join(GAME, "agent/predictor.txt"), "utf8"))(g.window, g.bb);
  return g;
}
const goodCal = () => ({ t: Date.now(), table: {}, policy: {}, v3: { v: 3, t: Date.now(), opts: { pointMode: "ensemble", tau: 0.1 }, cells: { "rep|all": { n: 50, nr: 50, models: {}, members: { med: { n: 50, loss: 0.1 } }, qlo: -0.2, qhi: 0.3, alpha: [0.1, 0.1], off: [0, 0] } } } });
const lastP = (g) => g.files["/data/pred2.txt"].trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.type === "p").pop();

test("predictor.txt default (v2): records carry no v, no v3 attention", () => {
  const g = page({ cal: goodCal() });
  const p = g.window.__pred2.predict({ kind: "rep", faction: "X", target: 6000 });
  assert.ok(p.eta && !p.v && !p.v2eta);
  assert.equal(g.window.__pred2.version(), "v2");
  assert.deepEqual(g.window.__pred2.attentionOf(), []);
});
test("predictor.txt v3 with a valid calibration answers with v3 and keeps v2's answer in the record", () => {
  const g = page({ settings: { "predictor.version": "v3" }, cal: goodCal() });
  const p = g.window.__pred2.predict({ kind: "rep", faction: "X", target: 6000 });
  assert.equal(p.v, "v3"); assert.ok(p.v2eta && p.v2lo && p.v2hi); assert.ok(p.lo <= p.eta && p.eta <= p.hi);
  assert.equal(Math.round(Math.log((p.hi - p.made) / (p.eta - p.made)) * 10) / 10, 0.3);
  assert.equal(lastP(g).v, "v3");
  assert.deepEqual(g.window.__pred2.attentionOf(), []);
});
test("predictor.txt v3 falls back to v2 loudly: missing lib, missing / stale / invalid calibration, no usable cell", () => {
  const spec = { kind: "rep", faction: "X", target: 6000 };
  const cases = [
    [{ predcal: "" }, "missing"],
    [{ cal: { ...goodCal(), v3: undefined } }, "missing"],
    [{ cal: { ...goodCal(), v3: { ...goodCal().v3, t: Date.now() - 7 * 3.6e6 } } }, "stale"],
    [{ cal: { ...goodCal(), v3: { error: "boom" } } }, "invalid"],
    [{ cal: { ...goodCal(), v3: { ...goodCal().v3, v: 99 } } }, "invalid"],
  ];
  for (const [opt, codeWant] of cases) {
    const g = page({ settings: { "predictor.version": "v3" }, cal: goodCal(), ...opt });
    const p = g.window.__pred2.predict(spec, { log: false });
    assert.ok(p.eta && !p.v, `${codeWant}: answered by v2`); assert.equal(p.v3fallback, codeWant);
    const att = g.window.__pred2.attentionOf();
    assert.equal(att.length, 1, codeWant); assert.ok(att[0].startsWith(`predictor v3 calibration ${codeWant}: answering with v2`), att[0]);
    assert.ok(!/\d+(\.\d+)?h/.test(att[0]), "no changing numbers in the attention text (stable escalation key)");
  }
  const g = page({ settings: { "predictor.version": "v3" }, cal: { ...goodCal(), v3: { ...goodCal().v3, cells: { "money|all": { qlo: null, qhi: null, members: {} } } } } });
  const p = g.window.__pred2.predict(spec, { log: false });
  assert.equal(p.v3fallback, "no usable v3 cell"); assert.ok(!p.v);
});
test("predictor.txt coverage attention: stable text naming the cells; resolve() scores v2 in shadow", () => {
  const P = [], R = [];
  for (let i = 0; i < 40; i++) { P.push({ type: "p", id: `a${i}`, made: 1, spec: { kind: "rep" }, preds: { s5: 1 }, bucket: ">3h", v: "v3" }); R.push({ type: "r", id: `a${i}`, at: 2, actual: 2, inBand: i < 10 }); }
  const log = [...P, ...R].map((o) => JSON.stringify(o)).join("\n") + "\n";
  const g = page({ settings: { "predictor.version": "v3" }, cal: goodCal(), log });
  assert.deepEqual(g.window.__pred2.attentionOf(), ["predictor v3 80% band coverage outside 70-90% in rep|>3h (data/pred-calib.txt liveCoverage)"]);
  const g2 = page({ settings: { "predictor.version": "v2" }, cal: goodCal(), log });
  assert.deepEqual(g2.window.__pred2.attentionOf(), [], "v2 is active: v3 records do not count");
  // a v3 prediction that resolves gets v2inBand
  const g3 = page({ settings: { "predictor.version": "v3" }, cal: goodCal() });
  g3.window.__pred2.predict({ kind: "rep", faction: "X", target: 6000 });
  const tele = g3.files["/data/telemetry.txt"].split("\n"), last = JSON.parse(tele.at(-1));
  g3.files["/data/telemetry.txt"] += "\n" + JSON.stringify({ ...last, t: last.t + 6e4, rep: { X: 1e6 } });
  const res = g3.window.__pred2.resolve();
  assert.equal(res.length, 1); assert.equal(typeof res[0].v2inBand, "boolean");
});
test("predictor.txt calibrate() writes v3 snapshot + liveCoverage into pred-calib.txt, even in v2 mode", () => {
  const lines = synth({ n: 120 }).map((s) => [{ type: "p", id: s.id, made: s.made, lastAug: s.lastAug, spec: { kind: "rep" }, preds: s.preds, bucket: s.bucket, eta: s.made + s.preds.s45, lo: s.made + 1, hi: s.made + 2 * s.preds.s45 },
    { type: "r", id: s.id, at: s.knownAt, actual: s.made + s.actualMs, inBand: true }]).flat();
  const g = page({ log: lines.map((o) => JSON.stringify(o)).join("\n") + "\n" });
  g.window.__pred2.calibrate();
  const cal = JSON.parse(g.files["/data/pred-calib.txt"]);
  assert.equal(PC.validateSnapshot(cal.v3, Date.now() + 1e12 > 0 ? cal.v3.t : 0).ok, true);
  assert.ok(cal.liveCoverage && cal.liveCoverage.cells["rep|" + lines[0].bucket], JSON.stringify(cal.liveCoverage));
  assert.equal(cal.liveCoverage.version, "v2");
});
test("predictor.txt tick() recalibrates when the v3 snapshot is missing, so a fresh push does not fall back", () => {
  const g = page({ settings: { "predictor.version": "v3" }, cal: { ...goodCal(), v3: undefined, t: Date.now() } });
  const nx = g.window.__pred2.tick([{ kind: "rep", faction: "X", target: 6000 }]);
  assert.ok(JSON.parse(g.files["/data/pred-calib.txt"]).v3, "calibrate() ran and wrote a v3 entry");
  assert.ok(Array.isArray(nx.attention));
});
test("checkin-lib forwards predictor attention and shows the active version in the Predictions row", () => {
  const src = fs.readFileSync(path.join(GAME, "agent/checkin-lib.txt"), "utf8");
  assert.ok(src.includes("for (const f of nx.attention || []) out.attention.push(f);"));
  assert.ok(src.includes('"v3→v2 fallback · "') && src.includes("scored by v3"));
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} predcal test(s) failed`); process.exit(1); }
console.log(`predcal: ${tests.length} passed`);
