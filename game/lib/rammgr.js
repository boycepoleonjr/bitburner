/**
 * lib/rammgr.js — the ns side of the RAM manager (decisions live in lib/ramplan.js, which is pure).
 * Called from daemon.js tick(). New ns calls (RAM): getResetInfo 1 GB, getSharePower 0.2 GB. No Singularity.
 * Spec: docs/specs/ram-manager.md
 */
import { allocate, chooseExtraTargets, resizePlan, ema, repActiveFrom, hackNeedFrom, daedalusReqs, buildStatus,
  SHARE_SCRIPT, XP_SCRIPT, STATUS_FILE } from "lib/ramplan.js";
import { strategyNow } from "lib/progress.js";
import { planWave } from "lib/planner.js";
import { describe } from "lib/network.js";

export const AUTOPILOT_STATUS = "data/autopilot-status.txt";
export const TELEMETRY = "data/telemetry.txt";
export const DAEDALUS_CACHE = "data/daedalus-req.txt";
const TELEMETRY_EVERY_MS = 60_000;
let teleCache = { at: 0, line: "" };

/**
 * Observe the network: usable RAM, persistent workers, strategy inputs.
 * @param {NS} ns
 * @param {import("lib/config.js").Config} cfg
 * @param {Object} S  settings
 * @param {import("lib/network.js").ServerInfo[]} executors
 * @param {Map<string, import("lib/network.js").ServerInfo>} map
 */
export function observe(ns, cfg, S, executors, map, hackLevel, now) {
  const scriptRam = {};
  const ramOf = (f) => (scriptRam[f] ??= ns.getScriptRam(f, "home") || 0);
  const managedFiles = new Set([...Object.values(cfg.workers), SHARE_SCRIPT, XP_SCRIPT]);
  const loops = { share: [], xp: [] };
  let usable = 0;
  for (const s of executors) {
    let managed = 0;
    for (const p of ns.ps(s.host)) {
      if (!managedFiles.has(p.filename)) continue;
      const gb = p.threads * ramOf(p.filename);
      managed += gb;
      if (p.filename === SHARE_SCRIPT) loops.share.push({ pid: p.pid, host: s.host, ramGb: gb, args: p.args });
      if (p.filename === XP_SCRIPT) loops.xp.push({ pid: p.pid, host: s.host, ramGb: gb, args: p.args });
    }
    const used = ns.getServerUsedRam(s.host);
    const reserve = s.isHome ? cfg.homeReserveGb : 0;
    usable += Math.max(0, s.maxRam - reserve - Math.max(0, used - managed));
  }

  const apRaw = ns.read(AUTOPILOT_STATUS);
  let ap = null; try { ap = JSON.parse(apRaw || "null"); } catch { }
  let work = repActiveFrom({ autopilotRaw: apRaw, now });
  if (work.source === "stale") {
    if (now - teleCache.at >= TELEMETRY_EVERY_MS) {
      const t = ns.read(TELEMETRY) || "";
      teleCache = { at: now, line: t.slice(t.trimEnd().lastIndexOf("\n") + 1) };
    }
    work = repActiveFrom({ telemetryLine: teleCache.line, now });
  }

  const reset = ns.getResetInfo();
  const owned = reset.ownedAugs instanceof Map ? reset.ownedAugs : new Map(Object.entries(reset.ownedAugs || {}));
  const hasRedPill = owned.has("The Red Pill") || ap?.augs?.redPill === true;
  const req = daedalusReqs(ns.read(DAEDALUS_CACHE), cfg.hooks.milestones.daedalus);
  const strat = strategyNow({ augsInstalled: owned.size, augsReq: req.augs, money: ns.getServerMoneyAvailable("home"), moneyReq: req.money,
    hack: hackLevel, hackReq: req.hack }, hasRedPill, S);
  const servers = [...map.values()].map((s) => ({ host: s.host, rooted: s.rooted, owned: s.isHome || s.isPurchased || s.isHacknet, maxMoney: s.maxMoney, reqHack: s.reqHack }));
  const hn = hackNeedFrom({ hack: hackLevel, hackReq: req.hack, worldReq: map.get("w0r1d_d43m0n")?.reqHack ?? 0, servers });
  return { usable, loops, ramOf, repActive: work.active, workSource: work.source, strat, hackNeed: hn.need, hackNeedWhy: hn.why, reqSource: req.source };
}

/**
 * Extend the active target set beyond the floor (primary + pickSecondaries) while demand fits, then allocate buckets.
 * @returns {{secondaries:string[], alloc:ReturnType<typeof allocate>, demandGb:number}}
 */
export function plan(ns, cfg, S, ctx, ranking, primary, baseSecondaries, ram) {
  const demandOf = (host) => planWave(ns, describe(ns, host), cfg, Infinity, ram, cfg.farm.hackFraction, cfg.farm.maxBatches)?.ramGb ?? 0;
  const max = S["ram.targets.max"] > 0 ? S["ram.targets.max"] : Infinity;
  const base = [primary, ...baseSecondaries].filter(Boolean).slice(0, max);
  const shareFirst = S["ram.share.enabled"] && ctx.repActive ? ctx.strat.weight * ctx.usable : 0;
  const baseDemand = base.reduce((a, h) => a + demandOf(h), 0);
  const rest = ranking.filter((c) => !base.includes(c.host)).map((c) => ({ host: c.host, demandGb: demandOf(c.host) }));
  const extra = chooseExtraTargets(rest, ctx.usable - shareFirst - baseDemand, max - base.length);
  const demandGb = baseDemand + extra.demandGb;
  const alloc = allocate({ usableGb: ctx.usable, weight: ctx.strat.weight, repActive: ctx.repActive, hackNeed: ctx.hackNeed,
    demandGb, xpMode: S["ram.xp.mode"], shareEnabled: S["ram.share.enabled"] });
  return { secondaries: [...base.filter((h) => h !== primary), ...extra.hosts], alloc, demandGb };
}

