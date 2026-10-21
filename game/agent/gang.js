/** agent/gang.js — gang manager (docs/specs/gang.md). Single instance on home; read-only toward the game except for the
 * one-shots it launches: agent/gang-act.js (create / recruit / setMemberTask / setTerritoryWarfare), agent/gang-shop.js
 * (ascendMember / purchaseEquipment, every 15 loops) and agent/gang-info.js (static task/equipment cache). That keeps this
 * script small (RAM gate: mem <= 16 GB, test/gang-static.js).
 * Each loop: nextUpdate -> settings -> snapshot -> lib/gangplan.js decisions -> orders -> data/gang-status.txt.
 * Settings (gang.*): gang.enabled=false makes it exit before any gang call; gang.dryRun=true launches nothing.
 * Every ns call is wrapped: an error goes into the status errors[] and the loop continues.
 * @param {NS} ns */
import { readSettings } from "lib/settings.js";
import { weightFor } from "lib/progress.js";
import { ascensionMult, ascensionPointsGain } from "lib/gangformulas.js";
import { phaseOf, chooseFaction, recruitNames, planTasks, warfareDecision, shouldAscend, equipmentPurchases, buildStatus, SKILLS, TRAIN_LOOPS, GANG_KARMA } from "lib/gangplan.js";

export const STATUS = "data/gang-status.txt", STATE = "data/gang-state.txt", TASKS = "data/gang-tasks.txt", ACT = "data/gang-act.txt", SHOP = "data/gang-shop.txt";
export const INFO_SCRIPT = "agent/gang-info.js", ACT_SCRIPT = "agent/gang-act.js", SHOP_SCRIPT = "agent/gang-shop.js";
export const SHOP_EVERY = 15;          // loops between shop runs

const json = (txt, d = null) => { try { return txt ? JSON.parse(txt) : d; } catch { return d; } };
const ptime = (x) => (x && typeof x.t === "number" ? x.t : 0);

export async function main(ns) {
  ns.disableLog("ALL");
  const me = ns.getRunningScript(ns.getScriptName(), "home");
  if (me && me.pid !== ns.pid) return; // another copy is already running
  const st = loadState(ns);
  while (true) {
    const s = readSettings(ns);
    if (s["gang.enabled"] === false) { ns.write(STATUS, JSON.stringify({ t: Date.now(), enabled: false, phase: "disabled", inGang: false, reasons: ["gang.enabled=false: exiting"], errors: [] }), "w"); return; }
    let status;
    try { status = await step(ns, st, s); } catch (e) { status = { t: Date.now(), phase: "error", errors: [`step: ${String(e).slice(0, 160)}`], reasons: [] }; ns.write(STATUS, JSON.stringify(status), "w"); }
    if (status.accessible === false && !status.inGang) return; // nothing to manage in this BitNode
    try { if (status.inGang) await ns.gang.nextUpdate(); else await ns.sleep(5000); } catch { await ns.sleep(5000); }
  }
}

function loadState(ns) {
  const d = json(ns.read(STATE), {}) || {};
  return { v: 1, bootstrapStart: d.bootstrapStart ?? null, trainLoops: d.trainLoops || {}, lastAscend: d.lastAscend || null, deaths: d.deaths || 0, names: d.names || [], cleanup: !!d.cleanup, loop: d.loop || 0, seenAct: d.seenAct || 0, seenShop: d.seenShop || 0 };
}

/** Waits (bounded) for a one-shot to finish; the fake ns in tests resolves immediately. */
async function finish(ns, pid) { for (let i = 0; pid && i < 100 && ns.isRunning(pid); i++) await ns.sleep(50); }

