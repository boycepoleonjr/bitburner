/** agent/tele-launch.js — start agent/telemetry.js on home if it fits, else on the rooted server with the most free RAM.
 * Never uses pserv-sing: daemon-lite keeps it free for its one-shot Singularity scripts.
 * No-op if telemetry is already running anywhere. Writes the chosen host to /data/telemetry-host.txt.
 * @param {NS} ns */
export async function main(ns) {
  const S = "agent/telemetry.js";
  const need = ns.getScriptRam(S, "home");
  const seen = new Set(["home"]), q = ["home"], hosts = [];
  while (q.length) { const h = q.shift(); hosts.push(h); for (const n of ns.scan(h)) if (!seen.has(n)) { seen.add(n); q.push(n); } }
  for (const h of hosts) if (ns.ps(h).some((p) => p.filename === S)) { ns.tprint(`telemetry already running on ${h}`); ns.write("/data/telemetry-host.txt", h, "w"); return; }
  const free = (h) => ns.getServerMaxRam(h) - ns.getServerUsedRam(h);
  // home needs room for this launcher to exit too, so compare against current free (launcher RAM is released after exit).
  let target = free("home") >= need ? "home" : null;
  if (!target) {
    const cands = hosts.filter((h) => h !== "home" && h !== "pserv-sing" && ns.hasRootAccess(h) && free(h) >= need).sort((a, b) => free(b) - free(a));
    target = cands[0] || null;
  }
  if (!target) { ns.tprint(`telemetry: no host with ${need}GB free`); return; }
  if (target !== "home") ns.scp(S, target, "home");
  const pid = ns.exec(S, target, 1, ...ns.args);
  ns.write("/data/telemetry-host.txt", target, "w");
  ns.tprint(pid ? `telemetry started on ${target} (pid ${pid}, ${need}GB)` : `telemetry exec failed on ${target}`);
}
