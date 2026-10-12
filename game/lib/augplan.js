/**
 * lib/augplan.js — augmentation path planner + install timing + next-BitNode recommendation. PURE (no ns, no imports
 * beyond other pure libs): fed a data snapshot by agent/sl-plan.js, unit-tested in Node (test/augplan.js).
 *
 * Owner rules (always): prerequisites first; highest rep requirement first within a purchase batch (every purchase
 * multiplies later prices by ~1.9); NeuroFlux Governor LAST; faction favor >= augs.donateAtFavor (BN-scaled) => donate.
 *
 * Output shape is the data/aug-plan.txt contract in docs/specs/aug-planner.md (the dashboard depends on it).
 */
import { flightProgress, phaseOf } from "lib/progress.js";

export const NFG = "NeuroFlux Governor";
export const RED_PILL = "The Red Pill";
export const READY_FLAG = "w0r1d_d43m0n READY — agent decides BitNode destruction"; // server/checkin.js OWNER_DECISION matches this
export const PRICE_STEP = 1.9;          // each queued aug multiplies the next price (game constant, before BN mult)
export const DAEDALUS = { money: 100e9, hack: 2500 };
export const DEFAULT_RECOVERY_MIN = 60; // post-install recovery estimate when no install history exists
/** Default next-BitNode preference (rationale: docs/specs/aug-planner.md "Recommended BitNode order"). */
export const DEFAULT_BN_ORDER = [1, 4, 2, 5, 10, 9, 3, 11, 12, 6, 7, 8, 13, 14];
export const SF_MAX = (n) => (n === 12 ? Infinity : 3);

const HACK_KEYS = ["hacking", "hacking_exp", "hacking_speed", "hacking_money", "hacking_chance", "hacking_grow"];
const fin = (n, d = 0) => (typeof n === "number" && Number.isFinite(n) ? n : d);
const uniq = (a) => [...new Set(a)];

/** Hacking value of an aug: product of hacking-related multipliers (1 = none). */
export function hackScore(aug) {
  const m = aug?.mults || {};
  return (fin(m.hacking, 1) * Math.sqrt(fin(m.hacking_exp, 1))) * (fin(m.hacking_speed, 1) * fin(m.hacking_money, 1)) ** 0.25;
}

/** Donation threshold: the game's favor-to-donate (already BN-scaled) is the floor; augs.donateAtFavor can only raise it. */
export function donateThreshold(snap, s) {
  return Math.max(fin(snap.favorToDonate, 150), fin(s?.["augs.donateAtFavor"], 150));
}

/** Rep gained per $ donated: measured rate if known, else the documented 1e-6 x faction_rep multiplier. */
export const repPerDollar = (snap) => fin(snap.donateRate, 0) > 0 ? snap.donateRate : fin(snap.mults?.faction_rep, 1) / 1e6;

/**
 * Pick each aug's best source faction among joined + invitable factions (highest rep, joined preferred).
 * @returns {Map<string,{faction:string, rep:number, favor:number, joined:boolean, repRate:number}>}
 */
export function sources(snap) {
  const out = new Map();
  const invites = new Set(snap.invites || []);
  for (const [f, info] of Object.entries(snap.factions || {})) {
    const joined = !!info.joined, can = joined || invites.has(f);
    if (!can) continue;
    const src = { faction: f, rep: joined ? fin(info.rep) : 0, favor: fin(info.favor), joined, repRate: fin(info.repRate) };
    for (const a of info.augs || []) {
      const cur = out.get(a);
      if (!cur || (src.joined && !cur.joined) || (src.joined === cur.joined && src.rep > cur.rep)) out.set(a, src);
    }
  }
  return out;
}

/** Owner purchase order: highest rep requirement first, each aug's unowned prerequisites immediately before it. */
export function ownerOrder(names, augs, have = new Set()) {
  const set = new Set(names), order = [];
  const sorted = [...set].sort((a, b) => fin(augs[b]?.repReq) - fin(augs[a]?.repReq) || a.localeCompare(b));
  const place = (a, depth = 0) => {
    if (depth > 10 || have.has(a) || order.includes(a)) return;
    for (const p of augs[a]?.prereqs || []) if (!have.has(p) && set.has(p)) place(p, depth + 1);
    order.push(a);
  };
  for (const a of sorted) place(a);
  return order;
}

