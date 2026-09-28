import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PORT = Number(process.env.BB_PORT || 12525);
export const HOST = process.env.BB_HOST || "127.0.0.1";
export const BACKUP_DIR = (process.env.BB_BACKUP_DIR || path.join(ROOT, "backups")).replace(/^~(?=$|\/)/, os.homedir());
const TOKEN_FILE = path.join(ROOT, ".bb-token");

export function loadToken() {
  if (process.env.BB_TOKEN) return process.env.BB_TOKEN.trim(); // hosted (Railway) and remote CLI use
  if (!fs.existsSync(TOKEN_FILE)) fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(24).toString("hex"), { mode: 0o600 });
  return fs.readFileSync(TOKEN_FILE, "utf8").trim();
}
