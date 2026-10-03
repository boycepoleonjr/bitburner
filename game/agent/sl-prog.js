/** agent/sl-prog.js — buy one darkweb program (args: name). Run on a purchased server by daemon-lite.
 * @param {NS} ns */
export async function main(ns) { ns.writePort(21, JSON.stringify({ op: String(ns.args[0]), ok: !!ns.singularity.purchaseProgram(String(ns.args[0])) })); }
