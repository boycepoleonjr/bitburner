/** agent/sl-crime.js — one-shot Singularity step of the combat-gang bootstrap (docs/specs/gang.md §4.4). Run on pserv-sing by
 * daemon-lite (or on home by the autopilot) while data/gang-status.txt says bootstrapAction is "gym" or "crime".
 *   gym:   any combat stat < 30 -> Powerhouse Gym (Sector-12) on the lowest stat
 *   crime: all >= 30 -> Mug until karma <= -9 (Slum Snakes also wants $1m)
 * It also joins pending non-city faction invites (Slum Snakes, NiteSec, ...): sl-work normally does, but is skipped while this runs.
 * Idempotent: it only (re)starts the activity when the player is not already doing it. Result on port 21 (op "crime").
 * @param {NS} ns */
const CITIES = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];
const MIN = 30, KARMA = -9, GYM = "Powerhouse Gym", CITY = "Sector-12";
const STATS = [["strength", "str"], ["defense", "def"], ["dexterity", "dex"], ["agility", "agi"]];
export async function main(ns) {
  const S = ns.singularity;
  const out = { op: "crime", ok: false, mode: "idle" };
  try {
    const joined = [];
    for (const f of S.checkFactionInvitations()) if (!CITIES.includes(f) && S.joinFaction(f)) joined.push(f);
    out.joined = joined;
    const p = ns.getPlayer(), sk = p.skills;
    const low = STATS.map(([full, key]) => ({ full, key, v: sk[full] })).sort((a, b) => a.v - b.v)[0];
    const w = S.getCurrentWork();
    if (low.v < MIN) {
      out.mode = "gym";
      if (p.city !== CITY && !S.travelToCity(CITY)) { out.err = `cannot travel to ${CITY}`; ns.writePort(21, JSON.stringify(out)); return; }
      if (!(w && w.type === "CLASS" && new RegExp(low.key, "i").test(String(w.classType)))) S.gymWorkout(GYM, low.key, false); // GymType is "str"|"def"|"dex"|"agi"
      out.ok = true; out.stat = low.full;
    } else if (ns.heart.break() > KARMA) {
      out.mode = "crime";
      if (!(w && w.type === "CRIME" && w.crimeType === "Mug")) S.commitCrime("Mug", false);
      out.ok = true;
    } else out.mode = "done";
  } catch (e) { out.err = String(e).slice(0, 160); }
  ns.writePort(21, JSON.stringify(out));
}
