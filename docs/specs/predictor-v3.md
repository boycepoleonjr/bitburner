# Spec: predictor v3 — online ensemble + adaptive conformal bands (F-002)

Status: planned and evaluated 2026-11-14 (plan written before the game code; numbers below are from the offline backtest).
Ledger: F-002 (HIGH). Owner: "I am not noticing better predictions, so the math it is using is not advanced enough."

## Problem
The check-in "Predictions" row says 53% of resolved predictions land in the nominal 80% band. The ETAs feed the
check-in "Next event" line and cadence, the dashboard destroy ETA (hacking-level predictions for w0r1d_d43m0n) and the
owner's reading of when the next install batch completes (next-aug rep and money targets).

## Data used (read-only snapshot, 2026-11-14 03:10 UTC; not committed)
`POST /api/read` of `data/pred2.txt` (4,431 predictions: 2,532 resolved, 1,885 voided by an install, 14 open; first
2026-09-27), `data/install-log.txt` (157 installs), `data/telemetry.txt` (7 days, 9,953 rows, BN2 + BN10),
`data/pred-calib.txt`. 131 install cycles. Only synthetic data is committed (tests generate it).

## Diagnosis (v2, every resolved prediction, log units = ln(actual/predicted duration))

### D1. Coverage by kind x horizon bucket (bucket = v2's, from the median model prediction)
| cell | resolved | voided by install | in band | actual < lo (early) | actual > hi (late) | median log error | band half-width |
|---|---|---|---|---|---|---|---|
| level <20m | 24 | 0 | 46% | 17% | 38% | +0.12 | 0.33 |
| level 20-60m | 18 | 0 | 56% | 39% | 6% | -0.04 | 0.15 |
| level 1-3h | 33 | 3 | 42% | 48% | 9% | -0.05 | 0.15 |
| level >3h | 169 | 112 | 18% | 53% | 29% | -0.21 | 0.09 |
| money <20m | 69 | 8 | 43% | 13% | 43% | +0.43 | 0.79 |
| money 20-60m | 116 | 28 | 65% | 15% | 21% | +0.29 | 0.74 |
| money 1-3h | 166 | 66 | 62% | 14% | 24% | +0.09 | 0.65 |
| money >3h | 646 | 946 | 48% | 17% | 35% | 0.00 | 0.23 |
| rep <20m | 313 | 7 | 61% | 18% | 21% | 0.00 | 0.11 |
| rep 20-60m | 282 | 19 | 85% | 10% | 5% | +0.01 | 0.08 |
| rep 1-3h | 329 | 72 | 77% | 18% | 5% | 0.00 | 0.07 |
| rep >3h | 367 | 624 | 29% | 37% | 34% | 0.00 | 0.07 |
| **all** | 2,532 | 1,885 | **54%** (block-bootstrap 95% CI 47-61%) | 22% | 24% | 0.00 | |

Misses are on both sides in almost every cell, so the bands are too narrow, not just shifted.

### D2. Calibration curve (PIT histogram)
PIT under the lognormal v2's symmetric band implies, ten bins from 0 to 1, all 2,532 outcomes:
`558 154 131 171 206 215 187 175 134 601`. A calibrated predictor is flat (about 253 per bin). v2 puts 46% of outcomes in
the outer two deciles: the predictive distribution is far too narrow (under-dispersed), by kind worst for level
(`92 6 5 3 3 4 3 1 5 11` of 133 in the held-out half: almost every level outcome is far below the band).

### D3. Autocorrelation and clustering
Each check-in re-predicts every open target, so one target is predicted many times: only 41 distinct money targets,
133 rep and 356 level targets across 4,431 predictions. Lag-1 autocorrelation of the log error (in time order) is 0.28
overall and 0.6-0.8 in the long buckets (money >3h 0.69, level >3h 0.74, rep >3h 0.60). Effective sample sizes are
small: level >3h has 88 held-out outcomes but 8 install cycles. Every coverage number below therefore carries a
block-bootstrap CI that resamples whole install cycles.

### D4. Root causes
1. **The band is sized on the wrong data.** v2 sizes `q80` from a walk-forward backtest over telemetry with synthetic
   targets (x1.25 / x2 / x5 money, +3/+10/+30 levels, x1.2-2.5 rep) and applies it to live targets. On the same 7 days
   of telemetry, the backtest's median |log error| is 0.00-0.03 for 1-3h and >3h targets (best base models), while live
   predictions have 0.03-0.9. Synthetic targets in a steady run are easy; real targets (aug rep, aug price, the
   w0r1d_d43m0n level) span purchases, work switches and RAM upgrades. 93k easy samples swamp 1.7k real ones.
