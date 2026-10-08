/**
 * lib/deploy.js — RAM pool, job placement, worker census, and kills.
 */

/**
 * @typedef {{host: string, free: number, cores: number, isHome: boolean}} Slot
 * @typedef {{procs: number, threads: {hack: number, grow: number, weaken: number}, ramGb: number}} TargetLoad
 */

/**
 * Free RAM on every executor, minus the home reserve.
 * @param {NS} ns
 * @param {import("lib/network.js").ServerInfo[]} executors
 * @param {import("lib/config.js").Config} cfg
 * @returns {Slot[]}
 */
export function buildPool(ns, executors, cfg) {
  return executors
    .map((s) => {
      const used = ns.getServerUsedRam(s.host);
      const reserve = s.isHome ? cfg.homeReserveGb : 0;
      return { host: s.host, free: Math.max(0, s.maxRam - used - reserve), cores: s.cores, isHome: s.isHome };
    })
    .filter((p) => p.free > 0);
}

/** RAM usable for whole threads of `unit` GB (fragment-aware). */
export function poolCapacity(pool, unit) {
  return pool.reduce((sum, p) => sum + Math.floor(p.free / unit) * unit, 0);
}

export function poolTotals(pool) {
  return { free: pool.reduce((a, p) => a + p.free, 0), hosts: pool.length };
}

/**
 * Place `threads` of `script` across the pool (mutates pool.free).
 * grow/weaken prefer multi-core hosts (home); hack prefers small hosts to use up fragments.
 * @param {NS} ns
 * @param {Slot[]} pool
 * @param {string} script
 * @param {number} threads
 * @param {any[]} args
 * @param {number} ramPer
 * @param {"hack"|"grow"|"weaken"} op
 * @returns {{placed: number, pids: number[], hosts: number}}
 */
export function place(ns, pool, script, threads, args, ramPer, op) {
  const order = [...pool].sort((a, b) =>
    op === "hack" ? a.free - b.free : b.cores - a.cores || b.free - a.free,
  );
  let left = threads;
  const pids = [];
  let hosts = 0;
  for (const slot of order) {
    if (left <= 0) break;
    const fit = Math.floor(slot.free / ramPer);
    if (fit <= 0) continue;
    const n = Math.min(fit, left);
    if (!slot.isHome && !ns.fileExists(script, slot.host)) ns.scp(script, slot.host, "home");
    const pid = ns.exec(script, slot.host, { threads: n, temporary: true }, ...args);
    if (pid > 0) {
      pids.push(pid);
      slot.free -= n * ramPer;
      left -= n;
      hosts++;
    }
  }
  return { placed: threads - left, pids, hosts };
}

/**
 * Push fresh copies of the worker scripts to every non-home executor (call on start / worker change).
 * @param {NS} ns
 */
export function syncWorkers(ns, executors, cfg) {
  const files = Object.values(cfg.workers);
  let n = 0;
  for (const s of executors) {
    if (s.isHome) continue;
    if (ns.scp(files, s.host, "home")) n++;
  }
  return n;
}

/**
 * What every worker on the network is currently doing, grouped by target.
 * @param {NS} ns
 * @param {string[]} hosts
 * @returns {Map<string, TargetLoad>}
 */
export function census(ns, hosts, cfg) {
  const byFile = new Map(Object.entries(cfg.workers).map(([op, f]) => [f, op]));
  /** @type {Map<string, TargetLoad>} */
  const out = new Map();
  for (const host of hosts) {
    for (const p of ns.ps(host)) {
      const op = byFile.get(p.filename);
      if (!op) continue;
      const target = String(p.args[0]);
      const t = out.get(target) ?? { procs: 0, threads: { hack: 0, grow: 0, weaken: 0 }, ramGb: 0 };
      t.procs++;
      t.threads[op] += p.threads;
      t.ramGb += p.threads * 1.75;
      out.set(target, t);
    }
  }
  return out;
}

/**
 * Kill worker processes matching a predicate on (target, op, tag).
 * Tags starting with "manual" belong to tools (drain etc.) and are never touched here.
 * @param {NS} ns
 * @param {string[]} hosts
 * @param {(target: string, op: string, tag: string) => boolean} pred
 */
export function killWorkers(ns, hosts, cfg, pred) {
  const byFile = new Map(Object.entries(cfg.workers).map(([op, f]) => [f, op]));
  let killed = 0;
  for (const host of hosts) {
    for (const p of ns.ps(host)) {
      const op = byFile.get(p.filename);
      if (!op) continue;
      const tag = String(p.args[2] ?? "");
      if (tag.startsWith("manual")) continue;
      if (pred(String(p.args[0]), op, tag) && ns.kill(p.pid)) killed++;
    }
  }
  return killed;
}
