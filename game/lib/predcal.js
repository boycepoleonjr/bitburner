/**
 * lib/predcal.js — predictor v3 calibration: online, regime-aware ensemble + adaptive conformal bands.
 *
 * PURE: no `ns`, no imports, no DOM, no RAM-costing Netscript names. Used three ways with the same code:
 *   - agent/predictor.txt (page context) loads it with loadPredcal(): bb.read("lib/predcal.js") -> new Function
 *   - scripts/predictor-backtest.js (Node) replays data/pred2.txt through it (rolling origin, no look-ahead)
 *   - tests (test/predcal.js) import it directly
 * Spec: docs/specs/predictor-v3.md.
 *
 * Model, per cell (kind x horizon bucket, optionally x cycle phase; pooled up to kind and all):
 *   point  = weighted geometric mean of ensemble members: each base model (s5, s15, s45, quad, income, ledger, planned)
 *            raw and bias-corrected ("m~", b_m = median ln(actual/pred_m) in the cell), their median, and v2's own point;
 *            weights = softmax(-L / tau), L = mean PREQUENTIAL |log error| (each scored with the state of its own time).
 *   band   = point * exp([q_lo, q_hi]); q = (optionally decayed) empirical quantiles of the honest residual
 *            ln(actual/point) (point as it was predicted at the time) over the last maxObs outcomes, shrunk toward the
 *            parent cell by n/(n+K), levels alpha_lo and 1 - alpha_hi adapted online per edge (adaptive conformal
 *            inference) toward 0.10 each.
 *   Only samples whose outcome was known before a prediction was made ever reach that prediction (knownAt <= made).
 */

export const PREDCAL_VERSION = 3;
export const BASE_MODELS = ["s5", "s15", "s45", "quad", "income", "ledger", "planned"];
export const BUCKETS = [["<20m", 20], ["20-60m", 60], ["1-3h", 180], [">3h", Infinity]];
/** Cycle phase = time since the last augmentation install (the regime resets there). */
export const CYCLES = [["c0", 1], ["c1", 4], ["c2", Infinity]];

/**
 * Defaults = the configuration scripts/predictor-backtest.js chose on the TUNING half of the live log (2026-09-27 to
 * 2026-10-21) by interval score + coverage penalty, out of a 144-point grid; never tuned on the held-out half.
 * docs/specs/predictor-v3.md "Results" has the numbers.
 */
export const DEFAULTS = Object.freeze({
  target: 0.8,          // nominal band coverage
  halfLifeH: 0,         // decay of old outcomes in hours of made time; 0 = none (grid: 72 h lost on the tuning half)
  maxObs: 400,          // max outcomes kept per cell (the window that makes the fit follow regime changes)
  shrinkK: 30,          // pseudo-count pulling a cell's band toward its parent
  tau: 0.3,             // ensemble softmax temperature (log-error units)
  minModelN: 8,         // a member needs this many outcomes in a cell to get its own weight
  gamma: 0.1,           // ACI step size (on the quantile level of each edge)
  track: 0,             // online quantile tracking step (log units) on the band edges (conformal PID, P term); 0 = off
  alphaMin: 0.02, alphaMax: 0.5,
  useCycle: false,      // split cells by cycle phase (time since install); off: the backtest found it too sparse
  pointMode: "ensemble",// "ensemble" | "best" | "median"
  aci: true,            // adaptive conformal inference, one alpha per band edge (asymmetric drift)
  scale: "none",        // "disp": residuals normalised by sMin + model dispersion (locally adaptive bands) | "none"
  sMin: 0.1,
  dedup: 0,             // 1: band quantiles weight each outcome by 1/(outcomes of the same target in the cell) (cluster-robust)
  batchAci: false,      // true: one ACI / tracking step per resolution batch and cell (mean miss), not one per prediction
  refitMs: 2 * 3.6e6,   // decay clock granularity for refits without new outcomes (live recalibrates at least every 2h)
});

const LN2 = Math.log(2);
const fin = (x) => typeof x === "number" && Number.isFinite(x);

