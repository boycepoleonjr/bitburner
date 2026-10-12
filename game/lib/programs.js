/**
 * lib/programs.js — TOR + darkweb program acquisition (no Singularity / Source-File 4 needed).
 *
 * - No TOR router: remind the player (terminal event + toast, every nagEveryMs) once it's affordable.
 * - TOR owned: walk config.programs.list in order and buy the affordable prefix of missing
 *   programs (stops at the first one it can't afford, so openers come before Formulas.exe).
 *   Buying is done by tools/terminal-buy.js, which types `buy <program>` into the Terminal —
 *   it only works while the Terminal screen is open; otherwise it shows a toast and retries later.
 */

/**
 * @param {NS} ns
 * @param {import("lib/config.js").Config} cfg
 * @param {import("lib/state.js").DaemonState} state
 */
export function programsHook(ns, cfg, state, log) {
  const c = cfg.programs;
  if (!c.enabled) return;
  const f = (n) => ns.format.number(n, 2);
  const now = Date.now();
  const money = ns.getServerMoneyAvailable("home");
  state.programs = state.programs ?? { lastNag: 0, lastBuyAt: 0, tor: false };

  const tor = ns.hasTorRouter();
  if (tor !== state.programs.tor) {
    if (tor) log.event("programs", "TOR router detected — auto-buying programs from the darkweb");
    state.programs.tor = tor;
  }

  if (!tor) {
    if (money >= c.torCost && now - state.programs.lastNag >= c.nagEveryMs) {
      state.programs.lastNag = now;
      const msg = `Buy the TOR router ($${f(c.torCost)}): City → Alpha Enterprises → Purchase TOR router. The daemon then auto-buys port openers and Formulas.exe.`;
      log.event("programs", msg);
      ns.toast(msg, "warning", 20_000);
    }
    return;
  }

  const missing = c.list.filter((p) => !ns.fileExists(p.file, "home"));
  if (!missing.length || now - state.programs.lastBuyAt < c.retryMs) return;

  const budget = money * c.maxSpendFraction;
  const toBuy = [];
  let sum = 0;
  for (const p of missing) {
    if (sum + p.price > budget) break;
    toBuy.push(p.file);
    sum += p.price;
  }
  if (!toBuy.length) return;

  state.programs.lastBuyAt = now;
  if (c.autoBuyViaTerminal && ns.run(c.buyScript, 1, ...toBuy) > 0) {
    log.info("programs", `requested terminal buy: ${toBuy.join(", ")} (~$${f(sum)})`);
  } else {
    const msg = `Affordable now: ${toBuy.join(", ")} — run in the Terminal: ${toBuy.map((p) => `buy ${p}`).join("; ")}`;
    log.event("programs", msg);
    ns.toast(msg, "info", 15_000);
  }
}
