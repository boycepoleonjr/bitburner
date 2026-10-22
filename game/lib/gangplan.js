/**
 * lib/gangplan.js — gang decisions. PURE (no ns, no globals): agent/gang.js builds a snapshot from the game, calls these,
 * applies the result, and writes data/gang-status.txt (contract: docs/specs/gang.md §6). Unit-tested in Node (test/gangplan.js).
 *
 * Every function takes `(snap, s)` and returns data plus `reasons[]`. `s` = flat settings (lib/settings.js readSettings).
 * NOTE: skills are read with bracket access ("hack" is also a Netscript function name; bitburner's RAM analyzer would charge
 * for `.hack`), and no identifier here may match a RAM-costing Netscript name (test/gang-static.js).
 *
 * snap = {
 *   t (ms), accessible, inGang, bn, karma, money, joined:[faction], combat:{str,def,dex,agi} (player skills),
 *   bootstrapStart (ms|null), trainLoops:{name:n}, cleanup:bool (previous loop), repMult, favor, softcap,
 *   info: GangGenInfo|null  (faction, isHacking, respect, wantedLevel, wantedPenalty, territory, power, territoryWarfareEngaged,
 *                            respectGainRate, moneyGainRate, territoryClashChance, respectForNextRecruit),
 *   members: [{name, task, hack,str,def,dex,agi,cha, earnedRespect, upgrades:[], augmentations:[], asc:{hack..cha}}],
 *   others: {faction:{power, territory}} (every gang, own included),
 *   tasks: {name: ns.gang.getTaskStats result}, equipment: [{name, type, cost, stats:{str?:mult,...}}],
 *   weight (0 = money .. 1 = rep, from strategy.*), reserve ($ the aug planner is saving for)
 * }
 */
import { respectGain, wantedGain, moneyGain, wantedPenalty, GANG } from "lib/gangformulas.js";

export const COMBAT_ORDER = ["Speakers for the Dead", "The Dark Army", "The Syndicate", "Tetrads", "Slum Snakes"];
export const HACKING_ORDER = ["The Black Hand", "NiteSec"];
export const SKILLS = ["hack", "str", "def", "dex", "agi", "cha"];
export const COMBAT_SKILLS = ["str", "def", "dex", "agi"];
export const T = Object.freeze({
  unassigned: "Unassigned", trainCombat: "Train Combat", trainHacking: "Train Hacking", trainCharisma: "Train Charisma",
  warfare: "Territory Warfare", vigilante: "Vigilante Justice", ethical: "Ethical Hacking",
});
/** Tasks that are never "work" (chosen by their own rule, not by gain). */
const NOT_WORK = new Set(Object.values(T));
export const TRAIN_LOOPS = 10;      // loops of training after a recruit or an ascension
export const SNAKES_MIN_COMBAT = 30; // Slum Snakes invite: every combat stat >= 30 ...
export const SNAKES_KARMA = -9;      // ... and karma <= -9 (and $1m)

const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const members = (snap) => (Array.isArray(snap.members) ? snap.members : []);
export const primaryOf = (isHacking) => (isHacking ? ["hack"] : COMBAT_SKILLS);
const avgPrimary = (m, isHacking) => { const k = primaryOf(isHacking); return sum(k.map((x) => num(m[x], 0))) / k.length; };
const power = (m) => sum(SKILLS.map((k) => num(m[k], 0))) / 95;
const enabled = (s) => s?.["gang.enabled"] !== false;
/** Gang state as the formulas expect it. */
const gangG = (snap) => ({ respect: num(snap.info?.respect, 1), wanted: num(snap.info?.wantedLevel, 1), territory: num(snap.info?.territory, 0) });

/** Karma needed for gang access outside BN2 (together with SF2). */
export const GANG_KARMA = -54000;