export function bucketOf(ms) { const m = ms / 6e4; for (const [k, lim] of BUCKETS) if (m < lim) return k; return ">3h"; }
export function cycleOf(sinceAugMs) { const h = (sinceAugMs || 0) / 3.6e6; for (const [k, lim] of CYCLES) if (h < lim) return k; return "c2"; }
export function median(xs) { const s = xs.filter(fin).sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; }

/** v2's horizon bucket: median over every logged prediction value (including the "med" entry). */
export function bucketOfPreds(preds) { const m = median(Object.values(preds || {})); return m == null ? null : bucketOf(m); }

/** Weighted lower quantile: smallest x whose cumulative weight reaches p of the total. xs, ws same length; returns null on empty. */
export function wquantile(xs, ws, p) {
  const idx = []; let W = 0;
  for (let i = 0; i < xs.length; i++) if (fin(xs[i]) && ws[i] > 0) { idx.push(i); W += ws[i]; }
  if (!idx.length || !(W > 0)) return null;
  idx.sort((a, b) => xs[a] - xs[b]);
  const target = Math.min(Math.max(p, 0), 1) * W; let acc = 0;
  for (const i of idx) { acc += ws[i]; if (acc >= target - 1e-12) return xs[i]; }
  return xs[idx[idx.length - 1]];
}

/** "all" = 0, "kind|all" = 1, "kind|bucket" = 2, "kind|bucket|cycle" = 3 */
export function depthOf(k) { if (k === "all") return 0; const p = k.split("|"); return p[1] === "all" ? 1 : p.length; }
/** Parent cell for shrinkage (null for the root). */
export function parentOf(k) { const p = k.split("|"); if (k === "all") return null; if (p.length === 3) return `${p[0]}|${p[1]}`; if (p[1] !== "all") return `${p[0]}|all`; return "all"; }

/** Same rule as wquantile on data already sorted, with cumulative weights cw. */
export function sortedQuantile(xs, cw, p) {
  const n = xs.length; if (!n || !(cw[n - 1] > 0)) return null;
  const target = Math.min(Math.max(p, 0), 1) * cw[n - 1] - 1e-12; let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cw[mid] >= target) hi = mid; else lo = mid + 1; }
  return xs[lo];
}

/** Cell keys from most to least specific. */
export function cellKeys(kind, bucket, cycle, useCycle = false) {
  const k = [];
  if (useCycle) k.push(`${kind}|${bucket}|${cycle}`);
  k.push(`${kind}|${bucket}`, `${kind}|all`, "all");
  return k;
}

/** ln(duration) per base model, plus "med" = median of the available base models (itself an ensemble member). */
export function logPreds(preds, v2d) {
  const o = {}; for (const m of BASE_MODELS) { const v = preds && preds[m]; if (fin(v) && v > 0) o[m] = Math.log(v); }
  const md = median(Object.values(o)); if (md != null) o.med = md;
  if (fin(v2d) && v2d > 0) o.v2 = Math.log(v2d); // stacking: v2's own calibrated point is a member too
  return o;
}
/** Spread of the base models (sd of ln predictions): how much they disagree. 0 with fewer than two models. */
export function dispersion(lp) {
  const v = BASE_MODELS.map((m) => lp[m]).filter(fin); if (v.length < 2) return 0;
  const mu = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / (v.length - 1));
}
const FIT_MODELS = [...BASE_MODELS, "med", "v2"];

/**
 * Normalise one prediction record (+ optional resolution) into a replay sample.
 * p: {id, made, lastAug, spec:{kind}, preds, bucket?, eta?, lo?, hi?, v?, v2eta?, v2lo?, v2hi?}; r: {at, actual?, void?} | undefined
 * Records without `v` were written by v2 (eta/lo/hi are v2's). v3 records keep v2's answer in v2eta/v2lo/v2hi, so the
 * v2 baseline and the stacking member stay available after the switch.
 */
