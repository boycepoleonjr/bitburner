/** agent/post-install.js — run by autopilot via installAugmentations(cb). Brings the whole stack back up.
 * @param {NS} ns */
import { readSettings } from "lib/settings.js";
import { gangPossible } from "lib/gangplan.js";
export async function main(ns) {
  const OVR = "/data/config-overrides.txt";
  try { const c = JSON.parse(ns.read(OVR) || "{}"); c.stocks = { ...(c.stocks || {}), liquidate: false }; ns.write(OVR, JSON.stringify(c), "w"); } catch { }
  const start = (s, ...a) => { if (!ns.isRunning(s, "home", ...a)) ns.run(s, 1, ...a); };
  start("agent/bridge-lite.js");
  await ns.sleep(500);
  // Small home (fresh BitNode without enough RAM for Singularity): daemon-lite bootstraps itself (money, servers, programs,
  // home RAM) and starts autopilot + daemon.js once home is big enough. No manual steps.
  // same threshold as daemon-lite's handoff: between apRam+64 and apRam+dRam+64, daemon.js wouldn't fit and nothing would farm
  const small = ns.getServerMaxRam("home") < ns.getScriptRam("agent/autopilot.js") + ns.getScriptRam("daemon.js") + 64;
  if (small) start("agent/daemon-lite.js"); else start("agent/autopilot.js"); // first: faction work + programs
  start("agent/tele-launch.js");
  start("agent/rpc.js");            // headless bridge (idles until the bb server pushes agent/rpc-config.txt)
  { // the gang survives installs and needs its manager back (docs/specs/gang.md): only when enabled and a gang is possible here
    const ri = ns.getResetInfo();
    if (readSettings(ns)["gang.enabled"] !== false && gangPossible({ bn: ri.currentNode, inGang: ns.gang.inGang(), ownedSF: ri.ownedSF, karma: ns.heart.break() })) start("agent/gang.js");
  }
  await ns.sleep(1000);
  if (!small) start("daemon.js", "--reset");
  ns.write("/data/events.txt", `${new Date().toLocaleTimeString("en-US", { hour12: false })} [post-install] stack restarted\n`, "a");
}
