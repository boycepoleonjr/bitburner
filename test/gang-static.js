// Static checks for the gang module: RAM gates (gang.js <= 16 GB, gang-shop.js <= 12 GB), no RAM-costing identifiers in the pure
// libs, no DOM/timers, and no imports in scripts that run on pserv-sing (daemon-lite copies the sl-* scripts there alone).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GAME } from "./helpers/game-import.js";

const costly = new Set(JSON.parse(fs.readFileSync(new URL("./fixtures/ns-costly-names.json", import.meta.url), "utf8")));
const table = JSON.parse(fs.readFileSync(new URL("./fixtures/gang-ram-costs.json", import.meta.url), "utf8"));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const stripStrings = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, " ");
const idsOf = (src) => new Set(stripStrings(src).match(/[A-Za-z_$][\w$]*/g) || []);

function graph(entry) {
  const seen = new Map(), q = [path.join(GAME, entry)];
  while (q.length) {
    const f = q.shift();
    if (seen.has(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    seen.set(f, src);
    for (const m of src.matchAll(/\bfrom\s+"([^"]+)"/g)) q.push(m[1].startsWith(".") ? path.resolve(path.dirname(f), m[1]) : path.join(GAME, m[1]));
  }
  return seen;
}
/** Static RAM like bitburner's analyzer: 1.6 GB base + every RAM-costing name referenced anywhere in the import graph, once. */
function ram(entry) {
  const names = new Set();
  for (const src of graph(entry).values()) for (const id of idsOf(src)) if (costly.has(id)) names.add(id);
  const unknown = [...names].filter((n) => !(n in table.costs));
  assert.deepEqual(unknown, [], `${entry} references RAM-costing names with no cost in test/fixtures/gang-ram-costs.json`);
  return { gb: table.base + [...names].reduce((a, n) => a + table.costs[n], 0), names: [...names].sort() };
}

test("RAM gate: agent/gang.js <= 16 GB and agent/gang-shop.js <= 12 GB (the one-shots are small too)", () => {
  const r = Object.fromEntries(["agent/gang.js", "agent/gang-shop.js", "agent/gang-act.js", "agent/gang-info.js"].map((f) => [f, ram(f)]));
  console.log("     static RAM:", Object.entries(r).map(([f, x]) => `${f} ${x.gb.toFixed(2)} GB`).join(", "));
  assert.ok(r["agent/gang.js"].gb <= 16, `gang.js ${r["agent/gang.js"].gb} GB: ${r["agent/gang.js"].names}`);
  assert.ok(r["agent/gang-shop.js"].gb <= 12, `gang-shop.js ${r["agent/gang-shop.js"].gb} GB`);
  assert.ok(r["agent/gang-act.js"].gb <= 12 && r["agent/gang-info.js"].gb <= 12);
  // gang.js is read-only toward the game: every mutating gang call lives in a one-shot
  for (const bad of ["createGang", "recruitMember", "setMemberTask", "setTerritoryWarfare", "purchaseEquipment", "ascendMember"]) assert.ok(!r["agent/gang.js"].names.includes(bad), `gang.js must not call ${bad}`);
});
test("pure libs: no RAM-costing identifiers, no DOM globals", () => {
  for (const f of ["lib/gangformulas.js", "lib/gangplan.js"]) {
    const ids = idsOf(fs.readFileSync(path.join(GAME, f), "utf8"));
    assert.deepEqual([...ids].filter((i) => costly.has(i)), [], f);
    for (const bad of ["window", "document", "setInterval", "setTimeout"]) assert.ok(!ids.has(bad), `${f} uses ${bad}`);
  }
});
test("scripts that run on pserv-sing have no imports and read no data/ files (it only holds the sl-* scripts)", () => {
  for (const f of ["agent/sl-crime.js", "agent/sl-work.js"]) {
    const src = fs.readFileSync(path.join(GAME, f), "utf8");
    assert.ok(!/^\s*import\s/m.test(stripStrings(src).replace(/\*[^\n]*/g, "")), `${f} imports a module`);
    assert.ok(!/ns\.read\(/.test(src), `${f} reads a file`);
  }
});
test("every sl-* script daemon-lite can run is in its SL list (pserv-sing sizing + scp)", () => {
  const dl = fs.readFileSync(path.join(GAME, "agent/daemon-lite.js"), "utf8");
  const sl = dl.match(/const SL = \[([^\]]*)\]/)[1];
  for (const f of fs.readdirSync(path.join(GAME, "agent")).filter((x) => /^sl-/.test(x) && !["sl-plan.js", "sl-destroy.js"].includes(x))) assert.ok(sl.includes(`agent/${f}`), `${f} missing from SL`);
});
test("the new one-shots have no imports (they only need ns)", () => {
  for (const f of ["agent/gang-act.js", "agent/gang-shop.js", "agent/gang-info.js"]) assert.ok(!/^import\s/m.test(fs.readFileSync(path.join(GAME, f), "utf8")), f);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} gang-static test(s) failed`); process.exit(1); }
console.log(`gang-static: ${tests.length} passed`);
