/**
 * lib/settings-schema.js — the one source of truth for every owner/agent-tunable setting.
 *
 * PURE: no `ns`, no imports. Loaded by the game (`import ... from "lib/settings-schema.js"`), by the bb server
 * (`../game/lib/settings-schema.js`) and by tests, so validation is identical everywhere.
 *
 * Storage: data/settings.txt = {"version":1,"rev":N,"updatedAt":ms,"updatedBy":"ui|api|cli|agent","values":{key:value}}
 * `values` holds only explicit overrides; everything else falls back to the schema default, so changing a default
 * here reaches every run that never touched that key.
 *
 * Field types: bool | number | int | enum | string | intList
 * ui hints:    toggle | slider | number | select | text | list
 */

export const SETTINGS_FILE = "data/settings.txt";
export const SETTINGS_LOG = "data/settings-log.txt";
export const SETTINGS_VERSION = 1;

/** Display order of groups in the UI and CLI. */
export const GROUPS = [
  { id: "node", label: "BitNode" },
  { id: "strategy", label: "Strategy" },
  { id: "ram", label: "RAM manager" },
  { id: "augs", label: "Augmentations" },
  { id: "ui", label: "Dashboard" },
];

const MONEY_REP = ["Money", "Faction rep"];

/** @type {Array<{key:string,group:string,type:string,default:any,label:string,help:string,ui:string,min?:number,max?:number,step?:number,options?:string[],ends?:string[],owner:string}>} */
export const SCHEMA = [
  // ── BitNode ────────────────────────────────────────────────────────────────
  { key: "node.autoSelect", group: "node", type: "bool", default: false, ui: "toggle", owner: "autopilot",
    label: "Automatic node selection", help: "Pick the next BitNode from node.order (or the planner's recommendation) without asking." },
  { key: "node.autoDestroy", group: "node", type: "bool", default: false, ui: "toggle", owner: "autopilot",
    label: "Automatic node destruction", help: "Hack w0r1d_d43m0n as soon as it is ready (fl1ght.exe complete, hack level met). A save backup is taken first." },
  { key: "node.backupBeforeDestroy", group: "node", type: "bool", default: true, ui: "toggle", owner: "autopilot",
    label: "Backup before destroy", help: "Force a save backup right before destroying a BitNode, so it can be undone by importing it." },
  { key: "node.destroyDelayMin", group: "node", type: "int", default: 10, min: 0, max: 1440, ui: "number", owner: "autopilot",
    label: "Destroy veto window (min)", help: "After the backup is confirmed, wait this long before destroying. Turning node.autoDestroy off during the wait cancels it." },
  { key: "node.order", group: "node", type: "intList", default: [], ui: "list", min: 1, max: 14, owner: "autopilot",
    label: "BitNode order", help: "Preferred next BitNodes, first available wins. Empty = use the planner's recommendation." },

  // ── Strategy (0 = all money, 1 = all faction rep) ──────────────────────────
  { key: "strategy.early", group: "strategy", type: "number", default: 0, min: 0, max: 1, step: 0.05, ui: "slider", ends: MONEY_REP, owner: "daemon",
    label: "Early node strategy", help: "Money vs faction-rep weight while fl1ght.exe progress is below strategy.phase.midAt." },
  { key: "strategy.mid", group: "strategy", type: "number", default: 0.5, min: 0, max: 1, step: 0.05, ui: "slider", ends: MONEY_REP, owner: "daemon",
    label: "Mid node strategy", help: "Weight between strategy.phase.midAt and strategy.phase.lateAt." },
  { key: "strategy.late", group: "strategy", type: "number", default: 1, min: 0, max: 1, step: 0.05, ui: "slider", ends: MONEY_REP, owner: "daemon",
    label: "Late node strategy", help: "Weight once progress reaches strategy.phase.lateAt or The Red Pill is owned." },
  { key: "strategy.phase.midAt", group: "strategy", type: "number", default: 0.34, min: 0, max: 1, step: 0.01, ui: "slider", owner: "daemon",
    label: "Mid phase starts at", help: "fl1ght.exe progress (mean of augs, money and hacking vs Daedalus requirements) where mid phase begins." },
  { key: "strategy.phase.lateAt", group: "strategy", type: "number", default: 0.9, min: 0, max: 1, step: 0.01, ui: "slider", owner: "daemon",
    label: "Late phase starts at", help: "fl1ght.exe progress where late phase begins." },

  // ── RAM manager ────────────────────────────────────────────────────────────
  { key: "ram.manager.enabled", group: "ram", type: "bool", default: true, ui: "toggle", owner: "daemon",
    label: "RAM manager", help: "Off = exact pre-manager daemon behaviour (rollback switch)." },
  { key: "ram.homeReserveGb", group: "ram", type: "int", default: 128, min: 0, max: 2 ** 40, ui: "number", owner: "daemon",
    label: "Home reserve (GB)", help: "Home RAM never allocated by the daemon." },
  { key: "ram.cloud.enabled", group: "ram", type: "bool", default: true, ui: "toggle", owner: "daemon",
    label: "Buy cloud servers", help: "Buy and upgrade purchased (cloud) servers from the money budget." },
  { key: "ram.cloud.maxSpendFraction", group: "ram", type: "number", default: 0.1, min: 0, max: 1, step: 0.01, ui: "slider", owner: "daemon",
    label: "Cloud spend per loop", help: "Max fraction of current cash spent on cloud servers per daemon loop." },
  { key: "ram.cloud.freezeBeforeInstallMin", group: "ram", type: "int", default: 10, min: 0, max: 240, ui: "number", owner: "daemon",
    label: "Cloud freeze before install (min)", help: "No cloud purchases this close to a predicted augmentation install." },
  { key: "ram.share.enabled", group: "ram", type: "bool", default: true, ui: "toggle", owner: "daemon",
    label: "Share RAM for rep", help: "Allow ns.share() workers (boosts faction work rep) when the strategy weight asks for rep." },
  { key: "ram.xp.mode", group: "ram", type: "enum", default: "auto", options: ["auto", "off", "always"], ui: "select", owner: "daemon",
    label: "XP farming", help: "auto = only when hacking level is the binding constraint or RAM would idle; off = never; always = surplus to XP." },
  { key: "ram.xp.target", group: "ram", type: "string", default: "joesguns", ui: "text", owner: "daemon",
    label: "XP target", help: "Server weakened for hacking XP." },
  { key: "ram.targets.max", group: "ram", type: "int", default: 0, min: 0, max: 200, ui: "number", owner: "daemon",
    label: "Max hack targets", help: "0 = unlimited (add targets while RAM allows)." },
  { key: "ram.batches.max", group: "ram", type: "int", default: 0, min: 0, max: 100000, ui: "number", owner: "daemon",
    label: "Max batches per wave", help: "0 = bounded only by weaken time and RAM." },
  { key: "ram.resizeThreshold", group: "ram", type: "number", default: 0.1, min: 0, max: 1, step: 0.01, ui: "slider", owner: "daemon",
    label: "Worker resize threshold", help: "Share/XP workers are resized only when their target size changes by more than this fraction." },

  // ── Augmentations ──────────────────────────────────────────────────────────
  { key: "augs.autoInstall", group: "augs", type: "bool", default: true, ui: "toggle", owner: "autopilot",
    label: "Auto-install augmentations", help: "Install queued augmentations automatically when the install policy fires." },
  { key: "augs.installPolicy", group: "augs", type: "enum", default: "eta", options: ["eta", "count"], ui: "select", owner: "autopilot",
    label: "Install policy", help: "eta = install when waiting for the next aug costs more time than resetting; count = install at augs.installAt buyable." },
  { key: "augs.installAt", group: "augs", type: "int", default: 6, min: 1, max: 100, ui: "number", owner: "autopilot",
    label: "Install at (count)", help: "Buyable-aug count that triggers an install under the count policy, and the minimum batch under eta." },
  { key: "augs.planner.goal", group: "augs", type: "enum", default: "destroy", options: ["destroy", "complete"], ui: "select", owner: "autopilot",
    label: "Planner goal", help: "destroy = shortest aug path to Daedalus, The Red Pill and w0r1d_d43m0n; complete = every buyable aug." },
  { key: "augs.donateAtFavor", group: "augs", type: "int", default: 150, min: 0, max: 100000, ui: "number", owner: "autopilot",
    label: "Donate at favor", help: "Donate money for rep once faction favor reaches this (scaled by the BitNode multiplier)." },
  { key: "augs.nfgHoldFrac", group: "augs", type: "number", default: 0.9, min: 0, max: 1, step: 0.01, ui: "slider", owner: "autopilot",
    label: "NeuroFlux hold near finish", help: "No NeuroFlux-only install once hacking reaches this fraction of w0r1d_d43m0n's requirement (an install would reset the finish)." },
  { key: "augs.neuroFluxLast", group: "augs", type: "bool", default: true, ui: "toggle", owner: "autopilot",
    label: "NeuroFlux last", help: "Owner rule: buy NeuroFlux Governor only after every other purchasable aug." },

  // ── Dashboard ──────────────────────────────────────────────────────────────
  { key: "ui.refreshMs", group: "ui", type: "int", default: 1000, min: 250, max: 60000, ui: "number", owner: "dashboard",
    label: "Refresh interval (ms)", help: "How often the dashboard re-reads data." },
  { key: "ui.historyMinutes", group: "ui", type: "int", default: 360, min: 10, max: 10080, ui: "number", owner: "dashboard",
    label: "Chart history (min)", help: "Telemetry window shown in charts." },
];

