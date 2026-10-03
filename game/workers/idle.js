/**
 * workers/idle.js — does nothing for args[0] ms (used by tools/burst.js). args: [ms, tag]
 * @param {NS} ns
 */
export async function main(ns) {
  await ns.sleep(Number(ns.args[0]) || 30_000);
}
