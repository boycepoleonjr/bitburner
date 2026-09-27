// Mirror game files <-> repo `game/` folder via the Remote API.
// pull: game -> repo (everything except big/volatile data). push: repo -> game (code only; never overwrites /data live state).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

const DIR = path.join(ROOT, "game");
const SKIP_PULL = [/^data\/telemetry\.txt$/, /^agent\/jobs\//, /^agent\/rpc-config\.txt$/, /\.exe$/, /\.cct$/];
const norm = (f) => f.replace(/^\//, "");

export async function pull(remote, { server = "home" } = {}) {
  const files = await remote("getAllFiles", { server });
  const wrote = [];
  for (const { filename, content } of files) {
    const f = norm(filename);
    if (SKIP_PULL.some((r) => r.test(f))) continue;
    const dest = path.join(DIR, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest) || fs.readFileSync(dest, "utf8") !== content) { fs.writeFileSync(dest, content); wrote.push(f); }
  }
  // AGENTS.md at repo root is canonical; the game copy is AGENTS.txt
  return { ok: true, pulled: files.length, changed: wrote };
}

export async function push(remote, { server = "home", only } = {}) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  let files = walk(DIR).map((p) => path.relative(DIR, p).split(path.sep).join("/")).filter((f) => !f.startsWith("data/") && f !== "AGENTS.txt");
  if (only) files = files.filter((f) => [].concat(only).includes(f));
  const sent = [];
  for (const f of files) { await remote("pushFile", { server, filename: f, content: fs.readFileSync(path.join(DIR, f), "utf8") }); sent.push(f); }
  const agents = path.join(ROOT, "AGENTS.md");
  if (!only && fs.existsSync(agents)) { await remote("pushFile", { server, filename: "AGENTS.txt", content: fs.readFileSync(agents, "utf8") }); sent.push("AGENTS.txt (from AGENTS.md)"); }
  return { ok: true, pushed: sent };
}
