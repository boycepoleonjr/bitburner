// External monitor for the hosted game (run by .github/workflows/monitor.yml; no dependencies, Node >= 20).
// The in-container watchdog cannot report the container itself dying, so this runs on GitHub's side and keeps one
// open issue per problem:
//   incident        hosted game unreachable (/healthz), or its scheduled check-ins have stalled
//   attention       each r.attention item from the latest fresh check-in (/api/report, needs the BB_TOKEN secret)
//   owner-decision  attention items only the owner acts on (e.g. "w0r1d_d43m0n READY")
// Issues are matched by a hidden marker, created when a problem appears and closed when it clears.
// Env: BB_URL (default hosted URL), BB_TOKEN (optional), GITHUB_TOKEN + GITHUB_REPOSITORY (issue sync),
//      MONITOR_DRY_RUN=1 (print the plan, touch nothing on GitHub).
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { OWNER_DECISION } from "../../server/checkin.js";

export const LABELS = {
  monitor: { color: "5319e7", description: "Managed by the monitor workflow (opened/closed automatically)" },
  incident: { color: "b60205", description: "Hosted game down or check-ins stalled" },
  attention: { color: "d93f0b", description: "Check-in attention item" },
  "owner-decision": { color: "fbca04", description: "Needs the owner's decision" },
};
export const STALE_MIN = 150; // check-in cadence is at most 120 min (server/checkin.js cadenceMs)
const MARK = /<!-- bb-monitor:([a-z0-9:-]+) -->/;

