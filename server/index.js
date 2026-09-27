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
import { ROOT, PORT, HOST, loadToken } from "./config.js";

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

// ---------- HTTP API ----------
const body = (req) => new Promise((res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { res(b ? JSON.parse(b) : {}); } catch { res({}); } }); });
const routes = {
  "GET /api/status": async () => ({ game: !!game, rpc: !!rpcSock, port: PORT }),
  "POST /api/eval": async (b) => rpc("eval", { code: b.code, timeoutMs: b.timeoutMs }),
  "POST /api/js": async (b) => rpc("js", { code: b.code }),
  "POST /api/read": async (b) => rpc("read", { file: b.file }),
  "POST /api/write": async (b) => rpc("write", { file: b.file, data: b.data, mode: b.mode }),
  "POST /api/note": async (b) => rpc("note", { msg: b.msg }),
  "POST /api/checkin": async () => rpc("js", { code: "eval(bb.read('agent/checkin-lib.txt')); const r = await __checkin(); return {attention:r.attention, warn:r.warn, nextMin:r.nextMin, report:r.report};" }, 300000),
  "POST /api/remote": async (b) => remote(b.method, b.params || {}),
  "POST /api/pull": async (b) => pull(remote, b),
  "POST /api/push": async (b) => push(remote, b),
  "POST /api/backup": async () => backup(remote),
};

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if ((req.headers.authorization || "") !== `Bearer ${TOKEN}`) return send(401, { ok: false, error: "bad token" });
  const fn = routes[`${req.method} ${req.url.split("?")[0]}`];
  if (!fn) return send(404, { ok: false, error: "no route" });
  try { send(200, await fn(await body(req))); } catch (e) { send(500, { ok: false, error: e.message }); }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, sock, head) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/rpc" && u.searchParams.get("token") !== TOKEN) { log("rpc rejected: bad token"); sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, (ws) => {
    if (u.pathname === "/rpc") {
      rpcSock = ws; log("rpc bridge connected");
      ws.on("message", (d) => { let m; try { m = JSON.parse(d); } catch { return; } const p = rpcPending.get(m.id); if (!p) return; rpcPending.delete(m.id); clearTimeout(p.timer); p.res(m); });
      ws.on("close", () => { if (rpcSock === ws) rpcSock = null; log("rpc bridge disconnected"); });
    } else {
      game = ws; onGameConnect();
      ws.on("message", onGameMessage);
      ws.on("close", () => { if (game === ws) game = null; log("game disconnected"); });
    }
  });
});

server.listen(PORT, HOST, () => log(`bb server on ${HOST}:${PORT} — token in .bb-token`));

// scheduled save backups (default every 60 min; BB_BACKUP_MIN=0 disables)
const every = Number(process.env.BB_BACKUP_MIN ?? 60);
if (every > 0) setInterval(() => { if (game) backup(remote).then((r) => log("backup", r.file)).catch((e) => log("backup failed:", e.message)); }, every * 60000);
