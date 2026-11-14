/**
 * lib/nodectl.js — BitNode destruction state machine. PURE: agent/autopilot.js calls decideNode() every loop and performs
 * the returned side effects (write data/node-request.txt, run agent/sl-destroy.js); agent/sl-plan.js calls it
 * read-only to fill the "node" block of data/aug-plan.txt.
 *
 * Backup handshake (node.backupBeforeDestroy=true, the default):
 *   1. autopilot writes data/node-request.txt {id, action:"destroy", bn, nextBn, at}
 *   2. server/node-control.js runs a save backup and writes data/node-ack.txt {id, backupOk, key, error?, at}
 *   3. autopilot waits node.destroyDelayMin after the ack (veto window), re-reads settings, then runs agent/sl-destroy.js,
 *      which re-checks settings + ack itself before calling destroyW0r1dD43m0n.
 * No ack within ACK_TIMEOUT_MS => stage "blocked", attention NO_ACK (a late ack still unblocks).
 * A failed backup => blocked; a new request (new id) is issued RETRY_MS after the failed ack.
 * node.autoDestroy turned off while a request is open => {action:"cancel"} is written; nothing is destroyed.
 * node.fallback="stop" (default "recommend"): when node.order has no available entry the planner recommendation is NOT used;
 * pickNextBn returns source "order-exhausted" and decideNode flags the owner instead of requesting a destroy.
 */
import { READY_FLAG, ALL_MET, BN_MAX, sfLevels, firstAvailable, recommendNextBn, targetOf } from "lib/augplan.js";

export const REQUEST_FILE = "data/node-request.txt";
export const ACK_FILE = "data/node-ack.txt";
export const DESTROY_SCRIPT = "agent/sl-destroy.js";
export const ACK_TIMEOUT_MS = 15 * 60_000;
export const RETRY_MS = 15 * 60_000;
export const NO_ACK = "destroy blocked: no backup ack";
export const NO_RAM = "destroy blocked: not enough free home RAM for agent/sl-destroy.js";
export const ORDER_EXHAUSTED = "node.order exhausted"; // prefix of the owner-decision flag; server/checkin.js OWNER_DECISION matches it
/** Stable text (it only changes when Source-Files change), so the flag dedupes like READY_FLAG. */
export const orderExhaustedFlag = (rec) => `${ORDER_EXHAUSTED} (node.fallback=stop) — owner picks the next BitNode; ` +
  (rec && rec.bn != null ? `recommended BN${rec.bn}: ${rec.why}` : ALL_MET);
export const ORDER_LOW = "node.order running low"; // prefix of the early-warning flag; server/checkin.js OWNER_DECISION and lib/kpi.js OWNER_FLAG match it
export const ORDER_LOW_AT = 2;                     // warn when this many destroys or fewer are left in node.order
/** Nothing is below its node.targets level any more (owner decision; also a stable text). docs/specs/node-targets.md */
export const ALL_MET_FLAG = `${ALL_MET} — nothing left to select; owner raises node.targets (for example {"12":5}) or stops here`;

export const parseJson = (raw) => { try { const v = JSON.parse(raw || "null"); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; } };
const fin = (n) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/**
 * Next BitNode. node.autoSelect=true: first available entry of node.order, else the planner recommendation.
 * node.autoSelect=false: null (recommend only; the owner decides).
 * Nothing left in node.order (or it is empty): node.fallback "recommend" (default) takes the planner recommendation;
 * "stop" returns nextBn null with source "order-exhausted" and the recommendation is still reported.
 */
export function pickNextBn({ bn, sourceFiles }, s) {
  const recommended = recommendNextBn({ bn, sourceFiles }, s);
  if (!s["node.autoSelect"]) return { nextBn: null, recommended, source: "manual" };
  const fromOrder = firstAvailable(s["node.order"] || [], sfLevels(sourceFiles, bn), s["node.targets"]);
  if (fromOrder != null) return { nextBn: fromOrder, recommended, source: "node.order" };
  if (s["node.fallback"] === "stop") return { nextBn: null, recommended, source: "order-exhausted" };
  return { nextBn: recommended.bn, recommended, source: "recommendation" };
}

/**
 * What node.order still has to give. Levels are counted after the destroy in progress (sfLevels), so the current BitNode's own level-up
 * is not "left". PURE.
 * @returns {{remaining:number, left:Array<{bn:number,levels:number}>, next:{bn:number|null, why:string}}}
 *   left = entries of node.order still below their node.targets level (first occurrence only); next = the planner recommendation
 *   once every order entry has reached its target (what takes over, or stops, when the order runs out).
 */
