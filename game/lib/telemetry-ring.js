/**
 * lib/telemetry-ring.js — bounded recent-history buffer for the dashboard. PURE.
 * agent/telemetry.js keeps the ring in memory and writes it whole (mode "w") to data/telemetry-ring.txt each sample,
 * plus the full latest record to data/telemetry-latest.txt. data/telemetry.txt is append-only except for trimTelemetry
 * (retention: ui.telemetryRetentionDays, default 7), which agent/telemetry.js runs at start and once a day.
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

export const DAY_MS = 86400000;
/** Records older than this many ms behind the newest one are never trimmed when the file looks stale (clock or restore). */
const STALE_FILE_MS = DAY_MS;

/**
 * Retention for data/telemetry.txt (JSONL, one record per line, each starting {"t":<ms>). PURE.
 * Drops lines whose t is older than now - maxAgeMs. Safe by default: returns the text unchanged when maxAgeMs is not a
 * positive finite number (0 = keep everything), when the newest record is more than a day older than `now` (stale file or
 * wrong clock: nothing is trimmed), or when it would leave fewer than minLines (the last minLines lines are kept instead).
 * Lines without a readable t are kept. Never throws.
 * @returns {{text:string, dropped:number, kept:number}}
 */
export function trimTelemetry(text, { now = Date.now(), maxAgeMs = 0, minLines = 2000 } = {}) {
  const raw = typeof text === "string" ? text : "";
  const lines = raw.split("\n");
  const trailing = lines.length && lines[lines.length - 1] === "";
  if (trailing) lines.pop();
  const same = { text: raw, dropped: 0, kept: lines.length };
  if (!(Number.isFinite(maxAgeMs) && maxAgeMs > 0) || !Number.isFinite(now) || lines.length <= minLines) return same;
  const tOf = (l) => {
    const m = /^\{"t":(\d{10,})/.exec(l);
    if (m) return Number(m[1]);
    try { const t = JSON.parse(l)?.t; return Number.isFinite(t) ? t : null; } catch { return null; }
  };
  let newest = -Infinity;
  for (let i = lines.length - 1; i >= 0 && newest === -Infinity; i--) { const t = tOf(lines[i]); if (t != null) newest = t; }
  if (newest === -Infinity || now - newest > STALE_FILE_MS) return same;
  const cutoff = now - maxAgeMs;
  let kept = lines.filter((l) => { const t = tOf(l); return t == null || t >= cutoff; });
  if (kept.length < minLines) kept = lines.slice(lines.length - minLines);
  if (kept.length === lines.length) return same;
  return { text: kept.join("\n") + (trailing ? "\n" : ""), dropped: lines.length - kept.length, kept: kept.length };
}
