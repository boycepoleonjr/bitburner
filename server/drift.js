// Repo -> game drift check. The deployed server's game/ folder is main (Railway auto-deploys on push), so a code file
// whose in-game copy differs means a merge was never `bb push`ed (2026-10: PRs 9-13 sat unpushed for most of BN5).
// One rpc eval hashes the game's copies in place: no 20MB getAllFiles. The check-in adds the result as attention.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";
import { codeFiles } from "./sync.js";

/** 32-bit FNV-1a over UTF-16 code units, as hex. The same source runs in-game (gameHashCode), so both sides agree. */
export const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };

/** {file -> hash} for every code file push would send, plus AGENTS.txt (the game copy of AGENTS.md). */
export function repoManifest(root = ROOT) {
  const m = {};
  for (const f of codeFiles(root)) m[f] = fnv(fs.readFileSync(path.join(root, "game", f), "utf8"));
  const agents = path.join(root, "AGENTS.md");
  if (fs.existsSync(agents)) m["AGENTS.txt"] = fnv(fs.readFileSync(agents, "utf8"));
  return m;
}

/** rpc eval body: hash of each file on home, or null when it is missing. */
export const gameHashCode = (files) => `const F = ${JSON.stringify(files)}; const fnv = ${fnv.toString()};
return F.map((f) => (ns.fileExists(f, "home") ? fnv(ns.read(f)) : null));`;

/** Compare the repo manifest with the game's copies. @returns {{checked:number, differ:string[], missing:string[]}} */
export async function checkDrift({ rpc, root = ROOT, timeoutMs = 60000 }) {
  const m = repoManifest(root), files = Object.keys(m).sort();
  const r = await rpc("eval", { code: gameHashCode(files), timeoutMs }, timeoutMs + 5000);
  if (!r || !r.ok || !Array.isArray(r.value) || r.value.length !== files.length) throw new Error(`drift check failed: ${r?.error || "bad result"}`);
  const differ = [], missing = [];
  files.forEach((f, i) => { if (r.value[i] === null) missing.push(f); else if (r.value[i] !== m[f]) differ.push(f); });
  return { checked: files.length, differ, missing };
}

/** One stable attention line (same drift = same text, so the check-in dedupes it), or null when in sync. */
export function driftAttention({ differ = [], missing = [] } = {}, sha = "") {
  const all = [...differ, ...missing].sort();
  if (!all.length) return null;
  const shown = all.slice(0, 3).join(", ") + (all.length > 3 ? ` +${all.length - 3} more` : "");
  const at = sha ? ` ${String(sha).slice(0, 7)}` : "";
  return `game code drift: ${all.length} file(s) differ from deployed main${at} (${shown}); run bb push + restart the scripts`;
}
