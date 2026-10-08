// BitNode destroy handshake: lib/nodectl.js state machine + final gate, server/node-control.js (fake rpc + fake
// backup), autopilot settings mapping + eta install gate, sl-plan recovery heuristic.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importGame } from "./helpers/game-import.js";
import { defaults } from "../game/lib/settings-schema.js";
import { createNodeControl, readPlan, STATE_FILE, REQUEST_FILE as SRV_REQ, ACK_FILE as SRV_ACK } from "../server/node-control.js";
import { createState } from "../server/state.js";

const N = await importGame("lib/nodectl.js");
const { decideNode, destroyGate, pickNextBn, ACK_TIMEOUT_MS, RETRY_MS, NO_ACK, REQUEST_FILE, ACK_FILE } = N;
const { READY_FLAG } = await importGame("lib/augplan.js");
const AP = await importGame("agent/autopilot.js");
const { recoveryMinutes } = await importGame("agent/sl-plan.js");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const S = (o = {}) => ({ ...defaults(), ...o });
const ON = { "node.autoDestroy": true, "node.autoSelect": true };
const SF = [{ n: 1, lvl: 1 }, { n: 4, lvl: 1 }];
const MIN = 60_000, T0 = Date.UTC(2026, 9, 9, 12);
const st = (o = {}) => ({ ready: true, bn: 5, sourceFiles: SF, now: T0, request: null, ack: null, ...o });

