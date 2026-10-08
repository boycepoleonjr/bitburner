/**
 * lib/kpi.js — the run's KPIs, computed from the small data files. PURE (no ns): the in-game dashboard and the bb
 * server's GET /api/dashboard call this same function, so agents and the owner see identical numbers.
 *
 * Every KPI: { value, display, status: "good"|"warn"|"bad"|"none", sources: [{file, field, value}], formula }.
 * Missing input -> value null, status "none", a source with missing:true. Never throws.
 *
 * Imports are relative ("./...") so Node (server, tests) and Bitburner resolve them the same way.
 * NOTE: property names that match Netscript function names (e.g. "hack", "share") are read with bracket strings, because
 * Bitburner's static RAM analyzer charges for any identifier with such a name.
 */
import { fmtMoney, fmtNum, fmtPct, fmtDur, DASH } from "./ui/format.js";
import { HOT_FILES } from "./data-sources.js";

export const KPI_KEYS = Object.freeze(["destroy", "phase", "moneyPerSec", "repPerSec", "ramUtil", "targets", "nextInstall", "money", "hackLevel"]);
export const KPI_LABELS = Object.freeze({
  destroy: "BitNode destroy", phase: "Phase / strategy", moneyPerSec: "Money / s", repPerSec: "Rep / s", ramUtil: "RAM utilization",
  targets: "Hack targets", nextInstall: "Next install", money: "Money", hackLevel: "Hacking level",
});
/** Sources older than this are stale (3 telemetry intervals). */
export const STALE_MS = 3 * 60 * 1000;
const READY_FLAG = /w0r1d_d43m0n READY/i;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const src = (file, field, value) => ({ file, field, value: value === undefined ? null : value, missing: value === undefined || value === null });
const kpi = (value, display, status, sources, formula) => ({ value, display: display ?? DASH, status: value == null ? "none" : status, sources, formula });

/** Rate of change of f(record) over the last windowMs of the ring, using the longest run without a reset (drop). */
export function slope(ring, f, windowMs, now) {
  const pts = (Array.isArray(ring) ? ring : []).filter((r) => r && num(r.t) != null && r.t >= now - windowMs && num(f(r)) != null);
  if (pts.length < 2) return null;
  let first = 0;
  for (let i = 1; i < pts.length; i++) if (f(pts[i]) < f(pts[i - 1])) first = i; // reset or spend: restart after the drop
  const a = pts[first], b = pts[pts.length - 1];
  const dt = (b.t - a.t) / 1000;
  return dt > 0 ? (f(b) - f(a)) / dt : null;
}

/**
 * @param {{latest?:Object, ring?:Object[], ramStatus?:Object, augPlan?:Object, autopilot?:Object, pred2Tail?:Object[], settings?:Object, now?:number}} input
 */
