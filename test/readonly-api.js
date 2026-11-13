// Read-only token for the supervisor routine (server/readonly.js, docs/specs/readonly-api.md, ledger F-010).
// Unit tests for the token loader, route allowlist, path rules and fixed queries, then a real server with a fake
// in-game rpc socket: the read-only token must never get an rpc write/eval/js op through, and must never be logged.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import {
  loadReadonlyToken, tokenClass, safeEqual, isReadonlyRoute, READONLY_ROUTES, readonlyPath, RO_QUERIES, ALLOWED_NS,
  createReadonlyApi, MIN_TOKEN_LEN, MAX_READ_BYTES, TOKEN_FILE_NAME,
} from "../server/readonly.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bbro-"));
const FULL = "full-token-for-tests";
const RO = "r".repeat(40);

// ── token loader ─────────────────────────────────────────────────────────────
test("token: BB_READONLY=0 turns the class off", () => {
  const r = loadReadonlyToken({ env: { BB_READONLY: "0", BB_READONLY_TOKEN: RO }, dir: tmp() });
  assert.equal(r.token, null); assert.equal(r.source, "off");
});
test("token: BB_READONLY_TOKEN is used when long enough, refused when short or equal to the full token", () => {
  assert.deepEqual([loadReadonlyToken({ env: { BB_READONLY_TOKEN: RO }, dir: tmp() }).token, loadReadonlyToken({ env: { BB_READONLY_TOKEN: RO }, dir: tmp() }).source], [RO, "env"]);
  const short = loadReadonlyToken({ env: { BB_READONLY_TOKEN: "short" }, dir: tmp() });
  assert.equal(short.token, null); assert.match(short.summary, new RegExp(`shorter than ${MIN_TOKEN_LEN}`));
  const same = "f".repeat(40);
  assert.equal(loadReadonlyToken({ env: { BB_READONLY_TOKEN: same }, dir: tmp(), fullToken: same }).token, null);
});
test("token: generated into <dir>/readonly-token with mode 0600, then reused; the summary never contains the value", () => {
  const dir = path.join(tmp(), "state");
  const a = loadReadonlyToken({ env: {}, dir, fullToken: FULL });
  assert.equal(a.source, "generated"); assert.match(a.token, /^[0-9a-f]{64}$/);
  const file = path.join(dir, TOKEN_FILE_NAME);
  assert.equal(fs.readFileSync(file, "utf8"), a.token);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const b = loadReadonlyToken({ env: {}, dir, fullToken: FULL });
  assert.equal(b.source, "file"); assert.equal(b.token, a.token);
  assert.ok(!a.summary.includes(a.token) && !b.summary.includes(a.token));
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith(".tmp")), "no temp file left behind");
});
test("token: a stored token that is too short or equals the full token disables the class (delete the file to regenerate)", () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, TOKEN_FILE_NAME), "tiny");
  assert.equal(loadReadonlyToken({ env: {}, dir }).token, null);
  fs.writeFileSync(path.join(dir, TOKEN_FILE_NAME), FULL.padEnd(40, "x"));
  assert.equal(loadReadonlyToken({ env: {}, dir, fullToken: FULL.padEnd(40, "x") }).token, null);
});
test("token: an unwritable state directory disables the class instead of throwing", () => {
  const f = path.join(tmp(), "afile"); fs.writeFileSync(f, "x");
  const r = loadReadonlyToken({ env: {}, dir: path.join(f, "sub") });
  assert.equal(r.token, null); assert.equal(r.source, "invalid");
});

// ── auth class ───────────────────────────────────────────────────────────────
test("tokenClass: full, readonly, and everything else is null", () => {
  assert.equal(tokenClass(`Bearer ${FULL}`, { full: FULL, readonly: RO }), "full");
  assert.equal(tokenClass(`Bearer ${RO}`, { full: FULL, readonly: RO }), "readonly");
  for (const h of [undefined, "", "Bearer ", "Bearer nope", `bearer ${RO}`, RO, `Bearer ${RO} `, `Bearer ${RO}x`, 42, null])
    assert.equal(tokenClass(h, { full: FULL, readonly: RO }), null, String(h));
  assert.equal(tokenClass(`Bearer ${RO}`, { full: FULL, readonly: null }), null, "class off: its token is just wrong");
  assert.equal(tokenClass(`Bearer ${FULL}`, { full: "", readonly: RO }), null);
});
test("safeEqual: equal strings only", () => { assert.ok(safeEqual("a", "a")); assert.ok(!safeEqual("a", "b")); assert.ok(!safeEqual("a", "aa")); });

