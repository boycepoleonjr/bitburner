// Shared planner/ordering scenarios built from the real BN5 snapshot (test/fixtures/bn5-snapshot.json).
// Used by test/augplan.js (golden), test/augorder.js (equivalence) and the fixture generator. Deterministic: snap.t is fixed.
import fs from "node:fs";
import { defaults } from "../../game/lib/settings-schema.js";

export const BN5 = JSON.parse(fs.readFileSync(new URL("../fixtures/bn5-snapshot.json", import.meta.url), "utf8"));
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const S = (o = {}) => ({ ...defaults(), ...o });
export const T0 = Date.UTC(2026, 10, 2, 12);
export const NFG = "NeuroFlux Governor", RED_PILL = "The Red Pill";

/** Same aug data, fresh BitNode: nothing installed, small rep in joined factions, Daedalus not joined. */
export function fresh({ rep = 50_000, favor = 0, repRate = 50, money = 5e9, income = 2e7, hack = 900 } = {}) {
  const f = clone(BN5);
  Object.assign(f, { t: T0, installed: [], owned: [], hack, money, income, invites: [], worldDaemon: { exists: false, req: null, root: false } });
  for (const x of Object.values(f.factions)) Object.assign(x, { rep: x.joined ? rep : 0, favor: x.joined ? favor : 0, repRate: x.joined ? repRate : 0 });
  f.factions.Daedalus.joined = false;
  return f;
}
/** BN2 after the gang exists: Slum Snakes is the gang faction and (BN2 only) sells The Red Pill. */
export function gangSnap({ gangRep = 5e5 } = {}) {
  const f = clone(BN5);
  Object.assign(f, { t: T0, bn: 2, installed: [], owned: [], hack: 200, money: 5e9, income: 2e6, invites: [], worldDaemon: { exists: false, req: null, root: false } });
  for (const x of Object.values(f.factions)) Object.assign(x, { joined: false, rep: 0, favor: 0, repRate: 0 });
  f.factions["Slum Snakes"] = { joined: true, rep: gangRep, favor: 0, repRate: 100, augs: [...new Set([...f.factions["Slum Snakes"].augs, RED_PILL, NFG])] };
  f.gangFaction = "Slum Snakes";
  return f;
}
/** Everything the golden plan test covers: [name, snapshot, settings]. */
export function goldenCases() {
  const owned = fresh();
  { const some = Object.values(owned.factions).filter((x) => x.joined).flatMap((x) => x.augs).filter((a) => a !== NFG && a !== RED_PILL).slice(0, 8);
    owned.installed = some.slice(0, 5); owned.owned = some; }
  return [
    ["bn5-real", { ...clone(BN5), t: T0, income: 1.49e12 }, S()],
    ["fresh-default", fresh(), S()],
    ["fresh-rich", fresh({ rep: 5e6, money: 1e13, income: 1e9 }), S()],
    ["fresh-donate", fresh({ rep: 1e5, favor: 200, money: 1e12, income: 1e8 }), S()],
    ["fresh-complete-poor", fresh(), S({ "augs.planner.goal": "complete" })],
    ["fresh-complete-rich", fresh({ rep: 5e6, money: 1e13, income: 1e9 }), S({ "augs.planner.goal": "complete" })],
    ["fresh-partly-owned", owned, S({ "augs.installPolicy": "count" })],
    ["gang-bn2", gangSnap(), S()],
  ];
}
