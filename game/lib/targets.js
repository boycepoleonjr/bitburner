/**
 * lib/targets.js — explainable target scoring, prep status, and switch decisions.
 *
 * steadyScore  = what the server is worth once prepped (≈ $/sec-shaped):
 *                maxMoney^wMoney × chanceAtMin^wChance × growthNorm^wGrowth × levelFactor
 *                ÷ (weakenTimeAtMin in seconds)^wTime
 * readiness    = 0.5 × money/maxMoney + 0.5 × minSec/sec          (1.0 = fully prepped)
 * score        = steadyScore × (1 − readinessWeight × (1 − readiness))
 *
 * The incumbent is judged on steadyScore (so prepping it never makes it look worse);
 * challengers are judged on score (so an unprepped server has to be clearly better).
 *
 * With Formulas.exe, chanceAtMin and weakenTimeAtMin are exact (formulas on a hypothetical
 * min-security server); without it they are scaled from current values. "[F]" marks exact rows.
 */

import { formulasCtx, hypo } from "lib/formulas.js";

/**
 * @typedef {Object} Candidate
 * @property {string} host
 * @property {number} score
 * @property {number} steadyScore
 * @property {number} readiness
 * @property {"prep-sec"|"prep-money"|"ready"} status
 * @property {number} chanceNow
 * @property {number} chanceMin
 * @property {number} weakenNow
 * @property {number} weakenMin
 * @property {number} growthNorm
 * @property {number} levelFactor
 * @property {number} maxMoney
 * @property {number} moneyRatio
 * @property {number} secOver
 * @property {number} reqHack
 * @property {string} why        one-line breakdown
 */

/**
 * @param {import("lib/network.js").ServerInfo} s
 * @param {import("lib/config.js").Config} cfg
 * @returns {"prep-sec"|"prep-money"|"ready"}
 */
export function prepStatus(s, cfg) {
  if (s.sec > s.minSec + cfg.prep.secTolerance) return "prep-sec";
  if (s.money < s.maxMoney * cfg.prep.moneyThreshold) return "prep-money";
  return "ready";
}

/**
 * Hack/weaken time scale linearly with (2.5·req·sec + 500), so time at min security
 * can be estimated from the current time without Formulas.exe.
 */
function timeAtMin(s, timeNow) {
  const now = 2.5 * s.reqHack * s.sec + 500;
  const min = 2.5 * s.reqHack * s.minSec + 500;
  return now > 0 ? timeNow * (min / now) : timeNow;
}

/** Hack chance scales with (100 − sec). */
function chanceAtMin(s, chanceNow) {
  if (s.sec >= 100) return chanceNow;
  return Math.min(1, chanceNow * ((100 - s.minSec) / (100 - s.sec)));
}

/**
 * @param {NS} ns
 * @param {import("lib/network.js").ServerInfo} s
 * @param {number} hackLevel
 * @param {import("lib/config.js").Config} cfg
 * @param {{player: Player}|null} fx  formulas context (null = estimate)
 * @returns {Candidate}
 */
export function scoreServer(ns, s, hackLevel, cfg, fx = null) {
  const w = cfg.score;
  const chanceNow = ns.hackAnalyzeChance(s.host);
  const weakenNow = ns.getWeakenTime(s.host);
  let chanceMin, weakenMin;
  if (fx) {
    const ideal = hypo(s.raw, { sec: s.minSec, money: s.maxMoney });
    chanceMin = ns.formulas.hacking.hackChance(ideal, fx.player);
    weakenMin = ns.formulas.hacking.weakenTime(ideal, fx.player);
  } else {
    chanceMin = chanceAtMin(s, chanceNow);
    weakenMin = timeAtMin(s, weakenNow);
  }
  const growthNorm = Math.max(0.01, Math.min(s.growth, w.growthCap) / w.growthCap);
  const ratio = s.reqHack / Math.max(1, hackLevel);
  const levelFactor = ratio <= w.levelSoftCap ? 1 : Math.pow(w.levelSoftCap / ratio, w.levelPenalty);

  const steadyScore =
    (Math.pow(s.maxMoney, w.wMoney) * Math.pow(chanceMin, w.wChance) * Math.pow(growthNorm, w.wGrowth) * levelFactor) /
    Math.pow(Math.max(1, weakenMin / 1000), w.wTime);

  const moneyRatio = s.maxMoney > 0 ? s.money / s.maxMoney : 0;
  const secRatio = s.sec > 0 ? Math.min(1, s.minSec / s.sec) : 1;
  const readiness = 0.5 * moneyRatio + 0.5 * secRatio;
  const score = steadyScore * (1 - w.readinessWeight * (1 - readiness));
  const status = prepStatus(s, cfg);

  const why = (fx ? "[F] " : "") +
    `max=${ns.format.number(s.maxMoney, 1)} chance@min=${(chanceMin * 100).toFixed(0)}% ` +
    `wTime@min=${(weakenMin / 1000).toFixed(0)}s grow=${s.growth} lvl×${levelFactor.toFixed(2)} ` +
    `ready=${(readiness * 100).toFixed(0)}%`;

  return {
    host: s.host, score, steadyScore, readiness, status, chanceNow, chanceMin, weakenNow, weakenMin,
    growthNorm, levelFactor, maxMoney: s.maxMoney, moneyRatio, secOver: s.sec - s.minSec, reqHack: s.reqHack, why,
  };
}

