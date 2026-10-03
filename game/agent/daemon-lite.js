/** agent/daemon-lite.js — self-bootstrapping money engine + purchase ladder for a fresh BitNode on a tiny home (32GB).
 * Started by agent/post-install.js (and by __checkin if stale) whenever home can't hold agent/autopilot.js.
 * Needs NO manual input and NO Singularity RAM on home:
 *   1. roots everything it can, runs a phase-based hack/grow/weaken loop over home + rooted servers + purchased servers
 *   2. buys a small purchased server ("pserv-sing") that is kept free of workers and used to run one-shot Singularity
 *      scripts (agent/sl-*.js): TOR, port programs, home RAM, home cores — Singularity is far too big for 32GB home
 *   3. spends leftover cash on purchased servers (workers)
 *   4. hands over: once home fits agent/autopilot.js it starts it; once home also fits daemon.js it starts
 *      `daemon.js --reset` and exits. Status: /data/daemon-lite-status.txt. Events: /data/events.txt.
 * @param {NS} ns */
const WK = { hack: "workers/hack.js", grow: "workers/grow.js", weaken: "workers/weaken.js" };
const SING = "pserv-sing", AP = "agent/autopilot.js", DAEMON = "daemon.js";
const STATUS = "/data/daemon-lite-status.txt", EV = "/data/events.txt", PORT = 21;
const SL = ["agent/sl-tor.js", "agent/sl-prog.js", "agent/sl-ram.js", "agent/sl-cores.js", "agent/sl-info.js"];
const PROGS = [["BruteSSH.exe", 500e3], ["FTPCrack.exe", 1.5e6], ["relaySMTP.exe", 5e6], ["HTTPWorm.exe", 30e6], ["SQLInject.exe", 250e6]];

