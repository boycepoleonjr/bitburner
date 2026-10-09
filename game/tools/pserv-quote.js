/**
 * tools/pserv-quote.js — read-only: purchased-server fleet, limit, and price per RAM size.
 * Usage: run tools/pserv-quote.js
 * @param {NS} ns
 */
export async function main(ns) {
  const f = (n) => ns.format.number(n, 2);
  const money = ns.getServerMoneyAvailable("home");
  const names = ns.cloud.getServerNames();
  const limit = ns.cloud.getServerLimit();
  const maxRam = ns.cloud.getRamLimit();
  const free = limit - names.length;
  const out = [`money $${f(money)} | owned ${names.length}/${limit} | max RAM per server ${ns.format.ram(maxRam)}`];
  for (const h of names) out.push(`  owned ${h}: ${ns.format.ram(ns.getServerMaxRam(h))}`);
  for (let r = 8; r <= maxRam; r *= 2) {
    const c = ns.cloud.getServerCost(r);
    out.push(`  ${ns.format.ram(r).padStart(10)}  $${f(c).padStart(9)} each | ×${free} = $${f(c * free).padStart(9)}${c * free <= money ? "  affordable" : ""}`);
  }
  ns.tprint("\n" + out.join("\n"));
}
