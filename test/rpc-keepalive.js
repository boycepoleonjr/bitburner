// rpc.js keepalive (ensureRpc) in game/agent/autopilot.js and game/agent/daemon-lite.js. Game files have no package.json
// type, so each is copied to a temp .mjs and imported; importing only defines functions (main is never called).
import "./helpers/game-import.js"; // maps in-game "lib/..." imports (autopilot.js imports lib/settings.js)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "game", "agent");
async function load(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbrk-"));
  const tmp = path.join(dir, name.replace(/\.js$/, ".mjs"));
  fs.copyFileSync(path.join(root, name), tmp);
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

let n = 0;
for (const file of ["autopilot.js", "daemon-lite.js"]) {
  const { ensureRpc, RPC, RPC_CFG } = await load(file);
  const t = (name, fn) => { try { fn(); } catch (e) { e.message = `[${file}: ${name}] ${e.message}`; throw e; } n++; };
  const go = ({ running = false, hasConfig = true, pid = 42, memo = { failed: false } } = {}) => {
    const runs = [], acts = [];
    const r = ensureRpc({ running: () => running, hasConfig: () => hasConfig, run: () => { runs.push(1); return pid; }, act: (m) => acts.push(m), memo });
    return { r, runs: runs.length, acts, memo };
  };
  t("names", () => { assert.equal(RPC, "agent/rpc.js"); assert.equal(RPC_CFG, "agent/rpc-config.txt"); });
  t("running -> no-op", () => { const g = go({ running: true }); assert.equal(g.runs, 0); assert.deepEqual(g.acts, []); });
  t("no rpc-config (bb server never connected) -> no start", () => { const g = go({ hasConfig: false }); assert.equal(g.runs, 0); assert.deepEqual(g.acts, []); });
  t("not running -> start + one event line", () => {
    const g = go(); assert.equal(g.r, 42); assert.equal(g.runs, 1);
    assert.deepEqual(g.acts, ["agent/rpc.js was not running: restarted it (pid 42)"]);
  });
  t("failed start logged once until a start succeeds", () => {
    const memo = { failed: false };
    const a = go({ pid: 0, memo }), b = go({ pid: 0, memo });
    assert.equal(a.acts.length, 1); assert.match(a.acts[0], /could not be started/); assert.equal(b.acts.length, 0); assert.equal(b.runs, 1);
    go({ memo }); assert.equal(memo.failed, false);
    assert.equal(go({ pid: 0, memo }).acts.length, 1);
  });
}
console.log(`RPC KEEPALIVE OK (${n})`);
