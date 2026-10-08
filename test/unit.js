// Unit tests for the hosted automation (fake clock, fake timers, fake rpc/notify/escalate, temp state dir).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createState } from "../server/state.js";
import { createCheckin, OWNER_DECISION, FIRST_RUN_DELAY_MS, RETRY_MS, ESCALATION_INTERVAL_MS, ORDERING_HEAD_START_MS } from "../server/checkin.js";
import { createWatchdog, RESTART_WINDOW_MS, RPC_ALERT_MS, RPC_ESCALATE_MS } from "../server/watchdog.js";
import { buildReportEmbed, buildEscalationText, sanitize, createNotifier, LIMITS, ESCALATE_MAX_BYTES } from "../server/notify.js";
import { parseWatchdog, cliAuthHeader } from "../server/config.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bbu-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = 60 * 1000;

function clock(start = Date.UTC(2026, 8, 29, 12)) {
  let now = start, id = 0;
  const timers = new Map();
  return {
    nowMs: () => now, advance(ms) { now += ms; },
    setTimer: (fn, ms) => { const h = ++id; timers.set(h, { fn, at: now + ms, ms }); return h; },
    clearTimer: (h) => timers.delete(h),
    timers,
    async fire() { const [h, t] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0] || []; if (!h) return false; timers.delete(h); now = Math.max(now, t.at); await t.fn(); return true; },
  };
}

const REPORT = "**Bitburner check-in · 8:00 AM ET** · BN4\n\n| | |\n|---|---|\n| Status | OK |\n| Money | $1.0m |\n| Activity | x |";
function harness({ attention = [], warn = "", up = true, auto = true, dir = tmp(), notifyImpl, escalateImpl, rpcImpl, c = clock() } = {}) {
  const calls = { rpc: 0, notify: [], escalate: [], order: [] };
  const h = { up, attention, warn };
  const state = createState({ dir });
  const ci = createCheckin({
    rpc: rpcImpl || (async (op) => { calls.rpc++; return { ok: true, value: { report: REPORT, attention: h.attention, warn: h.warn, nextMin: 20, did: ["x", " "] } }; }),
    isUp: () => h.up, state, auto, nowMs: c.nowMs, setTimer: c.setTimer, clearTimer: c.clearTimer, escalationEnabled: true,
    notify: notifyImpl || (async (rec) => { calls.notify.push(rec); calls.order.push("report"); }),
    escalate: escalateImpl || (async (text) => { calls.escalate.push(text); calls.order.push("escalate"); return { ok: true }; }),
  });
  return { ci, calls, h, c, dir, state };
}