/** Can a gang exist here? In BN2, once in a gang, or with SF2 AND karma <= GANG_KARMA (the game's canAccessGang). Anything else
 * (e.g. BN5 with SF2 but no gang) has no gang API, so nothing should start or restart gang.js. Same rule as gang.js's `accessible`.
 * Shared by gang.js, autopilot, post-install and daemon-lite (they must not import agent/gang.js: imports add RAM). */
export function gangPossible({ bn, inGang, ownedSF, karma }) {
  const sf2 = !!(ownedSF && (typeof ownedSF.has === "function" ? ownedSF.has(2) : ownedSF[2]));
  return !!inGang || bn === 2 || (sf2 && num(karma, 0) <= GANG_KARMA);
}

/** The gang's faction from data/gang-status.txt text (null when there is no gang). Used to keep work and donations off it. */
export function gangFactionFromStatus(text) {
  try { const j = JSON.parse(text || "null"); return j && j.inGang && typeof j.faction === "string" ? j.faction : null; } catch { return null; }
}

/** "gym" | "crime" when the freshly written status says the combat bootstrap needs the player busy with that, else null.
 * Never during a dry run (it changes the player's activity), and a stale status (gang.js not running) counts as nothing. */
export function gangCrimeAction(status, now = Date.now()) {
  if (!status || status.phase !== "bootstrap" || status.dryRun || !(now - num(status.t, 0) < 2 * 60000)) return null;
  return status.bootstrapAction === "gym" || status.bootstrapAction === "crime" ? status.bootstrapAction : null;
}

/** disabled -> bootstrap (no gang) -> grow (< 12 members) -> territory (< 0.999) -> done. */
export function phaseOf(snap, s = {}) {
  if (!enabled(s) || !snap.accessible) return "disabled";
  if (!snap.inGang || !snap.info) return "bootstrap";
  if (members(snap).length < GANG.maxMembers) return "grow";
  if (num(snap.info.territory, 0) < 0.999) return "territory";
  return "done";
}

/**
 * Which faction to build the gang on, and the next step towards it (decision 1).
 * @returns {{faction:string|null, action:"create"|"crime"|"gym"|"wait"|"fallbackHacking", reasons:string[]}}
 */
export function chooseFaction(snap, s = {}) {
  const joined = new Set(snap.joined || []);
  const want = s["gang.faction"] || "auto";
  const reasons = [];
  const snakes = () => {
    const c = snap.combat || {};
    const low = COMBAT_SKILLS.filter((k) => num(c[k], 0) < SNAKES_MIN_COMBAT);
    if (low.length) return { faction: "Slum Snakes", action: "gym", reasons: [...reasons, `Slum Snakes needs combat stats >= ${SNAKES_MIN_COMBAT}: train ${low.join(", ")}`] };
    if (num(snap.karma, 0) > SNAKES_KARMA) return { faction: "Slum Snakes", action: "crime", reasons: [...reasons, `Slum Snakes needs karma <= ${SNAKES_KARMA} (now ${num(snap.karma, 0).toFixed(1)}): commit Mug`] };
    return { faction: "Slum Snakes", action: "wait", reasons: [...reasons, "Slum Snakes requirements met: waiting for the invite ($1m) and the join"] };
  };
  if (want !== "auto") {
    if (joined.has(want)) return { faction: want, action: "create", reasons: [`gang.faction=${want}: joined`] };
    reasons.push(`gang.faction=${want}`);
    if (want === "Slum Snakes") return snakes();
    return { faction: want, action: "wait", reasons: [...reasons, `${want} not joined yet (autopilot/sl-work join invites)`] };
  }
  for (const f of COMBAT_ORDER) if (joined.has(f)) return { faction: f, action: "create", reasons: [`${f} joined: combat gang`] };
  const timeoutMin = num(s["gang.bootstrapTimeoutMin"], 60);
  const elapsed = snap.bootstrapStart != null ? (num(snap.t, Date.now()) - snap.bootstrapStart) / 60000 : 0;
  if (elapsed >= timeoutMin) {
    const h = HACKING_ORDER.find((f) => joined.has(f));
    return { faction: h || "NiteSec", action: "fallbackHacking", reasons: [`combat bootstrap exceeded ${timeoutMin} min (${Math.round(elapsed)}): hacking gang on ${h || "NiteSec (not joined yet)"}`] };
  }
  reasons.push(`combat bootstrap ${Math.round(elapsed)}/${timeoutMin} min`);
  return snakes();
}

