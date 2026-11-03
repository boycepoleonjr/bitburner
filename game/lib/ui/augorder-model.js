/**
 * lib/ui/augorder-model.js — the Augmentations → Order tab's draft logic. PURE (no React, no ns).
 * A draft is the six order settings as plain values: {sort, pinned, last, exclude, strict, strictMaxWaitMin, drivesWork}.
 * Every transition returns a new draft (or the same one plus an error string), so the view can keep it in component state.
 */
import { orderAugs, projectedCost, SORTS, DEFAULT_STRICT_WAIT_MIN, ORDER_KEYS } from "../augorder.js";
import { defaults } from "../settings-schema.js";

export const RED_PILL = "The Red Pill";
export const NFG = "NeuroFlux Governor";
const PRICE_STEP = 1.9;
const arr = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string") : []);
const without = (list, name) => list.filter((x) => x !== name);

/** Draft from the effective settings values (flat keys). */
export function draftFromSettings(values = {}) {
  return {
    sort: SORTS.includes(values["augs.order.sort"]) ? values["augs.order.sort"] : "rep",
    pinned: arr(values["augs.order.pinned"]), last: arr(values["augs.order.last"]), exclude: arr(values["augs.order.exclude"]),
    strict: values["augs.order.strict"] === true,
    strictMaxWaitMin: Number.isFinite(values["augs.order.strictMaxWaitMin"]) ? values["augs.order.strictMaxWaitMin"] : DEFAULT_STRICT_WAIT_MIN,
    drivesWork: values["augs.order.drivesWork"] === true,
  };
}
const KEY_OF = { sort: "augs.order.sort", pinned: "augs.order.pinned", last: "augs.order.last", exclude: "augs.order.exclude", strict: "augs.order.strict", strictMaxWaitMin: "augs.order.strictMaxWaitMin", drivesWork: "augs.order.drivesWork" };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Setting keys whose draft value differs from the current effective value. */
export function changedKeys(draft, values) {
  const cur = draftFromSettings(values);
  return Object.keys(KEY_OF).filter((k) => !same(draft[k], cur[k])).map((k) => KEY_OF[k]);
}
/** Patch for writeSettings: values equal to the schema default are unset, so "no overrides" stays literally no overrides. */
export function toPatch(draft) {
  const d = defaults(), set = {}, unset = [];
  for (const [field, key] of Object.entries(KEY_OF)) { if (same(draft[field], d[key])) unset.push(key); else set[key] = draft[field]; }
  return { set, unset };
}
export { ORDER_KEYS };

// ── transitions ─────────────────────────────────────────────────────────────
const out = (draft, error = null) => ({ draft, error });
export function setField(draft, field, value) { return { ...draft, [field]: value }; }
/** Pin at the end of the pinned list (leaves last/exclude: exclude > pinned would hide the pin, so exclusion is cleared). */
export function pin(draft, name) {
  if (name === NFG || name.startsWith("NeuroFlux")) return out(draft, "NeuroFlux is always last; not orderable");
  return out({ ...draft, pinned: [...without(draft.pinned, name), name], last: without(draft.last, name), exclude: without(draft.exclude, name) });
}
export function toTop(draft, name) {
  const r = pin(draft, name);
  return r.error ? r : out({ ...r.draft, pinned: [name, ...without(r.draft.pinned, name)] });
}
export function unpin(draft, name) { return out({ ...draft, pinned: without(draft.pinned, name) }); }
export function sendLast(draft, name) {
  if (name.startsWith("NeuroFlux")) return out(draft, "NeuroFlux is always last; not orderable");
  return out({ ...draft, last: [...without(draft.last, name), name], pinned: without(draft.pinned, name), exclude: without(draft.exclude, name) });
}
export function unlast(draft, name) { return out({ ...draft, last: without(draft.last, name) }); }
export function exclude(draft, name) {
  if (name === RED_PILL) return out(draft, "The Red Pill cannot be excluded");
  if (name.startsWith("NeuroFlux")) return out(draft, "NeuroFlux is always last; not orderable");
  return out({ ...draft, exclude: [...without(draft.exclude, name), name], pinned: without(draft.pinned, name), last: without(draft.last, name) });
}
export function include(draft, name) { return out({ ...draft, exclude: without(draft.exclude, name) }); }
/** Remove a name from every list (used for names that are not in the catalog). */
export function drop(draft, name) { return out({ ...draft, pinned: without(draft.pinned, name), last: without(draft.last, name), exclude: without(draft.exclude, name) }); }
/** Move within the pinned or last list by `delta` (-1 up, +1 down). No-op at the ends or when the aug is in neither list. */
export function move(draft, name, delta) {
  for (const field of ["pinned", "last"]) {
    const i = draft[field].indexOf(name), j = i + delta;
    if (i < 0) continue;
    if (j < 0 || j >= draft[field].length) return out(draft);
    const l = [...draft[field]]; [l[i], l[j]] = [l[j], l[i]];
    return out({ ...draft, [field]: l });
  }
  return out(draft);
}
export const canExclude = (name) => name !== RED_PILL && !name.startsWith("NeuroFlux");

