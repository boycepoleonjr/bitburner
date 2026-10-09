/**
 * lib/rooting.js — port-opener detection and idempotent rooting.
 *
 * Only the openers a server still needs are run (skips ports already open),
 * then NUKE when openPortCount >= numOpenPortsRequired.
 */

export const OPENERS = [
  { file: "BruteSSH.exe", flag: "sshPortOpen" },
  { file: "FTPCrack.exe", flag: "ftpPortOpen" },
  { file: "relaySMTP.exe", flag: "smtpPortOpen" },
  { file: "HTTPWorm.exe", flag: "httpPortOpen" },
  { file: "SQLInject.exe", flag: "sqlPortOpen" },
];

/**
 * @param {NS} ns
 * @returns {string[]} opener program names owned on home
 */
export function ownedOpeners(ns) {
  return OPENERS.filter((o) => ns.fileExists(o.file, "home")).map((o) => o.file);
}

/**
 * Explicit calls (not ns[name]) so the static RAM calculator sees them.
 * @param {NS} ns
 */
function runOpener(ns, file, host) {
  switch (file) {
    case "BruteSSH.exe": return ns.brutessh(host);
    case "FTPCrack.exe": return ns.ftpcrack(host);
    case "relaySMTP.exe": return ns.relaysmtp(host);
    case "HTTPWorm.exe": return ns.httpworm(host);
    case "SQLInject.exe": return ns.sqlinject(host);
  }
  return false;
}

/**
 * Why a server can/can't be rooted right now.
 * @param {import("lib/network.js").ServerInfo} s
 * @param {string[]} openers
 * @param {number} hackLevel
 * @param {import("lib/config.js").Config} cfg
 * @returns {{eligible: boolean, reason: string}}
 */
export function rootEligibility(s, openers, hackLevel, cfg) {
  if (s.rooted) return { eligible: false, reason: "already rooted" };
  if (s.portsReq > openers.length) return { eligible: false, reason: `needs ${s.portsReq} ports, own ${openers.length} openers` };
  if (cfg.rooting.requireHackLevel && s.reqHack > hackLevel) return { eligible: false, reason: `needs hack ${s.reqHack}` };
  return { eligible: true, reason: "eligible" };
}

/**
 * Attempt to root. Safe to call repeatedly.
 * @param {NS} ns
 * @param {import("lib/network.js").ServerInfo} s
 * @param {string[]} openers
 * @returns {{rooted: boolean, used: string[], error?: string}}
 */
export function tryRoot(ns, s, openers) {
  if (s.rooted) return { rooted: true, used: [] };
  const used = [];
  try {
    let open = s.portsOpen;
    for (const o of OPENERS) {
      if (open >= s.portsReq) break;
      if (!openers.includes(o.file)) continue;
      if (s.raw && s.raw[o.flag]) continue; // already open
      if (runOpener(ns, o.file, s.host)) { used.push(o.file); open++; }
    }
    ns.nuke(s.host);
  } catch (e) {
    return { rooted: ns.hasRootAccess(s.host), used, error: String(e) };
  }
  return { rooted: ns.hasRootAccess(s.host), used };
}
