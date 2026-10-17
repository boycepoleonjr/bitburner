// Scheduled, cached check-in. Runs checkin-lib's __checkin() in the page on its own ETA-driven cadence, persists
// each result, posts it to Discord, and wakes Claude (routine API trigger) only for new or long-open attention.
// Owner-decision items (w0r1d READY) are held back until they have been open for readyEscalateMs: with node.autoDestroy
// on a destroy finishes in ~30 min, so READY that lingers means a stuck destroy or an owner who hasn't decided.
import { createHash } from "node:crypto";
import { buildEscalationText, sanitize } from "./notify.js";

export const ESCALATION_INTERVAL_MS = 120 * 60 * 1000;
export const READY_ESCALATE_MS = 120 * 60 * 1000; // default for BB_READY_ESCALATE_MIN; 0 = never escalate READY
export const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
export const RETRY_MS = 5 * 60 * 1000;
export const ORDERING_HEAD_START_MS = 500;
export const CHECKIN_TIMEOUT_MS = 300000;
export const CHECKIN_JS = "eval(bb.read('agent/checkin-lib.txt')); const r = await __checkin(); return {attention:r.attention, warn:r.warn, nextMin:r.nextMin, report:r.report, did:r.did};";

const LATEST = "checkin-latest.json", ESC = "checkin-escalation.json";
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const cadenceMs = (r) => clamp(Number(r?.nextMin) || 60, 5, 120) * 60 * 1000;

