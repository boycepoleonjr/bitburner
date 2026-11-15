/**
 * lib/stockspike.js — BN8 stock-market spike: blind forecast estimator, scorer and log analyzer (docs/specs/bn8-spike.md). PURE: no ns,
 * no imports. Used by test/stockspike.js and server/stockspike-report.js; nothing in the game imports it (the logger tools/stock-spike.js is
 * standalone), so no script's RAM changes.
 *
 * Game rules this relies on (bitburner-src v3.0.1, StockMarket.ts processStockPrices): every tick one shared v in (0,1) scales the size of every
 * stock's move, av = v * mv / 100; each stock then goes up (price*(1+av)) with probability forecast f, else down (price/(1+av)). So the SIGN of a
 * move is an independent Bernoulli(f) per stock and counting signs estimates f without any market-wide correction. getVolatility() returns mv/100,
 * i.e. the maximum |ln(p_t/p_{t-1})| is ln(1 + getVolatility()).
 *
 * Log format (data/stock-spike.txt, JSONL):
 *   {"k":"i","t":ms,"s":[symbols],"max":[maxShares],"ask":[ask],"bid":[bid],"has4S":bool}        info (start, and when 4S ownership changes)
 *   {"k":"t","t":ms,"p":[prices],"f":[forecasts],"v":[volatilities]}                            one per tick; f and v only with the 4S TIX API
 */

export const GATES = Object.freeze({
  warmup: 40,          // ticks per stock before it is scored
  within: 0.10,        // G1: |f_hat - f| < within ...
  withinShare: 0.70,   //     for at least this share of scored (stock, tick) pairs
  minEdge: 0.08,       // G2 applies to stocks with |f - 0.5| >= minEdge ...
  sideMargin: 0.01,    //     (f_hat must differ from 0.5 by at least this much to count as a side)
  sideShare: 0.75,     //     and needs f_hat on the correct side of 0.5 in at least this share
  volTol: 0.03,        // G3: the largest observed log move is within this fraction of ln(1 + getVolatility) ...
  volShare: 0.80,      //     for at least this share of stocks ...
  volMinTicks: 2000,   //     that have this many ticks
  replayBlock: 25,     // G5: block length (ticks) for the t-statistic of the replayed strategy
  replayMinBlocks: 40, //     blocks needed before G5 is evaluated (40 x 25 = 1000 ticks)
  replayT: 2,          //     the mean block return of the replayed strategy must be > 0 with t >= this
  replayFailBlocks: 150, //   positive but t < replayT after this many blocks (3750 ticks) counts as a FAIL; before that it is inconclusive
  jumpLog: 0.1,        // a per-tick |ln move| above this cannot be a market move (the maximum is ln(1.04) = 0.039): the market was re-created (install/destroy)
  tickMinMs: 4000,     // G4: median tick interval inside [tickMinMs, tickMaxMs]
  tickMaxMs: 8000,
});
export const ESTIMATOR = Object.freeze({ halfLife: 20, prior: 8 }); // exponential sign window (ticks) and pseudo-counts at 0.5

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
/** True when the move from a to b is too large to be a normal tick: the stock market was re-created (aug install or destroy re-rolls every price). */
const isJump = (a, b, g) => Math.abs(Math.log(b / a)) > g.jumpLog;

/** +1 up, -1 down, 0 unchanged for each consecutive price pair. Non-finite prices give 0. */
export function moveSigns(prices) {
  const out = [];
  for (let i = 1; i < (prices || []).length; i++) {
    const a = num(prices[i - 1]), b = num(prices[i]);
    out.push(a == null || b == null || a <= 0 || b <= 0 ? 0 : b > a ? 1 : b < a ? -1 : 0);
  }
  return out;
}

/**
 * Streaming estimator of the up-probability: exponentially weighted share of up moves, shrunk toward 0.5 by `prior` pseudo-counts.
 * @returns {{push:(sign:number)=>void, value:()=>number, weight:()=>number}}
 */