2. **One pooled width per kind** applied to every horizon bucket (`policy[kind].q80`).
3. **The point estimate is worse than the plain median of v2's own models.** v2 picks the base model with the lowest
   spread on the backtest. On live outcomes this loses to `median(models)` everywhere for rep (held-out median |log
   error|: rep >3h 0.288 vs 0.038; rep <20m 0.110 vs 0.063), because the backtest ranking does not transfer.

### D5. Regime breaks vs ordinary noise
- **Installs / destroys (between-run breaks).** 43% of all predictions never resolve because an install resets the
  metric first (rep >3h 63%, money >3h 59%). These are right-censored: the outcome is "not before the install". The
  live metric ignores them; it should not ignore the ones that are certain misses. A band whose upper end falls before
  the install is a definite miss: 20.7% of v2's held-out voided predictions (203 of 980). Base models never fit across
  an install (runs are split at `lastAug` changes), so the problem is censoring and calibration, not extrapolation.
- **Within-run breaks.** Joining the 533 live outcomes inside the 7-day telemetry window with what changed between
  prediction and outcome:

| kind | break | outcomes with break | v2 median log error with / without | share of v2 squared log error from outcomes with any break |
|---|---|---|---|---|
| rep | faction work switched | 21 of 324 | 1.25 / 0.04 | 69% (35% of outcomes) |
| rep | worker count x2 or /2 | 90 of 324 | 0.16 / 0.04 | |
| money | home RAM upgraded | 74 of 180 | 1.42 / 0.30 | 74% (47% of outcomes) |
| level | worker count x2 or /2 | 22 of 29 | 0.35 / 0.39 | 87% (83% of outcomes) |

  About 70% of the squared error comes from outcomes that cross a within-run regime change the models cannot see
  coming (the autopilot switches work, buys RAM, the daemon resizes). That part is irreducible for a pure
  time-series predictor; a calibrated band has to be wide enough to cover it.
- **Cycle phase.** Errors are largest right after an install: v2 money median log error 1.04 in the first hour of a
  cycle vs 0.51 after 4 h; rep 0.175 vs 0.020.

## Plan
1. Offline harness `scripts/predictor-backtest.js` (plain Node, deterministic, no game access): rolling origin over the
   logged live predictions. Each prediction is re-predicted using only outcomes whose resolution time (`r.at`) is
   before it was made. Baseline "v2" is the band v2 actually logged. Candidates use the same raw per-model durations v2
   logged (`p.preds`), so every candidate sees exactly the information v2 had.
2. Hyper-parameters chosen on the first half of the timeline (tuning) by interval score plus a coverage penalty
   outside 78-82%; everything reported on the second half (held-out, 2026-10-21 → 2026-11-14), plus four rolling folds
   and block-bootstrap CIs over install cycles. Censored predictions reported separately (definite misses).
3. Metrics per kind x bucket, decision buckets, overall and per cycle phase: coverage (+95% CI), early / late miss
   rates, median |log error| (point accuracy), MdAPE, bias, interval score (Gneiting-Raftery, log space, alpha 0.2),
   mean pinball loss at 0.1/0.5/0.9, median band width, PIT histogram, lag-1 autocorrelation, effective n.
4. Candidates (all online, per kind x bucket cell, pooled toward kind and all):
   - (a) adaptive conformal band: decayed empirical quantiles of the honest residual ln(actual/point) (residual
     measured against the point as it was predicted at the time), levels adapted online by ACI (Gibbs & Candes 2021)
     separately for each edge; variants with online quantile tracking of the edges (conformal PID, P term), a
     cluster-robust band (each target weighted once; one ACI step per resolution batch);
   - (b) locally adaptive band: residuals normalised by the base models' dispersion (normalised conformal), i.e. a
     quantile model on the strongest available feature;
   - (c) regime-aware cells: kind x bucket x cycle phase (time since install); and on telemetry, regime-aware base
     models (local-linear-trend Kalman filter restarted at each install, exponential rate-trend, log-linear);
   - (d) hierarchical shrinkage of cell quantiles toward the parent by n/(n+K);
   - (e) ensemble / stacking: softmax weights from decayed **prequential** losses over raw and bias-corrected base
     models, their median, and v2's own calibrated point; a single-best-model variant; plain median.
