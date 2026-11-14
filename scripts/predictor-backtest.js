#!/usr/bin/env node
// scripts/predictor-backtest.js — offline, deterministic, rolling-origin backtest of the ETA predictor.
//
//   node scripts/predictor-backtest.js <pred2.txt> [--install-log install-log.txt] [--json out.json] [--split 0.5]
//
// Input is the game's data/pred2.txt (JSON lines: {type:"p"} predictions with the raw per-model durations, {type:"r"}
// resolutions). Every candidate predicts each logged prediction using only outcomes known (resolution time) before that
// prediction was made. Baseline "v2" is the band the live predictor actually logged. Hyper-parameters are chosen on the
// first `split` of the timeline (tuning) and reported on the rest (held-out). Coverage CIs come from a block bootstrap
// over install cycles (predictions in one cycle share a regime and are strongly autocorrelated).
// Spec: docs/specs/predictor-v3.md. Read-only: never talks to the game.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PC = await import(pathToFileURL(path.join(here, "../game/lib/predcal.js")).href);

export const Z80 = 1.2816;
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const LN = Math.log;

// ---------- deterministic RNG for the bootstrap ----------
export function rng(seed = 1) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** Censor time per voided sample: first install after it was made (install-log t values), else its resolution time. */
export function attachCensor(samples, installTimes = []) {
  const ts = [...installTimes].filter(fin).sort((a, b) => a - b);
  for (const s of samples) {
    if (!s.censored) continue;
    const t = ts.find((x) => x > s.made);
    s.censorMs = fin(t) && (!fin(s.knownAt) || t <= s.knownAt) ? t - s.made : fin(s.knownAt) ? s.knownAt - s.made : null;
  }
  return samples;
}

/** v2 as logged: its own point and band. PIT under the lognormal its symmetric band implies. */
export const baselineV2 = (s) => (s.logged && s.logged.d > 0 && s.logged.lo > 0 && s.logged.hi > 0 ? { d: s.logged.d, lo: s.logged.lo, hi: s.logged.hi, model: "v2" } : null);

/** Score one (sample, prediction) pair in log space. alpha = 1 - nominal coverage. */
export function scoreOne(s, p, alpha = 0.2) {
  if (!p || !fin(s.actualMs)) return null;
  const y = LN(s.actualMs), m = LN(p.d), l = LN(p.lo), u = LN(p.hi);
  const inBand = s.actualMs >= p.lo && s.actualMs <= p.hi;
  const pin = (q, tau) => (y >= q ? tau * (y - q) : (1 - tau) * (q - y));
  const is = (u - l) + (2 / alpha) * Math.max(0, l - y) + (2 / alpha) * Math.max(0, y - u);
  // PIT: piecewise-lognormal through (lo, d, hi) at (alpha/2, 0.5, 1-alpha/2)
  const sd = y >= m ? (u - m) / Z80 : (m - l) / Z80; // Z80 = z(0.9): the band edges are the 10% / 90% quantiles
  const pit = sd > 0 ? normCdf((y - m) / sd) : (y >= m ? 1 : 0);
  return { inBand, early: s.actualMs < p.lo, late: s.actualMs > p.hi, err: y - m, ae: Math.abs(y - m), ape: Math.abs(p.d - s.actualMs) / s.actualMs,
    is, pinball: (pin(l, alpha / 2) + pin(m, 0.5) + pin(u, 1 - alpha / 2)) / 3, width: u - l, pit };
}

