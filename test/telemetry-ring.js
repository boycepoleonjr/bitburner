// lib/telemetry-ring.js + the ring/latest writes in agent/telemetry.js (seeding never re-reads telemetry.txt per sample).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { importGame, GAME } from "./helpers/game-import.js";
import { compactRec, pushRing, ringMaxLines, serializeRing, trimTelemetry, DAY_MS } from "../game/lib/telemetry-ring.js";
import { SCHEMA, coerce } from "../game/lib/settings-schema.js";
import { tailLines, parseJsonl, clampMs } from "../game/lib/data-sources.js";
import { latest } from "./fixtures/dashboard-data.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const pts = (n, t0 = 0, step = 60000) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * step, v: i }));

test("pushRing: trims by count, keeps the newest, keeps order, does not mutate input", () => {
  const ring = pts(5);
  const out = pushRing(ring, { t: 5 * 60000, v: 5 }, { maxLines: 3, now: 5 * 60000 });
  assert.deepEqual(out.map((r) => r.v), [3, 4, 5]);
  assert.equal(ring.length, 5);
});
test("pushRing: trims by age", () => {
  const out = pushRing(pts(10), { t: 10 * 60000, v: 10 }, { maxLines: 100, maxAgeMs: 3 * 60000, now: 10 * 60000 });
  assert.deepEqual(out.map((r) => r.v), [7, 8, 9, 10]);
});
test("pushRing: empty / garbage input, null entry, out-of-order entry", () => {
  assert.deepEqual(pushRing(null, null), []);
  assert.deepEqual(pushRing([null, { t: NaN }, { t: 5 }], { t: 3 }, { now: 10 }).map((r) => r.t), [3, 5]);
});
test("ringMaxLines: history minutes / interval, with sane defaults", () => {
  assert.equal(ringMaxLines(360, 60), 362);
  assert.equal(ringMaxLines(10, 30), 22);
  assert.equal(ringMaxLines(NaN, 0), 362);
});
test("compactRec: small, keeps what charts/KPIs need", () => {
  const c = compactRec(latest);
  assert.equal(c.money, latest.money);
  assert.equal(c.lvl.hacking, 12799);
  assert.deepEqual(c.net, { max: latest.net.max, used: latest.net.used });
  assert.equal(c.mult, undefined);
  assert.ok(JSON.stringify(c).length < JSON.stringify(latest).length / 1.5);
  assert.equal(compactRec(null), null);
});
test("serializeRing / tailLines round trip; tailLines on huge text reads only the end", () => {
  const ring = pts(4);
  const txt = serializeRing(ring);
  assert.deepEqual(parseJsonl(tailLines(txt, 2)).rows.map((r) => r.v), [2, 3]);
  assert.equal(serializeRing([]), "");
  const big = "x".repeat(5e6) + "\n" + '{"a":1}\n\n';
  assert.deepEqual(tailLines(big, 1), ['{"a":1}']);
  assert.deepEqual(tailLines("", 3), []);
  assert.equal(clampMs(10), 250);
  assert.equal(clampMs(undefined, 1000), 1000);
});
test("agent/telemetry.js: seedRing prefers the ring file, else the telemetry.txt tail (compacted)", async () => {
  const { seedRing } = await importGame("agent/telemetry.js");
  const tele = Array.from({ length: 5 }, (_, i) => JSON.stringify({ ...latest, t: i })).join("\n") + "\n";
  const fromTele = seedRing("", tele, 3);
  assert.deepEqual(fromTele.map((r) => r.t), [2, 3, 4]);
  assert.equal(fromTele[0].mult, undefined);
  assert.deepEqual(seedRing('{"t":9}\n', tele, 3).map((r) => r.t), [9]);
});
test("agent/telemetry.js keeps telemetry.txt append-only and writes latest + ring with mode w", () => {
  const src = fs.readFileSync(path.join(GAME, "agent/telemetry.js"), "utf8");
  assert.match(src, /ns\.write\(FILE, JSON\.stringify\(rec\) \+ "\\n", "a"\)/);
  assert.match(src, /ns\.write\(LATEST, JSON\.stringify\(rec\), "w"\)/);
  assert.match(src, /ns\.write\(RING, serializeRing\(ring\), "w"\)/);
  assert.equal((src.match(/ns\.read\(FILE\)/g) || []).length, 1, "telemetry.txt read once (seed), never per sample");
  const launch = fs.readFileSync(path.join(GAME, "agent/tele-launch.js"), "utf8");
  for (const dep of ["lib/telemetry-ring.js", "lib/data-sources.js", "lib/settings.js", "lib/settings-schema.js"]) assert.ok(launch.includes(dep), `tele-launch copies ${dep}`);
});

