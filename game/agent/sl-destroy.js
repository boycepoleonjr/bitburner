/** agent/sl-destroy.js — the ONLY script that destroys a BitNode. Started by agent/autopilot.js when lib/nodectl.js says
 * "destroy". args: [id, nextBn]. Re-reads settings, the request and the backup ack right before acting (lib/nodectl.js
 * destroyGate) and aborts on any mismatch, so a late veto (node.autoDestroy=false) always wins.
 * Kept out of the autopilot because destroyW0r1dD43m0n costs 32 GB x16 outside BN4.
 * @param {NS} ns */
import { readSettings } from "lib/settings.js";
import { RED_PILL } from "lib/augplan.js";
import { destroyGate, parseJson, REQUEST_FILE, ACK_FILE } from "lib/nodectl.js";

export async function main(ns) {
  const S = ns.singularity;
  const id = String(ns.args[0] ?? ""), nextBn = Number(ns.args[1]);
  const bn = ns.getResetInfo().currentNode;
  const wd = ns.serverExists("w0r1d_d43m0n");
  const ready = wd && ns.hasRootAccess("w0r1d_d43m0n") && ns.getHackingLevel() >= ns.getServerRequiredHackingLevel("w0r1d_d43m0n")
    && S.getOwnedAugmentations(false).includes(RED_PILL);
  const request = parseJson(ns.read(REQUEST_FILE)), ack = parseJson(ns.read(ACK_FILE));
  const why = destroyGate({ id, nextBn, bn, request, ack, ready }, readSettings(ns));
  const log = (m) => { ns.write("/data/events.txt", `${new Date().toLocaleTimeString("en-US", { hour12: false })} [sl-destroy] ${m}\n`, "a"); ns.write("/data/audit.txt", JSON.stringify({ t: Date.now(), iso: new Date().toISOString(), kind: "destroy", id, bn, nextBn, why: why || "go" }) + "\n", "a"); };
  if (why) { log(`aborted: ${why}`); return; }
  ns.write("/data/agent-log.txt", `[${new Date().toISOString()}] node: destroying BN${bn} -> BN${nextBn} (request ${id}, backup ${ack?.key || "skipped"})\n`, "a");
  log(`destroying BN${bn} -> BN${nextBn}`);
  S.destroyW0r1dD43m0n(nextBn, "agent/post-install.js");
}
