/**
 * tools/kill-workers.js — clean network reset.
 *   run tools/kill-workers.js                 kill daemon workers everywhere
 *   run tools/kill-workers.js --target n00dles  only workers hitting that target
 *   run tools/kill-workers.js --all           kill EVERY script on non-home servers (legacy cleanup)
 *   run tools/kill-workers.js --daemon        also stop daemon.js
 *   run tools/kill-workers.js --dry           preview only
 * @param {NS} ns
 */
import { loadConfig } from "lib/config.js";
import { scanNetwork } from "lib/network.js";

/** @param {NS} ns */
export async function main(ns) {
  const flags = ns.flags([["target", ""], ["all", false], ["daemon", false], ["dry", false]]);
  const { cfg } = loadConfig(ns);
  const workerFiles = new Set(Object.values(cfg.workers));
  if (flags.daemon && !flags.dry) ns.scriptKill("daemon.js", "home");
  let killed = 0;
  for (const s of scanNetwork(ns).values()) {
    if (!s.rooted) continue;
    for (const p of ns.ps(s.host)) {
      const isWorker = workerFiles.has(p.filename);
      const match = flags.all ? !s.isHome || isWorker : isWorker && (!flags.target || p.args[0] === flags.target);
      if (!match || p.filename === ns.getScriptName()) continue;
      if (flags.dry || ns.kill(p.pid)) killed++;
    }
  }
  ns.tprint(`${flags.dry ? "[dry] would kill" : "killed"} ${killed} processes${flags.daemon ? " (+ daemon.js)" : ""}`);
}
