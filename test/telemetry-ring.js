// lib/telemetry-ring.js + the ring/latest writes in agent/telemetry.js (seeding never re-reads telemetry.txt per sample).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { importGame, GAME } from "./helpers/game-import.js";
import { compactRec, pushRing, ringMaxLines, serializeRing } from "../game/lib/telemetry-ring.js";
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

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} telemetry-ring test(s) failed`); process.exit(1); }
console.log(`telemetry-ring: ${tests.length} passed`);
