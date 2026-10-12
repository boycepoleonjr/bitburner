const FLAGS = [
  ["faction", "CyberSec"],
  ["currentRep", 4553],
  ["repRate", 0.969],
  ["refresh", 1000],
  ["mult", 1.9],
];

const DATA = {
  CyberSec: [
    { name: "Neurotrainer I", rep: 1000, price: 4_000_000, prereq: [] },
    { name: "Synaptic Enhancement Implant", rep: 2000, price: 7_500_000, prereq: [] },
    { name: "BitWire", rep: 3750, price: 10_000_000, prereq: [] },
    { name: "Cranial Signal Processors - Gen I", rep: 10000, price: 70_000_000, prereq: [] },
    { name: "Cranial Signal Processors - Gen II", rep: 18750, price: 125_000_000, prereq: ["Cranial Signal Processors - Gen I", "Neurotrainer I"] },
  ],
};

export function autocomplete(data, args) {
  data.flags(FLAGS);
  return Object.keys(DATA);
}

/** @param {NS} ns **/
export async function main(ns) {
  const flags = ns.flags(FLAGS);
  const faction = String(flags.faction || "CyberSec");
  const repRate = Number(flags.repRate) || 0;
  const refresh = Math.max(250, Number(flags.refresh) || 1000);
  const mult = Number(flags.mult) || 1.9;
  const startRep = Number(flags.currentRep) || 0;

  const rows = DATA[faction];
  if (!rows) return ns.tprint(`Unknown faction: ${faction}`);

  ns.disableLog("ALL");
  ns.tail();
  try { ns.ui.setTailTitle(`Aug Plan - ${faction}`); } catch {}

  const start = Date.now();

  while (true) {
    const elapsed = (Date.now() - start) / 1000;
    const rep = startRep + elapsed * repRate;
    const money = ns.getPlayer().money;

    ns.clearLog();
    try { ns.ui.setTailTitle(`Aug Plan - ${faction}`); } catch {}

    const unlocked = rows.filter(a => a.rep <= rep);
    const next = rows.find(a => a.rep > rep);
    const allEta = ns.format.time((Math.max(0, maxRep(rows) - rep) / Math.max(repRate, 1e-9)) * 1000);

    const validUnlockedOrder = orderForPurchase(unlocked);
    const validAllOrder = orderForPurchase(rows);

    const unlockedQueued = queuedCost(validUnlockedOrder, mult);
    const allQueued = queuedCost(validAllOrder, mult);

    ns.print(`${faction}`);
    ns.print(`Rep ${ns.format.number(rep, 2)} @ ${ns.format.number(repRate, 3)}/sec`);
    ns.print(`Money ${ns.format.money(money)}`);
    ns.print(`All rep ETA ${allEta}`);
    ns.print("");

    ns.print(`Unlocked now ${unlocked.length}/${rows.length}`);
    ns.print(`Unlocked base ${ns.format.money(sumPrice(validUnlockedOrder))}`);
    ns.print(`Unlocked queued ${ns.format.money(unlockedQueued.total)}`);
    ns.print(`Can buy unlocked set now: ${money >= unlockedQueued.total ? "YES" : "NO"}`);
    ns.print("");

    if (next) {
      const eta = ns.format.time((Math.max(0, next.rep - rep) / Math.max(repRate, 1e-9)) * 1000);
      ns.print(`Next unlock: ${next.name} in ${eta}`);
    } else {
      ns.print(`All listed augs unlocked`);
    }

    ns.print(`Full set queued cost: ${ns.format.money(allQueued.total)}`);
    ns.print(`Can buy full set now: ${money >= allQueued.total ? "YES" : "NO"}`);
    ns.print("");

    ns.print(`[Install now path]`);
    if (validUnlockedOrder.length === 0) {
      ns.print(`- No useful batch yet`);
    } else {
      ns.print(`- Buy now: ${validUnlockedOrder.map(x => short(x.name)).join(", ")}`);
      ns.print(`- Cost now: ${ns.format.money(unlockedQueued.total)}`);
      ns.print(`- After install, remaining CyberSec grind to full unlock: ${allEta}`);
    }

    ns.print("");
    ns.print(`[Wait path]`);
    ns.print(`- Wait until all rep unlocks`);
    ns.print(`- Then buy order: ${validAllOrder.map(x => short(x.name)).join(", ")}`);
    ns.print(`- Total queued cost then: ${ns.format.money(allQueued.total)}`);

    ns.print("");
    ns.print(`[Per-aug]`);
    for (const a of rows) {
      const missing = Math.max(0, a.rep - rep);
      const eta = missing <= 0 ? "now" : ns.format.time((missing / Math.max(repRate, 1e-9)) * 1000);
      ns.print(
        `${a.rep <= rep ? "[OK]" : "[--]"} ${a.name} | rep ${ns.format.number(a.rep, 2)} | eta ${eta} | base ${ns.format.money(a.price)}`
      );
    }

    await ns.sleep(refresh);
  }
}

function maxRep(rows) {
  return rows.reduce((m, x) => Math.max(m, x.rep), 0);
}

function sumPrice(rows) {
  return rows.reduce((s, x) => s + x.price, 0);
}

function queuedCost(rows, mult) {
  let total = 0;
  for (let i = 0; i < rows.length; i++) total += rows[i].price * Math.pow(mult, i);
  return { total };
}

function orderForPurchase(rows) {
  const byName = new Map(rows.map(x => [x.name, x]));
  const added = new Set();
  const out = [];

  function add(name) {
    if (added.has(name)) return;
    const aug = byName.get(name);
    if (!aug) return;
    for (const p of aug.prereq) add(p);
    added.add(name);
    out.push(aug);
  }

  const sorted = [...rows].sort((a, b) => b.price - a.price);
  for (const aug of sorted) add(aug.name);
  return out;
}

function short(name) {
  return name
    .replace("Cranial Signal Processors - ", "CSP ")
    .replace("Synaptic Enhancement Implant", "SEI");
}