/**
 * tools/terminal-buy.js — types `buy <program>` into the in-game Terminal for each argument.
 * Needed because buying darkweb programs from a script requires Singularity (Source-File 4).
 * Only works while the Terminal screen is open and its input is empty (never clobbers your typing);
 * otherwise it shows a toast and exits — the daemon retries later.
 * Usage: run tools/terminal-buy.js BruteSSH.exe FTPCrack.exe
 * @param {NS} ns
 */
import { terminalInput, terminalIdle, typeCommand } from "lib/terminal.js";

/** @param {NS} ns */
export async function main(ns) {
  const progs = ns.args.map(String);
  if (!progs.length) return;
  if (!terminalInput()) {
    ns.toast(`Daemon wants to buy ${progs.join(", ")} — open the Terminal (or type: buy ${progs[0]})`, "info", 10_000);
    return;
  }
  if (!terminalIdle()) {
    ns.toast(`Daemon will buy ${progs.join(", ")} once the Terminal input is empty`, "info", 8_000);
    return;
  }
  for (const p of progs) if (!(await typeCommand(ns, `buy ${p}`))) break;
}
