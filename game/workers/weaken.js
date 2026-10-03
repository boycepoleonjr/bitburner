/**
 * workers/weaken.js — one-shot weaken worker (exits after one call).
 * args: [target, additionalMsec, tag]
 * tag only keeps process args unique; it is not read.
 * @param {NS} ns
 */
export async function main(ns) {
  const target = String(ns.args[0]);
  const delay = Math.max(0, Number(ns.args[1]) || 0);
  await ns.weaken(target, { additionalMsec: delay });
}
