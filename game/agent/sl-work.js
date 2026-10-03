/** agent/sl-work.js — bootstrap faction work while autopilot can't run. Run on pserv-sing by daemon-lite.
 * Joins invites (city factions only if in joinCity), then works for the joined faction ranked highest in
 * factionPriority (hacking contracts, else field work). args: [JSON {prio, joinCity}]. Result on port 21.
 * @param {NS} ns */
const CITY = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];
export async function main(ns) {
  const S = ns.singularity;
  let o = {}; try { o = JSON.parse(String(ns.args[0] || "{}")); } catch { }
  const prio = o.prio || [], joinCity = o.joinCity || [], joined = [];
  for (const f of S.checkFactionInvitations()) if ((!CITY.includes(f) || joinCity.includes(f)) && S.joinFaction(f)) joined.push(f);
  const rank = (f) => { const i = prio.indexOf(f); return i < 0 ? 999 : i; };
  const best = [...ns.getPlayer().factions].sort((a, b) => rank(a) - rank(b))[0];
  let w = S.getCurrentWork();
  const onBest = w && w.type === "FACTION" && w.factionName === best;
  if (best && !onBest) { if (S.workForFaction(best, "hacking", false) || S.workForFaction(best, "field", false)) w = S.getCurrentWork(); }
  else if (onBest && w.factionWorkType !== "hacking" && S.workForFaction(best, "hacking", false)) w = S.getCurrentWork();
  const work = w && w.type === "FACTION" ? `FACTION:${w.factionName}` : w ? w.type : "idle";
  ns.writePort(21, JSON.stringify({ op: "work", ok: true, work, joined }));
}
