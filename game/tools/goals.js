/**
 * tools/goals.js — progress toward the end goal (destroy BitNode 1) and the achievements the
 * automation can reach. Read-only.
 * Usage: run tools/goals.js
 * @param {NS} ns
 */
import { loadConfig } from "lib/config.js";
import { scanNetwork } from "lib/network.js";

/** @param {NS} ns */
export async function main(ns) {
  const { cfg } = loadConfig(ns);
  const f = (n) => ns.format.number(n, 2);
  const p = ns.getPlayer();
  const hack = ns.getHackingLevel();
  const map = scanNetwork(ns);
  const home = map.get("home");
  const src = ns.getMoneySources();
  const procs = [...map.values()].filter((s) => s.rooted).reduce((n, s) => n + ns.ps(s.host).length, 0);
  const hn = ns.hacknet;
  let maxedNode = false;
  for (let i = 0; i < hn.numNodes(); i++) {
    if (!isFinite(hn.getLevelUpgradeCost(i, 1)) && !isFinite(hn.getRamUpgradeCost(i, 1)) && !isFinite(hn.getCoreUpgradeCost(i, 1))) maxedNode = true;
  }
  let stocks = null;
  try { stocks = JSON.parse(ns.read("data/stocks.txt") || "null"); } catch { /* none yet */ }
  const d = cfg.hooks.milestones.daedalus;
  const wd = map.get("w0r1d_d43m0n");
  const bd = (h) => { const s = map.get(h); return !s ? "not found" : s.backdoor ? "done" : !s.rooted ? `needs ${s.portsReq} ports` : s.reqHack > hack ? `needs hack ${s.reqHack}` : "ready"; };
  const mark = (ok) => (ok ? "[x]" : "[ ]");
  let done = [];
  try { done = JSON.parse(ns.read("data/achievements-done.txt") || "[]"); } catch { /* none */ }
  const stockNet = src.sinceStart.stock + (stocks?.holdings ?? 0); // purchases count as negative until sold

  const out = [
    "END GOAL — destroy BitNode 1 (backdoor w0r1d_d43m0n)",
    `  ${mark(p.factions.includes("Daedalus"))} join Daedalus: hack ${hack}/${d.hack}, money $${f(p.money)}/$${f(d.money)}, ${d.augs} installed augs (check Augmentations tab)`,
    `  ${mark(!!wd)} w0r1d_d43m0n visible (appears after installing The Red Pill)${wd ? ` — needs hack ${wd.reqHack}, ${wd.backdoor ? "BACKDOORED" : wd.rooted ? "rooted" : "not rooted"}` : ""}`,
    "",
    "ACHIEVEMENTS THE AUTOMATION DRIVES",
    `  ${mark(p.factions.includes("BitRunners"))} run4theh111z — backdoor: ${bd("run4theh111z")}, then join BitRunners`,
    `  ${mark(map.get("powerhouse-fitness")?.backdoor)} Discount! — powerhouse-fitness backdoor: ${bd("powerhouse-fitness")}`,
    `  ${mark(procs >= 1000 || done.includes("Need more real life ram"))} Need more real life ram — ${procs}/1000 scripts running now (tools/burst.js)`,
    `  ${mark(done.includes("Big trouble"))} Big trouble — drain a server to $0 (tools/drain.js)`,
    `  ${mark(hn.numNodes() >= 30)} Big network — ${hn.numNodes()}/30 hacknet nodes`,
    `  ${mark(maxedNode)} That's the limit — a fully upgraded hacknet node`,
    `  ${mark(ns.stock.has4SData())} 4S — 4S market data${stocks ? ` | holdings $${f(stocks.holdings)}, realized $${f(stocks.realized)}, ${stocks.trades} trades` : ""}`,
    `  ${mark(stockNet >= 1e18)} Wolf of wall street — stock net (incl. open positions) $${f(stockNet)}/$1q`,
    `  ${mark(p.money >= 1e18)} Here comes the money! — $${f(p.money)}/$1Q on hand`,
    `  ${mark(hack >= 100_000)} Power Overwhelming — hack ${hack}/100k (XP mode: ${cfg.xp.enabled ? `on → ${cfg.xp.target}` : "off"})`,
    `  ${mark(home.maxRam >= cfg.hooks.milestones.homeMaxRamGb)} Download more ram — home ${ns.format.ram(home.maxRam)} (buy at City → Alpha Enterprises)`,
    `  ${mark(home.cores >= cfg.hooks.milestones.homeMaxCores)} Download more cores? — home ${home.cores}/${cfg.hooks.milestones.homeMaxCores} cores`,
    "",
    `income since install: hacking $${f(src.sinceInstall.hacking)} | hacknet $${f(src.sinceInstall.hacknet)} | stocks $${f(src.sinceInstall.stock)}`,
  ];
  ns.tprint("\n" + out.join("\n"));
}