/** Respect needed to recruit when the gang has n members (3 free, then 5^(n-2); Infinity at 12). */
export const recruitThreshold = (n) => (n < GANG.freeMembers ? 0 : n >= GANG.maxMembers ? Infinity : Math.pow(GANG.recruitBase, n - GANG.freeMembers + 1));
export const memberName = (i) => `g${String(i).padStart(2, "0")}`;

/** Names to recruit now: g01..g12, filling gaps left by dead members. @returns {{names:string[], reasons:string[]}} */
export function recruitNames(snap) {
  const have = new Set(members(snap).map((m) => m.name));
  const respect = num(snap.info?.respect, 0);
  const names = [], reasons = [];
  let n = have.size, next = 1;
  while (n < GANG.maxMembers && respect >= recruitThreshold(n)) {
    while (have.has(memberName(next))) next++;
    const name = memberName(next);
    have.add(name); names.push(name); n++;
  }
  if (!names.length && n < GANG.maxMembers) reasons.push(`next recruit needs ${recruitThreshold(n)} respect (have ${Math.round(respect)})`);
  return { names, reasons };
}

/** Wanted-cleanup hysteresis: enter below 1 - gang.wantedPenaltyMax (wanted > 1), exit at penalty >= 0.99 or wanted <= 1. */
export function cleanupDecision(snap, s = {}) {
  const wanted = num(snap.info?.wantedLevel, 1), respect = num(snap.info?.respect, 1);
  const penalty = num(snap.info?.wantedPenalty, wantedPenalty({ respect, wanted }));
  const max = num(s["gang.wantedPenaltyMax"], 0.05);
  const active = snap.cleanup ? !(penalty >= 0.99 || wanted <= 1) : penalty < 1 - max && wanted > 1;
  return { active, penalty, reasons: active ? [`wanted cleanup: penalty ${penalty.toFixed(3)}, wanted ${wanted.toFixed(1)}`] : [] };
}

const trainTask = (snap) => (snap.info?.isHacking ? T.trainHacking : T.trainCombat);
const cleanupTask = (snap) => (snap.info?.isHacking ? T.ethical : T.vigilante);
const workTasks = (snap) => Object.values(snap.tasks || {}).filter((t) => t && !NOT_WORK.has(t.name) && !(t.baseWanted < 0)).sort((a, b) => a.name.localeCompare(b.name));
const rank = (a, key) => [...a].sort((x, y) => key(y) - key(x) || x.name.localeCompare(y.name));

/** Best work task for a member by objective ("respect" | "money"); money falls back to respect when nothing earns. */
export function bestWork(member, snap, objective, softcap = 1) {
  const g = gangG(snap), tasks = workTasks(snap);
  const pick = (f) => { let best = null, bv = 0; for (const t of tasks) { const v = f(g, member, t, softcap); if (v > bv + 1e-12) { best = t; bv = v; } } return best ? { task: best.name, value: bv } : null; };
  if (objective === "money") { const m = pick(moneyGain); if (m) return { ...m, objective: "money" }; }
  const r = pick(respectGain);
  return r ? { ...r, objective: "respect" } : null;
}

/** Money vs respect split (decision 4): only with all 12 members; members ranked by name, idx/n < weight do respect. */
export function objectives(snap, s = {}) {
  const ms = [...members(snap)].sort((a, b) => a.name.localeCompare(b.name));
  const n = ms.length, w = Math.min(1, Math.max(0, num(snap.weight, 0)));
  const out = new Map();
  ms.forEach((m, i) => out.set(m.name, n < GANG.maxMembers ? "respect" : i / n < w ? "respect" : "money"));
  return out;
}

