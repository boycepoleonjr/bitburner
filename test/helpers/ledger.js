// Parser and validator for docs/feedback/ledger.md (format: docs/specs/feedback-loop.md). Pure, no I/O.
// One fenced ```yaml block = one entry. Each line is `key: value`; free-text values are double-quoted JSON strings,
// id/found/severity/detector/status are bare tokens. Blank lines and `#` lines are ignored. No nesting, no lists.

export const FIELDS = ["id", "title", "found", "severity", "evidence", "root_cause", "signal", "detector", "recorded_in", "consumer", "proposed_fix", "owner_decision", "status"];
export const BARE = new Set(["id", "found", "severity", "detector", "status"]);
export const ENUMS = { severity: ["HIGH", "MED", "LOW"], detector: ["none", "flag", "test"], status: ["open", "in-progress", "closed", "wontfix"] };
const PLACEHOLDER = /^(none|n\/a|na|tbd|todo|-|\?)$/i;

/** @returns {{entries: Object[], errors: string[]}} entries carry `_block` (1-based) for messages. */
export function parseLedger(md) {
  const entries = [], errors = [];
  const re = /^```yaml[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;
  let m, n = 0;
  while ((m = re.exec(md))) {
    n++;
    const e = { _block: n }, seen = new Set();
    for (const [i, raw] of m[1].split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const k = line.indexOf(":");
      if (k < 1) { errors.push(`block ${n} line ${i + 1}: not "key: value": ${line.slice(0, 40)}`); continue; }
      const key = line.slice(0, k).trim(), rest = line.slice(k + 1).trim();
      if (!FIELDS.includes(key)) { errors.push(`block ${n}: unknown field "${key}"`); continue; }
      if (seen.has(key)) { errors.push(`block ${n}: duplicate field "${key}"`); continue; }
      seen.add(key);
      if (BARE.has(key)) {
        if (rest.startsWith('"')) errors.push(`block ${n}: ${key} must be a bare token, not quoted`);
        e[key] = rest;
      } else if (rest.startsWith('"')) {
        try { const v = JSON.parse(rest); if (typeof v !== "string") throw new Error("not a string"); e[key] = v; }
        catch { errors.push(`block ${n}: ${key} is not a valid double-quoted JSON string`); }
      } else errors.push(`block ${n}: ${key} must be a double-quoted string`);
    }
    entries.push(e);
  }
  return { entries, errors };
}

const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

/** @returns {string[]} one message per problem; empty = valid. */
export function validateLedger(md) {
  const { entries, errors } = parseLedger(md);
  const out = [...errors];
  if (!entries.length) out.push("ledger has no entries (no ```yaml blocks)");
  const ids = new Map();
  for (const e of entries) {
    const who = e.id ? e.id : `block ${e._block}`;
    for (const f of FIELDS) if (!(f in e) || String(e[f]).trim() === "") out.push(`${who}: missing required field "${f}"`);
    if (e.id) {
      if (!/^F-\d{3,}$/.test(e.id)) out.push(`${who}: id must look like F-001`);
      if (ids.has(e.id)) out.push(`${who}: duplicate id (also block ${ids.get(e.id)})`); else ids.set(e.id, e._block);
    }
    if (e.found && !validDate(e.found)) out.push(`${who}: found must be a real YYYY-MM-DD date`);
    for (const [f, allowed] of Object.entries(ENUMS)) if (e[f] && !allowed.includes(e[f])) out.push(`${who}: unknown ${f} "${e[f]}" (allowed: ${allowed.join(", ")})`);
    const unresolved = e.status === "open" || e.status === "in-progress";
    if (e.severity === "HIGH" && unresolved && (!e.signal || PLACEHOLDER.test(e.signal.trim()))) out.push(`${who}: HIGH and ${e.status} needs a real signal`);
    if (e.status === "closed" && e.detector === "none") out.push(`${who}: cannot be closed while detector is none (needs a test or a flag)`);
  }
  return out;
}
