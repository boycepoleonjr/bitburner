/**
 * tools/backdoor-paths.js — connect paths + readiness for backdoor targets.
 *   run tools/backdoor-paths.js            watched servers (config.hooks.milestones.backdoorWatch)
 *   run tools/backdoor-paths.js CSEC       one server; prints a paste-able terminal command
 * Phase 2: with Singularity (SF4) this can call ns.singularity.connect/installBackdoor directly.
 * @param {NS} ns
 */
import { loadConfig } from "lib/config.js";
import { scanNetwork } from "lib/network.js";

export function autocomplete(data) {
  return data.servers;
}

/** @param {NS} ns */
export async function main(ns) {
  const { cfg } = loadConfig(ns);
  const map = scanNetwork(ns);
  const hack = ns.getHackingLevel();
  const list = ns.args.length ? ns.args.map(String) : cfg.hooks.milestones.backdoorWatch;
  for (const host of list) {
    const s = map.get(host);
    if (!s) { ns.tprint(`${host}: not found on network`); continue; }
    const state = s.backdoor ? "BACKDOORED" : !s.rooted ? `needs root (${s.portsReq} ports)` : s.reqHack > hack ? `needs hack ${s.reqHack}` : "READY";
    const cmd = ["home", ...s.path].map((h) => `connect ${h}`).join("; ").replace("connect home", "home") + "; backdoor";
    ns.tprint(`${host.padEnd(14)} ${state.padEnd(20)} ${cmd}`);
  }
}
