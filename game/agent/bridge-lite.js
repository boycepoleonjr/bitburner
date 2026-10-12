/** agent/bridge-lite.js — low-RAM window.bb (eval + files). status()/snapshot() are async (run via eval).
 * @param {NS} ns */
export async function main(ns) {
  const win = eval("window");
  ns.disableLog("ALL");
  let seq = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const LOG = "/data/agent-log.txt";
  const STATUS = `const p=ns.getPlayer();const h=ns.getServer("home");const ps=ns.ps("home");const ri=ns.getResetInfo();
return {money:p.money,hacking:p.skills.hacking,city:p.city,factions:p.factions,karma:p.karma,homeRam:h.maxRam,homeUsed:h.ramUsed,cores:h.cpuCores,
pservs:ns.cloud.getServerNames().length,scripts:ps.filter(s=>!s.filename.startsWith("workers/")).map(s=>s.pid+" "+s.filename+" "+s.args.join(" ")),
workers:ps.filter(s=>s.filename.startsWith("workers/")).length,income:ns.getTotalScriptIncome()[0],sinceAug:Date.now()-ri.lastAugReset,bitnode:ri.currentNode};`;
  const bb = {
    version: "lite-2", lite: true, pid: ns.pid, startedAt: Date.now(), ns,
    alive: () => ns.isRunning(ns.pid),
    async eval(code, { timeoutMs = 120000, host = "home" } = {}) {
      const id = `${Date.now()}-${++seq}`;
      const file = `/agent/jobs/job-${id}.js`, out = `/agent/jobs/out-${id}.txt`;
      ns.write(file, `/** @param {NS} ns */\nexport async function main(ns){let r;try{r={ok:true,value:await (async()=>{\n${code}\n})()};}catch(e){r={ok:false,error:String(e&&e.message||e)};}\nns.write(${JSON.stringify(out)},JSON.stringify(r),"w");}`, "w");
      const pid = ns.exec(file, host, { threads: 1, temporary: true });
      if (!pid) { ns.rm(file); return { ok: false, error: "exec failed (not enough RAM?)" }; }
      const t0 = Date.now();
      while (ns.isRunning(pid) && Date.now() - t0 < timeoutMs) await sleep(100);
      if (ns.isRunning(pid)) { ns.kill(pid); ns.rm(file); return { ok: false, error: "timeout" }; }
      const txt = ns.read(out); ns.rm(file); ns.rm(out);
      return txt ? JSON.parse(txt) : { ok: false, error: "no output" };
    },
    async status() { const r = await bb.eval(STATUS); if (!r.ok) throw new Error(r.error); return r.value; },
    read: (f) => ns.read(f),
    write: (f, d, m = "w") => ns.write(f, d, m),
    rm: (f, host = "home") => ns.rm(f, host),
    run: (script, threads = 1, ...args) => ns.exec(script, "home", threads, ...args),
    kill: (pid) => ns.kill(pid),
    tail: (n = 40) => ns.read(LOG).split("\n").slice(-n).join("\n"),
    note(msg) { ns.write(LOG, `[${new Date().toISOString()}] ${msg}\n`, "a"); },
    async snapshot(extra = {}) {
      const SNAP = "/data/agent-snapshots.txt";
      const s = await bb.status();
      const now = Date.now();
      const snap = { t: now, reset: Math.round((now - s.sinceAug) / 6e4), sinceAug: s.sinceAug, money: s.money, income: s.income, hacking: s.hacking,
        factions: s.factions.length, homeRam: s.homeRam, cores: s.cores, pservs: s.pservs, bitnode: s.bitnode,
        actions: extra.actions ?? 0, etaMin: extra.etaMin ?? null, note: extra.note ?? "" };
      const hist = ns.read(SNAP).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const same = hist.filter((h) => Math.abs((h.reset ?? -1) - snap.reset) <= 1);
      const prev = same.length ? same[same.length - 1] : null;
      const why = [];
      const hrs = snap.sinceAug / 3.6e6;
      let d = hrs < 0.5 ? 10 : hrs < 2 ? 15 : 20; why.push(`base ${d} (${hrs.toFixed(1)}h since install)`);
      if (prev) {
        const mins = (snap.t - prev.t) / 6e4 || 1;
        const hackRate = (snap.hacking - prev.hacking) / Math.max(prev.hacking, 1) / mins;
        const moneyX = snap.money / Math.max(prev.money, 1);
        snap.hackRate = hackRate; snap.moneyX = moneyX;
        if (hackRate > 0.02 || (moneyX > 10 && !(prev.actions > 0))) { d = Math.min(d, 15); why.push(`fast growth (hack +${(hackRate * 100).toFixed(1)}%/min, money x${moneyX.toFixed(1)})`); }
      }
      let idle = 0;
      for (const h of [...same, snap].reverse()) { if (h.actions > 0) break; idle++; }
      if (idle >= 3 && hrs >= 2 && snap.etaMin == null) { d = Math.min(d * Math.pow(1.25, idle - 2), 30); why.push(`idle x${idle}`); }
      if (snap.etaMin != null && snap.etaMin + 1 < d) { d = snap.etaMin + 1; why.push(`eta ${snap.etaMin}m`); }
      d = Math.round(Math.max(5, Math.min(30, d)));
      snap.nextMin = d; snap.why = why.join("; ");
      ns.write(SNAP, JSON.stringify(snap) + "\n", "a");
      return { nextMin: d, why: snap.why, prev, snap };
    },
  };
  win.bb = bb;
  ns.atExit(() => { if (win.bb && win.bb.pid === ns.pid) delete win.bb; });
  bb.note("bridge-lite started pid=" + ns.pid);
  await new Promise(() => {});
}