export function toSample(p, r) {
  if (!p || !p.spec || !p.preds || !fin(p.made)) return null;
  const s = { id: p.id, kind: p.spec.kind, tkey: `${p.spec.kind}|${p.spec.faction || p.spec.skill || ""}|${Math.round(fin(+p.spec.target) ? +p.spec.target : fin(p.T) ? p.T : 0)}`, made: p.made, sinceAug: fin(p.lastAug) ? p.made - p.lastAug : 0, lastAug: p.lastAug,
    preds: p.preds, bucket: p.bucket || bucketOfPreds(p.preds), v2d: fin(p.v2eta) ? p.v2eta - p.made : fin(p.eta) && !p.v ? p.eta - p.made : null, logged: fin(p.v2eta) ? { d: p.v2eta - p.made, lo: p.v2lo - p.made, hi: p.v2hi - p.made } : fin(p.eta) && !p.v ? { d: p.eta - p.made, lo: p.lo - p.made, hi: p.hi - p.made } : null,
    actualMs: null, censored: false, knownAt: null };
  if (r) {
    s.knownAt = fin(r.at) ? r.at : fin(r.actual) ? r.actual : null;
    if (fin(r.actual) && r.actual > p.made) s.actualMs = r.actual - p.made;
    else if (r.void) s.censored = true;
  }
  return s;
}

/** Parse pred2.txt text -> samples sorted by made (resolved, censored and open). */
export function samplesFromLog(text) {
  const P = new Map(), R = new Map();
  for (const line of String(text || "").split("\n")) {
    if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== "object") continue;
    if (o.type === "p" && o.id) P.set(o.id, o); else if (o.type === "r" && o.id && !R.has(o.id)) R.set(o.id, o);
  }
  const out = [];
  for (const [id, p] of P) { const s = toSample(p, R.get(id)); if (s && s.bucket) out.push(s); }
  return out.sort((a, b) => a.made - b.made);
}

// ---------- cell statistics -> snapshot ----------

function scaleOf(lp, o) { return o.scale === "disp" ? (o.sMin > 0 ? o.sMin : 0.1) + dispersion(lp) : 1; }
function decayW(t, now, halfLifeH) { return halfLifeH > 0 && fin(halfLifeH) ? Math.exp(-LN2 * Math.max(0, now - t) / (halfLifeH * 3.6e6)) : 1; }

/**
 * Fit one cell from its outcome list. obs: [{t, lp:{m: ln pred}, la: ln actual, r: honest residual, pe:{member: |error|}}]
 * models[m].bias = decayed median of ln(actual/pred_m) (used for the bias-corrected member "m~");
 * members[key].loss = decayed mean of the PREQUENTIAL absolute log error (each error scored with the state at its own
 * prediction time), so a bias correction only earns weight if it helped out of sample.
 */
function fitCell(obs, now, o) {
  const w = obs.map((x) => decayW(x.t, now, o.halfLifeH));
  // band weights: optionally 1/(outcomes of the same target), so one target predicted 40 times counts once (cluster-robust)
  const cnt = new Map(); if (o.dedup) for (const x of obs) cnt.set(x.tk, (cnt.get(x.tk) || 0) + 1);
  const wb = o.dedup ? obs.map((x, i) => w[i] / (x.tk != null ? cnt.get(x.tk) : 1)) : w;
  const n = obs.length, neff = (() => { const s = w.reduce((a, b) => a + b, 0), s2 = w.reduce((a, b) => a + b * b, 0); return s2 > 0 ? (s * s) / s2 : 0; })();
  const models = {}, members = {};
  for (const m of FIT_MODELS) {
    const e = [], ww = [];
    for (let i = 0; i < n; i++) { const lp = obs[i].lp[m]; if (lp != null) { e.push(obs[i].la - lp); ww.push(w[i]); } }
    if (e.length >= o.minModelN) models[m] = { n: e.length, bias: wquantile(e, ww, 0.5) };
  }
  const acc = {};
  for (let i = 0; i < n; i++) for (const [k, v] of Object.entries(obs[i].pe || {})) { const a = (acc[k] = acc[k] || { n: 0, L: 0, W: 0 }); a.n++; a.L += w[i] * v; a.W += w[i]; }
  for (const [k, a] of Object.entries(acc)) if (a.n >= o.minModelN && a.W > 0) members[k] = { n: a.n, loss: a.L / a.W };
  // residuals sorted once with cumulative weights, so any quantile level is a binary search (ACI moves the level)
  const idx = []; for (let i = 0; i < n; i++) if (fin(obs[i].r) && wb[i] > 0) idx.push(i);
  idx.sort((a, b) => obs[a].r - obs[b].r);
  const rs = idx.map((i) => obs[i].r), cw = []; let acc2 = 0; for (const i of idx) { acc2 += wb[i]; cw.push(acc2); }
  return { n, neff, models, members, rs, cw };
}

