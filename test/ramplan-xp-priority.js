// xp over share while hack level is the bottleneck (docs/specs/ram-xp-priority.md): allocate() branch, golden equality with
// the pre-change allocation, repNeededFrom, and the daemon-level ram-status result. Fixture: test/fixtures/ramplan-allocate-golden.json.
import assert from "node:assert/strict";
import fs from "node:fs";
import { allocate, repNeededFrom } from "../game/lib/ramplan.js";
import { grid } from "./helpers/ramplan-grid.js";
import { importGame } from "./helpers/game-import.js";
import { fakeGame, testConfig, runTicks } from "./helpers/fake-game.js";

const GOLDEN = JSON.parse(fs.readFileSync(new URL("./fixtures/ramplan-allocate-golden.json", import.meta.url), "utf8"));
const cases = [...grid()];
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const sum = (a) => a.moneyGb + a.shareGb + a.xpGb + a.idleGb;
const BN10 = { usableGb: 75e6, weight: 1, repActive: true, hackNeed: true, demandGb: 140_000, xpMode: "auto", shareEnabled: true };
/** The xp-priority branch applies to exactly these inputs when repNeeded === false. */
const branch = (c) => c.shareEnabled && c.repActive && c.hackNeed && c.xpMode !== "off" && c.weight * c.usableGb > 0;

test("golden: fixture covers the whole grid", () => assert.equal(GOLDEN.length, cases.length));
test("golden: repNeeded omitted -> byte-identical to the pre-change allocation (all cases)", () => {
  cases.forEach((c, i) => assert.equal(JSON.stringify(allocate(c)), GOLDEN[i], JSON.stringify(c)));
});
test("golden: repNeeded true (rep still the bottleneck) -> byte-identical (all cases)", () => {
  cases.forEach((c, i) => assert.equal(JSON.stringify(allocate({ ...c, repNeeded: true })), GOLDEN[i], JSON.stringify(c)));
});
test("golden: repNeeded false but the branch does not apply -> byte-identical (hackNeed false, repActive false, share off, xp off, zero weight/RAM)", () => {
  let n = 0;
  cases.forEach((c, i) => { if (!branch(c)) { n++; assert.equal(JSON.stringify(allocate({ ...c, repNeeded: false })), GOLDEN[i], JSON.stringify(c)); } });
  assert.ok(n > 500, `${n} unchanged cases checked`);
});
test("golden: repNeeded false and the branch applies -> share 0, allocation differs from today, sum = usable", () => {
  let n = 0;
  cases.forEach((c, i) => {
    if (!branch(c)) return;
    n++;
    const a = allocate({ ...c, repNeeded: false }), old = JSON.parse(GOLDEN[i]);
    assert.equal(a.shareGb, 0, JSON.stringify(c));
    assert.notEqual(JSON.stringify(a), GOLDEN[i]);
    assert.ok(a.xpGb >= old.xpGb, "xp never loses RAM");
    assert.ok(a.moneyGb >= old.moneyGb, "money never loses RAM");
    assert.ok(Math.abs(sum(a) - c.usableGb) < 1e-6 * c.usableGb);
    assert.equal(a.moneyGb, Math.min(c.usableGb, c.demandGb), "money keeps its claim at the weight-0 level");
    assert.equal(a.xpGb, c.usableGb - a.moneyGb, "xp gets everything money does not need");
  });
  assert.ok(n > 20, `${n} branch cases`);
});

