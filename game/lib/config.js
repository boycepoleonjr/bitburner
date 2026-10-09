/**
 * lib/config.js — every tunable for the daemon lives here.
 *
 * Runtime overrides: put a partial JSON object in data/config-overrides.txt, e.g.
 *   {"homeReserveGb": 128, "switching": {"cooldownMs": 600000}}
 * The daemon re-reads it every loop, so most tuning needs no restart.
 */

/** @typedef {typeof DEFAULTS} Config */
export const DEFAULTS = {
  /** Daemon loop interval (ms). */
  loopMs: 5_000,

  /** RAM on home the daemon never touches (GB) — room for manual/utility scripts. */
  homeReserveGb: 512,
  /** Hosts with less max RAM than this are not used as executors. */
  minHostRamGb: 2,
  /** Use hacknet servers (hacknet-server-*) as executors. Off: their RAM usually earns more as hashes. */
  useHacknetRam: false,

  workers: {
    hack: "workers/hack.js",
    grow: "workers/grow.js",
    weaken: "workers/weaken.js",
  },
  /** Port hack workers report stolen money on (income tracking). 0 = off. */
  incomePort: 7,

  rooting: {
    /** NUKE only needs open ports, not hack level. false = root anything port-eligible (more RAM, earlier). */
    requireHackLevel: false,
  },

  /** Target scoring. See README.txt "Scoring" for the formula. */
  score: {
    wMoney: 1.0,       // exponent on max money
    wChance: 1.0,      // exponent on hack chance (estimated at min security)
    wTime: 1.0,        // exponent on weaken time (at min security) — divides
    wGrowth: 0.5,      // exponent on normalized growth
    growthCap: 100,    // growth values above this count as "full"
    levelSoftCap: 0.5, // req/hackLevel above this starts a penalty (volatile chance + slow times)
    levelPenalty: 1.0, // exponent of that penalty
    readinessWeight: 0.35, // 0..1 — how much an unprepped challenger is discounted
    minChance: 0.25,   // ignore targets whose estimated min-sec chance is below this
  },

  prep: {
    /** Security above min that still counts as "prepped" (absolute points). */
    secTolerance: 1.0,
    /** Money/max ratio that counts as "prepped". */
    moneyThreshold: 0.9,
  },

  /** Formulas.exe: exact chance/time/thread math when the program is owned. */
  formulas: {
    enabled: true,
    /** Grow safety margin when threads come from formulas (exact math needs less slack). */
    growSafety: 1.05,
  },

  farm: {
    /** Fraction of max money stolen per wave (scaled down automatically if RAM is short). */
    hackFraction: 0.5,
    /** Gap between landings in a batch (ms): H → W → G → W. */
    stepMs: 200,
    /** Batches per farm wave (1 = no batching). All launch together, offset by batchSpacingMs. */
    maxBatches: 40,
    /** Offset between consecutive batches (must be >= 4 × stepMs so batches never interleave). */
    batchSpacingMs: 800,
    growSafety: 1.1,
    weakenSafety: 1.1,
  },

  switching: {
    /** Challenger must beat the incumbent's steady-state score by this fraction (0.25 = +25%). */
    minImprovement: 0.25,
    /** Minimum time between non-emergency switches (ms). */
    cooldownMs: 5 * 60_000,
    /** Challenger must be #1 for this many consecutive loops (hysteresis). */
    confirmLoops: 3,
    /** Ratio at which cooldown/confirmation are skipped (emergency override). */
    emergencyRatio: 3.0,
    /** Kill in-flight workers of the old primary on switch. */
    killOldOnSwitch: true,
  },

  secondary: {
    /** Extra targets that get leftover RAM (prep-ahead + light farming). 0 = single-target mode. */
    slots: 6,
    /** A current secondary is kept while it stays inside the top (slots + this) candidates. */
    stickiness: 2,
    /** If an idle primary can get < this fraction of its ideal wave, kill secondary workers to free RAM. 0 = off. */
    preemptBelow: 0.5,
  },

  log: {
    /** error | warn | info | debug */
    level: "info",
    /** Echo important events (roots, switches, errors) to the terminal. */
    terminalEvents: true,
    /** Print a status block in the daemon log every N loops. */
    statusEveryLoops: 12,
    eventFile: "data/events.txt",
    eventMax: 300,
  },

  files: {
    state: "data/daemon-state.txt",
    overrides: "data/config-overrides.txt",
  },

  /**
   * Darkweb programs (lib/programs.js). Without Singularity the daemon can't buy TOR itself:
   * it reminds you, then buys programs by typing `buy X` into the Terminal (Terminal must be open).
   * Prices are the darkweb list prices; edit if your BitNode differs.
   */
  programs: {
    enabled: true,
    torCost: 200_000,
    nagEveryMs: 120_000,
    retryMs: 60_000,
    maxSpendFraction: 0.9,
    autoBuyViaTerminal: true,
    buyScript: "tools/terminal-buy.js",
    list: [
      { file: "BruteSSH.exe", price: 500e3 },
      { file: "FTPCrack.exe", price: 1.5e6 },
      { file: "relaySMTP.exe", price: 5e6 },
      { file: "HTTPWorm.exe", price: 30e6 },
      { file: "SQLInject.exe", price: 250e6 },
      { file: "Formulas.exe", price: 5e9 },
    ],
  },

  /** XP mode: RAM left after all waves weakens xp.target for hacking exp (toward 2500+ hacking). */
  xp: {
    enabled: true,
    target: "joesguns",
    /** Share of the leftover RAM XP may take. */
    leftoverFraction: 1.0,
    minThreads: 50,
  },

  /** tools/stocks.js tunables (see that file). */
  stocks: {
    accessSpendFraction: 0.25,
    buyAbove: 0.6,
    sellBelow: 0.5,
    maxPortfolioFraction: 0.5,
    minTrade: 50e6,
    /** true = sell everything and stop buying (set via overrides before installing augmentations). */
    liquidate: false,
  },

  hooks: {
    /** Automatic fleet growth (off: use tools/buy-pservers.js for deliberate bulk buys). */
    purchasedServers: { enabled: false, maxSpendFraction: 0.25, minRamGb: 8, targetRamGb: 1024, namePrefix: "pserv" },
    /** Cheapest-first hacknet buying (achievements: 30 nodes, a maxed node). */
    hacknet: { enabled: true, maxNodes: 30, maxItemFraction: 0.01, maxLoopFraction: 0.02, maxActionsPerLoop: 200 },
    /** Keeps tools/stocks.js running (buys WSE/TIX/4S access, trades on 4S forecasts). */
    stocks: { enabled: true, script: "tools/stocks.js" },
    milestones: {
      enabled: true,
      /** Backdoored automatically when ready (Terminal must be open). w0r1d_d43m0n is only announced. */
      backdoorWatch: ["CSEC", "avmnite-02h", "I.I.I.I", "run4theh111z", "powerhouse-fitness", "fulcrumassets", "w0r1d_d43m0n"],
      autoBackdoor: true,
      backdoorScript: "tools/auto-backdoor.js",
      backdoorRetryMs: 60_000,
      daedalus: { augs: 30, money: 100e9, hack: 2500 },
      homeMaxRamGb: 2 ** 30,
      homeMaxCores: 8,
      homeReminderMs: 30 * 60_000,
    },
  },
};

