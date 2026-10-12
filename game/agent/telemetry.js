/** agent/telemetry.js — lean 60s telemetry logger for the prediction experiment.
 * Runs on home or any rooted server. Appends JSONL to /data/telemetry.txt on its host and,
 * when not on home, scp's the file to home so the external analyzer can read it.
 * Also keeps a bounded ring for the dashboard (never touches telemetry.txt's format):
 *   data/telemetry-latest.txt  the full latest record (one line, overwritten)
 *   data/telemetry-ring.txt    compact records for the last ui.historyMinutes (overwritten from memory each sample)
 * args: [intervalSec=60]
 * @param {NS} ns */
import { compactRec, pushRing, ringMaxLines, serializeRing } from "lib/telemetry-ring.js";
import { tailLines, parseJsonl } from "lib/data-sources.js";
import { readSettings } from "lib/settings.js";

export const RING = "/data/telemetry-ring.txt", LATEST = "/data/telemetry-latest.txt", SETTINGS = "/data/settings.txt";

/** Seed the ring at startup: the existing ring file, else the tail of telemetry.txt (read once, never again). */
export function seedRing(ringText, telemetryText, maxLines) {
  const own = parseJsonl(tailLines(ringText, maxLines)).rows;
  if (own.length) return own;
  return parseJsonl(tailLines(telemetryText, maxLines)).rows.map(compactRec).filter(Boolean);
}

export async function main(ns) {
  ns.disableLog("ALL");
  const interval = (Number(ns.args[0]) || 60) * 1000;
  const FILE = "/data/telemetry.txt";
  const host = ns.getHostname();
  // Continue history: pull home's copy first so the scp back never truncates it.
  if (host !== "home" && ns.fileExists(FILE, "home")) ns.scp(FILE, host, "home");
  const SK = ["hacking", "strength", "defense", "dexterity", "agility", "charisma"];
  if (host !== "home") for (const f of [RING, SETTINGS]) if (ns.fileExists(f, "home")) ns.scp(f, host, "home");
  const histMin = () => Number(readSettings(ns)["ui.historyMinutes"]) || 360;
  let ring = seedRing(ns.read(RING), ns.read(FILE), ringMaxLines(histMin(), interval / 1000));

  const netRam = () => {
    const seen = new Set(["home"]), q = ["home"];
    let max = 0, used = 0, rooted = 0;
    while (q.length) {
      const h = q.shift();
      for (const n of ns.scan(h)) if (!seen.has(n)) { seen.add(n); q.push(n); }
      if (ns.hasRootAccess(h)) { rooted++; max += ns.getServerMaxRam(h); used += ns.getServerUsedRam(h); }
    }
    return { max, used, rooted, servers: seen.size };
  };

  while (true) {
    try {
      const p = ns.getPlayer();
      const ri = ns.getResetInfo();
      const rep = {};
      for (const f of p.factions) { try { rep[f] = Math.round(ns.singularity.getFactionRep(f)); } catch { /* no SF4 */ } }
      let work = null;
      try { const w = ns.singularity.getCurrentWork(); if (w) work = { type: w.type, name: w.classType || w.programName || w.crimeType || w.factionName || w.companyName || null }; } catch { /* no SF4 */ }
      const rec = {
        t: Date.now(), host, bn: ri.currentNode, sinceAug: Date.now() - ri.lastAugReset, lastAug: ri.lastAugReset,
        money: p.money, income: ns.getTotalScriptIncome()[0], scriptExp: ns.getTotalScriptExpGain(),
        lvl: Object.fromEntries(SK.map((s) => [s, p.skills[s]])),
        exp: Object.fromEntries(SK.map((s) => [s, p.exp[s]])),
        mult: { hacking: p.mults.hacking, hacking_exp: p.mults.hacking_exp, faction_rep: p.mults.faction_rep, hacking_money: p.mults.hacking_money, hacking_speed: p.mults.hacking_speed, hacking_chance: p.mults.hacking_chance, hacking_grow: p.mults.hacking_grow },
        // regime markers for the predictor: what changed the growth curve (work switch, RAM, network size) is already in work/homeRam/net; add daemon worker count
        workers: ns.ps("home").filter((x) => x.filename.startsWith("workers/")).reduce((a, x) => a + x.threads, 0),
        rep, work, homeRam: ns.getServerMaxRam("home"), net: netRam(),
        // autopilot's planned purchases (money thresholds) so the predictor can subtract them ahead of time
        plan: (() => { try { const st = JSON.parse(ns.read("/data/autopilot-status.txt") || "{}"); return Date.now() - st.t < 120000 ? st.plan || null : null; } catch { return null; } })(),
        // money ledger since install (non-zero categories): positives = earned, negatives = spent
        src: (() => { const s = ns.getMoneySources().sinceInstall, o = {}; for (const [k, v] of Object.entries(s)) if (v && k !== "total") o[k] = Math.round(v); return o; })(),
      };
      ns.write(FILE, JSON.stringify(rec) + "\n", "a");
      ns.write(LATEST, JSON.stringify(rec), "w");
      if (host !== "home" && ns.fileExists(SETTINGS, "home")) ns.scp(SETTINGS, host, "home");
      ring = pushRing(ring, compactRec(rec), { maxLines: ringMaxLines(histMin(), interval / 1000), maxAgeMs: histMin() * 60000, now: rec.t });
      ns.write(RING, serializeRing(ring), "w");
      if (host !== "home") ns.scp([FILE, LATEST, RING], "home", host);
    } catch (e) { ns.print("telemetry error: " + e); }
    await ns.sleep(interval);
  }
}