5. Ship the simplest candidate that wins out of sample, behind `predictor.version` (default `v2`).

## Results
Pending: filled in from the full backtest run (tuning grid + held-out) before the implementation is marked ready.

## Implementation
- `game/lib/predcal.js` (new, pure ES module, no imports, no `ns`, no RAM-costing names): `replay()` (rolling origin),
  `createCalibrator()`, `applySnapshot()`, `validateSnapshot()`, `liveCoverage()`, `samplesFromLog()`. `DEFAULTS` are
  the tuned options. One code path for the backtest, the tests and the game (no train/serve skew).
- `game/agent/predictor.txt` (runs in the page, not a Netscript script: zero game RAM): loads `lib/predcal.js` through
  `bb.read` + `new Function` (strip `export`). `calibrate()` (already run on new outcomes or every 2 h) also replays the
  last 5,000 predictions into a v3 snapshot and computes `liveCoverage`; both go into `data/pred-calib.txt` (`v3`,
  `liveCoverage`) in every mode, so v3 is warm before the switch. `predict()` always computes v2; with
  `predictor.version=v3` and a valid snapshot (version 3, not older than 6 h, finite) it answers with v3 and stores
  v2's answer in `v2eta/v2lo/v2hi`. Otherwise it answers with v2 and records `v3fallback`. `resolve()` adds
  `v2inBand` for v3 records (live A/B against the shadow baseline). `report()` adds `version`, `v3` status, `live3`
  (coverage of v3-answered predictions and v2's shadow coverage on the same outcomes) and `liveCoverage`.
- `game/agent/checkin-lib.txt`: forwards the predictor's attention items; the Predictions row shows `v3 ·` or
  `v3→v2 fallback ·` and, once v3 has scored predictions, its own coverage next to v2's shadow coverage.
- `game/lib/settings-schema.js`: group `predictor`, keys `predictor.version` (v2 | v3, default v2),
  `predictor.alertWindow` (50), `predictor.alertMinN` (30).
- RAM: no Netscript script imports any changed file except `lib/settings-schema.js` (data only). `autopilot.js` is
  untouched (no new ns calls); `test/ram-xp-static.js` still passes with the unchanged baseline.

## Detectors (ledger signal for F-002)
- `data/pred-calib.txt` `liveCoverage`: per kind|bucket, last `predictor.alertWindow` resolved predictions of the active
  version (records without `v` are v2): `{n, cov, total}` and `alerts`.
- Check-in attention `predictor <version> 80% band coverage outside 70-90% in <cells> (data/pred-calib.txt liveCoverage)`
  when a cell has at least `predictor.alertMinN` such predictions and coverage outside [0.70, 0.90]. The text carries
  no numbers, so an unchanged problem keeps the same escalation key (server/checkin.js hashes the attention list).
  False-alarm rate: with a true 80% and n = 50 independent outcomes, P(outside 70-90%) is about 8% per cell; with the
  measured autocorrelation it is higher. That is acceptable for a flag that only names cells; raise `alertMinN` if noisy.
- Check-in attention `predictor v3 calibration <missing|stale|invalid>: answering with v2 (rollback: ...)` whenever the
  version is v3 and v3 cannot answer from its calibration. Never silent.

## Rollout and rollback
Merge → Railway deploy → confirm the deployed commit → `bb push lib/predcal.js agent/predictor.txt agent/checkin-lib.txt
lib/settings-schema.js agent/PLAYBOOK.txt` → the next check-in evals the new predictor (no process restart needed: the
check-in re-evals `agent/predictor.txt` every time) → check `data/pred-calib.txt` has `v3` and `liveCoverage` →
`bb settings set predictor.version=v3` → after 24 h read `report().live3` (v3 vs v2 shadow coverage on the same
outcomes). Rollback: `bb settings set predictor.version=v2` (instant, next check-in).

## Non-goals / follow-ups
- New base models in `predictor.txt` (see Results: the regime-aware models did not beat the existing ones where live
  errors are). A work-switch-aware rep model (predict the rate for the faction the autopilot will work for, not the
  current slope) and a spend-aware money model are the real next steps for point accuracy.
- Censoring-aware band fitting (Kaplan-Meier quantiles). Evaluated against the hits-only live metric it would widen
  bands past 80% on resolved outcomes; it is the right target only if the owner wants "reached before the install" in
  the metric.
- Moving install recovery time (aug-planner) onto the predictor.
