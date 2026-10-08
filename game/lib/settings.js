/**
 * lib/settings.js — in-game access to data/settings.txt (schema: lib/settings-schema.js).
 *
 *   const s = readSettings(ns);          // flat effective values, e.g. s["ram.cloud.enabled"]; cached by file content
 *   writeSettings(ns, {set: {...}}, "ui") // validated, atomic within the tick, bumps rev, appends data/settings-log.txt
 *
 * ns.read / ns.write cost 0 GB, so any script can use this.
 */
import { SETTINGS_FILE, SETTINGS_LOG, parseFile, effective, applyPatch, serialize, logLine } from "lib/settings-schema.js";

let cache = { raw: undefined, val: null };

/** @param {NS} ns @returns {Object & {_rev:number,_warnings:string[]}} */
export function readSettings(ns) {
  const raw = ns.read(SETTINGS_FILE);
  if (raw === cache.raw && cache.val) return cache.val;
  const f = parseFile(raw);
  const val = Object.freeze({ ...effective(f.values), _rev: f.rev, _warnings: f.warnings, _overrides: f.values });
  cache = { raw, val };
  return val;
}

/**
 * Read-modify-write with no await in between, so it cannot interleave with another script's write.
 * @param {NS} ns
 * @param {{set?:Object, unset?:string[], rev?:number}} patch
 * @param {string} actor  "ui" | "agent" | script name
 */
export function writeSettings(ns, patch, actor = ns.getScriptName()) {
  const cur = parseFile(ns.read(SETTINGS_FILE));
  if (cur.corrupt) return { ok: false, changed: [], errors: ["settings file is corrupt; fix or delete data/settings.txt first"] };
  const r = applyPatch(cur, patch, { actor, now: Date.now() });
  if (!r.ok || !r.changed.length && r.file === cur) return r;
  ns.write(SETTINGS_FILE, serialize(r.file), "w");
  if (r.changed.length) ns.write(SETTINGS_LOG, logLine(r.file, r.changed), "a");
  return r;
}