export async function main(ns) {
  ns.disableLog("ALL");
  const me = ns.getScriptName();
  if (ns.isRunning(DAEMON, "home") || ns.ps("home").some((p) => p.filename === me && p.pid !== ns.pid)) return;
  const log = (m) => ns.write(EV, `${new Date().toLocaleTimeString("en-US", { hour12: false })} [daemon-lite] ${m}\n`, "a");
  const rpt = Math.max(...Object.values(WK).map((f) => ns.getScriptRam(f, "home")));
  const GB = 55000, LIMIT = 25; // purchased-server price per GB / count limit (dl-buy.js verifies by actually buying)
  const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "b" : n >= 1e6 ? (n / 1e6).toFixed(1) + "m" : (n / 1e3).toFixed(0) + "k");
  const fail = {}; // op -> retry-after ms
  let dbg = {}, info = { ram: Infinity, cores: Infinity }, infoT = 0, seq = 0, stage = "start", lastErr = "", target = "", apPid = 0;
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
  const sing = async (script, ...args) => {
    if (!ns.serverExists(SING)) return null;
    ns.scp(SL, SING, "home");
    const pid = ns.exec(script, SING, 1, ...args);
    if (!pid) { lastErr = `exec ${script} on ${SING} failed (ram?)`; return null; }
    for (let i = 0; i < 60 && ns.isRunning(pid); i++) await ns.sleep(250);
    let r = null; for (let s = ns.readPort(PORT); s !== "NULL PORT DATA"; s = ns.readPort(PORT)) { try { r = JSON.parse(s); } catch { } }
    return r;
  };

  while (true) {
    try {
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
        const c64 = 64 * GB;
        if (!ns.serverExists(SING)) {
          stage = "need sing host";
          if (money >= c64 * 1.05 && pserv.length < LIMIT) { if (await buy("buy", SING, 64)) { ns.scp(SL, SING, "home"); log(`bought ${SING} (64GB) as Singularity host`); } }
          else hold = money * 6 >= c64; // saving for it
        } else {
          if (Date.now() - infoT > 60000) { const r = await sing("agent/sl-info.js"); if (r && r.op === "info") { info = r; infoT = Date.now(); } else infoT = Date.now() - 45000; }
          const LADDER = [
            ["tor", 200e3, !ns.hasTorRouter(), ["agent/sl-tor.js"]],
            ...PROGS.slice(0, 2).map(([p, c]) => [p, c, !ns.fileExists(p, "home"), ["agent/sl-prog.js", p]]),
            ["homeRam", info.ram, Number.isFinite(info.ram), ["agent/sl-ram.js"]],
            ...PROGS.slice(2).map(([p, c]) => [p, c, !ns.fileExists(p, "home"), ["agent/sl-prog.js", p]]),
            ["homeCores", info.cores, Number.isFinite(info.cores), ["agent/sl-cores.js"]],
          ];
          for (const [k, cost, need, run] of LADDER) {
            if (!need) continue;
            if (k !== "tor" && PROGS.some(([p]) => p === k) && !ns.hasTorRouter()) continue;
            if ((fail[k] || 0) > Date.now()) continue;
            if (money < cost) { hold = cost <= money * 6; stage = `saving for ${k} ($${fmt(cost)})`; break; }
            const r = await sing(...run);
            if (r && r.ok) { log(`bought ${k} ($${fmt(cost)})`); infoT = 0; break; }
            fail[k] = Date.now() + 60000; lastErr = `${k} purchase failed`;
          }
        }
      }

      // ---- money engine --------------------------------------------------------------------------------------
      const cands = rooted.filter((h) => h !== "home" && ns.getServerMaxMoney(h) > 0 && ns.getServerRequiredHackingLevel(h) <= Math.max(1, hack / (hack > 150 ? 2 : 1)));
      let best = null, bs = -1;
      for (const h of cands) { const s = ns.getServerMaxMoney(h) / ns.getWeakenTime(h); if (s > bs) { bs = s; best = h; } }
      if (best) target = best;
      let cap = 0; for (const h of wHosts) cap += Math.floor(free(h) / rpt);
      if (target) {
        const T = target, sec = ns.getServerSecurityLevel(T), min = ns.getServerMinSecurityLevel(T), mon = Math.max(1, ns.getServerMoneyAvailable(T)), mx = ns.getServerMaxMoney(T);
        const inf = { hack: 0, grow: 0, weaken: 0, exp: 0 };
        for (const h of all) for (const p of ns.ps(h)) {
          const k = p.filename === WK.hack ? "hack" : p.filename === WK.grow ? "grow" : p.filename === WK.weaken ? "weaken" : null;
          if (k && String(p.args[0]) === T) { if (p.args[2] === "x") inf.exp += p.threads; else inf[k] += p.threads; }
        }
        const total = cap + inf.hack + inf.grow + inf.weaken;
        let G = 0, H = 0;
        if (sec <= min + 5) {
          if (mon < mx * 0.9) {
            G = Math.ceil(ns.growthAnalyze(T, Math.min(1000, mx / mon)));
            // starved bootstrap (few threads): grow-to-90% alone never pays; hack a little once there is >=5% of max to steal
            if (total < 200 && mon >= mx * 0.05 && sec <= min + 2) { const hf = ns.hackAnalyze(T); H = hf > 0 ? Math.max(1, Math.min(Math.ceil(0.4 / hf), Math.ceil(total / 2))) : 0; }
          } else if (sec <= min + 2) { const hf = ns.hackAnalyze(T); H = hf > 0 ? Math.max(1, Math.ceil(0.4 / hf)) : 0; G = Math.ceil(ns.growthAnalyze(T, 1.7)); }
        }
        const scale = Math.min(1, total / Math.max(1, G + H + Math.ceil((sec - min) / 0.05) + 1)); G = Math.ceil(G * scale); H = total < 200 && H > 0 ? Math.max(1, Math.floor(H * scale)) : Math.floor(H * scale);
        let Wd = Math.ceil((sec - min) / 0.05) + Math.ceil(G * 0.08 + H * 0.04);
        if (total < 200) { Wd = Math.min(Wd, Math.max(1, Math.floor(total / 3))); G = Math.min(G, Math.max(0, total - Wd - H)); } // starved: split the few threads instead of letting weaken eat them all
        const launch = (kind, n, tag) => {
          let left = n;
          for (const h of [...wHosts].sort((a, b) => free(b) - free(a))) {
            if (left <= 0) break;
            const t = Math.min(left, Math.floor(free(h) / rpt)); if (t < 1) continue;
            ensure(h); if (ns.exec(WK[kind], h, t, T, 0, tag || `l${++seq}`)) left -= t;
          }
          return n - left;
        };
        dbg = { total, G, H, Wd, sec, mon, mx };
        launch("weaken", Wd - inf.weaken); if (total < 200) launch("hack", H - inf.hack); launch("grow", G - inf.grow); if (total >= 200) launch("hack", H - inf.hack);
        // spare capacity -> weaken for hacking XP, capped at 25% of total threads
        const spare = Math.min(cap - Math.max(0, Wd - inf.weaken) - Math.max(0, G - inf.grow) - Math.max(0, H - inf.hack), Math.floor(total * 0.25) - inf.exp);
        if (spare >= 1) launch("weaken", spare, "x");
        stage = hold ? stage : (stage === "ladder" || stage === "start" ? "farming" : stage);
      }

      // ---- spend leftover on worker servers ------------------------------------------------------------------
      if (!hold && ns.serverExists(SING) && money > 1e6) {
        const ws = pserv.filter((h) => h !== SING), lim = LIMIT - 1;
        let r = 16; while (r < 1048576 && (r * 2) * GB <= money * 0.5) r *= 2;
        if (r * GB <= money * 0.5) {
          if (ws.length < lim) { let i = 0; while (ns.serverExists(`pserv-${i}`)) i++; if (await buy("buy", `pserv-${i}`, r)) { ensure(`pserv-${i}`); log(`bought pserv-${i} ${r}GB`); } }
          else { const s = ws.sort((a, b) => ns.getServerMaxRam(a) - ns.getServerMaxRam(b))[0]; if (s && ns.getServerMaxRam(s) * 2 <= r && await buy("up", s, r)) log(`upgraded ${s} -> ${r}GB`); }
        }
      }

      ns.write(STATUS, JSON.stringify({ t: Date.now(), bootstrap: true, stage, money, hack, target, homeMax, singHost: ns.serverExists(SING), pservers: pserv.length, cap, dbg, err: lastErr }), "w");
    } catch (e) {
      lastErr = String(e).slice(0, 200); log(`error: ${lastErr}`);
      ns.write(STATUS, JSON.stringify({ t: Date.now(), bootstrap: true, stage: "error", err: lastErr }), "w");
      await ns.sleep(10000);
    }
    await ns.sleep(5000);
  }
}

