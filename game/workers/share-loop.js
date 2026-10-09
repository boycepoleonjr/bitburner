/**
 * workers/share-loop.js — persistent ns.share() worker managed by the daemon's RAM manager (lib/ramplan.js).
 * Boosts faction-work rep while it runs. Each share() cycle is 10 s. RAM: 1.6 base + 2.4 share = 4.0 GB/thread.
 * args: [tag]  (tag only keeps process args unique)
 * @param {NS} ns
 */
export async function main(ns) {
  ns.disableLog("ALL");
  while (true) await ns.share();
}
