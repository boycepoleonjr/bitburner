/** agent/dl-buy.js — one-shot purchased-server op for daemon-lite (keeps the cloud API's RAM out of the daemon).
 * args: ["buy", name, ram] | ["up", host, ram]. Result on port 22.
 * @param {NS} ns */
export async function main(ns) {
  const [mode, name, ram] = [String(ns.args[0]), String(ns.args[1]), Number(ns.args[2])];
  const ok = mode === "buy" ? !!ns.cloud.purchaseServer(name, ram) : !!ns.cloud.upgradeServer(name, ram);
  ns.writePort(22, JSON.stringify({ op: mode, name, ram, ok }));
}
