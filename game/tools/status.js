/**
 * tools/status.js — what the daemon believes right now (reads persisted state + live census).
 * Usage: run tools/status.js [--events 15]
 * @param {NS} ns
 */
import { loadConfig } from "lib/config.js";
import { loadState } from "lib/state.js";
import { scanNetwork } from "lib/network.js";
import { census } from "lib/deploy.js";

/** @param {NS} ns */
export async function main(ns) {
  const flags = ns.flags([["events", 12]]);
  const { cfg } = loadConfig(ns);
  const st = loadState(ns, cfg.files.state);
  const running = ns.scriptRunning("daemon.js", "home");
  const age = st.lastLoopAt ? Math.round((Date.now() - st.lastLoopAt) / 1000) : -1;
  const f = (n) => ns.format.number(n, 2);
  const mins = Math.max(1 / 60, (Date.now() - st.income.since) / 60_000);

  const out = [];
  out.push(`daemon ${running ? "RUNNING" : "STOPPED"} | loop ${st.loops} (last ${age}s ago) | hack ${st.hackLevel}`);
  out.push(`primary: ${st.primary} [${st.mode}]  previous: ${st.previousPrimary ?? "-"}  switches: ${st.switchCount}`);
  out.push(`last switch: ${st.lastSwitchAt ? ns.format.time(Date.now() - st.lastSwitchAt) + " ago" : "-"} — ${st.lastSwitchReason || "-"}`);
  out.push(`decision: ${st.lastDecision}`);
  if (st.challenger) out.push(`challenger: ${st.challenger.host} (${st.challenger.count}/${cfg.switching.confirmLoops})`);
  out.push(`secondaries: ${st.secondaries.join(", ") || "-"}`);
  out.push(`rooted ${st.rootedCount}/${st.serverCount - 1} | openers ${st.openerCount} (${st.openers.join(", ") || "none"}) | executors ${st.executorCount} | formulas ${st.formulas ? "ON" : "off"}`);
  const missing = cfg.programs.list.filter((p) => !ns.fileExists(p.file, "home")).map((p) => p.file);
  out.push(`TOR ${ns.hasTorRouter() ? "yes" : "NO — buy at City → Alpha Enterprises"} | programs missing: ${missing.join(", ") || "none"}`);
  out.push(`worker RAM: ${f(st.freeRamGb)} GB free of ${f(st.totalRamGb)} GB (home reserve ${cfg.homeReserveGb} GB) | XP: ${st.xp?.target ? `${st.xp.target} × ${st.xp.threads} weaken threads` : "idle"}`);
  if (st.income.hackingSinceInstall !== undefined) out.push(`money since install: hacking $${f(st.income.hackingSinceInstall)} | hacknet $${f(st.income.hacknetSinceInstall)} | stocks $${f(st.income.stockSinceInstall)}`);
  out.push(`income tracked: $${f(st.income.total)} ($${f(st.income.total / mins)}/min) — ${Object.entries(st.income.byTarget).map(([k, v]) => `${k} $${f(v)}`).join(", ") || "none yet"}`);
  out.push(`prep: ${Object.entries(st.prep).map(([k, v]) => `${k}=${v}`).join("  ") || "-"}`);
  out.push("top candidates:");
  st.top.forEach((c, i) => out.push(`  #${i + 1} ${c.host.padEnd(18)} score ${f(c.score).padStart(9)} steady ${f(c.steady).padStart(9)} ${c.status.padEnd(10)} ${c.why}`));

  const hosts = [...scanNetwork(ns).values()].filter((s) => s.rooted).map((s) => s.host);
  const load = census(ns, hosts, cfg);
  out.push("live workers by target:");
  for (const [t, l] of load) out.push(`  ${t.padEnd(18)} procs ${String(l.procs).padStart(4)}  H ${l.threads.hack}  G ${l.threads.grow}  W ${l.threads.weaken}  ~${f(l.ramGb)} GB` + (st.waves[t] ? `  ${st.waves[t].kind}${st.waves[t].batches > 1 ? ` ×${st.waves[t].batches}` : ""} lands in ${Math.max(0, Math.round((st.waves[t].endsAt - Date.now()) / 1000))}s` : ""));
  if (!load.size) out.push("  (none)");

  const ev = (ns.read(cfg.log.eventFile) || "").split("\n").filter(Boolean).slice(-flags.events);
  out.push(`last ${ev.length} events:`);
  ev.forEach((e) => out.push("  " + e));
  ns.tprint("\n" + out.join("\n"));
}
