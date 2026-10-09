/**
 * lib/cloud.js — cloud (purchased) server buying for the RAM manager. Supersedes hooks.purchasedServers while
 * ram.manager.enabled (the daemon turns that hook off, so nothing buys twice).
 *
 * Per loop, budget = cash × ram.cloud.maxSpendFraction:
 *   1. while count < limit: buy the largest power-of-two RAM (<= ram limit) the budget covers, named cloud-NN
 *   2. then upgrade the smallest server to the largest affordable power of two
 * No purchases inside ram.cloud.freezeBeforeInstallMin of a predicted install (autopilot-status.installEtaMs).
 * ns.cloud.* RAM: getServerNames 1.05, getServerLimit 0.05, getRamLimit 0.05, getServerCost 0.25,
 * purchaseServer 2.25, getServerUpgradeCost 0.1, upgradeServer 0.25 (all already paid by lib/hooks.js).
 */
import { pow2Floor } from "lib/ramplan.js";

/**
 * PURE planner (tests drive it directly).
 * @param {{servers:{host:string, ram:number}[], limit:number, ramLimit:number, budget:number,
 *          costOf:(ram:number)=>number, upgradeCostOf:(host:string, ram:number)=>number, maxActions?:number}} p
 * @returns {{actions:Array<{op:"buy"|"upgrade", host:string, ram:number, cost:number}>, spent:number}}
 */
export function planCloud({ servers, limit, ramLimit, budget, costOf, upgradeCostOf, maxActions = 100 }) {
  const actions = [];
  let left = Number.isFinite(budget) && budget > 0 ? budget : 0;
  const fleet = servers.map((s) => ({ ...s }));
  const names = new Set(fleet.map((s) => s.host));
  const top = pow2Floor(ramLimit);
  const bestAffordable = (minExclusive, cost) => {
    for (let r = top; r > minExclusive && r >= 2; r /= 2) { const c = cost(r); if (c >= 0 && Number.isFinite(c) && c <= left) return { r, c }; }
    return null;
  };
  while (fleet.length < limit && actions.length < maxActions) {
    const b = bestAffordable(0, costOf);
    if (!b) break;
    let i = 0; while (names.has(`cloud-${String(i).padStart(2, "0")}`)) i++;
    const host = `cloud-${String(i).padStart(2, "0")}`;
    names.add(host); fleet.push({ host, ram: b.r }); left -= b.c;
    actions.push({ op: "buy", host, ram: b.r, cost: b.c });
  }
  while (actions.length < maxActions) {
    const s = fleet.filter((x) => x.ram < top).sort((a, b) => a.ram - b.ram)[0];
    if (!s) break;
    const b = bestAffordable(s.ram, (r) => upgradeCostOf(s.host, r));
    if (!b) break;
    s.ram = b.r; left -= b.c;
    actions.push({ op: "upgrade", host: s.host, ram: b.r, cost: b.c });
  }
  return { actions, spent: actions.reduce((a, x) => a + x.cost, 0) };
}

/** Install ETA from data/aug-plan.txt (aug planner): plan.t + install.next.etaMin. Null when unknown or stale (>10 min). */
export function planInstallEta(planRaw, now = Date.now()) {
  let p = null; try { p = JSON.parse(planRaw || "null"); } catch { }
  const m = p?.install?.next?.etaMin, t = p?.t;
  if (!Number.isFinite(m) || !Number.isFinite(t) || now - t > 10 * 60_000) return null;
  return t + m * 60_000;
}

/** Is a predicted install too close for spending? Missing/stale ETA = no freeze (with a reason).
 *  ETA source: autopilot-status.installEtaMs if present, else the aug planner's data/aug-plan.txt. */
export function cloudFreeze(autopilotRaw, freezeMin, now = Date.now(), planRaw = "") {
  let ap = null; try { ap = JSON.parse(autopilotRaw || "null"); } catch { }
  const eta = Number.isFinite(ap?.installEtaMs) ? ap.installEtaMs : planInstallEta(planRaw, now);
  if (!Number.isFinite(eta)) return { frozen: false, reason: "no install ETA (autopilot-status / aug-plan); freeze ignored" };
  const left = eta - now;
  if (left > 0 && left <= freezeMin * 60_000) return { frozen: true, reason: `install predicted in ${Math.ceil(left / 60_000)}m: cloud buying frozen` };
  return { frozen: false, reason: "" };
}

/**
 * Execute one loop of cloud buying.
 * @param {NS} ns
 * @param {Object} S  settings (lib/settings.js)
 * @returns {{count:number, limit:number, minGb:number, maxGb:number, spentThisLoop:number, reasons:string[]}}
 */
export function cloudTick(ns, S, { autopilotRaw = "", planRaw = "", now = Date.now(), log } = {}) {
  const reasons = [];
  const names = ns.cloud.getServerNames();
  const limit = ns.cloud.getServerLimit();
  let spent = 0;
  if (!S["ram.cloud.enabled"]) reasons.push("cloud buying disabled");
  else {
    const fz = cloudFreeze(autopilotRaw, S["ram.cloud.freezeBeforeInstallMin"], now, planRaw);
    if (fz.reason) reasons.push(fz.reason);
    if (!fz.frozen) {
      const plan = planCloud({
        servers: names.map((h) => ({ host: h, ram: ns.getServerMaxRam(h) })), limit, ramLimit: ns.cloud.getRamLimit(),
        budget: ns.getServerMoneyAvailable("home") * S["ram.cloud.maxSpendFraction"],
        costOf: (r) => ns.cloud.getServerCost(r), upgradeCostOf: (h, r) => ns.cloud.getServerUpgradeCost(h, r),
      });
      for (const a of plan.actions) {
        const ok = a.op === "buy" ? !!ns.cloud.purchaseServer(a.host, a.ram) : ns.cloud.upgradeServer(a.host, a.ram);
        if (!ok) { reasons.push(`cloud ${a.op} ${a.host} failed`); break; }
        spent += a.cost;
        log?.event("cloud", `${a.op === "buy" ? "bought" : "upgraded"} ${a.host} -> ${a.ram}GB for $${ns.format.number(a.cost, 2)}`);
      }
    }
  }
  const after = ns.cloud.getServerNames();
  const rams = after.map((h) => ns.getServerMaxRam(h));
  return { count: after.length, limit, minGb: rams.length ? Math.min(...rams) : 0, maxGb: rams.length ? Math.max(...rams) : 0, spentThisLoop: spent, reasons };
}
