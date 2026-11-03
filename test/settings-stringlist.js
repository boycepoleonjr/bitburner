// augs.order.* settings: the stringList type (input forms, limits, forbidden names), the new keys' defaults, round trip
// through patch/serialize/parse, the settings log, the ListInput JSON mode and the CLI assignment form.
import assert from "node:assert/strict";
import { importGame, fakeFsNs } from "./helpers/game-import.js";
import { SCHEMA, BY_KEY, SETTINGS_FILE, SETTINGS_LOG, defaults, coerce, parseFile, effective, applyPatch, serialize, emptyFile } from "../game/lib/settings-schema.js";
import { parseAssignments } from "../server/cli.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const K = "augs.order.pinned", X = "augs.order.exclude", L = "augs.order.last";
const ok = (key, raw) => { const r = coerce(key, raw); assert.ok(r.ok, `${key} ${JSON.stringify(raw)}: ${r.error}`); return r.value; };
const bad = (key, raw, re) => { const r = coerce(key, raw); assert.equal(r.ok, false, `${key} ${JSON.stringify(raw)} should be rejected`); if (re) assert.match(r.error, re); return r.error; };

test("defaults: sort=rep, lists empty, strict/drivesWork off, wait cap 120", () => {
  const d = defaults();
  assert.equal(d["augs.order.sort"], "rep");
  for (const k of [K, L, X]) assert.deepEqual(d[k], []);
  assert.equal(d["augs.order.strict"], false);
  assert.equal(d["augs.order.drivesWork"], false);
  assert.equal(d["augs.order.strictMaxWaitMin"], 120);
  assert.equal(BY_KEY["augs.neuroFluxLast"].default, true);
  assert.match(BY_KEY["augs.neuroFluxLast"].help, /always bought last/);
});
test("input forms: array, JSON string, pipe string, comma string, empty", () => {
  assert.deepEqual(ok(K, ["A", "B"]), ["A", "B"]);
  assert.deepEqual(ok(K, '["A","B, with comma"]'), ["A", "B, with comma"]);
  assert.deepEqual(ok(K, "A|B, with comma"), ["A", "B, with comma"]);
  assert.deepEqual(ok(K, "A, B,C"), ["A", "B", "C"]);
  assert.deepEqual(ok(K, ""), []);
  assert.deepEqual(ok(K, "   "), []);
  assert.deepEqual(ok(K, "[]"), []);
});
test("entries are trimmed; delimited strings drop empty pieces; arrays with an empty entry are rejected", () => {
  assert.deepEqual(ok(K, ["  A  "]), ["A"]);
  assert.deepEqual(ok(K, "A,, B,"), ["A", "B"]);
  bad(K, ["A", "  "], /must not be empty/);
  bad(K, ["A", 3], /list of strings/);
});
test("invalid shapes are rejected: bad JSON, non-array JSON, numbers, objects", () => {
  bad(K, "[not json", /JSON list/);
  bad(K, '["a":1', /JSON list/);
  bad(K, 5, /list of strings/);
  bad(K, { a: 1 }, /list of strings/);
  bad(K, null, /list of strings/);
});
test("limits: 80-char entries, 200 entries, uniqueness (case-sensitive)", () => {
  ok(K, ["x".repeat(80)]);
  bad(K, ["x".repeat(81)], /<= 80/);
  ok(K, Array.from({ length: 200 }, (_, i) => `a${i}`));
  bad(K, Array.from({ length: 201 }, (_, i) => `a${i}`), /at most 200/);
  bad(K, ["A", "A"], /unique/);
  bad(K, "A,A", /unique/);
  ok(K, ["A", "a"]);
});
test("NeuroFlux is rejected in every list", () => {
  for (const k of [K, L, X]) { bad(k, ["NeuroFlux Governor"], /always last/); bad(k, "A|NeuroFlux Governor", /always last/); bad(k, ["NeuroFlux"], /always last/); }
});
test("The Red Pill is rejected in exclude only", () => {
  bad(X, ["The Red Pill"], /not allowed/);
  bad(X, '["Foo","The Red Pill"]', /not allowed/);
  assert.deepEqual(ok(K, ["The Red Pill"]), ["The Red Pill"]);
  assert.deepEqual(ok(L, ["The Red Pill"]), ["The Red Pill"]);
  assert.deepEqual(ok(X, ["The Red Pill Fake"]), ["The Red Pill Fake"], "exact name match only");
});
test("other new keys: enum, int range, bool", () => {
  assert.equal(ok("augs.order.sort", "price"), "price");
  bad("augs.order.sort", "alphabetical");
  assert.equal(ok("augs.order.strictMaxWaitMin", "0"), 0);
  assert.equal(ok("augs.order.strictMaxWaitMin", 1440), 1440);
  bad("augs.order.strictMaxWaitMin", 1441); bad("augs.order.strictMaxWaitMin", -1); bad("augs.order.strictMaxWaitMin", 1.5);
  assert.equal(ok("augs.order.strict", "on"), true);
});
test("a patch with one invalid order entry changes nothing (atomic)", () => {
  const f = emptyFile();
  const r = applyPatch(f, { set: { [K]: ["A"], [X]: ["The Red Pill"] } }, { actor: "ui", now: 1 });
  assert.equal(r.ok, false); assert.equal(r.file, f); assert.match(r.errors[0], /The Red Pill/);
});
test("round trip: applyPatch -> serialize -> parseFile -> effective; unset restores the default", () => {
  const r = applyPatch(emptyFile(), { set: { [K]: "A|B", [X]: ["C"], "augs.order.sort": "price" } }, { actor: "ui", now: 5 });
  assert.ok(r.ok); assert.equal(r.file.updatedBy, "ui");
  assert.deepEqual(r.changed.map((c) => c.key).sort(), [X, K, "augs.order.sort"].sort());
  const back = parseFile(serialize(r.file));
  assert.deepEqual(back.warnings, []);
  const e = effective(back.values);
  assert.deepEqual(e[K], ["A", "B"]); assert.deepEqual(e[X], ["C"]); assert.equal(e["augs.order.sort"], "price");
  const u = applyPatch(back, { unset: [K, X, "augs.order.sort"] }, { actor: "cli", now: 6 });
  assert.deepEqual(u.file.values, {});
  assert.deepEqual(effective(u.file.values)[K], []);
});
test("a stored invalid list is ignored with a warning (e.g. Red Pill excluded by hand-editing)", () => {
  const raw = JSON.stringify({ version: 1, rev: 3, updatedAt: 1, updatedBy: "x", values: { [X]: ["The Red Pill"], [K]: ["A"] } });
  const f = parseFile(raw);
  assert.deepEqual(f.values, { [K]: ["A"] });
  assert.equal(f.warnings.length, 1);
});
test("writeSettings (in-game lib): one log line per effective change with the actor; no-op writes log nothing", async () => {
  const { readSettings, writeSettings } = await importGame("lib/settings.js");
  const ns = fakeFsNs({});
  const w = writeSettings(ns, { set: { [K]: ["A", "B"], "augs.order.strict": true } }, "ui");
  assert.ok(w.ok);
  const lines = ns.files[SETTINGS_LOG].trim().split("\n");
  assert.equal(lines.length, 1);
  const j = JSON.parse(lines[0]);
  assert.equal(j.by, "ui"); assert.deepEqual(j.changed.map((c) => c.key).sort(), [K, "augs.order.strict"].sort());
  assert.deepEqual(readSettings(ns)[K], ["A", "B"]);
  writeSettings(ns, { set: { [K]: ["A", "B"] } }, "ui");
  assert.equal(ns.files[SETTINGS_LOG].trim().split("\n").length, 1, "same value: no new line");
  assert.equal(writeSettings(ns, { set: { [X]: ["The Red Pill"] } }, "ui").ok, false);
  assert.equal(ns.files[SETTINGS_LOG].trim().split("\n").length, 1);
});
test("CLI assignment form keeps the JSON value intact (names with commas and quotes)", () => {
  const a = parseAssignments(['augs.order.pinned=["The Red Pill","BitRunners Neurolink"]', "augs.order.sort=price"]);
  assert.deepEqual(ok(K, a[K]), ["The Red Pill", "BitRunners Neurolink"]);
  assert.equal(ok("augs.order.sort", a["augs.order.sort"]), "price");
});
test("every stringList key is a list control; none has a non-array default", () => {
  for (const f of SCHEMA.filter((x) => x.type === "stringList")) { assert.equal(f.ui, "list"); assert.ok(Array.isArray(f.default)); }
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} settings-stringlist test(s) failed`); process.exit(1); }
console.log(`settings-stringlist: ${tests.length} passed`);
