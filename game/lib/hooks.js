/**
 * lib/hooks.js — extension points called once per daemon loop (after waves are placed).
 * Each hook is gated by config.hooks.* and must never throw into the loop.
 */

const fmt = (ns, n) => ns.format.number(n, 2);

/**
 * Purchased servers (v3 API: ns.cloud.*). Buys new servers at minRamGb while under the
 * limit, then doubles the smallest one — only while cost <= money × maxSpendFraction.
 * (Bulk buys: tools/buy-pservers.js.)
 * @param {NS} ns
 */
export function purchasedServersHook(ns, cfg, state, log) {
  const c = cfg.hooks.purchasedServers;
  if (!c.enabled) return;
  const budget = ns.getServerMoneyAvailable("home") * c.maxSpendFraction;
  const names = ns.cloud.getServerNames();
  if (names.length < ns.cloud.getServerLimit()) {
    const cost = ns.cloud.getServerCost(c.minRamGb);
    if (cost <= budget) {
      const host = ns.cloud.purchaseServer(`${c.namePrefix}-${names.length}`, c.minRamGb);
      if (host) log.event("pserv", `bought ${host} (${c.minRamGb}GB) for $${fmt(ns, cost)}`);
    }
    return;
  }
  const cap = Math.min(c.targetRamGb, ns.cloud.getRamLimit());
  const smallest = names
    .map((h) => ({ h, ram: ns.getServerMaxRam(h) }))
    .filter((x) => x.ram < cap)
    .sort((a, b) => a.ram - b.ram)[0];
  if (!smallest) return;
  const next = smallest.ram * 2;
  const cost = ns.cloud.getServerUpgradeCost(smallest.h, next);
  if (cost <= budget && ns.cloud.upgradeServer(smallest.h, next)) {
    log.event("pserv", `upgraded ${smallest.h} → ${next}GB for $${fmt(ns, cost)}`);
  }
}

/**
 * Hacknet: repeatedly buy the cheapest node/upgrade while
 *   each item costs <= money × maxItemFraction and the loop total <= money × maxLoopFraction.
 * Cheapest-first naturally maxes nodes over time (achievements: 30 nodes, a maxed node).
 * @param {NS} ns
 */
export function hacknetHook(ns, cfg, state, log) {
  const c = cfg.hooks.hacknet;
  if (!c.enabled) return;
  const hn = ns.hacknet;
  const money0 = ns.getServerMoneyAvailable("home");
  const loopCap = money0 * c.maxLoopFraction;
  let spent = 0;
  const bought = {};
  for (let n = 0; n < c.maxActionsPerLoop; n++) {
    const options = [];
    if (hn.numNodes() < Math.min(c.maxNodes, hn.maxNumNodes())) {
      // ROI: a new node produces the per-unit base rate of node 0 (level 1, 1GB, 1 core)
      let base = null; if (hn.numNodes() > 0) { const z = hn.getNodeStats(0); base = z.production / (z.level * Math.pow(1.035, z.ram - 1) * (z.cores + 5) / 6); }
      options.push({ what: "node", cost: hn.getPurchaseNodeCost(), gain: base, buy: () => hn.purchaseNode() >= 0 });
    }
    for (let i = 0; i < hn.numNodes(); i++) {
      const st = hn.getNodeStats(i), p = st.production;
      options.push({ what: "level", cost: hn.getLevelUpgradeCost(i, 1), gain: p / st.level, buy: () => hn.upgradeLevel(i, 1) });
      options.push({ what: "ram", cost: hn.getRamUpgradeCost(i, 1), gain: p * (Math.pow(1.035, st.ram) - 1), buy: () => hn.upgradeRam(i, 1) });
      options.push({ what: "core", cost: hn.getCoreUpgradeCost(i, 1), gain: p / (st.cores + 5), buy: () => hn.upgradeCore(i, 1) });
    }
    // payoff gate (agent 2026-09-27): skip anything that will not pay back within maxPayoffHours; best gain/cost first
    const maxPay = (c.maxPayoffHours ?? Infinity) * 3600;
    const pick = options.filter((o) => isFinite(o.cost) && (o.gain == null ? hn.numNodes() === 0 : o.gain > 0 && o.cost / o.gain <= maxPay))
      .sort((a, b) => (b.gain ?? 1) / b.cost - (a.gain ?? 1) / a.cost)[0];
    if (!pick) break;
    const money = ns.getServerMoneyAvailable("home");
    if (pick.cost > money * c.maxItemFraction || spent + pick.cost > loopCap) break;
    if (!pick.buy()) break;
    spent += pick.cost;
    bought[pick.what] = (bought[pick.what] ?? 0) + 1;
  }
  if (spent > 0) {
    const what = Object.entries(bought).map(([k, v]) => `${v} ${k}`).join(", ");
    const nodes = hn.numNodes();
    if (bought.node && (nodes % 5 === 0 || nodes === c.maxNodes)) log.event("hacknet", `${nodes} hacknet nodes`);
    log.debug("hacknet", `bought ${what} for $${fmt(ns, spent)} (${nodes} nodes)`);
  }
}