/** Free RAM for a starved primary: kill xp loops first, then share loops. Never touches H/G/W. Returns GB freed. */
export function shrinkLoops(ns, ctx, needGb) {
  let freed = 0;
  for (const kind of ["xp", "share"]) {
    for (const p of [...ctx.loops[kind]].sort((a, b) => b.ramGb - a.ramGb)) {
      if (freed >= needGb) return freed;
      if (ns.kill(p.pid)) { freed += p.ramGb; ctx.loops[kind] = ctx.loops[kind].filter((x) => x.pid !== p.pid); }
    }
  }
  return freed;
}

/** Kill every persistent loop (manager turned off). */
export function killAllLoops(ns, ctx) {
  let n = 0;
  for (const kind of ["share", "xp"]) for (const p of ctx.loops[kind]) if (ns.kill(p.pid)) n++;
  ctx.loops = { share: [], xp: [] };
  return n;
}

/**
 * Resize share/xp loops toward their allocation with hysteresis, placing into the remaining pool.
 * share: home first (cores bonus), then largest free; xp: largest free first.
 * @returns {{killed:number, spawned:{share:number, xp:number}, reasons:string[]}}
 */
export function resizeLoops(ns, ctx, alloc, pool, S, { allowSpawn = true, xpRooted = true, nextTag = () => `${Date.now()}` } = {}) {
  const reasons = [];
  let killed = 0;
  const spawned = { share: 0, xp: 0 };
  const xpTarget = S["ram.xp.target"];
  // an xp loop aimed at an old target is always replaced
  for (const p of ctx.loops.xp.filter((x) => String(x.args?.[0]) !== xpTarget)) { if (ns.kill(p.pid)) killed++; }
  ctx.loops.xp = ctx.loops.xp.filter((x) => String(x.args?.[0]) === xpTarget);
  const wants = { share: alloc.shareGb, xp: xpRooted ? alloc.xpGb : 0 };
  if (!xpRooted && alloc.xpGb > 0) reasons.push(`xp target ${xpTarget} not rooted: xp loops paused`);
  for (const kind of ["share", "xp"]) {
    const script = kind === "share" ? SHARE_SCRIPT : XP_SCRIPT;
    const unit = ctx.ramOf(script);
    if (!(unit > 0)) { reasons.push(`${script} missing on home`); continue; }
    const r = resizePlan({ targetGb: wants[kind], procs: ctx.loops[kind], threshold: S["ram.resizeThreshold"], unitGb: unit });
    for (const pid of r.kill) {
      if (ns.kill(pid)) { killed++; const p = ctx.loops[kind].find((x) => x.pid === pid); if (p) { for (const slot of pool) if (slot.host === p.host) slot.free += p.ramGb; } }
      ctx.loops[kind] = ctx.loops[kind].filter((x) => x.pid !== pid);
    }
    if (!allowSpawn || r.spawnGb <= 0) continue;
    let threads = Math.floor(r.spawnGb / unit);
    const order = [...pool].sort((a, b) => kind === "share" ? (b.isHome - a.isHome) || (b.free - a.free) : b.free - a.free);
    for (const slot of order) {
      if (threads <= 0) break;
      const n = Math.min(threads, Math.floor(slot.free / unit));
      if (n <= 0) continue;
      if (!slot.isHome && !ns.fileExists(script, slot.host)) ns.scp(script, slot.host, "home");
      const args = kind === "share" ? [`share${nextTag()}`] : [xpTarget, `xp${nextTag()}`];
      const pid = ns.exec(script, slot.host, { threads: n }, ...args);
      if (pid > 0) { slot.free -= n * unit; threads -= n; spawned[kind] += n * unit; ctx.loops[kind].push({ pid, host: slot.host, ramGb: n * unit, args }); }
    }
  }
  return { killed, spawned, reasons };
}

/** Write data/ram-status.txt; returns the record. Updates state.ram.{ema, at}. */
export function writeStatus(ns, cfg, state, ctx, extra, now) {
  const running = {
    money: extra.moneyRunningGb,
    share: ctx.loops.share.reduce((a, p) => a + p.ramGb, 0),
    xp: ctx.loops.xp.reduce((a, p) => a + p.ramGb, 0),
  };
  const inst = ctx.usable > 0 ? Math.min(1, (running.money + running.share + running.xp) / ctx.usable) : 0;
  const prev = state.ram ?? { ema: NaN, at: 0 };
  const e = ema(prev.ema, inst, now - prev.at);
  state.ram = { ema: e, at: now };
  const rec = buildStatus({
    t: now, enabled: extra.enabled, phase: ctx.strat.phase, progress: ctx.strat.progress, weight: ctx.strat.weight,
    repActive: ctx.repActive, hackNeed: ctx.hackNeed, usableGb: ctx.usable,
    alloc: extra.alloc ? { money: extra.alloc.moneyGb, share: extra.alloc.shareGb, xp: extra.alloc.xpGb } : {},
    running, util: { instant: inst, ema5: e },
    activeTargets: Object.entries(state.waves || {}).map(([host, w]) => ({ host, kind: w.kind, batches: w.batches ?? 1, ramGb: w.ramGb })),
    cloud: extra.cloud, sharePower: ns.getSharePower(), reasons: extra.reasons,
  });
  ns.write(STATUS_FILE, JSON.stringify(rec), "w");
  return rec;
}
