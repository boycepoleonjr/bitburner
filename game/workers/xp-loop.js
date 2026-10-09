/**
 * workers/xp-loop.js — persistent weaken loop for hacking XP, managed by the daemon's RAM manager (lib/ramplan.js).
 * Replaces the daemon's one-shot XP waves (which idled between 5 s loops). RAM: 1.75 GB/thread.
 * args: [target, tag]
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog("ALL");
  const target = String(ns.args[0] || "joesguns");
  while (true) await ns.weaken(target);
}