// ---------------- state ----------------
test("state: concurrent writes keep order, no temp files left", async () => {
  const dir = tmp(), st = createState({ dir });
  await Promise.all(Array.from({ length: 20 }, (_, i) => st.writeJsonAtomic("x.json", { i })));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "x.json"))).i, 19);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes(".tmp-")), []);
});
test("state: corrupt file is set aside, fallback returned", async () => {
  const dir = tmp(), st = createState({ dir });
  fs.writeFileSync(path.join(dir, "checkin-latest.json"), "{nope");
  assert.equal(await st.readJson("checkin-latest.json", "FB"), "FB");
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("checkin-latest.json.corrupt-")));
});
test("state: unknown version is set aside", async () => {
  const dir = tmp(), st = createState({ dir });
  fs.writeFileSync(path.join(dir, "watchdog-state.json"), JSON.stringify({ version: 9 }));
  assert.equal(await st.readJson("watchdog-state.json", null, { versioned: true }), null);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("watchdog-state.json.unknown-version-")));
});
test("state: history trimmed to 500", async () => {
  const dir = tmp(), st = createState({ dir });
  for (let i = 0; i < 505; i++) await st.appendHistory({ i });
  const lines = fs.readFileSync(path.join(dir, "checkin-history.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 500); assert.equal(JSON.parse(lines[0]).i, 5);
});

// ---------------- check-in ----------------
test("checkin: record shape, ISO t + numeric atMs, did/warn normalized", async () => {
  const { ci, calls } = harness({ warn: " backup warn " });
  const rec = await ci.run({ manual: true });
  assert.equal(typeof rec.t, "string"); assert.ok(!Number.isNaN(Date.parse(rec.t))); assert.equal(typeof rec.atMs, "number");
  assert.deepEqual(rec.warn, ["backup warn"]); assert.deepEqual(rec.did, ["x"]);
  await ci._settle(); assert.equal(calls.notify.length, 1);
});
test("checkin: run is single-flight", async () => {
  let n = 0;
  const { ci } = harness({ rpcImpl: async () => { n++; await sleep(20); return { ok: true, value: { report: REPORT, attention: [] } }; } });
  const [a, b] = await Promise.all([ci.run(), ci.run()]);
  assert.equal(n, 1); assert.equal(a, b);
});
test("checkin: failure record is sanitized with nextMin 5", async () => {
  const { ci } = harness({ rpcImpl: async () => { throw new Error("boom Bearer abc123 https://x.y/z token=q\nstack"); } });
  const rec = await ci.run();
  assert.equal(rec.ok, false); assert.equal(rec.nextMin, 5);
  assert.ok(!/abc123|x\.y|token=q|stack/.test(rec.error), rec.error);
});
test("checkin: invalid rpc output becomes ok:false", async () => {
  const { ci } = harness({ rpcImpl: async () => ({ ok: true, value: { report: 5 } }) });
  assert.equal((await ci.run()).ok, false);
});
test("checkin: manual during outage posts one grey report; auto timer in outage does nothing", async () => {
  const { ci, calls, h, c } = harness({ up: false });
  const rec = await ci.run({ manual: true }); await ci._settle();
  assert.equal(rec.ok, false); assert.equal(calls.notify.length, 1); assert.equal(calls.rpc, 0);
  h.up = true; await ci.onRpcUp(); h.up = false;
  await c.fire(); await ci._settle();
  assert.equal(calls.notify.length, 1, "auto run in outage must not notify");
  assert.equal([...c.timers.values()][0].ms, RETRY_MS);
});
test("checkin: auto run schedules next at nextMin; manual does not reschedule", async () => {
  const { ci, c } = harness();
  await ci.onRpcUp();
  assert.equal([...c.timers.values()][0].ms, FIRST_RUN_DELAY_MS);
  await c.fire();
  const due = ci._timerDueAt();
  assert.equal(due - c.nowMs(), 20 * MIN);
  await ci.run({ manual: true });
  assert.equal(ci._timerDueAt(), due); assert.equal(c.timers.size, 1);
});
test("checkin: onRpcUp idempotent, fresh reconnect keeps cadence, stale -> 2 min, never 0", async () => {
  const { ci, c } = harness();
  await Promise.all([ci.onRpcUp(), ci.onRpcUp(), ci.onRpcUp()]);
  assert.equal(c.timers.size, 1);
  await c.fire(); // run at t+2m, next due +20m
  c.advance(10 * MIN);
  await ci.onRpcUp(); // later reconnect, fresh record
  assert.equal(c.timers.size, 1); assert.equal(ci._timerDueAt() - c.nowMs(), 10 * MIN);
  c.advance(10 * MIN); // exactly at due
  await ci.onRpcUp();
  assert.equal(ci._timerDueAt() - c.nowMs(), FIRST_RUN_DELAY_MS);
  c.advance(60 * MIN); // stale
  await ci.onRpcUp();
  assert.equal(ci._timerDueAt() - c.nowMs(), FIRST_RUN_DELAY_MS);
});
test("checkin: escalation dedupe, 2h re-escalation, resolution, persistence across restart", async () => {
  const dir = tmp(), c = clock();
  const a = harness({ attention: ["b  x", "a"], dir, c });
  await a.ci.run(); await a.ci._settle();
  assert.equal(a.calls.escalate.length, 1);
  await a.ci.run(); await a.ci._settle();
  assert.equal(a.calls.escalate.length, 1, "identical attention must not re-fire");
  // new process, same state dir
  const b = harness({ attention: ["a", "b x"], dir, c });
  await b.ci.run(); await b.ci._settle();
  assert.equal(b.calls.escalate.length, 0, "persisted dedupe survives restart");
  c.advance(ESCALATION_INTERVAL_MS);
  await b.ci.run(); await b.ci._settle();
  assert.equal(b.calls.escalate.length, 1, "re-escalates after 2h");
  b.h.attention = [];
  await b.ci.run(); await b.ci._settle();
  const esc = JSON.parse(fs.readFileSync(path.join(dir, "checkin-escalation.json")));
  assert.equal(esc.attentionKey, null); assert.equal(typeof esc.lastResolvedAt, "number"); assert.equal(esc.version, 1);
});
test("checkin: escalation state recorded even if session-link post fails", async () => {
  const dir = tmp();
  const a = harness({ attention: ["x"], dir, escalateImpl: async () => { throw new Error("discord down"); } });
  await a.ci.run(); await a.ci._settle();
  const b = harness({ attention: ["x"], dir });
  await b.ci.run(); await b.ci._settle();
  assert.equal(b.calls.escalate.length, 0);
});
test("checkin: report posts before escalation; hung Discord delays escalation <= ~500ms; run() doesn't wait", async () => {
  const a = harness({ attention: ["x"] });
  await a.ci.run(); await a.ci._settle();
  assert.deepEqual(a.calls.order, ["report", "escalate"]);
  let escAt = 0;
  const t0 = Date.now();
  const b = harness({ attention: ["y"], notifyImpl: () => new Promise(() => {}), escalateImpl: async () => { escAt = Date.now(); } });
  await b.ci.run();
  assert.ok(Date.now() - t0 < 200, "run() must not wait on Discord");
  await sleep(ORDERING_HEAD_START_MS + 150);
  assert.ok(escAt && escAt - t0 < ORDERING_HEAD_START_MS + 150);
});
test("checkin: slow routine does not hold the dispatch wrapper, and still records its result", async () => {
  let finished = false;
  const a = harness({ attention: ["z"], escalateImpl: async () => { await sleep(1500); finished = true; } });
  const t0 = Date.now();
  await a.ci.run();
  await sleep(ORDERING_HEAD_START_MS + 100);
  assert.ok(!finished, "escalation still running");
  await a.ci._settle();
  assert.ok(finished && Date.now() - t0 >= 1500);
});
test("checkin: getReport reads disk once, never rpc; stale math uses atMs", async () => {
  const dir = tmp(), c = clock();
  const a = harness({ dir, c }); await a.ci.run();
  const b = harness({ dir, c });
  const before = b.state.stats.reads;
  const r1 = await b.ci.getReport(); await b.ci.getReport();
  assert.equal(b.state.stats.reads - before, 1); assert.equal(b.calls.rpc, 0);
  assert.equal(r1.stale, false); assert.equal(r1.ageMin, 0);
  c.advance(31 * MIN);
  assert.equal((await b.ci.getReport()).stale, true);
});

test("checkin: owner-decision attention (w0r1d READY) posts to Discord but never escalates", async () => {
  const READY = "w0r1d_d43m0n READY — agent decides BitNode destruction";
  const c = clock(), a = harness({ attention: [READY], c });
  await a.ci.run(); await a.ci._settle();
  assert.equal(a.calls.notify.length, 1); assert.deepEqual(a.calls.notify[0].attention, [READY]);
  assert.equal(a.calls.escalate.length, 0);
  c.advance(ESCALATION_INTERVAL_MS); await a.ci.run(); await a.ci._settle();
  assert.equal(a.calls.escalate.length, 0, "no 2h re-escalation either");
});
test("checkin: READY alongside other attention escalates without READY; READY coming/going doesn't re-fire", async () => {
  const READY = "w0r1d_d43m0n READY — agent decides BitNode destruction";
  const a = harness({ attention: [READY, "home RAM stalled"] });
  await a.ci.run(); await a.ci._settle();
  assert.equal(a.calls.escalate.length, 1);
  assert.match(a.calls.escalate[0], /Attention:\n- home RAM stalled\n/);
  assert.match(a.calls.escalate[0], /Owner decision, not for the agent: w0r1d_d43m0n READY/);
  a.h.attention = ["home RAM stalled"]; await a.ci.run(); await a.ci._settle();
  a.h.attention = [READY, "home RAM stalled"]; await a.ci.run(); await a.ci._settle();
  assert.equal(a.calls.escalate.length, 1);
});

test("checkin: OWNER_DECISION still matches the flag text the autopilot raises (READY_FLAG in lib/augplan.js)", () => {
  const src = fs.readFileSync(new URL("../game/lib/augplan.js", import.meta.url), "utf8");
  const flags = [...src.matchAll(/export const READY_FLAG = "([^"]*)"/g)].map((m) => m[1]);
  assert.ok(flags.length === 1, "READY_FLAG not found in lib/augplan.js");
  assert.ok(fs.readFileSync(new URL("../game/lib/nodectl.js", import.meta.url), "utf8").includes("READY_FLAG"), "nodectl raises READY_FLAG");
  for (const f of flags) assert.ok(OWNER_DECISION.some((re) => re.test(f)), f);
});

// ---------------- notify ----------------
test("notify: embed caps hold for huge reports; fallback for unparsable", () => {
  const rows = Array.from({ length: 40 }, (_, i) => `| Row${i} | ${"v".repeat(900)} |`).join("\n");
  const e = buildReportEmbed({ ok: true, report: "**T**\n" + rows, attention: [], warn: [] });
  const total = e.title.length + e.footer.text.length + (e.description || "").length + e.fields.reduce((a, f) => a + f.name.length + f.value.length, 0);
  assert.ok(e.fields.length <= LIMITS.fields && total <= LIMITS.total, `${e.fields.length} fields, ${total} chars`);
  assert.ok(e.fields.every((f) => f.value.length <= LIMITS.fieldValue));
  assert.match(e.description, /more rows/);
  const f = buildReportEmbed({ ok: true, report: "just text", attention: [], warn: [] });
  assert.equal(f.title, "Bitburner check-in"); assert.equal(f.description, "just text");
  const s = buildReportEmbed({ ok: true, report: REPORT, attention: [], warn: [] });
  assert.equal(s.title, "Bitburner check-in · 8:00 AM ET · BN4");
  assert.equal(s.fields.find((x) => x.name === "Status").inline, false);
  assert.equal(s.fields.find((x) => x.name === "Money").inline, true);
  assert.equal(buildReportEmbed({ ok: false, error: "e" }).color, 0x808080);
});
test("notify: escalation text capped at 8KB (utf8) with marker", () => {
  const t = buildEscalationText({ attention: ["a"], report: "é".repeat(9000) });
  assert.ok(Buffer.byteLength(t, "utf8") <= ESCALATE_MAX_BYTES); assert.match(t, /report truncated/);
});
test("notify: sanitize strips secrets", () => {
  assert.ok(!/sekrit|hooks/.test(sanitize("x Bearer sekrit https://discord.com/api/webhooks/1/abc")));
});
test("notify: fireRoutine headers/body + session link to Discord; never throws", async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url, opts }); return url.includes("fire") ? { ok: true, json: async () => ({ claude_code_session_url: "https://claude.ai/code/session_1" }) } : { ok: true }; };
  const n = createNotifier({ webhookUrl: "https://hook", escalateUrl: "https://api/fire", escalateToken: "T", fetchImpl });
  const r = await n.fireRoutine("hi");
  assert.equal(r.ok, true);
  assert.equal(seen[0].opts.headers["anthropic-beta"], "experimental-cc-routine-2026-04-01");
  assert.equal(JSON.parse(seen[0].opts.body).text, "hi");
  assert.match(JSON.parse(seen[1].opts.body).content, /session_1/);
  const bad = createNotifier({ webhookUrl: "https://hook", escalateUrl: "https://api/fire", escalateToken: "T", fetchImpl: async () => { throw new Error("net"); } });
  assert.equal((await bad.fireRoutine("x")).ok, false); assert.equal(await bad.discordText("x"), false);
  assert.equal(await n.discordText("  "), false);
});

