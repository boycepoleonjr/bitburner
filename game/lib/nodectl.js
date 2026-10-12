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
 */
import { READY_FLAG, sfLevels, firstAvailable, recommendNextBn } from "lib/augplan.js";

export const REQUEST_FILE = "data/node-request.txt";
export const ACK_FILE = "data/node-ack.txt";
export const DESTROY_SCRIPT = "agent/sl-destroy.js";
export const ACK_TIMEOUT_MS = 15 * 60_000;
export const RETRY_MS = 15 * 60_000;
export const NO_ACK = "destroy blocked: no backup ack";
export const NO_RAM = "destroy blocked: not enough free home RAM for agent/sl-destroy.js";

export const parseJson = (raw) => { try { const v = JSON.parse(raw || "null"); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; } };
const fin = (n) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/**
 * Next BitNode. node.autoSelect=true: first available entry of node.order, else the planner recommendation.
 * node.autoSelect=false: null (recommend only; the owner decides).
 */
export function pickNextBn({ bn, sourceFiles }, s) {
  const recommended = recommendNextBn({ bn, sourceFiles }, s);
  if (!s["node.autoSelect"]) return { nextBn: null, recommended, source: "manual" };
  const fromOrder = firstAvailable(s["node.order"] || [], sfLevels(sourceFiles, bn));
  if (fromOrder != null) return { nextBn: fromOrder, recommended, source: "node.order" };
  return { nextBn: recommended.bn, recommended, source: "recommendation" };
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
  const openReq = st.request && st.request.action === "destroy" && st.request.bn === st.bn ? st.request : null;
  const res = (action, stage, detail, x = {}) => ({
    action, nextBn: x.nextBn ?? null, writeRequest: x.writeRequest ?? null, attention: x.attention ?? [],
    node: { ...base, pending: { id: x.id ?? openReq?.id ?? "", stage, detail } },
  });
  const cancel = (why) => res("cancel", "none", why, { id: "", writeRequest: { id: openReq.id, action: "cancel", bn: st.bn, nextBn: openReq.nextBn, at: now }, attention: st.ready ? [READY_FLAG] : [] });

  if (!st.ready) return openReq ? cancel("w0r1d_d43m0n no longer ready: request cancelled") : res("none", "none", "w0r1d_d43m0n not ready", { id: "" });
  const rec = `recommended BN${pick.recommended.bn ?? "?"}`;
  if (!s["node.autoDestroy"]) return openReq ? cancel("node.autoDestroy turned off: request cancelled") : res("flag", "none", `waiting for the owner (node.autoDestroy off); ${rec}`, { attention: [READY_FLAG], id: "" });
  if (pick.nextBn == null) return openReq ? cancel("node.autoSelect turned off: request cancelled") : res("flag", "none", `node.autoDestroy on but node.autoSelect off: choose the next BitNode (${rec})`, { attention: [READY_FLAG], id: "" });
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
