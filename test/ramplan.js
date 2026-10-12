// lib/ramplan.js: allocation, target extension, resize hysteresis, EMA, work signal, hack need, status shape.
import assert from "node:assert/strict";
import { allocate, chooseExtraTargets, resizePlan, ema, repActiveFrom, hackNeedFrom, daedalusReqs, pow2Floor, buildStatus } from "../game/lib/ramplan.js";
import { strategyNow } from "../game/lib/progress.js";
import { defaults } from "../game/lib/settings-schema.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const sum = (a) => a.moneyGb + a.shareGb + a.xpGb + a.idleGb;
const base = { usableGb: 1000, weight: 0.5, repActive: true, hackNeed: false, demandGb: 200, xpMode: "auto", shareEnabled: true };

test("allocate: weights 0 / 0.5 / 1 with faction work active", () => {
  const w0 = allocate({ ...base, weight: 0 });
  assert.deepEqual([w0.moneyGb, w0.shareGb, w0.xpGb], [200, 800, 0]); // money capped by demand, surplus -> share
  const w5 = allocate(base);
  assert.deepEqual([w5.moneyGb, w5.shareGb, w5.xpGb], [200, 800, 0]); // 500 by weight + 300 surplus
  const w1 = allocate({ ...base, weight: 1 });
  assert.deepEqual([w1.moneyGb, w1.shareGb], [0, 1000]); // owner's "all faction rep"
  const big = allocate({ ...base, weight: 0.25, demandGb: 5000 });
  assert.deepEqual([big.moneyGb, big.shareGb], [750, 250]);
});
test("allocate: no faction work -> share 0, money first, surplus to xp", () => {
  const a = allocate({ ...base, repActive: false });
  assert.deepEqual([a.moneyGb, a.shareGb, a.xpGb], [200, 0, 800]);
  assert.ok(a.reasons.some((r) => /no faction work/.test(r)));
});
test("allocate: xp modes and hack need", () => {
  assert.equal(allocate({ ...base, hackNeed: true }).xpGb, 300, "hack need beats share for the surplus");
  assert.equal(allocate({ ...base, xpMode: "always" }).xpGb, 300);
  const off = allocate({ ...base, repActive: false, xpMode: "off" });
  assert.deepEqual([off.xpGb, off.idleGb], [0, 800]);
  assert.equal(allocate({ ...base, hackNeed: true, xpMode: "off" }).xpGb, 0);
  assert.equal(allocate({ ...base, shareEnabled: false }).shareGb, 0);
  assert.equal(allocate({ ...base, shareEnabled: false }).xpGb, 800);
});
test("allocate: zero RAM, NaN / negative / Infinity inputs clamp with reasons", () => {
  const z = allocate({ ...base, usableGb: 0 });
  assert.equal(sum(z), 0);
  const bad = allocate({ usableGb: NaN, weight: 7, demandGb: -3, repActive: true });
  assert.equal(sum(bad), 0);
  assert.ok(bad.reasons.some((r) => /invalid/.test(r)) && bad.reasons.some((r) => /clamped/.test(r)));
  assert.equal(allocate({ ...base, usableGb: Infinity }).moneyGb, 0);
});
test("allocate: invariants over 1000 random inputs", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let i = 0; i < 1000; i++) {
    const inp = {
      usableGb: pick([0, rnd() * 10, rnd() * 1e6, rnd() * 6.7e7, NaN, -5]), weight: pick([0, 0.5, 1, rnd(), -1, 2, NaN]),
      repActive: rnd() < 0.5, hackNeed: rnd() < 0.5, demandGb: pick([0, rnd() * 1e5, rnd() * 1e8, NaN, -1]),
      xpMode: pick(["auto", "off", "always"]), shareEnabled: rnd() < 0.8,
    };
    const a = allocate(inp);
    const usable = Number.isFinite(inp.usableGb) && inp.usableGb > 0 ? inp.usableGb : 0;
    for (const k of ["moneyGb", "shareGb", "xpGb", "idleGb"]) assert.ok(Number.isFinite(a[k]) && a[k] >= 0, `${k} ${JSON.stringify(inp)}`);
    assert.ok(Math.abs(sum(a) - usable) <= 1e-6 * Math.max(1, usable), `sum ${JSON.stringify(inp)}`);
    assert.ok(a.moneyGb <= Math.max(0, Number.isFinite(inp.demandGb) ? inp.demandGb : 0) + 1e-9);
    if (!inp.repActive || !inp.shareEnabled) assert.equal(a.shareGb, 0);
    if (inp.xpMode === "off") assert.equal(a.xpGb, 0);
    assert.ok(a.reasons.length > 0 && a.reasons.every((r) => typeof r === "string"));
  }
});
test("phase via progress feeds the weight allocate uses", () => {
  const S = defaults();
  const early = strategyNow({ augsInstalled: 0, augsReq: 30, money: 1e6, moneyReq: 1e11, hack: 50, hackReq: 2500 }, false, S);
  const late = strategyNow({ augsInstalled: 30, augsReq: 30, money: 1e12, moneyReq: 1e11, hack: 3000, hackReq: 2500 }, false, S);
  assert.equal(early.phase, "early"); assert.equal(early.weight, 0);
  assert.equal(late.phase, "late"); assert.equal(late.weight, 1);
  assert.equal(allocate({ ...base, weight: early.weight, demandGb: 5000 }).shareGb, 0);
  assert.equal(strategyNow({}, true, S).phase, "late"); // Red Pill override
});
test("chooseExtraTargets: ranked order, skips misfits, respects slots", () => {
  const c = [{ host: "a", demandGb: 50 }, { host: "b", demandGb: 500 }, { host: "c", demandGb: 30 }, { host: "d", demandGb: 0 }];
  assert.deepEqual(chooseExtraTargets(c, 100), { hosts: ["a", "c"], demandGb: 80 });
  assert.deepEqual(chooseExtraTargets(c, 1000, 1).hosts, ["a"]);
  assert.deepEqual(chooseExtraTargets(c, -5).hosts, []);
});
test("resizePlan: hysteresis band, shrink largest-first, grow, stop", () => {
  const p = (pid, ramGb) => ({ pid, ramGb });
  assert.equal(resizePlan({ targetGb: 105, procs: [p(1, 100)], threshold: 0.1, unitGb: 4 }).reason, "within hysteresis");
  assert.deepEqual(resizePlan({ targetGb: 105, procs: [p(1, 100)], threshold: 0.1, unitGb: 4 }).kill, []);
  const grow = resizePlan({ targetGb: 200, procs: [p(1, 100)], threshold: 0.1, unitGb: 4 });
  assert.deepEqual([grow.kill, grow.spawnGb], [[], 100]);
  const shrink = resizePlan({ targetGb: 50, procs: [p(1, 20), p(2, 80)], threshold: 0.1, unitGb: 4 });
  assert.deepEqual(shrink.kill, [2]); assert.equal(shrink.spawnGb, 30);
  assert.deepEqual(resizePlan({ targetGb: 0, procs: [p(1, 8)], threshold: 0.5, unitGb: 4 }).kill, [1]);
  assert.equal(resizePlan({ targetGb: 2, procs: [], unitGb: 4 }).spawnGb, 0);
});
test("ema: first sample, time weighting, no dt", () => {
  assert.equal(ema(NaN, 0.5, 1000), 0.5);
  assert.equal(ema(0.5, 1, 0), 0.5);
  const e = ema(0, 1, 300000);
  assert.ok(e > 0.6 && e < 0.64); // 1 - 1/e
});
test("repActiveFrom: autopilot wins, telemetry fallback, stale => false", () => {
  const now = 1e12;
  assert.deepEqual(repActiveFrom({ autopilotRaw: JSON.stringify({ t: now - 1000, work: "FACTION:The Black Hand" }), now }), { active: true, source: "autopilot-status" });
  assert.equal(repActiveFrom({ autopilotRaw: JSON.stringify({ t: now - 1000, work: "COMPANY:x" }), now }).active, false);
  const tele = JSON.stringify({ t: now - 30000, work: { type: "FACTION", name: "NiteSec" } });
  assert.deepEqual(repActiveFrom({ autopilotRaw: JSON.stringify({ t: now - 999999, work: "FACTION:x" }), telemetryLine: tele, now }), { active: true, source: "telemetry" });
  assert.deepEqual(repActiveFrom({ autopilotRaw: "{bad", telemetryLine: JSON.stringify({ t: now - 200000, work: { type: "FACTION" } }), now }), { active: false, source: "stale" });
  assert.equal(repActiveFrom({ now }).active, false);
});
test("hackNeedFrom + daedalusReqs + pow2Floor", () => {
  assert.equal(hackNeedFrom({ hack: 100, hackReq: 2500 }).need, true);
  assert.equal(hackNeedFrom({ hack: 3000, hackReq: 2500, worldReq: 4500 }).need, true);
  assert.equal(hackNeedFrom({ hack: 3000, hackReq: 2500, servers: [{ host: "x", rooted: true, owned: false, maxMoney: 1, reqHack: 3500 }] }).need, true);
  assert.equal(hackNeedFrom({ hack: 3000, hackReq: 2500, servers: [{ host: "x", rooted: true, owned: true, maxMoney: 1, reqHack: 9999 }] }).need, false);
  assert.deepEqual(daedalusReqs(""), { augs: 30, money: 100e9, hack: 2500, source: "fallback" });
  assert.equal(daedalusReqs(JSON.stringify({ augs: 40 })).augs, 40);
  assert.equal(daedalusReqs("{x").source, "fallback");
  assert.deepEqual([pow2Floor(1), pow2Floor(2), pow2Floor(1000), pow2Floor(NaN)], [0, 2, 512, 0]);
});
test("buildStatus: exact dashboard contract shape", () => {
  const s = buildStatus({ t: 1, enabled: true, phase: "mid", progress: 0.5, weight: 0.5, usableGb: NaN, alloc: { money: 1 }, activeTargets: [{ host: "a", kind: "farm", batches: 2, ramGb: 3 }] });
  assert.deepEqual(Object.keys(s), ["t", "enabled", "phase", "progress", "weight", "repActive", "hackNeed", "usableGb", "alloc", "running", "util", "activeTargets", "cloud", "sharePower", "reasons"]);
  assert.deepEqual(Object.keys(s.alloc), ["money", "share", "xp"]);
  assert.deepEqual(Object.keys(s.running), ["money", "share", "xp"]);
  assert.deepEqual(Object.keys(s.util), ["instant", "ema5"]);
  assert.deepEqual(Object.keys(s.cloud), ["count", "limit", "minGb", "maxGb", "spentThisLoop"]);
  assert.deepEqual(s.activeTargets, [{ host: "a", kind: "farm", batches: 2, ramGb: 3 }]);
  assert.equal(s.usableGb, 0);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} ramplan test(s) failed`); process.exit(1); }
console.log(`ramplan: ${tests.length} passed`);
