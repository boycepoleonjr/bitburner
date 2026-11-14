# Handoff 2026-11-13: predictor v3 (F-002)

Branch `feat/predictor-v3`, PR #52. Spec: `docs/specs/predictor-v3.md` (diagnosis, metrics, results, decision).
Ledger: F-002 (in-progress, detector flag). Work ran 2026-11-13/14 (UTC). No live game writes, no `bb push`, no
settings POST, no Railway change, no workflow edit. Live data was read only through `POST /api/read`, snapshotted to a
scratch dir and never committed; tests use synthetic data.

## What changed
- `game/lib/predcal.js` (new, pure ES module): rolling-origin `replay()`, online calibrator (prequential ensemble over
  raw and bias-corrected base models, their median and v2's own point; per-edge ACI conformal band on kind x bucket,
  shrunk toward kind and all), `applySnapshot`, `validateSnapshot` (codes missing / stale / invalid), `liveCoverage`,
  `samplesFromLog`, `loadPredcal` (page loader). `DEFAULTS` = configuration tuned on the first half of the log.
- `game/agent/predictor.txt`: loads predcal via `bb.read` + `new Function`; `calibrate()` writes `v3` + `liveCoverage` to
  `data/pred-calib.txt` in every mode (snapshot stamped with the calibration time); `predict()` answers with v3 when
  `predictor.version=v3` and the snapshot is valid, keeps v2's answer in `v2eta/v2lo/v2hi`, else falls back with
  `v3fallback`; `resolve()` adds `v2inBand`; `report()` adds `version`, `v3`, `live3`, `liveCoverage`; `tick()` returns
  `attention` and recalibrates at once when `v3` is missing, at most every 30 min when it is unusable.
- `game/agent/checkin-lib.txt`: forwards predictor attention; Predictions row shows `v3 ·` / `v3→v2 fallback ·` and v3's
  own coverage vs v2's shadow coverage once v3 has scored predictions.
- `game/lib/settings-schema.js`: group `predictor`; `predictor.version` (v2 | v3, default v2), `predictor.alertWindow` (50),
  `predictor.alertMinN` (30). Docs: `docs/specs/settings.md`, `AGENTS.md`, `game/agent/PLAYBOOK.txt`.
- `scripts/predictor-backtest.js` (new): the offline harness (tuning grid, held-out, folds, block-bootstrap CIs, PIT,
  censoring, decision buckets).
- Tests: `test/predcal.js` (27), `test/predictor-backtest.js` (9).

## Results (held-out 2026-10-21 → 2026-11-14, 1,222 outcomes, 61 install cycles)
- Coverage of the 80% band: v2 52.8% [40.1, 63.9] → v3 72.9% [65.1, 81.8]. Interval score 4.29 → 3.18. Median log error
  0.204 → 0.114. Censored definite misses 20.7% → 3.2%. Buckets with n >= 30 inside 75-85%: v2 0 of 9, v3 5 of 9.
- Install-timing buckets (rep): median log error -46% to -72%. Destroy ETA (level >3h) +12% and money >3h +34%: not
  improved (8 and 28 install cycles; see spec R4). The bands there improved (interval score 9.67 → 3.81, 5.68 → 5.04).
- The overall 75-85% acceptance target is not met by the shipped config (72.9%; its CI contains 75-80%). The
  cluster-robust variant reached 78.1% held-out but ranked 118th of 144 on the tuning half; it was not shipped (would be
  test-set tuning). Owner decision listed in the PR.

## Findings worth knowing
- v2's telemetry backtest is far easier than live targets (median |log err| 0.00-0.03 vs 0.03-0.9): sizing bands on it
  was the core bug.
- 43% of predictions are voided by installs (right-censored); the live "in band" metric ignores them.
- About 70% of squared error comes from within-run regime breaks (faction work switches, home RAM purchases, daemon
  resizes). No trend model (Kalman, rate-trend, log-linear: tested on telemetry) helps there.
- The first and second halves of the log are different regimes; expect live v3 coverage in the 70s at first, rising as
  ACI adapts.

## After merge (owner)
1. Merge, wait for the Railway deploy, confirm the deployed commit includes the merge.
2. `bb settings set predictor.version=v3` (before the push, so the coverage alert counts only v3 predictions).
3. `bb push lib/predcal.js agent/predictor.txt agent/checkin-lib.txt lib/settings-schema.js agent/PLAYBOOK.txt`; the next
   check-in re-evals the predictor (no restart needed) and calibrates v3; `bb note` what changed.
4. Check `data/pred-calib.txt` has `v3` and `liveCoverage`; after 24 h compare `report().live3.inBand` with `v2inBand`.
5. Rollback: `bb settings set predictor.version=v2`.

## Follow-ups
- Work-switch-aware rep model and spend-aware money model (point accuracy where the error is).
- Decide on the cluster-robust band options (`dedup: 1, batchAci: true, gamma: 0.03`) after live data.
- Censoring-aware fitting if the owner wants "reached before the install" in the metric.
- Re-run `scripts/predictor-backtest.js` after a week of v3 data and update `DEFAULTS` only through the tuning split.
