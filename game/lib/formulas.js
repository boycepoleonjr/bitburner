/**
 * lib/formulas.js — Formulas.exe integration.
 *
 * When Formulas.exe is on home (and config.formulas.enabled), scoring and thread math use
 * ns.formulas.hacking.* against a hypothetical "prepped" server (min security, max money)
 * instead of scaling current values. Callers fall back to estimates when this returns null.
 * ns.formulas.* costs 0 GB RAM.
 */

/**
 * @param {NS} ns
 * @param {import("lib/config.js").Config} cfg
 * @returns {{player: Player}|null}
 */
export function formulasCtx(ns, cfg) {
  if (!cfg.formulas.enabled || !ns.fileExists("Formulas.exe", "home")) return null;
  return { player: ns.getPlayer() };
}

/**
 * Copy of a getServer() object with overrides (never mutates the original).
 * @param {Server} raw
 * @param {{sec?: number, money?: number}} o
 */
export function hypo(raw, o = {}) {
  const s = { ...raw };
  if (o.sec !== undefined) s.hackDifficulty = o.sec;
  if (o.money !== undefined) s.moneyAvailable = o.money;
  return s;
}
