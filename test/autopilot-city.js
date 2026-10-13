// Pure helpers in game/agent/autopilot.js (city-faction invite gate, NeuroFlux batch sizing). The game file has no package.json type, so it is
// copied to a temp .mjs and imported; importing only defines functions (main is never called).
import "./helpers/game-import.js"; // maps in-game "lib/..." imports (autopilot.js imports lib/settings.js)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "game", "agent", "autopilot.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbap-"));
const tmp = path.join(dir, "autopilot.mjs");
fs.copyFileSync(src, tmp);
let mod;
try { mod = await import(pathToFileURL(tmp).href); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
const { cityInviteDecision, handleInvites, nfgAffordable, nfgHold, nfgTrigger, installFreeze, expRate } = mod;

const AUGS = {
  "Sector-12": ["CashRoot Starter Kit", "NeuroFlux Governor"],
  "Aevum": ["PCMatrix", "NeuroFlux Governor"],
  "Volhaven": ["NeuroFlux Governor"],
  "Chongqing": ["NeuroFlux Something", "NeuroFlux Governor"],
  "CyberSec": ["Neurotrainer I"],
};
const augsOf = (f) => AUGS[f] || [];
const owned = new Set(["CashRoot Starter Kit", "Neurotrainer I"]);
const decide = (f, joinCity = ["Sector-12"], o = owned) => cityInviteDecision(f, { joinCity, augsOf, owned: o });

let n = 0;
const t = (name, fn) => {
  try { fn(); } catch (e) { e.message = `[${name}] ${e.message}`; throw e; }
  n++;
};
t("exhausted joinCity city is blocked", () => assert.equal(decide("Sector-12"), "block"));
t("joinCity city with an unowned aug joins", () => assert.equal(decide("Sector-12", ["Sector-12"], new Set()), "join"));
t("non-joinCity city with augs left is flagged", () => assert.equal(decide("Aevum"), "flag"));
t("non-joinCity exhausted city is blocked", () => assert.equal(decide("Aevum", [], new Set(["PCMatrix"])), "block"));
t("NeuroFlux-only city is blocked", () => assert.equal(decide("Volhaven"), "block"));
t("only the exact NeuroFlux Governor name is exempt", () => assert.equal(decide("Chongqing"), "flag"));
t("non-city factions always join", () => assert.equal(decide("CyberSec", [], new Set()), "join"));

const runInvites = ({ invites = ["Sector-12", "Aevum", "CyberSec"], blockedLogged = new Set(), flags = [], join } = {}) => {
  const joined = [], audits = [];
  handleInvites({
    invites, joinCity: ["Sector-12"], augsOf, owned, flags, blockedLogged,
    join: join || ((f) => { joined.push(f); return true; }), act: () => {}, audit: (k, d) => audits.push([k, d.f]),
  });
  return { joined, audits, flags };
};
t("handleInvites: joins non-city, flags non-joinCity city, never joins exhausted Sector-12", () => {
  const r = runInvites();
  assert.deepEqual(r.flags, ["city faction invite pending: Aevum"]);
  assert.deepEqual(r.joined, ["CyberSec"]);
});
t("handleInvites: cityBlocked audited once per blockedLogged set (one autopilot run)", () => {
  const seen = new Set();
  const a = runInvites({ blockedLogged: seen }), b = runInvites({ blockedLogged: seen });
  assert.deepEqual(a.audits, [["cityBlocked", "Sector-12"]]);
  assert.deepEqual(b.audits, []);
});
t("handleInvites: a new run (fresh set) audits again", () => {
  assert.deepEqual(runInvites().audits, [["cityBlocked", "Sector-12"]]);
  assert.deepEqual(runInvites().audits, [["cityBlocked", "Sector-12"]]);
});
t("handleInvites: flags pushed before a later join throws are kept", () => {
  const flags = [];
  assert.throws(() => runInvites({ invites: ["Aevum", "CyberSec"], flags, join: () => { throw new Error("boom"); } }), /boom/);
  assert.deepEqual(flags, ["city faction invite pending: Aevum"]);
});
t("nfgAffordable: counts levels under a growing price", () => {
  assert.equal(nfgAffordable(10, 9, 2), 0);
  assert.equal(nfgAffordable(10, 10, 2), 1);
  assert.equal(nfgAffordable(10, 70, 2), 3); // 10 + 20 + 40
  assert.equal(nfgAffordable(10, 69, 2), 2);
  assert.equal(nfgAffordable(1, 1e9, 1, 5), 5); // capped
  assert.equal(nfgAffordable(0, 1e9, 2), 0); // bad price -> nothing
});
t("nfgAffordable: live-like numbers buy a sensible batch ($9.1q, $4.27b, x2.166)", () => {
  const k = nfgAffordable(4.27e9, 9.1e15);
  assert.ok(k >= 15 && k <= 20, `got ${k}`);
});
t("nfgHold: holds NeuroFlux installs at >= 90% of w0r1d_d43m0n's requirement", () => {
  assert.equal(nfgHold(8099, 9000), false);
  assert.equal(nfgHold(8100, 9000), true);
  assert.equal(nfgHold(8741, 9000), true);
  assert.equal(nfgHold(9500, 9000), true);
  assert.equal(nfgHold(8741, Infinity), false); // no w0r1d_d43m0n yet
  assert.equal(nfgHold(7000, 9000, 0.75), true); // custom frac
  assert.equal(nfgHold(6000, 9000, 0.75), false);
});
t("nfgTrigger: queued levels count toward the trigger", () => {
  assert.equal(nfgTrigger(2, 4, 6), true);  // partial batch of 4 queued + 2 affordable now
  assert.equal(nfgTrigger(0, 6, 6), true);  // full batch already queued
  assert.equal(nfgTrigger(5, 0, 6), false);
  assert.equal(nfgTrigger(0, 0, 0), false);
});
// installFreeze: exp for a level at multiplier m is the inverse of the game's calculateSkill
const expAt = (level, m) => Math.exp((level / m + 200) / 32) - 534.6;
t("installFreeze: late in a run, a 1-level install (BN4.1's tail) loses to holding; a 6-level batch can still win", () => {
  const m = 15, exp = expAt(8800, m), runMin = 14 * 60;          // 14 h into the run, 200 levels short of 9000
  const rate = (expAt(8903, m) - expAt(8719, m)) / 360;           // BN4.2: 8719 -> 8903 took ~6 h
  const base = { hack: 8800, exp, rate, avgRate: exp / runMin, wdReq: 9000 };
  const one = installFreeze({ ...base, gain: 1.01 });
  assert.equal(one.freeze, true, one.why);
  assert.ok(one.etaHold < one.etaInstall);
  assert.match(one.why, /without an install/);
  // +6% level multiplier cuts the exp for 9000 ~3x at m=15, so the batch beats ~8 h of holding
  assert.equal(installFreeze({ ...base, gain: Math.pow(1.01, 6) }).freeze, false);
  // with a higher multiplier the same batch helps less and holding wins
  const m2 = 30, exp2 = expAt(8800, m2);
  assert.equal(installFreeze({ hack: 8800, exp: exp2, rate: (expAt(8903, m2) - expAt(8719, m2)) / 360, avgRate: exp2 / runMin, wdReq: 9000, gain: Math.pow(1.01, 6) }).freeze, true);
});
t("installFreeze: early in a run a NeuroFlux batch still pays off", () => {
  const m = 15, exp = expAt(7214, m);                              // BN4.2: 7214 reached 15 min after an install
  const r = installFreeze({ hack: 7214, exp, rate: exp / 15, avgRate: exp / 15, wdReq: 9000, gain: Math.pow(1.01, 6) });
  assert.equal(r.freeze, false, r.why);
  assert.match(r.why, /install pays off/);
});
t("installFreeze: no decision without a rate, a requirement, or once it is met", () => {
  const exp = expAt(8000, 15);
  assert.equal(installFreeze({ hack: 8000, exp, rate: null, avgRate: 1, wdReq: 9000 }).freeze, false);
  assert.equal(installFreeze({ hack: 8000, exp, rate: 0, wdReq: 9000 }).freeze, false);
  assert.equal(installFreeze({ hack: 8000, exp, rate: 1e6, wdReq: Infinity }).freeze, false);
  assert.equal(installFreeze({ hack: 9100, exp, rate: 1e6, wdReq: 9000 }).freeze, false);
});
t("installFreeze: bigger gain makes an install more attractive (monotonic)", () => {
  const m = 15, exp = expAt(8500, m), a = { hack: 8500, exp, rate: exp / 300, avgRate: exp / 600, wdReq: 9000 };
  assert.ok(installFreeze({ ...a, gain: 1.2 }).etaInstall < installFreeze({ ...a, gain: 1.01 }).etaInstall);
});
t("expRate: exp/min over the window, null until it spans 5 min", () => {
  const now = 100 * 60000;
  assert.equal(expRate([{ t: now - 60000, exp: 1 }, { t: now, exp: 2 }], now), null);
  assert.equal(expRate([{ t: now - 10 * 60000, exp: 100 }, { t: now, exp: 1100 }], now), 100);
  assert.equal(expRate([{ t: now - 40 * 60000, exp: 0 }, { t: now - 10 * 60000, exp: 100 }, { t: now, exp: 1100 }], now), 100, "older than 30 min dropped");
  assert.equal(expRate([{ t: now - 10 * 60000, exp: 5 }, { t: now, exp: 5 }], now), null, "no gain = no rate");
});
console.log(`AUTOPILOT OK (${n})`);
