/**
 * lib/state.js — persisted daemon state (JSON in a .txt file on home).
 *
 * Survives daemon restarts and game reloads. Delete the file (or run daemon.js --reset)
 * to start fresh.
 */

export const STATE_VERSION = 1;

/** @typedef {ReturnType<typeof freshState>} DaemonState */
export function freshState() {
  return {
    version: STATE_VERSION,
    startedAt: Date.now(),
    loops: 0,
    lastLoopAt: 0,
    // targeting
    primary: /** @type {string|null} */ (null),
    previousPrimary: /** @type {string|null} */ (null),
    mode: "idle", // primary's current wave kind: prep-sec | prep-money | farm | busy | idle
    lastSwitchAt: 0,
    lastSwitchReason: "",
    switchCount: 0,
    lastDecision: "",
    challenger: /** @type {{host: string, count: number}|null} */ (null),
    secondaries: /** @type {string[]} */ ([]),
    prep: /** @type {Record<string, string>} */ ({}), // host -> prep status
    // network
    rootedCount: 0,
    knownTargets: /** @type {string[]} */ ([]), // hosts already announced as targets
    openerCount: 0,
    openers: /** @type {string[]} */ ([]),
    serverCount: 0,
    hackLevel: 0,
    formulas: false,
    programs: { lastNag: 0, lastBuyAt: 0, tor: false },
    // capacity
    totalRamGb: 0,
    freeRamGb: 0,
    executorCount: 0,
    // ranking
    top: /** @type {{host: string, score: number, steady: number, status: string, why: string}[]} */ ([]),
    // activity
    waves: /** @type {Record<string, {kind: string, launchedAt: number, endsAt: number, ramGb: number, note: string}>} */ ({}),
    wavesLaunched: 0,
    income: { total: 0, byTarget: /** @type {Record<string, number>} */ ({}), since: Date.now() },
    milestonesSeen: /** @type {string[]} */ ([]),
    warnings: /** @type {string[]} */ ([]),
  };
}

/**
 * @param {NS} ns
 * @param {string} file
 * @returns {DaemonState}
 */
export function loadState(ns, file) {
  const raw = ns.read(file);
  if (!raw) return freshState();
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== STATE_VERSION) return freshState();
    return { ...freshState(), ...parsed };
  } catch {
    return freshState();
  }
}

/** @param {NS} ns */
export function saveState(ns, file, state) {
  ns.write(file, JSON.stringify(state, null, 1), "w");
}
