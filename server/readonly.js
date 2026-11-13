// Read-only access for the supervisor routine (spec: docs/specs/readonly-api.md, ledger F-010).
//
// A second bearer token, "readonly", that the server itself restricts. The full token (BB_TOKEN) keeps working
// everywhere. The read-only token can reach only the routes in READONLY_ROUTES, and those never run caller-supplied
// code: files are read from data/*.txt only, and queries are fixed server-side ns snippets (RO_QUERIES) that take
// validated integers. Anything not listed is refused with 403 (deny by default).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TOKEN_FILE_NAME = "readonly-token";
export const MIN_TOKEN_LEN = 32;
const err = (message, status = 400) => Object.assign(new Error(message), { status });

// ---------- token ----------
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
/** Constant-time string comparison (hashes first so lengths do not leak). */
export const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

/**
 * Where the read-only token comes from, in order: BB_READONLY=0 turns the class off; BB_READONLY_TOKEN (a Railway secret
 * variable, at least 32 characters); else <dir>/readonly-token (mode 0600), generated on first start. Never returns or
 * logs the value except in `token`, which only the auth check uses. `summary` is safe to log.
 * @returns {{token:string|null, source:"off"|"env"|"file"|"generated"|"invalid", summary:string}}
 */
export function loadReadonlyToken({ env = process.env, dir, fullToken = "", fsImpl = fs, rand = crypto.randomBytes } = {}) {
  if (env.BB_READONLY === "0") return { token: null, source: "off", summary: "read-only API: disabled (BB_READONLY=0)" };
  const bad = (why) => ({ token: null, source: "invalid", summary: `read-only API: disabled, ${why}` });
  const fromEnv = (env.BB_READONLY_TOKEN || "").trim();
  if (fromEnv) {
    if (fromEnv.length < MIN_TOKEN_LEN) return bad(`BB_READONLY_TOKEN is shorter than ${MIN_TOKEN_LEN} characters`);
    if (fullToken && safeEqual(fromEnv, fullToken)) return bad("BB_READONLY_TOKEN equals the full token");
    return { token: fromEnv, source: "env", summary: "read-only API: enabled (token from BB_READONLY_TOKEN)" };
  }
  if (!dir) return bad("no state directory");
  const file = path.join(dir, TOKEN_FILE_NAME);
  try {
    let source = "file", token = fsImpl.existsSync(file) ? fsImpl.readFileSync(file, "utf8").trim() : "";
    if (token && (token.length < MIN_TOKEN_LEN || (fullToken && safeEqual(token, fullToken)))) return bad(`${file} is invalid (delete it to regenerate)`);
    if (!token) {
      fsImpl.mkdirSync(dir, { recursive: true });
      token = rand(32).toString("hex");
      const tmp = `${file}.${process.pid}.tmp`;
      fsImpl.writeFileSync(tmp, token, { mode: 0o600 });
      fsImpl.renameSync(tmp, file);
      source = "generated";
    }
    return { token, source, summary: `read-only API: enabled (token ${source === "generated" ? "generated into" : "read from"} ${file})` };
  } catch (e) {
    return bad(`cannot use ${file}: ${e.code || "error"}`);
  }
}

/** "full" | "readonly" | null for an Authorization header value. */
export function tokenClass(header, { full, readonly = null } = {}) {
  const m = /^Bearer (.+)$/.exec(typeof header === "string" ? header : "");
  if (!m) return null;
  if (full && safeEqual(m[1], full)) return "full";
  if (readonly && safeEqual(m[1], readonly)) return "readonly";
  return null;
}

// ---------- route allowlist ----------
/** Every route the read-only token may call. All are read-only: GETs of cached or derived state, and the two /api/ro/* routes. */
export const READONLY_ROUTES = Object.freeze(new Set([
  "GET /api/status", "GET /api/drift", "GET /api/report", "GET /api/settings", "GET /api/plan", "GET /api/dashboard",
  "POST /api/ro/read", "POST /api/ro/query",
]));
export const isReadonlyRoute = (route) => READONLY_ROUTES.has(route);

// ---------- file reads ----------
const READ_PATH = /^data\/[A-Za-z0-9._-]{1,64}\.txt$/;
/** Large append-only files that may only be read as a tail. */
const TAIL_ONLY = new Set(["data/telemetry.txt"]);
export const MAX_READ_BYTES = 2_000_000;
export const MAX_TAIL_LINES = 5000;