// ---------------- watchdog ----------------
function wdHarness({ min = 10, restartImpl, dir = tmp(), sockets = false } = {}) {
  const c = clock(), calls = { restarts: 0, texts: [], esc: 0, runs: 0, pings: 0 };
  const h = { connected: false, pingOk: true, stateAtRestart: null, gameSock: false, rpcSock: false };
  const sock = sockets ? { isGameSocket: () => h.gameSock, isRpcSocket: () => h.rpcSock } : {};
  const state = createState({ dir });
  const wd = createWatchdog({
    ...sock, isGameConnected: () => (sockets ? h.gameSock && h.rpcSock : h.connected), ping: async () => { calls.pings++; await sleep(5); if (!h.pingOk) throw new Error("rpc ping timeout"); return { ok: true }; },
    restartBrowser: restartImpl || (async () => { calls.restarts++; h.stateAtRestart = JSON.parse(fs.readFileSync(path.join(dir, "watchdog-state.json"))); return { started: true, exitCode: 0 }; }),
    notifyText: async (t) => calls.texts.push(t), escalate: async () => { calls.esc++; },
    checkin: { run: async () => { calls.runs++; } }, state, watchdogMin: min, nowMs: c.nowMs,
  });
  wd._dir = dir;
  return { wd, c, calls, h, dir };
}
const flush = () => sleep(10);
test("watchdog: quiet first detection, restart after min, cooldown, persisted before restart", async () => {
  const { wd, c, calls, h } = wdHarness();
  await wd.tick(); assert.equal(calls.restarts, 0); assert.equal(calls.texts.length, 0);
  c.advance(9 * MIN); await wd.tick(); assert.equal(calls.restarts, 0);
  c.advance(1 * MIN); await wd.tick(); await flush();
  assert.equal(calls.restarts, 1); assert.equal(h.stateAtRestart.restartTimes.length, 1);
  assert.deepEqual(calls.texts, ["watchdog: restarting Chromium (rpc socket absent)"]);
  c.advance(5 * MIN); await wd.tick(); assert.equal(calls.restarts, 1, "cooldown");
});
test("watchdog: 2 restarts -> one escalation, then probe-only past backoff; recovery resets", async () => {
  const { wd, c, calls, h } = wdHarness();
  await wd.tick();
  for (let i = 0; i < 2; i++) { c.advance(10 * MIN); await wd.tick(); }
  assert.equal(calls.restarts, 2);
  c.advance(10 * MIN); await wd.tick(); await flush();
  assert.equal(calls.esc, 1); assert.equal(calls.restarts, 2);
  c.advance(RESTART_WINDOW_MS + 60 * MIN); await wd.tick(); c.advance(20 * MIN); await wd.tick(); await flush();
  assert.equal(calls.esc, 1); assert.equal(calls.restarts, 2, "no restarts after escalation, even past backoff");
  h.connected = true; await wd.tick(); await flush();
  assert.equal(calls.runs, 1); assert.equal(calls.texts.filter((t) => t === "watchdog: recovered").length, 1);
  assert.equal(wd._state().escalatedAt, null); assert.equal(wd._state().downSince, null);
  await wd.tick(); await flush(); assert.equal(calls.runs, 1, "recovery reported once");
});
test("watchdog: short boot/reconnect gap clears quietly (no 'recovered', no run)", async () => {
  const { wd, c, calls, h } = wdHarness();
  await wd.tick(); c.advance(1 * MIN); h.connected = true; await wd.tick(); await flush();
  assert.equal(calls.texts.length, 0); assert.equal(calls.runs, 0); assert.equal(wd._state().downSince, null);
});
test("watchdog: failed restart commands still count as attempts", async () => {
  const outcomes = [{ started: true, exitCode: 1 }, { started: false, exitCode: null, error: "ENOENT" }];
  let n = 0;
  const { wd, c, calls } = wdHarness({ restartImpl: async () => outcomes[n++] });
  await wd.tick();
  for (let i = 0; i < 3; i++) { c.advance(10 * MIN); await wd.tick(); }
  await flush();
  assert.equal(n, 2); assert.equal(calls.esc, 1);
});
test("watchdog: overlapping ticks run one probe; ping timeout reason", async () => {
  const { wd, calls, h } = wdHarness();
  h.connected = true; h.pingOk = false;
  await Promise.all([wd.tick(), wd.tick(), wd.tick()]);
  assert.equal(calls.pings, 1);
});
test("watchdog: game up + rpc.js absent -> one Discord alert at 5 min, one escalation at 30, never a restart", async () => {
  const { wd, c, calls, h } = wdHarness({ sockets: true });
  h.gameSock = true; h.rpcSock = false;
  await wd.tick(); c.advance(4 * MIN); await wd.tick(); await flush();
  assert.equal(calls.texts.length, 0);
  c.advance(RPC_ALERT_MS - 4 * MIN); await wd.tick(); await flush();
  assert.equal(calls.texts.length, 1); assert.match(calls.texts[0], /rpc\.js absent/); assert.equal(calls.esc, 0);
  for (let i = 0; i < 12; i++) { c.advance(5 * MIN); await wd.tick(); }
  await flush();
  assert.ok(12 * 5 * MIN + RPC_ALERT_MS > RPC_ESCALATE_MS);
  assert.equal(calls.texts.length, 1, "alert once"); assert.equal(calls.esc, 1, "escalate once");
  assert.equal(calls.restarts, 0); assert.equal(calls.pings, 0);
  const sf = path.join(wd._dir, "watchdog-state.json");
  assert.ok(!fs.existsSync(sf) || !fs.readFileSync(sf, "utf8").includes("rpc"), "rpc gap is not persisted");
  h.rpcSock = true; await wd.tick(); await flush();
  assert.deepEqual(calls.texts.slice(1), ["watchdog: agent/rpc.js reconnected"]);
  assert.equal(wd._rpcGap(), null);
});
test("watchdog: rpc gap is in memory only (a restarted server starts it afresh)", async () => {
  const dir = tmp();
  const a = wdHarness({ sockets: true, dir }); a.h.gameSock = true;
  await a.wd.tick(); a.c.advance(4 * MIN); await a.wd.tick();
  const b = wdHarness({ sockets: true, dir }); b.h.gameSock = true;
  await b.wd.tick(); b.c.advance(4 * MIN); await b.wd.tick(); await flush();
  assert.equal(b.calls.texts.length, 0);
});
test("watchdog: short rpc gap clears quietly; game socket down still takes the restart path", async () => {
  const { wd, c, calls, h } = wdHarness({ sockets: true });
  h.gameSock = true; await wd.tick(); c.advance(1 * MIN); h.rpcSock = true; await wd.tick(); await flush();
  assert.equal(calls.texts.length, 0);
  h.gameSock = false; h.rpcSock = false;
  await wd.tick(); c.advance(10 * MIN); await wd.tick(); await flush();
  assert.equal(calls.restarts, 1); assert.deepEqual(calls.texts, ["watchdog: restarting Chromium (rpc socket absent)"]);
});
test("config: watchdog allowlist and finite minutes", () => {
  assert.equal(parseWatchdog({ BB_WATCHDOG_MIN: "10" }).min, 10);
  assert.equal(parseWatchdog({ BB_WATCHDOG_MIN: "Infinity" }).min, 0);
  assert.equal(parseWatchdog({ BB_WATCHDOG_MIN: "abc" }).min, 0);
  assert.equal(parseWatchdog({ BB_WATCHDOG_MIN: "10", BB_WATCHDOG_CMD: "/bin/rm" }).min, 0);
  assert.equal(parseWatchdog({ BB_WATCHDOG_MIN: "10", BB_WATCHDOG_ARGS: "\"-f\"" }).min, 0);
  assert.deepEqual(parseWatchdog({}).args, ["-f", "--", "--user-data-dir=/data/chrome"]);
});
test("config: cli auth header (env token, proxy-injected, remote without token)", () => {
  const missing = path.join(tmp(), ".bb-token");
  assert.deepEqual(cliAuthHeader({ BB_TOKEN: " t1 \n" }, missing), { authorization: "Bearer t1" });
  assert.deepEqual(cliAuthHeader({ BB_TOKEN: "t1", BB_TOKEN_VIA_PROXY: "1", BB_URL: "https://h" }, missing), {});
  assert.throws(() => cliAuthHeader({ BB_URL: "https://h" }, missing), /BB_TOKEN_VIA_PROXY/);
  assert.equal(fs.existsSync(missing), false); // never creates a token file for a remote server
  fs.writeFileSync(missing, "t2\n");
  assert.deepEqual(cliAuthHeader({ BB_URL: "https://h" }, missing), { authorization: "Bearer t2" });
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log("ok  ", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", e.message); }
}
console.log(failed ? `UNIT FAIL (${failed})` : `UNIT OK (${tests.length})`);
process.exitCode = failed ? 1 : 0;