test("hackNeed true + rep met (BN10 numbers): xp gets the RAM, share 0, reason text explains it", () => {
  const old = allocate(BN10), a = allocate({ ...BN10, repNeeded: false });
  assert.deepEqual([old.moneyGb, old.shareGb, old.xpGb], [0, 75e6, 0], "today's bug");
  assert.deepEqual([a.moneyGb, a.shareGb, a.xpGb], [140_000, 0, 75e6 - 140_000]);
  assert.ok(a.reasons.some((r) => /xp priority/.test(r) && /no aug step needs faction rep/.test(r)), a.reasons.join(" | "));
  assert.ok(a.reasons.some((r) => /surplus -> xp \(hacking level is the constraint\)/.test(r)));
});
test("hackNeed true + rep still needed: unchanged (share keeps its weight)", () => {
  const a = allocate({ ...BN10, repNeeded: true });
  assert.equal(JSON.stringify(a), JSON.stringify(allocate(BN10)));
  assert.equal(a.shareGb, 75e6); assert.equal(a.xpGb, 0);
});
test("hackNeed false + rep met: unchanged (surplus still prefers share)", () => {
  const c = { ...BN10, weight: 0.5, demandGb: 200, usableGb: 1000, hackNeed: false };
  assert.equal(JSON.stringify(allocate({ ...c, repNeeded: false })), JSON.stringify(allocate(c)));
  assert.equal(allocate({ ...c, repNeeded: false }).shareGb, 800);
});
test("repActive false: unchanged (no share to move)", () => {
  const c = { ...BN10, repActive: false };
  assert.equal(JSON.stringify(allocate({ ...c, repNeeded: false })), JSON.stringify(allocate(c)));
});
test("zero / invalid usable RAM and zero weight: no branch, invariants hold", () => {
  for (const c of [{ ...BN10, usableGb: 0 }, { ...BN10, usableGb: NaN }, { ...BN10, usableGb: -5 }, { ...BN10, weight: 0 }]) {
    assert.equal(JSON.stringify(allocate({ ...c, repNeeded: false })), JSON.stringify(allocate(c)), JSON.stringify(c));
  }
  assert.equal(sum(allocate({ ...BN10, usableGb: 0, repNeeded: false })), 0);
});
test("xp.mode=off and share disabled: unchanged", () => {
  for (const c of [{ ...BN10, xpMode: "off" }, { ...BN10, shareEnabled: false }]) assert.equal(JSON.stringify(allocate({ ...c, repNeeded: false })), JSON.stringify(allocate(c)));
  assert.equal(allocate({ ...BN10, xpMode: "off", repNeeded: false }).xpGb, 0, "off still means off");
});
test("demand >= usable: money takes everything, xp 0 (hacking is RAM-bound)", () => {
  const a = allocate({ ...BN10, usableGb: 1000, demandGb: 5000, repNeeded: false });
  assert.deepEqual([a.moneyGb, a.shareGb, a.xpGb], [1000, 0, 0]);
});
test("invariants over 1000 seeded random inputs incl. repNeeded", () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let i = 0; i < 1000; i++) {
    const inp = { usableGb: pick([0, rnd() * 10, rnd() * 1e6, rnd() * 7.5e7, NaN, -5]), weight: pick([0, 0.5, 1, rnd(), -1, 2, NaN]), repActive: rnd() < 0.5,
      hackNeed: rnd() < 0.5, demandGb: pick([0, rnd() * 1e5, rnd() * 1e8, NaN, -1]), xpMode: pick(["auto", "off", "always"]), shareEnabled: rnd() < 0.8,
      repNeeded: pick([true, false, undefined]) };
    const a = allocate(inp), usable = Number.isFinite(inp.usableGb) && inp.usableGb > 0 ? inp.usableGb : 0;
    for (const k of ["moneyGb", "shareGb", "xpGb", "idleGb"]) assert.ok(Number.isFinite(a[k]) && a[k] >= 0, `${k} ${JSON.stringify(inp)}`);
    assert.ok(Math.abs(sum(a) - usable) <= 1e-6 * Math.max(1, usable), `sum ${JSON.stringify(inp)}`);
    if (!inp.repActive || !inp.shareEnabled) assert.equal(a.shareGb, 0);
    if (inp.xpMode === "off") assert.equal(a.xpGb, 0);
    if (inp.repNeeded !== false) assert.equal(JSON.stringify(a), JSON.stringify(allocate({ ...inp, repNeeded: undefined })));
  }
});

// ── repNeededFrom ───────────────────────────────────────────────────────────
const NOW = 1e12;
const plan = (o = {}) => JSON.stringify({ t: NOW - 60_000, redPill: { owned: true, repReq: 2.5e6, rep: 3e6 }, steps: [], ...o });
const step = (status, o = {}) => ({ aug: "X", faction: "F", status, why: "", ...o });
test("repNeededFrom: unknown plan = needed (missing, empty, garbage, no steps, no t)", () => {
  for (const raw of [undefined, "", "{bad", "null", JSON.stringify({ t: NOW, redPill: {} }), JSON.stringify({ steps: [] })]) {
    const r = repNeededFrom(raw, NOW); assert.equal(r.needed, true, String(raw)); assert.match(r.why, /unavailable/);
  }
});
test("repNeededFrom: stale plan = needed; boundary at exactly 10 min is still fresh", () => {
  assert.match(repNeededFrom(plan({ t: NOW - 10 * 60_000 - 1 }), NOW).why, /stale/);
  assert.equal(repNeededFrom(plan({ t: NOW - 10 * 60_000 }), NOW).needed, false);
});
test("repNeededFrom: nothing outstanding = not needed (needMoney, buyable, blocked, held NeuroFlux)", () => {
  const steps = [step("buyable"), step("needMoney"), step("blocked"), step("needRep", { aug: "NeuroFlux Governor", why: "held: hacking is near w0r1d_d43m0n's requirement" })];
  assert.deepEqual(repNeededFrom(plan({ steps }), NOW), { needed: false, why: "no aug step needs faction rep" });
});
test("repNeededFrom: a needRep step (not held) = needed, names aug and faction", () => {
  const r = repNeededFrom(plan({ steps: [step("buyable"), step("needRep", { aug: "Cranial Signal Processors", faction: "CyberSec" })] }), NOW);
  assert.equal(r.needed, true); assert.match(r.why, /Cranial Signal Processors \(CyberSec\)/);
});
test("repNeededFrom: Red Pill rep short = needed; exactly met = not needed; owned = not needed", () => {
  assert.equal(repNeededFrom(plan({ redPill: { owned: false, repReq: 2.5e6, rep: 2.5e6 - 1 } }), NOW).needed, true);
  assert.equal(repNeededFrom(plan({ redPill: { owned: false, repReq: 2.5e6, rep: 2.5e6 } }), NOW).needed, false, "boundary: exactly met");
  assert.equal(repNeededFrom(plan({ redPill: { owned: false, repReq: 2.5e6, rep: 3e6 } }), NOW).needed, false);
  assert.equal(repNeededFrom(plan({ redPill: { owned: true, repReq: 2.5e6, rep: 0 } }), NOW).needed, false);
  assert.equal(repNeededFrom(plan({ redPill: { owned: false, repReq: 2.5e6 } }), NOW).needed, true, "rep unknown = needed");
});
test("repNeededFrom -> allocate: the boundary end to end", () => {
  const at = (rep) => allocate({ ...BN10, repNeeded: repNeededFrom(plan({ redPill: { owned: false, repReq: 2.5e6, rep } }), NOW).needed });
  assert.equal(at(2.5e6 - 1).xpGb, 0); assert.ok(at(2.5e6).xpGb > 0);
});

