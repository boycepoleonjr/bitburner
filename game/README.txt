HACKING DAEMON — architecture & tunables
========================================

START / STOP
  run daemon.js               start (resumes data/daemon-state.txt)
  run daemon.js --reset       start with fresh state
  run daemon.js --once        one loop then exit (debug)
  tail daemon.js              live log (waves, decisions, periodic status block)
  run tools/status.js         what the daemon believes: primary, ranking, RAM, workers, events
  run tools/kill-workers.js   kill all daemon workers  (--target X | --all | --daemon | --dry)
  run tools/backdoor-paths.js [host]   connect path + readiness for faction servers

FILES
  daemon.js            control loop: scan → root → classify → score → decide → reconcile → waves → state
  lib/config.js        ALL tunables (+ runtime overrides from data/config-overrides.txt, re-read every loop)
  lib/network.js       BFS scan, ServerInfo map (parent, path, ports, RAM, money, sec), classify()
  lib/rooting.js       owned openers, eligibility, idempotent tryRoot (only the openers still needed)
  lib/targets.js       scoring, prep status, switch decision, secondary picking
  lib/planner.js       one wave per target: prep (W G W) or farm (H W G W), timed via additionalMsec
  lib/deploy.js        RAM pool (home reserve), placement across hosts, worker census, kills
  lib/state.js         persisted JSON state
  lib/log.js           leveled log + data/events.txt (+ terminal echo of events)
  lib/formulas.js      Formulas.exe detection + hypothetical-server helper (exact math when owned)
  lib/programs.js      TOR reminder + auto-buy of port openers / Formulas.exe (via tools/terminal-buy.js)
  lib/hooks.js         hacknet buying, stocks launcher, milestones (auto-backdoor, factions, Daedalus,
                       w0r1d_d43m0n, home-upgrade reminder), optional purchased-server growth
  lib/terminal.js      types commands into the Terminal (helpers only — costs 25 GB)
  workers/*.js         one-shot hack/grow/weaken (1.7-1.75 GB); hack reports income on port 7; idle.js for burst
  tools/goals.js       end-goal + achievement progress
  tools/stocks.js      market access purchases + 4S-forecast trading (kept alive by the daemon)
  tools/auto-backdoor.js  backdoors a server through the Terminal (daemon runs it when ready)
  tools/drain.js       hack a server to $0 (Big trouble)
  tools/burst.js       run 1000+ scripts at once (Need more real life ram)
  tools/buy-pservers.js / pserv-quote.js / sf-check.js / terminal-buy.js
  data/                daemon-state.txt, events.txt, config-overrides.txt (optional)
  archive/*.bak.js     previous scripts, kept for reference (safe to rm)

SERVER CLASSES (lib/network.js classify)
  executor  rooted + maxRam >= minHostRamGb (home minus homeReserveGb; hacknet only if useHacknetRam)
  target    rooted, maxMoney > 0, reqHack <= hack level, not player-owned
  utility   rooted but neither (CSEC etc.)
  locked    not rooted yet

SCORING (lib/targets.js)
  steady = maxMoney^wMoney × chanceAtMin^wChance × (growth/growthCap)^wGrowth × levelFactor
           ÷ (weakenTimeAtMin seconds)^wTime
    chanceAtMin  = current hack chance scaled by (100-minSec)/(100-sec)
    timeAtMin    = current weaken time scaled by (2.5·req·minSec+500)/(2.5·req·sec+500)
    levelFactor  = 1 while req/hack <= levelSoftCap, else (levelSoftCap / (req/hack))^levelPenalty
  readiness = 0.5·money/maxMoney + 0.5·minSec/sec
  score     = steady × (1 − readinessWeight × (1 − readiness))
  Targets with chanceAtMin < minChance are ignored.
  With Formulas.exe (auto-detected, config.formulas.enabled): chanceAtMin and weakenTimeAtMin come
  from ns.formulas.hacking on a min-security/max-money copy of the server (exact, marked [F]);
  hack% and grow threads in waves are exact too (grow safety 1.05 instead of 1.1).

SWITCHING (lib/targets.js decide)
  incumbent measured on steady score, challenger (#1 by score) on score; ratio = challenger / incumbent
  - no primary yet                              → pick #1
  - primary no longer a valid target            → EMERGENCY switch
  - ratio >= emergencyRatio (3×)                → EMERGENCY switch (skips confirm + cooldown)
  - ratio <  1 + minImprovement (1.25)          → keep
  - else challenger must be #1 for confirmLoops consecutive loops AND cooldownMs since last switch
  On switch: old primary's workers are killed, new primary gets first claim on RAM.

WAVES & RAM (daemon.js step 7, lib/planner.js)
  Each active target (primary + secondary.slots) runs at most one wave at a time; a target is
  "busy" while any worker has it as args[0] (ps census — survives daemon restarts).
  prep-sec / prep-money: W(excess sec) + G(to max money) + W(grow sec), scaled to RAM if short.
  farm: up to farm.maxBatches HWGW batches (each steals hackFraction), launched together and offset
        by batchSpacingMs; the target ends each wave prepped.
  XP mode: RAM still free after all waves weakens xp.target (joesguns) for hacking exp.
  Secondaries only use RAM beyond the primary's next full wave (headroom rule).

PROGRAMS (lib/programs.js, config.programs)
  No Singularity (SF4) in this BitNode, so scripts can't buy TOR or programs directly.
  - no TOR: every 2 min (once you can afford $200k) a terminal line + toast tells you to buy it
    at City → Alpha Enterprises.
  - TOR owned: every 60s the daemon buys the affordable prefix of the list (openers first, then
    Formulas.exe) by running tools/terminal-buy.js, which types `buy <program>` into the Terminal.
    That only works while the Terminal screen is open and its input is empty; otherwise you get a
    toast and it retries. Set programs.autoBuyViaTerminal=false to get reminders only.

TUNING WITHOUT RESTART
  write data/config-overrides.txt with partial JSON, e.g.
  {"homeReserveGb":128,"farm":{"hackFraction":0.7},"switching":{"cooldownMs":600000},"log":{"level":"debug"}}
