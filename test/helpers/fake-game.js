// Deterministic fake Bitburner network for daemon tests. Targets stay prepped (min security, max money) so waves are
// always farm waves; one-shot workers end after their op time + delay; share/xp loops run until killed.
// Clock: game.now (ms). Tests drive it with game.advance(ms) and stub Date.now to game.now.

export const SCRIPT_RAM = {
  "workers/hack.js": 1.7, "workers/grow.js": 1.75, "workers/weaken.js": 1.75,
  "workers/share-loop.js": 4.0, "workers/xp-loop.js": 1.75, "daemon.js": 30,
};

/**
 * @param {{homeRam?:number, homeUsed?:number, cash?:number, hack?:number, targets?:number, filler?:Array<[string, number]>,
 *          files?:Object, ownedAugs?:string[], cloudLimit?:number, cloudRamLimit?:number, gbCost?:number}} o
 */
export function fakeGame(o = {}) {
  const g = {
    now: Date.UTC(2026, 9, 8, 12), cash: o.cash ?? 1e15, hack: o.hack ?? 3000, pid: 1, procs: new Map(), log: { exec: [], kill: [], killFiles: [], buy: [], upgrade: [] },
    files: { ...(o.files || {}) }, servers: new Map(), shareThreads: 0,
  };
  const add = (host, s) => g.servers.set(host, {
    host, maxRam: 0, staticUsed: 0, cores: 1, maxMoney: 0, reqHack: 1, minSec: 5, growth: 50, purchased: false, rooted: true, ...s,
  });
  add("home", { maxRam: o.homeRam ?? 1024, staticUsed: o.homeUsed ?? 40, cores: 8, purchased: true });
  const n = o.targets ?? 12;
  for (let i = 0; i < n; i++) add(`t${String(i).padStart(2, "0")}`, { maxRam: 16 * (i % 4), maxMoney: 1e9 * (n - i), reqHack: 100 + 50 * i, minSec: 5 + i, growth: 40 + i });
  for (const [h, ram] of o.filler || []) add(h, { maxRam: ram });
  add("joesguns", { maxRam: 16, maxMoney: 2.5e6, reqHack: 10, minSec: 5, growth: 20 });
  const limit = o.cloudLimit ?? 25, ramLimit = o.cloudRamLimit ?? 2 ** 20, gbCost = o.gbCost ?? 55_000;

  const live = () => { for (const [pid, p] of g.procs) if (p.endsAt <= g.now) g.procs.delete(pid); return [...g.procs.values()]; };
  const used = (h) => (g.servers.get(h)?.staticUsed ?? 0) + live().filter((p) => p.host === h).reduce((a, p) => a + p.threads * p.ram, 0);
  const hackTime = (h) => 2000 + (g.servers.get(h)?.reqHack ?? 1) * 4;
  const serverObj = (h) => {
    const s = g.servers.get(h);
    return { hostname: h, hasAdminRights: s.rooted, backdoorInstalled: false, requiredHackingSkill: s.reqHack, numOpenPortsRequired: 0, openPortCount: 5,
      maxRam: s.maxRam, ramUsed: used(h), cpuCores: s.cores, moneyAvailable: s.maxMoney, moneyMax: s.maxMoney, hackDifficulty: s.minSec,
      minDifficulty: s.minSec, serverGrowth: s.growth, purchasedByPlayer: s.purchased };
  };
  const exec = (script, host, opts, ...args) => {
    const threads = typeof opts === "object" ? opts.threads : (opts ?? 1);
    const ram = SCRIPT_RAM[script];
    const s = g.servers.get(host);
    if (!s || !ram || !(threads >= 1) || used(host) + threads * ram > s.maxRam + 1e-9) return 0;
    const op = script.match(/workers\/(hack|grow|weaken)\.js/)?.[1];
    const t = String(args[0]);
    const dur = op === "hack" ? hackTime(t) : op === "grow" ? hackTime(t) * 3.2 : op === "weaken" ? hackTime(t) * 4 : Infinity;
    const pid = g.pid++;
    g.procs.set(pid, { pid, filename: script, host, threads, args, ram, endsAt: g.now + dur + (Number(args[1]) || 0) * (op ? 1 : 0) });
    g.log.exec.push([script, host, threads, ...args.map(String)]);
    return pid;
  };
  const cloudCost = (r) => r * gbCost;
  const ns = {
    args: [], pid: 999,
    disableLog() {}, print() {}, tprint() {}, toast() {},
    read: (f) => g.files[f.replace(/^\//, "")] ?? "",
    write: (f, d, m = "a") => { const k = f.replace(/^\//, ""); g.files[k] = m === "w" ? String(d) : (g.files[k] ?? "") + String(d); },
    fileExists: (f, h) => /^(BruteSSH|FTPCrack|relaySMTP|HTTPWorm|SQLInject)\.exe$/.test(f) || f in SCRIPT_RAM,
    getScriptName: () => "daemon.js",
    getScriptRam: (f) => SCRIPT_RAM[f] ?? 0,
    getHackingLevel: () => g.hack,
    scan: (h) => (h === "home" ? [...g.servers.keys()].filter((x) => x !== "home") : ["home"]),
    getServer: (h) => serverObj(h),
    getServerUsedRam: used, getServerMaxRam: (h) => g.servers.get(h)?.maxRam ?? 0,
    getServerMoneyAvailable: (h) => (h === "home" ? g.cash : g.servers.get(h)?.maxMoney ?? 0),
    hasRootAccess: (h) => g.servers.get(h)?.rooted ?? false,
    ps: (h) => live().filter((p) => p.host === h).map((p) => ({ pid: p.pid, filename: p.filename, threads: p.threads, args: [...p.args] })),
    exec, scp: () => true,
    kill: (pid) => { const p = g.procs.get(pid); const ok = g.procs.delete(pid); if (ok) { g.log.kill.push(pid); g.log.killFiles.push(p.filename); } return ok; },
    hackAnalyzeChance: () => 1, hackAnalyze: () => 0.002, hackAnalyzeSecurity: (t) => 0.002 * t,
    growthAnalyze: (h, m) => Math.ceil(Math.log(m) / Math.log(1.0035)), growthAnalyzeSecurity: (t) => 0.004 * t,
    weakenAnalyze: (t) => 0.05 * t,
    getHackTime: hackTime, getGrowTime: (h) => hackTime(h) * 3.2, getWeakenTime: (h) => hackTime(h) * 4,
    readPort: () => "NULL PORT DATA", tryWritePort: () => true,
    getMoneySources: () => ({ sinceInstall: { hacking: 0, stock: 0, hacknet: 0 } }),
    getPlayer: () => ({}),
    getResetInfo: () => ({ currentNode: 5, ownedAugs: new Map((o.ownedAugs ?? []).map((a) => [a, 1])) }),
    getSharePower: () => 1 + Math.log1p(live().filter((p) => p.filename === "workers/share-loop.js").reduce((a, p) => a + p.threads, 0)) / 100,
    format: { number: (v, d = 2) => Number(v).toFixed(d), ram: (v) => `${v}GB`, time: (v) => `${v}ms`, percent: (v) => `${v * 100}%` },
    cloud: {
      getServerNames: () => [...g.servers.values()].filter((s) => s.purchased && s.host !== "home").map((s) => s.host),
      getServerLimit: () => limit, getRamLimit: () => ramLimit,
      getServerCost: (r) => (Number.isInteger(Math.log2(r)) && r <= ramLimit ? cloudCost(r) : Infinity),
      getServerUpgradeCost: (h, r) => { const s = g.servers.get(h); return s && r > s.maxRam && r <= ramLimit ? cloudCost(r) - cloudCost(s.maxRam) : -1; },
      purchaseServer: (h, r) => {
        const c = cloudCost(r); if (c > g.cash || ns.cloud.getServerNames().length >= limit) return "";
        g.cash -= c; add(h, { maxRam: r, purchased: true }); g.log.buy.push([h, r, c]); return h;
      },
      upgradeServer: (h, r) => {
        const c = ns.cloud.getServerUpgradeCost(h, r); if (c < 0 || c > g.cash) return false;
        g.cash -= c; g.servers.get(h).maxRam = r; g.log.upgrade.push([h, r, c]); return true;
      },
    },
  };
  g.ns = ns;
  g.advance = (ms) => { g.now += ms; live(); };
  g.live = live;
  g.usedBy = (re) => live().filter((p) => re.test(p.filename)).reduce((a, p) => a + p.threads * p.ram, 0);
  g.totalRam = () => [...g.servers.values()].reduce((a, s) => a + s.maxRam, 0);
  return g;
}

/** Daemon config for tests: real defaults, side-effect hooks off, quiet logs. */
export function testConfig(DEFAULTS, merge, over = {}) {
  return merge(DEFAULTS, merge({
    homeReserveGb: 64,
    programs: { enabled: false },
    log: { terminalEvents: false, level: "error" },
    hooks: { hacknet: { enabled: false }, stocks: { enabled: false }, milestones: { enabled: false }, purchasedServers: { enabled: false } },
  }, over));
}

/** Run n daemon ticks, advancing the fake clock by loopMs each time. Returns per-loop decision snapshots. */
export function runTicks(g, tick, cfg, state, n, { loopMs = 5000, makeLog } = {}) {
  const realNow = Date.now;
  Date.now = () => g.now;
  const out = [];
  let seq = 0;
  const log = makeLog ? makeLog() : { error() {}, warn() {}, info() {}, debug() {}, event() {} };
  try {
    for (let i = 0; i < n; i++) {
      const e0 = g.log.exec.length, k0 = g.log.kill.length;
      tick(g.ns, cfg, state, log, () => ++seq, i === 0);
      out.push({ primary: state.primary, secondaries: [...state.secondaries], execs: g.log.exec.slice(e0), kills: g.log.kill.length - k0 });
      g.advance(loopMs);
    }
  } finally { Date.now = realNow; }
  return out;
}
