// RAM neutrality of node.targets / BN15 / early warning (docs/specs/node-targets.md): the RAM-costing Netscript names reachable from
// each script that imports the changed libs (lib/augplan.js, lib/nodectl.js, lib/settings-schema.js, lib/ui/*) equal the set measured
// on main before the change (fixtures/node-targets-ram-baseline.json). Same static model as test/ram-xp-static.js.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GAME } from "./helpers/game-import.js";

const costly = new Set(JSON.parse(fs.readFileSync(new URL("./fixtures/ns-costly-names.json", import.meta.url), "utf8")));
const base = JSON.parse(fs.readFileSync(new URL("./fixtures/node-targets-ram-baseline.json", import.meta.url), "utf8"));
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

test("every script that imports the changed libs reaches exactly the RAM-costing names it reached before", () => {
  for (const e of Object.keys(base)) {
    const now = names(e);
    console.log(`     ${e}: ${now.length} RAM-costing names (baseline ${base[e].length})`);
    assert.deepEqual(now, base[e], `${e} RAM-costing names changed`);
  }
});
test("the changed libs add no RAM-costing names (augplan.js only has the local variable `hack` it already had on main), no DOM globals, no timers", () => {
  const existing = { "lib/augplan.js": ["hack"] };
  for (const f of ["lib/augplan.js", "lib/nodectl.js", "lib/settings-schema.js", "lib/ui/settings-model.js"]) {
    const ids = idsOf(fs.readFileSync(path.join(GAME, f), "utf8"));
    assert.deepEqual([...ids].filter((i) => costly.has(i)).sort(), existing[f] || [], f);
    for (const bad of ["window", "document", "setInterval", "setTimeout"]) assert.ok(!ids.has(bad), `${f}: ${bad}`);
  }
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} ram-node-targets test(s) failed`); process.exit(1); }
console.log(`ram-node-targets: ${tests.length} passed`);