// ── allowlist ────────────────────────────────────────────────────────────────
test("allowlist: only read routes; every mutating route is refused", () => {
  assert.deepEqual([...READONLY_ROUTES].sort(), ["GET /api/dashboard", "GET /api/drift", "GET /api/plan", "GET /api/report", "GET /api/settings", "GET /api/status", "POST /api/ro/query", "POST /api/ro/read"]);
  for (const r of ["POST /api/eval", "POST /api/js", "POST /api/read", "POST /api/write", "POST /api/note", "POST /api/checkin", "POST /api/notify", "POST /api/escalate-test",
    "POST /api/settings", "POST /api/remote", "POST /api/pull", "POST /api/push", "POST /api/import-save", "POST /api/backup", "GET /api/anything-new", "DELETE /api/status", "GET /healthz"])
    assert.equal(isReadonlyRoute(r), false, r);
});

// ── file reads ───────────────────────────────────────────────────────────────
test("readonlyPath: data/<name>.txt only", () => {
  assert.equal(readonlyPath("data/ram-status.txt"), "data/ram-status.txt");
  assert.equal(readonlyPath("/data/aug-plan.txt"), "data/aug-plan.txt");
  for (const bad of ["agent/rpc-config.txt", "data/../agent/rpc-config.txt", "data/sub/x.txt", "data/x.js", "data/x.txt/", "data/..txt", "data/.txt", "data//x.txt", "//data/x.txt",
    "../data/x.txt", "data\\x.txt", "data/x.txt\n", "data/" + "a".repeat(70) + ".txt", "", "data", 5, null, undefined, {}, ["data/x.txt"]])
    assert.throws(() => readonlyPath(bad), (e) => e.status === 400, JSON.stringify(bad));
});
const fakeRpc = (value) => { const calls = []; return { calls, rpc: async (op, args) => { calls.push([op, args]); return { id: 1, ok: true, value }; } }; };
test("read: tailLines keeps the last lines and flags truncation; the huge telemetry file needs tailLines", async () => {
  const text = Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n") + "\n";
  const { rpc, calls } = fakeRpc(text);
  const api = createReadonlyApi({ rpc });
  const r = await api.read({ file: "data/events.txt", tailLines: 3 });
  assert.deepEqual(r.value.split("\n").filter(Boolean), ["l97", "l98", "l99"]); assert.equal(r.truncated, true);
  assert.equal((await api.read({ file: "data/events.txt" })).truncated, false);
  await assert.rejects(api.read({ file: "data/telemetry.txt" }), /tailLines/);
  assert.equal((await api.read({ file: "data/telemetry.txt", tailLines: 5 })).truncated, true);
  for (const bad of [-1, 5001, 1.5, "3"]) await assert.rejects(api.read({ file: "data/events.txt", tailLines: bad }), (e) => e.status === 400);
  assert.ok(calls.every(([op]) => op === "read"), "only rpc read ops");
});
test("read: output is capped at MAX_READ_BYTES (the end is kept)", async () => {
  const big = "a".repeat(MAX_READ_BYTES) + "END";
  const r = await createReadonlyApi({ rpc: fakeRpc(big).rpc }).read({ file: "data/pred2.txt" });
  assert.equal(r.value.length, MAX_READ_BYTES); assert.ok(r.value.endsWith("END")); assert.equal(r.truncated, true);
});
test("read: an rpc error result is passed through unchanged", async () => {
  const api = createReadonlyApi({ rpc: async () => ({ id: 1, ok: false, error: "no such file" }) });
  assert.deepEqual(await api.read({ file: "data/x.txt" }), { id: 1, ok: false, error: "no such file" });
});

