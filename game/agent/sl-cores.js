/** agent/sl-cores.js — upgrade home cores once. Run on a purchased server by daemon-lite.
 * @param {NS} ns */
export async function main(ns) { ns.writePort(21, JSON.stringify({ op: "homeCores", ok: !!ns.singularity.upgradeHomeCores() })); }
