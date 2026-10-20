/**
 * lib/gangformulas.js — exact port of bitburner-src Gang/formulas/formulas.ts. PURE (no ns, no imports).
 * ns.formulas.gang needs Formulas.exe ($5b), so the math lives here instead (docs/specs/gang.md §4.1).
 *
 * `g` = { respect, wanted (or wantedLevel), territory (0..1) }; `m` = member skills { hack, str, def, dex, agi, cha };
 * `t` = task stats as returned by ns.gang.getTaskStats (baseRespect/baseWanted/baseMoney, *Weight, difficulty, territory).
 * `softcap` = the BitNode's GangSoftcap multiplier (1 in BN2 and the base game).
 * All gains are per game cycle, like the game's own.
 */
const TERR_DEFAULT = { money: 1, respect: 1, wanted: 1 };
const wantedOf = (g) => (g.wanted ?? g.wantedLevel ?? 1);

/** respect / (respect + wanted): multiplies respect and money gain. */
export function wantedPenalty(g) {
  const w = wantedOf(g);
  return g.respect / (g.respect + w);
}

/** Weighted sum of the member's skills for this task, before the difficulty term. */
export function statWeight(m, t) {
  return (t.hackWeight / 100) * m["hack"] + (t.strWeight / 100) * m.str + (t.defWeight / 100) * m.def
    + (t.dexWeight / 100) * m.dex + (t.agiWeight / 100) * m.agi + (t.chaWeight / 100) * m.cha;
}
const terr = (t, k) => (t.territory || TERR_DEFAULT)[k] ?? 1;
const territoryMult = (g, t, k) => Math.max(0.005, Math.pow(g.territory * 100, terr(t, k)) / 100);

export function respectGain(g, m, t, softcap = 1) {
  if (!t.baseRespect) return 0;
  const sw = statWeight(m, t) - 4 * t.difficulty;
  if (sw <= 0) return 0;
  const tm = territoryMult(g, t, "respect");
  const penalty = (0.2 * g.territory + 0.8) * softcap;
  if (Number.isNaN(tm) || tm <= 0) return 0;
  return Math.pow(11 * t.baseRespect * sw * tm * wantedPenalty(g), penalty);
}

export function wantedGain(g, m, t) {
  if (!t.baseWanted) return 0;
  const sw = statWeight(m, t) - 3.5 * t.difficulty;
  if (sw <= 0) return 0;
  const tm = territoryMult(g, t, "wanted");
  if (Number.isNaN(tm) || tm <= 0) return 0;
  if (t.baseWanted < 0) return 0.4 * t.baseWanted * sw * tm;
  return Math.min(100, (7 * t.baseWanted) / Math.pow(3 * sw * tm, 0.8));
}

export function moneyGain(g, m, t, softcap = 1) {
  if (!t.baseMoney) return 0;
  const sw = statWeight(m, t) - 3.2 * t.difficulty;
  if (sw <= 0) return 0;
  const tm = territoryMult(g, t, "money");
  if (Number.isNaN(tm) || tm <= 0) return 0;
  const penalty = (0.2 * g.territory + 0.8) * softcap;
  return Math.pow(5 * t.baseMoney * sw * tm * wantedPenalty(g), penalty);
}

/** Ascension points a stat's experience is worth. */
export const ascensionPointsGain = (exp) => Math.max(exp - 1000, 0);
/** Skill multiplier from accumulated ascension points. */
export const ascensionMult = (points) => Math.max(Math.pow(points / 2000, 0.5), 1);

/** Game constants that other gang code needs (bitburner-src Gang/data/Constants.ts). */
export const GANG = Object.freeze({ maxMembers: 12, freeMembers: 3, recruitBase: 5, respectToRep: 75, installAscensionPenalty: 0.95 });
