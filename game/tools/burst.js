/**
 * tools/burst.js — briefly run enough scripts to have >= N running at once
 * (achievement "Need more real life ram": 1000 simultaneous scripts).
 * Each extra script is workers/idle.js (1.6 GB) sleeping for --ms.
 * Usage: run tools/burst.js [--count 1000] [--ms 30000]
 * @param {NS} ns
 */
import { loadConfig } from "lib/config.js";
import { scanNetwork, classify, byRole } from "lib/network.js";
import { buildPool } from "lib/deploy.js";

const IDLE = "workers/idle.js";

/** @param {NS} ns */
export async function main(ns) {
  const flags = ns.flags([["count", 1000], ["ms", 30_000]]);
  const { cfg } = loadConfig(ns);
  const map = scanNetwork(ns);
  for (const s of map.values()) classify(s, ns.getHackingLevel(), cfg);
  const running = () => [...map.values()].filter((s) => s.rooted).reduce((n, s) => n + ns.ps(s.host).length, 0);

  const need = Number(flags.count) - running() + 5;
  if (need <= 0) return ns.tprint(`already ${running()} scripts running`);
  const ram = ns.getScriptRam(IDLE, "home");
  const pool = buildPool(ns, byRole(map, "executor"), { ...cfg, homeReserveGb: 0 }); // may use the home reserve
  const capacity = pool.reduce((n, p) => n + Math.floor(p.free / ram), 0);
  if (capacity < need) return ns.tprint(`need ${need} × ${ram}GB = ${ns.format.ram(need * ram)}, only room for ${capacity} — free RAM first`);

  let launched = 0;
  for (const p of pool) {
    if (!p.isHome) ns.scp(IDLE, p.host, "home");
    while (launched < need && p.free >= ram) {
      if (ns.exec(IDLE, p.host, { threads: 1, temporary: true }, Number(flags.ms), launched) === 0) break;
      p.free -= ram;
      launched++;
    }
    if (launched >= need) break;
  }
  const now = running();
  if (now >= Number(flags.count)) markDone(ns, "Need more real life ram");
  ns.tprint(`launched ${launched} idle scripts → ${now} running now (they exit in ${ns.format.time(Number(flags.ms))})`);
}

/** Remember a one-off achievement in data/achievements-done.txt (read by tools/goals.js). */
function markDone(ns, name) {
  let done = [];
  try { done = JSON.parse(ns.read("data/achievements-done.txt") || "[]"); } catch { /* fresh */ }
  if (!done.includes(name)) ns.write("data/achievements-done.txt", JSON.stringify([...done, name]), "w");
}