// ── rows + preview ──────────────────────────────────────────────────────────
const infoOf = (catalog) => Object.fromEntries((catalog?.augs || []).map((a) => [a.name, a]));
/**
 * Table rows for the Order tab: effective order of the unowned augs (rank 1..n), then blocked, excluded, unknown names, and
 * (optionally) owned augs. Names starting with NeuroFlux are never orderable and are left out.
 * @returns {{rows:Array, warnings:string[], order:string[]}}
 */
export function orderRows(catalog, draft, { showOwned = false } = {}) {
  const info = infoOf(catalog), all = (catalog?.augs || []).filter((a) => !a.name.startsWith("NeuroFlux"));
  const have = new Set(all.filter((a) => a.owned).map((a) => a.name));
  const names = all.filter((a) => !a.owned).map((a) => a.name);
  const r = orderAugs(names, draft, info, have, { tie: "name" });
  const row = (name, extra) => {
    const a = info[name];
    return { name, rank: null, tag: "unknown", factions: a ? a.factions.map((f) => f.f + (f.joined ? "" : "?")).join(", ") : "", repReq: a?.repReq ?? null, price: a?.price ?? null, prereqs: a?.prereqs || [], ...extra };
  };
  const rows = r.order.map((name, i) => row(name, { rank: i + 1, tag: r.tags[name] || "auto" }));
  for (const b of r.blocked) rows.push(row(b.aug, { tag: "blocked", note: `prerequisite ${b.by} excluded` }));
  for (const name of r.excluded) rows.push(row(name, { tag: "excluded" }));
  const listed = new Set([...r.order, ...r.excluded, ...r.blocked.map((b) => b.aug)]);
  for (const name of [...draft.pinned, ...draft.last, ...draft.exclude]) if (!listed.has(name) && !rows.some((x) => x.name === name)) {
    const a = info[name];
    rows.push(row(name, { tag: a?.owned ? "owned" : a ? "excluded" : "unknown", note: a ? (a.owned ? "already owned" : "") : "not in the catalog" }));
  }
  if (showOwned) for (const a of all) if (a.owned && !rows.some((x) => x.name === a.name)) rows.push(row(a.name, { tag: "owned", note: a.installed ? "installed" : "queued" }));
  return { rows, warnings: r.warnings, order: r.order };
}
/** Batch cost of `names` (the currently buyable set) in the draft order vs the current order vs the default order. */
export function batchCosts(catalog, names, draft, current, step = PRICE_STEP) {
  const info = infoOf(catalog), have = new Set((catalog?.augs || []).filter((a) => a.owned).map((a) => a.name));
  const cost = (cfg) => projectedCost(orderAugs(names, cfg, info, have, { tie: "name" }).order, info, step);
  return { draft: cost(draft), current: cost(current), default: cost({ sort: "rep", pinned: [], last: [], exclude: [] }) };
}
/** Warnings that need more than the order itself: Daedalus aug count. Only when The Red Pill comes from Daedalus. */
export function daedalusWarning(catalog, draft, plan) {
  if (!plan || !plan.daedalus || !(draft.exclude || []).length) return null;
  const rp = (plan.steps || []).find((s) => s.aug === RED_PILL);
  if (rp && rp.faction && rp.faction !== "Daedalus") return null;
  const need = Math.max(0, (plan.daedalus.augsReq || 0) - (plan.daedalus.augsInstalled || 0) - (plan.install?.queued || 0));
  const ex = new Set(draft.exclude);
  const left = (catalog?.augs || []).filter((a) => !a.owned && !a.name.startsWith("NeuroFlux") && a.name !== RED_PILL && !ex.has(a.name) && a.factions.length).length;
  return left < need ? `excluding ${draft.exclude.length} aug${draft.exclude.length === 1 ? "" : "s"} leaves fewer obtainable augs (${left}) than Daedalus requires (${need} more)` : null;
}
