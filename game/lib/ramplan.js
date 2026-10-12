/**
 * lib/ramplan.js — RAM manager decisions. PURE: no ns, no imports. Used by daemon.js and Node tests.
 *
 * Buckets:  money = HWGW hacking waves (daemon planner)  |  share = workers/share-loop.js (faction-work rep)
 *           xp    = workers/xp-loop.js (hacking exp)     |  idle  = only when ram.xp.mode = "off" and nothing else wants it
 * Spec: docs/specs/ram-manager.md
 */

export const SHARE_SCRIPT = "workers/share-loop.js";
export const XP_SCRIPT = "workers/xp-loop.js";
export const STATUS_FILE = "data/ram-status.txt";
export const EMA_WINDOW_MS = 5 * 60_000;
export const WORK_MAX_AGE_MS = 120_000;

const fin = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Split usable RAM between money, share and xp.
 *  1. share = weight × usable, only while faction work is active (share only boosts work rep) and share is enabled
 *  2. money = min(usable − share, demand)   (demand = what the chosen hack targets can absorb)
 *  3. surplus = the rest → xp if xp.mode=always or hacking level is the binding constraint;
 *                         else share if rep work is active; else xp (idle RAM earns nothing); xp.mode=off → idle
 * Invariant: money + share + xp + idle = usable, every value finite and >= 0.
 * @returns {{moneyGb:number, shareGb:number, xpGb:number, idleGb:number, reasons:string[]}}
 */
export function allocate({ usableGb, weight, repActive, hackNeed, demandGb, xpMode = "auto", shareEnabled = true } = {}) {
  const reasons = [];
  const clean = (name, v) => { const c = fin(v); if (c !== v && !(v === 0)) reasons.push(`${name} invalid (${v}); using ${c}`); return c; };
  const usable = clean("usableGb", usableGb);
  const demand = clean("demandGb", demandGb);
  let w = typeof weight === "number" && Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0;
  if (w !== weight) reasons.push(`weight ${weight} clamped to ${w}`);

  let share = 0;
  if (!shareEnabled) reasons.push("share disabled");
  else if (!repActive) reasons.push("no faction work active: share 0");
  else { share = w * usable; reasons.push(`share = ${(w * 100).toFixed(0)}% of usable (faction work active)`); }

  const money = Math.min(usable - share, demand);
  reasons.push(money < usable - share ? "money capped by target demand" : "money limited by RAM");
  let surplus = Math.max(0, usable - share - money);
  let xp = 0, idle = 0;
  if (surplus > 0) {
    if (xpMode === "always") { xp = surplus; reasons.push("surplus -> xp (xp.mode=always)"); }
    else if (xpMode !== "off" && hackNeed) { xp = surplus; reasons.push("surplus -> xp (hacking level is the constraint)"); }
    else if (repActive && shareEnabled) { share += surplus; reasons.push("surplus -> share (faction work active)"); }
    else if (xpMode !== "off") { xp = surplus; reasons.push("surplus -> xp (nothing else wants it)"); }
    else { idle = surplus; reasons.push("surplus idle (xp.mode=off, no rep work)"); }
  }
  return { moneyGb: money, shareGb: share, xpGb: xp, idleGb: idle, reasons };
}

/**
 * Add hack targets beyond the floor set while their full wave demand fits the money budget.
 * @param {{host:string, demandGb:number}[]} candidates  ranked best first, floor set excluded
 * @param {number} budgetGb  money budget left after the floor set
 * @param {number} slotsLeft  remaining targets allowed (Infinity = unlimited)
 * @returns {{hosts:string[], demandGb:number}}
 */
export function chooseExtraTargets(candidates, budgetGb, slotsLeft = Infinity) {
  const hosts = [];
  let left = fin(budgetGb), demand = 0;
  for (const c of candidates) {
    if (hosts.length >= slotsLeft) break;
    const d = fin(c.demandGb);
    if (d <= 0 || d > left) continue; // a smaller, lower-ranked target may still fit
    hosts.push(c.host); left -= d; demand += d;
  }
  return { hosts, demandGb: demand };
}

/**
 * Resize decision for one persistent worker kind, with hysteresis.
 * @param {{targetGb:number, procs:{pid:number, ramGb:number}[], threshold:number, unitGb:number}} p
 * @returns {{kill:number[], spawnGb:number, reason:string}}
 */
