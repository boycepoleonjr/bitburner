// Bootstrap purchase ladder in game/agent/daemon-lite.js (ladderStep, workerSpendOk, hostRamFor): regression tests for
// the BN5 stalls (home RAM never bought once pserv-sing was blocked or a later item was "needed"; cash sunk into idle
// worker servers). The game file has no package.json type, so it is copied to a temp .mjs and imported; importing only
// defines functions (main is never called).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "game", "agent", "daemon-lite.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbdl-"));
const tmp = path.join(dir, "daemon-lite.mjs");
fs.copyFileSync(src, tmp);
let mod;
try { mod = await import(pathToFileURL(tmp).href); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
const { ladderStep, workerSpendOk, hostRamFor } = mod;

let n = 0;
const t = (name, fn) => { try { fn(); } catch (e) { e.message = `[${name}] ${e.message}`; throw e; } n++; };
// the real ladder order: TOR, two cheap programs, pserv-sing upgrade, home RAM, the other programs, home cores
const ladder = (o = {}) => [
  { k: "tor", cost: 200e3, need: true },
  { k: "BruteSSH.exe", cost: 500e3, need: true },
  { k: "FTPCrack.exe", cost: 1.5e6, need: true },
  { k: "singRam", cost: 128 * 55000, need: true },
  { k: "homeRam", cost: 30e6, need: true },
  { k: "relaySMTP.exe", cost: 5e6, need: true },
  { k: "homeCores", cost: 1e9, need: true },
].map((it) => ({ ...it, ...(o[it.k] || {}) }));
const keys = (r) => r.picks.map((p) => p.k);

t("buys in priority order: the first affordable item is tried first", () => {
  const r = ladderStep(ladder(), 1e12);
  assert.deepEqual(keys(r), ["tor", "BruteSSH.exe", "FTPCrack.exe", "singRam", "homeRam", "relaySMTP.exe", "homeCores"]);
  assert.equal(r.goal, 0); assert.equal(r.hold, false);
});
const only = (o) => ladder({ tor: { need: false }, "BruteSSH.exe": { need: false }, "FTPCrack.exe": { need: false }, singRam: { need: false }, ...o });
t("saves for the first unaffordable item and holds when it is within 6x of cash", () => {
  const r = ladderStep(only({ "relaySMTP.exe": { cost: 8e6 } }), 9e6);
  assert.equal(r.saving, "homeRam"); assert.equal(r.goal, 30e6); assert.equal(r.hold, true);
  assert.deepEqual(keys(r), [], "8m is affordable but > 25% of the 30m goal: the cash stays for home RAM");
});
t("BN5 regression: home RAM always 'needed' must not block cheap later items (<= 25% of the goal)", () => {
  const r = ladderStep(only({ "relaySMTP.exe": { cost: 5e6 } }), 6e6);
  assert.equal(r.saving, "homeRam");
  assert.deepEqual(keys(r), ["relaySMTP.exe"], "5m <= 25% of 30m");
});
t("blocked items (no TOR for programs, recent failure) are skipped, never become the goal", () => {
  const r = ladderStep(ladder({ tor: { need: false }, "BruteSSH.exe": { blocked: true }, "FTPCrack.exe": { blocked: true } }), 1e7);
  assert.deepEqual(keys(r).slice(0, 1), ["singRam"]);
  const r2 = ladderStep(ladder({ tor: { need: false }, "BruteSSH.exe": { blocked: true, cost: 9e99 } }), 1e3);
  assert.notEqual(r2.saving, "BruteSSH.exe");
});
t("nothing needed: no goal, no hold", () => {
  const r = ladderStep(ladder(Object.fromEntries(ladder().map((x) => [x.k, { need: false }]))), 1e3);
  assert.deepEqual(keys(r), []); assert.equal(r.goal, 0); assert.equal(r.hold, false); assert.equal(r.saving, null);
});
t("a far-off goal (> 6x cash) does not hold: cash may go to workers meanwhile", () => {
  const r = ladderStep(only({}), 1e6);
  assert.equal(r.saving, "homeRam"); assert.equal(r.hold, false);
});
t("workerSpendOk: never while saving, without pserv-sing, when broke, or when workers are idle", () => {
  const ok = { hold: false, singHost: true, money: 1e7, util: 0.9 };
  assert.equal(workerSpendOk(ok), true);
  assert.equal(workerSpendOk({ ...ok, hold: true }), false);
  assert.equal(workerSpendOk({ ...ok, singHost: false }), false);
  assert.equal(workerSpendOk({ ...ok, money: 5e5 }), false);
  assert.equal(workerSpendOk({ ...ok, util: 0.5 }), false, "BN5: idle workers, more RAM earns nothing");
});
t("hostRamFor: smallest power of two that fits, scales with the SF4 Singularity multiplier", () => {
  assert.equal(hostRamFor([49.6, 10, 3]), 64);   // SF4.1 (16x): sl-ram/sl-info ~49.6GB -> the old hard-coded 64GB
  assert.equal(hostRamFor([12.4, 3]), 16);       // SF4.2 (4x)
  assert.equal(hostRamFor([3.1, 1.6]), 8);       // SF4.3 (1x): floor of 8GB
  assert.equal(hostRamFor([300, 49.6]), 512);    // SF4.1 sl-work/sl-backdoor -> the old hard-coded 512GB
  assert.equal(hostRamFor([75, 12]), 128);       // SF4.2: 4x smaller host than before
  assert.equal(hostRamFor([64]), 64);            // exact power of two fits
  assert.equal(hostRamFor([NaN, 20]), 32);
});
console.log(`DAEMON-LITE OK (${n})`);