/**
 * Stocks: keep tools/stocks.js running (it buys market access and trades on 4S forecasts).
 * @param {NS} ns
 */
export function stocksHook(ns, cfg, state, log) {
  const c = cfg.hooks.stocks;
  if (!c.enabled || ns.scriptRunning(c.script, "home")) return;
  if (ns.run(c.script) > 0) log.event("stocks", `started ${c.script}`);
}

/**
 * Milestones toward destroying the BitNode:
 *  - auto-backdoor watched servers when ready (via tools/auto-backdoor.js; Terminal must be open)
 *  - faction joins, Daedalus readiness, w0r1d_d43m0n appearance/readiness (never auto-backdoored:
 *    that destroys the BitNode, so it's your call)
 *  - periodic reminder to upgrade home RAM/cores (no Singularity → manual purchase)
 * @param {Map<string, import("lib/network.js").ServerInfo>} map
 */
export function milestonesHook(ns, cfg, state, log, map, hackLevel) {
  const c = cfg.hooks.milestones;
  if (!c.enabled) return;
  const now = Date.now();
  const once = (key, fn) => {
    if (state.milestonesSeen.includes(key)) return;
    state.milestonesSeen.push(key);
    fn();
  };
  state.backdoorTries = state.backdoorTries ?? {};

  // 1. backdoors
  for (const host of c.backdoorWatch) {
    const s = map.get(host);
    if (!s || s.backdoor || !s.rooted || s.reqHack > hackLevel) continue;
    if (host === "w0r1d_d43m0n") continue; // handled below, never automatic
    if (c.autoBackdoor) {
      if (now - (state.backdoorTries[host] ?? 0) < c.backdoorRetryMs) continue;
      if (ns.scriptRunning(c.backdoorScript, "home")) continue; // one at a time
      state.backdoorTries[host] = now;
      if (ns.run(c.backdoorScript, 1, host, ...s.path) > 0) log.info("milestone", `auto-backdoor requested: ${host}`);
    } else {
      once(`backdoor:${host}`, () => log.event("milestone", `${host} is ready to backdoor → run tools/backdoor-paths.js ${host}`));
    }
  }
  for (const host of c.backdoorWatch) {
    const s = map.get(host);
    if (s?.backdoor) once(`backdoored:${host}`, () => log.event("milestone", `${host} backdoored`));
  }

  // 2. the end goal
  const wd = map.get("w0r1d_d43m0n");
  if (wd) {
    once("wd:visible", () => log.event("milestone", `w0r1d_d43m0n appeared (needs hack ${wd.reqHack}, ${wd.portsReq} ports)`));
    if (wd.rooted && wd.reqHack <= hackLevel) {
      once("wd:ready", () => log.event("milestone", "w0r1d_d43m0n is READY — backdoor it to destroy BitNode 1: run tools/backdoor-paths.js w0r1d_d43m0n"));
    }
  }

  // 3. factions + Daedalus
  const player = ns.getPlayer();
  const known = state.factionsSeen ?? [];
  for (const f of player.factions) if (!known.includes(f)) log.event("faction", `joined ${f}`);
  state.factionsSeen = [...player.factions];
  if (!player.factions.includes("Daedalus")) {
    const d = c.daedalus;
    if (player.money >= d.money && hackLevel >= d.hack) {
      once("daedalus:stats", () => log.event("milestone", `Daedalus money + hacking requirements met — it also needs ${d.augs} installed augmentations`));
    }
  }

  // 4. home upgrades (achievements: max home RAM / cores)
  const home = map.get("home");
  if (home && (home.maxRam < c.homeMaxRamGb || home.cores < c.homeMaxCores) && now - (state.homeNagAt ?? 0) >= c.homeReminderMs) {
    state.homeNagAt = now;
    const msg = `Home is ${ns.format.ram(home.maxRam)} / ${home.cores} cores — upgrade at City → Alpha Enterprises when affordable`;
    log.info("milestone", msg);
    ns.toast(msg, "info", 10_000);
  }
}