export function orderOutlook({ bn, sourceFiles }, s) {
  const targets = s["node.targets"], lv = sfLevels(sourceFiles, bn), after = { ...lv }, seen = new Set(), left = [];
  for (const n of s["node.order"] || []) {
    if (!Number.isInteger(n) || n < 1 || n > BN_MAX || seen.has(n)) continue;
    seen.add(n);
    const t = targetOf(n, targets), k = Math.max(0, t - (lv[n] || 0));
    if (k > 0) left.push({ bn: n, levels: k });
    after[n] = Math.max(lv[n] || 0, t);
  }
  const next = recommendNextBn({ bn: 0, sourceFiles: Object.entries(after).map(([n, lvl]) => ({ n: Number(n), lvl })) }, s);
  return { remaining: left.reduce((a, x) => a + x.levels, 0), left, next };
}

/**
 * Early warning (docs/specs/node-targets.md): attention text when node.autoSelect is on and node.order has ORDER_LOW_AT destroys or
 * fewer left; null otherwise. An empty node.order with node.fallback=recommend means "use the planner" and never warns; with
 * node.fallback=stop an empty order is already exhausted and warns. The text depends only on Source-File levels and settings, so
 * it is stable across loops and dedupes like READY_FLAG. PURE.
 */
export function orderWarning(st, s) {
  if (!s["node.autoSelect"]) return null;
  const order = s["node.order"] || [], stop = s["node.fallback"] === "stop";
  if (!order.length && !stop) return null;
  const o = orderOutlook(st, s);
  if (o.remaining > ORDER_LOW_AT) return null;
  const left = !order.length ? "empty" : `${o.remaining} left: ${o.left.length ? o.left.map((x) => `BN${x.bn} x${x.levels}`).join(", ") : "none"}`;
  const rec = o.next.bn != null ? o.next.why : ALL_MET; // why already starts with "BN<n>: "
  return `${ORDER_LOW} (${left}) — ` + (stop
    ? `node.fallback=stop will then stop and flag the owner; ${o.next.bn != null ? `the planner would recommend ${rec}` : rec}`
    : `then the planner's recommendation takes over: ${o.next.bn != null ? rec : `${ALL_MET}, nothing left to select`}`);
}

/** The ack for this request (successful or not), never one older than the request. */
export const ackFor = (req, ack) => (req && ack && ack.id === req.id && fin(ack.at) >= fin(req.at) ? ack : null);

/**
 * @param {{ready:boolean, bn:number, sourceFiles:Array, now:number, request:Object|null, ack:Object|null}} st
 * @param {Object} s  flat settings (lib/settings.js)
 * @returns {{action:"none"|"flag"|"request"|"cancel"|"wait"|"destroy", nextBn:number|null, writeRequest:Object|null,
 *            attention:string[], node:Object}}   node = the data/aug-plan.txt "node" block
 */
