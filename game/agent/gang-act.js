/** agent/gang-act.js — one-shot: applies the mutating gang calls that agent/gang.js decided on, so gang.js itself stays
 * under its RAM budget (docs/specs/gang.md §4.3). args: [JSON {create?:faction, recruit?:[name], tasks?:{member:task}, warfare?:bool}].
 * Every call is wrapped; the outcome goes to data/gang-act.txt ({t, results:[{op, ok, err?}]}), which gang.js reads next loop.
 * @param {NS} ns */
export const ACT_FILE = "data/gang-act.txt";
export async function main(ns) {
  let o = {};
  try { o = JSON.parse(String(ns.args[0] || "{}")); } catch { }
  const G = ns.gang, results = [];
  const tryCall = (op, f) => { try { results.push({ op, ok: f() !== false }); } catch (e) { results.push({ op, ok: false, err: String(e).slice(0, 160) }); } };
  if (o.create) tryCall(`create ${o.create}`, () => G.createGang(o.create));
  for (const n of o.recruit || []) tryCall(`recruit ${n}`, () => G.recruitMember(n));
  for (const [m, t] of Object.entries(o.tasks || {})) tryCall(`task ${m}=${t}`, () => G.setMemberTask(m, t));
  if (typeof o.warfare === "boolean") tryCall(`warfare ${o.warfare}`, () => { G.setTerritoryWarfare(o.warfare); return true; });
  ns.write(ACT_FILE, JSON.stringify({ t: Date.now(), results }), "w");
}
