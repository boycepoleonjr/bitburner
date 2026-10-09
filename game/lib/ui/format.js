/** lib/ui/format.js — display formatting. PURE. Anything non-finite renders as "—". */
export const DASH = "—";
const ok = (n) => typeof n === "number" && Number.isFinite(n);
const SUF = [[1e15, "q"], [1e12, "t"], [1e9, "b"], [1e6, "m"], [1e3, "k"]];

export function fmtNum(n, digits = 2) {
  if (!ok(n)) return DASH;
  const a = Math.abs(n);
  if (a >= 1e18) return n.toExponential(2);
  for (const [v, s] of SUF) if (a >= v) return (n / v).toFixed(digits) + s;
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}
export const fmtMoney = (n) => (ok(n) ? (n < 0 ? "-$" : "$") + fmtNum(Math.abs(n)) : DASH);
export const fmtPct = (f, digits = 1) => (ok(f) ? (f * 100).toFixed(digits) + "%" : DASH);
export function fmtGb(gb) {
  if (!ok(gb)) return DASH;
  const units = [["PB", 2 ** 20], ["TB", 2 ** 10], ["GB", 1]];
  for (const [u, v] of units) if (Math.abs(gb) >= v) return (gb / v).toFixed(gb / v >= 100 ? 0 : 1) + " " + u;
  return gb.toFixed(1) + " GB";
}
export function fmtDur(ms) {
  if (!ok(ms)) return DASH;
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60), remMin = m % 60;
  if (hr < 48) return `${hr}h ${remMin}m`;
  return `${Math.floor(hr / 24)}d ${hr % 24}h`;
}
export const fmtAgo = (t, now = Date.now()) => (ok(t) && t > 0 ? fmtDur(now - t) + " ago" : DASH);
export function fmtTime(t) {
  if (!ok(t) || t <= 0) return DASH;
  const d = new Date(t);
  return d.toISOString().slice(5, 16).replace("T", " ") + "Z";
}
export function fmtValue(v) {
  if (v == null) return DASH;
  if (typeof v === "number") return fmtNum(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "[]";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
export function fmtBytes(b) {
  if (!ok(b)) return DASH;
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}
