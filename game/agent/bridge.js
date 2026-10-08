/** agent-bridge.js — exposes a control API on window.bb for an external AI agent.
 * Low RAM: arbitrary ns code runs via bb.eval(), which writes a one-shot job
 * script (RAM calculated per job) and returns its JSON result.
 * @param {NS} ns */
export async function main(ns) {
  const win = eval("window");
  ns.disableLog("ALL");
  let seq = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const LOG = "/data/agent-log.txt";

  const bb = {
    version: 4,
    pid: ns.pid,
    startedAt: Date.now(),
    alive: () => ns.isRunning(ns.pid),
    ns,
    // Run arbitrary ns code on home. `code` is an async function body using `ns`; `return` a JSON-able value.
    async eval(code, { timeoutMs = 120000, host = "home" } = {}) {
      const id = `${Date.now()}-${++seq}`;
      const file = `/agent/jobs/job-${id}.js`;
      const out = `/agent/jobs/out-${id}.txt`;
      ns.write(file,
        `/** @param {NS} ns */\nexport async function main(ns){let r;try{r={ok:true,value:await (async()=>{\n${code}\n})()};}catch(e){r={ok:false,error:String(e&&e.message||e)};}\nns.write(${JSON.stringify(out)},JSON.stringify(r),"w");}`,
        "w");
      const pid = ns.exec(file, host, { threads: 1, temporary: true });
      if (!pid) { ns.rm(file); return { ok: false, error: `exec failed (RAM ${ns.getScriptRam(file)}GB needed; ${ns.getServerMaxRam(host) - ns.getServerUsedRam(host)}GB free)` }; }
      const t0 = Date.now();
      while (ns.isRunning(pid) && Date.now() - t0 < timeoutMs) await sleep(100);
      if (ns.isRunning(pid)) { ns.kill(pid); ns.rm(file); return { ok: false, error: "timeout" }; }
      const txt = ns.read(out);
      ns.rm(file); ns.rm(out);
      return txt ? JSON.parse(txt) : { ok: false, error: "no output (script killed?)" };
    },
    // Quick snapshot of the run.
    status() {
      const p = ns.getPlayer();
      const home = ns.getServer("home");
      return {
        money: p.money, hacking: p.skills.hacking, city: p.city,
        factions: p.factions, karma: p.karma, kills: p.numPeopleKilled,
        homeRam: home.maxRam, homeUsed: home.ramUsed, cores: home.cpuCores,
        pservs: ns.cloud.getServerNames().length,
        scripts: ns.ps("home").filter((s) => !s.filename.startsWith("workers/")).map((s) => `${s.pid} ${s.filename} ${s.args.join(" ")}`),
        workers: ns.ps("home").filter((s) => s.filename.startsWith("workers/")).length,
        income: ns.getTotalScriptIncome()[0],
        sinceAug: Date.now() - ns.getResetInfo().lastAugReset,
        bitnode: ns.getResetInfo().currentNode,
      };
    },
    read: (f) => ns.read(f),
    write: (f, data, mode = "w") => ns.write(f, data, mode),
    ls: (host = "home", grep) => ns.ls(host, grep),
    rm: (f, host = "home") => ns.rm(f, host),
    ps: (host = "home") => ns.ps(host),
    run: (script, threads = 1, ...args) => ns.exec(script, "home", threads, ...args),
    kill: (pid) => ns.kill(pid),
    logs: (pid) => ns.getScriptLogs(pid),
    tail: (n = 40) => ns.read(LOG).split("\n").slice(-n).join("\n"),
    // Record a per-check-in snapshot and compute the delay (minutes) until the next check-in.
    // extra: { actions: <number of actions taken this check-in>, etaMin: <agent's minutes-to-next-actionable-milestone>, note }
    snapshot(extra = {}) {
      const SNAP = "/data/agent-snapshots.txt";
      const s = bb.status();
      const now = Date.now();
      const snap = { t: now, reset: Math.round((now - s.sinceAug) / 6e4), sinceAug: s.sinceAug, money: s.money, income: s.income, hacking: s.hacking,
        factions: s.factions.length, homeRam: s.homeRam, cores: s.cores, pservs: s.pservs,
        actions: extra.actions ?? 0, etaMin: extra.etaMin ?? null, note: extra.note ?? "" };
      const hist = ns.read(SNAP).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const same = hist.filter((h) => Math.abs((h.reset ?? -1) - snap.reset) <= 1); // this install only
      const prev = same.length ? same[same.length - 1] : null;
      const why = [];
      // 1. Base cadence by time since last aug install (early game moves fast).
      const hrs = snap.sinceAug / 3.6e6;
      let d = hrs < 0.5 ? 10 : hrs < 2 ? 20 : hrs < 6 ? 40 : 60; why.push(`base ${d} (${hrs.toFixed(1)}h since install)`);
      // 2. Fast growth -> look sooner.
      if (prev) {
        const mins = (snap.t - prev.t) / 6e4 || 1;
        const hackRate = (snap.hacking - prev.hacking) / Math.max(prev.hacking, 1) / mins; // fraction/min
        const moneyX = snap.money / Math.max(prev.money, 1);
        snap.hackRate = hackRate; snap.moneyX = moneyX;
        if (hackRate > 0.02 || (moneyX > 10 && !(prev.actions > 0))) { d = Math.min(d, 15); why.push(`fast growth (hack +${(hackRate * 100).toFixed(1)}%/min, money x${moneyX.toFixed(1)})`); }
      }
      // 3. Idle backoff: consecutive check-ins (this reset) with no actions.
      let idle = 0;
      for (const h of [...same, snap].reverse()) { if (h.actions > 0) break; idle++; }
      if (idle >= 2 && hrs >= 2) { d = Math.min(d * Math.pow(1.5, idle - 1), 180); why.push(`idle x${idle}`); }
      // 4. Agent's own ETA to the next actionable event wins if sooner.
      if (snap.etaMin != null && snap.etaMin + 2 < d) { d = snap.etaMin + 2; why.push(`eta ${snap.etaMin}m`); }
      d = Math.round(Math.max(5, Math.min(180, d)));
      snap.nextMin = d; snap.why = why.join("; ");
      ns.write(SNAP, JSON.stringify(snap) + "\n", "a");
      return { nextMin: d, why: snap.why, prev, snap };
    },
    note(msg) { ns.write(LOG, `[${new Date().toISOString()}] ${msg}\n`, "a"); },
  };

  win.bb = bb;
  ns.atExit(() => { if (win.bb && win.bb.pid === ns.pid) delete win.bb; });
  bb.note("bridge started pid=" + ns.pid);
  ns.print("window.bb ready");
  await new Promise(() => {}); // stay alive without holding an ns sleep lock
}
