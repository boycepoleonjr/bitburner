// Fake Bitburner ns with a gang, for agent/gang*.js tests. Task and equipment tables are the real game data
// (test/fixtures/gang-data.json, generated from bitburner-src Gang/data/tasks.ts and upgrades.ts).
//   const g = fakeGang({ bn: 2, joined: ["Slum Snakes"] });  g.ns.gang.createGang(...)
// g.calls = every ns.gang call in order; g.throwOn = Set of gang function names that throw; g.MUTATING = names that change state.
import fs from "node:fs";

export const DATA = JSON.parse(fs.readFileSync(new URL("../fixtures/gang-data.json", import.meta.url), "utf8"));
export const MUTATING = new Set(["createGang", "recruitMember", "setMemberTask", "setTerritoryWarfare", "purchaseEquipment", "ascendMember"]);
const COMBAT = ["Slum Snakes", "Tetrads", "The Syndicate", "The Dark Army", "Speakers for the Dead"];
const NAMES = [...COMBAT, "NiteSec", "The Black Hand"];
const SK = ["hack", "str", "def", "dex", "agi", "cha"];
const ascMult = (pts) => Math.max(Math.sqrt(pts / 2000), 1);

/**
 * @param {{bn?:number, joined?:string[], money?:number, karma?:number, skills?:Object, files?:Object, scripts?:Object, ownedSF?:number[],
 *          gang?:{faction:string, respect?:number, wanted?:number, territory?:number, power?:number, members?:Object[]}}} o
 *   scripts: {"agent/x.js": mainFn} that ns.run can start (each runs against the same fake game).
 */
