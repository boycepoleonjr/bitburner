/** agent/sl-backdoor.js — backdoor the faction servers (CyberSec, NiteSec, The Black Hand, BitRunners) once rooted and
 * hackable. Run on pserv-sing by daemon-lite while autopilot can't run. Result on port 21: {op, ok, done, pending}.
 * @param {NS} ns */
const FS = ["CSEC", "avmnite-02h", "I.I.I.I", "run4theh111z"];
export async function main(ns) {
  const S = ns.singularity, done = [], pending = [];
  const path = (t) => { const prev = { home: null }, q = ["home"]; while (q.length) { const h = q.shift(); if (h === t) break; for (const n of ns.scan(h)) if (!(n in prev)) { prev[n] = h; q.push(n); } } const p = []; for (let h = t; h && h !== "home"; h = prev[h]) p.unshift(h); return p; };
  for (const h of FS) {
    if (!ns.serverExists(h)) continue;
    const s = ns.getServer(h);
    if (s.backdoorInstalled) continue;
    if (!s.hasAdminRights || s.requiredHackingSkill > ns.getHackingLevel()) { pending.push(h); continue; }
    S.connect("home");
    if (!path(h).every((n) => S.connect(n))) { pending.push(h); continue; }
    try { await S.installBackdoor(); done.push(h); } catch { pending.push(h); }
  }
  S.connect("home");
  ns.writePort(21, JSON.stringify({ op: "backdoor", ok: true, done, pending }));
}