/**
 * Score every "target" server and sort best first.
 * @param {NS} ns
 * @param {import("lib/network.js").ServerInfo[]} targets
 * @returns {Candidate[]}
 */
export function rankTargets(ns, targets, hackLevel, cfg) {
  const fx = formulasCtx(ns, cfg);
  return targets
    .map((s) => scoreServer(ns, s, hackLevel, cfg, fx))
    .filter((c) => c.chanceMin >= cfg.score.minChance && c.steadyScore > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * @typedef {Object} Decision
 * @property {"init"|"keep"|"switch"} action
 * @property {string|null} target
 * @property {string} reason
 * @property {boolean} emergency
 * @property {{host: string, count: number}|null} challenger  updated challenger tracking
 */

/**
 * Switch policy: hysteresis + min delta + cooldown + emergency override.
 * @param {Candidate[]} ranking
 * @param {{primary: string|null, lastSwitchAt: number, challenger: {host: string, count: number}|null}} st
 * @param {import("lib/config.js").Config} cfg
 * @returns {Decision}
 */
export function decide(ranking, st, now, cfg) {
  const sw = cfg.switching;
  const best = ranking[0];
  if (!best) return { action: "keep", target: st.primary, reason: "no viable candidates", emergency: false, challenger: null };

  const cur = ranking.find((c) => c.host === st.primary);
  if (!st.primary) {
    return { action: "init", target: best.host, reason: `initial selection: ${best.host} (${best.why})`, emergency: false, challenger: null };
  }
  if (!cur) {
    return { action: "switch", target: best.host, reason: `EMERGENCY: ${st.primary} no longer a valid target → ${best.host}`, emergency: true, challenger: null };
  }
  if (best.host === st.primary) {
    return { action: "keep", target: st.primary, reason: "incumbent is #1", emergency: false, challenger: null };
  }

  const ratio = best.score / Math.max(1e-9, cur.steadyScore);
  const gain = `${best.host} +${(ratio * 100 - 100).toFixed(0)}% vs ${cur.host}`;

  if (ratio >= sw.emergencyRatio) {
    return { action: "switch", target: best.host, reason: `EMERGENCY: ${gain} (≥ ${sw.emergencyRatio}×, cooldown/confirm skipped)`, emergency: true, challenger: null };
  }
  if (ratio < 1 + sw.minImprovement) {
    return { action: "keep", target: st.primary, reason: `challenger ${gain} below +${sw.minImprovement * 100}% threshold`, emergency: false, challenger: null };
  }

  const count = st.challenger && st.challenger.host === best.host ? st.challenger.count + 1 : 1;
  const challenger = { host: best.host, count };
  const cooldownLeft = sw.cooldownMs - (now - (st.lastSwitchAt || 0));
  if (count < sw.confirmLoops) {
    return { action: "keep", target: st.primary, reason: `challenger ${gain}, confirming ${count}/${sw.confirmLoops}`, emergency: false, challenger };
  }
  if (cooldownLeft > 0) {
    return { action: "keep", target: st.primary, reason: `challenger ${gain} confirmed, cooldown ${Math.ceil(cooldownLeft / 1000)}s left`, emergency: false, challenger };
  }
  return { action: "switch", target: best.host, reason: `better target: ${gain} (confirmed ${count} loops, ${best.why})`, emergency: false, challenger: null };
}

/**
 * Pick secondary targets (leftover RAM) with stickiness so they don't churn.
 * @param {Candidate[]} ranking
 * @param {string|null} primary
 * @param {string[]} previous
 * @param {import("lib/config.js").Config} cfg
 */
export function pickSecondaries(ranking, primary, previous, cfg) {
  const slots = cfg.secondary.slots;
  if (slots <= 0) return [];
  const inWindow = ranking.slice(0, slots + 1 + cfg.secondary.stickiness).map((c) => c.host);
  // slot 1 always goes to the best challenger so it gets prepped ahead of a possible switch
  const challenger = ranking.find((c) => c.host !== primary)?.host;
  const keep = challenger ? [challenger] : [];
  for (const h of previous) if (h !== primary && inWindow.includes(h) && !keep.includes(h)) keep.push(h);
  for (const c of ranking) {
    if (keep.length >= slots) break;
    if (c.host !== primary && !keep.includes(c.host)) keep.push(c.host);
  }
  return keep.slice(0, slots);
}
