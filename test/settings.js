// Settings: schema integrity, coercion, atomic patches, file parsing, in-game lib, server API, CLI helpers.
import assert from "node:assert/strict";
import { importGame, fakeFsNs } from "./helpers/game-import.js";
import { SCHEMA, GROUPS, BY_KEY, SETTINGS_FILE, SETTINGS_LOG, defaults, coerce, parseFile, effective, applyPatch, serialize, emptyFile } from "../game/lib/settings-schema.js";
import { createSettingsApi } from "../server/settings.js";
import { parseAssignments, formatSettings } from "../server/cli.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------- schema ----------------
test("schema: unique keys, known groups, every default passes its own validator", () => {
  assert.equal(new Set(SCHEMA.map((f) => f.key)).size, SCHEMA.length);
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const f of SCHEMA) {
    assert.ok(groups.has(f.group), `${f.key} group`);
    assert.ok(f.label && f.help && f.ui && f.owner, `${f.key} metadata`);
    const c = coerce(f.key, f.default);
    assert.ok(c.ok, `${f.key} default invalid: ${c.error}`);
    if (f.ui === "slider") assert.ok(f.min != null && f.max != null && f.step > 0, `${f.key} slider bounds`);
    if (f.type === "enum") assert.ok(f.options.includes(f.default));
  }
});
test("schema: owner-mandated defaults", () => {
  const d = defaults();
  assert.equal(d["node.autoSelect"], false);
  assert.equal(d["node.autoDestroy"], false);
  assert.equal(d["node.backupBeforeDestroy"], true);
  assert.equal(d["strategy.early"], 0);
  assert.equal(d["strategy.mid"], 0.5);
  assert.equal(d["strategy.late"], 1);
  assert.deepEqual(BY_KEY["strategy.early"].ends, ["Money", "Faction rep"]);
  assert.equal(d["augs.neuroFluxLast"], true);
  assert.equal(d["augs.donateAtFavor"], 150);
});
test("schema: defaults() returns fresh list copies", () => {
  const a = defaults(); a["node.order"].push(3);
  assert.deepEqual(defaults()["node.order"], []);
});

// ---------------- coerce ----------------
test("coerce: strings from CLI/forms are typed", () => {
  assert.deepEqual(coerce("node.autoDestroy", "true"), { ok: true, value: true });
  assert.deepEqual(coerce("node.autoDestroy", "off"), { ok: true, value: false });
  assert.deepEqual(coerce("strategy.mid", "0.25"), { ok: true, value: 0.25 });
  assert.deepEqual(coerce("ram.homeReserveGb", "256"), { ok: true, value: 256 });
  assert.deepEqual(coerce("node.order", "3,10, 2"), { ok: true, value: [3, 10, 2] });
  assert.deepEqual(coerce("node.order", "[12]"), { ok: true, value: [12] });
  assert.deepEqual(coerce("node.order", ""), { ok: true, value: [] });
});
test("coerce: rejects (never clamps) bad values", () => {
  for (const [k, v] of [["strategy.late", 1.5], ["strategy.late", -0.1], ["ram.homeReserveGb", 1.5], ["ram.homeReserveGb", "abc"],
    ["ram.xp.mode", "sometimes"], ["node.autoSelect", "maybe"], ["node.order", [1, 1]], ["node.order", [15]], ["node.order", "x"],
    ["strategy.mid", NaN], ["strategy.mid", Infinity], ["nope.key", 1]]) {
    assert.equal(coerce(k, v).ok, false, `${k}=${v}`);
  }
});

// ---------------- parse / effective / patch ----------------
test("parseFile: empty, corrupt, non-object, unknown + invalid stored values", () => {
  assert.equal(parseFile("").rev, 0);
  const c = parseFile("{oops"); assert.equal(c.corrupt, true); assert.equal(c.warnings.length, 1);
  assert.equal(parseFile("[1]").corrupt, true);
  const p = parseFile(JSON.stringify({ rev: 4, values: { "strategy.mid": 0.2, "ghost.key": 1, "strategy.late": 9 } }));
  assert.equal(p.rev, 4);
  assert.deepEqual(p.values, { "strategy.mid": 0.2 });
  assert.equal(p.warnings.length, 2);
  assert.equal(effective(p.values)["strategy.late"], 1); // invalid stored value falls back to default
});
test("applyPatch: atomic (one bad key -> nothing applied)", () => {
  const f = parseFile("");
  const r = applyPatch(f, { set: { "strategy.mid": 0.3, "strategy.late": 7 } });
  assert.equal(r.ok, false);
  assert.equal(r.file, f);
  assert.equal(r.errors.length, 1);
});
test("applyPatch: rev bump, changed list, unset, no-op, stale rev", () => {
  let f = parseFile("");
  const r1 = applyPatch(f, { set: { "node.autoDestroy": "true", "strategy.early": 0.2 } }, { actor: "ui", now: 5 });
  assert.equal(r1.ok, true);
  assert.equal(r1.file.rev, 1);
  assert.equal(r1.file.updatedBy, "ui");
  assert.deepEqual(r1.changed.map((c) => c.key).sort(), ["node.autoDestroy", "strategy.early"]);
  f = parseFile(serialize(r1.file));
  const noop = applyPatch(f, { set: { "strategy.early": 0.2 } });
  assert.equal(noop.ok, true); assert.equal(noop.changed.length, 0); assert.equal(noop.file, f);
  const r2 = applyPatch(f, { unset: ["strategy.early"] });
  assert.deepEqual(r2.changed, [{ key: "strategy.early", from: 0.2, to: 0 }]);
  assert.equal(r2.file.rev, 2);
  const stale = applyPatch(f, { set: { "strategy.mid": 0.1 }, rev: 0 });
  assert.equal(stale.ok, false); assert.equal(stale.conflict, true);
  assert.equal(applyPatch(f, { unset: ["ghost"] }).ok, false);
});
test("serialize: round trip, stable order, only overrides stored", () => {
  const r = applyPatch(emptyFile(), { set: { "ui.refreshMs": 2000, "node.order": [10, 2] } }, { actor: "t", now: 1 });
  const txt = serialize(r.file);
  const back = parseFile(txt);
  assert.deepEqual(back.values, { "node.order": [10, 2], "ui.refreshMs": 2000 });
  assert.deepEqual(Object.keys(JSON.parse(txt).values), ["node.order", "ui.refreshMs"]); // schema order
});