/** Members that must train: fresh recruit/ascension, average primary below gang.trainUntil, or nothing earns respect. */
function trainSet(snap, s, softcap) {
  const out = new Set(), until = num(s["gang.trainUntil"], 150), isH = !!snap.info?.isHacking;
  for (const m of members(snap)) {
    if (num(snap.trainLoops?.[m.name], 0) > 0 || avgPrimary(m, isH) < until || !bestWork(m, snap, "respect", softcap)) out.add(m.name);
  }
  return out;
}

/** Territory Warfare members: the top gang.warfareShare of those with def >= gang.minDefForWar (by def, then name). */
function warSet(snap, s, phase, train) {
  if (phase !== "territory") return new Set();
  const minDef = num(s["gang.minDefForWar"], 300), frac = num(s["gang.warfareShare"], 0.5);
  const el = rank(members(snap).filter((m) => num(m["def"], 0) >= minDef && !train.has(m.name)), (m) => num(m["def"], 0));
  const k = Math.min(el.length, Math.max(frac > 0 && el.length ? 1 : 0, Math.floor(frac * el.length)));
  return new Set(el.slice(0, k).map((m) => m.name));
}

/**
 * Per-member decision context. Stage 1 (no cleanup) gives each member's baseline task; stage 2 picks cleanup members so
 * the projected total wanted gain is <= 0.
 */
export function makeCtx(snap, s = {}) {
  const phase = phaseOf(snap, s), softcap = num(snap.softcap, 1), g = gangG(snap);
  const train = trainSet(snap, s, softcap);
  const ctx = { snap, s, phase, softcap, g, train, war: warSet(snap, s, phase, train), obj: objectives(snap, s), cleanupSet: new Set(), cleanup: cleanupDecision(snap, s), reasons: [] };
  if (!ctx.cleanup.active) return ctx;
  const base = members(snap).map((m) => ({ m, task: taskFor(m, ctx).task }));
  const gain = (m, name) => (snap.tasks?.[name] ? wantedGain(g, m, snap.tasks[name]) : 0);
  let total = sum(base.map((b) => gain(b.m, b.task)));
  const cands = base.filter((b) => gain(b.m, b.task) > 0).sort((a, b) => power(a.m) - power(b.m) || a.m.name.localeCompare(b.m.name));
  for (const c of cands) {
    if (total <= 0) break;
    ctx.cleanupSet.add(c.m.name);
    total += gain(c.m, cleanupTask(snap)) - gain(c.m, c.task);
  }
  ctx.reasons.push(`${ctx.cleanup.reasons[0]}; ${ctx.cleanupSet.size} member(s) on ${cleanupTask(snap)}, projected wanted gain ${total.toExponential(2)}/cycle`);
  return ctx;
}

/** One member's task in priority order: cleanup, train, territory, work. @returns {{task:string, why:string}} */
export function taskFor(member, ctx) {
  const { snap } = ctx;
  if (ctx.cleanupSet.has(member.name)) return { task: cleanupTask(snap), why: "wanted cleanup" };
  if (ctx.train.has(member.name)) return { task: trainTask(snap), why: "train" };
  if (ctx.war.has(member.name)) return { task: T.warfare, why: "territory" };
  const w = bestWork(member, snap, ctx.obj.get(member.name) || "respect", ctx.softcap);
  return w ? { task: w.task, why: `${w.objective} ${w.value.toExponential(2)}/cycle` } : { task: trainTask(snap), why: "no task earns" };
}

/** Everything the loop needs for tasks. @returns {{assignments:{name,task,why}[], cleanup:boolean, reasons:string[], ctx}} */
export function planTasks(snap, s = {}) {
  const ctx = makeCtx(snap, s);
  const assignments = members(snap).map((m) => ({ name: m.name, ...taskFor(m, ctx) }));
  return { assignments, cleanup: ctx.cleanup.active, reasons: ctx.reasons, ctx };
}