/** Member values for one prediction: raw "m" = ln pred_m, corrected "m~" = ln pred_m + bias_m (most specific cell with m). */
function memberValues(snap, keys, lp) {
  const out = {};
  for (const m of Object.keys(lp)) {
    out[m] = lp[m];
    for (const k of keys) { const c = snap.cells[k], x = c && c.models && c.models[m]; if (x && fin(x.bias)) { out[m + "~"] = lp[m] + x.bias; break; } }
  }
  return out;
}

function weightsFor(members, vals, o) {
  const ms = Object.keys(members).filter((m) => vals[m] != null && fin(members[m].loss));
  if (!ms.length) return null;
  if (o.pointMode === "best") { const best = ms.reduce((a, b) => (members[b].loss < members[a].loss ? b : a)); return { [best]: 1 }; }
  const Lmin = Math.min(...ms.map((m) => members[m].loss)), out = {}; let Z = 0;
  for (const m of ms) { const x = Math.exp(-(members[m].loss - Lmin) / o.tau); out[m] = x; Z += x; }
  for (const m of ms) out[m] /= Z;
  return out;
}

/**
 * The online calibrator. observe() outcomes in knownAt order, predict() at made time; snapshot() exports the
 * compact state the game uses (applySnapshot() gives the same answer as predict() for the same state).
 */