/** Adds every unowned prerequisite (transitively) of `names` that `src` can supply. Unobtainable prereqs are returned too. */
function withPrereqs(names, augs, have, src) {
  const out = new Set(names), missing = new Set();
  const visit = (a, d = 0) => {
    for (const p of augs[a]?.prereqs || []) {
      if (have.has(p) || out.has(p) && d > 0) continue;
      if (src.has(p)) { out.add(p); visit(p, d + 1); } else missing.add(p);
    }
  };
  for (const a of names) visit(a);
  return { names: [...out], missing };
}

/** Requirements for the current BitNode. */
export function requirements(snap) {
  const bm = snap.bnMults || {};
  const wdExists = !!snap.worldDaemon?.exists;
  return {
    augsReq: Math.round(fin(bm.DaedalusAugsRequirement, 30)),
    moneyReq: DAEDALUS.money,
    hackReq: DAEDALUS.hack,
    wdReq: wdExists && fin(snap.worldDaemon.req) > 0 ? snap.worldDaemon.req : Math.round(3000 * fin(bm.WorldDaemonDifficulty, 1)),
  };
}

/**
 * Plan. `snap` (built in-game by agent/sl-plan.js; test fixture test/fixtures/bn5-snapshot.json):
 *   { t, bn, hack, money, income ($/s), mults:{faction_rep}, installed:[name], owned:[name] (installed + queued),
 *     invites:[f], factions:{f:{joined,rep,favor,augs:[name],repRate}}, augs:{name:{repReq,price,prereqs,mults}},
 *     bnMults, favorToDonate, worldDaemon:{exists,req,root}, sourceFiles:[{n,lvl}], donateRate?, recoveryMin?,
 *     node?: (pending block from lib/nodectl.js) }
 * `s` = flat settings (lib/settings.js readSettings).
 */
