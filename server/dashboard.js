// GET /api/dashboard: the in-game dashboard's KPIs for agents. Same pure function (game/lib/kpi.js) and the same small
// files the dashboard reads each tick, plus the tail of pred2.txt. Never reads data/telemetry.txt.
import { computeKpis, KPI_KEYS, KPI_LABELS } from "../game/lib/kpi.js";
import { HOT_FILES, SLOW_FILES, tailLines, parseJson, parseJsonl } from "../game/lib/data-sources.js";
import { SETTINGS_FILE, parseFile, effective } from "../game/lib/settings-schema.js";

export function createDashboardApi({ rpc, nowMs = () => Date.now() }) {
  const read = async (file) => {
    const r = await rpc("read", { file });
    if (!r || r.ok === false) throw Object.assign(new Error(`could not read ${file}: ${r?.error ?? "no response"}`), { status: 502 });
    return typeof r.value === "string" ? r.value : "";
  };
  return {
    async get({ tail = 200 } = {}) {
      const names = { ...HOT_FILES, settings: SETTINGS_FILE, pred2: SLOW_FILES.pred2 };
      const text = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([k, f]) => [k, await read(f)])));
      const settings = effective(parseFile(text.settings).values);
      const out = computeKpis({
        latest: parseJson(text.latest), ring: parseJsonl(text.ring).rows, ramStatus: parseJson(text.ramStatus), augPlan: parseJson(text.augPlan),
        autopilot: parseJson(text.autopilot), pred2Tail: parseJsonl(tailLines(text.pred2, tail)).rows, settings, now: nowMs(),
      });
      out.bytes = Object.fromEntries(Object.entries(names).map(([k, f]) => [f, text[k].length]));
      return { ok: true, value: out };
    },
  };
}

/** One line per KPI for `bb dashboard`. */
export function formatDashboard(v) {
  const lines = [`Dashboard${v.bn ? ` · BN${v.bn}` : ""}`];
  for (const k of KPI_KEYS) { const x = v.kpis[k]; if (x) lines.push(`${x.status.padEnd(4)}  ${KPI_LABELS[k].padEnd(18)} ${x.display}`); }
  if (v.attention?.length) { lines.push("Attention:"); for (const a of v.attention) lines.push(`- [${a.level}] ${a.text}`); }
  return lines.join("\n");
}