export const BY_KEY = Object.freeze(Object.fromEntries(SCHEMA.map((f) => [f.key, f])));

/** Default value of every key (fresh copies for lists). */
export function defaults() {
  const out = {};
  for (const f of SCHEMA) out[f.key] = Array.isArray(f.default) ? [...f.default] : f.default;
  return out;
}

/**
 * Coerce + validate one value. Strings are accepted (CLI `key=value`, form inputs) and parsed.
 * Out-of-range values are rejected, never clamped.
 * @returns {{ok:true,value:any}|{ok:false,error:string}}
 */
export function coerce(key, raw) {
  const f = BY_KEY[key];
  if (!f) return { ok: false, error: `unknown setting "${key}"` };
  const bad = (why) => ({ ok: false, error: `${key}: ${why}` });
  let v = raw;
  switch (f.type) {
    case "bool":
      if (typeof v === "string") { const s = v.trim().toLowerCase(); if (["true", "1", "on", "yes"].includes(s)) v = true; else if (["false", "0", "off", "no"].includes(s)) v = false; }
      return typeof v === "boolean" ? { ok: true, value: v } : bad("expected true/false");
    case "number":
    case "int": {
      if (typeof v === "string" && v.trim() !== "") v = Number(v);
      if (typeof v !== "number" || !Number.isFinite(v)) return bad("expected a number");
      if (f.type === "int" && !Number.isInteger(v)) return bad("expected an integer");
      if (f.min != null && v < f.min) return bad(`must be >= ${f.min}`);
      if (f.max != null && v > f.max) return bad(`must be <= ${f.max}`);
      return { ok: true, value: v };
    }
    case "enum":
      return f.options.includes(v) ? { ok: true, value: v } : bad(`expected one of ${f.options.join("|")}`);
    case "string":
      return typeof v === "string" && v.length <= 200 ? { ok: true, value: v } : bad("expected a string (<=200 chars)");
    case "intList": {
      if (typeof v === "string") { const s = v.trim(); v = s === "" ? [] : s.startsWith("[") ? safeJson(s) : s.split(",").map((x) => Number(x.trim())); }
      if (!Array.isArray(v)) return bad("expected a list of integers");
      for (const n of v) {
        if (!Number.isInteger(n)) return bad("expected a list of integers");
        if ((f.min != null && n < f.min) || (f.max != null && n > f.max)) return bad(`entries must be ${f.min}..${f.max}`);
      }
      if (new Set(v).size !== v.length) return bad("entries must be unique");
      return { ok: true, value: [...v] };
    }
    default:
      return bad(`unsupported type ${f.type}`);
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Empty settings file object. */
export function emptyFile() { return { version: SETTINGS_VERSION, rev: 0, updatedAt: 0, updatedBy: "", values: {} }; }

/**
 * Parse data/settings.txt. Never throws: corrupt files, unknown keys and invalid stored values become warnings.
 * @returns {{version:number,rev:number,updatedAt:number,updatedBy:string,values:Object,warnings:string[]}}
 */
export function parseFile(raw) {
  const out = { ...emptyFile(), warnings: [] };
  if (raw == null || String(raw).trim() === "") return out;
  let j;
  try { j = JSON.parse(raw); } catch (e) { out.warnings.push(`settings file is not valid JSON; using defaults (${String(e).slice(0, 80)})`); out.corrupt = true; return out; }
  if (!j || typeof j !== "object" || Array.isArray(j)) { out.warnings.push("settings file is not an object; using defaults"); out.corrupt = true; return out; }
  out.rev = Number.isInteger(j.rev) && j.rev >= 0 ? j.rev : 0;
  out.updatedAt = Number(j.updatedAt) || 0;
  out.updatedBy = typeof j.updatedBy === "string" ? j.updatedBy : "";
  for (const [k, v] of Object.entries(j.values && typeof j.values === "object" ? j.values : {})) {
    const c = coerce(k, v);
    if (c.ok) out.values[k] = c.value; else out.warnings.push(`ignored stored value: ${c.error}`);
  }
  return out;
}

/** Defaults overlaid with (already validated) overrides. */
export function effective(values = {}) {
  const out = defaults();
  for (const [k, v] of Object.entries(values)) if (k in out) out[k] = Array.isArray(v) ? [...v] : v;
  return out;
}

/**
 * Apply a patch atomically: if ANY entry is invalid, nothing changes.
 * @param {{rev:number,values:Object}} file  parsed file
 * @param {{set?:Object, unset?:string[], rev?:number}} patch  rev = optimistic-concurrency check (optional)
 * @param {{actor?:string, now?:number}} meta
 * @returns {{ok:boolean, file:Object, changed:Array<{key:string,from:any,to:any}>, errors:string[], conflict?:boolean}}
 */
export function applyPatch(file, patch = {}, { actor = "unknown", now = Date.now() } = {}) {
  const errors = [];
  if (patch.rev != null && patch.rev !== file.rev) return { ok: false, conflict: true, file, changed: [], errors: [`stale rev ${patch.rev} (current ${file.rev})`] };
  const next = { ...file.values };
  const changed = [];
  const before = effective(file.values);
  for (const [k, raw] of Object.entries(patch.set || {})) {
    const c = coerce(k, raw);
    if (!c.ok) { errors.push(c.error); continue; }
    next[k] = c.value;
  }
  for (const k of patch.unset || []) {
    if (!BY_KEY[k]) { errors.push(`unknown setting "${k}"`); continue; }
    delete next[k];
  }
  if (errors.length) return { ok: false, file, changed: [], errors };
  const after = effective(next);
  for (const f of SCHEMA) if (!same(before[f.key], after[f.key])) changed.push({ key: f.key, from: before[f.key], to: after[f.key] });
  const storedChanged = !same(file.values, next);
  if (!changed.length && !storedChanged) return { ok: true, file, changed, errors };
  return { ok: true, changed, errors, file: { version: SETTINGS_VERSION, rev: file.rev + 1, updatedAt: now, updatedBy: String(actor).slice(0, 40), values: next } };
}

/** File text for data/settings.txt (stable key order). */
export function serialize(file) {
  const values = {};
  for (const f of SCHEMA) if (f.key in (file.values || {})) values[f.key] = file.values[f.key];
  return JSON.stringify({ version: SETTINGS_VERSION, rev: file.rev, updatedAt: file.updatedAt, updatedBy: file.updatedBy, values }, null, 1);
}

/** One JSONL line for data/settings-log.txt. */
export function logLine(file, changed) {
  return JSON.stringify({ t: file.updatedAt, rev: file.rev, by: file.updatedBy, changed }) + "\n";
}
