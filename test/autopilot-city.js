// Pure helpers in game/agent/autopilot.js (city-faction invite gate, NeuroFlux batch sizing). The game file has no package.json type, so it is
// copied to a temp .mjs and imported; importing only defines functions (main is never called).
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
const { cityInviteDecision, handleInvites, nfgAffordable, nfgHold } = mod;

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
console.log(`AUTOPILOT OK (${n})`);