/**
 * Territory warfare on/off with hysteresis. Win chance = myPower / (myPower + theirs) per rival gang that still holds
 * territory (getChanceToWinClash would cost 4 GB). @returns {{engage:boolean, minWinChance:number|null, reasons:string[]}}
 */
export function warfareDecision(snap, s = {}) {
  const phase = phaseOf(snap, s), me = snap.info?.faction;
  const mine = num(snap.info?.power, 0);
  const rivals = Object.entries(snap.others || {}).filter(([f, o]) => f !== me && num(o?.territory, 0) > 0);
  const min = rivals.length ? Math.min(...rivals.map(([, o]) => mine / Math.max(1e-9, mine + num(o.power, 0)))) : null;
  if (phase === "done" || phase === "disabled" || phase === "bootstrap") return { engage: false, minWinChance: min, reasons: [`warfare off: phase ${phase}`] };
  if (min == null) return { engage: false, minWinChance: null, reasons: ["warfare off: no rival gang holds territory"] };
  const on = !!snap.info?.territoryWarfareEngaged, hi = num(s["gang.clashEngage"], 0.6), lo = num(s["gang.clashDisengage"], 0.5);
  const engage = on ? min >= lo : min >= hi;
  return { engage, minWinChance: min, reasons: [`warfare ${engage ? "on" : "off"}: min win chance ${min.toFixed(3)} (engage >= ${hi}, disengage < ${lo}, ${on ? "was on" : "was off"})`] };
}

/**
 * At most one ascension per shop run. A member qualifies when the mean primary-stat ratio (ns.gang.getAscensionResult)
 * is >= gang.ascendMult + (11 - i) * 0.05, i = rank by earned respect (0 = most). Never when its earned respect exceeds
 * gang.ascendMaxRespectShare of the gang's respect (ascending forfeits it); recruiting comes first.
 * @param {Array} list members  @param {Object} ascResults name -> {hack,str,...} ratios
 * @param {{s:Object, respect:number, isHacking:boolean, recruiting?:boolean}} ctx
 * @returns {{pick:{name:string, ratio:number, threshold:number}|null, reasons:string[]}}
 */
export function shouldAscend(list, ascResults, ctx) {
  const s = ctx.s || {}, base = num(s["gang.ascendMult"], 1.5), maxShare = num(s["gang.ascendMaxRespectShare"], 0.1);
  if (ctx.recruiting) return { pick: null, reasons: ["ascension waits: recruiting first"] };
  const keys = primaryOf(!!ctx.isHacking);
  const ranked = rank(list, (m) => num(m.earnedRespect, 0));
  let best = null;
  const reasons = [];
  ranked.forEach((m, i) => {
    const r = ascResults?.[m.name];
    if (!r) return;
    const ratio = sum(keys.map((k) => num(r[k], 1))) / keys.length, threshold = base + (11 - i) * 0.05;
    if (ratio < threshold) return;
    if (num(m.earnedRespect, 0) > maxShare * num(ctx.respect, 0)) { reasons.push(`${m.name}: ascension x${ratio.toFixed(2)} held back, earned respect ${Math.round(m.earnedRespect)} > ${maxShare} of ${Math.round(ctx.respect)}`); return; }
    if (!best || ratio - threshold > best.ratio - best.threshold) best = { name: m.name, ratio, threshold };
  });
  if (best) reasons.push(`ascend ${best.name}: x${best.ratio.toFixed(2)} >= ${best.threshold.toFixed(2)}`);
  return { pick: best, reasons };
}

/**
 * Shopping list (decision 3): member augmentations first (cheapest first, <= gang.augSpendFraction x spendable), then
 * non-augmentation equipment that raises a primary stat (<= gang.equipmentSpendFraction x spendable). Both are hard caps,
 * and together they never exceed `spendable` (money minus the planner's reserve). Off-stat items are skipped.
 * @param {number} spendable  @param {{exclude?:Set<string>}} opts members to skip (e.g. about to ascend)
 * @returns {{purchases:{member:string,item:string,cost:number,aug:boolean}[], spent:number, reasons:string[]}}
 */
