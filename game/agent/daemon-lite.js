/** agent/daemon-lite.js — self-bootstrapping money engine + purchase ladder for a fresh BitNode on a tiny home (32GB).
 * Started by agent/post-install.js (and by __checkin if stale) whenever home can't hold agent/autopilot.js.
 * Needs NO manual input and NO Singularity RAM on home:
 *   1. roots everything it can, runs a phase-based hack/grow/weaken loop over home + rooted servers + purchased servers
 *   2. buys a small purchased server ("pserv-sing") that is kept free of workers (and of anything else: foreign scripts
 *      are killed) and used to run one-shot Singularity scripts (agent/sl-*.js): TOR, port programs, home RAM, home
 *      cores, faction backdoors (sl-backdoor.js) and joins/work (sl-work.js). pserv-sing is sized from the sl-* scripts'
 *      actual RAM (Singularity costs 16x/4x/1x RAM at SF4.1/4.2/4.3 outside BN4), first for the small purchase scripts,
 *      then for all of them — Singularity is far too big for 32GB home
 *   3. spends leftover cash on purchased servers (workers), but only while the workers are mostly busy
 *   4. hands over: once home fits agent/autopilot.js it starts it; once home also fits daemon.js it starts
 *      `daemon.js --reset` and exits. Status: /data/daemon-lite-status.txt. Events: /data/events.txt.
 * @param {NS} ns */
const WK = { hack: "workers/hack.js", grow: "workers/grow.js", weaken: "workers/weaken.js" };
const SING = "pserv-sing", AP = "agent/autopilot.js", DAEMON = "daemon.js";
const STATUS = "/data/daemon-lite-status.txt", EV = "/data/events.txt", PORT = 21;
const SL = ["agent/sl-tor.js", "agent/sl-prog.js", "agent/sl-ram.js", "agent/sl-cores.js", "agent/sl-info.js", "agent/sl-work.js", "agent/sl-backdoor.js"];
const SL_FIRST = ["agent/sl-tor.js", "agent/sl-prog.js", "agent/sl-ram.js", "agent/sl-info.js"]; // what the first pserv-sing must fit
const MAXT = 15, BUY_UTIL = 0.6; // max targets, worker utilization needed to buy more worker servers
/** Smallest purchasable server size (power of two, >= 8GB) that fits the largest of `rams`. Exported for tests. */
export function hostRamFor(rams) {
  const need = Math.max(0, ...rams.filter((r) => Number.isFinite(r)));
  let r = 8; while (r < need) r *= 2;
  return r;
}
/** One pass of the purchase ladder. `items` are in priority order: {k, cost, need, blocked}. Saves for the first
 * unaffordable item (goal; hold = goal is within 6x of cash) and still allows later items costing <= 25% of the goal
 * (home RAM is always "needed": a plain stop at it meant nothing after it was ever bought). `picks` = affordable items
 * to try in order (the caller stops at the first success). Exported for tests. */
export function ladderStep(items, money) {
  let goal = 0, hold = false, saving = null;
  const picks = [];
  for (const it of items) {
    if (!it.need || it.blocked) continue;
    if (money < it.cost) { if (!goal) { goal = it.cost; hold = it.cost <= money * 6; saving = it.k; } continue; }
    if (goal && it.cost > goal * 0.25) continue;
    picks.push(it);
  }
  return { picks, goal, hold, saving };
}
/** Cloud-server prices and limit for this BitNode from a dl-buy.js quote ({limit, costs: {ram: price}}); without one,
 * the base game's $55k/GB and 25 servers (the old hard-coded values). Exported for tests. */
