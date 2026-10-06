#!/usr/bin/env node
// bb CLI — talks to the local bb server.
//   bb status | checkin | report | pull | push [file..] | backup | import-save <save.json.gz>   (BB_URL=https://<host> for hosted)
//   Auth: BB_TOKEN, else the local .bb-token; BB_TOKEN_VIA_PROXY=1 sends no header (an egress proxy injects it;
//   needs Node >= 22.21, whose fetch only uses HTTPS_PROXY with NODE_USE_ENV_PROXY=1, so the CLI re-runs itself with it)
//   bb eval '<ns code, async body, use return>'      bb js '<page JS, async body>'
//   bb read <file> | bb write <file> < stdin | bb note "<msg>" | bb remote <method> '<json params>'
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { PORT, HOST, cliAuthHeader } from "./config.js";

const [cmd, ...args] = process.argv.slice(2);
const call = async (route, payload, method = "POST") => {
  const base = process.env.BB_URL || `http://${HOST}:${PORT}`; // BB_URL=https://<host> for the hosted game
  const r = await fetch(`${base}/api/${route}`, { method, headers: { ...auth, "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(payload || {}) });
  return r.json();
};
const stdin = () => fs.readFileSync(0, "utf8");
const map = {
  status: () => call("status", null, "GET"),
  checkin: () => call("checkin"),
  report: () => call("report", null, "GET"),
  pull: () => call("pull"),
  push: () => call("push", args.length ? { only: args } : {}),
  backup: () => call("backup"),
  "import-save": () => call("import-save", { b64: fs.readFileSync(args[0]).toString("base64") }), // hosted only
  eval: () => call("eval", { code: args[0] ?? stdin() }),
  js: () => call("js", { code: args[0] ?? stdin() }),
  read: () => call("read", { file: args[0] }),
  write: () => call("write", { file: args[0], data: stdin(), mode: args[1] }),
  note: () => call("note", { msg: args.join(" ") }),
  remote: () => call("remote", { method: args[0], params: JSON.parse(args[1] || "{}") }),
};
if (!map[cmd]) { console.error("usage: bb status|checkin|report|pull|push|backup|import-save|eval|js|read|write|note|remote"); process.exit(1); }
if (process.env.BB_TOKEN_VIA_PROXY === "1" && process.env.NODE_USE_ENV_PROXY !== "1") {
  const r = spawnSync(process.execPath, ["--no-warnings", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status ?? 1);
}
let auth;
try { auth = cliAuthHeader(); } catch (e) { console.error(e.message); process.exit(1); }
map[cmd]().then((r) => {
  if (cmd === "read" && r.ok) process.stdout.write(r.value);
  else if (cmd === "report" && r.ok && r.value) {
    const { latest: l, ageMin, stale } = r.value;
    console.log(l ? `REPORT\n${l.ok ? l.report : `(last check-in failed: ${l.error})`}` : "REPORT\n(no check-in recorded yet)");
    console.log(`\nAge: ${ageMin ?? "—"} min\nStale: ${stale ? "yes" : "no"}`);
    if (l?.attention?.length) console.log("Attention:\n" + l.attention.map((a) => `- ${a}`).join("\n"));
  }
  else if (cmd === "checkin" && r.ok && r.value) console.log(r.value.report + (r.value.attention?.length ? `\n\nATTENTION: ${JSON.stringify(r.value.attention)}` : "") + `\nnextMin=${r.value.nextMin}`);
  else console.log(JSON.stringify(r, null, 2));
  if (r && r.ok === false && cmd === "report") process.exitCode = 1;
}).catch((e) => { console.error("bb server unreachable:", e.message); process.exit(2); });