// Numbers in attention text change between check-ins ("5 augs buyable" -> "6 augs buyable"): same problem, same issue.
export const attentionKey = (text) =>
  "att-" + createHash("sha256").update(String(text).toLowerCase().replace(/\d+(\.\d+)?/g, "#").replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// What should be open right now. report: the GET /api/report value ({latest, ageMin, stale}) or null if not fetched.
export function desiredProblems({ up, healthError, report }) {
  const out = [];
  if (!up) {
    out.push({ key: "incident-unreachable", kind: "incident", title: "Incident: hosted game unreachable",
      detail: `/healthz failed: ${healthError || "unknown error"}. The container may be down or redeploying; check Railway.` });
    return { problems: out, attentionKnown: false };
  }
  if (!report) return { problems: out, attentionKnown: false };
  const l = report.latest;
  // A single failed check-in retries in 5 min and game/rpc outages are the container's own watchdog's job; flag only a
  // check-in loop that has stopped producing records.
  if (!l || !(report.ageMin < STALE_MIN)) {
    out.push({ key: "incident-stale", kind: "incident", title: "Incident: check-ins stalled",
      detail: `Latest check-in: ${l?.t || "none"} (${report.ageMin ?? "?"} min old). The bb server answers but the ` +
        "scheduled check-in has not run; check BB_CHECKIN_AUTO and the container logs." });
    return { problems: out, attentionKnown: false };
  }
  if (report.stale || !l.ok) return { problems: out, attentionKnown: false };
  for (const text of l.attention || []) {
    if (out.some((p) => p.key === attentionKey(text))) continue;
    const owner = OWNER_DECISION.some((re) => re.test(text));
    out.push({ key: attentionKey(text), kind: owner ? "owner-decision" : "attention", title: clip(`${owner ? "Owner decision" : "Attention"}: ${text}`, 120),
      detail: text, report: l.report, t: l.t });
  }
  return { problems: out, attentionKnown: true };
}

// open: [{number, title, body}] issues labelled "monitor". Attention issues are only closed when the attention list
// is known (a fresh report); incidents always reflect this run.
export function planSync(open, { problems, attentionKnown }) {
  const byKey = new Map();
  for (const i of open) { const m = MARK.exec(i.body || ""); if (m && !byKey.has(m[1])) byKey.set(m[1], i); }
  const want = new Map(problems.map((p) => [p.key, p]));
  const create = [], retitle = [], close = [];
  for (const p of problems) {
    const i = byKey.get(p.key);
    if (!i) create.push(p);
    else if (i.title !== p.title) retitle.push({ number: i.number, title: p.title });
  }
  for (const [key, i] of byKey) {
    if (want.has(key)) continue;
    if (key.startsWith("incident-") || attentionKnown) close.push({ number: i.number, key });
  }
  return { create, retitle, close };
}

export function issueBody(p) {
  const lines = [`<!-- bb-monitor:${p.key} -->`, p.detail, ""];
  if (p.report) lines.push(`Check-in at ${p.t}:`, "", "```", clip(p.report, 6000), "```", "");
  lines.push("_Opened by the monitor workflow; it closes this issue when the problem clears. See AGENTS.md for handling._");
  return lines.join("\n");
}

async function fetchJson(url, opts = {}, timeoutMs = 20000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function checkHealth(base, tries = 3, gapMs = 20000) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { await fetchJson(`${base}/healthz`); return { up: true }; } catch (e) { err = e.message; }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  return { up: false, healthError: err };
}

function github(repo, token) {
  const api = (path, method = "GET", body) => fetchJson(`https://api.github.com/repos/${repo}${path}`, {
    method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  });
  return {
    async ensureLabels(names) {
      for (const name of names) {
        try { await api(`/labels/${encodeURIComponent(name)}`); }
        catch { await api("/labels", "POST", { name, ...LABELS[name] }).catch(() => {}); }
      }
    },
    async openIssues() {
      const out = [];
      for (let page = 1; page < 10; page++) {
        const batch = await api(`/issues?labels=monitor&state=open&per_page=100&page=${page}`);
        out.push(...batch.filter((i) => !i.pull_request));
        if (batch.length < 100) break;
      }
      return out;
    },
    create: (p) => api("/issues", "POST", { title: p.title, body: issueBody(p), labels: ["monitor", p.kind] }),
    retitle: (n, title) => api(`/issues/${n}`, "PATCH", { title }),
    async close(n, note) {
      await api(`/issues/${n}/comments`, "POST", { body: note });
      await api(`/issues/${n}`, "PATCH", { state: "closed", state_reason: "completed" });
    },
  };
}

export async function main(env = process.env) {
  const base = (env.BB_URL || "https://game-production-0b2d.up.railway.app").replace(/\/+$/, "");
  const dry = env.MONITOR_DRY_RUN === "1";
  const health = await checkHealth(base, dry ? 1 : 3);
  let report = null;
  if (health.up && (env.BB_TOKEN || env.BB_TOKEN_VIA_PROXY === "1")) {
    const headers = env.BB_TOKEN ? { authorization: `Bearer ${env.BB_TOKEN}` } : {};
    const r = await fetchJson(`${base}/api/report`, { headers }).catch((e) => ({ ok: false, error: e.message }));
    if (r?.ok) report = r.value;
    else if (/^401\b/.test(r?.error || "")) throw new Error("BB_TOKEN rejected by /api/report (401): update the repo secret");
    else console.log(`report unavailable: ${r?.error}`);
  } else if (health.up) console.log("BB_TOKEN not set: health check only (no attention sync)");
  const desired = desiredProblems({ ...health, report });
  console.log(`health=${health.up ? "up" : "DOWN"} report=${report ? (report.stale ? "stale" : "fresh") : "n/a"} problems=${desired.problems.length}`);
  if (dry) { console.log(JSON.stringify(desired.problems.map(({ key, kind, title }) => ({ key, kind, title })), null, 2)); return; }

  const gh = github(env.GITHUB_REPOSITORY, env.GITHUB_TOKEN);
  const plan = planSync(await gh.openIssues(), desired);
  if (plan.create.length) await gh.ensureLabels(["monitor", ...new Set(plan.create.map((p) => p.kind))]);
  const now = new Date().toISOString();
  for (const p of plan.create) { const i = await gh.create(p); console.log(`opened #${i.number} ${p.title}`); }
  for (const r of plan.retitle) { await gh.retitle(r.number, r.title); console.log(`retitled #${r.number}`); }
  for (const c of plan.close) { await gh.close(c.number, `Cleared at ${now}: no longer reported by the monitor.`); console.log(`closed #${c.number}`); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