// ── daemon level: ram-status shows it ───────────────────────────────────────
const { tick } = await importGame("daemon.js");
const { DEFAULTS, merge } = await importGame("lib/config.js");
const { freshState } = await importGame("lib/state.js");
const cfg = testConfig(DEFAULTS, merge);
function bn10(planObj) {
  const g = fakeGame({ homeRam: 2 ** 22, targets: 10, hack: 2000, ownedAugs: ["The Red Pill"] }); // hack 2000 < Daedalus 2500: hackNeed; Red Pill owned: late, weight 1
  g.files["data/autopilot-status.txt"] = JSON.stringify({ t: g.now, work: "FACTION:The Black Hand" });
  if (planObj) g.files["data/aug-plan.txt"] = JSON.stringify({ t: g.now, ...planObj });
  runTicks(g, tick, cfg, freshState(), 4);
  return JSON.parse(g.files["data/ram-status.txt"]);
}
test("daemon: rep met + hack short -> ram-status alloc.xp > 0, share 0, reasons say why", () => {
  const rs = bn10({ redPill: { owned: true, repReq: 2.5e6, rep: 3e6 }, steps: [] });
  assert.equal(rs.hackNeed, true); assert.equal(rs.repActive, true); assert.equal(rs.weight, 1);
  assert.ok(rs.alloc.xp > 0.9 * rs.usableGb, `xp ${rs.alloc.xp} of ${rs.usableGb}`); assert.equal(rs.alloc.share, 0);
  assert.ok(rs.reasons.some((r) => /xp priority/.test(r)) && rs.reasons.some((r) => /no aug step needs faction rep/.test(r)));
  assert.ok(rs.running.xp > 0, "xp loops actually run");
});
test("daemon: rep still needed, missing plan, or stale plan -> today's allocation (share, no xp)", () => {
  const needRep = bn10({ redPill: { owned: true, repReq: 2.5e6, rep: 3e6 }, steps: [step("needRep")] });
  assert.equal(needRep.alloc.xp, 0); assert.equal(needRep.alloc.share, needRep.usableGb);
  assert.ok(needRep.reasons.some((r) => /rep needed: X \(F\)/.test(r)));
  const none = bn10(null);
  assert.equal(none.alloc.xp, 0); assert.ok(none.reasons.some((r) => /aug-plan unavailable/.test(r)));
  const g = fakeGame({ homeRam: 2 ** 22, targets: 10, hack: 2000, ownedAugs: ["The Red Pill"] });
  g.files["data/autopilot-status.txt"] = JSON.stringify({ t: g.now, work: "FACTION:x" });
  g.files["data/aug-plan.txt"] = JSON.stringify({ t: g.now - 11 * 60_000, redPill: { owned: true }, steps: [] });
  runTicks(g, tick, cfg, freshState(), 4);
  const st = JSON.parse(g.files["data/ram-status.txt"]);
  assert.equal(st.alloc.xp, 0); assert.ok(st.reasons.some((r) => /aug-plan stale/.test(r)));
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} ramplan-xp-priority test(s) failed`); process.exit(1); }
console.log(`ramplan-xp-priority: ${tests.length} passed`);
