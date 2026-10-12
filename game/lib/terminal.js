/**
 * lib/terminal.js — drive the in-game Terminal from a script (stand-in for Singularity/SF4).
 * Uses `document` (+25 GB RAM), so only short-lived helper scripts import this — never the daemon.
 */

/** @returns {HTMLInputElement|null} */
export function terminalInput() {
  return document.getElementById("terminal-input");
}

/** True when the Terminal screen is open and nothing is typed in it. */
export function terminalIdle() {
  const el = terminalInput();
  return !!el && !el.value;
}

function reactProps(el) {
  return el[Object.keys(el).find((k) => k.startsWith("__reactProps"))];
}

/**
 * Type a command and press Enter. Returns false if the Terminal isn't open.
 * @param {NS} ns
 * @param {string} cmd
 */
export async function typeCommand(ns, cmd) {
  const el = terminalInput();
  if (!el) return false;
  reactProps(el).onChange({ target: { value: cmd } });
  await ns.sleep(50); // let React commit the value before Enter reads it
  const el2 = terminalInput();
  if (!el2) return false;
  reactProps(el2).onKeyDown({ key: "Enter", preventDefault: () => null });
  await ns.sleep(300);
  return true;
}
