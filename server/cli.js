#!/usr/bin/env node
// bb CLI — talks to the local bb server.
//   bb status | checkin | pull | push [file..] | backup
//   bb eval '<ns code, async body, use return>'      bb js '<page JS, async body>'
//   bb read <file> | bb write <file> < stdin | bb note "<msg>" | bb remote <method> '<json params>'
import fs from "node:fs";
import { PORT, HOST, loadToken } from "./config.js";

const [cmd, ...args] = process.argv.slice(2);
const call = async (route, payload, method = "POST") => {
  const r = await fetch(`http://${HOST}:${PORT}/api/${route}`, { method, headers: { authorization: `Bearer ${loadToken()}`, "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(payload || {}) });
  return r.json();
};
const stdin = () => fs.readFileSync(0, "utf8");
const map = {
  status: () => call("status", null, "GET"),
  checkin: () => call("checkin"),
  pull: () => call("pull"),
  push: () => call("push", args.length ? { only: args } : {}),
  backup: () => call("backup"),
  eval: () => call("eval", { code: args[0] ?? stdin() }),
  js: () => call("js", { code: args[0] ?? stdin() }),
  read: () => call("read", { file: args[0] }),
  write: () => call("write", { file: args[0], data: stdin(), mode: args[1] }),
  note: () => call("note", { msg: args.join(" ") }),
  remote: () => call("remote", { method: args[0], params: JSON.parse(args[1] || "{}") }),
};
if (!map[cmd]) { console.error("usage: bb status|checkin|pull|push|backup|eval|js|read|write|note|remote"); process.exit(1); }
map[cmd]().then((r) => {
  if (cmd === "read" && r.ok) process.stdout.write(r.value);
  else if (cmd === "checkin" && r.ok && r.value) console.log(r.value.report + (r.value.attention?.length ? `\n\nATTENTION: ${JSON.stringify(r.value.attention)}` : "") + `\nnextMin=${r.value.nextMin}`);
  else console.log(JSON.stringify(r, null, 2));
}).catch((e) => { console.error("bb server unreachable:", e.message); process.exit(2); });
