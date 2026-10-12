/**
 * lib/ui/controller.js — the dashboard's data loop and actions. No React, no DOM: testable with a fake ns.
 *
 * Read budget per tick (hot path): telemetry-latest, telemetry-ring, ram-status, aug-plan, autopilot-status, settings.
 * Slow path (every ui.slowRefreshMs, or on "Refresh now"): pred2 tail always (destroy ETA); log tails only while Logs is
 * open; settings-log only while Settings/Node is open; the Raw file only while Raw is open. data/telemetry.txt: never.
 * Every parse is memoized by file content, so unchanged files produce the same objects and the store notifies nobody.
 * Only sync ns calls (read/write via lib/settings.js) are made from UI event handlers, and only while `alive`.
 */
import { HOT_FILES, SLOW_FILES, BIG_FILE_BYTES, clampMs, tailLines, parseJson, parseJsonl, parseLogLine, createMemo } from "../data-sources.js";
import { computeKpis } from "../kpi.js";
import { readSettings, writeSettings } from "lib/settings.js";

export const TAIL_LINES_DEFAULT = 200;

export function createController(ns, store, { now = () => Date.now(), clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) } = {}) {
  const memo = createMemo();
  const st = { alive: true, lastSlow: -Infinity, forceSlow: true, wake: false, reads: 0, rawKey: null, sizes: {} };
  const rd = (f) => { st.reads++; return ns.read(f); };
  const ui = () => store.get("ui");

  function settingsSlice() {
    const s = readSettings(ns);
    return memo("settingsSlice", s, () => ({ values: { ...s }, overrides: s._overrides || {}, rev: s._rev || 0, warnings: s._warnings || [] }));
  }

  function readRaw(file) {
    const text = rd(file) || "";
    st.sizes = { ...st.sizes, [file]: text.length };
    if (!text) return { file, missing: true, t: now(), sizes: st.sizes };
    const lines = Math.max(1, Number(readSettings(ns)["ui.tailLines"]) || TAIL_LINES_DEFAULT);
    if (text.length < BIG_FILE_BYTES) {
      const j = parseJson(text);
      if (j !== null) return { file, value: j, t: now(), sizes: st.sizes };
    }
    const tail = tailLines(text, lines);
    const { rows, bad } = parseJsonl(tail);
    const truncated = text.length >= BIG_FILE_BYTES || tail.length >= lines;
    if (rows.length && rows.length >= tail.length / 2) return { file, value: rows, bad, truncated, lines: tail.length, t: now(), sizes: st.sizes };
    return { file, text: tail.join("\n"), truncated, lines: tail.length, t: now(), sizes: st.sizes };
  }

  /** One refresh. Returns the slices that changed. */
  function tick() {
    if (!st.alive) return [];
    const t0 = clock(), tNow = now();
    const s = readSettings(ns);
    const nLines = Math.max(1, Number(s["ui.tailLines"]) || TAIL_LINES_DEFAULT);
    const hot = {};
    for (const [k, f] of Object.entries(HOT_FILES)) {
      const text = rd(f);
      hot[k] = k === "ring" ? memo(k, text, (x) => parseJsonl(x).rows) : memo(k, text, parseJson);
    }
    const patch = { latest: hot.latest, ring: hot.ring, ramStatus: hot.ramStatus, augPlan: hot.augPlan, autopilot: hot.autopilot, settings: settingsSlice() };

    const view = ui().view;
    const slowDue = st.forceSlow || tNow - st.lastSlow >= clampMs(s["ui.slowRefreshMs"], 30000);
    if (slowDue) {
      st.lastSlow = tNow;
      st.forceSlow = false;
      const p2 = rd(SLOW_FILES.pred2);
      patch.pred = memo("pred", p2, (x) => parseJsonl(tailLines(x, nLines)).rows.filter((r) => r && (r.spec || r.type)).map((r, i) => ({ ...r, id: r.id ?? `p${i}` })));
      if (view === "logs") {
        const logs = {};
        for (const k of ["agent", "events", "audit", "install"]) logs[k] = memo(`log:${k}`, rd(SLOW_FILES[k]), (x) => tailLines(x, nLines).map(parseLogLine));
        patch.logs = logs;
      }
      if (view === "settings" || view === "node") patch.settingsLog = memo("settingsLog", rd(SLOW_FILES.settingsLog), (x) => parseJsonl(tailLines(x, nLines)).rows);
    }
    const rawFile = ui().rawFile;
    if (view === "raw" && rawFile && (slowDue || st.rawKey !== rawFile)) { st.rawKey = rawFile; patch.raw = readRaw(rawFile); }

    patch.kpis = computeKpis({ latest: hot.latest, ring: hot.ring, ramStatus: hot.ramStatus, augPlan: hot.augPlan, autopilot: hot.autopilot,
      pred2Tail: patch.pred || store.get("pred") || [], settings: s, now: tNow });
    const changed = store.set(patch);
    store.set({ meta: { tickMs: clock() - t0, lastTick: tNow, reads: st.reads } }, { deep: false });
    return changed;
  }

  const sel = (view, id) => store.ui({ sel: { ...ui().sel, [view]: id } });
  const setErr = (key, e) => store.ui({ errors: { ...ui().errors, [key]: e } });
  const clearDraft = (key) => { const d = { ...ui().drafts }; delete d[key]; const er = { ...ui().errors }; delete er[key]; store.ui({ drafts: d, errors: er }); };
  const afterWrite = () => store.set({ settings: settingsSlice() });

  const actions = {
    go: (view) => { store.ui({ view, confirmReset: false }); st.wake = true; },
    select: sel,
    clearSelection: () => sel(ui().view, null),
    setUi: (p) => store.ui(p),
    toggle: (path) => store.ui({ expanded: { ...ui().expanded, [path]: !ui().expanded[path] } }),
    openRaw: (file, field = null) => { store.ui({ view: "raw", rawFile: file, rawField: field }); st.rawKey = null; st.wake = true; },
    openSetting: (key) => { store.ui({ view: "settings", sel: { ...ui().sel, settings: key } }); st.wake = true; },
    draft: (key, v) => store.ui({ drafts: { ...ui().drafts, [key]: v } }),
    saveSetting(key, v) {
      if (!st.alive) return { ok: false, errors: ["dashboard stopped"] };
      let r;
      try { r = writeSettings(ns, { set: { [key]: v } }, "ui"); } catch (e) { r = { ok: false, errors: [String(e && e.message || e)] }; }
      if (r.ok) { clearDraft(key); afterWrite(); } else { store.ui({ drafts: { ...ui().drafts, [key]: v } }); setErr(key, (r.errors || ["invalid"]).join("; ")); }
      return r;
    },
    resetSetting(key) {
      if (!st.alive) return { ok: false };
      const r = writeSettings(ns, { unset: [key] }, "ui");
      if (r.ok) { clearDraft(key); afterWrite(); } else setErr(key, (r.errors || []).join("; "));
      return r;
    },
    resetAll() {
      if (!st.alive) return { ok: false };
      if (!ui().confirmReset) { store.ui({ confirmReset: true }); return { ok: true, armed: true }; }
      const keys = Object.keys(store.get("settings")?.overrides || {});
      const r = keys.length ? writeSettings(ns, { unset: keys }, "ui") : { ok: true, changed: [] };
      store.ui({ confirmReset: false, drafts: {}, errors: {} });
      afterWrite();
      return r;
    },
    refresh: () => { st.forceSlow = true; st.rawKey = null; st.wake = true; },
  };

  /** Sleep until the refresh interval passes or an action asks for a refresh; 250 ms granularity, never below. */
  async function wait(sleep) {
    const total = clampMs(readSettings(ns)["ui.refreshMs"], 1000);
    for (let waited = 0; waited < total && !st.wake && st.alive; waited += 250) await sleep(clampMs(250));
    st.wake = false;
  }

  return { tick, actions, wait, state: st, stop: () => { st.alive = false; } };
}
