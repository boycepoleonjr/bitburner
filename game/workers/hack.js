/**
 * workers/hack.js — one-shot hack worker (exits after one call).
 * args: [target, additionalMsec, tag, incomePort]
 * tag only keeps process args unique; it is not read.
 * @param {NS} ns
 */
export async function main(ns) {
  const target = String(ns.args[0]);
  const delay = Math.max(0, Number(ns.args[1]) || 0);
  const port = Number(ns.args[3]) || 0;
  const stolen = await ns.hack(target, { additionalMsec: delay });
  if (port > 0 && stolen > 0) ns.tryWritePort(port, `${target}|${stolen}`);
}
