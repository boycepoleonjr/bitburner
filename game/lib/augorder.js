/**
 * lib/augorder.js — configurable augmentation purchase order (docs/specs/aug-order.md). PURE: no ns, no window/document,
 * no imports. Shared by lib/augplan.js (planner), agent/autopilot.js (buyBatch, aug report, strict hold, drivesWork),
 * agent/sl-plan.js (catalog) and the dashboard's Order tab.
 *
 * Fixed owner rules (not configurable): prerequisites immediately before dependents; NeuroFlux Governor last (callers
 * never pass it in; the settings schema rejects it).
 * With the default config the result equals the pre-feature orders (golden tests in test/augorder.js).
 */

export const DEFAULT_ORDER_CFG = Object.freeze({ sort: "rep", pinned: Object.freeze([]), last: Object.freeze([]), exclude: Object.freeze([]) });
/** Every settings key the Order tab writes; "Reset to default" unsets exactly these. */
export const ORDER_KEYS = Object.freeze(["augs.order.sort", "augs.order.pinned", "augs.order.last", "augs.order.exclude",
  "augs.order.strict", "augs.order.strictMaxWaitMin", "augs.order.drivesWork"]);
export const SORTS = Object.freeze(["rep", "price", "cheap", "name"]);
export const DEFAULT_STRICT_WAIT_MIN = 120;
const DEPTH_CAP = 10;

const fin = (n, d = 0) => (typeof n === "number" && Number.isFinite(n) ? n : d);
const arr = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string") : []);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

/** Order config from flat settings (lib/settings.js readSettings). Missing/invalid fields fall back to the defaults. */
export function cfgFromSettings(s = {}) {
  return {
    sort: SORTS.includes(s["augs.order.sort"]) ? s["augs.order.sort"] : "rep",
    pinned: arr(s["augs.order.pinned"]), last: arr(s["augs.order.last"]), exclude: arr(s["augs.order.exclude"]),
    strict: s["augs.order.strict"] === true,
    strictMaxWaitMin: Number.isFinite(s["augs.order.strictMaxWaitMin"]) ? s["augs.order.strictMaxWaitMin"] : DEFAULT_STRICT_WAIT_MIN,
    drivesWork: s["augs.order.drivesWork"] === true,
  };
}
/** True when the ordering fields equal the defaults (strict / drivesWork are behaviours, not ordering, but they also count). */
export function isDefaultCfg(cfg = {}) {
  return (cfg.sort || "rep") === "rep" && !arr(cfg.pinned).length && !arr(cfg.last).length && !arr(cfg.exclude).length
    && !cfg.strict && !cfg.drivesWork && (cfg.strictMaxWaitMin == null || cfg.strictMaxWaitMin === DEFAULT_STRICT_WAIT_MIN);
}

/**
 * @param {string[]} names  candidate augs (never NeuroFlux)
 * @param {{sort?:string,pinned?:string[],last?:string[],exclude?:string[]}} cfg
 * @param {Object<string,{repReq?:number,price?:number,prereqs?:string[]}>} info
 * @param {Set<string>} have  owned (installed or queued)
 * @param {{tie?:"name"|"input"}} opt  tie rule inside equal sort keys: "name" (planner) or the order of `names` (autopilot)
 * @returns {{order:string[], excluded:string[], blocked:Array<{aug:string,by:string}>, warnings:string[], tags:Object<string,string>}}
 */
