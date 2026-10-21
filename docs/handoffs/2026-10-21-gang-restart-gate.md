# Handoff 2026-10-21: gang.js restart gate

- **Bug:** after leaving BN2 (now BN5, SF2 owned, no gang) autopilot saw `gangPossible` = true (SF2 alone) and restarted `agent/gang.js` every 30 s; it exited at once because the gang API is unavailable. Result: event-log and check-in "Activity" spam.
- **Fix:** `gangPossible` (lib/gangplan.js) now needs `inGang`, or BN2, or SF2 **and** karma <= -54000 (`GANG_KARMA`, the game's `canAccessGang`). autopilot, post-install and daemon-lite pass `ns.heart.break()`; gang.js uses the same constant. Tests: test/gang-integration.js (four regression tests; they fail on the old code), test/gang-loop.js.
- **After merge:** `bb push` the five changed `game/` files (autopilot.js, daemon-lite.js, gang.js, post-install.js, lib/gangplan.js), restart autopilot, `bb note`. No settings change.
- **Open elsewhere:** #30 (Node 26) merged as 1d38d1c but not deployed: Railway builds paused by their incident QH8L8B3E; Aside is watching.