export function plan(snap, s = {}) {
  const t = fin(snap.t, Date.now());
  const augs = snap.augs || {};
  const goal = s["augs.planner.goal"] === "complete" ? "complete" : "destroy";
  const installed = new Set(snap.installed || []);
  const owned = new Set(snap.owned || snap.installed || []);
  const queuedCount = Math.max(0, (snap.owned || []).length - (snap.installed || []).length);
  const req = requirements(snap);
  const src = sources(snap);
  const hack = fin(snap.hack), money = fin(snap.money);
  const installedUnique = [...installed].length;
  const redOwned = owned.has(RED_PILL);
  const progress = flightProgress({ augsInstalled: installedUnique, augsReq: req.augsReq, money, moneyReq: req.moneyReq, hack, hackReq: req.hackReq });
  const phase = phaseOf(progress.progress, redOwned, s);
  const wdReady = !!snap.worldDaemon?.exists && !!snap.worldDaemon?.root && hack >= req.wdReq && installed.has(RED_PILL);

  // ── candidate selection ───────────────────────────────────────────────
  const obtainable = [...src.keys()].filter((a) => !owned.has(a) && a !== NFG && augs[a]);
  let chosen, why = new Map();
  if (goal === "complete") {
    chosen = obtainable;
    for (const a of chosen) why.set(a, "goal complete: every purchasable aug");
  } else {
    chosen = [];
    // 1. Daedalus aug count (queued augs count once installed)
    const needCount = Math.max(0, req.augsReq - installedUnique - queuedCount);
    const quick = obtainable.filter((a) => a !== RED_PILL)
      .map((a) => ({ a, cost: timeCost(a, augs, src, snap, s), hs: hackScore(augs[a]) }))
      .sort((x, y) => x.cost - y.cost || y.hs - x.hs || x.a.localeCompare(y.a));
    for (const q of quick.slice(0, needCount)) { chosen.push(q.a); why.set(q.a, `Daedalus needs ${req.augsReq} installed augs (fastest to get)`); }
    // 2. The Red Pill
    if (!redOwned && src.has(RED_PILL)) { chosen.push(RED_PILL); why.set(RED_PILL, "The Red Pill unlocks w0r1d_d43m0n"); }
    // 3. hacking level for w0r1d_d43m0n: every obtainable hacking aug, best value first
    if (hack < req.wdReq) {
      for (const q of quick.filter((x) => x.hs > 1.0001 && !chosen.includes(x.a)).sort((x, y) => y.hs / Math.max(1, x.cost) - x.hs / Math.max(1, y.cost))) {
        chosen.push(q.a); why.set(q.a, `hacking x${q.hs.toFixed(3)} toward w0r1d_d43m0n (${hack}/${req.wdReq})`);
      }
    }
  }
  const wp = withPrereqs(chosen, augs, owned, src);
  for (const p of wp.names) if (!why.has(p)) why.set(p, "prerequisite");
  const order = ownerOrder(wp.names, augs, owned);

  // ── status + eta (simulated purchase sequence: price grows x PRICE_STEP x BN mult per buy) ──
  const step = PRICE_STEP;
  let cash = money, bought = 0;
  const thr = donateThreshold(snap, s), rpd = repPerDollar(snap), income = fin(snap.income);
  const steps = [];
  const simHave = new Set(owned);
  for (const a of order) {
    const info = augs[a] || {}, sr = src.get(a);
    const price = fin(info.price) * step ** bought;
    const repReq = fin(info.repReq);
    const rep = sr ? sr.rep : 0;
    const repGap = Math.max(0, repReq - rep);
    const canDonate = !!sr && sr.joined && sr.favor >= thr;
    const donateCost = canDonate && repGap > 0 ? repGap / rpd : 0;
    const prereqMissing = (info.prereqs || []).filter((p) => !simHave.has(p));
    let status, etaMin = null, w = why.get(a) || "";
    if (!sr) { status = "blocked"; w = `${w}; no joined or invitable faction sells it`; }
    else if (prereqMissing.some((p) => !src.has(p))) { status = "blocked"; w = `${w}; prerequisite unobtainable: ${prereqMissing.join(", ")}`; }
    else if (repGap > 0 && !(canDonate && cash >= donateCost + price)) {
      status = "needRep";
      const rr = sr.repRate > 0 ? sr.repRate : 0;
      const repEta = canDonate ? (income > 0 ? Math.max(0, donateCost + price - cash) / income / 60 : null) : rr > 0 ? repGap / rr / 60 : null;
      etaMin = repEta;
      if (!sr.joined) w = `${w}; join ${sr.faction} (invited)`;
    } else if (cash < price + donateCost) {
      status = "needMoney";
      etaMin = income > 0 ? (price + donateCost - cash) / income / 60 : null;
    } else {
      status = "buyable"; etaMin = 0;
      cash -= price + donateCost; bought++; simHave.add(a);
      if (donateCost > 0) w = `${w}; donate $${fmt(donateCost)} to ${sr.faction}`;
    }
    steps.push({ order: steps.length + 1, aug: a, faction: sr?.faction ?? "", repReq, price: Math.round(price), prereqs: [...(info.prereqs || [])], status,
      etaMin: status === "buyable" ? 0 : etaMin == null ? null : Math.max(0.1, round1(etaMin)), why: w.replace(/^; /, "") });
  }
  // The Red Pill when Daedalus hasn't invited us yet: shown as blocked so the path is complete
  if (goal === "destroy" && !redOwned && !src.has(RED_PILL) && augs[RED_PILL]) {
    const info = augs[RED_PILL] || {};
    steps.push({ order: steps.length + 1, aug: RED_PILL, faction: "Daedalus", repReq: fin(info.repReq, 2.5e6), price: 0, prereqs: [], status: "blocked", etaMin: null,
      why: `needs the Daedalus invite: ${installedUnique}/${req.augsReq} installed augs, ${fmt(money)}/${fmt(req.moneyReq)}, hack ${hack}/${req.hackReq}` });
  }
  // NeuroFlux Governor: always the final step (owner rule). Listed as "held" when buying it would not help the goal.
  const nfSrc = src.get(NFG);
  const nfgHeld = goal === "destroy" && (wdReady || hack >= fin(s["augs.nfgHoldFrac"], 0.9) * req.wdReq);
  if (nfSrc && augs[NFG]) {
    const info = augs[NFG], gap = Math.max(0, fin(info.repReq) - nfSrc.rep), canDonate = nfSrc.joined && nfSrc.favor >= thr;
    const price = fin(info.price) * step ** bought, cost = price + (canDonate ? gap / rpd : 0);
    const ok = (gap === 0 || canDonate) && cash >= cost;
    steps.push({ order: steps.length + 1, aug: NFG, faction: nfSrc.faction, repReq: fin(info.repReq), price: Math.round(price), prereqs: [], status: ok ? "buyable" : gap > 0 && !canDonate ? "needRep" : "needMoney",
      etaMin: ok ? 0 : round1(gap > 0 && !canDonate ? (nfSrc.repRate > 0 ? gap / nfSrc.repRate / 60 : null) : income > 0 ? (cost - cash) / income / 60 : null),
      why: nfgHeld ? `held: ${wdReady ? "w0r1d_d43m0n is ready (destroy instead; an install resets hacking)" : "hacking is near w0r1d_d43m0n's requirement (augs.nfgHoldFrac)"}`
        : `NeuroFlux last (owner rule)${canDonate && gap > 0 ? `; donate for ${fmt(gap)} rep` : ""}` });
  }

  const install = installDecision({ steps, queued: queuedCount, policy: s["augs.installPolicy"] === "count" ? "count" : "eta",
    installAt: fin(s["augs.installAt"], 6), recoveryMin: fin(snap.recoveryMin, DEFAULT_RECOVERY_MIN), wdReady, redPillQueued: redOwned && !installed.has(RED_PILL),
    nfgHold: hack >= fin(s["augs.nfgHoldFrac"], 0.9) * req.wdReq });

  const red = augs[RED_PILL], redSrc = snap.factions?.Daedalus;
  return {
    t, bn: fin(snap.bn), goal, phase, progress: round3(progress.progress),
    daedalus: { augsReq: req.augsReq, augsInstalled: installedUnique, moneyReq: req.moneyReq, hackReq: req.hackReq, met: progress.met },
    redPill: { owned: redOwned, repReq: fin(red?.repReq, 2.5e6), rep: fin(redSrc?.rep) },
    worldDaemon: { req: req.wdReq, hack, ready: wdReady },
    steps,
    install,
    node: snap.node || { ready: wdReady, autoSelect: !!s["node.autoSelect"], autoDestroy: !!s["node.autoDestroy"], recommended: recommendNextBn(snap, s), pending: { id: "", stage: "none", detail: "" } },
  };
}

