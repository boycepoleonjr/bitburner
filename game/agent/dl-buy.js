/** agent/dl-buy.js — one-shot purchased-server op for daemon-lite (keeps the cloud API's RAM out of the daemon).
 * args: ["buy", name, ram] | ["up", host, ram] | ["quote"]. Result on port 22.
 * quote: this BitNode's server limit and the price of every power-of-two size (BN9 has no cloud servers, BN10 15 at
 * 5x; the price is also softcapped above 64GB, so it is not a flat $/GB).
 * @param {NS} ns */
export async function main(ns) {
  const [mode, name, ram] = [String(ns.args[0]), String(ns.args[1]), Number(ns.args[2])];
  if (mode === "quote") {
    const costs = {};
    for (let r = 8; r <= ns.cloud.getRamLimit(); r *= 2) costs[r] = ns.cloud.getServerCost(r);
    ns.writePort(22, JSON.stringify({ op: "quote", ok: true, limit: ns.cloud.getServerLimit(), costs }));
    return;
  }
  const ok = mode === "buy" ? !!ns.cloud.purchaseServer(name, ram) : !!ns.cloud.upgradeServer(name, ram);
  ns.writePort(22, JSON.stringify({ op: mode, name, ram, ok }));
}