export function streamEstimator({ halfLife = ESTIMATOR.halfLife, prior = ESTIMATOR.prior } = {}) {
  const lambda = Math.pow(0.5, 1 / Math.max(1, halfLife));
  let up = 0, n = 0;
  return {
    push(sign) { up *= lambda; n *= lambda; if (sign > 0) { up += 1; n += 1; } else if (sign < 0) n += 1; },
    value: () => (up + 0.5 * prior) / (n + prior),
    weight: () => n,
  };
}

/** One-shot estimate from a price history (oldest first). */
export function estimateForecast(prices, opts) {
  const e = streamEstimator(opts);
  for (const s of moveSigns(prices)) e.push(s);
  return { f: e.value(), n: e.weight() };
}

/**
 * Scores the estimator against ground-truth forecasts.
 * @param {Array<{p:number[], f:number[]}>} ticks  oldest first; only ticks with both p and f are scored
 * @param {{spread?:number[]}} [info]  per-stock one-way spread as a fraction (default 0.3%), used for the net edge
 */
export function backtest(ticks, info = {}, opts = {}) {
  const g = { ...GATES, ...opts }, est = { ...ESTIMATOR, ...(opts.estimator || {}) };
  const rows = (ticks || []).filter((t) => Array.isArray(t?.p));
  const m = rows.length ? rows[0].p.length : 0;
  const ests = Array.from({ length: m }, () => streamEstimator(est));
  const pos = new Array(m).fill(0), oraclePos = new Array(m).fill(0), since = new Array(m).fill(0); // since = ticks seen after the last market re-creation
  let pairs = 0, within = 0, absErr = 0, sidePairs = 0, sideOk = 0, estGross = 0, oracleGross = 0, estCost = 0, oracleCost = 0, posTicks = 0;
  const spread = (i) => num(info.spread?.[i]) ?? 0.003;
  for (let t = 1; t < rows.length; t++) {
    const prev = rows[t - 1], cur = rows[t];
    for (let i = 0; i < m; i++) {
      const a = num(prev.p[i]), b = num(cur.p[i]);
      if (a == null || b == null || a <= 0 || b <= 0) continue;
      if (isJump(a, b, g)) { ests[i] = streamEstimator(est); pos[i] = 0; oraclePos[i] = 0; since[i] = 0; continue; } // market re-created: start over
      // realized move of this tick is earned by the position that was held BEFORE seeing it
      const move = b / a - 1;
      since[i]++;
      if (since[i] > g.warmup) { estGross += pos[i] * move; oracleGross += oraclePos[i] * move; posTicks++; }
      ests[i].push(b > a ? 1 : b < a ? -1 : 0);
      const f = num(cur.f?.[i]), fh = ests[i].value();
      if (f != null && since[i] >= g.warmup) {
        pairs++; absErr += Math.abs(fh - f); if (Math.abs(fh - f) < g.within) within++;
        if (Math.abs(f - 0.5) >= g.minEdge) { sidePairs++; if (Math.abs(fh - 0.5) >= g.sideMargin && (fh - 0.5) * (f - 0.5) > 0) sideOk++; }
      }
      // positions for the next tick: long above 0.5 + 0.05, short below 0.5 - 0.05 (estimate); oracle uses the true forecast with the same dead band
      const want = (x) => (x == null ? 0 : x > 0.55 ? 1 : x < 0.45 ? -1 : 0);
      const np = want(fh), op = want(f);
      if (since[i] > g.warmup) { estCost += Math.abs(np - pos[i]) * spread(i); oracleCost += Math.abs(op - oraclePos[i]) * spread(i); }
      pos[i] = np; oraclePos[i] = op;
    }
  }
  const per = (x) => (posTicks ? x / posTicks : 0);
  const withinFrac = pairs ? within / pairs : null, sideFrac = sidePairs ? sideOk / sidePairs : null;
  return {
    stocks: m, ticks: rows.length, pairs, meanAbsErr: pairs ? absErr / pairs : null,
    withinShare: withinFrac, sideShare: sideFrac, sidePairs,
    // fraction of equity per stock-tick, summed over stocks / posTicks (so per stock per tick); cost counts one spread per position change
    grossPerStockTick: { estimator: per(estGross), oracle: per(oracleGross) },
    netPerStockTick: { estimator: per(estGross - estCost), oracle: per(oracleGross - oracleCost) },
    g1: withinFrac == null ? null : withinFrac >= g.withinShare, g2: sideFrac == null ? null : sideFrac >= g.sideShare,
  };
}