export function decideNode(st, s) {
  const now = fin(st.now);
  const pick = pickNextBn(st, s);
  const base = { ready: !!st.ready, autoSelect: !!s["node.autoSelect"], autoDestroy: !!s["node.autoDestroy"], recommended: pick.recommended };
  // Nothing below its node.targets level: an explicit state of its own (never "autoSelect off"). Only then does the node block get a source key,
  // as for order-exhausted, so the default node block is unchanged.
  const allMet = pick.recommended.bn == null;
  if (allMet) base.source = "all-targets-met"; else if (pick.source === "order-exhausted") base.source = pick.source;
  const metFlags = allMet ? [ALL_MET_FLAG] : [];
  const openReq = st.request && st.request.action === "destroy" && st.request.bn === st.bn ? st.request : null;
  const res = (action, stage, detail, x = {}) => ({
    action, nextBn: x.nextBn ?? null, writeRequest: x.writeRequest ?? null, attention: x.attention ?? [],
    node: { ...base, pending: { id: x.id ?? openReq?.id ?? "", stage, detail } },
  });
  const cancel = (why) => res("cancel", "none", why, { id: "", writeRequest: { id: openReq.id, action: "cancel", bn: st.bn, nextBn: openReq.nextBn, at: now }, attention: st.ready ? [READY_FLAG, ...metFlags] : [] });

  if (!st.ready) return openReq ? cancel("w0r1d_d43m0n no longer ready: request cancelled") : res("none", "none", "w0r1d_d43m0n not ready", { id: "" });
  const rec = allMet ? ALL_MET : `recommended BN${pick.recommended.bn}`;
  if (!s["node.autoDestroy"]) return openReq ? cancel("node.autoDestroy turned off: request cancelled") : res("flag", "none", `waiting for the owner (node.autoDestroy off); ${rec}`, { attention: [READY_FLAG, ...metFlags], id: "" });
  if (pick.source === "order-exhausted") {
    // every target met: that flag says it all (no second "order exhausted" flag next to it)
    const flag = allMet ? ALL_MET_FLAG : orderExhaustedFlag(pick.recommended), why = (s["node.order"] || []).length ? "node.order exhausted" : "node.order is empty";
    if (openReq) return res("cancel", "none", `${why} (node.fallback=stop): request cancelled`, { id: "", writeRequest: { id: openReq.id, action: "cancel", bn: st.bn, nextBn: openReq.nextBn, at: now }, attention: [READY_FLAG, flag] });
    return res("flag", "none", `${why} (node.fallback=stop): not choosing outside it; choose the next BitNode (${rec})`, { attention: [READY_FLAG, flag], id: "" });
  }
  if (pick.nextBn == null) {
    // nothing to select: either every target is met (say so, and flag it) or node.autoSelect is really off
    return openReq ? cancel(allMet ? `${ALL_MET}: request cancelled` : "node.autoSelect turned off: request cancelled")
      : res("flag", "none", allMet ? `node.autoDestroy on but ${ALL_MET}: no BitNode left to select` : `node.autoDestroy on but node.autoSelect off: choose the next BitNode (${rec})`, { attention: [READY_FLAG, ...metFlags], id: "" });
  }
  const nextBn = pick.nextBn;
  const delayMs = Math.max(0, fin(s["node.destroyDelayMin"] ?? 10)) * 60_000;
  const newReq = (why) => {
    const writeRequest = { id: `destroy-bn${st.bn}-to-${nextBn}-${now}`, action: "destroy", bn: st.bn, nextBn, at: now };
    return res("request", "requested", why || `backup requested before destroying -> BN${nextBn}`, { nextBn, writeRequest, id: writeRequest.id });
  };
  if (!s["node.backupBeforeDestroy"]) {
    // still writes a request (no ack needed) so the veto window has a start time
    if (!openReq || openReq.nextBn !== nextBn) return newReq(`destroy -> BN${nextBn} scheduled (no backup: node.backupBeforeDestroy off)`);
    const at = fin(openReq.at) + delayMs;
    if (now < at) return res("wait", "requested", `destroying -> BN${nextBn} at ${iso(at)} (veto: set node.autoDestroy=false)`, { nextBn });
    return res("destroy", "destroying", `destroying -> BN${nextBn} (no backup)`, { nextBn });
  }
  if (!openReq || openReq.nextBn !== nextBn) return newReq();
  const a = ackFor(openReq, st.ack);
  if (a && a.backupOk) {
    const at = fin(a.at) + delayMs;
    if (now < at) return res("wait", "acked", `backup ${a.key || "ok"}; destroying -> BN${nextBn} at ${iso(at)} (veto: set node.autoDestroy=false)`, { nextBn });
    return res("destroy", "destroying", `backup ${a.key || "ok"}; destroying -> BN${nextBn}`, { nextBn });
  }
  if (a && !a.backupOk) {
    if (now - fin(a.at) >= RETRY_MS) return newReq(`retrying backup (previous failed: ${a.error || "unknown"})`);
    return res("wait", "blocked", `backup failed: ${a.error || "unknown"}; retry at ${iso(fin(a.at) + RETRY_MS)}`, { nextBn, attention: [READY_FLAG, `destroy blocked: backup failed (${String(a.error || "unknown").slice(0, 80)})`] });
  }
  if (now - fin(openReq.at) >= ACK_TIMEOUT_MS) return res("wait", "blocked", "no backup ack from the bb server (is server/node-control running?)", { nextBn, attention: [READY_FLAG, NO_ACK] });
  return res("wait", "requested", `waiting for backup ack (${Math.round((now - fin(openReq.at)) / 1000)}s)`, { nextBn });
}

/**
 * Final gate inside agent/sl-destroy.js (re-checked right before destroyW0r1dD43m0n).
 * @returns {string|null} reason to abort, or null to proceed
 */
export function destroyGate({ id, nextBn, bn, request, ack, ready }, s) {
  if (!ready) return "w0r1d_d43m0n not ready";
  if (!s["node.autoDestroy"]) return "node.autoDestroy is off";
  if (!request || request.action !== "destroy" || request.id !== id || request.nextBn !== nextBn || request.bn !== bn) return "request does not match";
  if (s["node.backupBeforeDestroy"]) { const a = ackFor(request, ack); if (!a || !a.backupOk) return "no successful backup ack"; }
  return null;
}

function iso(ms) { try { return new Date(ms).toISOString(); } catch { return String(ms); } }