/** Minutes-ish cost of obtaining an aug now (rep wait or donation + money), used to pick the fastest Daedalus fillers. */
function timeCost(a, augs, src, snap, s) {
  const sr = src.get(a), info = augs[a] || {};
  if (!sr) return Infinity;
  const gap = Math.max(0, fin(info.repReq) - sr.rep);
  const canDonate = sr.joined && sr.favor >= donateThreshold(snap, s);
  const income = Math.max(1, fin(snap.income));
  const money = fin(info.price) + (canDonate ? gap / repPerDollar(snap) : 0);
  const repMin = gap === 0 || canDonate ? 0 : sr.repRate > 0 ? gap / sr.repRate / 60 : 1e9 + gap;
  return Math.max(repMin, Math.max(0, money - fin(snap.money)) / income / 60);
}

/**
 * Install timing. Returns the contract's install block: {policy, queued, next:{etaMin, reason}}; etaMin 0 = install now.
 * Holds: w0r1d_d43m0n ready (destroy instead), or NeuroFlux-only near the finish (nfgHold).
 */
export function installDecision({ steps, queued, policy, installAt, recoveryMin, wdReady, redPillQueued, nfgHold }) {
  const buyable = steps.filter((x) => x.status === "buyable" && !/^held/.test(x.why));
  const n = queued + buyable.length;
  const nonNfg = buyable.filter((x) => x.aug !== NFG).length;
  const pending = steps.filter((x) => x.status === "needRep" || x.status === "needMoney");
  const nextEta = pending.map((x) => x.etaMin).filter((e) => e != null).reduce((m, e) => Math.min(m, e), Infinity);
  // etaMin 0 means "install now"; a wait is never reported as 0 (rounded up to 0.1)
  const out = (etaMin, reason) => ({ policy, queued, next: { etaMin: etaMin == null || etaMin === Infinity ? null : etaMin === NOW ? 0 : Math.max(0.1, round1(etaMin)), reason } });
  const NOW = -1;
  if (wdReady) return out(null, "hold: w0r1d_d43m0n is ready; destroy the BitNode instead of installing (installs reset hacking)");
  if (redPillQueued || buyable.some((x) => x.aug === RED_PILL)) return out(NOW, "The Red Pill: install now");
  if (n === 0) return out(Number.isFinite(nextEta) ? nextEta : null, pending.length ? "waiting for the first buyable aug" : "nothing left to buy");
  if (nonNfg === 0 && nfgHold && queued === 0) return out(null, "hold: NeuroFlux-only install near w0r1d_d43m0n would reset hacking (nfgHold)");
  if (policy === "count") {
    if (n >= installAt) return out(NOW, `count: ${n} >= ${installAt}`);
    if (!pending.length) return out(NOW, `stalled: ${n} buyable/queued and nothing else coming`);
    return out(nextEta, `count: ${n}/${installAt}`);
  }
  // eta: install when the wait for the next aug is longer than what a reset costs us (recovery)
  if (!pending.length) return out(NOW, `eta: nothing else coming; install ${n}`);
  if (n >= installAt && (!Number.isFinite(nextEta) || nextEta > recoveryMin))
    return out(NOW, `eta: next aug in ${Number.isFinite(nextEta) ? Math.round(nextEta) + "m" : "unknown"} > recovery ${Math.round(recoveryMin)}m; install ${n}`);
  if (n >= installAt) return out(nextEta, `eta: next aug in ${Math.round(nextEta)}m <= recovery ${Math.round(recoveryMin)}m; wait and add it`);
  return out(nextEta, `eta: ${n}/${installAt} minimum batch`);
}

