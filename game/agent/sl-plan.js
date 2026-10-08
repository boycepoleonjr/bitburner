/** agent/sl-plan.js — one-shot: snapshot augs/factions/BitNode (all the 16x Singularity calls live here, not in the
 * autopilot), run lib/augplan.js, write /data/aug-plan.txt (contract: docs/specs/aug-planner.md). Started by
 * agent/autopilot.js every few loops when home has free RAM. Read-only: buys nothing, joins nothing.
 * Per-faction rep rates are measured between runs (/data/aug-plan-state.txt).
 * @param {NS} ns */
import { readSettings } from "lib/settings.js";
import { plan, RED_PILL } from "lib/augplan.js";
import { decideNode, parseJson, REQUEST_FILE, ACK_FILE } from "lib/nodectl.js";

export const FACTIONS = ["CyberSec", "Tian Di Hui", "Netburners", "Sector-12", "Chongqing", "New Tokyo", "Ishima", "Aevum", "Volhaven",
  "NiteSec", "The Black Hand", "BitRunners", "ECorp", "MegaCorp", "KuaiGong International", "Four Sigma", "NWO", "Blade Industries",
  "OmniTek Incorporated", "Bachman & Associates", "Clarke Incorporated", "Fulcrum Secret Technologies", "Slum Snakes", "Tetrads",
  "Silhouette", "Speakers for the Dead", "The Dark Army", "The Syndicate", "The Covenant", "Daedalus", "Illuminati"];
const PLAN = "/data/aug-plan.txt", STATE = "/data/aug-plan-state.txt", INSTALLS = "/data/install-log.txt";

/** Recovery heuristic: 25% of the median install cycle (last 5 installs), clamped 15..240 min; 60 with < 2 installs. */
export function recoveryMinutes(installLogText) {
  const cycles = String(installLogText || "").trim().split("\n").slice(-5).map((l) => { try { return JSON.parse(l).sinceAug; } catch { return null; } })
    .filter((x) => typeof x === "number" && x > 0).sort((a, b) => a - b);
  if (cycles.length < 2) return 60;
  const med = cycles[Math.floor(cycles.length / 2)] / 60000;
  return Math.min(240, Math.max(15, med * 0.25));
}

export async function main(ns) {
  const S = ns.singularity, s = readSettings(ns), now = Date.now();
  const p = ns.getPlayer(), joined = p.factions, invites = S.checkFactionInvitations();
  const prev = parseJson(ns.read(STATE)) || { t: 0, rep: {} };
  const dt = (now - (prev.t || 0)) / 1000;
  const factions = {}, augs = {}, rep = {};
  for (const f of FACTIONS) {
    let list; try { list = S.getAugmentationsFromFaction(f); } catch { continue; }
    const isJoined = joined.includes(f), r = isJoined ? S.getFactionRep(f) : 0;
    rep[f] = r;
    const rate = isJoined && prev.rep[f] != null && dt > 0 && dt < 3600 ? Math.max(0, (r - prev.rep[f]) / dt) : 0;
    factions[f] = { joined: isJoined, rep: r, favor: S.getFactionFavor(f), augs: list, repRate: rate };
    for (const a of list) if (!augs[a]) augs[a] = { repReq: S.getAugmentationRepReq(a), price: S.getAugmentationPrice(a), prereqs: S.getAugmentationPrereq(a), mults: S.getAugmentationStats(a) };
  }
  const wdExists = ns.serverExists("w0r1d_d43m0n");
  const installed = S.getOwnedAugmentations(false);
  const reset = ns.getResetInfo();
  const sourceFiles = [...(reset.ownedSF || new Map())].map(([n, lvl]) => ({ n, lvl }));
  const snap = {
    t: now, bn: reset.currentNode, hack: ns.getHackingLevel(), money: ns.getServerMoneyAvailable("home"), income: ns.getTotalScriptIncome()[0],
    mults: { faction_rep: p.mults.faction_rep }, installed, owned: S.getOwnedAugmentations(true), invites, factions, augs,
    bnMults: ns.getBitNodeMultipliers(), favorToDonate: ns.getFavorToDonate(), sourceFiles,
    worldDaemon: { exists: wdExists, req: wdExists ? ns.getServerRequiredHackingLevel("w0r1d_d43m0n") : null, root: wdExists && ns.hasRootAccess("w0r1d_d43m0n") },
    recoveryMin: recoveryMinutes(ns.read(INSTALLS)),
  };
  const ready = snap.worldDaemon.exists && snap.worldDaemon.root && snap.hack >= snap.worldDaemon.req && installed.includes(RED_PILL);
  snap.node = decideNode({ ready, bn: snap.bn, sourceFiles, now, request: parseJson(ns.read(REQUEST_FILE)), ack: parseJson(ns.read(ACK_FILE)) }, s).node;
  const out = plan(snap, s);
  ns.write(PLAN, JSON.stringify(out), "w");
  // Per-BitNode Daedalus requirements for the daemon's RAM manager (lib/ramplan.js daedalusReqs), which can't afford
  // getBitNodeMultipliers itself.
  if (out.daedalus) ns.write("/data/daedalus-req.txt", JSON.stringify({ t: out.t, augs: out.daedalus.augsReq, money: out.daedalus.moneyReq, hack: out.daedalus.hackReq }), "w");
  ns.write(STATE, JSON.stringify({ t: now, rep }), "w");
}
