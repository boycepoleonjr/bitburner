/**
 * daemon.js — continuous hacking orchestrator.
 *
 * Every loop:  scan → root → classify → score → decide → reconcile → plan/launch waves → log/state
 * RAM manager (settings ram.*, strategy.*; docs/specs/ram-manager.md): when ram.manager.enabled, the active target set
 * grows while RAM allows, share/xp loops fill the rest by strategy weight, cloud servers are bought (lib/cloud.js), and
 * data/ram-status.txt is written each loop. ram.manager.enabled=false runs the pre-manager path unchanged.
 *
 * Usage:
 *   run daemon.js            start (resumes persisted state)
 *   run daemon.js --reset    forget persisted state first
 *   run daemon.js --once     single loop, then exit (debugging)
 *   tail daemon.js           live log;  run tools/status.js  for a summary
 */
import { loadConfig, managedConfig } from "lib/config.js";
import { readSettings } from "lib/settings.js";
import { observe, plan as ramPlan, shrinkLoops, killAllLoops, resizeLoops, writeStatus, AUTOPILOT_STATUS } from "lib/rammgr.js";
import { cloudTick } from "lib/cloud.js";
import { makeLogger, money, dur, stamp } from "lib/log.js";
import { scanNetwork, classify, byRole, describe } from "lib/network.js";
import { ownedOpeners, rootEligibility, tryRoot } from "lib/rooting.js";
import { rankTargets, decide, pickSecondaries, prepStatus } from "lib/targets.js";
import { buildPool, poolCapacity, place, census, killWorkers, syncWorkers } from "lib/deploy.js";
import { planWave } from "lib/planner.js";
import { loadState, saveState, freshState } from "lib/state.js";
import { purchasedServersHook, hacknetHook, milestonesHook, stocksHook } from "lib/hooks.js";
import { formulasCtx } from "lib/formulas.js";
import { programsHook } from "lib/programs.js";

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const flags = ns.flags([["reset", false], ["once", false]]);
  // single-instance guard: `kill daemon.js` misses instances started with args, so clean up here
  for (const p of ns.ps("home")) {
    if (p.filename === ns.getScriptName() && p.pid !== ns.pid) ns.kill(p.pid);
  }
  let { cfg } = loadConfig(ns);
  const state = flags.reset ? freshState() : loadState(ns, cfg.files.state);
  state.startedAt = Date.now();
  let workersSynced = false;
  let waveSeq = 0;

  let log = makeLogger(ns, cfg);
  log.event("daemon", `started (primary=${state.primary ?? "none"}, reset=${flags.reset})`);

  while (true) {
    const loaded = loadConfig(ns);
    cfg = loaded.cfg;
    log = makeLogger(ns, cfg);
    if (loaded.overrideError) log.warn("config", `overrides ignored: ${loaded.overrideError}`);
    try {
      tick(ns, cfg, state, log, () => ++waveSeq, !workersSynced);
      workersSynced = true;
    } catch (e) {
      log.error("loop", `tick failed: ${e?.stack ?? e}`);
    }
    saveState(ns, cfg.files.state, state);
    if (flags.once) break;
    await ns.sleep(cfg.loopMs);
  }
}

/**
 * One control-loop iteration.
 * @param {NS} ns
 * @param {import("lib/config.js").Config} cfg
 * @param {import("lib/state.js").DaemonState} state
 */