export function fakeGang(o = {}) {
  const g = {
    files: { ...(o.files || {}) }, calls: [], throwOn: new Set(), runs: [], procs: new Map(), pid: 100, bn: o.bn ?? 2, karma: o.karma ?? 0, money: o.money ?? 1e9,
    joined: [...(o.joined || [])], skills: { strength: 1, defense: 1, dexterity: 1, agility: 1, hacking: 1, charisma: 1, ...(o.skills || {}) }, city: "Sector-12",
    ownedSF: new Map((o.ownedSF || []).map((n) => [n, 1])), gang: null, others: {}, now: Date.UTC(2026, 9, 17, 17), scripts: o.scripts || {}, work: null, log: [],
  };
  for (const n of NAMES) g.others[n] = { power: 1, territory: 1 / 7 };
  g.member = (name, over = {}) => {
    const m = { name, task: "Unassigned", earnedRespect: 0, upgrades: [], augmentations: [] };
    for (const k of SK) Object.assign(m, { [k]: 1, [`${k}_exp`]: 0, [`${k}_mult`]: 1, [`${k}_asc_mult`]: 1, [`${k}_asc_points`]: 0 });
    return Object.assign(m, over);
  };
  g.startGang = (faction, extra = {}) => {
    const hacking = faction === "NiteSec" || faction === "The Black Hand";
    g.gang = { faction, isHacking: hacking, respect: 1, wanted: 1, engaged: false, members: [], clash: 0, ...extra };
    g.gang.members = (extra.members || []).map((m) => (m.task !== undefined || m.hack !== undefined ? g.member(m.name, m) : g.member(m)));
    if (extra.power != null) g.others[faction].power = extra.power;
    if (extra.territory != null) g.others[faction].territory = extra.territory;
  };
  if (o.gang) g.startGang(o.gang.faction, o.gang);

  const need = (fn) => { if (!g.gang) throw new Error(`${fn}: Must have joined gang`); };
  const mem = (name) => { const m = g.gang.members.find((x) => x.name === name); if (!m) throw new Error(`Invalid gang member: '${name}'`); return m; };
  const recruitNeeds = (n) => (n < 3 ? 0 : 5 ** (n - 2));
  const api = {
    createGang: (f) => { if (!(g.bn === 2 || g.karma <= -54000) || g.gang || !NAMES.includes(f) || !g.joined.includes(f)) return false; g.startGang(f); return true; },
    inGang: () => !!g.gang,
    getMemberNames: () => { need("getMemberNames"); return g.gang.members.map((m) => m.name); },
    getGangInformation: () => {
      need("getGangInformation");
      const x = g.gang, t = g.others[x.faction];
      return { faction: x.faction, isHacking: x.isHacking, moneyGainRate: x.moneyGainRate ?? 0, power: t.power, respect: x.respect, respectGainRate: x.respectGainRate ?? 0,
        respectForNextRecruit: recruitNeeds(x.members.length) || 0, territory: t.territory, territoryClashChance: x.clash, wantedLevel: x.wanted, wantedLevelGainRate: 0,
        territoryWarfareEngaged: x.engaged, wantedPenalty: x.respect / (x.respect + x.wanted), equipmentCostMult: 1 };
    },
    getAllGangInformation: () => { need("getAllGangInformation"); return JSON.parse(JSON.stringify(g.others)); },
    getMemberInformation: (n) => { need("getMemberInformation"); return JSON.parse(JSON.stringify(mem(n))); },
    recruitMember: (n) => { need("recruitMember"); const x = g.gang; if (x.members.length >= 12 || x.respect < recruitNeeds(x.members.length) || x.members.some((m) => m.name === n) || !n) return false; x.members.push(g.member(n)); return true; },
    getTaskNames: () => { need("getTaskNames"); return Object.values(DATA.tasks).filter((t) => t.name === "Unassigned" || (g.gang.isHacking ? t.isHacking : t.isCombat)).map((t) => t.name); },
    getTaskStats: (n) => { need("getTaskStats"); if (!DATA.tasks[n]) throw new Error(`Invalid task: '${n}'`); return JSON.parse(JSON.stringify(DATA.tasks[n])); },
    setMemberTask: (n, t) => { need("setMemberTask"); const m = mem(n); if (!DATA.tasks[t]) { m.task = "Unassigned"; return false; } m.task = t; return true; },
    getEquipmentNames: () => { need("getEquipmentNames"); return Object.keys(DATA.equip); },
    getEquipmentCost: (n) => { need("getEquipmentCost"); return DATA.equip[n] ? DATA.equip[n].cost : Infinity; },
    getEquipmentType: (n) => { need("getEquipmentType"); return DATA.equip[n]?.type ?? ""; },
    getEquipmentStats: (n) => { need("getEquipmentStats"); return { ...DATA.equip[n].stats }; },
    purchaseEquipment: (mn, n) => {
      need("purchaseEquipment"); const m = mem(mn), e = DATA.equip[n];
      if (!e || m.upgrades.includes(n) || m.augmentations.includes(n) || g.money < e.cost) return false;
      g.money -= e.cost; (e.type === "Augmentation" ? m.augmentations : m.upgrades).push(n); g.log.push(["buy", mn, n, e.cost]); return true;
    },
    ascendMember: (n) => {
      need("ascendMember"); const m = mem(n);
      if (!SK.some((k) => m[`${k}_exp`] > 1000)) return undefined;
      for (const k of SK) { m[`${k}_asc_points`] += Math.max(0, m[`${k}_exp`] - 1000); m[`${k}_asc_mult`] = ascMult(m[`${k}_asc_points`]); m[`${k}_exp`] = 0; }
      m.upgrades = []; g.gang.respect = Math.max(1, g.gang.respect - m.earnedRespect); const r = m.earnedRespect; m.earnedRespect = 0; return { respect: r };
    },
    setTerritoryWarfare: (b) => { need("setTerritoryWarfare"); g.gang.engaged = !!b; },
    nextUpdate: async () => { need("nextUpdate"); g.now += 2000; g.ticks = (g.ticks || 0) + 1; return 2000; },
  };
  const gang = {};
  for (const [name, f] of Object.entries(api)) gang[name] = (...a) => { g.calls.push(name); if (g.throwOn.has(name)) throw new Error(`${name}: injected failure`); return f(...a); };

  const make = (script, args) => {
    const ns = {
      args, pid: ++g.pid, gang, g,
      disableLog() {}, print() {}, tprint() {},
      read: (f) => g.files[String(f).replace(/^\//, "")] ?? "",
      write: (f, d, m = "a") => { const k = String(f).replace(/^\//, ""); g.files[k] = m === "w" ? String(d) : (g.files[k] ?? "") + String(d); },
      fileExists: (f) => String(f).replace(/^\//, "") in g.files,
      getScriptName: () => script,
      sleep: async () => { await new Promise((r) => setImmediate(r)); },
      getResetInfo: () => ({ currentNode: g.bn, ownedSF: g.ownedSF, ownedAugs: new Map(), lastAugReset: g.now, lastNodeReset: g.now }),
      getPlayer: () => ({ factions: [...g.joined], skills: { ...g.skills }, money: g.money, city: g.city, mults: { faction_rep: 1 } }),
      heart: { break: () => g.karma },
      getServerMoneyAvailable: () => g.money,
      getScriptRam: () => 4, getServerMaxRam: () => 64, getServerUsedRam: () => 0,
      isRunning: (pidOrName) => (typeof pidOrName === "number" ? g.procs.has(pidOrName) : [...g.procs.values()].some((p) => p.script === pidOrName)),
      getRunningScript: (name) => { const p = [...g.procs.values()].find((x) => x.script === name); return p ? { pid: p.pid, filename: p.script } : null; },
      run: (s, _t, ...a) => {
        g.runs.push([s, ...a]);
        const main = g.scripts[s];
        if (!main || g.noRam) return 0;
        const child = make(s, a);
        const p = { pid: child.pid, script: s };
        g.procs.set(p.pid, p);
        main(child).catch((e) => { g.log.push(["crash", s, String(e)]); }).finally(() => g.procs.delete(p.pid));
        return p.pid;
      },
      ps: () => [...g.procs.values()].map((p) => ({ pid: p.pid, filename: p.script })),
      singularity: null,
    };
    return ns;
  };
  g.make = make;
  g.ns = make("agent/gang.js", []);
  return g;
}

/** Settings file text for the given overrides (data/settings.txt) so readSettings(ns) sees them. */
export function settingsFile(values) {
  return JSON.stringify({ version: 1, rev: 1, updatedAt: 1, updatedBy: "test", values });
}