// ── fixed queries ────────────────────────────────────────────────────────────
const codeOf = (name, args = {}) => RO_QUERIES[name](args);
test("queries: every ns call is on the read-only allowlist and no other global is used", () => {
  for (const name of Object.keys(RO_QUERIES)) {
    const code = codeOf(name);
    const calls = new Set([...code.matchAll(/\bns(?:\.[A-Za-z_]\w*)+/g)].map((m) => m[0]));
    assert.ok(calls.size > 0, name);
    for (const c of calls) assert.ok(ALLOWED_NS.has(c), `${name} uses ${c}`);
    assert.doesNotMatch(code, /\b(window|document|globalThis|eval|Function|fetch|XMLHttpRequest|localStorage|indexedDB|require|import|process|setTimeout|ns\.write|ns\.exec|ns\.run|ns\.kill|ns\.scp|ns\.spawn)\b/, name);
  }
  for (const c of ALLOWED_NS) assert.doesNotMatch(c.split(".").pop(), /^(write|exec|run|kill|scp|spawn|purchase|upgrade|install|destroy|set|buy|donate|join|work|connect|hack|grow|weaken)/, c);
});
test("queries: the snippets compile as async function bodies", async () => {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  for (const name of Object.keys(RO_QUERIES)) assert.doesNotThrow(() => new AsyncFunction("ns", codeOf(name)), name);
});
test("queries: predCoverage takes a validated integer n and embeds nothing else", () => {
  assert.match(codeOf("predCoverage", {}), /const N = 200;/);
  assert.match(codeOf("predCoverage", { n: 50 }), /const N = 50;/);
  for (const bad of [0, 1001, 1.5, "5", "5; ns.write('x','y')", NaN, {}]) assert.throws(() => codeOf("predCoverage", { n: bad }), (e) => e.status === 400, String(bad));
});
test("queries: predCoverage computes coverage from pred2 rows", async () => {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const rows = [{ type: "p", id: "a", spec: { kind: "level" }, bucket: ">3h" }, { type: "p", id: "b", spec: { kind: "level" }, bucket: ">3h" },
    { type: "r", id: "a", actual: 5, inBand: true }, { type: "r", id: "b", actual: 6, inBand: false }, { type: "r", id: "c", void: "install" }];
  const ns = { read: () => rows.map((r) => JSON.stringify(r)).join("\n") + "\n" };
  const out = await new AsyncFunction("ns", codeOf("predCoverage", { n: 10 }))(ns);
  assert.deepEqual(out, { n: 2, inBand: 0.5, by: { "level|>3h": { n: 2, inBand: 1 } }, resolved: 2 });
});
test("query api: unknown names (including prototype keys) are 400 and never reach rpc", async () => {
  const { rpc, calls } = fakeRpc(null);
  const api = createReadonlyApi({ rpc });
  for (const q of ["eval", "", "__proto__", "constructor", "toString", undefined, 5, null, "resetInfo; ns.write()"]) await assert.rejects(api.query({ query: q }), (e) => e.status === 400, String(q));
  assert.equal(calls.length, 0);
  await api.query({ query: "homeRam" });
  assert.deepEqual(calls.map(([op]) => op), ["eval"]);
});

