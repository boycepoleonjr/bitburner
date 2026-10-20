/** agent/gang-shop.js — one-shot: the 4 GB gang calls (ascendMember, purchaseEquipment), kept out of agent/gang.js so it fits
 * its RAM budget. args: [JSON {ascend?:name, buy?:[{member, item}]}]; the plan (budgets, reserve) was made by gang.js with
 * lib/gangplan.js. Ascends first, then buys. Outcome -> data/gang-shop.txt ({t, ascended:name|null, bought:n, errors:[s]}).
 * @param {NS} ns */
export const SHOP_FILE = "data/gang-shop.txt";
export async function main(ns) {
  let o = {};
  try { o = JSON.parse(String(ns.args[0] || "{}")); } catch { }
  const G = ns.gang, errors = [];
  let ascended = null, bought = 0;
  if (o.ascend) { try { if (G.ascendMember(o.ascend)) ascended = o.ascend; else errors.push(`ascend ${o.ascend} refused`); } catch (e) { errors.push(`ascend ${o.ascend}: ${String(e).slice(0, 120)}`); } }
  for (const b of o.buy || []) { try { if (G.purchaseEquipment(b.member, b.item)) bought++; else errors.push(`buy ${b.item} for ${b.member} refused`); } catch (e) { errors.push(`buy ${b.item}: ${String(e).slice(0, 120)}`); } }
  ns.write(SHOP_FILE, JSON.stringify({ t: Date.now(), ascended, bought, errors }), "w");
}
