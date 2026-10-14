// bb push path handling: game/-relative paths, accepted prefixes, all-or-nothing failure, live state never pushed.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { push, pushPath } from "../server/sync.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// A fake game/ folder and a remote that records every pushFile call.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbsync-"));
  const put = (f, c) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); };
  put("tools/goals.js", "goals");
  put("tools/status.js", "status");
  put("data/settings.txt", "live");
  put("AGENTS.txt", "stale copy");
  const calls = [];
  const remote = async (method, params) => { calls.push({ method, ...params }); return "OK"; };
  return { dir, calls, remote };
}
const sent = (calls) => calls.map((c) => c.filename);

test("pushPath strips game/, ./ and leading /", () => {
  for (const p of ["tools/goals.js", "game/tools/goals.js", "./game/tools/goals.js", "/tools/goals.js", "game\\tools\\goals.js"]) assert.equal(pushPath(p), "tools/goals.js", p);
});

test("game/-relative and repo-relative paths push the same file", async () => {
  for (const p of ["tools/goals.js", "game/tools/goals.js"]) {
    const { dir, calls, remote } = fixture();
    const r = await push(remote, { only: [p] }, dir);
    assert.deepEqual(r, { ok: true, pushed: ["tools/goals.js"] }, p);
    assert.deepEqual(calls, [{ method: "pushFile", server: "home", filename: "tools/goals.js", content: "goals" }]);
  }
});

test("unmatched path fails the whole push and sends nothing", async () => {
  const { dir, calls, remote } = fixture();
  const r = await push(remote, { only: ["tools/goals.js", "tools/nope.js"] }, dir);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["tools/nope.js"]);
  assert.match(r.error, /not found under game\/: tools\/nope\.js/);
  assert.deepEqual(calls, []);
});

test("paths outside game/ never match", async () => {
  const { dir, calls, remote } = fixture();
  const r = await push(remote, { only: ["../server/sync.js"] }, dir);
  assert.equal(r.ok, false);
  assert.deepEqual(calls, []);
});

test("data/ and AGENTS.txt are refused as live state, not reported missing", async () => {
  const { dir, calls, remote } = fixture();
  const r = await push(remote, { only: ["game/data/settings.txt", "AGENTS.txt"] }, dir);
  assert.equal(r.ok, false);
  assert.deepEqual(r.excluded, ["data/settings.txt", "AGENTS.txt"]);
  assert.deepEqual(r.missing, []);
  assert.match(r.error, /never pushed \(live state\)/);
  assert.deepEqual(calls, []);
});

test("no paths: pushes all code, skips data/, adds AGENTS.txt from AGENTS.md", async () => {
  const { dir, calls, remote } = fixture();
  const r = await push(remote, {}, dir);
  assert.equal(r.ok, true);
  assert.deepEqual(sent(calls).sort(), ["AGENTS.txt", "tools/goals.js", "tools/status.js"]);
  assert.notEqual(calls.find((c) => c.filename === "AGENTS.txt").content, "stale copy");
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); }
}
if (failed) { console.error(`${failed} sync test(s) failed`); process.exit(1); }
console.log(`sync: ${tests.length} passed`);
