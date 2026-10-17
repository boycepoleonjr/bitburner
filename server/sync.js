// Mirror game files <-> repo `game/` folder via the Remote API.
// pull: game -> repo (everything except big/volatile data). push: repo -> game (code only; never overwrites /data live state).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

const DIR = path.join(ROOT, "game");
const SKIP_PULL = [/^data\/telemetry\.txt$/, /^agent\/jobs\//, /^agent\/rpc-config\.txt$/, /\.exe$/, /\.cct$/];
const norm = (f) => f.replace(/^\//, "");
// `bb push` paths are relative to game/; also accept "game/...", "./..." and "/..." so the repo path works too.
export const pushPath = (f) => String(f).replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").replace(/^game\//, "");
const pushable = (f) => !f.startsWith("data/") && f !== "AGENTS.txt";

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

// Every file under a game/ folder (paths relative to it), live state included.
function gameFiles(dir) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  return walk(dir).map((p) => path.relative(dir, p).split(path.sep).join("/"));
}

/** The repo's in-game code files (paths relative to game/): what push sends, never data/ (live state) or AGENTS.txt
 * (generated from AGENTS.md). Shared with the drift check (server/drift.js). */
export function codeFiles(root = ROOT) {
  return gameFiles(path.join(root, "game")).filter(pushable).sort();
}

// `dir` is a separate argument (tests only), never part of the request body that /api/push passes in as the options.
export async function push(remote, { server = "home", only } = {}, dir = DIR) {
  const all = gameFiles(dir);
  let files = all.filter(pushable).sort();
  if (only) {
    // All-or-nothing: an unmatched path fails the whole push before anything is sent, so `bb push x && bb note` can't log a no-op.
    const want = [...new Set([].concat(only).map(pushPath))];
    const excluded = want.filter((f) => all.includes(f) && !pushable(f));
    const missing = want.filter((f) => !all.includes(f));
    if (excluded.length || missing.length) {
      const why = [missing.length && `not found under game/: ${missing.join(", ")}`, excluded.length && `never pushed (live state): ${excluded.join(", ")}`].filter(Boolean);
      return { ok: false, error: why.join("; "), missing, excluded, pushed: [] };
    }
    files = files.filter((f) => want.includes(f));
  }
  const sent = [];
  for (const f of files) { await remote("pushFile", { server, filename: f, content: fs.readFileSync(path.join(dir, f), "utf8") }); sent.push(f); }
  const agents = path.join(ROOT, "AGENTS.md");
  if (!only && fs.existsSync(agents)) { await remote("pushFile", { server, filename: "AGENTS.txt", content: fs.readFileSync(agents, "utf8") }); sent.push("AGENTS.txt (from AGENTS.md)"); }
  return { ok: true, pushed: sent };
}
