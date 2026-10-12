/** agent/share-keeper.js — RETIRED. The daemon's RAM manager now sizes workers/share-loop.js from the strategy
 * settings (strategy.*, ram.share.enabled). Kept as a stub so old references exit cleanly. @param {NS} ns */
export async function main(ns) {
  ns.tprint("agent/share-keeper.js is retired: the daemon RAM manager runs workers/share-loop.js (see docs/specs/ram-manager.md)");
}
