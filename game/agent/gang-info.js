/** agent/gang-info.js — one-shot: caches the gang's static game data in data/gang-tasks.txt so agent/gang.js (which must stay
 * small) never pays for getTaskStats / getEquipmentType / getEquipmentStats. Run by gang.js when the cache is missing or
 * belongs to the other gang type. Contract: {v:1, isHacking, tasks:{name:getTaskStats}, equip:{name:{type, stats}}}.
 * @param {NS} ns */
export const TASKS_FILE = "data/gang-tasks.txt";
export async function main(ns) {
  const G = ns.gang;
  const isHacking = !!G.getGangInformation().isHacking;
  const tasks = {}, equip = {};
  for (const n of G.getTaskNames()) tasks[n] = G.getTaskStats(n);
  for (const n of G.getEquipmentNames()) equip[n] = { type: G.getEquipmentType(n), stats: G.getEquipmentStats(n) };
  ns.write(TASKS_FILE, JSON.stringify({ v: 1, isHacking, tasks, equip }), "w");
}