/** G5 verdict: null until enough blocks; true when positive and significant; false when not positive, or still not significant after many blocks. */
function g5Verdict(nb, mean, tstat, g) {
  if (nb < g.replayMinBlocks || mean == null) return null;
  if (mean > 0 && tstat >= g.replayT) return true;
  if (mean <= 0 || nb >= g.replayFailBlocks) return false;
  return null; // positive but not yet significant: log more ticks
}

/**
 * Replays the blind strategy on REAL logged prices, no forecasts needed (docs/specs/bn8-spike.md G5): at each tick the estimator
 * decides a position for the next tick (long above 0.55, short below 0.45, else flat), one one-way spread is paid per position change,
 * and the portfolio return is the equal-weight mean over stocks. The t-statistic is taken over non-overlapping blocks of `replayBlock`
 * ticks so the weak serial correlation of tick returns does not inflate it. In-sample by construction (nothing is fitted, the two
 * estimator parameters are fixed), but it is the test that matters: does following the estimate make money after spread.
 * @returns {{ticks:number, blocks:number, meanPerTick:number|null, blockMean:number|null, t:number|null, g5:boolean|null}}
 */
export function replay(ticks, info = {}, opts = {}) {
  const g = { ...GATES, ...opts }, est = { ...ESTIMATOR, ...(opts.estimator || {}) };
  const rows = (ticks || []).filter((r) => Array.isArray(r?.p));
  const m = rows.length ? rows[0].p.length : 0;
  const ests = Array.from({ length: m }, () => streamEstimator(est)), pos = new Array(m).fill(0), since = new Array(m).fill(0);
  const spread = (i) => num(info.spread?.[i]) ?? 0.003;
  const series = [];
  for (let t = 1; t < rows.length; t++) {
    let sum = 0, cnt = 0;
    for (let i = 0; i < m; i++) {
      const a = num(rows[t - 1].p[i]), b = num(rows[t].p[i]);
      if (a == null || b == null || a <= 0 || b <= 0) continue;
      if (isJump(a, b, g)) { ests[i] = streamEstimator(est); pos[i] = 0; since[i] = 0; continue; } // market re-created: start over, no P&L across the jump
      const move = b / a - 1;
      since[i]++;
      ests[i].push(b > a ? 1 : b < a ? -1 : 0);
      const fh = ests[i].value(), np = fh > 0.55 ? 1 : fh < 0.45 ? -1 : 0;
      if (since[i] > g.warmup) { sum += pos[i] * move - Math.abs(np - pos[i]) * spread(i); cnt++; }
      pos[i] = np;
    }
    if (cnt) series.push(sum / m);
  }
  const nb = Math.floor(series.length / g.replayBlock), bm = [];
  for (let k = 0; k < nb; k++) { let s = 0; for (let j = 0; j < g.replayBlock; j++) s += series[k * g.replayBlock + j]; bm.push(s); }
  const mean = bm.length ? bm.reduce((a, x) => a + x, 0) / bm.length : null;
  const sd = bm.length > 1 ? Math.sqrt(bm.reduce((a, x) => a + (x - mean) ** 2, 0) / (bm.length - 1)) : null;
  const tstat = mean != null && sd != null ? (sd > 0 ? mean / (sd / Math.sqrt(bm.length)) : mean > 0 ? Infinity : mean < 0 ? -Infinity : 0) : null;
  return {
    ticks: rows.length, blocks: nb, meanPerTick: series.length ? series.reduce((a, x) => a + x, 0) / series.length : null,
    blockMean: mean, t: tstat, g5: g5Verdict(nb, mean, tstat, g),
  };
}