export function resizePlan({ targetGb, procs = [], threshold = 0.1, unitGb = 1 }) {
  const target = fin(targetGb);
  const running = procs.reduce((a, p) => a + fin(p.ramGb), 0);
  if (target < unitGb && running === 0) return { kill: [], spawnGb: 0, reason: "nothing to run" };
  const band = threshold * Math.max(target, running);
  if (target >= unitGb && Math.abs(target - running) <= band) return { kill: [], spawnGb: 0, reason: "within hysteresis" };
  const kill = [];
  let left = running;
  if (running > target) {
    for (const p of [...procs].sort((a, b) => b.ramGb - a.ramGb)) { if (left <= target) break; kill.push(p.pid); left -= fin(p.ramGb); }
  }
  const spawn = target - left;
  return { kill, spawnGb: spawn >= unitGb ? spawn : 0, reason: running > target ? "shrink" : "grow" };
}

/** Time-weighted EMA over EMA_WINDOW_MS. */
export function ema(prev, value, dtMs, windowMs = EMA_WINDOW_MS) {
  if (!Number.isFinite(prev) || prev < 0) return value;
  if (!(dtMs > 0)) return prev;
  const a = 1 - Math.exp(-dtMs / windowMs);
  return prev + a * (value - prev);
}

/**
 * Is the player doing faction work right now? Read from files other scripts already write (no Singularity in daemon).
 * autopilot-status.txt {t, work:"FACTION:<name>"} wins; else the last telemetry line {t, work:{type}}; stale => false.
 */
export function repActiveFrom({ autopilotRaw, telemetryLine, now = Date.now(), maxAgeMs = WORK_MAX_AGE_MS }) {
  const ap = safe(autopilotRaw);
  if (ap && Number.isFinite(ap.t) && now - ap.t <= maxAgeMs && typeof ap.work === "string")
    return { active: ap.work.startsWith("FACTION:"), source: "autopilot-status" };
  const tl = safe(telemetryLine);
  if (tl && Number.isFinite(tl.t) && now - tl.t <= maxAgeMs && tl.work)
    return { active: tl.work.type === "FACTION", source: "telemetry" };
  return { active: false, source: "stale" };
}

/** Hacking level is the binding constraint: below a Daedalus / w0r1d_d43m0n requirement, or a rooted money server is out of reach. */
export function hackNeedFrom({ hack, hackReq = 0, worldReq = 0, servers = [] }) {
  if (hack < hackReq) return { need: true, why: `hack ${hack} < Daedalus ${hackReq}` };
  if (worldReq > 0 && hack < worldReq) return { need: true, why: `hack ${hack} < w0r1d_d43m0n ${worldReq}` };
  const out = servers.filter((s) => s.rooted && !s.owned && s.maxMoney > 0 && s.reqHack > hack).sort((a, b) => b.maxMoney - a.maxMoney)[0];
  if (out) return { need: true, why: `${out.host} needs hack ${out.reqHack}` };
  return { need: false, why: "every money server is hackable" };
}

/** Daedalus requirements: a cached file (written by a script that can afford getBitNodeMultipliers) or the fallback. */
export function daedalusReqs(cachedRaw, fallback = { augs: 30, money: 100e9, hack: 2500 }) {
  const c = safe(cachedRaw);
  const pick = (k) => (c && Number.isFinite(c[k]) && c[k] >= 0 ? c[k] : fallback[k]);
  return { augs: pick("augs"), money: pick("money"), hack: pick("hack"), source: c ? "cache" : "fallback" };
}

/** Largest power of two <= x (>= 2), or 0. */
export function pow2Floor(x) {
  if (!(x >= 2)) return 0;
  return 2 ** Math.floor(Math.log2(x));
}

/** data/ram-status.txt record. The dashboard depends on this exact shape. */
export function buildStatus(o) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return {
    t: n(o.t), enabled: !!o.enabled, phase: o.phase ?? "early", progress: n(o.progress), weight: n(o.weight),
    repActive: !!o.repActive, hackNeed: !!o.hackNeed, usableGb: n(o.usableGb),
    alloc: { money: n(o.alloc?.money), share: n(o.alloc?.share), xp: n(o.alloc?.xp) },
    running: { money: n(o.running?.money), share: n(o.running?.share), xp: n(o.running?.xp) },
    util: { instant: n(o.util?.instant), ema5: n(o.util?.ema5) },
    activeTargets: (o.activeTargets || []).map((t) => ({ host: String(t.host), kind: String(t.kind ?? ""), batches: n(t.batches), ramGb: n(t.ramGb) })),
    cloud: { count: n(o.cloud?.count), limit: n(o.cloud?.limit), minGb: n(o.cloud?.minGb), maxGb: n(o.cloud?.maxGb), spentThisLoop: n(o.cloud?.spentThisLoop) },
    sharePower: n(o.sharePower), reasons: (o.reasons || []).map(String),
  };
}

function safe(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}