// ---------------- in-game lib ----------------
test("lib/settings: read cache, write + log, corrupt file refuses writes", async () => {
  const { readSettings, writeSettings } = await importGame("lib/settings.js");
  const ns = fakeFsNs();
  const a = readSettings(ns);
  assert.equal(a["strategy.late"], 1);
  assert.equal(readSettings(ns), a, "cached object when file unchanged");
  const w = writeSettings(ns, { set: { "strategy.late": 0.75 } }, "ui");
  assert.equal(w.ok, true);
  assert.equal(readSettings(ns)["strategy.late"], 0.75);
  assert.equal(readSettings(ns)._rev, 1);
  assert.match(ns.files[SETTINGS_LOG], /"strategy.late"/);
  assert.equal(writeSettings(ns, { set: { "strategy.late": 2 } }).ok, false);
  ns.files[SETTINGS_FILE] = "{bad";
  assert.equal(readSettings(ns)["strategy.late"], 1);
  assert.equal(writeSettings(ns, { set: { "strategy.late": 0.5 } }).ok, false);
});

// ---------------- server API ----------------
function fakeRpc(files = {}) {
  const calls = [];
  const rpc = async (op, a) => {
    calls.push([op, a.file]);
    if (op === "read") return { ok: true, value: files[a.file] ?? "" };
    if (op === "write") { files[a.file] = a.mode === "a" ? (files[a.file] ?? "") + a.data : a.data; return { ok: true, value: true }; }
    return { ok: false, error: "op" };
  };
  return { rpc, files, calls };
}
test("api: get returns schema + effective values", async () => {
  const { rpc } = fakeRpc();
  const r = await createSettingsApi({ rpc }).get();
  assert.equal(r.ok, true);
  assert.equal(r.value.values["node.autoSelect"], false);
  assert.equal(r.value.schema.length, SCHEMA.length);
  assert.equal(r.value.rev, 0);
});
test("api: patch writes file + log, returns changes; 400 / 409 paths", async () => {
  const { rpc, files } = fakeRpc();
  const api = createSettingsApi({ rpc, nowMs: () => 42 });
  const r = await api.patch({ set: { "strategy.mid": "0.4" }, actor: "agent" });
  assert.deepEqual(r.value.changed, [{ key: "strategy.mid", from: 0.5, to: 0.4 }]);
  assert.equal(JSON.parse(files[SETTINGS_FILE]).rev, 1);
  assert.match(files[SETTINGS_LOG], /"by":"agent"/);
  await assert.rejects(api.patch({ set: { "strategy.mid": 3 } }), (e) => e.status === 400);
  await assert.rejects(api.patch({ set: { "strategy.mid": 0.1 }, rev: 0 }), (e) => e.status === 409);
  await assert.rejects(api.patch({}), (e) => e.status === 400);
  await assert.rejects(api.patch({ set: [1] }), (e) => e.status === 400);
  const ok = await api.patch({ set: { "strategy.mid": 0.1 }, rev: 1 });
  assert.equal(ok.value.rev, 2);
});
test("api: corrupt in-game file -> 409, nothing written", async () => {
  const { rpc, files } = fakeRpc({ [SETTINGS_FILE]: "{bad" });
  await assert.rejects(createSettingsApi({ rpc }).patch({ set: { "strategy.mid": 0.1 } }), (e) => e.status === 409);
  assert.equal(files[SETTINGS_FILE], "{bad");
});
test("api: setting a default pins it once; repeating it does not write", async () => {
  const { rpc, calls, files } = fakeRpc();
  const api = createSettingsApi({ rpc });
  const first = await api.patch({ set: { "strategy.mid": 0.5 } });
  assert.equal(first.value.changed.length, 0, "effective value unchanged");
  assert.deepEqual(JSON.parse(files[SETTINGS_FILE]).values, { "strategy.mid": 0.5 }, "explicit pin stored");
  const writes = calls.filter((c) => c[0] === "write").length;
  await api.patch({ set: { "strategy.mid": 0.5 } });
  assert.equal(calls.filter((c) => c[0] === "write").length, writes);
});

// ---------------- CLI helpers ----------------
test("cli: parseAssignments + formatSettings", () => {
  assert.deepEqual(parseAssignments(["a.b=1", "c=x=y"]), { "a.b": "1", c: "x=y" });
  assert.throws(() => parseAssignments(["novalue"]));
  const v = { schema: SCHEMA, groups: GROUPS, values: effective({ "strategy.mid": 0.2 }), overrides: { "strategy.mid": 0.2 }, rev: 3, updatedBy: "cli", warnings: [] };
  const out = formatSettings(v);
  assert.match(out, /^\* strategy\.mid = 0\.2$/m);
  assert.match(out, /^  node\.autoDestroy = false$/m);
  assert.match(formatSettings(v, "strategy.mid"), /strategy\.mid/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); }
}
if (failed) { console.error(`${failed} settings test(s) failed`); process.exit(1); }
console.log(`settings: ${tests.length} passed`);