export function createCalibrator(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const cells = new Map(); // key -> obs[]
  const alpha = new Map(); // key -> current alpha (ACI), per kind|bucket
  const offs = new Map();  // key -> [widen lo edge, widen hi edge] in log units (quantile tracking), per kind|bucket
  const fitCache = new Map(), dirtyCells = new Set(); // per-cell fit, refit when the cell got outcomes or refitMs passed
  let snap = null, aciChanged = false;

  const push = (key, x) => { let a = cells.get(key); if (!a) cells.set(key, (a = [])); a.push(x); if (a.length > o.maxObs) a.splice(0, a.length - o.maxObs); };

  /** s: sample with actualMs; pred: what predict() returned for it at its made time (for the honest residual and ACI). */
  function observe(s, pred) { observeBatch([[s, pred]]); }

  /** Outcomes that became known together (one resolve() pass). ACI / tracking step once per cell when batchAci. */
  function observeBatch(items) {
    const misses = new Map(); // ak -> [n, early, late]
    for (const [s, pred] of items) {
      if (!s || !fin(s.actualMs) || s.actualMs <= 0) continue;
      const la = Math.log(s.actualMs), lp = logPreds(s.preds, s.v2d);
      // honest residual against the point predicted at the time; before the first fit, against the plain median
      const r0 = pred && fin(pred.d) && pred.d > 0 ? la - Math.log(pred.d) : lp.med != null ? la - lp.med : null;
      const r = r0 == null ? null : r0 / scaleOf(lp, o);
      const pe = {}; // prequential member errors: raw members always, corrected ones as they were offered at predict time
      for (const m of Object.keys(lp)) pe[m] = Math.abs(la - lp[m]);
      if (pred && pred.mem) for (const [k, v] of Object.entries(pred.mem)) if (k.endsWith("~") && fin(v)) pe[k] = Math.abs(la - v);
      const x = { t: s.made, lp, la, r, pe, tk: s.tkey };
      for (const k of cellKeys(s.kind, s.bucket, cycleOf(s.sinceAug), o.useCycle)) { push(k, x); dirtyCells.add(k); }
      if (pred && fin(pred.lo) && fin(pred.hi)) {
        const ak = `${s.kind}|${s.bucket}`, e = s.actualMs < pred.lo ? 1 : 0, l = s.actualMs > pred.hi ? 1 : 0;
        if (o.batchAci) { const m = misses.get(ak) || [0, 0, 0]; misses.set(ak, [m[0] + 1, m[1] + e, m[2] + l]); }
        else step(ak, e, l);
      }
    }
    for (const [ak, [n, e, l]] of misses) step(ak, e / n, l / n);
  }

  function step(ak, early, late) {
    const half = (1 - o.target) / 2;
    if (o.aci && o.gamma > 0) {
      // Gibbs & Candes ACI per edge: alpha_e += gamma * (target_e - miss_e); target_e = (1 - target) / 2
      const a0 = alpha.get(ak) || [half, half], clamp = (x) => Math.min(o.alphaMax / 2, Math.max(o.alphaMin / 2, x));
      alpha.set(ak, [clamp(a0[0] + o.gamma * (half - early)), clamp(a0[1] + o.gamma * (half - late))]);
      aciChanged = true;
    }
    if (o.track > 0) {
      // quantile tracking: each edge moves out by track*(1-half) on a miss past it, in by track*half otherwise
      const d0 = offs.get(ak) || [0, 0];
      offs.set(ak, [d0[0] + o.track * (early - half), d0[1] + o.track * (late - half)]);
      aciChanged = true;
    }
  }

  function snapshot(now) {
    // refit a cell when it got new outcomes or its decay clock moved by refitMs or more; otherwise reuse the last snapshot
    const stale = (k) => dirtyCells.has(k) || !fitCache.has(k) || Math.abs(now - fitCache.get(k).t) >= o.refitMs;
    if (snap && !aciChanged && !dirtyCells.size && Math.abs(now - snap.t) < o.refitMs) return snap;
    aciChanged = false;
    const out = { v: PREDCAL_VERSION, t: now, opts: { target: o.target, shrinkK: o.shrinkK, tau: o.tau, pointMode: o.pointMode, useCycle: o.useCycle, scale: o.scale, sMin: o.sMin }, cells: {} };
    // fit leaf-to-root; quantile levels come from the kind|bucket alpha (or the nominal target)
    const fitted = {};
    for (const [k, obs] of cells) { if (stale(k)) fitCache.set(k, { t: now, f: fitCell(obs, now, o) }); fitted[k] = fitCache.get(k).f; }
    dirtyCells.clear();
    for (const [k, f] of Object.entries(fitted)) {
      const parts = k.split("|"), ak = parts.length >= 2 && parts[1] !== "all" ? `${parts[0]}|${parts[1]}` : null;
      const half = (1 - o.target) / 2, a = ak && alpha.has(ak) ? alpha.get(ak) : [half, half], d = ak && offs.has(ak) ? offs.get(ak) : [0, 0];
      out.cells[k] = { n: f.n, neff: +f.neff.toFixed(2), alpha: [+a[0].toFixed(4), +a[1].toFixed(4)], off: [+d[0].toFixed(4), +d[1].toFixed(4)],
        models: Object.fromEntries(Object.entries(f.models).map(([m, s]) => [m, { n: s.n, bias: +s.bias.toFixed(4) }])),
        members: Object.fromEntries(Object.entries(f.members).map(([m, s]) => [m, { n: s.n, loss: +s.loss.toFixed(4) }])),
        qlo: sortedQuantile(f.rs, f.cw, a[0]), qhi: sortedQuantile(f.rs, f.cw, 1 - a[1]), nr: f.rs.length };
    }
    // hierarchical shrinkage of the band quantiles toward the parent, root first so every parent is already shrunk
    for (const k of Object.keys(out.cells).sort((x, y) => depthOf(x) - depthOf(y))) {
      const c = out.cells[k], par = parentOf(k), pc = par && out.cells[par];
      if (pc && fin(pc.qlo) && fin(pc.qhi)) {
        const lam = c.nr / (c.nr + o.shrinkK);
        c.qlo = fin(c.qlo) ? lam * c.qlo + (1 - lam) * pc.qlo : pc.qlo;
        c.qhi = fin(c.qhi) ? lam * c.qhi + (1 - lam) * pc.qhi : pc.qhi;
      }
    }
    for (const c of Object.values(out.cells)) {
      if (fin(c.qlo) && fin(c.qhi)) { // tracked offsets widen (or narrow) each edge; never past the other edge
        const lo = c.qlo - c.off[0], hi = c.qhi + c.off[1];
        if (lo <= hi) { c.qlo = lo; c.qhi = hi; } else { const mid = (lo + hi) / 2; c.qlo = mid; c.qhi = mid; }
      }
      if (fin(c.qlo)) c.qlo = +c.qlo.toFixed(4);
      if (fin(c.qhi)) c.qhi = +c.qhi.toFixed(4);
    }
    snap = out;
    return out;
  }

  function predict(s, now = s.made) { return applySnapshot(snapshot(now), s); }

  return { observe, observeBatch, snapshot, predict, opts: o, _cells: cells, _alpha: alpha };
}

