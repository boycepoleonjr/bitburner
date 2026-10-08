/**
 * lib/network.js — recursive discovery + server map + classification.
 *
 * One ns.getServer() call per host gives everything we need, so a full scan is cheap.
 */

/**
 * @typedef {Object} ServerInfo
 * @property {string} host
 * @property {string|null} parent
 * @property {string[]} path          hops from home (excluding "home"), for connect/backdoor
 * @property {number} depth
 * @property {boolean} rooted
 * @property {boolean} backdoor
 * @property {number} reqHack
 * @property {number} portsReq
 * @property {number} portsOpen
 * @property {number} maxRam
 * @property {number} usedRam
 * @property {number} cores
 * @property {number} money
 * @property {number} maxMoney
 * @property {number} sec
 * @property {number} minSec
 * @property {number} growth
 * @property {boolean} isHome
 * @property {boolean} isPurchased     bought via ns.cloud (not home, not hacknet)
 * @property {boolean} isHacknet
 * @property {string[]} roles          executor | target | utility | locked
 * @property {Object} raw              the ns.getServer() object (for port flags)
 */

/**
 * BFS from home. Returns a Map in discovery order (home first).
 * @param {NS} ns
 * @returns {Map<string, ServerInfo>}
 */
export function scanNetwork(ns) {
  /** @type {Map<string, ServerInfo>} */
  const map = new Map();
  const queue = [{ host: "home", parent: null, path: [] }];
  const seen = new Set(["home"]);
  while (queue.length) {
    const { host, parent, path } = queue.shift();
    map.set(host, describe(ns, host, parent, path));
    for (const next of ns.scan(host)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ host: next, parent: host, path: [...path, next] });
    }
  }
  return map;
}

/**
 * Fresh snapshot of one host (keeps parent/path).
 * @param {NS} ns
 */
export function describe(ns, host, parent = null, path = []) {
  const s = ns.getServer(host);
  const isHome = host === "home";
  const isHacknet = host.startsWith("hacknet-server") || host.startsWith("hacknet-node");
  const isPurchased = !!s.purchasedByPlayer && !isHome && !isHacknet;
  /** @type {ServerInfo} */
  const info = {
    host,
    parent,
    path,
    depth: path.length,
    rooted: !!s.hasAdminRights,
    backdoor: !!s.backdoorInstalled,
    reqHack: s.requiredHackingSkill ?? 0,
    portsReq: s.numOpenPortsRequired ?? 0,
    portsOpen: s.openPortCount ?? 0,
    maxRam: s.maxRam,
    usedRam: s.ramUsed,
    cores: s.cpuCores ?? 1,
    money: s.moneyAvailable ?? 0,
    maxMoney: s.moneyMax ?? 0,
    sec: s.hackDifficulty ?? 0,
    minSec: s.minDifficulty ?? 0,
    growth: s.serverGrowth ?? 0,
    isHome,
    isPurchased,
    isHacknet,
    roles: [],
    raw: s,
  };
  return info;
}

/**
 * Centralized classification. Mutates info.roles and returns it.
 * - executor: rooted and has usable RAM (home/purchased/network; hacknet only if enabled)
 * - target:   rooted, has money, hackable at the current level, not player-owned
 * - locked:   not rooted yet
 * - utility:  rooted but neither (faction servers, darkweb, 0-RAM 0-money nodes)
 * @param {ServerInfo} s
 * @param {number} hackLevel
 * @param {import("lib/config.js").Config} cfg
 */
export function classify(s, hackLevel, cfg) {
  const roles = [];
  const owned = s.isHome || s.isPurchased || s.isHacknet;
  if (!s.rooted) roles.push("locked");
  const execOk = s.rooted && s.maxRam >= cfg.minHostRamGb && (!s.isHacknet || cfg.useHacknetRam);
  if (execOk) roles.push("executor");
  if (s.rooted && !owned && s.maxMoney > 0 && s.reqHack <= hackLevel) roles.push("target");
  if (s.rooted && !roles.includes("executor") && !roles.includes("target")) roles.push("utility");
  s.roles = roles;
  return roles;
}

/** @param {Map<string, ServerInfo>} map */
export function byRole(map, role) {
  return [...map.values()].filter((s) => s.roles.includes(role));
}
