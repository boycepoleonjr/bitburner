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

// CLI auth header. BB_TOKEN_VIA_PROXY=1 sends none, so an egress proxy that injects the token can add it (a proxy
// won't overwrite a header the client already sent). With BB_URL (a remote server) a fresh local .bb-token can never
// match, so only an existing one is used and none is created.
export function cliAuthHeader(e = process.env, tokenFile = TOKEN_FILE) {
  if (e.BB_TOKEN_VIA_PROXY === "1") return {};
  if (e.BB_TOKEN) return { authorization: `Bearer ${e.BB_TOKEN.trim()}` };
  if (!e.BB_URL) return { authorization: `Bearer ${loadToken()}` };
  if (!fs.existsSync(tokenFile)) throw new Error("BB_URL is set but BB_TOKEN is not: set BB_TOKEN, or BB_TOKEN_VIA_PROXY=1 if a proxy injects it");
  return { authorization: `Bearer ${fs.readFileSync(tokenFile, "utf8").trim()}` };
}

// ---------- hosted automation (all off by default; Railway turns them on via service variables) ----------
const env = process.env;
const TEST = env.NODE_ENV === "test";
export const configErrors = [];

export const STATE_DIR = (env.BB_STATE_DIR || path.join(ROOT, "state")).replace(/^~(?=$|\/)/, os.homedir());
export const CHECKIN_AUTO = env.BB_CHECKIN_AUTO === "1";

const okUrl = (u) => { try { const p = new URL(u).protocol; return p === "https:" || (TEST && p === "http:"); } catch { return false; } };
export const DISCORD_WEBHOOK_URL = (env.DISCORD_WEBHOOK_URL || "").trim();
if (DISCORD_WEBHOOK_URL && !okUrl(DISCORD_WEBHOOK_URL)) configErrors.push("DISCORD_WEBHOOK_URL is not a valid https URL");
export const DISCORD_ON = !!DISCORD_WEBHOOK_URL && okUrl(DISCORD_WEBHOOK_URL);

export const ESCALATE_ROUTINE_ID = (env.BB_ESCALATE_ROUTINE_ID || "").trim();
export const ESCALATE_TOKEN = (env.BB_ESCALATE_TOKEN || "").trim();
export const ESCALATE_URL = (env.BB_ESCALATE_URL || "").trim() ||
  (ESCALATE_ROUTINE_ID ? `https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(ESCALATE_ROUTINE_ID)}/fire` : "");
export const ESCALATE_ON = Boolean(ESCALATE_URL && ESCALATE_TOKEN);
export const escalationStatus = ESCALATE_ON ? "enabled"
  : ESCALATE_URL ? "misconfigured: missing token"
  : ESCALATE_TOKEN ? "misconfigured: missing routine id" : "disabled";

// Watchdog: restart action is an allowlisted executable run with argv and no shell.
export const WATCHDOG_CMD_ALLOW = new Set(["pkill", "/usr/bin/pkill", ...(TEST ? ["/usr/bin/touch"] : [])]);
export function parseWatchdog(e = env) {
  const errs = [];
  let min = 0;
  if (e.BB_WATCHDOG_MIN != null && e.BB_WATCHDOG_MIN !== "") {
    const n = Number(e.BB_WATCHDOG_MIN);
    if (Number.isFinite(n) && n >= 0) min = n; else errs.push(`BB_WATCHDOG_MIN invalid (${String(e.BB_WATCHDOG_MIN).slice(0, 20)})`);
  }
  const cmd = e.BB_WATCHDOG_CMD || "pkill";
  if (!WATCHDOG_CMD_ALLOW.has(cmd)) errs.push("BB_WATCHDOG_CMD not in allowlist");
  let args = ["-f", "--", "--user-data-dir=/data/chrome"];
  if (e.BB_WATCHDOG_ARGS) {
    try { args = JSON.parse(e.BB_WATCHDOG_ARGS); } catch { args = null; }
    if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) { errs.push("BB_WATCHDOG_ARGS must be a JSON array of strings"); args = []; }
  }
  const interval = Number(e.BB_WATCHDOG_INTERVAL_MS);
  return { min: errs.length ? 0 : min, cmd, args, intervalMs: TEST && interval > 0 ? interval : 60000, errors: errs };
}
const wd = parseWatchdog();
configErrors.push(...wd.errors);
export const WATCHDOG_MIN = wd.min;
export const WATCHDOG_CMD = wd.cmd;
export const WATCHDOG_ARGS = wd.args;
export const WATCHDOG_INTERVAL_MS = wd.intervalMs;

export function configSummary() {
  return [
    `checkin auto: ${CHECKIN_AUTO ? "enabled" : "disabled"}`,
    `state directory: ${STATE_DIR}`,
    `discord notifications: ${DISCORD_ON ? "enabled" : "disabled"}`,
    `claude escalation: ${escalationStatus}`,
    `watchdog interval: ${WATCHDOG_MIN > 0 ? `${WATCHDOG_MIN} minutes` : "disabled"}`,
    ...configErrors.map((e) => `config error: ${e}`),
  ];
}