/** Normalized data/<name>.txt path, or throws 400. agent/rpc-config.txt (holds the full token) and everything outside data/ is refused. */
export function readonlyPath(file) {
  if (typeof file !== "string") throw err("file must be a string");
  const f = file.replace(/^\//, "");
  if (!READ_PATH.test(f) || f.includes("..")) throw err("read-only token: only data/<name>.txt files can be read");
  return f;
}

// ---------- fixed queries ----------
const int = (v, def, min, max, name) => {
  if (v === undefined || v === null) return def;
  if (!Number.isInteger(v) || v < min || v > max) throw err(`${name} must be an integer from ${min} to ${max}`);
  return v;
};

/** name -> (validated args) -> async-body ns code. Callers pick a name and integers; they never supply code. */
export const RO_QUERIES = Object.freeze({
  resetInfo: () => `const ri = ns.getResetInfo();
let sf = null; try { sf = ns.singularity.getOwnedSourceFiles(); } catch { /* no SF4 */ }
return { bn: ri.currentNode, lastAug: ri.lastAugReset, lastNode: ri.lastNodeReset, sf, now: Date.now() };`,
  homeRam: () => `return { max: ns.getServerMaxRam("home"), used: ns.getServerUsedRam("home") };`,
  files: () => `return ns.ls("home", "data/").filter((f) => /^data\\/[^/]+\\.txt$/.test(f)).map((f) => [f, ns.read(f).length]);`,
  predCoverage: (a) => {
    const n = int(a.n, 200, 1, 1000, "n");
    return `const N = ${n};
const rows = ns.read("data/pred2.txt").split("\\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const P = {}, R = [];
for (const r of rows) { if (r.type === "p") P[r.id] = r; else if (r.type === "r" && r.actual) R.push(r); }
const last = R.slice(-N), by = {};
for (const r of last) { const p = P[r.id]; if (!p) continue; const k = p.spec.kind + "|" + p.bucket; const o = (by[k] = by[k] || { n: 0, inBand: 0 }); o.n++; o.inBand += r.inBand ? 1 : 0; }
return { n: last.length, inBand: last.filter((r) => r.inBand).length / Math.max(1, last.length), by, resolved: R.length };`;
  },
});

/** Every ns function the fixed queries may call. test/readonly-api.js fails if a query uses anything else. */
export const ALLOWED_NS = Object.freeze(new Set([
  "ns.getResetInfo", "ns.singularity.getOwnedSourceFiles", "ns.getServerMaxRam", "ns.getServerUsedRam", "ns.ls", "ns.read",
]));

// ---------- API ----------
export function createReadonlyApi({ rpc }) {
  return {
    /** POST /api/ro/read {file, tailLines?} -> the rpc read result, value cut to the last tailLines lines and MAX_READ_BYTES. */
    async read(b = {}) {
      const file = readonlyPath(b.file);
      const tail = int(b.tailLines, 0, 0, MAX_TAIL_LINES, "tailLines");
      if (TAIL_ONLY.has(file) && !tail) throw err(`${file} is large: pass tailLines (1 to ${MAX_TAIL_LINES})`);
      const res = await rpc("read", { file });
      if (!res || res.ok === false || typeof res.value !== "string") return res;
      let v = res.value, truncated = false;
      if (tail) { const lines = v.split("\n"); if (lines.length > tail + 1) { v = lines.slice(-(tail + 1)).join("\n"); truncated = true; } }
      if (v.length > MAX_READ_BYTES) { v = v.slice(v.length - MAX_READ_BYTES); truncated = true; }
      return { ...res, value: v, truncated };
    },
    /** POST /api/ro/query {query, ...args} -> the rpc eval result of a fixed server-side snippet. */
    async query(b = {}) {
      const build = typeof b.query === "string" && Object.hasOwn(RO_QUERIES, b.query) ? RO_QUERIES[b.query] : null;
      if (!build) throw err(`unknown query (known: ${Object.keys(RO_QUERIES).join(", ")})`);
      return rpc("eval", { code: build(b), timeoutMs: 60000 });
    },
  };
}