export function computeKpis(input = {}) {
  const { latest = null, ring = [], ramStatus = null, augPlan = null, autopilot = null, pred2Tail = [], settings = {} } = input || {};
  const now = num(input && input.now) ?? Date.now();
  const F = HOT_FILES;
  const fresh = (o) => o && num(o.t) != null && now - o.t <= STALE_MS;
  const out = {};

  // ── money / hacking level / money per second ───────────────────────────────
  const lat = latest && typeof latest === "object" ? latest : null;
  const latStale = lat ? !fresh(lat) : true;
  out.money = kpi(num(lat?.money), fmtMoney(num(lat?.money)), latStale ? "warn" : "good", [src(F.latest, "money", lat?.money)], "telemetry-latest.money");
  const hl = num(lat?.lvl?.hacking);
  out.hackLevel = kpi(hl, hl == null ? DASH : String(hl), latStale ? "warn" : "good", [src(F.latest, "lvl.hacking", lat?.lvl?.hacking)], "telemetry-latest.lvl.hacking");
  let mps = num(lat?.income), mpsFormula = "telemetry-latest.income (script income $/s)";
  const mpsSources = [src(F.latest, "income", lat?.income)];
  if (mps == null) {
    mps = slope(ring, (r) => r.money, 10 * 60 * 1000, now);
    mpsFormula = "Δ money / Δ t over the last 10 min of telemetry-ring (net of spending)";
    mpsSources.push(src(F.ring, "money", ring?.length ? `${ring.length} points` : undefined));
  }
  out.moneyPerSec = kpi(mps, mps == null ? DASH : fmtMoney(mps) + "/s", latStale ? "warn" : mps > 0 ? "good" : "warn", mpsSources, mpsFormula);

  // ── faction rep per second (current work faction) ──────────────────────────
  const fac = lat?.work && lat.work.type === "FACTION" ? lat.work.name : null;
  const rps = fac ? slope(ring, (r) => num(r.rep?.[fac]), 10 * 60 * 1000, now) : null;
  out.repPerSec = kpi(rps, rps == null ? (fac ? DASH : "not working for a faction") : `${fmtNum(rps)}/s`, rps > 0 ? "good" : "warn",
    [src(F.latest, "work", lat?.work), src(F.ring, `rep.${fac ?? "<faction>"}`, fac && ring?.length ? `${ring.length} points` : undefined)],
    `Δ rep[${fac ?? "work faction"}] / Δ t over the last 10 min of telemetry-ring`);

  // ── RAM utilization + targets ──────────────────────────────────────────────
  const rs = ramStatus && typeof ramStatus === "object" ? ramStatus : null;
  let util = num(rs?.util?.ema5), utilFormula = "ram-status.util.ema5 (5-min average running / usable)";
  const utilSources = [src(F.ramStatus, "util.ema5", rs?.util?.ema5)];
  if (util == null || !fresh(rs)) {
    const max = num(lat?.net?.max), used = num(lat?.net?.used);
    util = max ? (used ?? 0) / max : null;
    utilFormula = "telemetry-latest.net.used / net.max (instant sample; ram-status missing or stale)";
    utilSources.push(src(F.latest, "net", lat?.net));
  }
  out.ramUtil = kpi(util, fmtPct(util), util >= 0.9 ? "good" : util >= 0.5 ? "warn" : "bad", utilSources, utilFormula);
  const tg = Array.isArray(rs?.activeTargets) ? rs.activeTargets.length : null;
  out.targets = kpi(tg, tg == null ? DASH : String(tg), "good", [src(F.ramStatus, "activeTargets", rs?.activeTargets ? `${tg} targets` : undefined)], "ram-status.activeTargets.length");

  // ── phase / strategy weight ────────────────────────────────────────────────
  const ap = augPlan && typeof augPlan === "object" ? augPlan : null;
  const phase = ap?.phase ?? rs?.phase ?? null;
  const progress = num(ap?.progress) ?? num(rs?.progress);
  const weight = num(rs?.weight) ?? (phase ? num(settings?.[`strategy.${phase}`]) : null);
  out.phase = kpi(phase, phase ? `${phase} · ${fmtPct(progress, 0)} · w ${weight == null ? DASH : weight.toFixed(2)}` : DASH, "good",
    [src(F.augPlan, "phase", ap?.phase), src(F.augPlan, "progress", ap?.progress), src(F.ramStatus, "weight", rs?.weight)],
    "phase from aug-plan (else ram-status); progress = fl1ght.exe progress; weight 0 = money, 1 = faction rep");
  out.phase.extra = { phase, progress, weight };

  // ── next install ───────────────────────────────────────────────────────────
  const nx = ap?.install?.next;
  if (nx && (num(nx.etaMin) != null || nx.reason)) {
    const eta = num(nx.etaMin);
    out.nextInstall = kpi(eta ?? -1, `${eta == null ? DASH : fmtDur(eta * 60000)}${nx.reason ? ` · ${nx.reason}` : ""}`, "good",
      [src(F.augPlan, "install.next", nx), src(F.augPlan, "install.queued", ap.install.queued)], "aug-plan.install.next.etaMin");
  } else {
    const buy = num(autopilot?.augs?.buyable), at = num(settings?.["augs.installAt"]) ?? 6;
    out.nextInstall = kpi(buy, buy == null ? DASH : `${buy}/${at} buyable`, buy >= at ? "warn" : "good",
      [src(F.autopilot, "augs.buyable", autopilot?.augs?.buyable)], "autopilot-status.augs.buyable vs settings augs.installAt (aug-plan missing)");
  }

  // ── BitNode destroy milestone ──────────────────────────────────────────────
  const wd = ap?.worldDaemon || null;
  const flags = Array.isArray(autopilot?.flags) ? autopilot.flags : [];
  const flagReady = flags.some((f) => READY_FLAG.test(String(f)));
  const ready = wd ? !!wd.ready || !!ap?.node?.ready : flagReady;
  const req = num(wd?.req), have = num(wd?.["hack"]) ?? hl;
  let destroyVal = null, destroyDisp = DASH, destroyStatus = "none", destroyFormula = "aug-plan.worldDaemon.ready, else autopilot flag 'w0r1d_d43m0n READY'";
  if (ready) {
    destroyVal = 0;
    destroyDisp = settings?.["node.autoDestroy"] ? "READY · auto-destroy on" : "READY · awaiting decision";
    destroyStatus = settings?.["node.autoDestroy"] ? "good" : "warn";
  } else if (req != null) {
    const p = (Array.isArray(pred2Tail) ? pred2Tail : []).filter((r) => r && r.spec && (r.spec.kind === "level" || r.spec.kind === "hacking") && num(r.spec.target) >= req && num(r.eta))
      .sort((a, b) => b.made - a.made)[0];
    destroyVal = p ? Math.max(0, p.eta - now) : null;
    destroyDisp = p ? fmtDur(destroyVal) : `hack ${have ?? DASH} / ${req}`;
    destroyStatus = "good";
    destroyFormula = "pred2 hacking-level prediction for w0r1d_d43m0n's requirement (eta - now)";
    if (destroyVal == null) { destroyVal = have != null ? -1 : null; destroyStatus = "warn"; }
  }
  out.destroy = kpi(destroyVal, destroyDisp, destroyStatus,
    [src(F.augPlan, "worldDaemon", wd || undefined), src(F.augPlan, "node", ap?.node), src(F.autopilot, "flags", autopilot?.flags)], destroyFormula);

  // ── attention + freshness ──────────────────────────────────────────────────
  const attention = flags.map((f) => ({ level: READY_FLAG.test(String(f)) ? "warn" : "bad", text: String(f), view: READY_FLAG.test(String(f)) ? "node" : "logs" }));
  if (lat && latStale) attention.push({ level: "warn", text: `telemetry is stale (${fmtDur(now - lat.t)} old)`, view: "raw", file: F.latest });
  if (!lat) attention.push({ level: "warn", text: "no telemetry-latest.txt yet (restart agent/telemetry.js)", view: "raw", file: F.latest });
  if (rs && Array.isArray(rs.reasons)) for (const r of rs.reasons.slice(0, 3)) attention.push({ level: "info", text: `RAM: ${r}`, view: "ram" });

  const files = {};
  for (const [k, f] of Object.entries({ latest: lat, ramStatus: rs, augPlan: ap, autopilot })) {
    files[F[k]] = f ? { t: num(f.t), ageMs: num(f.t) != null ? now - f.t : null, stale: !fresh(f), missing: false } : { t: null, ageMs: null, stale: true, missing: true };
  }
  return { t: now, bn: num(lat?.bn) ?? num(ap?.bn), kpis: out, attention, files };
}