export function normCdf(x) { // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

const q = (xs, p) => { const s = xs.filter(fin).sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };

/** Lag-1 autocorrelation of a series. */
export function acf1(xs) {
  const v = xs.filter(fin), n = v.length; if (n < 3) return null;
  const m = v.reduce((a, b) => a + b, 0) / n; let num = 0, den = 0;
  for (let i = 0; i < n; i++) { den += (v[i] - m) ** 2; if (i) num += (v[i] - m) * (v[i - 1] - m); }
  return den > 0 ? num / den : null;
}

/** Block-bootstrap 95% CI of coverage, resampling whole install cycles. */
export function coverageCI(rows, B = 400, seed = 7) {
  const by = new Map(); for (const r of rows) { const k = r.block; if (!by.has(k)) by.set(k, []); by.get(k).push(r.inBand ? 1 : 0); }
  const blocks = [...by.values()]; if (blocks.length < 2) return null;
  const rand = rng(seed), covs = [];
  for (let b = 0; b < B; b++) { let h = 0, n = 0; for (let i = 0; i < blocks.length; i++) { const bl = blocks[Math.floor(rand() * blocks.length)]; for (const x of bl) { h += x; n++; } } if (n) covs.push(h / n); }
  return [q(covs, 0.025), q(covs, 0.975)];
}

/** Aggregate scored rows into a metrics object. rows: [{s, sc, block}] */
export function aggregate(rows, { ci = true } = {}) {
  const sc = rows.map((r) => r.sc).filter(Boolean); const n = sc.length; if (!n) return { n: 0 };
  const mean = (f) => sc.reduce((a, x) => a + f(x), 0) / n;
  const pit = new Array(10).fill(0); for (const x of sc) pit[Math.min(9, Math.floor(x.pit * 10))]++;
  const ordered = rows.filter((r) => r.sc).sort((a, b) => a.s.made - b.s.made);
  const out = { n, blocks: new Set(rows.map((r) => r.block)).size, coverage: +mean((x) => (x.inBand ? 1 : 0)).toFixed(3), early: +mean((x) => (x.early ? 1 : 0)).toFixed(3), late: +mean((x) => (x.late ? 1 : 0)).toFixed(3),
    medAE: +q(sc.map((x) => x.ae), 0.5).toFixed(3), mdAPE: +(100 * q(sc.map((x) => x.ape), 0.5)).toFixed(1), within25: +mean((x) => (x.ape <= 0.25 ? 1 : 0)).toFixed(3),
    bias: +q(sc.map((x) => x.err), 0.5).toFixed(3), intervalScore: +mean((x) => x.is).toFixed(3), pinball: +mean((x) => x.pinball).toFixed(4), medWidth: +q(sc.map((x) => x.width), 0.5).toFixed(3),
    pit, acf1: (() => { const a = acf1(ordered.map((r) => r.sc.err)); return a == null ? null : +a.toFixed(2); })() };
  if (ci) { const c = coverageCI(rows.filter((r) => r.sc).map((r) => ({ block: r.block, inBand: r.sc.inBand }))); out.ci95 = c && c.map((x) => +x.toFixed(3)); }
  out.neff = out.acf1 != null && out.acf1 > 0 ? Math.round(n * (1 - out.acf1) / (1 + out.acf1)) : n;
  return out;
}

/** Group rows by a key function and aggregate each group. */
export function groupBy(rows, keyOf, opts) {
  const g = {}; for (const r of rows) { const k = keyOf(r); if (k == null) continue; (g[k] = g[k] || []).push(r); }
  return Object.fromEntries(Object.entries(g).sort().map(([k, v]) => [k, aggregate(v, opts)]));
}

/** Run one candidate over all samples (rolling origin). Returns rows with the per-sample score. */
export function runCandidate(samples, cand) {
  if (cand.kind === "logged") return samples.map((s) => ({ s, p: baselineV2(s), block: s.lastAug }));
  const { scored } = PC.replay(samples, cand.opts || {});
  return scored.map(({ s, p }) => ({ s, p, block: s.lastAug }));
}

export function score(rows, alpha = 0.2) { for (const r of rows) r.sc = r.p ? scoreOne(r.s, r.p, alpha) : null; return rows; }

/** Censored samples (voided by an install): a band whose hi is below the censor time is a definite miss. */
export function censoredMisses(rows) {
  let n = 0, miss = 0, unknown = 0;
  for (const r of rows) { if (!r.s.censored || !r.p || !fin(r.s.censorMs)) continue; n++; if (r.s.censorMs > r.p.hi) miss++; else unknown++; }
  return { n, definiteMiss: miss, unknown, definiteMissRate: n ? +(miss / n).toFixed(3) : null };
}

export const CANDIDATES = {
  v2: { kind: "logged", label: "v2 as logged (baseline)" },
  median_conformal: { label: "(a) plain median point + adaptive conformal band, kind x bucket", opts: { pointMode: "median" } },
  best_conformal: { label: "v2-style single best model, prequential selection + ACI band", opts: { pointMode: "best" } },
  ens_conformal: { label: "(a+d+e) prequential ensemble (raw + bias-corrected members, median, v2) + ACI + shrinkage", opts: { pointMode: "ensemble" } },
  ens_disp: { label: "(b) ensemble + band scaled by model dispersion (normalised conformal)", opts: { pointMode: "ensemble", scale: "disp" } },
  ens_cycle: { label: "(c) ensemble + cycle-phase cells (regime split by time since install)", opts: { pointMode: "ensemble", useCycle: true } },
  ens_noshrink: { label: "(d) ablation: ensemble without hierarchical shrinkage", opts: { pointMode: "ensemble", shrinkK: 0 } },
  ens_pid: { label: "(a') ensemble + ACI + online quantile tracking of the edges (conformal PID, P term)", opts: { pointMode: "ensemble", gamma: 0.03, track: 0.05 } },
  ens_robust: { label: "(a'') ensemble + cluster-robust band (1/target weights, one ACI step per resolution batch)", opts: { pointMode: "ensemble", gamma: 0.03, dedup: 1, batchAci: true } },
  v3: { label: "v3 as shipped: grid-tuned on the tuning period only", opts: {}, tuned: true },
};

/** Hyper-parameter grid for v3 (point mode is tuned too), scored on the tuning period only. gamma 0 = no ACI. */
export const GRID = (() => {
  const g = [];
  for (const halfLifeH of [72, 0]) for (const gamma of [0, 0.03, 0.1]) for (const track of [0, 0.02]) for (const dedup of [0, 1]) for (const batchAci of [false, true]) {
    for (const tau of [0.1, 0.3]) g.push({ pointMode: "ensemble", halfLifeH, gamma, track, dedup, batchAci, tau });
    g.push({ pointMode: "median", halfLifeH, gamma, track, dedup, batchAci });
  }
  return g;
})();

export function objective(agg) { return agg.n ? agg.intervalScore + 10 * Math.max(0, Math.abs(agg.coverage - 0.8) - 0.02) : Infinity; }

/** Decision buckets: what feeds install timing (next-aug rep, aug money) and the destroy ETA (hacking level, long horizons). */
export const DECISION = (r) => (r.s.kind === "rep" || (r.s.kind === "level" && (r.s.bucket === ">3h" || r.s.bucket === "1-3h")) || (r.s.kind === "money" && r.s.bucket === ">3h"));

export function report(samples, { split = 0.5, tune = true, candidates = Object.keys(CANDIDATES) } = {}) {
  const made = samples.map((s) => s.made).sort((a, b) => a - b), cut = made[Math.floor(made.length * split)] ?? Infinity;
  const isTest = (r) => r.s.made >= cut, isTune = (r) => r.s.made < cut;
  const res = { cut, nSamples: samples.length, nResolved: samples.filter((s) => fin(s.actualMs)).length, nCensored: samples.filter((s) => s.censored).length, candidates: {}, tuning: null };
  let best = null;
  if (tune) {
    const scoredGrid = GRID.map((g) => { const rows = score(runCandidate(samples, { opts: { ...CANDIDATES.v3.opts, ...g } })).filter(isTune); return { g, agg: aggregate(rows, { ci: false }) }; });
    scoredGrid.sort((a, b) => objective(a.agg) - objective(b.agg));
    best = scoredGrid[0].g; res.tuning = { chosen: best, grid: scoredGrid.map((x) => ({ ...x.g, obj: +objective(x.agg).toFixed(3), cov: x.agg.coverage, is: x.agg.intervalScore, medAE: x.agg.medAE })) };
  }
  for (const name of candidates) {
    const c = CANDIDATES[name]; const opts = c.tuned && best ? { ...c.opts, ...best } : c.opts;
    const rows = score(runCandidate(samples, { ...c, opts }));
    const test = rows.filter(isTest);
    res.candidates[name] = { label: c.label, opts, heldOut: aggregate(test), byBucket: groupBy(test, (r) => (r.sc ? `${r.s.kind}|${r.s.bucket}` : null)),
      byKind: groupBy(test, (r) => (r.sc ? r.s.kind : null)), byCycle: groupBy(test, (r) => (r.sc ? `${r.s.kind}|${PC.cycleOf(r.s.sinceAug)}` : null), { ci: false }),
      decision: aggregate(test.filter(DECISION)), all: aggregate(rows), censored: censoredMisses(test), folds: folds(rows, 4) };
  }
  return res;
}

/** Rolling folds: the timeline cut into k consecutive blocks; each block scored on its own (all predictions are out-of-sample). */
export function folds(rows, k = 4) {
  const s = rows.filter((r) => r.sc).sort((a, b) => a.s.made - b.s.made), out = [];
  for (let i = 0; i < k; i++) { const part = s.slice(Math.floor((i * s.length) / k), Math.floor(((i + 1) * s.length) / k)); const a = aggregate(part, { ci: false }); out.push({ fold: i + 1, n: a.n, coverage: a.coverage, medAE: a.medAE, intervalScore: a.intervalScore }); }
  return out;
}

// ---------- pretty print ----------
function table(title, obj, cols) {
  const lines = [`\n## ${title}`, `| cell | ${cols.join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`];
  for (const [k, a] of Object.entries(obj)) lines.push(`| ${k} | ${cols.map((c) => fmt(a[c])).join(" | ")} |`);
  return lines.join("\n");
}
const fmt = (v) => (Array.isArray(v) ? `[${v.join(", ")}]` : v == null ? "—" : String(v));

export function render(res) {
  const cols = ["n", "blocks", "coverage", "ci95", "early", "late", "medAE", "mdAPE", "bias", "intervalScore", "pinball", "medWidth", "acf1", "neff"];
  const out = [`# Predictor backtest`, `samples ${res.nSamples}, resolved ${res.nResolved}, censored (voided by install) ${res.nCensored}; held-out = made >= ${new Date(res.cut).toISOString()}`];
  if (res.tuning) out.push(`tuned on the first part: ${JSON.stringify(res.tuning.chosen)}`);
  out.push(table("Held-out, overall", Object.fromEntries(Object.entries(res.candidates).map(([k, c]) => [k, c.heldOut])), cols));
  out.push(table("Held-out, decision buckets (rep all, level 1-3h/>3h, money >3h)", Object.fromEntries(Object.entries(res.candidates).map(([k, c]) => [k, c.decision])), cols));
  for (const [k, c] of Object.entries(res.candidates)) {
    out.push(table(`${k}: ${c.label} — held-out by kind|bucket`, c.byBucket, cols));
    out.push(`censored (voided by install) in held-out: ${JSON.stringify(c.censored)}; rolling folds (all data): ${JSON.stringify(c.folds)}`);
  }
  return out.join("\n");
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), file = args.find((a) => !a.startsWith("--") && !/^\d/.test(a));
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  if (!file) { console.error("usage: node scripts/predictor-backtest.js <pred2.txt> [--install-log f] [--json out.json] [--split 0.5] [--no-tune]"); process.exit(2); }
  const samples = PC.samplesFromLog(fs.readFileSync(file, "utf8"));
  const il = opt("--install-log");
  if (il) attachCensor(samples, fs.readFileSync(il, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).t; } catch { return null; } }));
  const res = report(samples, { split: +(opt("--split") || 0.5), tune: !args.includes("--no-tune") });
  if (opt("--json")) fs.writeFileSync(opt("--json"), JSON.stringify(res, null, 1));
  console.log(render(res));
}