/** Parses the JSONL log. Never throws: unreadable lines are counted in `skipped`. */
export function parseSpikeLog(text) {
  const infos = [], ticks = [];
  let skipped = 0;
  for (const line of String(text ?? "").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let o; try { o = JSON.parse(s); } catch { skipped++; continue; }
    if (!o || typeof o !== "object") { skipped++; continue; }
    if (o.k === "i" && Array.isArray(o.s)) infos.push(o);
    else if (o.k === "t" && Array.isArray(o.p) && num(o.t) != null) ticks.push(o);
    else skipped++;
  }
  // a tick whose length differs from the first tick's (a symbol list change) cannot be compared: drop it
  const m = ticks.length ? ticks[0].p.length : 0;
  const good = ticks.filter((t) => t.p.length === m && (!t.f || t.f.length === m) && (!t.v || t.v.length === m));
  return { infos, ticks: good, skipped: skipped + (ticks.length - good.length) };
}

const median = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

/**
 * Report + gates for a parsed log (docs/specs/bn8-spike.md §4). A gate is true/false, or null when the log cannot evaluate it.
 */
export function analyze(parsed, opts = {}) {
  const g = { ...GATES, ...opts };
  const { infos, ticks } = parsed;
  const info = infos.length ? infos[infos.length - 1] : {};
  const syms = info.s || [];
  const m = ticks.length ? ticks[0].p.length : 0;
  const rep = { ticks: ticks.length, stocks: m, skipped: parsed.skipped || 0, symbols: syms, hasForecasts: false };

  // G4 tick cadence
  const dts = []; for (let i = 1; i < ticks.length; i++) dts.push(ticks[i].t - ticks[i - 1].t);
  const medDt = median(dts);
  rep.cadence = { medianMs: medDt, g4: medDt == null ? null : medDt >= g.tickMinMs && medDt <= g.tickMaxMs };

  // spreads and max shares from the last info line
  const spreadOf = (i) => { const a = num(info.ask?.[i]), b = num(info.bid?.[i]); return a != null && b != null && a + b > 0 ? (a - b) / (a + b) : null; };
  const spread = Array.from({ length: m }, (_, i) => spreadOf(i));
  rep.spread = { median: median(spread), min: Math.min(...spread.filter((x) => x != null)), max: Math.max(...spread.filter((x) => x != null)) };
  if (!Number.isFinite(rep.spread.min)) rep.spread = { median: null, min: null, max: null };
  rep.maxShares = info.max || [];
  // market re-creations: ticks where at least half of the stocks jump by more than a tick can move (an aug install or a destroy re-rolls every price)
  rep.resets = 0;
  for (let t = 1; t < ticks.length; t++) {
    let j = 0, c = 0;
    for (let i = 0; i < m; i++) { const a = num(ticks[t - 1].p[i]), b = num(ticks[t].p[i]); if (a == null || b == null || a <= 0 || b <= 0) continue; c++; if (isJump(a, b, g)) j++; }
    if (c && j * 2 >= c) rep.resets++;
  }

  // G3 volatility units: largest observed |ln move| vs ln(1 + getVolatility)
  const withV = ticks.filter((t) => Array.isArray(t.v));
  rep.hasForecasts = ticks.some((t) => Array.isArray(t.f));
  let eligible = 0, matched = 0; const volRows = [];
  if (withV.length) {
    const maxLog = new Array(m).fill(0), cnt = new Array(m).fill(0);
    for (let t = 1; t < ticks.length; t++) {
      for (let i = 0; i < m; i++) {
        const a = num(ticks[t - 1].p[i]), b = num(ticks[t].p[i]);
        if (a == null || b == null || a <= 0 || b <= 0) continue;
        if (isJump(a, b, g)) continue; // market re-created (install/destroy): not a market move
        maxLog[i] = Math.max(maxLog[i], Math.abs(Math.log(b / a))); cnt[i]++;
      }
    }
    for (let i = 0; i < m; i++) {
      const vs = withV.map((t) => num(t.v[i])).filter((x) => x != null);
      if (!vs.length || cnt[i] < g.volMinTicks) continue;
      const vol = vs[vs.length - 1], bound = Math.log(1 + vol);
      eligible++;
      const ok = bound > 0 && maxLog[i] <= bound * 1.01 && maxLog[i] >= bound * (1 - g.volTol);
      if (ok) matched++;
      volRows.push({ symbol: syms[i] ?? i, vol, observedMaxLog: maxLog[i], bound, ok });
    }
  }
  rep.vol = { eligible, matched, frac: eligible ? matched / eligible : null, rows: volRows, g3: eligible ? matched / eligible >= g.volShare : null };

  // G1/G2 estimator
  const withF = ticks.filter((t) => Array.isArray(t.f));
  rep.estimator = withF.length > g.warmup + 1 ? backtest(withF, { spread: spread.map((x) => x ?? undefined) }, opts) : null;
  rep.replay = replay(ticks, { spread: spread.map((x) => x ?? undefined) }, opts);
  rep.gates = { G1: rep.estimator?.g1 ?? null, G2: rep.estimator?.g2 ?? null, G3: rep.vol.g3, G4: rep.cadence.g4, G5: rep.replay.g5 };
  const vals = Object.values(rep.gates);
  rep.pass = vals.some((x) => x === false) ? false : vals.every((x) => x === true) ? true : null; // null = not every gate could be evaluated
  return rep;
}

