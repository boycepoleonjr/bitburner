/** tools/sf-check.js — read-only: BitNode, owned Source-Files, TOR and Singularity access. */
/** @param {NS} ns */
export async function main(ns) {
  const r = ns.getResetInfo();
  const sf = [...r.ownedSF.entries()].map(([n, l]) => `SF${n}.${l}`).join(" ") || "none";
  let sing = "no";
  try { ns.singularity.getDarkwebPrograms(); sing = "yes"; } catch (e) { sing = "no (" + String(e).slice(0, 120) + ")"; }
  ns.tprint(`BitNode ${r.currentNode} | Source-Files: ${sf} | TOR: ${ns.hasTorRouter()} | Singularity usable: ${sing}`);
}
