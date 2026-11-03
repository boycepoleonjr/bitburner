// lib/ramwatch.js: the "hack-bound but xp starved by share for > 60 min" detector, and its autopilot flags.push wiring.
import "./helpers/game-import.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { xpStarved, xpStarveCheck, STARVE_MIN_MS } from "../game/lib/ramwatch.js";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "game", "agent", "autopilot.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbrw-"));
fs.copyFileSync(src, path.join(dir, "autopilot.mjs"));
let ap;
try { ap = await import(pathToFileURL(path.join(dir, "autopilot.mjs")).href); } finally { fs.rmSync(dir, { recursive: true, force: true }); }

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const T0 = 1e12, MIN = 60_000;
const status = (o = {}, t = T0) => JSON.stringify({ t, enabled: true, hackNeed: true, usableGb: 1000, alloc: { money: 0, share: 1000, xp: 0 }, ...o });
const withAlloc = (alloc) => ({ alloc: { money: 0, share: 0, xp: 0, ...alloc } });

test("starved state: hackNeed, xp 0, share > 90%", () => assert.equal(xpStarved(JSON.parse(status()), T0), true));
test("no flag before 60 min; flag at exactly 60 min and after", () => {
  let since = 0;
  for (const m of [0, 1, 30, 59]) { const r = xpStarveCheck({ sinceMs: since, statusRaw: status({}, T0 + m * MIN), now: T0 + m * MIN }); since = r.since; assert.equal(r.flag, null, `${m} min`); }
  assert.equal(since, T0, "clock started at the first starved sample");
  for (const m of [60, 61, 600]) { const r = xpStarveCheck({ sinceMs: since, statusRaw: status({}, T0 + m * MIN), now: T0 + m * MIN }); assert.match(r.flag, /RAM stuck on share/); assert.equal(r.since, T0); }
  assert.equal(xpStarveCheck({ sinceMs: T0, statusRaw: status({}, T0 + STARVE_MIN_MS - 1), now: T0 + STARVE_MIN_MS - 1 }).flag, null, "59:59.999");
});
test("flag text is constant while the state holds (autopilot audits every change of flags)", () => {
  const a = xpStarveCheck({ sinceMs: T0, statusRaw: status({}, T0 + 61 * MIN), now: T0 + 61 * MIN }).flag;
  const b = xpStarveCheck({ sinceMs: T0, statusRaw: status({}, T0 + 3000 * MIN), now: T0 + 3000 * MIN }).flag;
  assert.equal(a, b);
});
test("every broken condition resets the clock and gives no flag", () => {
  const now = T0 + 120 * MIN;
  const broken = {
    "xp > 0": status(withAlloc({ share: 900, xp: 100 }), now), "share exactly 90% (boundary, not above)": status(withAlloc({ share: 900 }), now),
    "share 85%": status(withAlloc({ share: 850 }), now), "hackNeed false": status({ hackNeed: false }, now), "manager disabled": status({ enabled: false }, now),
    "usable 0": status({ usableGb: 0 }, now), "stale status": status({}, now - 11 * MIN), "missing t": JSON.stringify({ enabled: true, hackNeed: true, usableGb: 1000, alloc: { share: 1000, xp: 0 } }),
    "garbage": "{bad", "empty": "", "null": "null", "no alloc": status({ alloc: null }, now), "NaN-ish alloc": status({ alloc: { share: "x", xp: 0 } }, now),
  };
  for (const [k, raw] of Object.entries(broken)) { const r = xpStarveCheck({ sinceMs: T0, statusRaw: raw, now }); assert.deepEqual([r.since, r.flag], [0, null], k); }
  assert.equal(xpStarveCheck({ sinceMs: T0, statusRaw: status(withAlloc({ share: 901 }), now), now }).since, T0, "share just above 90% keeps the clock");
});
test("a broken sample in the middle restarts the 60 min", () => {
  let since = xpStarveCheck({ sinceMs: 0, statusRaw: status({}, T0), now: T0 }).since;
  since = xpStarveCheck({ sinceMs: since, statusRaw: status(withAlloc({ xp: 5, share: 995 }), T0 + 50 * MIN), now: T0 + 50 * MIN }).since;
  assert.equal(since, 0);
  const r = xpStarveCheck({ sinceMs: since, statusRaw: status({}, T0 + 70 * MIN), now: T0 + 70 * MIN });
  assert.deepEqual([r.since, r.flag], [T0 + 70 * MIN, null]);
});
test("a clock in the future (bad sinceMs) restarts instead of flagging", () => {
  assert.equal(xpStarveCheck({ sinceMs: T0 + 5 * MIN, statusRaw: status({}, T0), now: T0 }).since, T0);
});
test("autopilot wiring: xpStarveStep pushes the flag into flags (existing check-in attention path) and returns the clock", () => {
  const flags = [];
  let since = ap.xpStarveStep(0, status(), T0, flags);
  assert.deepEqual([since, flags.length], [T0, 0]);
  since = ap.xpStarveStep(since, status({}, T0 + 61 * MIN), T0 + 61 * MIN, flags);
  assert.equal(flags.length, 1); assert.match(flags[0], /xp=0 and share>90%/);
  since = ap.xpStarveStep(since, status(withAlloc({ xp: 10, share: 990 }), T0 + 62 * MIN), T0 + 62 * MIN, flags);
  assert.deepEqual([since, flags.length], [0, 1], "xp recovered: clock reset, no new flag");
});
test("autopilot loop calls the step each iteration and the flag reaches the checkin attention list unchanged", () => {
  const code = fs.readFileSync(src, "utf8");
  assert.match(code, /xpStarveSince = xpStarveStep\(xpStarveSince, ns\.read\("\/data\/ram-status\.txt"\), Date\.now\(\), flags\)/);
  assert.match(fs.readFileSync(path.join(path.dirname(src), "checkin-lib.txt"), "utf8"), /for \(const f of st\.flags \|\| \[\]\) out\.attention\.push\(f\)/);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} ramwatch test(s) failed`); process.exit(1); }
console.log(`ramwatch: ${tests.length} passed`);
