// RAM neutrality of the xp-priority change: the RAM-costing Netscript names reachable from daemon.js and agent/autopilot.js
// (same static model as test/gang-static.js) equal the set measured on main before the change, and lib/ramwatch.js has none.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GAME } from "./helpers/game-import.js";

const costly = new Set(JSON.parse(fs.readFileSync(new URL("./fixtures/ns-costly-names.json", import.meta.url), "utf8")));
const base = JSON.parse(fs.readFileSync(new URL("./fixtures/ram-xp-static-baseline.json", import.meta.url), "utf8"));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, " ");
const idsOf = (s) => new Set(strip(s).match(/[A-Za-z_$][\w$]*/g) || []);
function names(entry) {
  const seen = new Set(), q = [path.join(GAME, entry)], out = new Set();
  while (q.length) {
    const f = q.shift(); if (seen.has(f)) continue; seen.add(f);
    const src = fs.readFileSync(f, "utf8");
    for (const id of idsOf(src)) if (costly.has(id)) out.add(id);
    for (const m of src.matchAll(/\bfrom\s+"([^"]+)"/g)) q.push(m[1].startsWith(".") ? path.resolve(path.dirname(f), m[1]) : path.join(GAME, m[1]));
  }
  return [...out].sort();
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("daemon.js and agent/autopilot.js reach exactly the RAM-costing names they reached before the change", () => {
  for (const e of Object.keys(base)) {
    const now = names(e);
    console.log(`     ${e}: ${now.length} RAM-costing names (baseline ${base[e].length})`);
    assert.deepEqual(now, base[e], `${e} RAM-costing names changed`);
  }
});
test("autopilot does not reach lib/ramplan.js (its `share` would add Netscript RAM there)", () => {
  assert.ok(!names("agent/autopilot.js").includes("share"));
  assert.ok(!/lib\/ramplan\.js/.test(fs.readFileSync(path.join(GAME, "lib/ramwatch.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")));
});
test("lib/ramwatch.js and lib/ramplan.js: ramplan.js adds no RAM-costing names (daemon-only), no DOM globals, no imports in ramwatch", () => {
  const w = fs.readFileSync(path.join(GAME, "lib/ramwatch.js"), "utf8"), wi = idsOf(w);
  assert.deepEqual([...wi].filter((i) => costly.has(i)), []);
  assert.ok(!/^\s*import\s/m.test(strip(w)));
  const p = idsOf(fs.readFileSync(path.join(GAME, "lib/ramplan.js"), "utf8"));
  assert.deepEqual([...p].filter((i) => costly.has(i)).sort(), ["hack", "kill", "share", "spawn"], "ramplan.js: only the names it already had on main");
  for (const bad of ["window", "document", "setInterval", "setTimeout"]) assert.ok(!wi.has(bad) && !p.has(bad), bad);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} ram-xp-static test(s) failed`); process.exit(1); }
console.log(`ram-xp-static: ${tests.length} passed`);
