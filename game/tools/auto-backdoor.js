/**
 * tools/auto-backdoor.js — backdoor a server by typing into the Terminal (no Singularity needed):
 *   home; connect <hop>; …; backdoor   → waits for backdoorInstalled → home
 * Only runs while the Terminal is open and idle; otherwise toasts and exits (the daemon retries).
 * Usage: run tools/auto-backdoor.js <host> <hop1> <hop2> … <host>
 * @param {NS} ns
 */
import { terminalInput, terminalIdle, typeCommand } from "lib/terminal.js";

/** @param {NS} ns */
export async function main(ns) {
  const [host, ...path] = ns.args.map(String);
  if (!host || !path.length) return ns.tprint("usage: run tools/auto-backdoor.js <host> <hop1> … <host>");
  if (ns.getServer(host).backdoorInstalled) return;
  if (!terminalInput() || !terminalIdle()) {
    ns.toast(`Daemon wants to backdoor ${host} — open the Terminal (empty input) to let it`, "info", 10_000);
    return;
  }
  const chain = ["home", ...path.map((h) => `connect ${h}`), "backdoor"].join("; ");
  if (!(await typeCommand(ns, chain))) return;

  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline && !ns.getServer(host).backdoorInstalled) await ns.sleep(1000);
  const ok = ns.getServer(host).backdoorInstalled;

  // go back home as soon as the Terminal is usable again
  for (let i = 0; i < 60; i++) {
    if (terminalIdle()) { await typeCommand(ns, "home"); break; }
    await ns.sleep(1000);
  }
  ns.toast(ok ? `Backdoor installed on ${host}` : `Backdoor on ${host} did not finish — daemon will retry`, ok ? "success" : "warning", 10_000);
}
