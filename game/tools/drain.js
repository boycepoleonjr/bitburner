/**
 * tools/drain.js — hack one server down to $0 (achievement "Big trouble").
 * Pick a target the daemon isn't farming; defaults to n00dles. Runs in the home reserve
 * (config.homeReserveGb) plus any free RAM, waiting for space if the network is full.
 * Usage: run tools/drain.js [host]
 * @param {NS} ns
 */
import { loadConfig } from "lib/config.js";
import { scanNetwork, classify, byRole } from "lib/network.js";
import { buildPool, place } from "lib/deploy.js";

/** @param {NS} ns */
export async function main(ns) {
  const host = String(ns.args[0] ?? "n00dles");
  const { cfg } = loadConfig(ns);
  if (!ns.hasRootAccess(host)) return ns.tprint(`no root on ${host}`);
  const hackRam = ns.getScriptRam(cfg.workers.hack, "home");
  for (let round = 1; round <= 60; round++) {
    const money = ns.getServerMoneyAvailable(host);
    if (money <= 0) {
      markDone(ns, "Big trouble");
      return ns.tprint(`${host} drained to $0 in ${round - 1} round(s)`);
    }
    const threads = Math.ceil(ns.hackAnalyzeThreads(host, money) * 1.2) + 1;
    const map = scanNetwork(ns);
    for (const s of map.values()) classify(s, ns.getHackingLevel(), cfg);
    const pool = buildPool(ns, byRole(map, "executor"), { ...cfg, homeReserveGb: 0 });
    const r = place(ns, pool, cfg.workers.hack, threads, [host, 0, `manual-drain-${round}`], hackRam, "hack");
    ns.tprint(`round ${round}: $${ns.format.number(money, 2)} on ${host} → ${r.placed}/${threads} hack threads`);
    if (r.placed === 0) { await ns.sleep(10_000); continue; } // wait for RAM
    await ns.sleep(ns.getHackTime(host) + 500);
  }
  ns.tprint(`${host} still has $${ns.format.number(ns.getServerMoneyAvailable(host), 2)} after 60 rounds`);
}

/** Remember a one-off achievement in data/achievements-done.txt (read by tools/goals.js). */
function markDone(ns, name) {
  let done = [];
  try { done = JSON.parse(ns.read("data/achievements-done.txt") || "[]"); } catch { /* fresh */ }
  if (!done.includes(name)) ns.write("data/achievements-done.txt", JSON.stringify([...done, name]), "w");
}
