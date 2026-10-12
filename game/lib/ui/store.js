/**
 * lib/ui/store.js — tiny external store for the dashboard. PURE.
 * Slices are replaced, never mutated. set() notifies only subscribers of slices whose value changed:
 * identical reference -> no notify; for plain data, structurally equal JSON -> no notify. So a tick that reads unchanged
 * files re-renders nothing. UI state (view, selection, drafts, errors) lives here too, so closing and reopening the tail
 * (which remounts React) loses nothing.
 */
export const INITIAL_UI = Object.freeze({
  view: "overview", sel: {}, drafts: {}, errors: {}, logTab: "agent", rawFile: "data/telemetry-latest.txt", confirmReset: false, expanded: {},
});

const sameJson = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };

export function createStore(initial = {}) {
  let state = { ui: { ...INITIAL_UI }, ...initial };
  const subs = new Map(); // key -> Set<fn>
  return {
    get: (key) => (key == null ? state : state[key]),
    /** @param {Object} patch {slice: value}; @param {{deep?: boolean}} opt deep=false skips the JSON comparison */
    set(patch, { deep = true } = {}) {
      const changed = [];
      for (const [k, v] of Object.entries(patch || {})) {
        const cur = state[k];
        if (Object.is(cur, v)) continue;
        if (deep && v && typeof v === "object" && cur && typeof cur === "object" && sameJson(cur, v)) continue;
        changed.push(k);
      }
      if (!changed.length) return changed;
      state = { ...state };
      for (const k of changed) state[k] = patch[k];
      for (const k of changed) for (const fn of subs.get(k) || []) { try { fn(state[k]); } catch { /* a bad subscriber must not break the tick */ } }
      return changed;
    },
    /** Merge into the ui slice. */
    ui(patch) { return this.set({ ui: { ...state.ui, ...patch } }, { deep: false }); },
    subscribe(key, fn) {
      if (!subs.has(key)) subs.set(key, new Set());
      subs.get(key).add(fn);
      return () => subs.get(key).delete(fn);
    },
    subscriberCount: (key) => (subs.get(key) ? subs.get(key).size : 0),
  };
}
