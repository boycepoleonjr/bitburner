/** agent/autopilot.js — in-game autopilot (needs Singularity: BN4 or SF4).
 * Every 30s: TOR + port programs, home RAM/cores, faction-server backdoors, faction invites,
 *   work policy, donations, and (autoInstall) aug batch + install. Never destroys a BitNode — it FLAGS that.
 * Decisions are appended to /data/audit.txt (JSONL). Status: /data/autopilot-status.txt. Config: /data/autopilot-config.txt.
 * @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const S = ns.singularity;
  const STATUS = "/data/autopilot-status.txt", CFG = "/data/autopilot-config.txt", EV = "/data/events.txt";
  const DEFAULTS = {
    enabled: true,
    programs: true, homeRam: true, homeCores: true, backdoors: true, joinFactions: true,
    reserve: 0,               // money never spent by autopilot
    homeRamMaxFrac: 1.0,      // buy home RAM when cost <= frac * (money - reserve)
    homeCoresMaxFrac: 0.25,
    work: "keep",             // "keep" | "study" (Algorithms @ Rothman) | "faction:<name>" | "auto-faction"
    autoInstall: false,       // buy aug batch + install on: Red Pill / >= augTrigger buyable / stalled
    augTrigger: 6,
    donate: true, donateFavor: 150, donateMaxFrac: 0.5,
    loopMs: 30000,
  };
  const PROGRAMS = ["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe", "HTTPWorm.exe", "SQLInject.exe"];
  const BACKDOORS = ["CSEC", "avmnite-02h", "I.I.I.I", "run4theh111z"];
  const CITY = new Set(["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"]);
  const recent = [];
  let liquidatedByMe = false;
  const act = (msg) => {
    const line = `${new Date().toLocaleTimeString("en-US", { hour12: false })} [autopilot] ${msg}`;
    recent.push({ t: Date.now(), msg }); while (recent.length > 20) recent.shift();
    ns.write(EV, line + "\n", "a");
  };
  const cfg = () => { try { return { ...DEFAULTS, ...JSON.parse(ns.read(CFG) || "{}") }; } catch { return DEFAULTS; } };
  const path = (target) => {
    const prev = { home: null }, q = ["home"];
    while (q.length) { const h = q.shift(); if (h === target) break; for (const n of ns.scan(h)) if (!(n in prev)) { prev[n] = h; q.push(n); } }
    if (!(target in prev)) return null;
    const p = []; for (let h = target; h; h = prev[h]) p.unshift(h); return p;
  };
  const money = () => ns.getServerMoneyAvailable("home");
  const OVR = "/data/config-overrides.txt", POST = "agent/post-install.js", AUDIT = "/data/audit.txt";
  // Append-only decision log: every purchase/skip/trigger/flag change with inputs, so installs can be reconstructed.
  const audit = (kind, data) => ns.write(AUDIT, JSON.stringify({ t: Date.now(), iso: new Date().toISOString(), kind, ...data }) + "\n", "a");
  const c0 = () => cfg();
  let lastFlags = "";
  // Buy every rep-met aug, highest rep requirement first (respecting prereqs), then NeuroFlux until broke. Returns names bought.
  const buyBatch = (owned) => {
    const out = [], have = new Set(owned);
    const cands = [];
    for (const f of ns.getPlayer().factions) {
      const rep = S.getFactionRep(f);
      for (const a of S.getAugmentationsFromFaction(f)) if (!have.has(a) && !a.startsWith("NeuroFlux") && !(c0().skipHacknetAugs && /hacknet/i.test(a)) && S.getAugmentationRepReq(a) <= rep) cands.push({ a, f, rr: S.getAugmentationRepReq(a) });
    }
    const uniq = [...new Map(cands.map((x) => [x.a, x])).values()].sort((x, y) => y.rr - x.rr);
    const byName = new Map(uniq.map((x) => [x.a, x]));
    // Order: highest rep req first, but each aug's unowned prereqs go IMMEDIATELY before it (fix 2026-09-27:
    // Gen II was skipped because Gen I was bought after it and the x1.9 price ramp made Gen II unaffordable).
    const order = [];
    const place = (x, depth = 0) => {
      if (depth > 5 || have.has(x.a) || order.includes(x)) return;
      for (const p of S.getAugmentationPrereq(x.a)) if (!have.has(p) && byName.has(p)) place(byName.get(p), depth + 1);
      order.push(x);
    };
    for (const x of uniq) place(x);
    const plan = order.map((x) => ({ a: x.a, f: x.f, rr: x.rr, price: S.getAugmentationPrice(x.a) }));
    for (const x of order) {
      if (have.has(x.a) || S.getAugmentationPrereq(x.a).some((p) => !have.has(p))) { audit("skip", { a: x.a, why: "prereq missing" }); continue; }
      const price = S.getAugmentationPrice(x.a);
      if (money() >= price && S.purchaseAugmentation(x.f, x.a)) { have.add(x.a); out.push(x.a); audit("buy", { a: x.a, f: x.f, rr: x.rr, price }); }
      else audit("skip", { a: x.a, why: "unaffordable", price, money: money() });
    }
    audit("plan", { plan });
    // NeuroFlux last, from the faction with the most rep that sells it
    const nf = ns.getPlayer().factions.filter((f) => S.getAugmentationsFromFaction(f).some((a) => a.startsWith("NeuroFlux"))).sort((a, b) => S.getFactionRep(b) - S.getFactionRep(a))[0];
    if (nf) { const name = S.getAugmentationsFromFaction(nf).find((a) => a.startsWith("NeuroFlux"));
      for (let i = 0; i < 100 && S.getFactionRep(nf) >= S.getAugmentationRepReq(name) && money() >= S.getAugmentationPrice(name); i++) { if (!S.purchaseAugmentation(nf, name)) break; out.push(name); } }
    // leftover cash is lost at install: sink it into home RAM/cores (they persist)
    for (let i = 0; i < 20; i++) { const r = S.getUpgradeHomeRamCost(), c2 = S.getUpgradeHomeCoresCost(); const pick = Math.min(r, c2); if (!isFinite(pick) || money() < pick) break; if (pick === r ? S.upgradeHomeRam() : S.upgradeHomeCores()) out.push(pick === r ? "home RAM" : "home core"); else break; }
    return out;
  };

  while (true) {
    const c = cfg();
    const flags = [], next = [];
    let augs = { buyable: 0, top: [], redPill: false };
    try {
      if (c.enabled) {
        const hack = ns.getHackingLevel();
        const spendable = () => Math.max(0, money() - c.reserve);

        // 1. TOR + programs (cheapest first)
        if (c.programs) {
          if (!ns.hasTorRouter()) { if (spendable() >= 200000 && S.purchaseTor()) act("bought TOR router"); else next.push({ kind: "money", target: 200000 + c.reserve, label: "TOR" }); }
          if (ns.hasTorRouter()) {
            for (const p of PROGRAMS) {
              if (ns.fileExists(p, "home")) continue;
              const cost = S.getDarkwebProgramCost(p);
              if (cost > 0 && spendable() >= cost) { if (S.purchaseProgram(p)) act(`bought ${p} ($${ns.format.number(cost)})`); }
              else if (cost > 0) { next.push({ kind: "money", target: cost + c.reserve, label: p }); break; }
            }
          }
        }
        // 2. Home RAM / cores
        if (c.homeRam) {
          const cost = S.getUpgradeHomeRamCost();
          if (isFinite(cost) && cost > 0) {
            if (cost <= c.homeRamMaxFrac * spendable()) { const before = ns.getServerMaxRam("home"); if (S.upgradeHomeRam()) act(`home RAM ${before}GB -> ${ns.getServerMaxRam("home")}GB ($${ns.format.number(cost)})`); }
            else next.push({ kind: "money", target: cost / c.homeRamMaxFrac + c.reserve, label: "home RAM" });
          }
        }
        if (c.homeCores) {
          const cost = S.getUpgradeHomeCoresCost();
          if (isFinite(cost) && cost > 0 && cost <= c.homeCoresMaxFrac * spendable()) { if (S.upgradeHomeCores()) act(`home cores -> ${ns.getServer("home").cpuCores} ($${ns.format.number(cost)})`); }
        }
        // 3. Faction-server backdoors
        if (c.backdoors) {
          for (const t of BACKDOORS) {
            if (!ns.serverExists(t)) continue;
            const req = ns.getServerRequiredHackingLevel(t);
            if (ns.getServer(t).backdoorInstalled) continue;
            if (hack < req) { next.push({ kind: "level", skill: "hacking", target: req, label: `backdoor ${t}` }); continue; }
            if (!ns.hasRootAccess(t)) { flags.push(`no root on ${t} (need more port openers)`); continue; }
            const p = path(t); if (!p) continue;
            for (const h of p.slice(1)) S.connect(h);
            try { await S.installBackdoor(); act(`backdoored ${t}`); } catch (e) { flags.push(`backdoor ${t} failed: ${e}`); }
            S.connect("home");
          }
          if (ns.serverExists("w0r1d_d43m0n")) {
            const req = ns.getServerRequiredHackingLevel("w0r1d_d43m0n");
            if (hack >= req && ns.hasRootAccess("w0r1d_d43m0n")) flags.push("w0r1d_d43m0n READY — agent decides BitNode destruction");
            else next.push({ kind: "level", skill: "hacking", target: req, label: "w0r1d_d43m0n" });
          }
        }
        // 4. Faction invitations (non-city auto; city ones flagged — they lock out rival cities)
        if (c.joinFactions) {
          for (const f of S.checkFactionInvitations()) {
            if (CITY.has(f) && !(c.joinCity || []).includes(f)) { flags.push(`city faction invite pending: ${f}`); continue; }
            if (S.joinFaction(f)) act(`joined ${f}`);
          }
        }
        // 5. Work policy (only when configured; "keep" never touches current work)
        if (c.work !== "keep") {
          const w = S.getCurrentWork();
          if (c.work === "study" && !(w && w.type === "CLASS" && /algorithms/i.test(w.classType || ""))) {
            if (ns.getPlayer().city !== "Sector-12") S.travelToCity("Sector-12");
            if (S.universityCourse("Rothman University", "Algorithms", false)) act("started Algorithms");
          } else if (c.work === "auto-faction") {
            // work for the first faction in factionPriority whose aug list isn't rep-complete (tie: smallest gap)
            const owned0 = new Set(S.getOwnedAugmentations(true));
            let best = null;
            for (const f of ns.getPlayer().factions) {
              const rep = S.getFactionRep(f);
              const need = Math.max(0, ...S.getAugmentationsFromFaction(f).filter((a) => !owned0.has(a) && !a.startsWith("NeuroFlux")).map((a) => S.getAugmentationRepReq(a)));
              const gap = need - rep;
              const pr = (c.factionPriority || []).indexOf(f), rank = pr < 0 ? 999 : pr;
              if (gap > 0 && (!best || rank < best.rank || (rank === best.rank && gap < best.gap))) best = { f, gap, rank };
            }
            if (best && !(w && w.type === "FACTION" && w.factionName === best.f)) {
              if (S.workForFaction(best.f, "hacking", false)) act(`working for ${best.f} (hacking contracts, rep gap ${Math.round(best.gap)})`);
              else if (S.workForFaction(best.f, "field", false)) act(`working for ${best.f} (field work)`);
            }
          } else if (c.work.startsWith("faction:")) {
            const f = c.work.slice(8);
            if (!(w && w.type === "FACTION" && w.factionName === f) && ns.getPlayer().factions.includes(f)) {
              if (S.workForFaction(f, "hacking", false)) act(`working for ${f} (hacking)`);
            }
          }
        }
        // 6. Aug report (flags only): affordable now, and next rep targets per faction
        const owned = new Set(S.getOwnedAugmentations(true));
        const m = money(), buyable = [];
        for (const f of ns.getPlayer().factions) {
          const rep = S.getFactionRep(f);
          let nextRep = Infinity;
          for (const a of S.getAugmentationsFromFaction(f)) {
            if (owned.has(a) || a.startsWith("NeuroFlux") || (c.skipHacknetAugs && /hacknet/i.test(a))) continue;
            const rr = S.getAugmentationRepReq(a), price = S.getAugmentationPrice(a);
            if (rep >= rr && m >= price) buyable.push({ a, f, rr, price });
            else if (rr > rep) nextRep = Math.min(nextRep, rr);
          }
          if (isFinite(nextRep)) next.push({ kind: "rep", faction: f, target: nextRep, label: `next aug rep @ ${f}` });
        }
        if (buyable.length) {
          const uniq = [...new Map(buyable.map((b) => [b.a, b])).values()].sort((x, y) => y.rr - x.rr);
          augs = { buyable: uniq.length, top: uniq.slice(0, 5).map((b) => `${b.a}@${b.f}`), redPill: uniq.some((b) => b.a === "The Red Pill") };
        }
        // 7. Donations: at favor >= donateFavor, buy rep for the current work faction's remaining aug gap
        if (c.donate) {
          const w = S.getCurrentWork();
          const f = w && w.type === "FACTION" ? w.factionName : null;
          if (f && S.getFactionFavor(f) >= c.donateFavor) {
            const need = Math.max(0, ...S.getAugmentationsFromFaction(f).filter((a) => !owned.has(a) && !a.startsWith("NeuroFlux")).map((a) => S.getAugmentationRepReq(a)));
            const gap = need - S.getFactionRep(f);
            if (gap > 0) {
              const amt = Math.min(Math.ceil(gap / ns.getPlayer().mults.faction_rep) * 1e6, spendable() * c.donateMaxFrac);
              if (amt >= 1e6 && S.donateToFaction(f, amt)) act(`donated $${ns.format.number(amt)} to ${f} (rep gap ${Math.round(gap)})`);
            }
          }
        }
        // 8. Aug batch + install (user rules: highest rep req first, NeuroFlux LAST). Destroying a BitNode stays with the agent.
        if (c.autoInstall) {
          const repWorkLeft = ns.getPlayer().factions.some((f) => S.getAugmentationsFromFaction(f).some((a) => !owned.has(a) && !a.startsWith("NeuroFlux") && S.getAugmentationRepReq(a) > S.getFactionRep(f)));
          const why = augs.redPill ? "Red Pill" : augs.buyable >= c.augTrigger ? `${augs.buyable} augs buyable` : (!repWorkLeft && augs.buyable >= 1) ? "stalled (all rep-complete)" : null;
          if (why) {
            const cfgO = (() => { try { return JSON.parse(ns.read(OVR) || "{}"); } catch { return {}; } })();
            if (!(cfgO.stocks && cfgO.stocks.liquidate)) {
              cfgO.stocks = { ...(cfgO.stocks || {}), liquidate: true }; ns.write(OVR, JSON.stringify(cfgO), "w"); liquidatedByMe = true;
              act(`install trigger (${why}): liquidating stocks, buying next loop`);
              audit("trigger", { why, augs, money: money(), rep: Object.fromEntries(ns.getPlayer().factions.map((f) => [f, Math.round(S.getFactionRep(f))])) });
            } else {
              const bought = buyBatch(owned);
              if (bought.length) {
                const src = ns.getMoneySources().sinceInstall;
                ns.write("/data/install-log.txt", JSON.stringify({ t: Date.now(), why, bought, leftover: money(), src, sinceAug: Date.now() - ns.getResetInfo().lastAugReset }) + "\n", "a");
                act(`bought ${bought.length} augs (${bought.slice(0, 4).join(", ")}${bought.length > 4 ? ", ..." : ""}); leftover $${ns.format.number(money())}; INSTALLING`);
                ns.write(STATUS, JSON.stringify({ t: Date.now(), v: 1, installing: true, why, bought, flags: [], next: [], augs, recent }), "w");
                const left = [...new Set(ns.getPlayer().factions.flatMap((f) => S.getAugmentationsFromFaction(f).filter((a) => !a.startsWith("NeuroFlux") && !S.getOwnedAugmentations(true).includes(a) && S.getAugmentationRepReq(a) <= S.getFactionRep(f))))];
                audit("install", { why, bought, leftover: money(), leftBehind: left });
                S.installAugmentations(POST);
                return;
              } else flags.push(`install trigger (${why}) but nothing affordable`);
            }
          } else if (liquidatedByMe) {
            const cfgO = JSON.parse(ns.read(OVR) || "{}"); cfgO.stocks = { ...(cfgO.stocks || {}), liquidate: false }; ns.write(OVR, JSON.stringify(cfgO), "w");
            liquidatedByMe = false; act("install trigger cleared: stock trading re-enabled");
          }
        }
      }
    } catch (e) { flags.push("autopilot error: " + e); }
    // Spend plan for the predictor: every purchase the autopilot will make, as {what, thr (money level that fires it), cost}.
    // Repeatables (home RAM) are projected 3 steps ahead with the observed x3.16 cost ramp.
    const plan = [];
    try {
      if (c.enabled) {
        if (c.programs) {
          if (!ns.hasTorRouter()) plan.push({ what: "TOR", thr: 200000 + c.reserve, cost: 200000 });
          else for (const p of PROGRAMS) { if (ns.fileExists(p, "home")) continue; const cost = S.getDarkwebProgramCost(p); if (cost > 0) plan.push({ what: p, thr: cost + c.reserve, cost }); }
        }
        if (c.homeRam) { let cost = S.getUpgradeHomeRamCost(); for (let k = 0; k < 3 && isFinite(cost) && cost > 0; k++, cost *= 3.16) plan.push({ what: `home RAM +${k + 1}`, thr: cost / c.homeRamMaxFrac + c.reserve, cost }); }
        if (c.homeCores) { const cost = S.getUpgradeHomeCoresCost(); if (isFinite(cost) && cost > 0) plan.push({ what: "home core", thr: cost / c.homeCoresMaxFrac + c.reserve, cost }); }
      }
    } catch { }
    plan.sort((a, b) => a.thr - b.thr);
    const st = { t: Date.now(), v: 1, money: money(), hack: ns.getHackingLevel(), homeRam: ns.getServerMaxRam("home"), plan,
      work: (() => { try { const w = S.getCurrentWork(); return w ? w.type + ":" + (w.classType || w.factionName || w.programName || "") : null; } catch { return null; } })(),
      flags, next, augs, recent };
    if (flags.join("|") !== lastFlags) { lastFlags = flags.join("|"); audit("flags", { flags }); }
    ns.write(STATUS, JSON.stringify(st), "w");
    await ns.sleep(c.loopMs);
  }
}