export function orderAugs(names, cfg = {}, info = {}, have = new Set(), { tie = "name" } = {}) {
  const sort = SORTS.includes(cfg.sort) ? cfg.sort : "rep";
  const pinned = arr(cfg.pinned), last = arr(cfg.last), exclude = arr(cfg.exclude);
  const exclSet = new Set(exclude), pinSet = new Set(pinned), lastSet = new Set(last);
  const input = [...new Set(names)];
  const pos = new Map(input.map((a, i) => [a, i]));
  const warnings = [];

  // list hygiene: unknown names, names in several lists (exclude > pinned > last)
  for (const [label, list] of [["pinned", pinned], ["last", last], ["exclude", exclude]]) for (const a of list) if (!has(info, a)) warnings.push(`unknown aug in ${label}: ${a}`);
  for (const a of new Set([...pinned, ...last, ...exclude])) {
    const inl = [exclSet.has(a) && "exclude", pinSet.has(a) && "pinned", lastSet.has(a) && "last"].filter(Boolean);
    if (inl.length > 1) warnings.push(`${a} is in ${inl.join(" and ")}: ${inl[0]} wins`);
  }

  const excluded = input.filter((a) => exclSet.has(a));
  let rest = input.filter((a) => !exclSet.has(a));

  // blocked: an unowned prerequisite is excluded, or is itself blocked (to a fixpoint)
  const blockedBy = new Map();
  for (let changed = true; changed;) {
    changed = false;
    for (const a of rest) {
      if (blockedBy.has(a)) continue;
      const p = (info[a]?.prereqs || []).find((q) => !have.has(q) && (exclSet.has(q) || blockedBy.has(q)));
      if (p) { blockedBy.set(a, p); changed = true; }
    }
  }
  const blocked = [];
  for (const a of rest) if (blockedBy.has(a)) { blocked.push({ aug: a, by: blockedBy.get(a) }); warnings.push(`${a} blocked: prerequisite ${blockedBy.get(a)} excluded`); }
  rest = rest.filter((a) => !blockedBy.has(a));

  const live = new Set(rest);
  const pinnedList = pinned.filter((a) => live.has(a));
  const lastList = last.filter((a) => live.has(a) && !pinSet.has(a));
  const fixed = new Set([...pinnedList, ...lastList]);
  const key = { rep: (a) => -fin(info[a]?.repReq), price: (a) => -fin(info[a]?.price), cheap: (a) => fin(info[a]?.price), name: () => 0 }[sort];
  const auto = rest.filter((a) => !fixed.has(a)).sort((a, b) => key(a) - key(b) || (sort === "name" || tie === "name" ? a.localeCompare(b) : pos.get(a) - pos.get(b)));
  const ranked = [...pinnedList, ...auto, ...lastList];
  const tags = {};
  for (const a of pinnedList) tags[a] = "pinned";
  for (const a of auto) tags[a] = "auto";
  for (const a of lastList) tags[a] = "last";

  // prerequisites immediately before their dependent (depth cap, cycle-safe)
  const order = [], placed = new Set(), visiting = new Set();
  const place = (a, depth, viaPrereq) => {
    if (depth > DEPTH_CAP || have.has(a) || placed.has(a) || visiting.has(a)) return;
    visiting.add(a);
    for (const p of info[a]?.prereqs || []) if (!have.has(p) && live.has(p)) place(p, depth + 1, true);
    visiting.delete(a);
    if (placed.has(a)) return;
    placed.add(a); order.push(a);
    if (viaPrereq && tags[a] !== "pinned") tags[a] = "prereq";
  };
  for (const a of ranked) place(a, 0, false);
  return { order, excluded, blocked, warnings, tags };
}

/** Total price of buying `order` in sequence when every purchase multiplies later prices by `step` (the planner's PRICE_STEP). */
export function projectedCost(order, info = {}, step = 1.9) {
  let sum = 0;
  order.forEach((a, i) => { sum += fin(info[a]?.price) * step ** i; });
  return sum;
}

/**
 * The highest-ranked pinned aug that is still unowned, not excluded, not in `skip`, sold by a joined faction other than
 * the gang faction, and not rep-met in any such faction. Used by strict mode (the blocker) and drivesWork (the target).
 * @param {{pinned:string[], exclude?:string[], owned:Set<string>, skip?:Set<string>, gangFaction?:string|null,
 *          sellers:(aug:string)=>Array<{faction:string,rep:number,repReq:number}>}} p  sellers = joined factions selling it
 * @returns {{aug:string,faction:string,gap:number}|null}
 */