/** One planning pass. Exported for tests. @returns {Promise<Object>} the status written to data/gang-status.txt */
export async function step(ns, st, s) {
  const errors = [], reasons = [];
  const safe = (label, f, d) => { try { return f(); } catch (e) { errors.push(`${label}: ${String(e).slice(0, 140)}`); return d; } };
  const G = ns.gang;
  st.loop++;
  // outcomes of last loop's one-shots
  const act = json(ns.read(ACT)); if (act && ptime(act) > st.seenAct) { st.seenAct = act.t; for (const r of act.results || []) if (!r.ok) errors.push(`${r.op}: ${r.err || "refused"}`); }
  const shop = json(ns.read(SHOP));
  if (shop && ptime(shop) > st.seenShop) {
    st.seenShop = shop.t;
    if (shop.ascended) { st.lastAscend = { name: shop.ascended, t: shop.t }; st.trainLoops[shop.ascended] = TRAIN_LOOPS; }
    for (const e of shop.errors || []) errors.push(e);
  }

  // ── snapshot ────────────────────────────────────────────────────────────
  const t = Date.now();
  const reset = safe("getResetInfo", () => ns.getResetInfo(), null), bn = reset?.currentNode ?? 0;
  const p = safe("getPlayer", () => ns.getPlayer(), {});
  const karma = safe("karma", () => ns.heart.break(), 0);
  const inGang = safe("inGang", () => G.inGang(), false);
  const accessible = inGang || bn === 2 || !!(reset?.ownedSF?.has(2) && karma <= GANG_KARMA);
  const sk = p.skills || {};
  const snap = {
    t, bn, karma, accessible, inGang, money: p.money ?? 0, joined: p.factions || [], combat: { str: sk.strength ?? 0, def: sk.defense ?? 0, dex: sk.dexterity ?? 0, agi: sk.agility ?? 0 },
    repMult: p.mults?.faction_rep ?? 1, favor: 0, softcap: 1, bootstrapStart: st.bootstrapStart, trainLoops: st.trainLoops, cleanup: st.cleanup,
    info: null, members: [], others: {}, tasks: {}, equipment: [], weight: 0, reserve: 0,
  };
  let cache = json(ns.read(TASKS));
  if (inGang) {
    snap.info = safe("getGangInformation", () => G.getGangInformation(), null);
    snap.others = safe("getAllGangInformation", () => G.getAllGangInformation(), {});
    for (const name of safe("getMemberNames", () => G.getMemberNames(), [])) {
      const m = safe(`getMemberInformation ${name}`, () => G.getMemberInformation(name), null);
      if (!m) continue;
      const asc = {}, ratio = {};
      for (const k of SKILLS) {
        const pts = m[`${k}_asc_points`] ?? 0, before = ascensionMult(pts);
        asc[k] = m[`${k}_asc_mult`] ?? before;
        ratio[k] = ascensionMult(pts + ascensionPointsGain(m[`${k}_exp`] ?? 0)) / before;
      }
      snap.members.push({ ...m, asc, ascRatio: ratio });
    }
    if (snap.info && !(cache && cache.isHacking === snap.info.isHacking)) { // read-only one-shot, fine in dry run too
      const pid = safe(INFO_SCRIPT, () => ns.run(INFO_SCRIPT, 1), 0);
      if (!pid) errors.push(`${INFO_SCRIPT}: not enough RAM on home`); else { await finish(ns, pid); cache = json(ns.read(TASKS)); }
    }
    if (snap.info && cache && cache.isHacking === snap.info.isHacking) snap.tasks = cache.tasks || {};
  }
  // strategy weight (money 0 .. faction rep 1) and the aug planner's reserve
  const rs = json(ns.read("data/ram-status.txt")), plan = json(ns.read("data/aug-plan.txt"));
  snap.weight = typeof rs?.weight === "number" ? rs.weight : plan?.phase ? weightFor(plan.phase, s) : weightFor("early", s);
  snap.reserve = plan && t - ptime(plan) < 10 * 60000 && plan.nextPurchaseCost > 0 ? plan.nextPurchaseCost : 0;

  // ── deaths ──────────────────────────────────────────────────────────────
  const names = snap.members.map((m) => m.name);
  if (inGang) {
    for (const n of st.names) if (!names.includes(n)) { st.deaths++; reasons.push(`member ${n} is gone (killed in a clash?)`); }
    st.names = names;
  }
  if (!snap.members.length && inGang) st.names = [];

  // ── decisions ───────────────────────────────────────────────────────────
  const phase = phaseOf(snap, s), dry = !!s["gang.dryRun"];
  const orders = {};
  let choice = null, warfare = null, cleanup = false, spent = 0, recruit = { names: [], reasons: [] }, minWin = null;
  if (phase === "bootstrap") {
    if (st.bootstrapStart == null) st.bootstrapStart = t;
    snap.bootstrapStart = st.bootstrapStart;
    choice = chooseFaction(snap, s);
    reasons.push(...choice.reasons);
    if (choice.action === "create" || (choice.action === "fallbackHacking" && snap.joined.includes(choice.faction))) orders.create = choice.faction;
  } else if (phase !== "disabled") {
    recruit = recruitNames(snap);
    if (recruit.names.length) { orders.recruit = recruit.names; for (const n of recruit.names) st.trainLoops[n] = TRAIN_LOOPS; reasons.push(`recruit ${recruit.names.join(", ")}`); }
    const tp = planTasks(snap, s);
    cleanup = tp.cleanup; st.cleanup = cleanup; reasons.push(...tp.reasons);
    const byName = new Map(snap.members.map((m) => [m.name, m]));
    const tasks = {};
    for (const a of tp.assignments) if (byName.get(a.name)?.task !== a.task) tasks[a.name] = a.task;
    if (Object.keys(tasks).length) orders.tasks = tasks;
    const wd = warfareDecision(snap, s);
    warfare = wd.engage; minWin = wd.minWinChance; reasons.push(...wd.reasons);
    if (wd.engage !== !!snap.info?.territoryWarfareEngaged) orders.warfare = wd.engage;
    // shop: ascension and equipment, every SHOP_EVERY loops
    if (st.loop % SHOP_EVERY === 0 && snap.members.length) {
      const spendable = Math.max(0, snap.money - snap.reserve);
      const ratios = Object.fromEntries(snap.members.map((m) => [m.name, m.ascRatio]));
      const asc = shouldAscend(snap.members, ratios, { s, respect: snap.info.respect, isHacking: snap.info.isHacking, recruiting: recruit.names.length > 0 });
      reasons.push(...asc.reasons);
      snap.equipment = safe("equipment", () => equipmentList(ns, cache), []);
      const buy = equipmentPurchases(snap, s, spendable, { exclude: new Set(asc.pick ? [asc.pick.name] : []) });
      spent = buy.spent; reasons.push(...buy.reasons);
      if (asc.pick || buy.purchases.length) orders.shop = { ascend: asc.pick?.name || null, buy: buy.purchases.map((x) => ({ member: x.member, item: x.item })) };
    }
  }

  // ── apply (never in dry run) ────────────────────────────────────────────
  const { shop: shopOrder, ...actOrders } = orders;
  if (Object.keys(actOrders).length) {
    if (dry) reasons.push(`dryRun: would apply ${JSON.stringify(actOrders).slice(0, 300)}`);
    else {
      const pid = safe(ACT_SCRIPT, () => ns.run(ACT_SCRIPT, 1, JSON.stringify(actOrders)), 0);
      if (!pid) errors.push(`${ACT_SCRIPT}: not enough RAM on home (retrying next loop)`); else await finish(ns, pid);
    }
  }
  if (shopOrder) {
    if (dry) reasons.push(`dryRun: would shop ${JSON.stringify(shopOrder).slice(0, 300)}`);
    else {
      const pid = safe(SHOP_SCRIPT, () => ns.run(SHOP_SCRIPT, 1, JSON.stringify(shopOrder)), 0);
      if (!pid) errors.push(`${SHOP_SCRIPT}: not enough RAM on home`); else await finish(ns, pid);
    }
  }
  for (const n of Object.keys(st.trainLoops)) { if (!names.includes(n) && !orders.recruit?.includes(n)) delete st.trainLoops[n]; else if (names.includes(n) && st.trainLoops[n] > 0 && !orders.recruit?.includes(n)) st.trainLoops[n]--; }

  const status = buildStatus({ snap, s, phase, choice, warfare, cleanup, recruit, reserve: snap.reserve, spent, lastAscend: st.lastAscend, deaths: st.deaths, reasons, errors, minWinChance: minWin });
  ns.write(STATUS, JSON.stringify(status), "w");
  ns.write(STATE, JSON.stringify({ ...st }), "w");
  return status;
}

/** Equipment with live (discounted) costs; static type/stats come from the cache gang-info.js wrote. */
function equipmentList(ns, cache) {
  const out = [];
  for (const [name, e] of Object.entries(cache?.equip || {})) out.push({ name, type: e.type, stats: e.stats, cost: ns.gang.getEquipmentCost(name) });
  return out;
}