/** Source-File level after destroying the current BitNode (the current BN's SF goes up by one). */
export function sfLevels(sourceFiles = [], currentBn = 0, destroying = true) {
  const lv = {};
  for (const sf of sourceFiles) lv[sf.n] = fin(sf.lvl);
  if (destroying && currentBn) lv[currentBn] = (lv[currentBn] || 0) + 1;
  return lv;
}
export const bnAvailable = (n, lv) => Number.isInteger(n) && n >= 1 && n <= 14 && (lv[n] || 0) < SF_MAX(n);

/** First BitNode from `order` whose Source-File is not maxed (after this destroy). */
export function firstAvailable(order, lv) { return (order || []).find((n) => bnAvailable(n, lv)) ?? null; }

/** Planner recommendation (ignores node.order): DEFAULT_BN_ORDER filtered by SF levels. */
export function recommendNextBn(snap, s = {}) {
  const lv = sfLevels(snap.sourceFiles, fin(snap.bn));
  const bn = firstAvailable(DEFAULT_BN_ORDER, lv);
  const reasons = {
    1: "BN1: fastest node, SF1 raises every multiplier",
    4: "BN4: SF4.2/4.3 cut Singularity RAM 16x -> 4x -> 1x, removing the 1 TB autopilot bootstrap wall",
    2: "BN2: gangs (needs gang automation first)",
    5: "BN5: SF5 raises hacking and intelligence; hacking-friendly",
    10: "BN10: sleeves and grafting",
    9: "BN9: hacknet servers",
    3: "BN3: corporations",
  };
  return { bn, why: bn == null ? "every Source-File is maxed" : `${reasons[bn] || `BN${bn}: next in default order`} (SF${bn} ${lv[bn] || 0} -> ${(lv[bn] || 0) + 1})` };
}

function fmt(n) { const a = Math.abs(n); return a >= 1e15 ? (a / 1e15).toFixed(2) + "q" : a >= 1e12 ? (a / 1e12).toFixed(2) + "t" : a >= 1e9 ? (a / 1e9).toFixed(2) + "b" : a >= 1e6 ? (a / 1e6).toFixed(1) + "m" : Math.round(a).toString(); }
function round1(n) { return n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10; }
function round3(n) { return Math.round(n * 1000) / 1000; }
export { uniq };