export function normalizeAttention(a) {
  return [...new Set((Array.isArray(a) ? a : []).map((x) => String(x).replace(/\s+/g, " ").trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y));
}
// Attention the owner decides on (destroying a BitNode): shown in Discord, escalated only once overdue (readyEscalateMs).
export const OWNER_DECISION = [/w0r1d_d43m0n READY/i];
export const escalatable = (a) => normalizeAttention(a).filter((x) => !OWNER_DECISION.some((re) => re.test(x)));
export const attentionKey = (a) => createHash("sha256").update(JSON.stringify(normalizeAttention(a))).digest("hex");

export function makeRecord(atMs, raw) {
  const base = { t: new Date(atMs).toISOString(), atMs };
  if (!raw || typeof raw.report !== "string" || !Array.isArray(raw.attention))
    return { ...base, ok: false, report: "", attention: [], warn: [], nextMin: 5, did: [], error: "check-in returned an invalid result" };
  const w = typeof raw.warn === "string" ? raw.warn.trim() : Array.isArray(raw.warn) ? raw.warn.map(String).join("; ").trim() : "";
  const n = Number(raw.nextMin);
  return {
    ...base, ok: true, report: raw.report, attention: normalizeAttention(raw.attention), warn: w ? [w] : [],
    nextMin: Number.isFinite(n) && n > 0 ? n : 60,
    did: Array.isArray(raw.did) ? raw.did.map(String).map((s) => s.trim()).filter(Boolean) : [], error: null,
  };
}
export const failRecord = (atMs, msg) => ({ t: new Date(atMs).toISOString(), atMs, ok: false, report: "", attention: [], warn: [], nextMin: 5, did: [], error: sanitize(msg) });

export function createCheckin({
  rpc, isUp, log = () => {}, notify = async () => {}, escalate = async () => ({ ok: false }), escalationEnabled = false,
  state, auto = false, nowMs = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  orderingMs = ORDERING_HEAD_START_MS, readyEscalateMs = READY_ESCALATE_MS, driftCheck = null,
}) {
  let latest, latestLoaded = false, inflight = null, timer = null, timerDueAt = null, connectedOnce = false;
  let escState = null, escChain = Promise.resolve();
  const pending = new Set(); // detached dispatch work, exposed for tests/shutdown
  const track = (p) => { pending.add(p); p.finally(() => pending.delete(p)); return p; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // real clock: bounds the Discord head start

  const clearScheduledRun = () => { if (timer) clearTimer(timer); timer = null; timerDueAt = null; };
  const scheduleRun = (ms) => {
    clearScheduledRun();
    const delay = Math.max(1, ms); // never a zero-delay run
    timerDueAt = nowMs() + delay;
    timer = setTimer(onTimer, delay);
  };
  const scheduleNext = (rec) => scheduleRun(rec.ok ? cadenceMs(rec) : RETRY_MS);

  async function onTimer() {
    timer = null; timerDueAt = null;
    if (!(auto && isUp())) { if (auto) scheduleRun(RETRY_MS); return; } // silent retry: no record, notify or escalation
    try {
      const rec = await run({ manual: false });
      if (!timer && auto && isUp()) scheduleNext(rec); // joined a manual run that didn't schedule
    } catch (e) { log("checkin: " + sanitize(e)); if (!timer && auto) scheduleRun(RETRY_MS); }
  }

  async function loadEsc() {
    if (escState) return escState;
    const v = await state.readJson(ESC, null, { versioned: true });
    escState = { version: 1, attentionKey: null, firstSeenAt: null, lastEscalatedAt: null, lastResolvedAt: null, ownerSince: null, ...(v && typeof v === "object" ? v : {}), version: 1 };
    return escState;
  }

  // Persist lastEscalatedAt, then fire, then (inside escalate) post the session link. Serialized.
  function maybeEscalate(rec) {
    const job = escChain.then(async () => {
      if (!rec.ok) return;
      const esc = await loadEsc(), now = nowMs();
      // ownerSince: when the owner-decision items (READY) were first seen in this unbroken stretch of check-ins
      const held = rec.attention.filter((x) => OWNER_DECISION.some((re) => re.test(x)));
      const ownerSince = held.length ? (esc.ownerSince ?? now) : null;
      const ownerChanged = ownerSince !== esc.ownerSince;
      esc.ownerSince = ownerSince;
      const overdue = held.length > 0 && readyEscalateMs > 0 && now - ownerSince >= readyEscalateMs;
      const attention = normalizeAttention([...escalatable(rec.attention), ...(overdue ? held : [])]);
      if (!attention.length) {
        if (esc.attentionKey) Object.assign(esc, { attentionKey: null, firstSeenAt: null, lastResolvedAt: now });
        else if (!ownerChanged) return;
        await state.writeJsonAtomic(ESC, esc);
        return;
      }
      const key = attentionKey(attention);
      if (key !== esc.attentionKey) Object.assign(esc, { attentionKey: key, firstSeenAt: now, lastEscalatedAt: null });
      else if (esc.lastEscalatedAt != null && now - esc.lastEscalatedAt < ESCALATION_INTERVAL_MS) {
        if (ownerChanged) await state.writeJsonAtomic(ESC, esc);
        return;
      }
      if (!escalationEnabled) { await state.writeJsonAtomic(ESC, esc); return; }
      esc.lastEscalatedAt = now;
      await state.writeJsonAtomic(ESC, esc);
      // The report's status line still lists every flag, so say which ones are the owner's (or why READY is now ours).
      const h = Math.round(((now - (ownerSince ?? now)) / 3600000) * 10) / 10;
      const note = overdue
        ? `(w0r1d_d43m0n READY for ${h}h, past the ${Math.round(readyEscalateMs / 60000)}-min limit. node.autoDestroy on: the destroy is stuck; ` +
          "check node.pending in data/aug-plan.txt, data/node-request.txt + node-ack.txt and server/node-control. node.autoDestroy off: " +
          "remind the owner (veto/enable via bb settings). Never destroy any other way than node.autoDestroy.)"
        : held.length ? `(Owner decision, not for the agent: ${held.join("; ")})` : "";
      const report = note ? `${note}\n\n${rec.report}` : rec.report;
      await escalate(buildEscalationText({ ...rec, attention, report }));
    });
    escChain = job.catch(() => {});
    return job;
  }

  function dispatch(rec) {
    track((async () => {
      const reportPost = Promise.resolve().then(() => notify(rec)).catch((e) => log("check-in Discord notification failed: " + sanitize(e)));
      track(reportPost);
      await Promise.race([reportPost, sleep(orderingMs)]);
      track(Promise.resolve().then(() => maybeEscalate(rec)).catch((e) => log("check-in escalation failed: " + sanitize(e))));
    })());
  }

  async function persist(rec) {
    latest = rec; latestLoaded = true;
    try { await state.writeJsonAtomic(LATEST, rec); await state.appendHistory(rec); }
    catch (e) { log("checkin persist failed: " + sanitize(e)); }
  }

  function run({ manual = true } = {}) {
    if (inflight) return inflight;
    inflight = (async () => {
      let rec;
      if (!isUp()) rec = failRecord(nowMs(), "game/rpc not connected");
      else {
        try {
          const r = await rpc("js", { code: CHECKIN_JS }, CHECKIN_TIMEOUT_MS);
          if (r && r.ok) rec = makeRecord(nowMs(), r.value);
          else { log("checkin failed: " + sanitize(r?.error || "unknown", 500)); rec = failRecord(nowMs(), r?.error || "check-in failed"); }
        } catch (e) { log("checkin failed: " + sanitize(e, 500)); rec = failRecord(nowMs(), e); }
        // repo -> game drift (server/drift.js): an unpushed merge becomes attention, so it is escalated like any other
        if (rec.ok && driftCheck) {
          try { const d = await driftCheck(); if (d) rec.attention = normalizeAttention([...rec.attention, d]); }
          catch (e) { log("drift check failed: " + sanitize(e, 300)); }
        }
      }
      await persist(rec);
      if (!manual && auto && isUp()) scheduleNext(rec);
      dispatch(rec);
      return rec;
    })().finally(() => { inflight = null; });
    return inflight;
  }

  async function getLatest() {
    if (!latestLoaded) {
      const v = await state.readJson(LATEST, null);
      latest = v && typeof v === "object" && Number.isFinite(v.atMs) ? v : null;
      latestLoaded = true;
    }
    return latest || null;
  }

  return {
    run, getLatest,
    async getReport() {
      const l = await getLatest();
      const ageMin = l ? Math.round(((nowMs() - l.atMs) / 60000) * 10) / 10 : null;
      return { latest: l, ageMin, stale: !l || !l.ok || ageMin > (Number(l.nextMin) || 5) + 10 };
    },
    async onRpcUp() {
      clearScheduledRun();
      if (!auto) return;
      const first = !connectedOnce;
      connectedOnce = true;
      const l = await getLatest();
      if (timer) return; // a run or another connect event scheduled meanwhile
      const fresh = Boolean(l?.ok && Number.isFinite(l.atMs) && nowMs() <= l.atMs + cadenceMs(l) + 10 * 60 * 1000);
      if (first || !fresh) return scheduleRun(FIRST_RUN_DELAY_MS);
      const remaining = l.atMs + cadenceMs(l) - nowMs();
      scheduleRun(remaining > 0 ? remaining : FIRST_RUN_DELAY_MS);
    },
    onRpcDown() { clearScheduledRun(); },
    stop() { clearScheduledRun(); },
    // test/introspection helpers
    _timerDueAt: () => timerDueAt,
    _hasTimer: () => !!timer,
    _settle: async () => { while (pending.size) await Promise.allSettled([...pending]); await escChain; },
  };
}
