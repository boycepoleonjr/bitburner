/**
 * lib/progress.js — BitNode progress, phase and strategy weight. PURE (no ns, no imports): used by the daemon's RAM
 * manager, the autopilot's aug planner and the dashboard, and by Node tests.
 *
 * Progress mirrors fl1ght.exe: the Daedalus invite needs N installed augs, money and hacking level. progress is the mean
 * of min(1, have/need) over the three. Requirements are passed in (they vary by BitNode), never hardcoded here.
 */

/**
 * @param {{augsInstalled:number, augsReq:number, money:number, moneyReq:number, hack:number, hackReq:number}} p
 * @returns {{progress:number, parts:{augs:number, money:number, hack:number}, met:boolean}}
 */
export function flightProgress(p = {}) {
  const part = (have, need) => {
    const h = Number(have), n = Number(need);
    if (!Number.isFinite(n) || n <= 0) return 1; // no requirement = satisfied
    if (!Number.isFinite(h) || h <= 0) return 0;
    return Math.min(1, h / n);
  };
  const parts = { augs: part(p.augsInstalled, p.augsReq), money: part(p.money, p.moneyReq), hack: part(p.hack, p.hackReq) };
  const progress = (parts.augs + parts.money + parts.hack) / 3;
  return { progress, parts, met: parts.augs >= 1 && parts.money >= 1 && parts.hack >= 1 };
}

/**
 * @param {number} progress  0..1
 * @param {boolean} hasRedPill  The Red Pill owned (installed or queued) forces late phase
 * @param {Object} s  settings (flat keys from lib/settings.js)
 * @returns {"early"|"mid"|"late"}
 */
export function phaseOf(progress, hasRedPill, s) {
  const mid = num(s?.["strategy.phase.midAt"], 0.34), late = num(s?.["strategy.phase.lateAt"], 0.9);
  const p = Number.isFinite(progress) ? progress : 0;
  if (hasRedPill || p >= late) return "late";
  if (p >= mid) return "mid";
  return "early";
}

/** Strategy weight for a phase: 0 = all money, 1 = all faction rep. */
export function weightFor(phase, s) {
  const d = { early: 0, mid: 0.5, late: 1 };
  const w = num(s?.[`strategy.${phase}`], d[phase] ?? 0);
  return Math.min(1, Math.max(0, w));
}

/** Everything a consumer usually wants in one call. */
export function strategyNow(inputs, hasRedPill, s) {
  const fp = flightProgress(inputs);
  const phase = phaseOf(fp.progress, hasRedPill, s);
  return { ...fp, phase, weight: weightFor(phase, s) };
}

function num(v, d) { return typeof v === "number" && Number.isFinite(v) ? v : d; }