// ---------------- state machine ----------------
test("not ready: nothing; ready + autoDestroy=false (default): exact READY flag, never a request", () => {
  assert.equal(decideNode(st({ ready: false }), S()).action, "none");
  const d = decideNode(st(), S());
  assert.equal(d.action, "flag");
  assert.deepEqual(d.attention, [READY_FLAG]);
  assert.equal(READY_FLAG, "w0r1d_d43m0n READY — agent decides BitNode destruction");
  assert.equal(d.writeRequest, null);
  assert.equal(d.node.recommended.bn, 1);
  assert.equal(d.node.pending.stage, "none");
  // autoDestroy on but autoSelect off: still only the flag (owner chooses the node)
  const m = decideNode(st(), S({ "node.autoDestroy": true }));
  assert.equal(m.action, "flag"); assert.equal(m.writeRequest, null); assert.match(m.node.pending.detail, /autoSelect off/);
});
test("server checkin still treats the READY flag as an owner decision", async () => {
  const { OWNER_DECISION } = await import("../server/checkin.js");
  assert.ok(OWNER_DECISION.some((re) => re.test(READY_FLAG)));
  assert.ok(!OWNER_DECISION.some((re) => re.test(NO_ACK)), "a blocked destroy must escalate");
});
test("handshake: request -> no destroy without ack -> ack -> veto window -> destroy", () => {
  const s = S(ON);
  const r1 = decideNode(st(), s);
  assert.equal(r1.action, "request");
  assert.deepEqual({ action: r1.writeRequest.action, bn: r1.writeRequest.bn, nextBn: r1.writeRequest.nextBn, at: r1.writeRequest.at }, { action: "destroy", bn: 5, nextBn: 1, at: T0 });
  const req = r1.writeRequest;
  const w = decideNode(st({ request: req, now: T0 + 5 * MIN }), s);
  assert.equal(w.action, "wait"); assert.equal(w.node.pending.stage, "requested"); assert.equal(w.writeRequest, null);
  // ack for a different id or older than the request is ignored
  assert.equal(decideNode(st({ request: req, ack: { id: "other", backupOk: true, at: T0 + MIN }, now: T0 + 2 * MIN }), s).action, "wait");
  assert.equal(decideNode(st({ request: req, ack: { id: req.id, backupOk: true, at: T0 - 1 }, now: T0 + 2 * MIN }), s).action, "wait");
  const ack = { id: req.id, backupOk: true, key: "bitburnerSave_x.json.gz", at: T0 + MIN };
  const veto = decideNode(st({ request: req, ack, now: T0 + 5 * MIN }), s);
  assert.equal(veto.action, "wait"); assert.equal(veto.node.pending.stage, "acked"); assert.match(veto.node.pending.detail, /veto/);
  const go = decideNode(st({ request: req, ack, now: T0 + 11 * MIN }), s);
  assert.equal(go.action, "destroy"); assert.equal(go.nextBn, 1); assert.equal(go.node.pending.id, req.id);
  assert.equal(decideNode(st({ request: req, ack, now: T0 + MIN }), S({ ...ON, "node.destroyDelayMin": 0 })).action, "destroy");
});
test("timeout without ack -> blocked with escalating attention; a late ack unblocks", () => {
  const s = S(ON), req = decideNode(st(), s).writeRequest;
  const b = decideNode(st({ request: req, now: T0 + ACK_TIMEOUT_MS }), s);
  assert.equal(b.action, "wait"); assert.equal(b.node.pending.stage, "blocked");
  assert.deepEqual(b.attention, [READY_FLAG, NO_ACK]);
  const late = decideNode(st({ request: req, ack: { id: req.id, backupOk: true, at: T0 + 20 * MIN }, now: T0 + 31 * MIN }), s);
  assert.equal(late.action, "destroy");
});
test("failed backup -> blocked, then a new request (new id) after the retry delay", () => {
  const s = S(ON), req = decideNode(st(), s).writeRequest;
  const ack = { id: req.id, backupOk: false, error: "no valid save", at: T0 + MIN };
  const b = decideNode(st({ request: req, ack, now: T0 + 2 * MIN }), s);
  assert.equal(b.node.pending.stage, "blocked"); assert.match(b.attention[1], /backup failed \(no valid save\)/);
  const again = decideNode(st({ request: req, ack, now: T0 + MIN + RETRY_MS }), s);
  assert.equal(again.action, "request"); assert.notEqual(again.writeRequest.id, req.id);
});
test("veto: autoDestroy or autoSelect turned off, or not ready any more, cancels an open request", () => {
  const req = decideNode(st(), S(ON)).writeRequest;
  for (const [s, x] of [[S(), {}], [S({ "node.autoDestroy": true }), {}], [S(ON), { ready: false }]]) {
    const c = decideNode(st({ request: req, ack: { id: req.id, backupOk: true, at: T0 }, now: T0 + 60 * MIN, ...x }), s);
    assert.equal(c.action, "cancel"); assert.equal(c.writeRequest.action, "cancel"); assert.equal(c.writeRequest.id, req.id);
  }
  // a request from a previous BitNode is ignored (no cancel churn) and replaced
  const old = { ...req, bn: 4 };
  assert.equal(decideNode(st({ request: old }), S()).action, "flag");
  assert.equal(decideNode(st({ request: old }), S(ON)).action, "request");
});
test("next BitNode changes -> new request; backupBeforeDestroy=false skips the ack but keeps the veto window", () => {
  const req = decideNode(st(), S(ON)).writeRequest;
  const changed = decideNode(st({ request: req, now: T0 + MIN }), S({ ...ON, "node.order": [2] }));
  assert.equal(changed.action, "request"); assert.equal(changed.writeRequest.nextBn, 2);
  const nb = S({ ...ON, "node.backupBeforeDestroy": false });
  const r = decideNode(st(), nb);
  assert.equal(r.action, "request");
  assert.equal(decideNode(st({ request: r.writeRequest, now: T0 + 5 * MIN }), nb).action, "wait");
  assert.equal(decideNode(st({ request: r.writeRequest, now: T0 + 10 * MIN }), nb).action, "destroy");
});
test("autoSelect: node.order first available (maxed SF skipped), else recommendation; off = null", () => {
  assert.equal(pickNextBn({ bn: 5, sourceFiles: SF }, S()).nextBn, null);
  assert.equal(pickNextBn({ bn: 5, sourceFiles: SF }, S({ "node.autoSelect": true, "node.order": [10, 2] })).nextBn, 10);
  assert.equal(pickNextBn({ bn: 5, sourceFiles: [{ n: 10, lvl: 3 }] }, S({ "node.autoSelect": true, "node.order": [10, 2] })).nextBn, 2);
  // current BN gets +1 on destroy: BN5 at 5.2 -> 5.3 is still allowed, at 5.3 it is not
  assert.equal(pickNextBn({ bn: 5, sourceFiles: [{ n: 5, lvl: 2 }] }, S({ "node.autoSelect": true, "node.order": [5, 3] })).nextBn, 3);
  const r = pickNextBn({ bn: 5, sourceFiles: SF }, S({ "node.autoSelect": true }));
  assert.equal(r.source, "recommendation"); assert.equal(r.nextBn, 1);
});
test("destroyGate (sl-destroy.js): every mismatch aborts", () => {
  const s = S(ON), req = { id: "r1", action: "destroy", bn: 5, nextBn: 1, at: T0 }, ack = { id: "r1", backupOk: true, at: T0 + 1 };
  const g = (o, ss = s) => destroyGate({ id: "r1", nextBn: 1, bn: 5, request: req, ack, ready: true, ...o }, ss);
  assert.equal(g({}), null);
  assert.match(g({ ready: false }), /not ready/);
  assert.match(g({}, S()), /autoDestroy is off/);
  assert.match(g({ id: "r2" }), /does not match/);
  assert.match(g({ nextBn: 2 }), /does not match/);
  assert.match(g({ request: { ...req, action: "cancel" } }), /does not match/);
  assert.match(g({ ack: { ...ack, backupOk: false } }), /no successful backup/);
  assert.match(g({ ack: null }), /no successful backup/);
  assert.equal(g({ ack: null }, S({ ...ON, "node.backupBeforeDestroy": false })), null);
});

