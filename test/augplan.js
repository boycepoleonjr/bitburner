// lib/augplan.js: owner rules, destroy vs complete, NeuroFlux last, prereq ordering, donation, install timing,
// BitNode recommendation, data/aug-plan.txt contract. Fixture: real read-only BN5 snapshot (2026-10-08).
import assert from "node:assert/strict";
import fs from "node:fs";
import { importGame } from "./helpers/game-import.js";
import { defaults } from "../game/lib/settings-schema.js";

const A = await importGame("lib/augplan.js");
const { plan, ownerOrder, installDecision, donateThreshold, recommendNextBn, sfLevels, firstAvailable, NFG, RED_PILL, DEFAULT_BN_ORDER } = A;
const BN5 = JSON.parse(fs.readFileSync(new URL("./fixtures/bn5-snapshot.json", import.meta.url), "utf8"));
const S = (o = {}) => ({ ...defaults(), ...o });
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Same aug data, fresh BitNode: nothing installed, small rep in joined factions, Daedalus not joined. */
function fresh({ rep = 50_000, favor = 0, repRate = 50, money = 5e9, income = 2e7, hack = 900 } = {}) {
  const f = clone(BN5);
  Object.assign(f, { installed: [], owned: [], hack, money, income, invites: [], worldDaemon: { exists: false, req: null, root: false } });
  for (const x of Object.values(f.factions)) Object.assign(x, { rep: x.joined ? rep : 0, favor: x.joined ? favor : 0, repRate: x.joined ? repRate : 0 });
  f.factions.Daedalus.joined = false;
  return f;
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("contract: every field of data/aug-plan.txt present with the right types", () => {
  const p = plan({ ...clone(BN5), income: 1e12 }, S());
  for (const k of ["t", "bn", "goal", "phase", "progress", "daedalus", "redPill", "worldDaemon", "steps", "install", "node"]) assert.ok(k in p, k);
  assert.deepEqual(Object.keys(p.daedalus).sort(), ["augsInstalled", "augsReq", "hackReq", "met", "moneyReq"]);
  assert.deepEqual(Object.keys(p.redPill).sort(), ["owned", "rep", "repReq"]);
  assert.deepEqual(Object.keys(p.worldDaemon).sort(), ["hack", "ready", "req"]);
  assert.deepEqual(Object.keys(p.install).sort(), ["next", "policy", "queued"]);
  assert.deepEqual(Object.keys(p.install.next).sort(), ["etaMin", "reason"]);
  assert.deepEqual(Object.keys(p.node).sort(), ["autoDestroy", "autoSelect", "pending", "ready", "recommended"]);
  assert.deepEqual(Object.keys(p.node.pending).sort(), ["detail", "id", "stage"]);
  const q = plan(fresh(), S());
  for (const st of q.steps) {
    assert.deepEqual(Object.keys(st).sort(), ["aug", "etaMin", "faction", "order", "prereqs", "price", "repReq", "status", "why"]);
    assert.ok(["owned", "queued", "buyable", "needRep", "needMoney", "blocked"].includes(st.status));
    assert.ok(st.etaMin === null || Number.isFinite(st.etaMin));
  }
  JSON.parse(JSON.stringify(q)); // serializable, no Infinity
  assert.ok(!JSON.stringify(q).includes("Infinity"));
});
test("BN5 real snapshot: done except NeuroFlux, which is held because w0r1d_d43m0n is ready", () => {
  const p = plan({ ...clone(BN5), income: 1.49e12 }, S());
  assert.equal(p.bn, 5); assert.equal(p.phase, "late"); assert.equal(p.daedalus.met, true); assert.equal(p.daedalus.augsReq, 30);
  assert.equal(p.worldDaemon.req, 4500); assert.equal(p.worldDaemon.ready, true); assert.equal(p.redPill.owned, true);
  assert.deepEqual(p.steps.map((x) => x.aug), [NFG]);
  assert.match(p.steps[0].why, /^held: w0r1d_d43m0n is ready/);
  assert.equal(p.install.next.etaMin, null);
  assert.match(p.install.next.reason, /destroy the BitNode instead/);
  assert.equal(p.node.recommended.bn, 1); // SF1.1 -> 1.2 first
});
test("owner rule: prerequisites immediately before, otherwise highest rep requirement first", () => {
  const augs = { A: { repReq: 100, prereqs: [] }, B: { repReq: 500, prereqs: ["C"] }, C: { repReq: 50, prereqs: [] }, D: { repReq: 300, prereqs: [] } };
  assert.deepEqual(ownerOrder(["A", "B", "C", "D"], augs), ["C", "B", "D", "A"]);
  assert.deepEqual(ownerOrder(["A", "B", "C", "D"], augs, new Set(["C"])), ["B", "D", "A"]);
  // real data: every step comes after its prerequisites
  const p = plan(fresh(), S({ "augs.planner.goal": "complete" }));
  const pos = new Map(p.steps.map((x, i) => [x.aug, i]));
  for (const st of p.steps) for (const pr of st.prereqs) if (pos.has(pr)) assert.ok(pos.get(pr) < pos.get(st.aug), `${pr} before ${st.aug}`);
});
test("NeuroFlux Governor is always the last step", () => {
  for (const goal of ["destroy", "complete"]) {
    const p = plan(fresh(), S({ "augs.planner.goal": goal }));
    const i = p.steps.findIndex((x) => x.aug === NFG);
    assert.ok(i === -1 || i === p.steps.length - 1, goal);
  }
  assert.equal(plan(fresh(), S({ "augs.planner.goal": "complete" })).steps.at(-1).aug, NFG);
});
test("destroy vs complete: destroy is a focused subset; Red Pill blocked until Daedalus invites", () => {
  const d = plan(fresh(), S()), c = plan(fresh(), S({ "augs.planner.goal": "complete" }));
  assert.equal(d.goal, "destroy"); assert.equal(c.goal, "complete");
  assert.ok(d.steps.filter((x) => x.status !== "blocked").length <= c.steps.length);
  const red = d.steps.find((x) => x.aug === RED_PILL);
  assert.equal(red.status, "blocked"); assert.match(red.why, /Daedalus invite/);
  assert.ok(!c.steps.some((x) => x.aug === RED_PILL), "complete only lists purchasable augs");
  // Daedalus joined with rep: Red Pill becomes a real step
  const j = fresh(); j.factions.Daedalus.joined = true; j.factions.Daedalus.rep = 3e6;
  assert.equal(plan(j, S()).steps.find((x) => x.aug === RED_PILL).faction, "Daedalus");
});
test("destroy: Daedalus filler count matches the BN requirement, hacking augs preferred over combat", () => {
  const f = fresh(); f.installed = Object.keys(f.augs).filter((a) => a !== NFG && a !== RED_PILL).slice(0, 25); f.owned = [...f.installed];
  f.hack = 99999; // hacking goal met: only the Daedalus count matters
  const p = plan(f, S());
  const fillers = p.steps.filter((x) => /Daedalus needs/.test(x.why));
  assert.equal(fillers.length, 5);
  const g = fresh(); g.hack = 100;
  const q = plan(g, S());
  assert.ok(q.steps.some((x) => /hacking x/.test(x.why)), "hacking augs added toward w0r1d_d43m0n");
  assert.ok(!q.steps.some((x) => /^Combat Rib/.test(x.aug) && /hacking x/.test(x.why)));
});
test("statuses: buyable consumes cash with the x1.9 ramp; needMoney / needRep / owned excluded", () => {
  const p = plan(fresh({ money: 1e12, rep: 1e9 }), S({ "augs.planner.goal": "complete" }));
  const b = p.steps.filter((x) => x.status === "buyable" && x.aug !== NFG);
  assert.ok(b.length >= 2);
  // simulated prices grow by 1.9 per purchase relative to the fixture's current price
  const base = (a) => BN5.augs[a].price;
  assert.ok(Math.abs(b[1].price / base(b[1].aug) - 1.9) < 1e-6);
  const poor = plan(fresh({ money: 0, rep: 1e9 }), S({ "augs.planner.goal": "complete" }));
  assert.ok(poor.steps.filter((x) => x.aug !== NFG).every((x) => x.status === "needMoney" || x.status === "blocked"));
  const noRep = plan(fresh({ money: 1e15, rep: 0 }), S({ "augs.planner.goal": "complete" }));
  assert.ok(noRep.steps.some((x) => x.status === "needRep"));
  const owned = fresh(); owned.installed = ["DataJack"]; owned.owned = ["DataJack"];
  assert.ok(!plan(owned, S({ "augs.planner.goal": "complete" })).steps.some((x) => x.aug === "DataJack"));
});
test("donation: favor >= max(favorToDonate, augs.donateAtFavor) turns a rep gap into money", () => {
  assert.equal(donateThreshold({ favorToDonate: 150 }, S()), 150);
  assert.equal(donateThreshold({ favorToDonate: 150 }, S({ "augs.donateAtFavor": 100 })), 150, "setting can only raise it");
  assert.equal(donateThreshold({ favorToDonate: 150 }, S({ "augs.donateAtFavor": 400 })), 400);
  const noFavor = plan(fresh({ money: 1e15, rep: 0, favor: 0 }), S({ "augs.planner.goal": "complete" }));
  const withFavor = plan(fresh({ money: 1e15, rep: 0, favor: 200 }), S({ "augs.planner.goal": "complete" }));
  const n = (p) => p.steps.filter((x) => x.status === "buyable").length;
  assert.ok(n(withFavor) > n(noFavor));
  assert.ok(withFavor.steps.some((x) => /donate \$/.test(x.why)));
});
test("install timing: count vs eta policies", () => {
  const st = (status, etaMin, aug = "X") => ({ aug, status, etaMin, why: "" });
  const base = { queued: 0, installAt: 3, recoveryMin: 60, wdReady: false, redPillQueued: false, nfgHold: false };
  const three = [st("buyable", 0, "a"), st("buyable", 0, "b"), st("buyable", 0, "c")];
  assert.equal(installDecision({ ...base, policy: "count", steps: [...three, st("needRep", 10)] }).next.etaMin, 0);
  // eta: next aug in 10 min < 60 min recovery -> wait for it
  const w = installDecision({ ...base, policy: "eta", steps: [...three, st("needRep", 10)] });
  assert.equal(w.next.etaMin, 10); assert.match(w.next.reason, /wait and add it/);
  // eta: next aug in 120 min > recovery -> install now
  assert.equal(installDecision({ ...base, policy: "eta", steps: [...three, st("needRep", 120)] }).next.etaMin, 0);
  // below the minimum batch -> never 0
  const small = installDecision({ ...base, policy: "eta", steps: [three[0], st("needMoney", 0.01)] });
  assert.ok(small.next.etaMin > 0);
  // nothing else coming -> install what we have
  assert.equal(installDecision({ ...base, policy: "eta", steps: [three[0]] }).next.etaMin, 0);
  assert.equal(installDecision({ ...base, policy: "count", steps: [three[0]] }).next.etaMin, 0);
  // Red Pill always now; w0r1d ready always holds
  assert.equal(installDecision({ ...base, policy: "eta", steps: [st("buyable", 0, RED_PILL), st("needRep", 5)] }).next.etaMin, 0);
  assert.equal(installDecision({ ...base, wdReady: true, policy: "count", steps: three }).next.etaMin, null);
  // NeuroFlux-only near the finish holds
  assert.equal(installDecision({ ...base, nfgHold: true, policy: "count", steps: [st("buyable", 0, NFG)] }).next.etaMin, null);
  // queued augs count toward the batch
  assert.equal(installDecision({ ...base, queued: 3, policy: "count", steps: [st("needRep", 30)] }).next.etaMin, 0);
});
test("next BitNode: SF levels after this destroy, maxed nodes skipped, BN12 never maxes", () => {
  const lv = sfLevels([{ n: 1, lvl: 3 }, { n: 4, lvl: 2 }], 4);
  assert.deepEqual(lv, { 1: 3, 4: 3 });
  assert.equal(firstAvailable([1, 4, 2], lv), 2);
  assert.equal(firstAvailable([12], { 12: 50 }), 12);
  assert.equal(recommendNextBn({ bn: 5, sourceFiles: [{ n: 1, lvl: 1 }, { n: 4, lvl: 1 }] }).bn, 1);
  assert.equal(recommendNextBn({ bn: 1, sourceFiles: [{ n: 1, lvl: 2 }] }).bn, 4);
  assert.deepEqual([...new Set(DEFAULT_BN_ORDER)].sort((a, b) => a - b), Array.from({ length: 14 }, (_, i) => i + 1));
});
test("garbage-tolerant: empty snapshot does not throw", () => {
  const p = plan({}, S());
  assert.equal(p.steps.length, 0);
  assert.equal(p.daedalus.augsReq, 30);
  assert.equal(p.worldDaemon.req, 3000);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} augplan test(s) failed`); process.exit(1); }
console.log(`augplan: ${tests.length} passed`);
