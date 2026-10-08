/**
 * tools/buy-pservers.js — buy purchased servers in bulk (the daemon picks them up as executors).
 * Usage: run tools/buy-pservers.js --ram 4096 --count 25 [--prefix pserv] [--dry]
 * @param {NS} ns
 */
export async function main(ns) {
  const flags = ns.flags([["ram", 4096], ["count", 25], ["prefix", "pserv"], ["dry", false]]);
  const f = (n) => ns.format.number(n, 2);
  const ram = Number(flags.ram);
  const cost = ns.cloud.getServerCost(ram);
  const owned = ns.cloud.getServerNames();
  const want = Math.max(0, Math.min(Number(flags.count), ns.cloud.getServerLimit() - owned.length));
  const money = ns.getServerMoneyAvailable("home");
  ns.tprint(`${flags.dry ? "[dry] " : ""}${want} × ${ns.format.ram(ram)} at $${f(cost)} each = $${f(cost * want)} (money $${f(money)}, owned ${owned.length})`);
  if (flags.dry || want === 0) return;

  const bought = [];
  for (let i = 0; bought.length < want && i < 1000; i++) {
    const name = `${flags.prefix}-${i}`;
    if (ns.serverExists(name)) continue;
    if (ns.getServerMoneyAvailable("home") < cost) {
      ns.tprint(`stopped: not enough money for the next server`);
      break;
    }
    const host = ns.cloud.purchaseServer(name, ram);
    if (!host) {
      ns.tprint(`stopped: purchase of ${name} failed`);
      break;
    }
    bought.push(host);
  }
  ns.tprint(`bought ${bought.length}: ${bought.join(", ")} | money left $${f(ns.getServerMoneyAvailable("home"))}`);
}
