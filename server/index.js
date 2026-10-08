#!/usr/bin/env node
// bb server — local hub between the game and any agent. One port (default 12525), localhost only.
//   ws  /      <- Bitburner Remote API (game connects here: Options > Remote API > port 12525)
//   ws  /rpc   <- in-game agent/rpc.js (eval ns code / page JS)
//   http /api/* -> agents & the CLI (Bearer token from .bb-token)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import { pull, push } from "./sync.js";
import { backup } from "./backup.js";
import { importSave } from "./cdp.js";
import * as C from "./config.js";
import { ROOT, PORT, HOST, loadToken } from "./config.js";
import { createState } from "./state.js";
import { createNotifier } from "./notify.js";
import { createCheckin } from "./checkin.js";
import { createWatchdog, spawnRestart, PING_TIMEOUT_MS } from "./watchdog.js";
import { createSettingsApi } from "./settings.js";
import { createNodeControl, readPlan } from "./node-control.js";
import { createDashboardApi } from "./dashboard.js";

const TOKEN = loadToken();
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- game Remote API (JSON-RPC 2.0, server -> game requests) ----------
let game = null, rid = 0;
const pending = new Map();
export function remote(method, params = {}) {
  return new Promise((res, rej) => {
    if (!game) return rej(new Error("game not connected (enable Remote API in Bitburner options)"));
    const id = ++rid;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`remote ${method} timeout`)); }, 30000);
    pending.set(id, { res, rej, timer });
    game.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}
const onGameMessage = (data) => {
  let m; try { m = JSON.parse(data); } catch { return; }
  const p = pending.get(m.id); if (!p) return;
  pending.delete(m.id); clearTimeout(p.timer);
  m.error ? p.rej(new Error(typeof m.error === "string" ? m.error : JSON.stringify(m.error))) : p.res(m.result);
};

// ---------- in-game rpc bridge ----------
let rpcSock = null, qid = 0;
const rpcPending = new Map();
export function rpc(op, args = {}, timeoutMs = 130000) {
  return new Promise((res, rej) => {
    if (!rpcSock) return rej(new Error("agent/rpc.js not connected (run it in-game: `run agent/rpc.js`)"));
    const id = ++qid;
    const timer = setTimeout(() => { rpcPending.delete(id); rej(new Error(`rpc ${op} timeout`)); }, timeoutMs);
    rpcPending.set(id, { res, rej, timer });
    rpcSock.send(JSON.stringify({ id, op, ...args }));
  });
}

async function onGameConnect() {
  log("game connected (Remote API)");
  try { // hand the in-game bridge its connection details
    await remote("pushFile", { server: "home", filename: "agent/rpc-config.txt", content: JSON.stringify({ port: PORT, token: TOKEN }) });
    const names = await remote("getFileNames", { server: "home" });
    if (!names.includes("agent/rpc.js")) await remote("pushFile", { server: "home", filename: "agent/rpc.js", content: fs.readFileSync(path.join(ROOT, "game/agent/rpc.js"), "utf8") });
    log("pushed rpc config; if rpc.js is not running, type in the game terminal: run agent/rpc.js");
  } catch (e) { log("onGameConnect:", e.message); }
}

// ---------- hosted automation: cached check-in, Discord, escalation, watchdog ----------
const isUp = () => Boolean(game && rpcSock);
const state = createState({ dir: C.STATE_DIR, log });
await state.ensureDir();
for (const l of C.configSummary()) log(l);
const notifier = createNotifier({ webhookUrl: C.DISCORD_ON ? C.DISCORD_WEBHOOK_URL : "", escalateUrl: C.ESCALATE_URL, escalateToken: C.ESCALATE_TOKEN, log });
const checkin = createCheckin({
  rpc, isUp, log, state, auto: C.CHECKIN_AUTO, escalationEnabled: notifier.escalationEnabled,
  notify: (rec) => notifier.discordReport(rec), escalate: (text) => notifier.fireRoutine(text),
});
const watchdog = createWatchdog({
  isGameConnected: isUp, isGameSocket: () => Boolean(game), isRpcSocket: () => Boolean(rpcSock), ping: () => rpc("ping", {}, PING_TIMEOUT_MS), restartBrowser: () => spawnRestart(C.WATCHDOG_CMD, C.WATCHDOG_ARGS),
  notifyText: (t) => notifier.discordText(t), escalate: (t) => notifier.fireRoutine(t), checkin, state, log,
  watchdogMin: C.WATCHDOG_MIN, intervalMs: C.WATCHDOG_INTERVAL_MS,
});
if (isUp()) checkin.onRpcUp();
const settingsApi = createSettingsApi({ rpc });
// BitNode-destroy backup handshake: backs up the save when the game asks, never destroys anything itself.
const nodeControl = createNodeControl({ rpc, isUp, state, log, backup: () => backup({ rpc: rpcSock ? rpc : null, remote: game ? remote : null }),
  pollMs: Number(process.env.BB_NODE_POLL_MS) || undefined });
nodeControl.start();
const dashboardApi = createDashboardApi({ rpc });

