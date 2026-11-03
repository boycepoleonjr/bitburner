/**
 * lib/ramwatch.js — detector for "hack level is the bottleneck but all spare RAM sits on share". PURE: no ns, no imports.
 * Used by agent/autopilot.js, which pushes the flag into its `flags` (check-in attention via autopilot-status.txt).
 * RAM: autopilot must not import lib/ramplan.js (its identifiers would add Netscript RAM there), so this module has no
 * RAM-costing identifiers at all; test/ram-xp-static.js enforces that. Spec: docs/specs/ram-xp-priority.md section 4.
 */
export const STARVE_MIN_MS = 60 * 60_000;   // condition must hold this long before the flag
export const STARVE_SHARE_FRAC = 0.9;       // alloc share above this fraction of usable RAM
export const STATUS_MAX_AGE_MS = 10 * 60_000; // ram-status older than this = unknown (resets the clock)

const K_SHARE = "share"; // bracket access on a string: the property name would otherwise count as a RAM-costing identifier

/** Does one ram-status record show the starved state right now? */
export function xpStarved(st, now) {
  if (!st || typeof st !== "object" || st.enabled !== true || st.hackNeed !== true) return false;
  if (!Number.isFinite(st.t) || now - st.t > STATUS_MAX_AGE_MS) return false;
  const usable = Number(st.usableGb), al = st.alloc || {};
  const xpGb = Number(al.xp), shGb = Number(al[K_SHARE]);
  if (!(usable > 0) || !Number.isFinite(xpGb) || !Number.isFinite(shGb)) return false;
  return xpGb === 0 && shGb > STARVE_SHARE_FRAC * usable;
}

/**
 * One autopilot loop. The flag text is constant while the state holds (autopilot audits every change of its flags). `sinceMs` is the value returned by the previous call (0 = not starved).
 * @param {{sinceMs:number, statusRaw:string, now:number}} a
 * @returns {{since:number, flag:string|null}}
 */
export function xpStarveCheck({ sinceMs = 0, statusRaw = "", now = Date.now() } = {}) {
  let st = null;
  try { st = JSON.parse(statusRaw || "null"); } catch { st = null; }
  if (!xpStarved(st, now)) return { since: 0, flag: null };
  const since = sinceMs > 0 && sinceMs <= now ? sinceMs : now;
  if (now - since < STARVE_MIN_MS) return { since, flag: null };
  return { since, flag: `RAM stuck on share: hack level is the bottleneck but xp=0 and share>90% of RAM for over 60 min (check data/ram-status.txt reasons and aug-plan; expected only while a step needs faction rep)` };
}
