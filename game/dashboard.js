/**
 * dashboard.js — in-game React dashboard (KPIs down to raw data, every setting editable).
 *
 *   run dashboard.js        open it (a second instance exits; reopen a closed window from Active Scripts > "Log")
 *   kill dashboard.js       close it
 *
 * Rendered ONCE with ns.printRaw into the tail window; afterwards only React state changes (store subscriptions).
 * While the tail window is closed the loop reads nothing. RAM: ~2.1 GB (base + ps + getRunningScript).
 * Never reference window/document here or in lib/ui/* (Bitburner charges 25 GB each). Spec: docs/specs/dashboard.md.
 * @param {NS} ns
 */
import { createViews } from "lib/ui/views.js";
import { createStore } from "lib/ui/store.js";
import { createController } from "lib/ui/controller.js";
import { SCHEMA, GROUPS } from "lib/settings-schema.js";

export const TITLE = "Bitburner dashboard";

/** Tail size: 80% of the game window, at least 900x600. */
export function tailSize([w, h] = [1200, 800]) {
  return [Math.max(900, Math.floor((w || 1200) * 0.8)), Math.max(600, Math.floor((h || 800) * 0.8))];
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.clearLog();
  const me = ns.getScriptName();
  if (ns.ps("home").some((p) => p.filename === me && p.pid !== ns.pid)) { ns.tprint("dashboard.js is already running (open its log window)"); return; }

  const store = createStore();
  const ctl = createController(ns, store);
  ns.atExit(() => ctl.stop());

  ns.ui.openTail();
  ns.ui.setTailTitle(TITLE);
  const [tw, th] = tailSize(ns.ui.windowSize());
  ns.ui.resizeTail(tw, th);

  ctl.tick();
  const { App } = createViews(React, { schema: SCHEMA, groups: GROUPS });
  ns.printRaw(React.createElement(App, { store, actions: ctl.actions }));

  while (true) {
    const self = ns.getRunningScript();
    if (!self || !self.tailProperties) { await ns.sleep(1000); continue; } // window closed: no reads
    try { ctl.tick(); } catch (e) { ns.print(`dashboard tick failed: ${e}`); }
    await ctl.wait((ms) => ns.sleep(ms));
  }
}
