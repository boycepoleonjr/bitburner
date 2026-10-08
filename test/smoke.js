// Smoke test: starts the server, fakes the game's Remote API client and agent/rpc.js, exercises the CLI routes,
// the cached report, Discord/escalation sinks (local HTTP), auth on /healthz vs /api/*, and the watchdog restart action.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sink = { discord: [], fire: [] };
const sinkSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    if (req.url === "/discord") sink.discord.push(JSON.parse(b));
    if (req.url === "/fire") sink.fire.push({ headers: req.headers, body: JSON.parse(b) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(req.url === "/fire" ? JSON.stringify({ type: "routine_fire", claude_code_session_url: "https://claude.ai/code/session_x" }) : "{}");
  });
});
await new Promise((r) => sinkSrv.listen(0, "127.0.0.1", r));
const S = `http://127.0.0.1:${sinkSrv.address().port}`;

const PORT = 13525, TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bbk-")), MARK = path.join(TMP, "watchdog-fired");
// The CLI under test must only reach this local server, never a real game named by the caller's environment.
const { BB_URL, BB_TOKEN_VIA_PROXY, ...callerEnv } = process.env;
const env = {
  ...callerEnv, NODE_ENV: "test", BB_TOKEN: "smoketoken", BB_PORT: String(PORT), BB_BACKUP_DIR: path.join(TMP, "backups"), BB_BACKUP_MIN: "0",
  BB_STATE_DIR: path.join(TMP, "state"), DISCORD_WEBHOOK_URL: `${S}/discord`, BB_ESCALATE_URL: `${S}/fire`, BB_ESCALATE_TOKEN: "esc",
  BB_WATCHDOG_MIN: "0.02", BB_WATCHDOG_CMD: "/usr/bin/touch", BB_WATCHDOG_ARGS: JSON.stringify([MARK]), BB_WATCHDOG_INTERVAL_MS: "200",
};
const srv = spawn("node", ["server/index.js"], { env, stdio: "inherit" });
const SAVE_B64 = Buffer.from(JSON.stringify({ ctor: "BitburnerSaveObject", data: { pad: "x".repeat(2000) } })).toString("base64");
const files = { "agent/x.js": "export async function main(ns){}", "data/telemetry.txt": "big" };
const REPORT = "REPORT **Bitburner check-in · 8:00 AM ET**\n\n| | |\n|---|---|\n| Status | ATTENTION — x |\n| Money | $1.0m |";
let checkinJsCalls = 0;
const api = async (route, { method = "GET", token = "smoketoken", body } = {}) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${route}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body });
  return { status: r.status, json: await r.json() };
};
try {
  await sleep(600);
  const game = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  game.on("message", (d) => { const m = JSON.parse(d); let result;
    if (m.method === "pushFile") { files[m.params.filename] = m.params.content; result = "OK"; }
    else if (m.method === "getFileNames") result = Object.keys(files);
    else if (m.method === "getAllFiles") result = Object.entries(files).map(([filename, content]) => ({ filename, content }));
    else if (m.method === "getSaveFile") result = { identifier: "x", binary: false, save: "{\"save\":1}" };
    game.send(JSON.stringify({ jsonrpc: "2.0", id: m.id, result })); });
  await sleep(500);
  const cfg = JSON.parse(files["agent/rpc-config.txt"]);
  const rpc = new WebSocket(`ws://127.0.0.1:${cfg.port}/rpc?token=${cfg.token}`);
  rpc.on("message", (d) => { const m = JSON.parse(d); const idb = m.op === "js" && m.code.includes("indexedDB"); // backup reads the save from IndexedDB
    if (m.op === "js" && m.code.includes("__checkin")) checkinJsCalls++;
    const value = idb ? { b64: SAVE_B64 } : m.op === "ping" ? { t: 1 } : m.op === "js" ? { report: REPORT, attention: ["x"], warn: "w", nextMin: 20, did: [] } : `${m.op}:${m.code || m.file || ""}`;
    rpc.send(JSON.stringify({ id: m.id, ok: true, value })); });
  await sleep(300);
  const bb = async (...a) => (await promisify(execFile)("node", ["server/cli.js", ...a], { env })).stdout.trim();
  const out = { status: await bb("status"), eval: await bb("eval", "return 1"), checkin: await bb("checkin"), backup: await bb("backup"), rpcPushed: !!files["agent/rpc.js"] };
  const callsAfterCheckin = checkinJsCalls;
  out.report = await bb("report");
  const callsAfterReport = checkinJsCalls;
  const legacy = await api("/api/checkin", { method: "POST", body: "{}" });
  await sleep(900); // let detached Discord/escalation dispatch finish
  const rep = await api("/api/report");
  const health = await api("/healthz", { token: null });
  const unauth = await Promise.all(["/api/report", "/api/checkin", "/api/notify"].map((r) => api(r, r === "/api/report" ? { token: null } : { method: "POST", token: null, body: "{}" })));
  const nBefore = sink.discord.length;
  const notifyOk = await api("/api/notify", { method: "POST", body: JSON.stringify({ text: "hello from test" }) });
  const notifyBad = await api("/api/notify", { method: "POST", body: JSON.stringify({ text: "  " }) });
  const escTestNoAuth = await api("/api/escalate-test", { method: "POST", token: null, body: "{}" });
  const escTest = await api("/api/escalate-test", { method: "POST", body: "{}" });
  await sleep(200);
  const embedPosts = sink.discord.filter((p) => p.embeds);
  // watchdog: drop the game and the rpc bridge; after BB_WATCHDOG_MIN (1.2 s) the allowlisted restart command runs
  // (rpc alone gone with the game connected only alerts; covered in unit.js)
  rpc.close(); game.close();
  for (let i = 0; i < 30 && !fs.existsSync(MARK); i++) await sleep(200);

  const checks = {
    status: out.status.includes('"rpc": true'),
    eval: out.eval.includes("eval:return 1"),
    checkin: out.checkin.startsWith("REPORT"),
    backup: out.backup.includes('"ok": true'),
    rpcPushed: out.rpcPushed,
    reportCached: out.report.startsWith("REPORT") && out.report.includes("Stale: no") && out.report.includes("- x") && callsAfterReport === callsAfterCheckin,
    legacyWarnString: legacy.json.ok === true && typeof legacy.json.value.warn === "string",
    reportRoute: rep.json.ok && typeof rep.json.value.ageMin === "number" && rep.json.value.stale === false && Array.isArray(rep.json.value.latest.warn),
    healthzNoAuth: health.status === 200 && health.json.ok === true && health.json.rpc === true,
    apiNeedsAuth: unauth.every((r) => r.status === 401),
    discordEmbed: embedPosts.length >= 1 && embedPosts[0].username === "Bitburner" && embedPosts[0].embeds.length === 1 && embedPosts[0].embeds[0].color === 0xed4245,
    escalateTest: escTestNoAuth.status === 401 && escTest.json.ok === true && sink.fire.length === 2 && sink.fire[1].body.text.startsWith("[TEST]"),
    escalatedOnce: sink.fire.length >= 1 && sink.fire[0].headers["anthropic-beta"] === "experimental-cc-routine-2026-04-01" && /Attention:\n- x/.test(sink.fire[0].body.text),
    sessionLinkPosted: sink.discord.some((p) => p.content === "escalated to Claude: https://claude.ai/code/session_x"),
    notifyRelay: notifyOk.status === 200 && sink.discord.slice(nBefore).some((p) => p.content === "hello from test"),
    notifyBadRequest: notifyBad.status === 400,
    watchdogFired: fs.existsSync(MARK),
  };
  console.log(JSON.stringify(checks, null, 1));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? "SMOKE OK" : "SMOKE FAIL"); process.exitCode = ok ? 0 : 1;
  game.close();
} finally { srv.kill(); sinkSrv.close(); }