export function cloudModel(quote) {
  const ok = quote && quote.ok && Number.isFinite(quote.limit) && quote.costs && typeof quote.costs === "object";
  const costs = ok ? quote.costs : {};
  return {
    limit: ok ? quote.limit : 25,
    costOf: (r) => (Number.isFinite(costs[r]) ? costs[r] : r * 55000),
  };
}
/** Biggest power-of-two worker size (16GB..1PB) whose price fits `budget`, or 0. Exported for tests. */
export function bestWorkerRam(costOf, budget) {
  let best = 0;
  for (let r = 16; r <= 1048576; r *= 2) { if (costOf(r) <= budget) best = r; else break; }
  return best;
}
/** Spend leftover cash on worker servers only when nothing is being saved for, pserv-sing exists, and the workers are
 * busy (idle workers: more RAM wouldn't earn anything). Exported for tests. */
export const workerSpendOk = ({ hold, singHost, money, util, buyUtil = BUY_UTIL }) => !hold && singHost && money > 1e6 && util >= buyUtil;
export const RPC = "agent/rpc.js", RPC_CFG = "agent/rpc-config.txt";
/** Keeps agent/rpc.js alive. Same copy as in agent/autopilot.js (see there); exported for tests. */
export function ensureRpc({ running, hasConfig, run, act, memo }) {
  if (running() || !hasConfig()) return 0;
  const pid = run();
  if (pid) { memo.failed = false; act(`${RPC} was not running: restarted it (pid ${pid})`); }
  else if (!memo.failed) { memo.failed = true; act(`${RPC} is not running and could not be started (RAM on home?)`); }
  return pid;
}
const PROGS = [["BruteSSH.exe", 500e3], ["FTPCrack.exe", 1.5e6], ["relaySMTP.exe", 5e6], ["HTTPWorm.exe", 30e6], ["SQLInject.exe", 250e6]];

