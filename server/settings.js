// Settings over the HTTP API. Validation is the game's own schema (game/lib/settings-schema.js), so the server, CLI,
// in-game dashboard and agents all accept exactly the same values. Storage stays in-game (data/settings.txt).
import { SCHEMA, GROUPS, SETTINGS_FILE, SETTINGS_LOG, parseFile, effective, applyPatch, serialize, logLine } from "../game/lib/settings-schema.js";

const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export function createSettingsApi({ rpc, nowMs = () => Date.now() }) {
  async function readFile() {
    const r = await rpc("read", { file: SETTINGS_FILE });
    if (!r || r.ok === false) throw err(502, `could not read ${SETTINGS_FILE}: ${r?.error ?? "no response"}`);
    return parseFile(r.value);
  }
  const view = (f) => ({ rev: f.rev, updatedAt: f.updatedAt, updatedBy: f.updatedBy, values: effective(f.values), overrides: f.values, warnings: f.warnings || [] });

  return {
    /** GET /api/settings[?schema=0] */
    async get({ schema = true } = {}) {
      const f = await readFile();
      return { ok: true, value: { ...view(f), ...(schema ? { schema: SCHEMA, groups: GROUPS } : {}) } };
    },
    /** POST /api/settings  {set?:{key:value}, unset?:[key], rev?:number, actor?:string} */
    async patch(b = {}) {
      if ((b.set != null && (typeof b.set !== "object" || Array.isArray(b.set))) || (b.unset != null && !Array.isArray(b.unset)))
        throw err(400, "body must be {set?: {key: value}, unset?: [key], rev?: number}");
      if (!b.set && !b.unset) throw err(400, "nothing to change: pass set and/or unset");
      const cur = await readFile();
      if (cur.corrupt) throw err(409, "settings file is corrupt in-game; fix or delete data/settings.txt", { warnings: cur.warnings });
      const r = applyPatch(cur, { set: b.set, unset: b.unset, rev: b.rev }, { actor: String(b.actor || "api"), now: nowMs() });
      if (r.conflict) throw err(409, r.errors[0]);
      if (!r.ok) throw err(400, r.errors.join("; "), { errors: r.errors });
      if (r.file !== cur) {
        const w = await rpc("write", { file: SETTINGS_FILE, data: serialize(r.file), mode: "w" });
        if (!w || w.ok === false) throw err(502, `could not write ${SETTINGS_FILE}: ${w?.error ?? "no response"}`);
        if (r.changed.length) await rpc("write", { file: SETTINGS_LOG, data: logLine(r.file, r.changed), mode: "a" }).catch(() => {});
      }
      return { ok: true, value: { ...view(r.file), changed: r.changed } };
    },
  };
}
