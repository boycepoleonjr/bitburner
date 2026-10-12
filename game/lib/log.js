/**
 * lib/log.js — leveled logging for the daemon + a rolling event file.
 *
 * - Everything goes to the script log (open with: tail daemon.js).
 * - Events (roots, switches, prep changes, errors) are also appended to data/events.txt
 *   and optionally echoed to the terminal.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/** @param {number} ms */
export function stamp(ms = Date.now()) {
  const d = new Date(ms);
  return d.toTimeString().slice(0, 8);
}

/**
 * @param {NS} ns
 * @param {import("lib/config.js").Config} cfg
 */
export function makeLogger(ns, cfg) {
  const max = LEVELS[cfg.log.level] ?? LEVELS.info;
  const emit = (lvl, tag, msg) => {
    if (LEVELS[lvl] > max) return;
    ns.print(`${stamp()} ${lvl.toUpperCase().padEnd(5)} [${tag}] ${msg}`);
  };
  /** Important, persisted event. */
  const event = (tag, msg, lvl = "info") => {
    emit(lvl, tag, msg);
    appendEvent(ns, cfg, `${stamp()} [${tag}] ${msg}`);
    if (cfg.log.terminalEvents && LEVELS[lvl] <= LEVELS.info) ns.tprint(`[daemon/${tag}] ${msg}`);
  };
  return {
    error: (tag, msg) => event(tag, msg, "error"),
    warn: (tag, msg) => emit("warn", tag, msg),
    info: (tag, msg) => emit("info", tag, msg),
    debug: (tag, msg) => emit("debug", tag, msg),
    event,
  };
}

/** @param {NS} ns */
function appendEvent(ns, cfg, line) {
  const file = cfg.log.eventFile;
  const lines = (ns.read(file) || "").split("\n").filter(Boolean);
  lines.push(line);
  ns.write(file, lines.slice(-cfg.log.eventMax).join("\n") + "\n", "w");
}

/** Compact number formatting that works in v3 (ns.format.*). */
export function money(ns, n) {
  return "$" + ns.format.number(n, 2);
}
export function num(ns, n) {
  return ns.format.number(n, 2);
}
export function dur(ns, ms) {
  return ns.format.time(ms);
}
export function pct(ns, x) {
  return ns.format.percent(x, 1);
}