const pct = (x, d = 1) => (x == null ? "n/a" : (x * 100).toFixed(d) + "%");
const gate = (x) => (x === true ? "PASS" : x === false ? "FAIL" : "n/a (not enough data)");

/** Human-readable report. */
export function formatReport(rep) {
  const L = [];
  L.push(`BN8 spike report: ${rep.ticks} ticks, ${rep.stocks} stocks${rep.skipped ? `, ${rep.skipped} unreadable line(s) skipped` : ""}, forecasts in log: ${rep.hasForecasts ? "yes" : "no"}`);
  if (rep.resets) L.push(`market re-created ${rep.resets} time(s) in the log (aug install or destroy): each stock's estimator restarts after it and no move across it is counted`);
  L.push(`G4 tick cadence   ${gate(rep.gates.G4)}  median ${rep.cadence.medianMs == null ? "n/a" : (rep.cadence.medianMs / 1000).toFixed(2) + " s"}`);
  L.push(`G3 volatility     ${gate(rep.gates.G3)}  ${rep.vol.eligible ? `${rep.vol.matched}/${rep.vol.eligible} stocks match ln(1 + volatility) within tolerance` : "no stock has enough ticks with 4S volatility"}`);
  const e = rep.estimator;
  L.push(`G1 estimator      ${gate(rep.gates.G1)}  ${e ? `${pct(e.withinShare)} of ${e.pairs} pairs within 0.10 of the true forecast (mean abs error ${e.meanAbsErr.toFixed(3)})` : "needs ticks with forecasts (4S TIX API)"}`);
  L.push(`G2 direction      ${gate(rep.gates.G2)}  ${e && e.sideShare != null ? `${pct(e.sideShare)} on the correct side of 0.5 over ${e.sidePairs} pairs with |f-0.5| >= 0.08` : "n/a"}`);
  if (e) L.push(`edge per stock per tick (fraction of position): gross estimator ${e.grossPerStockTick.estimator.toExponential(2)}, oracle ${e.grossPerStockTick.oracle.toExponential(2)}; net of spread estimator ${e.netPerStockTick.estimator.toExponential(2)}, oracle ${e.netPerStockTick.oracle.toExponential(2)}`);
  const rp = rep.replay;
  L.push(`G5 strategy replay ${gate(rep.gates.G5)}  ${rp && rp.meanPerTick != null ? `mean ${rp.meanPerTick.toExponential(2)} per tick net of spread on real prices, ${rp.blocks} blocks, t = ${rp.t == null ? "n/a" : rp.t.toFixed(2)} (needs >= ${GATES.replayMinBlocks} blocks and t >= ${GATES.replayT})` : "not enough ticks"}`);
  L.push(`spread (one way)  median ${pct(rep.spread.median, 2)}, range ${pct(rep.spread.min, 2)} to ${pct(rep.spread.max, 2)}`);
  if (rep.maxShares.length) L.push(`max shares        min ${Math.min(...rep.maxShares).toExponential(2)}, max ${Math.max(...rep.maxShares).toExponential(2)}`);
  L.push(`verdict: ${rep.pass === true ? "all gates pass" : rep.pass === false ? "at least one gate FAILS (see bn8-spike.md §4 for the consequence)" : "not every gate could be evaluated yet (log more ticks, or after the 4S TIX API)"}`);
  return L.join("\n");
}