// ── real server ──────────────────────────────────────────────────────────────
async function withServer({ port, env, fn, stateDir = path.join(tmp(), "state") }) {
  const srvEnv = { ...process.env, NODE_ENV: "test", BB_TOKEN: FULL, BB_PORT: String(port), BB_STATE_DIR: stateDir, BB_BACKUP_DIR: path.join(tmp(), "backups"), BB_BACKUP_MIN: "0", BB_CHECKIN_AUTO: "0", BB_WATCHDOG_MIN: "0", ...env };
  delete srvEnv.BB_URL; delete srvEnv.BB_TOKEN_VIA_PROXY;
  const srv = spawn(process.execPath, ["server/index.js"], { env: srvEnv, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; srv.stdout.on("data", (d) => (out += d)); srv.stderr.on("data", (d) => (out += d));
  const until = async (re) => { for (let i = 0; i < 100 && !re.test(out); i++) await new Promise((r) => setTimeout(r, 50)); assert.match(out, re, "server output"); };
  try {
    await until(/bb server on/);
    const ops = [];
    const sock = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${FULL}`);
    await new Promise((r, j) => { sock.on("open", r); sock.on("error", j); });
    sock.on("message", (d) => {
      const m = JSON.parse(d); ops.push(m);
      const value = m.op === "read" ? `contents of ${m.file}\nsecond line\n` : { ranOp: m.op };
      sock.send(JSON.stringify({ id: m.id, ok: true, value }));
    });
    await until(/rpc bridge connected/);
    const api = async (route, { method = "GET", token, body } = {}) => {
      const r = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    await fn({ api, ops, stateDir, getOut: () => out });
    sock.close();
  } finally { srv.kill(); }
  return out;
}

test("server: the read-only token reads allowlisted routes and nothing else; no mutating op reaches the game", async () => {
  const out = await withServer({ port: 13526, env: { BB_READONLY_TOKEN: RO }, async fn({ api, ops }) {
    assert.equal((await api("/api/status")).status, 401);
    assert.equal((await api("/api/status", { token: "wrong" })).status, 401);
    assert.equal((await api("/api/status", { token: RO })).status, 200);
    assert.equal((await api("/api/status", { token: FULL })).status, 200);
    assert.equal((await api("/api/settings", { token: RO })).status, 200, "settings GET");
    const before = ops.length; // the settings GET reads data/settings.txt through rpc; nothing after this may add an op except the ro routes
    const denied = [["POST", "/api/eval", { code: "return 1" }], ["POST", "/api/js", { code: "1" }], ["POST", "/api/read", { file: "agent/rpc-config.txt" }],
      ["POST", "/api/write", { file: "data/x.txt", data: "x" }], ["POST", "/api/note", { msg: "x" }], ["POST", "/api/settings", { set: { "gang.enabled": false } }],
      ["POST", "/api/remote", { method: "x" }], ["POST", "/api/pull", {}], ["POST", "/api/push", {}], ["POST", "/api/backup", {}], ["POST", "/api/checkin", {}],
      ["POST", "/api/notify", { text: "x" }], ["POST", "/api/escalate-test", {}], ["POST", "/api/import-save", {}], ["GET", "/api/not-a-route"], ["DELETE", "/api/status"]];
    for (const [method, route, body] of denied) {
      const r = await api(route, { method, token: RO, body });
      assert.equal(r.status, 403, `${method} ${route}`); assert.match(r.json.error, /read-only token/);
    }
    assert.equal(ops.length, before, "denied calls never reached the in-game rpc");
    const ok = await api("/api/ro/read", { method: "POST", token: RO, body: { file: "data/ram-status.txt" } });
    assert.equal(ok.status, 200); assert.match(ok.json.value, /contents of data\/ram-status.txt/);
    for (const file of ["agent/rpc-config.txt", "data/../agent/rpc-config.txt", "/etc/passwd", "data/telemetry.txt"]) {
      const r = await api("/api/ro/read", { method: "POST", token: RO, body: { file } });
      assert.equal(r.status, 400, file);
    }
    const q = await api("/api/ro/query", { method: "POST", token: RO, body: { query: "predCoverage", n: 20 } });
    assert.equal(q.status, 200);
    assert.equal((await api("/api/ro/query", { method: "POST", token: RO, body: { query: "write" } })).status, 400);
    const mine = ops.slice(before);
    assert.deepEqual(mine.map((o) => o.op), ["read", "eval"], "only a read and one fixed eval reached the game");
    assert.match(mine[1].code, /const N = 20;/);
    assert.doesNotMatch(mine[1].code, /ns\.write|ns\.exec|ns\.run/);
  } });
  assert.ok(!out.includes(RO), "the read-only token is never logged");
  assert.ok(!out.includes(FULL), "the full token is never logged");
});
test("server: the full token keeps every route, including eval, and can use the ro routes", async () => {
  await withServer({ port: 13527, env: { BB_READONLY_TOKEN: RO }, async fn({ api, ops }) {
    const e = await api("/api/eval", { method: "POST", token: FULL, body: { code: "return 1" } });
    assert.equal(e.status, 200); assert.deepEqual(e.json.value, { ranOp: "eval" });
    assert.equal((await api("/api/ro/read", { method: "POST", token: FULL, body: { file: "data/aug-plan.txt" } })).status, 200);
    assert.equal((await api("/api/not-a-route", { token: FULL })).status, 404);
    assert.deepEqual(ops.map((o) => o.op), ["eval", "read"]);
  } });
});
test("server: BB_READONLY=0 disables the class; a generated token is stored 0600, reused after restart, and never logged", async () => {
  await withServer({ port: 13528, env: { BB_READONLY: "0", BB_READONLY_TOKEN: RO }, async fn({ api }) {
    assert.equal((await api("/api/status", { token: RO })).status, 401, "disabled class: its token is just wrong");
    assert.equal((await api("/api/status", { token: FULL })).status, 200);
  } });
  const stateDir = path.join(tmp(), "state");
  let generated;
  const out1 = await withServer({ port: 13529, env: {}, stateDir, async fn({ api }) {
    const file = path.join(stateDir, TOKEN_FILE_NAME);
    generated = fs.readFileSync(file, "utf8");
    assert.match(generated, /^[0-9a-f]{64}$/); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal((await api("/api/status", { token: generated })).status, 200);
    assert.equal((await api("/api/settings", { method: "POST", token: generated, body: {} })).status, 403);
  } });
  assert.ok(!out1.includes(generated), "generated token never logged");
  assert.match(out1, /read-only API: enabled \(token generated into /);
  const out2 = await withServer({ port: 13530, env: {}, stateDir, async fn({ api }) {
    assert.equal(fs.readFileSync(path.join(stateDir, TOKEN_FILE_NAME), "utf8"), generated, "same token after restart");
    assert.equal((await api("/api/status", { token: generated })).status, 200);
  } });
  assert.match(out2, /read-only API: enabled \(token read from /); assert.ok(!out2.includes(generated));
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} readonly-api test(s) failed`); process.exit(1); }
console.log(`readonly-api: ${tests.length} passed`);