export function equipmentPurchases(snap, s = {}, spendable = 0, opts = {}) {
  const keys = primaryOf(!!snap.info?.isHacking);
  const budgets = [[true, Math.max(0, num(s["gang.augSpendFraction"], 0.2))], [false, Math.max(0, num(s["gang.equipmentSpendFraction"], 0.1))]];
  const cap = Math.max(0, spendable);
  const useful = (it) => keys.some((k) => num(it.stats?.[k], 1) > 1);
  const purchases = [], reasons = [];
  let spent = 0;
  for (const [aug, frac] of budgets) {
    let left = Math.min(frac * cap, cap - spent);
    const pairs = [];
    for (const m of [...members(snap)].sort((a, b) => a.name.localeCompare(b.name))) {
      if (opts.exclude?.has(m.name)) continue;
      const owned = new Set([...(m.upgrades || []), ...(m.augmentations || [])]);
      for (const it of snap.equipment || []) if ((it.type === "Augmentation") === aug && !owned.has(it.name) && useful(it) && Number.isFinite(it.cost)) pairs.push({ member: m.name, item: it.name, cost: it.cost, aug });
    }
    pairs.sort((a, b) => a.cost - b.cost || a.member.localeCompare(b.member) || a.item.localeCompare(b.item));
    for (const p of pairs) {
      if (p.cost > left) break; // sorted by cost: nothing later fits either
      purchases.push(p); left -= p.cost; spent += p.cost;
    }
    if (!pairs.length) reasons.push(`no ${aug ? "member augmentations" : "equipment"} to buy`);
  }
  return { purchases, spent, reasons };
}

/** The data/gang-status.txt contract (docs/specs/gang.md §6). */
export function buildStatus(a) {
  const { snap, s = {}, phase, choice, warfare, cleanup, recruit, reserve = 0, spent = 0, lastAscend = null, deaths = 0, reasons = [], errors = [] } = a;
  const info = snap.info || null;
  const perSec = (perCycle) => num(perCycle, 0) * 5; // a game cycle is 200 ms
  const respectRate = perSec(info?.respectGainRate);
  const next = info ? Math.max(0, num(info["respectForNextRecruit"], 0)) : 0;
  return {
    t: num(snap.t, Date.now()), enabled: enabled(s), dryRun: !!s["gang.dryRun"], accessible: !!snap.accessible, inGang: !!snap.inGang,
    faction: info?.faction ?? null, isHacking: !!info?.isHacking, phase, bootstrapAction: choice?.action ?? "none", karma: num(snap.karma, 0),
    members: members(snap).length, respect: num(info?.respect, 0), wanted: num(info?.wantedLevel, 0), wantedPenalty: num(info?.wantedPenalty, 1),
    cleanupMode: !!cleanup, respectRate, moneyRate: perSec(info?.moneyGainRate),
    repRate: respectRate * num(snap.repMult, 1) * (1 + num(snap.favor, 0) / 100) / GANG.respectToRep,
    territory: num(info?.territory, 0), power: num(info?.power, 0), clashChance: num(info?.territoryClashChance, 0), warfare: !!(warfare ?? info?.territoryWarfareEngaged),
    minWinChance: a.minWinChance ?? null, recruitNext: Number.isFinite(next) ? next : null, reserve, spentThisLoop: spent, lastAscend, deaths,
    memberList: members(snap).map((m) => ({ name: m.name, task: m.task, "hack": m["hack"], str: m.str, def: m.def, dex: m.dex, agi: m.agi, cha: m.cha,
      ascMult: m.asc || {}, upgrades: (m.upgrades || []).length + (m.augmentations || []).length, earnedRespect: num(m.earnedRespect, 0) })),
    reasons: [...reasons, ...(recruit?.reasons || [])].slice(0, 30), errors: errors.slice(0, 20),
  };
}
