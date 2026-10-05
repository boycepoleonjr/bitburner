/** agent/sl-work.js — bootstrap faction work while autopilot can't run. Run on pserv-sing by daemon-lite.
 * Joins invites (city factions only if in joinCity), then works for the highest factionPriority faction that is not
 * rep-complete (rep < the highest rep requirement of its unowned, non-NeuroFlux augs; Hacknet augs ignored when
 * skipHacknetAugs). Hacking contracts, else field work. args: [JSON {prio, joinCity, skipHacknet}]. Result on port 21.
 * @param {NS} ns */
const CITY = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];
export async function main(ns) {
  const S = ns.singularity;
  let o = {}; try { o = JSON.parse(String(ns.args[0] || "{}")); } catch { }
  const prio = o.prio || [], joinCity = o.joinCity || [], joined = [];
  for (const f of S.checkFactionInvitations()) if ((!CITY.includes(f) || joinCity.includes(f)) && S.joinFaction(f)) joined.push(f);
  const have = new Set(S.getOwnedAugmentations(true)); // installed + queued
  const gap = (f) => {
    const reqs = S.getAugmentationsFromFaction(f).filter((a) => !have.has(a) && !a.startsWith("NeuroFlux") && !(o.skipHacknet && /hacknet/i.test(a))).map((a) => S.getAugmentationRepReq(a));
    return Math.max(0, ...reqs) - S.getFactionRep(f);
  };
  const rank = (f) => { const i = prio.indexOf(f); return i < 0 ? 999 : i; };
  const facs = [...ns.getPlayer().factions].sort((a, b) => rank(a) - rank(b));
  const best = facs.find((f) => gap(f) > 0) || facs[0]; // all rep-complete: keep the top one (NeuroFlux rep)
  let w = S.getCurrentWork();
  const onBest = w && w.type === "FACTION" && w.factionName === best;
  if (best && !onBest) { if (S.workForFaction(best, "hacking", false) || S.workForFaction(best, "field", false)) w = S.getCurrentWork(); }
  else if (onBest && w.factionWorkType !== "hacking" && S.workForFaction(best, "hacking", false)) w = S.getCurrentWork();
  const work = w && w.type === "FACTION" ? `FACTION:${w.factionName}` : w ? w.type : "idle";
  ns.writePort(21, JSON.stringify({ op: "work", ok: true, work, joined }));
}
