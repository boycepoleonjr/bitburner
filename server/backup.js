// Save backups via Remote API getSaveFile. Keeps the newest 48 hourly files plus one per day for 14 days.
import fs from "node:fs";
import path from "node:path";
import { BACKUP_DIR } from "./config.js";

export async function backup(remote) {
  const r = await remote("getSaveFile", {});
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const buf = r.binary ? Buffer.from(r.save, "base64") : Buffer.from(r.save, "utf8");
  const file = path.join(BACKUP_DIR, `bitburnerSave_${stamp}${r.binary ? ".json.gz" : ".json"}`);
  fs.writeFileSync(file, buf);
  prune();
  return { ok: true, file, bytes: buf.length };
}

function prune() {
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("bitburnerSave_")).sort().reverse();
  const keep = new Set(files.slice(0, 48)), days = new Set();
  for (const f of files) { const d = f.slice(14, 24); if (!days.has(d) && days.size < 14) { days.add(d); keep.add(f); } }
  for (const f of files) if (!keep.has(f)) fs.unlinkSync(path.join(BACKUP_DIR, f));
}
