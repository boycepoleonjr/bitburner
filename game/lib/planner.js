/**
 * lib/planner.js — turns a target's live state into one "wave" of timed jobs.
 *
 * prep wave (WGW):  W1 removes excess security, G refills money, W2 cancels G's security.
 * farm wave (HWGW): H steals hackFraction, W1 cancels H, G refills, W2 cancels G.
 * Landings are ordered with additionalMsec so every job lands `stepMs` after the previous one
 * and all of them finish right after the weaken time — the target ends each wave prepped.
 *
 * Batching: a farm wave contains up to farm.maxBatches HWGW batches, all launched together from
 * the same prepped state and offset by batchSpacingMs, so batch k lands entirely after batch k−1.
 * The target is busy until the last batch lands, then the next wave is planned.
 * Note: growthAnalyzeSecurity is called WITHOUT a hostname on purpose — with one, v3 caps the
 * result by the server's current money, which returns 0 when planning a farm wave at max money.
 *
 * With Formulas.exe, hack% and grow threads are computed exactly for the state each job will
 * actually see (grow always lands after a weaken, i.e. at min security).
 */
import { formulasCtx, hypo } from "lib/formulas.js";

/**
 * @typedef {{op: "hack"|"grow"|"weaken", threads: number, delay: number}} Job
 * @typedef {{target: string, kind: "prep-sec"|"prep-money"|"farm", jobs: Job[], ramGb: number,
 *            durationMs: number, note: string, hackFraction: number}} WavePlan
 */

/**
 * @param {NS} ns
 * @param {import("lib/network.js").ServerInfo} s  fresh snapshot
 * @param {import("lib/config.js").Config} cfg
 * @param {number} budgetGb  fragment-aware usable RAM
 * @param {{hack: number, grow: number, weaken: number}} ram  GB per thread
 * @param {number} hackFraction  desired steal fraction per batch
 * @param {number} maxBatches  cap on HWGW batches in a farm wave
 * @returns {WavePlan|null}
 */
export function planWave(ns, s, cfg, budgetGb, ram, hackFraction = cfg.farm.hackFraction, maxBatches = cfg.farm.maxBatches) {
  const status = s.sec > s.minSec + cfg.prep.secTolerance ? "prep-sec"
    : s.money < s.maxMoney * cfg.prep.moneyThreshold ? "prep-money" : "farm";
  if (budgetGb < Math.max(ram.hack, ram.grow, ram.weaken)) return null;
  const fx = formulasCtx(ns, cfg);
  return status === "farm"
    ? planFarm(ns, s, cfg, budgetGb, ram, hackFraction, fx, maxBatches)
    : planPrep(ns, s, cfg, budgetGb, ram, status, fx);
}

/** @param {NS} ns */
function planPrep(ns, s, cfg, budget, ram, kind, fx) {
  const wEff = ns.weakenAnalyze(1);
  const excess = Math.max(0, s.sec - s.minSec);
  let w1 = Math.ceil(excess / wEff);
  const mult = s.maxMoney / Math.max(1, s.money);
  const growFor = fx
    // exact: grow lands after W1, so at min security, from the current money
    ? (m) => (m > 1.0001 ? Math.ceil(ns.formulas.hacking.growThreads(hypo(s.raw, { sec: s.minSec }), fx.player, s.maxMoney, 1) * cfg.formulas.growSafety) : 0)
    : (m) => (m > 1.0001 ? Math.ceil(ns.growthAnalyze(s.host, m) * cfg.farm.growSafety) : 0);
  const weakFor = (g) => (g > 0 ? Math.ceil((ns.growthAnalyzeSecurity(g) / wEff) * cfg.farm.weakenSafety) : 0);
  let g = growFor(mult);
  let w2 = weakFor(g);
  const cost = () => (w1 + w2) * ram.weaken + g * ram.grow;

  let note = "full";
  if (cost() > budget) {
    note = "scaled to RAM";
    w1 = Math.min(w1, Math.floor(budget / ram.weaken));
    const left = budget - w1 * ram.weaken;
    // each grow thread needs ~growSec/wEff weaken threads alongside it
    const wPerG = (ns.growthAnalyzeSecurity(1) / wEff) * cfg.farm.weakenSafety;
    g = Math.max(0, Math.floor(left / (ram.grow + wPerG * ram.weaken)));
    w2 = weakFor(g);
    while (g > 0 && cost() > budget) { g--; w2 = weakFor(g); }
  }
  if (w1 + g + w2 === 0) return null;

  const step = cfg.farm.stepMs;
  const W = ns.getWeakenTime(s.host);
  const G = ns.getGrowTime(s.host);
  /** @type {Job[]} */
  const jobs = [];
  if (w1) jobs.push({ op: "weaken", threads: w1, delay: 0 });
  if (g) jobs.push({ op: "grow", threads: g, delay: Math.max(0, W + step - G) });
  if (w2) jobs.push({ op: "weaken", threads: w2, delay: 2 * step });
  return {
    target: s.host, kind, jobs, ramGb: cost(), durationMs: W + 2 * step, hackFraction: 0,
    note: `${fx ? "[F] " : ""}${note}: W${w1} G${g} W${w2}`,
  };
}

