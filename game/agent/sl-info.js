/** agent/sl-info.js — report home upgrade prices on port 21. Run on a purchased server by daemon-lite.
 * @param {NS} ns */
export async function main(ns) {
  const S = ns.singularity;
  ns.writePort(21, JSON.stringify({ op: "info", ram: S.getUpgradeHomeRamCost(), cores: S.getUpgradeHomeCoresCost() }));
}
