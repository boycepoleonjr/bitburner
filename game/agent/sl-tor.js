/** agent/sl-tor.js — one-shot Singularity op, run on a big-enough purchased server by daemon-lite (result on port 21).
 * @param {NS} ns */
export async function main(ns) { ns.writePort(21, JSON.stringify({ op: "tor", ok: !!ns.singularity.purchaseTor() })); }