/** Deep-merge plain objects (arrays and scalars are replaced). */
export function merge(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object"
      ? merge(base[k], v)
      : v;
  }
  return out;
}

/**
 * Load DEFAULTS merged with data/config-overrides.txt (if present and valid JSON).
 * @param {NS} ns
 * @returns {{cfg: Config, overrideError: string|null}}
 */
export function loadConfig(ns) {
  const raw = ns.read(DEFAULTS.files.overrides);
  if (!raw || !raw.trim()) return { cfg: DEFAULTS, overrideError: null };
  try {
    return { cfg: merge(DEFAULTS, JSON.parse(raw)), overrideError: null };
  } catch (e) {
    return { cfg: DEFAULTS, overrideError: String(e) };
  }
}

/**
 * RAM manager on (settings ram.manager.enabled): settings win over DEFAULTS/overrides for the concepts they own.
 * Off: cfg is returned untouched, so the daemon runs exactly the pre-manager code path.
 *   ram.homeReserveGb -> homeReserveGb | ram.xp.target -> xp.target | ram.batches.max (0 = time/RAM bound) -> farm.maxBatches
 *   one-shot XP waves (xp.enabled) and hooks.purchasedServers are replaced by workers/xp-loop.js and lib/cloud.js
 * @param {Config} cfg
 * @param {Object} S  flat settings from lib/settings.js readSettings()
 */
export function managedConfig(cfg, S) {
  if (!S || S["ram.manager.enabled"] !== true) return cfg;
  const maxB = S["ram.batches.max"] > 0 ? S["ram.batches.max"] : Number.MAX_SAFE_INTEGER;
  return merge(cfg, {
    homeReserveGb: S["ram.homeReserveGb"],
    xp: { enabled: false, target: S["ram.xp.target"] },
    farm: { maxBatches: maxB },
    hooks: { purchasedServers: { enabled: false } },
  });
}
