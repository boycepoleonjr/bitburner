/**
 * lib/data-sources.js — parsing helpers for in-game data files. PURE (no ns).
 * Shared by the dashboard, agent/telemetry.js and the bb server so every reader parses the same way.
 */

/** Small files read every tick (each well under 64 KB). */
export const HOT_FILES = Object.freeze({
  latest: "data/telemetry-latest.txt",
  ring: "data/telemetry-ring.txt",
  ramStatus: "data/ram-status.txt",
  augPlan: "data/aug-plan.txt",
  autopilot: "data/autopilot-status.txt",
});
/** Large/append-only files: read at most every ui.slowRefreshMs, tails only, only when a view needs them. */
export const SLOW_FILES = Object.freeze({
  pred2: "data/pred2.txt",
  agent: "data/agent-log.txt",
  events: "data/events.txt",
  audit: "data/audit.txt",
  install: "data/install-log.txt",
  settingsLog: "data/settings-log.txt",
});
/** Files offered in the Raw view. data/telemetry.txt (~19 MB) is deliberately absent: the UI never reads it. */
export const RAW_FILES = Object.freeze([
  "data/telemetry-latest.txt", "data/telemetry-ring.txt", "data/ram-status.txt", "data/aug-plan.txt",
  "data/autopilot-status.txt", "data/autopilot-config.txt", "data/settings.txt", "data/settings-log.txt",
  "data/daemon-state.txt", "data/config-overrides.txt", "data/daemon-lite-status.txt", "data/stocks.txt",
  "data/pred2.txt", "data/pred-calib.txt", "data/install-log.txt", "data/audit.txt", "data/events.txt", "data/agent-log.txt",
]);
/** Files at or above this size are only ever shown as a tail. */
export const BIG_FILE_BYTES = 64 * 1024;

/** Refresh interval from settings, never below 250 ms. */
export function clampMs(v, fallback = 1000) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.max(250, n);
}

/** Last n lines of text without splitting the whole string (walks back with lastIndexOf). */
export function tailLines(text, n) {
  if (typeof text !== "string" || !text || n <= 0) return [];
  let end = text.length;
  while (end > 0 && (text[end - 1] === "\n" || text[end - 1] === "\r")) end--;
  const out = [];
  let i = end;
  while (out.length < n && i > 0) {
    const j = text.lastIndexOf("\n", i - 1);
    const line = text.slice(j + 1, i).replace(/\r$/, "");
    if (line) out.push(line);
    i = j < 0 ? 0 : j;
  }
  return out.reverse();
}

export function parseJson(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** JSONL -> {rows, bad}: bad lines are skipped and counted, never thrown. */
export function parseJsonl(lines) {
  const arr = Array.isArray(lines) ? lines : typeof lines === "string" ? lines.split("\n") : [];
  const rows = [];
  let bad = 0;
  for (const l of arr) {
    if (!l || !l.trim()) continue;
    try { rows.push(JSON.parse(l)); } catch { bad++; }
  }
  return { rows, bad };
}

/** Plain-text log line ("[iso] msg" or "hh:mm:ss [tag] msg" or JSON) -> record. */
export function parseLogLine(line, i) {
  const s = String(line);
  if (s.startsWith("{")) { try { const j = JSON.parse(s); return { id: i, t: Number(j.t) || Date.parse(j.iso) || null, text: j.kind ? `${j.kind}: ${JSON.stringify(j)}` : s, raw: j }; } catch { /* fall through */ } }
  const iso = s.match(/^\[(\d{4}-\d\d-\d\dT[^\]]+)\]\s*(.*)$/); // match, not RegExp#exec: "exec" is charged by the RAM analyzer
  if (iso) return { id: i, t: Date.parse(iso[1]) || null, text: iso[2], raw: s };
  return { id: i, t: null, text: s, raw: s };
}

/**
 * Memoize a parse by file content. Same text -> same object reference, so the store sees "unchanged" and
 * React.memo'd panels skip rendering.
 */
export function createMemo() {
  const cache = new Map();
  return function memoParse(key, text, fn) {
    const c = cache.get(key);
    if (c && c.text === text) return c.value;
    const value = fn(text);
    cache.set(key, { text, value });
    return value;
  };
}

/** Value at a dotted path ("util.ema5"), for KPI provenance. */
export function at(obj, path) {
  let o = obj;
  for (const k of String(path).split(".")) { if (o == null) return undefined; o = o[k]; }
  return o;
}
