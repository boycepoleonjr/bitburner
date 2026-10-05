/** agent/sl-ram.js — upgrade home RAM once. Run on a purchased server by daemon-lite.
 * @param {NS} ns */
export async function main(ns) { ns.writePort(21, JSON.stringify({ op: "homeRam", ok: !!ns.singularity.upgradeHomeRam() })); }
