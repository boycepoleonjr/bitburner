// Smoke test: starts the server, fakes the game's Remote API client and agent/rpc.js, exercises the CLI routes.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
const PORT = 13525, env = { ...process.env, BB_PORT: String(PORT), BB_BACKUP_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "bbk-")), BB_BACKUP_MIN: "0" };
const srv = spawn("node", ["server/index.js"], { env, stdio: "inherit" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = { "agent/x.js": "export async function main(ns){}", "data/telemetry.txt": "big" };
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
  rpc.on("message", (d) => { const m = JSON.parse(d); rpc.send(JSON.stringify({ id: m.id, ok: true, value: m.op === "js" ? { report: "REPORT", attention: [], nextMin: 20 } : `${m.op}:${m.code || m.file || ""}` })); });
  await sleep(300);
  const bb = async (...a) => (await promisify(execFile)("node", ["server/cli.js", ...a], { env })).stdout.trim();
  const out = { status: await bb("status"), eval: await bb("eval", "return 1"), checkin: await bb("checkin"), backup: await bb("backup"), rpcPushed: !!files["agent/rpc.js"] };
  console.log(JSON.stringify(out, null, 1));
  const ok = out.status.includes('"rpc": true') && out.eval.includes("eval:return 1") && out.checkin.startsWith("REPORT") && out.backup.includes('"ok": true') && out.rpcPushed;
  console.log(ok ? "SMOKE OK" : "SMOKE FAIL"); process.exitCode = ok ? 0 : 1;
  game.close(); rpc.close();
} finally { srv.kill(); }