/**
 * Predict from a snapshot. s: {kind, preds, sinceAug, bucket?}. Returns {d, lo, hi, cell, model, weights} in ms, or null
 * when the snapshot has nothing usable (the caller falls back to v2).
 */
export function applySnapshot(snap, s) {
  if (!snap || !snap.cells || !s || !s.preds) return null;
  const o = { ...DEFAULTS, ...(snap.opts || {}) };
  const lp = logPreds(s.preds, s.v2d); if (!Object.keys(lp).length) return null;
  const bucket = s.bucket || bucketOfPreds(s.preds), keys = cellKeys(s.kind, bucket, cycleOf(s.sinceAug), !!o.useCycle);
  // point: the most specific cell whose fitted models cover an available prediction
  let point = null, model = null, weights = null, pcell = null;
  const mem = memberValues(snap, keys, lp);
  if (o.pointMode !== "median") for (const k of keys) {
    const c = snap.cells[k]; if (!c || !c.members) continue;
    const w = weightsFor(c.members, mem, o); if (!w) continue;
    let acc = 0; for (const [m, x] of Object.entries(w)) acc += x * mem[m];
    point = acc; weights = w; pcell = k; model = Object.keys(w).length === 1 ? Object.keys(w)[0] : "ens";
    break;
  }
  if (point == null) { if (lp.med == null) return null; point = lp.med; model = "median"; pcell = null; }
  // band: the most specific cell with quantiles
  let qlo = null, qhi = null, bcell = null;
  for (const k of keys) { const c = snap.cells[k]; if (c && fin(c.qlo) && fin(c.qhi)) { qlo = c.qlo; qhi = c.qhi; bcell = k; break; } }
  if (qlo == null) return null;
  const sc = scaleOf(lp, o); qlo *= sc; qhi *= sc;
  if (qhi < qlo) [qlo, qhi] = [qhi, qlo];
  const d = Math.exp(point);
  return { d, lo: d * Math.exp(qlo), hi: d * Math.exp(qhi), cell: bcell, pcell, model, weights, bucket, scale: +sc.toFixed(4), mem };
}

/**
 * Replay samples in time order with no look-ahead. Each sample is predicted with only outcomes whose knownAt <= made.
 * The final snapshot is stamped `now` when given (the in-game calibration time, so a quiet log never looks stale),
 * else the last event time in the log.
 */
export function replay(samples, opts = {}, now = null) {
  const cal = createCalibrator(opts);
  const sorted = [...samples].filter((s) => s && fin(s.made)).sort((a, b) => a.made - b.made);
  const pending = sorted.filter((s) => fin(s.actualMs) && fin(s.knownAt)).sort((a, b) => a.knownAt - b.knownAt);
  const preds = new Map(); let j = 0; const out = [];
  for (const s of sorted) {
    // outcomes known by now, fed in resolution batches (same knownAt = same resolve() pass)
    while (j < pending.length && pending[j].knownAt <= s.made) {
      const at = pending[j].knownAt, batch = [];
      while (j < pending.length && pending[j].knownAt === at) { const q = pending[j++]; batch.push([q, preds.get(q.id)]); }
      cal.observeBatch(batch);
    }
    const p = cal.predict(s, s.made); preds.set(s.id, p); out.push({ s, p });
  }
  const end = sorted.length ? Math.max(sorted[sorted.length - 1].made, pending.length ? pending[pending.length - 1].knownAt : 0) : 0;
  while (j < pending.length) { const at = pending[j].knownAt, batch = []; while (j < pending.length && pending[j].knownAt === at) { const q = pending[j++]; batch.push([q, preds.get(q.id)]); } cal.observeBatch(batch); }
  return { scored: out, calibrator: cal, snapshot: cal.snapshot(fin(now) ? Math.max(now, end) : end), end };
}