// ── retention (ledger F-007): ui.telemetryRetentionDays, default 7 ──────────────────────────────
const NOW = 1_800_000_000_000;
const recLine = (t, extra = "") => JSON.stringify({ t, bn: 10, lvl: { hacking: 1 }, ...(extra ? { x: extra } : {}) });
const file = (ages, trailing = true) => ages.map((a) => recLine(NOW - a)).join("\n") + (trailing ? "\n" : "");
const days = (n) => n * DAY_MS;
test("trimTelemetry: drops records older than the window and keeps the rest in order", () => {
  const ages = [days(9), days(8), days(7) + 1000, days(7) - 1000, days(3), days(1), 60000, 0];
  const r = trimTelemetry(file(ages), { now: NOW, maxAgeMs: days(7), minLines: 2 });
  assert.equal(r.dropped, 3); assert.equal(r.kept, 5);
  assert.equal(r.text, file(ages.slice(3)));
});
test("trimTelemetry: a record exactly at the cutoff is kept", () => {
  const r = trimTelemetry(file([days(7), days(7) - 1, 0]), { now: NOW, maxAgeMs: days(7), minLines: 1 });
  assert.equal(r.dropped, 0);
});
test("trimTelemetry: nothing to drop returns the same text; no trailing newline is preserved", () => {
  const t = file([days(2), days(1), 0], false);
  const r = trimTelemetry(t, { now: NOW, maxAgeMs: days(7), minLines: 1 });
  assert.equal(r.text, t); assert.equal(r.dropped, 0);
  const r2 = trimTelemetry(file([days(9), 0], false), { now: NOW, maxAgeMs: days(7), minLines: 1 });
  assert.equal(r2.text, recLine(NOW)); assert.equal(r2.dropped, 1);
});
test("trimTelemetry: retention 0, negative or non-numeric keeps everything", () => {
  const t = file([days(30), days(20), 0]);
  for (const maxAgeMs of [0, -1, NaN, undefined, Infinity, "7"]) assert.equal(trimTelemetry(t, { now: NOW, maxAgeMs, minLines: 1 }).text, t, String(maxAgeMs));
});
test("trimTelemetry: a stale file (newest record over a day old) or a bad clock is left alone", () => {
  const t = file([days(40), days(30), days(20)]);
  assert.equal(trimTelemetry(t, { now: NOW, maxAgeMs: days(7), minLines: 1 }).dropped, 0);
  assert.equal(trimTelemetry(file([days(9), 0]), { now: NaN, maxAgeMs: days(7), minLines: 1 }).dropped, 0);
});
test("trimTelemetry: never leaves fewer than minLines (keeps the last minLines instead)", () => {
  const ages = [days(30), days(20), days(10), days(9), 0];
  const r = trimTelemetry(file(ages), { now: NOW, maxAgeMs: days(7), minLines: 3 });
  assert.equal(r.kept, 3); assert.equal(r.text, file(ages.slice(2)));
  assert.equal(trimTelemetry(file(ages), { now: NOW, maxAgeMs: days(7), minLines: 5 }).dropped, 0, "total <= minLines: unchanged");
});
test("trimTelemetry: lines without a readable t are kept; empty and non-string input do not throw", () => {
  const t = [recLine(NOW - days(9)), "not json", '{"nope":1}', recLine(NOW - days(1)), recLine(NOW)].join("\n") + "\n";
  const r = trimTelemetry(t, { now: NOW, maxAgeMs: days(7), minLines: 1 });
  assert.equal(r.dropped, 1); assert.match(r.text, /not json/); assert.match(r.text, /"nope":1/);
  for (const bad of ["", null, undefined, 42, {}]) assert.equal(trimTelemetry(bad, { now: NOW, maxAgeMs: days(7), minLines: 1 }).dropped, 0);
});
test("trimTelemetry: records written with a different key order are still trimmed (JSON fallback)", () => {
  const old = JSON.stringify({ bn: 1, t: NOW - days(9) }), cur = JSON.stringify({ bn: 1, t: NOW });
  const r = trimTelemetry(old + "\n" + cur + "\n", { now: NOW, maxAgeMs: days(7), minLines: 1 });
  assert.equal(r.text, cur + "\n");
});
test("settings: ui.telemetryRetentionDays defaults to 7 and rejects out-of-range values", () => {
  const f = SCHEMA.find((x) => x.key === "ui.telemetryRetentionDays");
  assert.equal(f.default, 7); assert.equal(f.type, "int");
  for (const ok of [0, 7, 365]) assert.equal(coerce("ui.telemetryRetentionDays", ok).ok, true, String(ok));
  for (const bad of [-1, 366, 7.5, "x"]) assert.equal(coerce("ui.telemetryRetentionDays", bad).ok, false, String(bad));
});
test("agent/telemetry.js trims at start and at most once a day, through the one read of telemetry.txt", () => {
  const src = fs.readFileSync(path.join(GAME, "agent/telemetry.js"), "utf8");
  assert.equal((src.match(/ns\.read\(FILE\)/g) || []).length, 1, "single read site");
  assert.match(src, /seedRing\(ns\.read\(RING\), loadHistory\(\)/);
  assert.match(src, /if \(Date\.now\(\) - lastTrim >= DAY_MS\) \{ lastTrim = Date\.now\(\); loadHistory\(\); \}/);
  assert.match(src, /ns\.write\(FILE, r\.text, "w"\)/);
  assert.match(src, /ui\.telemetryRetentionDays/);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} telemetry-ring test(s) failed`); process.exit(1); }
console.log(`telemetry-ring: ${tests.length} passed`);