// ---------- HTTP API ----------
const body = (req) => new Promise((res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { res(b ? JSON.parse(b) : {}); } catch { res({}); } }); });
const routes = {
  "GET /api/status": async () => ({ game: !!game, rpc: !!rpcSock, port: PORT }),
  "POST /api/eval": async (b) => rpc("eval", { code: b.code, timeoutMs: b.timeoutMs }),
  "POST /api/js": async (b) => rpc("js", { code: b.code }),
  "POST /api/read": async (b) => rpc("read", { file: b.file }),
  "POST /api/write": async (b) => rpc("write", { file: b.file, data: b.data, mode: b.mode }),
  "POST /api/note": async (b) => rpc("note", { msg: b.msg }),
  "POST /api/checkin": async () => { // legacy shape: warn stays a string
    const rec = await checkin.run({ manual: true });
    return rec.ok ? { ok: true, value: { report: rec.report, attention: rec.attention, warn: rec.warn.join("\n"), nextMin: rec.nextMin } } : { ok: false, error: rec.error };
  },
  "GET /api/report": async () => ({ ok: true, value: await checkin.getReport() }),
  "POST /api/notify": async (b) => {
    if (typeof b.text !== "string" || !b.text.trim()) throw Object.assign(new Error("text must be a non-empty string"), { status: 400 });
    await notifier.discordText(b.text);
    return { ok: true };
  },
  // On-demand end-to-end test of the container -> Claude routine path (no dedupe state touched).
  "POST /api/escalate-test": async () => {
    if (!notifier.escalationEnabled) throw Object.assign(new Error(`escalation ${C.escalationStatus}`), { status: 400 });
    const r = await notifier.fireRoutine("[TEST] Bitburner escalation test — no action needed. Reply with the current report and 'Notes: escalation test OK'.");
    return r.ok ? { ok: true, url: r.url } : { ok: false, error: "routine fire failed (see server log)" };
  },
  // Settings (schema: game/lib/settings-schema.js). GET returns schema + effective values; POST {set, unset, rev?} patches.
  "GET /api/settings": async () => settingsApi.get(),
  "POST /api/settings": async (b) => settingsApi.patch(b),
  // Aug planner output (data/aug-plan.txt). Read-only: destruction is controlled by settings only, never by an endpoint.
  "GET /api/plan": async () => readPlan(rpc),
  // KPIs shown by the in-game dashboard (game/lib/kpi.js), computed from the same small files. Read-only.
  "GET /api/dashboard": async () => dashboardApi.get(),
  "POST /api/remote": async (b) => remote(b.method, b.params || {}),
  "POST /api/pull": async (b) => pull(remote, b),
  "POST /api/push": async (b) => push(remote, b),
  "POST /api/import-save": async (b) => importSave(b.b64),
  "POST /api/backup": async () => backup({ rpc: rpcSock ? rpc : null, remote: game ? remote : null }),
};

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  const route = `${req.method} ${req.url.split("?")[0]}`;
  if (route === "GET /healthz") { // unauthenticated, process-level only: 200 whenever this server is alive
    const l = await checkin.getLatest().catch(() => null);
    return send(200, { ok: true, game: !!game, rpc: !!rpcSock, lastCheckinAgeMin: l ? Math.round((Date.now() - l.atMs) / 6000) / 10 : null });
  }
  if ((req.headers.authorization || "") !== `Bearer ${TOKEN}`) return send(401, { ok: false, error: "bad token" });
  const fn = routes[route];
  if (!fn) return send(404, { ok: false, error: "no route" });
  try { send(200, await fn(await body(req))); } catch (e) { send(e.status || 500, { ok: false, error: e.message }); }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, sock, head) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/rpc" && u.searchParams.get("token") !== TOKEN) { log("rpc rejected: bad token"); sock.destroy(); return; }
  // The game's Remote API socket is unauthenticated, so it is only accepted at "/" from a direct local connection.
  // Anything proxied (Caddy adds X-Forwarded-For) or on another path (e.g. a public /api/* upgrade) is refused;
  // otherwise any client could pose as the game and be handed the token in agent/rpc-config.txt.
  if (u.pathname !== "/rpc" && (u.pathname !== "/" || req.headers["x-forwarded-for"])) { log("upgrade rejected:", u.pathname); sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, (ws) => {
    if (u.pathname === "/rpc") {
      rpcSock = ws; log("rpc bridge connected");
      checkin.onRpcUp().catch((e) => log("checkin onRpcUp:", e.message));
      ws.on("message", (d) => { let m; try { m = JSON.parse(d); } catch { return; } const p = rpcPending.get(m.id); if (!p) return; rpcPending.delete(m.id); clearTimeout(p.timer); p.res(m); });
      ws.on("close", () => { if (rpcSock === ws) { rpcSock = null; checkin.onRpcDown(); } log("rpc bridge disconnected"); });
    } else {
      game = ws; onGameConnect();
      if (rpcSock) checkin.onRpcUp().catch((e) => log("checkin onRpcUp:", e.message));
      ws.on("message", onGameMessage);
      ws.on("close", () => { if (game === ws) { game = null; checkin.onRpcDown(); } log("game disconnected"); });
    }
  });
});

server.listen(PORT, HOST, () => { log(`bb server on ${HOST}:${PORT} — token in .bb-token`); if (watchdog.start()) log(`watchdog started (${C.WATCHDOG_MIN} min)`); });

// scheduled save backups (default every 60 min; BB_BACKUP_MIN=0 disables)
const every = Number(process.env.BB_BACKUP_MIN ?? 60);
if (every > 0) setInterval(() => { if (game || rpcSock) backup({ rpc: rpcSock ? rpc : null, remote: game ? remote : null }).then((r) => log("backup", r.file)).catch((e) => log("backup failed:", e.message)); }, every * 60000);