export async function main(ns) {
  ns.disableLog("ALL");
  const me = ns.getScriptName();
  if (ns.isRunning(DAEMON, "home") || ns.ps("home").some((p) => p.filename === me && p.pid !== ns.pid)) return;
  const log = (m) => ns.write(EV, `${new Date().toLocaleTimeString("en-US", { hour12: false })} [daemon-lite] ${m}\n`, "a");
  const rpt = Math.max(...Object.values(WK).map((f) => ns.getScriptRam(f, "home")));
  // cloud-server limit and prices for THIS BitNode (dl-buy.js quote, refreshed until one succeeds); dl-buy still
  // verifies every purchase by actually buying
  let srv = cloudModel(null), quoteT = 0;
  const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "b" : n >= 1e6 ? (n / 1e6).toFixed(1) + "m" : (n / 1e3).toFixed(0) + "k");
  const fail = {}; // op -> retry-after ms
  let dbg = {}, info = { ram: Infinity, cores: Infinity }, infoT = 0, workT = 0, work = "", bdPending = null, bdPid = 0, seq = 0, stage = "start", lastErr = "", target = "", apPid = 0;
  log(`started (home ${ns.getServerMaxRam("home")}GB, worker ${rpt}GB/thread)`);

  const net = () => { const seen = new Set(["home"]), q = ["home"]; while (q.length) for (const n of ns.scan(q.shift())) if (!seen.has(n)) { seen.add(n); q.push(n); } return [...seen]; };
  const root = (h) => {
    if (ns.hasRootAccess(h)) return true;
    let o = 0;
    if (ns.fileExists("BruteSSH.exe", "home")) { ns.brutessh(h); o++; }
    if (ns.fileExists("FTPCrack.exe", "home")) { ns.ftpcrack(h); o++; }
    if (ns.fileExists("relaySMTP.exe", "home")) { ns.relaysmtp(h); o++; }
    if (ns.fileExists("HTTPWorm.exe", "home")) { ns.httpworm(h); o++; }
    if (ns.fileExists("SQLInject.exe", "home")) { ns.sqlinject(h); o++; }
    if (o >= ns.getServerNumPortsRequired(h)) { ns.nuke(h); log(`rooted ${h}`); return true; }
    return false;
  };
  const apRam = () => ns.getScriptRam(AP, "home");
  const dRam = () => ns.getScriptRam(DAEMON, "home");
  const homeReserve = () => {
    const mx = ns.getServerMaxRam("home");
    if (!ns.isRunning(AP, "home") && mx >= apRam() + 40) return apRam() + 8; // drain home so autopilot fits
    // no cloud servers (BN9): the sl-* scripts run on home, so keep room for the biggest one
    if (srv.limit === 0 && !ns.isRunning(AP, "home")) return Math.max(mx <= 64 ? 6 : Math.min(128, mx * 0.05), Math.max(...SL.map((f) => ns.getScriptRam(f, "home"))) + 2);
    return mx <= 64 ? 6 : Math.min(128, mx * 0.05);
  };
  const free = (h) => Math.max(0, ns.getServerMaxRam(h) - ns.getServerUsedRam(h) - (h === "home" ? homeReserve() : 0));
  const ensure = (h) => { if (h !== "home" && !ns.fileExists(WK.hack, h)) ns.scp(Object.values(WK), h, "home"); };
  const buy = async (mode, name, ram) => {
    const pid = ns.run("agent/dl-buy.js", 1, mode, name, ram);
    if (!pid) { lastErr = "dl-buy.js: no RAM on home"; return false; }
    for (let i = 0; i < 40 && ns.isRunning(pid); i++) await ns.sleep(250);
    let ok = false; for (let s = ns.readPort(22); s !== "NULL PORT DATA"; s = ns.readPort(22)) { try { ok = JSON.parse(s).ok; } catch { } }
    return ok;
  };
  // port 21 carries every sl-* result. A late one must never answer another call, so results are matched by op;
  // backdoor results (sl-backdoor.js runs without waiting: installBackdoor can take minutes) are handled whenever they arrive.
  const drain = (op) => {
    let r = null;
    for (let s = ns.readPort(PORT); s !== "NULL PORT DATA"; s = ns.readPort(PORT)) {
      let m; try { m = JSON.parse(s); } catch { continue; }
      if (m.op === "backdoor") { for (const h of m.done || []) log(`backdoored ${h}`); bdPending = m.pending || []; }
      else if (op && m.op === op) r = m;
    }
    return r;
  };
  // where the sl-* scripts run: pserv-sing, or home in a BitNode without cloud servers (BN9: limit 0)
  const singHost = () => (ns.serverExists(SING) ? SING : srv.limit === 0 ? "home" : null);
  const singPrep = () => {
    const host = singHost();
    if (host !== SING) return host;
    // pserv-sing is reserved: anything else on it (2026-10-03: telemetry, 29.6GB) blocks the 49.6GB home-RAM script for hours
    for (const p of ns.ps(SING)) if (!SL.includes(p.filename)) { ns.kill(p.pid); log(`killed ${p.filename} on ${SING} (reserved for Singularity)`); }
    ns.scp(SL, SING, "home");
    return SING;
  };
  const sing = async (op, script, ...args) => {
    const host = singPrep();
    if (!host) return null;
    drain(null);
    const pid = ns.exec(script, host, 1, ...args);
    if (!pid) { lastErr = `exec ${script} on ${host} failed (ram?)`; return null; }
    for (let i = 0; i < 60 && ns.isRunning(pid); i++) await ns.sleep(250);
    return drain(op);
  };

  const rpcMemo = { failed: false };
  while (true) {
    try {
      ensureRpc({ running: () => ns.isRunning(RPC, "home"), hasConfig: () => ns.fileExists(RPC_CFG, "home"), run: () => ns.run(RPC), act: log, memo: rpcMemo });
      drain(null);
      if (!srv.quoted && Date.now() - quoteT > 60000) {
        quoteT = Date.now();
        const pid = ns.run("agent/dl-buy.js", 1, "quote");
        for (let i = 0; pid && i < 40 && ns.isRunning(pid); i++) await ns.sleep(250);
        for (let s = ns.readPort(22); s !== "NULL PORT DATA"; s = ns.readPort(22)) { try { const q = JSON.parse(s); if (q.op === "quote" && q.ok) { srv = { ...cloudModel(q), quoted: true }; log(`cloud servers: limit ${q.limit}, 64GB $${fmt(srv.costOf(64))}`); } } catch { } }
      }
      const LIMIT = srv.limit;
      const money = ns.getServerMoneyAvailable("home"), hack = ns.getHackingLevel(), homeMax = ns.getServerMaxRam("home");
      const all = net();
      for (const h of all) if (h !== "home") root(h);
      const rooted = all.filter((h) => ns.hasRootAccess(h));
      const pserv = all.filter((h) => /^pserv/.test(h));
      const wHosts = rooted.concat(["home"].filter(() => true)).filter((h, i, a) => a.indexOf(h) === i && h !== SING && ns.getServerMaxRam(h) >= rpt);

      // ---- handoff -------------------------------------------------------------------------------------------
      const apRunning = ns.isRunning(AP, "home");
      if (!apRunning && homeMax >= apRam() + 32 && ns.getServerMaxRam("home") - ns.getServerUsedRam("home") >= apRam()) {
        apPid = ns.run(AP); if (apPid) log(`home ${homeMax}GB fits autopilot -> started it`);
      }
      if (ns.isRunning(AP, "home") && homeMax >= apRam() + dRam() + 64) {
        const pid = ns.run(DAEMON, 1, "--reset");
        if (pid) { log(`handoff: autopilot running, home ${homeMax}GB -> started daemon.js --reset, daemon-lite exiting`); ns.write(STATUS, JSON.stringify({ t: Date.now(), bootstrap: false, stage: "handoff" }), "w"); return; }
      }

      // ---- purchase ladder (Singularity via pserv-sing) ------------------------------------------------------
      let hold = false;
      if (!apRunning) {
        stage = "ladder";
        const firstRam = hostRamFor(SL_FIRST.map((f) => ns.getScriptRam(f, "home"))), cFirst = srv.costOf(firstRam);
        if (!ns.serverExists(SING) && LIMIT > 0) {
          stage = "need sing host";
          if (money >= cFirst * 1.05 && pserv.length < LIMIT) { if (await buy("buy", SING, firstRam)) { ns.scp(SL, SING, "home"); log(`bought ${SING} (${firstRam}GB) as Singularity host`); } }
          else hold = money * 6 >= cFirst; // saving for it
        } else {
          if (Date.now() - infoT > 60000) { const r = await sing("info", "agent/sl-info.js"); if (r && r.op === "info") { info = r; infoT = Date.now(); } else infoT = Date.now() - 45000; }
          const singRam = hostRamFor(SL.map((f) => ns.getScriptRam(f, "home")));
          const LADDER = [
            ["tor", 200e3, !ns.hasTorRouter(), ["agent/sl-tor.js"]],
            ...PROGS.slice(0, 2).map(([p, c]) => [p, c, !ns.fileExists(p, "home"), ["agent/sl-prog.js", p]]),
            ["singRam", srv.costOf(singRam), ns.serverExists(SING) && ns.getServerMaxRam(SING) < singRam, null],
            ["homeRam", info.ram, Number.isFinite(info.ram), ["agent/sl-ram.js"]],
            ...PROGS.slice(2).map(([p, c]) => [p, c, !ns.fileExists(p, "home"), ["agent/sl-prog.js", p]]),
            ["homeCores", info.cores, Number.isFinite(info.cores), ["agent/sl-cores.js"]],
          ].map(([k, cost, need, run]) => ({ k, cost, need, run,
            blocked: (k !== "tor" && PROGS.some(([p]) => p === k) && !ns.hasTorRouter()) || (fail[k] || 0) > Date.now() }));
          const step = ladderStep(LADDER, money);
          hold = step.hold;
          if (step.saving) stage = `saving for ${step.saving} ($${fmt(step.goal)})`;
          for (const { k, cost, run } of step.picks) {
            const r = run ? await sing(k, ...run) : { ok: await buy("up", SING, singRam) };
            if (r && r.ok) { log(`bought ${k} ($${fmt(cost)})`); infoT = 0; break; }
            fail[k] = Date.now() + 60000; lastErr = `${k} purchase failed`;
          }
          // faction work: autopilot normally does this; without it the player sat idle for the whole BN5 bootstrap
          if (Date.now() - workT > 300000 && singHost() && ns.getServerMaxRam(singHost()) >= ns.getScriptRam("agent/sl-work.js", "home")) {
            workT = Date.now();
            // backdoors (NiteSec/Black Hand/BitRunners invites need them): fire and forget, one copy at a time; drain() records it
            if ((bdPending === null || bdPending.length) && !(bdPid && ns.isRunning(bdPid)) && singPrep()) bdPid = ns.exec("agent/sl-backdoor.js", singHost(), 1);
            let c = {}; try { c = JSON.parse(ns.read("/data/autopilot-config.txt") || "{}"); } catch { }
            const r = await sing("work", "agent/sl-work.js", JSON.stringify({ prio: c.factionPriority || [], joinCity: c.joinCity || [], skipHacknet: !!c.skipHacknetAugs }));
            if (r && r.op === "work") { if (r.work !== work) log(`work: ${r.work}`); work = r.work; for (const f of r.joined || []) log(`joined ${f}`); }
          }
        }
      }

      // ---- money engine: rank targets, fill them in order until the threads run out --------------------------
      // score = max money / weaken time at min security (weaken time scales with 2.5*req*sec+500), so an unprepped
      // server isn't ranked by its current, inflated time. One target left ~200TB of purchased servers idle.
      const tAtMin = (h) => { const r = ns.getServerRequiredHackingLevel(h), sec = ns.getServerSecurityLevel(h), mn = ns.getServerMinSecurityLevel(h); return ns.getWeakenTime(h) * (2.5 * r * mn + 500) / (2.5 * r * sec + 500); };
      const cands = rooted.filter((h) => h !== "home" && ns.getServerMaxMoney(h) > 0 && ns.getServerRequiredHackingLevel(h) <= Math.max(1, hack / (hack > 150 ? 2 : 1)));
      const ranked = cands.map((h) => [h, ns.getServerMaxMoney(h) / tAtMin(h)]).sort((x, y) => y[1] - x[1]).slice(0, MAXT).map((x) => x[0]);
      target = ranked[0] || "";
      const infl = {}; let busy = 0;
      for (const h of all) for (const p of ns.ps(h)) {
        const k = p.filename === WK.hack ? "hack" : p.filename === WK.grow ? "grow" : p.filename === WK.weaken ? "weaken" : null;
        if (!k) continue;
        const T = String(p.args[0]), i = (infl[T] ||= { hack: 0, grow: 0, weaken: 0, exp: 0 });
        if (p.args[2] === "x") i.exp += p.threads; else i[k] += p.threads;
        busy += p.threads;
      }
      let cap = 0; for (const h of wHosts) cap += Math.floor(free(h) / rpt);
      const all0 = cap + busy; dbg = { cap, busy, targets: [] };
      const launch = (T, kind, n, tag) => {
        let left = n;
        for (const h of [...wHosts].sort((a, b) => free(b) - free(a))) {
          if (left <= 0) break;
          const t = Math.min(left, Math.floor(free(h) / rpt)); if (t < 1) continue;
          ensure(h); if (ns.exec(WK[kind], h, t, T, 0, tag || `l${++seq}`)) left -= t;
        }
        cap -= n - left;
        return n - left;
      };
      for (const T of ranked) {
        if (cap < 1) break;
        const sec = ns.getServerSecurityLevel(T), min = ns.getServerMinSecurityLevel(T), mon = Math.max(1, ns.getServerMoneyAvailable(T)), mx = ns.getServerMaxMoney(T);
        const inf = infl[T] || { hack: 0, grow: 0, weaken: 0, exp: 0 };
        const total = cap + inf.hack + inf.grow + inf.weaken, starved = all0 < 200;
        let G = 0, H = 0;
        // with threads to spare, grow while weakening (weaken covers the grow's security); starved: weaken first
        if (mon < mx * 0.9 && (sec <= min + 5 || !starved)) {
          G = Math.ceil(ns.growthAnalyze(T, Math.min(1000, mx / mon)));
          // starved bootstrap (few threads): grow-to-90% alone never pays; hack a little once there is >=5% of max to steal
          if (starved && mon >= mx * 0.05 && sec <= min + 2) { const hf = ns.hackAnalyze(T); H = hf > 0 ? Math.max(1, Math.min(Math.ceil(0.4 / hf), Math.ceil(total / 2))) : 0; }
        } else if (mon >= mx * 0.9 && sec <= min + 2) { const hf = ns.hackAnalyze(T); H = hf > 0 ? Math.max(1, Math.ceil(0.4 / hf)) : 0; G = Math.ceil(ns.growthAnalyze(T, 1.7)); }
        const scale = Math.min(1, total / Math.max(1, G + H + Math.ceil((sec - min) / 0.05) + 1)); G = Math.ceil(G * scale); H = starved && H > 0 ? Math.max(1, Math.floor(H * scale)) : Math.floor(H * scale);
        let Wd = Math.ceil((sec - min) / 0.05) + Math.ceil(G * 0.08 + H * 0.04);
        if (starved) { Wd = Math.min(Wd, Math.max(1, Math.floor(total / 3))); G = Math.min(G, Math.max(0, total - Wd - H)); } // starved: split the few threads instead of letting weaken eat them all
        launch(T, "weaken", Wd - inf.weaken); if (starved) launch(T, "hack", H - inf.hack); launch(T, "grow", G - inf.grow); if (!starved) launch(T, "hack", H - inf.hack);
        dbg.targets.push({ T, G, H, Wd, sec: +sec.toFixed(2), m: +(mon / mx).toFixed(2) });
      }
      if (target) {
        // spare capacity -> weaken the top target for hacking XP, capped at 25% of all threads
        const spare = Math.min(cap, Math.floor(all0 * 0.25) - Object.values(infl).reduce((n, i) => n + i.exp, 0));
        if (spare >= 1) launch(target, "weaken", spare, "x");
        stage = hold ? stage : (stage === "ladder" || stage === "start" ? "farming" : stage);
      }
      const util = all0 ? 1 - cap / all0 : 1;

      // ---- spend leftover on worker servers ------------------------------------------------------------------
      if (workerSpendOk({ hold, singHost: ns.serverExists(SING), money, util })) {
        const ws = pserv.filter((h) => h !== SING), lim = LIMIT - 1;
        const r = bestWorkerRam(srv.costOf, money * 0.5);
        if (r) {
          if (ws.length < lim) { let i = 0; while (ns.serverExists(`pserv-${i}`)) i++; if (await buy("buy", `pserv-${i}`, r)) { ensure(`pserv-${i}`); log(`bought pserv-${i} ${r}GB`); } }
          else { const s = ws.sort((a, b) => ns.getServerMaxRam(a) - ns.getServerMaxRam(b))[0]; if (s && ns.getServerMaxRam(s) * 2 <= r && await buy("up", s, r)) log(`upgraded ${s} -> ${r}GB`); }
        }
      }

      ns.write(STATUS, JSON.stringify({ t: Date.now(), bootstrap: true, stage, money, hack, target, homeMax, singHost: ns.serverExists(SING), pservers: pserv.length, cap, util: +util.toFixed(2), work, dbg, err: lastErr }), "w");
    } catch (e) {
      lastErr = String(e).slice(0, 200); log(`error: ${lastErr}`);
      ns.write(STATUS, JSON.stringify({ t: Date.now(), bootstrap: true, stage: "error", err: lastErr }), "w");
      await ns.sleep(10000);
    }
    await ns.sleep(5000);
  }
}