/** @param {NS} ns */
function planFarm(ns, s, cfg, budget, ram, fraction, fx, maxBatches) {
  const ideal = hypo(s.raw, { sec: s.minSec, money: s.maxMoney });
  const pct = fx ? ns.formulas.hacking.hackPercent(ideal, fx.player) : ns.hackAnalyze(s.host);
  // grow lands after W1 → min security, refilling from max × (1 − stolen)
  const growAfter = fx
    ? (st) => Math.ceil(ns.formulas.hacking.growThreads(hypo(ideal, { money: s.maxMoney * (1 - st) }), fx.player, s.maxMoney, 1) * cfg.formulas.growSafety)
    : (st) => Math.ceil(ns.growthAnalyze(s.host, 1 / (1 - st)) * cfg.farm.growSafety);
  if (!(pct > 0)) return null;
  const wEff = ns.weakenAnalyze(1);
  let f = fraction;
  let h = 0, g = 0, w1 = 0, w2 = 0, cost = Infinity, stolen = 0;
  for (let i = 0; i < 30; i++) {
    h = Math.max(1, Math.floor(f / pct));
    stolen = Math.min(0.95, h * pct);
    g = growAfter(stolen);
    w1 = Math.ceil((ns.hackAnalyzeSecurity(h, s.host) / wEff) * cfg.farm.weakenSafety);
    w2 = Math.ceil((ns.growthAnalyzeSecurity(g) / wEff) * cfg.farm.weakenSafety);
    cost = h * ram.hack + g * ram.grow + (w1 + w2) * ram.weaken;
    if (cost <= budget) break;
    if (h === 1) return null;
    f *= 0.75;
  }
  if (cost > budget) return null;

  const step = cfg.farm.stepMs;
  const spacing = cfg.farm.batchSpacingMs;
  const W = ns.getWeakenTime(s.host);
  const G = ns.getGrowTime(s.host);
  const H = ns.getHackTime(s.host);
  // how many batches: RAM-bound, capped, and all must land within ~one extra weaken time
  const byTime = Math.max(1, Math.floor(W / spacing));
  const n = Math.max(1, Math.min(maxBatches, byTime, Math.floor(budget / cost)));
  /** @type {Job[]} */
  const jobs = [];
  for (let k = 0; k < n; k++) {
    const o = k * spacing;
    // placement order per batch: weakens and grow first so a short pool starves hack, not the safety jobs
    jobs.push({ op: "weaken", threads: w1, delay: step + o });
    jobs.push({ op: "weaken", threads: w2, delay: 3 * step + o });
    jobs.push({ op: "grow", threads: g, delay: Math.max(0, W + 2 * step - G) + o });
    jobs.push({ op: "hack", threads: h, delay: Math.max(0, W - H) + o });
  }
  return {
    target: s.host,
    kind: "farm",
    jobs,
    batches: n,
    ramGb: cost * n,
    durationMs: W + 3 * step + (n - 1) * spacing,
    hackFraction: stolen,
    note: `${fx ? "[F] " : ""}${n}× batch, steal ${(stolen * 100).toFixed(1)}%${f < fraction ? " (scaled to RAM)" : ""}: H${h} W${w1} G${g} W${w2} each`,
  };
}
