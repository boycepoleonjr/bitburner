/**
 * lib/telemetry-ring.js — bounded recent-history buffer for the dashboard. PURE.
 * agent/telemetry.js keeps the ring in memory and writes it whole (mode "w") to data/telemetry-ring.txt each sample,
 * plus the full latest record to data/telemetry-latest.txt. data/telemetry.txt is unchanged (append-only, predictor).
 */

/** Compact copy of a telemetry record: only what charts and KPIs need (~350 bytes vs ~1.5 KB). */
export function compactRec(r) {
  if (!r || typeof r !== "object") return null;
  return {
    t: r.t, bn: r.bn, sinceAug: r.sinceAug, money: r.money, income: r.income,
    lvl: r.lvl ? { hacking: r.lvl.hacking } : undefined,
    xp: r.exp ? r.exp.hacking : undefined,
    rep: r.rep, work: r.work, workers: r.workers, homeRam: r.homeRam,
    net: r.net ? { max: r.net.max, used: r.net.used } : undefined,
  };
}

/** Max lines kept for a history window at a sample interval (plus a little slack). */
export function ringMaxLines(historyMinutes, intervalSec = 60) {
  const m = Number.isFinite(historyMinutes) && historyMinutes > 0 ? historyMinutes : 360;
  const s = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 60;
  return Math.max(2, Math.ceil((m * 60) / s) + 2);
}

/**
 * Append an entry, then trim by age and by count. Keeps time order; never mutates the input.
 * @param {Array<{t:number}>} ring
 * @param {{t:number}|null} entry
 * @param {{maxLines:number, maxAgeMs:number, now:number}} opt
 */
export function pushRing(ring, entry, { maxLines = 362, maxAgeMs = Infinity, now = Date.now() } = {}) {
  const out = (Array.isArray(ring) ? ring : []).filter((r) => r && Number.isFinite(r.t));
  if (entry && Number.isFinite(entry.t)) {
    out.push(entry);
    if (out.length > 1 && out[out.length - 2].t > entry.t) out.sort((a, b) => a.t - b.t);
  }
  const cutoff = now - maxAgeMs;
  let start = 0;
  while (start < out.length && out[start].t < cutoff) start++;
  const kept = out.slice(start);
  return kept.length > maxLines ? kept.slice(kept.length - maxLines) : kept;
}

export const serializeRing = (ring) => ring.map((r) => JSON.stringify(r)).join("\n") + (ring.length ? "\n" : "");