// ---------------- server/node-control.js ----------------
test("server and game agree on the handshake file names", () => { assert.equal(SRV_REQ, REQUEST_FILE); assert.equal(SRV_ACK, ACK_FILE); });
function harness({ backupImpl, files = {} } = {}) {
  const calls = { backup: 0, writes: [] };
  const rpc = async (op, a) => {
    if (op === "read") return { ok: true, value: files[a.file] ?? "" };
    if (op === "write") { files[a.file] = a.data; calls.writes.push(a.file); return { ok: true, value: true }; }
    return { ok: false, error: "op" };
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbn-"));
  const state = createState({ dir });
  const backup = async () => { calls.backup++; return backupImpl ? backupImpl() : { ok: true, file: "/data/backups/bitburnerSave_2026.json.gz", bytes: 5000 }; };
  const up = { v: true };
  const nc = createNodeControl({ rpc, isUp: () => up.v, backup, state, nowMs: () => T0 + 1000, setTimer: () => 1, clearTimer: () => {} });
  return { nc, files, calls, up, dir };
}
test("server: destroy request -> one backup -> ack; repeated polls never back up twice", async () => {
  const h = harness();
  h.files[REQUEST_FILE] = JSON.stringify({ id: "r1", action: "destroy", bn: 5, nextBn: 1, at: T0 });
  const r = await h.nc.tick();
  assert.equal(r.ack.backupOk, true);
  assert.deepEqual(JSON.parse(h.files[ACK_FILE]), { id: "r1", backupOk: true, key: "bitburnerSave_2026.json.gz", bytes: 5000, at: T0 + 1000 });
  await h.nc.tick();
  assert.equal(h.calls.backup, 1);
  delete h.files[ACK_FILE]; // game lost it: same ack re-written, still no second backup
  await h.nc.tick();
  assert.equal(h.calls.backup, 1); assert.equal(JSON.parse(h.files[ACK_FILE]).id, "r1");
  assert.ok(JSON.parse(fs.readFileSync(path.join(h.dir, STATE_FILE), "utf8")).acks.r1, "acks persisted");
});
test("server: backup failure -> backupOk:false with the error; cancel/idle/garbage/rpc-down do nothing", async () => {
  const h = harness({ backupImpl: async () => { throw new Error("no valid save: idb"); } });
  h.files[REQUEST_FILE] = JSON.stringify({ id: "r2", action: "destroy", bn: 5, nextBn: 1, at: T0 });
  const r = await h.nc.tick();
  assert.equal(r.ack.backupOk, false); assert.match(r.ack.error, /no valid save/);
  const h2 = harness();
  for (const raw of ["", "{bad", JSON.stringify({ id: "c1", action: "cancel" }), JSON.stringify({ id: "x", action: "nuke" })]) {
    h2.files[REQUEST_FILE] = raw; await h2.nc.tick();
  }
  assert.equal(h2.calls.backup, 0); assert.equal(h2.calls.writes.length, 0);
  h2.up.v = false; h2.files[REQUEST_FILE] = JSON.stringify({ id: "r3", action: "destroy" });
  assert.deepEqual(await h2.nc.tick(), { skipped: "rpc down" });
  assert.equal(h2.calls.backup, 0);
});
test("server: /api/plan reads data/aug-plan.txt, 503 when missing", async () => {
  const files = { "data/aug-plan.txt": JSON.stringify({ t: 1, bn: 5 }) };
  const rpc = async (op, a) => ({ ok: true, value: files[a.file] ?? "" });
  assert.deepEqual(await readPlan(rpc), { ok: true, value: { t: 1, bn: 5 } });
  delete files["data/aug-plan.txt"];
  await assert.rejects(readPlan(rpc), (e) => e.status === 503);
});

// ---------------- autopilot integration helpers ----------------
test("autopilot: settings win over autopilot-config.txt for augs.* keys", () => {
  const c = AP.withSettings({ autoInstall: false, augTrigger: 9, donateFavor: 1, nfgHoldFrac: 0.5, work: "auto-faction" }, S({ "augs.installAt": 4 }));
  assert.deepEqual({ a: c.autoInstall, t: c.augTrigger, d: c.donateFavor, h: c.nfgHoldFrac, p: c.installPolicy, w: c.work }, { a: true, t: 4, d: 150, h: 0.9, p: "eta", w: "auto-faction" });
});
test("autopilot: eta gate holds a count trigger, fires a plan 'install now', ignores stale plans and other triggers", () => {
  const now = T0, plan = (etaMin, reason) => ({ t: now - MIN, install: { next: { etaMin, reason } } });
  const g = (o) => AP.etaGate({ why: "6 augs buyable", countWhy: "6 augs buyable", buyable: 6, policy: "eta", now, ...o });
  assert.deepEqual(g({ plan: plan(12, "eta: next aug in 12m <= recovery 60m; wait and add it") }), { why: null, held: "eta: next aug in 12m <= recovery 60m; wait and add it" });
  assert.equal(g({ plan: plan(0, "eta: x") }).why, "6 augs buyable");
  assert.equal(g({ plan: { ...plan(12, "x"), t: now - 10 * MIN } }).why, "6 augs buyable", "stale plan -> count behaviour");
  assert.equal(g({ policy: "count", plan: plan(12, "x") }).why, "6 augs buyable");
  assert.equal(g({ why: "Red Pill", plan: plan(12, "x") }).why, "Red Pill");
  assert.equal(g({ why: null, buyable: 2, plan: plan(0, "eta: next aug in 300m > recovery 60m; install 2") }).why, "eta: next aug in 300m > recovery 60m; install 2");
  assert.equal(g({ why: null, buyable: 0, plan: plan(0, "eta: x") }).why, null);
});
test("sl-plan: recovery heuristic from install-log cycles", () => {
  assert.equal(recoveryMinutes(""), 60);
  const line = (m) => JSON.stringify({ sinceAug: m * 60000 });
  assert.equal(recoveryMinutes([400, 200, 600].map(line).join("\n")), 100); // 25% of median 400
  assert.equal(recoveryMinutes([10, 20].map(line).join("\n")), 15);         // clamped low
  assert.equal(recoveryMinutes([5000, 5000].map(line).join("\n")), 240);    // clamped high
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} node-control test(s) failed`); process.exit(1); }
console.log(`node-control: ${tests.length} passed`);