/** Is a snapshot safe to use? Missing, wrong version, stale or malformed -> {ok:false, reason}. */
export function validateSnapshot(snap, now, maxAgeMs = 6 * 3.6e6) {
  const bad = (code, reason) => ({ ok: false, code, reason });
  if (!snap || typeof snap !== "object") return bad("missing", "missing");
  if (snap.v !== PREDCAL_VERSION) return bad("invalid", `version ${snap.v} != ${PREDCAL_VERSION}`);
  if (!fin(snap.t)) return bad("invalid", "no timestamp");
  if (now - snap.t > maxAgeMs) return bad("stale", `stale (${((now - snap.t) / 3.6e6).toFixed(1)}h old)`);
  if (snap.t - now > 10 * 60000) return bad("invalid", "timestamp in the future");
  if (!snap.cells || typeof snap.cells !== "object" || !Object.keys(snap.cells).length) return bad("invalid", "no cells");
  for (const [k, c] of Object.entries(snap.cells)) {
    if (!c || typeof c !== "object") return bad("invalid", `cell ${k} malformed`);
    if (c.qlo != null && !fin(c.qlo) || c.qhi != null && !fin(c.qhi)) return bad("invalid", `cell ${k} quantiles not finite`);
    for (const [m, x] of Object.entries(c.models || {})) if (!x || !fin(x.bias)) return bad("invalid", `cell ${k} model ${m} malformed`);
    for (const [m, x] of Object.entries(c.members || {})) if (!x || !fin(x.loss)) return bad("invalid", `cell ${k} member ${m} malformed`);
  }
  return { ok: true, code: "ok", reason: "ok" };
}

/**
 * Rolling live coverage per kind|bucket over the last `win` resolved predictions (optionally only one version),
 * plus alerts for cells with >= minN outcomes whose coverage is outside [lo, hi].
 * rows: [{kind, bucket, inBand:boolean, v?}] in resolution order.
 */
export function liveCoverage(rows, { win = 50, minN = 30, lo = 0.7, hi = 0.9, version = null } = {}) {
  const by = {};
  for (const r of rows || []) {
    if (!r || !r.kind || !r.bucket || typeof r.inBand !== "boolean") continue;
    if (version && (r.v || "v2") !== version) continue;
    (by[`${r.kind}|${r.bucket}`] = by[`${r.kind}|${r.bucket}`] || []).push(r.inBand ? 1 : 0);
  }
  const cells = {}, alerts = [];
  for (const [k, xs] of Object.entries(by).sort()) {
    const last = xs.slice(-win), n = last.length, cov = n ? last.reduce((a, b) => a + b, 0) / n : null;
    cells[k] = { n, cov: cov == null ? null : +cov.toFixed(3), total: xs.length };
    if (n >= minN && (cov < lo || cov > hi)) alerts.push({ cell: k, n, cov: +cov.toFixed(3) });
  }
  return { win, minN, lo, hi, version, cells, alerts };
}

/** Everything the page loader needs, as one object (loadPredcal returns this). */
export const PREDCAL = Object.freeze({ PREDCAL_VERSION, BASE_MODELS, BUCKETS, CYCLES, DEFAULTS, bucketOf, bucketOfPreds, cycleOf, median, wquantile,
  cellKeys, depthOf, parentOf, logPreds, dispersion, toSample, samplesFromLog, createCalibrator, applySnapshot, replay, validateSnapshot, liveCoverage });

/**
 * Page-context loader (no module system there): turns this file's source into the PREDCAL object.
 * The file must stay import-free; test/predcal.js checks that the loader works on the real file.
 */
export function loadPredcal(src) { return new Function(String(src).replace(/^export\s+/gm, "") + "\nreturn PREDCAL;")(); }
