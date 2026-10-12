// Fixtures for the dashboard tests: shapes copied from the live BN5 game (2026-10-08) plus the sibling PRs' file contracts.
export const NOW = 1791461400000;
const MIN = 60000;

export const latest = {
  t: NOW - 20000, host: "home", bn: 5, sinceAug: 167349005, lastAug: 1791294029289, money: 150914165267833470, income: 1495711124607.049, scriptExp: 970527166.8,
  lvl: { hacking: 12799, strength: 147, defense: 222, dexterity: 89, agility: 72, charisma: 10 }, exp: { hacking: 162414634258099 },
  mult: { hacking: 15.11 }, workers: 54502, rep: { Daedalus: 23818344, "The Black Hand": 385875244 }, work: { type: "FACTION", name: "The Black Hand" },
  homeRam: 67108864, net: { max: 67112156, used: 96886.8, rooted: 71, servers: 71 },
};

/** 30 one-minute samples; Black Hand rep grows 2.4k/s, money grows 1.5t/s. */
export const ring = Array.from({ length: 30 }, (_, i) => {
  const t = NOW - (29 - i) * MIN - 20000;
  return { t, bn: 5, money: 1e17 + i * 60 * 1.5e12, income: 1.5e12, lvl: { hacking: 12770 + i }, rep: { "The Black Hand": 385e6 - (29 - i) * 60 * 2400 },
    work: { type: "FACTION", name: "The Black Hand" }, net: { max: 67112156, used: 90000 + i * 100 } };
});

export const autopilot = {
  t: NOW - 6000, v: 1, money: 150952368158829920, hack: 12799, work: "FACTION:The Black Hand",
  flags: ["w0r1d_d43m0n READY — agent decides BitNode destruction"], next: [{ kind: "money", target: 314061084759997700, label: "home RAM" }],
  augs: { buyable: 0, top: [], redPill: false },
};

export const ramStatus = {
  t: NOW - 5000, enabled: true, phase: "late", progress: 1, weight: 1, repActive: true, hackNeed: false, usableGb: 92e6,
  alloc: { money: 2e6, share: 80e6, xp: 10e6 }, running: { money: 1.9e6, share: 79e6, xp: 9.5e6 }, util: { instant: 0.97, ema5: 0.95 },
  activeTargets: [{ host: "ecorp", kind: "farm", batches: 40, ramGb: 22028 }, { host: "megacorp", kind: "farm", batches: 40, ramGb: 22026 }],
  cloud: { count: 25, limit: 25, minGb: 1048576, maxGb: 1048576, spentThisLoop: 0 }, sharePower: 1.42, reasons: ["surplus to share (rep active)"],
};

export const augPlan = {
  t: NOW - 7000, bn: 5, goal: "destroy", phase: "late", progress: 1,
  daedalus: { augsReq: 30, augsInstalled: 69, moneyReq: 100e9, hackReq: 2500, met: true },
  redPill: { owned: true, repReq: 2.5e6, rep: 23818344 }, worldDaemon: { req: 4500, hack: 12799, ready: true },
  steps: [
    { order: 1, aug: "NeuroFlux Governor", faction: "The Black Hand", repReq: 797e6, price: 2.39e12, prereqs: [], status: "rep", etaMin: 2900, why: "only aug left; NeuroFlux last" },
  ],
  install: { policy: "eta", queued: 0, next: { etaMin: 2900, reason: "NeuroFlux batch" } },
  node: { ready: true, autoSelect: false, autoDestroy: false, recommended: { bn: 2, why: "gang income" }, pending: null },
};

export const pred2Tail = [
  { type: "p", id: "a1", made: NOW - 30 * MIN, spec: { kind: "money", target: 3.1e17 }, model: "planned", eta: NOW + 30 * 3600e3, lo: NOW + 29 * 3600e3, hi: NOW + 31 * 3600e3 },
  { type: "p", id: "a2", made: NOW - 10 * MIN, spec: { kind: "level", skill: "hacking", target: 5000 }, model: "exp", eta: NOW + 90 * MIN },
];