export function pinnedBlocker({ pinned, exclude = [], owned, skip = new Set(), gangFaction = null, sellers }) {
  const ex = new Set(exclude);
  for (const a of arr(pinned)) {
    if (owned.has(a) || ex.has(a) || skip.has(a)) continue;
    const src = (sellers(a) || []).filter((x) => x.faction !== gangFaction);
    if (!src.length || src.some((x) => x.rep >= x.repReq)) continue;
    const best = src.reduce((m, x) => (x.repReq - x.rep < m.repReq - m.rep ? x : m));
    return { aug: a, faction: best.faction, gap: best.repReq - best.rep };
  }
  return null;
}

export const emptyStrictState = (reset) => ({ reset, first: {}, timedOut: [] });
/** Parse data/aug-order-state.txt for this install cycle; anything corrupt or from another cycle (`reset` differs) is a fresh state. */
export function parseStrictState(text, reset) {
  let j = null;
  try { j = JSON.parse(text); } catch { /* corrupt: reset */ }
  if (!j || typeof j !== "object" || j.reset !== reset || !j.first || typeof j.first !== "object" || !Array.isArray(j.timedOut)) return emptyStrictState(reset);
  return { reset, first: { ...j.first }, timedOut: j.timedOut.filter((x) => typeof x === "string") };
}
/**
 * Strict-mode decision. Walks blockers until one holds or none is left; a blocker that has waited >= capMin times out
 * (audited once) and the next pinned aug is considered with its own timer. `events` are audit lines, each emitted once per blocker.
 * @returns {{hold:boolean, blocker:object|null, waitedMin:number, state:object, events:Array<{kind:string,data:object}>}}
 */
export function strictDecision(state, ctx, now, capMin) {
  const st = { reset: state.reset, first: { ...state.first }, timedOut: [...state.timedOut] };
  const events = [];
  for (let guard = 0; guard < 1000; guard++) {
    const blocker = pinnedBlocker({ ...ctx, skip: new Set(st.timedOut) });
    if (!blocker) return { hold: false, blocker: null, waitedMin: 0, state: st, events };
    let fresh = false;
    if (!(blocker.aug in st.first)) { st.first[blocker.aug] = now; fresh = true; }
    const waitedMin = Math.max(0, Math.round((now - st.first[blocker.aug]) / 60000));
    if (now - st.first[blocker.aug] < capMin * 60000) {
      if (fresh) events.push({ kind: "strictHold", data: { blocker: blocker.aug, faction: blocker.faction, gap: Math.round(blocker.gap), waitedMin, capMin } });
      return { hold: true, blocker, waitedMin, state: st, events };
    }
    st.timedOut.push(blocker.aug);
    events.push({ kind: "strictTimeout", data: { blocker: blocker.aug, waitedMin } });
  }
  return { hold: false, blocker: null, waitedMin: 0, state: st, events };
}

/** data/aug-catalog.txt content (without `t`) from an sl-plan snapshot: every aug of every known faction. No game calls. */
export function buildCatalog(snap) {
  const owned = new Set(snap.owned || snap.installed || []), installed = new Set(snap.installed || []);
  const where = {};
  for (const [f, fi] of Object.entries(snap.factions || {})) for (const a of fi.augs || []) (where[a] = where[a] || []).push({ f, joined: !!fi.joined });
  const augs = Object.keys(snap.augs || {}).sort().map((name) => {
    const i = snap.augs[name] || {};
    return { name, factions: where[name] || [], repReq: fin(i.repReq), price: fin(i.price), prereqs: [...(i.prereqs || [])], owned: owned.has(name), installed: installed.has(name) };
  });
  return { augs };
}
/** Does the stored catalog text already hold `cat` (ignoring `t`)? Used to skip rewriting an unchanged file. */
export function sameCatalog(text, cat) {
  try { const old = JSON.parse(text); return !!old && JSON.stringify(old.augs) === JSON.stringify(cat.augs); } catch { return false; }
}
