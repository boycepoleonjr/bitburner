// Small durable-state helper for the hosted automation (check-in cache, escalation dedupe, watchdog).
// Writes are atomic (unique temp file + rename) and serialized per target file; corrupt or unknown-version
// files are set aside, never fatal. Holds only report/status data — never tokens or webhook URLs.
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const STATE_VERSION = 1;
export const HISTORY_MAX = 500;

export function createState({ dir, log = () => {} }) {
  const chains = new Map(); // file -> tail promise
  const stats = { reads: 0 };
  const p = (name) => path.join(dir, name);
  const serialize = (file, fn) => {
    const next = (chains.get(file) || Promise.resolve()).then(fn, fn);
    const tail = next.catch(() => {});
    chains.set(file, tail);
    tail.then(() => { if (chains.get(file) === tail) chains.delete(file); });
    return next;
  };
  const setAside = (file, kind) => {
    const to = `${file}.${kind}-${Date.now()}-${process.pid}`;
    try { fsSync.renameSync(file, to); } catch { }
    return to;
  };

  return {
    dir, stats,
    path: p,
    ensureDir: () => fs.mkdir(dir, { recursive: true }),

    // Returns fallback when missing; sets aside unparsable files. `versioned` also sets aside unknown versions.
    async readJson(name, fallback, { versioned = false } = {}) {
      const file = p(name);
      stats.reads++;
      let txt;
      try { txt = await fs.readFile(file, "utf8"); } catch (e) { if (e.code !== "ENOENT") log(`state read ${name}: ${e.code || e.message}`); return fallback; }
      let v;
      try { v = JSON.parse(txt); } catch (e) { log(`state ${name} unparsable, moved to ${path.basename(setAside(file, "corrupt"))}`); return fallback; }
      if (versioned && v && typeof v === "object" && v.version != null && v.version !== STATE_VERSION) {
        log(`state ${name} has unknown version ${String(v.version).slice(0, 20)}, moved to ${path.basename(setAside(file, "unknown-version"))}`);
        return fallback;
      }
      return v;
    },

    writeJsonAtomic(name, value) {
      const file = p(name);
      return serialize(file, async () => {
        const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
        try {
          await fs.writeFile(tmp, JSON.stringify(value) + "\n", { mode: 0o600 });
          await fs.rename(tmp, file);
        } catch (e) { await fs.rm(tmp, { force: true }); throw e; }
      });
    },

    appendHistory(rec, name = "checkin-history.jsonl") {
      const file = p(name);
      return serialize(file, async () => {
        let lines = [];
        try { lines = (await fs.readFile(file, "utf8")).split("\n").filter(Boolean); } catch { }
        lines.push(JSON.stringify(rec));
        if (lines.length > HISTORY_MAX) lines = lines.slice(-HISTORY_MAX);
        const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
        await fs.writeFile(tmp, lines.join("\n") + "\n", { mode: 0o600 });
        await fs.rename(tmp, file);
      });
    },
  };
}
