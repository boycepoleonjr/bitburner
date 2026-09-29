// Save backups. Keeps the newest 48 hourly files plus one per day for 14 days.
// Source: the game's own IndexedDB save (via rpc.js page JS). The Remote API getSaveFile path wrote 18-33 byte
// garbage files, so it is only a fallback, and every file is validated (gzip magic or save JSON) before it is kept.
import fs from "node:fs";
import path from "node:path";
import { BACKUP_DIR } from "./config.js";

export const IDB_SAVE_JS = `
const db = await new Promise((res, rej) => { const r = indexedDB.open("bitburnerSave"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const v = await new Promise((res, rej) => { const t = db.transaction("savestring").objectStore("savestring").get("save"); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
db.close();
if (v instanceof Uint8Array || v instanceof ArrayBuffer) { const u = new Uint8Array(v); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return { b64: btoa(s) }; }
return { b64: btoa(unescape(encodeURIComponent(String(v)))) };`;

const isSave = (buf) => buf.length > 1000 && ((buf[0] === 0x1f && buf[1] === 0x8b) || buf.subarray(0, 40).toString().includes("BitburnerSaveObject"));

export async function readSave({ rpc, remote }) {
  const errs = [];
  if (rpc) {
    try {
      const r = await rpc("js", { code: IDB_SAVE_JS });
      if (!r.ok) throw new Error(r.error);
      const buf = Buffer.from(r.value.b64, "base64");
      if (isSave(buf)) return buf;
      errs.push(`idb: not a save (${buf.length} bytes)`);
    } catch (e) { errs.push("idb: " + e.message); }
  }
  if (remote) {
    try {
      const r = await remote("getSaveFile", {});
      const buf = r.binary ? Buffer.from(r.save, "base64") : Buffer.from(r.save, "utf8");
      if (isSave(buf)) return buf;
      errs.push(`remote: not a save (${buf.length} bytes)`);
    } catch (e) { errs.push("remote: " + e.message); }
  }
  throw new Error("no valid save: " + errs.join("; "));
}

export async function backup(src) {
  const buf = await readSave(src);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const gz = buf[0] === 0x1f && buf[1] === 0x8b;
  const file = path.join(BACKUP_DIR, `bitburnerSave_${stamp}${gz ? ".json.gz" : ".json"}`);
  fs.writeFileSync(file, buf);
  prune();
  return { ok: true, file, bytes: buf.length };
}

function prune() {
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("bitburnerSave_")).sort().reverse();
  for (const f of files) if (fs.statSync(path.join(BACKUP_DIR, f)).size < 1000) fs.unlinkSync(path.join(BACKUP_DIR, f)); // old garbage
  const good = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("bitburnerSave_")).sort().reverse();
  const keep = new Set(good.slice(0, 48)), days = new Set();
  for (const f of good) { const d = f.slice(14, 24); if (!days.has(d) && days.size < 14) { days.add(d); keep.add(f); } }
  for (const f of good) if (!keep.has(f)) fs.unlinkSync(path.join(BACKUP_DIR, f));
}