export function tick(ns, cfg, state, log, nextWaveId, firstLoop) {
  const now = Date.now();
  const S = readSettings(ns);
  const mgr = S["ram.manager.enabled"] === true;
  cfg = managedConfig(cfg, S); // unchanged when the manager is off
  state.loops++;
  state.lastLoopAt = now;
  const hackLevel = ns.getHackingLevel();
  state.hackLevel = hackLevel;

  // ── 1. discovery ──────────────────────────────────────────────────────
  const map = scanNetwork(ns);
  state.serverCount = map.size;

  // ── 2. rooting ────────────────────────────────────────────────────────
  const openers = ownedOpeners(ns);
  if (openers.length !== state.openerCount) {
    if (state.loops > 1) log.event("root", `port openers: ${state.openerCount} → ${openers.length} (${openers.join(", ") || "none"})`);
    state.openerCount = openers.length;
    state.openers = openers;
  }
  for (const s of map.values()) {
    if (s.rooted) continue;
    const el = rootEligibility(s, openers, hackLevel, cfg);
    if (!el.eligible) continue;
    const r = tryRoot(ns, s, openers);
    if (r.rooted) {
      map.set(s.host, describe(ns, s.host, s.parent, s.path));
      log.event("root", `rooted ${s.host} (ports ${s.portsReq}, used ${r.used.join("+") || "NUKE only"}, ${s.maxRam}GB RAM, max ${money(ns, s.maxMoney)})`);
    } else {
      log.warn("root", `failed ${s.host}: ${r.error ?? "unknown"}`);
    }
  }

  const fx = !!formulasCtx(ns, cfg);
  if (fx !== state.formulas) {
    log.event("formulas", fx ? "Formulas.exe active — exact chance/time scoring and grow/hack thread math" : "Formulas.exe not in use — using estimates");
    state.formulas = fx;
  }

  // ── 3. classification ────────────────────────────────────────────────
  for (const s of map.values()) classify(s, hackLevel, cfg);
  const executors = byRole(map, "executor");
  const targets = byRole(map, "target");
  const rootedNow = [...map.values()].filter((s) => s.rooted && !s.isHome).map((s) => s.host);
  const newlyTargetable = targets.filter((t) => !state.knownTargets.includes(t.host) && state.loops > 1);
  for (const t of newlyTargetable) log.event("eligible", `${t.host} is now a hack target (req ${t.reqHack}, max ${money(ns, t.maxMoney)})`);
  state.knownTargets = targets.map((t) => t.host);
  state.rootedCount = rootedNow.length;
  state.executorCount = executors.length;

  if (firstLoop) log.info("deploy", `synced workers to ${syncWorkers(ns, executors, cfg)} hosts`);

  // ── 4. scoring ────────────────────────────────────────────────────────
  const ranking = rankTargets(ns, targets, hackLevel, cfg);
  state.top = ranking.slice(0, 8).map((c) => ({ host: c.host, score: c.score, steady: c.steadyScore, status: c.status, why: c.why }));
  if (!ranking.length) {
    state.lastDecision = "no viable targets";
    log.warn("target", "no viable targets yet");
    return;
  }

  // ── 5. switch decision ───────────────────────────────────────────────
  const d = decide(ranking, state, now, cfg);
  state.challenger = d.challenger;
  state.lastDecision = d.reason;
  const allHosts = [...map.keys()].filter((h) => map.get(h).rooted);
  if (d.action === "init" || d.action === "switch") {
    const old = state.primary;
    if (old && cfg.switching.killOldOnSwitch) {
      const k = killWorkers(ns, allHosts, cfg, (t) => t === old);
      log.event("switch", `killed ${k} workers on old primary ${old}`);
    }
    state.previousPrimary = old;
    state.primary = d.target;
    state.lastSwitchAt = now;
    state.lastSwitchReason = d.reason;
    state.switchCount++;
    log.event("switch", `${old ?? "∅"} → ${d.target}: ${d.reason}`);
  } else {
    log.debug("target", `keep ${state.primary}: ${d.reason}`);
  }

  // ── 6. active set + reconcile (kill workers on targets we dropped) ───
  let ctx = null;
  try { ctx = observe(ns, cfg, S, executors, map, hackLevel, now); } catch (e) { log.warn("ram", `observe failed, manager skipped this loop: ${e}`); }
  const mgrOn = mgr && !!ctx;
  if (!mgr && ctx && (ctx.loops.share.length || ctx.loops.xp.length)) log.event("ram", `manager off: killed ${killAllLoops(ns, ctx)} share/xp loops`);
  let secondaries = pickSecondaries(ranking, state.primary, state.secondaries, cfg);
  let rplan = null;
  if (mgrOn) {
    const ramW = { hack: ns.getScriptRam(cfg.workers.hack, "home"), grow: ns.getScriptRam(cfg.workers.grow, "home"), weaken: ns.getScriptRam(cfg.workers.weaken, "home") };
    rplan = ramPlan(ns, cfg, S, ctx, ranking, state.primary, secondaries, ramW);
    secondaries = rplan.secondaries;
  }
  if (secondaries.join() !== state.secondaries.join()) log.info("target", `secondaries: ${secondaries.join(", ") || "none"}`);
  state.secondaries = secondaries;
  const active = [state.primary, ...secondaries];
  const xpTarget = cfg.xp.enabled && !active.includes(cfg.xp.target) && map.get(cfg.xp.target)?.rooted ? cfg.xp.target : null;
  const stray = killWorkers(ns, allHosts, cfg, (t) => !active.includes(t) && t !== xpTarget);
  if (stray) log.event("deploy", `reconciled: killed ${stray} workers on inactive targets`);

  const load = census(ns, allHosts, cfg);

  // prep-state change events (only for idle targets — mid-wave states are transient)
  for (const host of active) {
    if (load.get(host)?.procs) continue;
    const st = prepStatus(map.get(host), cfg);
    if (state.prep[host] !== st) {
      if (state.prep[host]) log.event("prep", `${host}: ${state.prep[host]} → ${st}`);
      state.prep[host] = st;
    }
  }
  for (const h of Object.keys(state.prep)) if (!active.includes(h)) delete state.prep[h];

  // ── 7. allocation: one wave per idle target, primary first ───────────
  const pool = buildPool(ns, executors, cfg);
  if (mgrOn) { // money first: loops above their share never block the hacking waves the allocation promised
    const runningMoney = [...load.values()].reduce((a, t) => a + t.ramGb, 0);
    const short = rplan.alloc.moneyGb - runningMoney - pool.reduce((a, p) => a + p.free, 0);
    if (short >= Math.max(8, 0.001 * ctx.usable)) {
      const freed = shrinkLoops(ns, ctx, short);
      if (freed > 0) { pool.splice(0, pool.length, ...buildPool(ns, executors, cfg)); log.info("ram", `freed ${freed.toFixed(0)}GB of xp/share loops for hacking waves`); }
    }
  }
  const ram = {
    hack: ns.getScriptRam(cfg.workers.hack, "home"),
    grow: ns.getScriptRam(cfg.workers.grow, "home"),
    weaken: ns.getScriptRam(cfg.workers.weaken, "home"),
  };
  const unit = Math.max(ram.hack, ram.grow, ram.weaken);
  state.totalRamGb = executors.reduce((a, s) => a + s.maxRam - (s.isHome ? cfg.homeReserveGb : 0), 0);

  // Keep headroom (one full batch) so secondaries can't starve the primary's next wave.
  const primaryInfo = describe(ns, state.primary);
  const primaryIdeal = planWave(ns, primaryInfo, cfg, Infinity, ram, cfg.farm.hackFraction, 1);
  const primaryLoad = load.get(state.primary);
  const reachable = Math.min(primaryIdeal?.ramGb ?? 0, state.totalRamGb); // an ideal wave bigger than the network can't be reserved
  const headroom = Math.max(0, reachable - (primaryLoad?.ramGb ?? 0));

  let skipLoopSpawn = false;
  for (const host of active) {
    const isPrimary = host === state.primary;
    const busy = load.get(host);
    if (busy && busy.procs > 0) {
      if (isPrimary) state.mode = state.waves[host]?.kind ?? "busy";
      continue;
    }
    // Preemption: an idle primary that can't get a meaningful wave reclaims RAM from secondaries.
    if (isPrimary && primaryIdeal && cfg.secondary.preemptBelow > 0) {
      const cap = poolCapacity(pool, unit);
      if (cap < primaryIdeal.ramGb * cfg.secondary.preemptBelow) {
        if (mgrOn) { // RAM manager: shrink xp, then share loops before touching any hacking worker
          const freed = shrinkLoops(ns, ctx, primaryIdeal.ramGb - cap);
          if (freed > 0) {
            log.event("ram", `freed ${freed.toFixed(0)}GB of xp/share loops for primary ${host}`);
            state.mode = "preempting"; skipLoopSpawn = true;
            break;
          }
        }
        const k = killWorkers(ns, allHosts, cfg, (t) => t !== host && (secondaries.includes(t) || t === xpTarget));
        if (k > 0) {
          log.event("deploy", `preempted ${k} secondary workers: primary wants ${primaryIdeal.ramGb.toFixed(0)}GB, only ${cap.toFixed(0)}GB free`);
          state.mode = "preempting";
          break; // re-plan next loop with the freed RAM
        }
      }
    }
    const s = describe(ns, host);
    const budget = poolCapacity(pool, unit) - (isPrimary ? 0 : headroom);
    const plan = planWave(ns, s, cfg, budget, ram);
    if (!plan) {
      log.debug("deploy", `${host}: no wave (budget ${budget.toFixed(0)}GB)`);
      if (isPrimary) state.mode = "starved";
      continue;
    }
    const tag = `${nextWaveId()}`;
    let placed = 0, hosts = 0;
    for (let i = 0; i < plan.jobs.length; i++) {
      const j = plan.jobs[i];
      const args = [host, j.delay, `${tag}.${i}`];
      if (j.op === "hack") args.push(cfg.incomePort);
      const r = place(ns, pool, cfg.workers[j.op], j.threads, args, ram[j.op], j.op);
      placed += r.placed;
      hosts += r.hosts;
      if (r.placed < j.threads) log.warn("deploy", `${host} wave ${tag}: ${j.op} placed ${r.placed}/${j.threads}`);
    }
    state.waves[host] = { kind: plan.kind, batches: plan.batches ?? 1, launchedAt: now, endsAt: now + plan.durationMs, ramGb: plan.ramGb, note: plan.note };
    state.wavesLaunched++;
    if (isPrimary) state.mode = plan.kind;
    log.info("wave", `${isPrimary ? "PRIMARY" : "second "} ${host} ${plan.kind} ${plan.note} | ${placed} threads on ${hosts} hosts, ${plan.ramGb.toFixed(0)}GB, lands in ${dur(ns, plan.durationMs)}`);
  }
  for (const h of Object.keys(state.waves)) if (!active.includes(h)) delete state.waves[h];

  // ── 7b. XP mode: leftover RAM weakens the XP target for hacking exp ────
  state.xp = { target: xpTarget, threads: load.get(xpTarget)?.threads.weaken ?? 0 };
  if (xpTarget && !(load.get(xpTarget)?.procs > 0)) {
    const threads = Math.floor((poolCapacity(pool, unit) * cfg.xp.leftoverFraction) / ram.weaken);
    if (threads >= cfg.xp.minThreads) {
      const r = place(ns, pool, cfg.workers.weaken, threads, [xpTarget, 0, `xp${nextWaveId()}`], ram.weaken, "weaken");
      state.xp.threads = r.placed;
      log.debug("xp", `weaken ${xpTarget} × ${r.placed} threads on ${r.hosts} hosts`);
    }
  }
  // ── 7c. RAM manager: size persistent share/xp loops into what is left ──
  let ramReasons = [];
  if (mgrOn) {
    const r = resizeLoops(ns, ctx, rplan.alloc, pool, S, { allowSpawn: !skipLoopSpawn, xpRooted: !!map.get(S["ram.xp.target"])?.rooted, nextTag: () => `${nextWaveId()}` });
    ramReasons = r.reasons;
    if (r.killed || r.spawned.share || r.spawned.xp) log.info("ram", `loops: killed ${r.killed}, +share ${r.spawned.share.toFixed(0)}GB, +xp ${r.spawned.xp.toFixed(0)}GB`);
  }
  state.freeRamGb = pool.reduce((a, p) => a + p.free, 0);

  // ── 8. income tracking ───────────────────────────────────────────────
  // authoritative totals from the game; the port gives an approximate per-target split
  const src = ns.getMoneySources();
  state.income.hackingSinceInstall = src.sinceInstall.hacking ?? 0;
  state.income.stockSinceInstall = src.sinceInstall.stock ?? 0;
  state.income.hacknetSinceInstall = src.sinceInstall.hacknet ?? 0;
  if (cfg.incomePort > 0) {
    for (let i = 0; i < 10_000; i++) {
      const msg = ns.readPort(cfg.incomePort);
      if (msg === "NULL PORT DATA") break;
      const [t, m] = String(msg).split("|");
      const v = Number(m) || 0;
      state.income.total += v;
      state.income.byTarget[t] = (state.income.byTarget[t] ?? 0) + v;
    }
  }

  // ── 9. hooks (phase 2) ───────────────────────────────────────────────
  let cloudInfo = null;
  try { // manager on: buy/upgrade (hooks.purchasedServers is off); off: observe only
    cloudInfo = cloudTick(ns, mgrOn ? S : { ...S, "ram.cloud.enabled": false }, { autopilotRaw: mgrOn ? ns.read(AUTOPILOT_STATUS) : "", now, log });
  } catch (e) { log.warn("hook", `cloud: ${e}`); }
  for (const [name, fn] of [["programs", programsHook], ["pserv", purchasedServersHook], ["hacknet", hacknetHook], ["stocks", stocksHook], ["milestones", milestonesHook]]) {
    try { fn(ns, cfg, state, log, map, hackLevel); } catch (e) { log.warn("hook", `${name}: ${e}`); }
  }

  // ── 9b. RAM status (data/ram-status.txt, read by the dashboard and agents) ──
  if (ctx) {
    try {
      const moneyRunningGb = [...census(ns, allHosts, cfg).values()].reduce((a, t) => a + t.ramGb, 0);
      const reasons = mgrOn ? [...rplan.alloc.reasons, ...ramReasons, ...(cloudInfo?.reasons ?? []), `work signal: ${ctx.workSource}`, ctx.hackNeedWhy, `daedalus reqs: ${ctx.reqSource}`]
        : ["RAM manager disabled (ram.manager.enabled=false)"];
      writeStatus(ns, cfg, state, ctx, { enabled: mgrOn, alloc: rplan?.alloc, moneyRunningGb, cloud: cloudInfo, reasons }, now);
    } catch (e) { log.warn("ram", `status: ${e}`); }
  }

  // ── 10. periodic status ──────────────────────────────────────────────
  if (state.loops % cfg.log.statusEveryLoops === 1) printStatus(ns, state);
}

/** @param {NS} ns */
function printStatus(ns, st) {
  const mins = Math.max(1 / 60, (Date.now() - st.income.since) / 60_000);
  ns.print(`──── ${stamp()} status (loop ${st.loops}) ────`);
  ns.print(`hack ${st.hackLevel} | rooted ${st.rootedCount}/${st.serverCount - 1} | openers ${st.openerCount} | executors ${st.executorCount}`);
  ns.print(`RAM free ${st.freeRamGb.toFixed(0)} / ${st.totalRamGb.toFixed(0)} GB | income ${money(ns, st.income.total)} (${money(ns, st.income.total / mins)}/min)`);
  ns.print(`PRIMARY ${st.primary} [${st.mode}] | 2nd: ${st.secondaries.join(", ") || "-"}`);
  ns.print(`decision: ${st.lastDecision}`);
  st.top.slice(0, 5).forEach((c, i) => ns.print(`  #${i + 1} ${c.host.padEnd(18)} ${ns.format.number(c.score, 2).padStart(9)} ${c.status.padEnd(10)} ${c.why}`));
}
