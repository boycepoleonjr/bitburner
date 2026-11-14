# Spec: predictor v3 — online ensemble + adaptive conformal bands (F-002)

Status: implemented 2026-11-14 behind `predictor.version` (default v2). The plan (Diagnosis, Plan) was committed before the game code; Results and Decision are from the offline backtest.
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
Reproduce: `node scripts/predictor-backtest.js data/pred2.txt --install-log data/install-log.txt` (about 15 min with the
144-point grid; `--no-tune` about 1 min). Tuning half: predictions made before 2026-10-21 08:21 UTC; held-out: after
(1,222 resolved, 61 install cycles, 980 voided). The tuning half was much easier than the held-out half (BN5 end, BN2,
then BN10 with many installs): for the same model, level median log error went from 0.05 to 0.66 and money from 0.10
to 0.76 between the halves. Every number below is held-out unless marked.

### R1. Candidates, held-out (ablations share the shipped settings except the one named)
| candidate | coverage [95% CI] | median log err | MdAPE % | interval score | pinball | median width | decision cov [CI] | decision median log err | decision IS | censored definite miss |
|---|---|---|---|---|---|---|---|---|---|---|
| **v2 as logged (baseline)** | 0.528 [0.401, 0.639] | 0.204 | 20.5 | 4.286 | 0.2357 | 0.28 | 0.525 [0.389, 0.653] | 0.152 | 3.914 | 20.7% |
| (a) plain median + ACI band | 0.757 [0.680, 0.832] | 0.093 | 9.6 | 3.267 | 0.2054 | 1.74 | 0.757 [0.674, 0.840] | 0.060 | 3.025 | 2.4% |
| (e-) single best member (prequential) | 0.762 [0.698, 0.820] | 0.140 | 14.1 | 3.087 | 0.1908 | 1.37 | 0.765 [0.699, 0.829] | 0.084 | 2.787 | 3.4% |
| (b) band scaled by model dispersion | 0.691 [0.557, 0.809] | 0.114 | 11.6 | 4.417 | 0.2385 | 0.70 | 0.680 | 0.079 | 3.777 | 2.4% |
| (c) cells split by cycle phase | 0.713 [0.622, 0.798] | 0.117 | 11.7 | 3.289 | 0.1963 | 0.99 | 0.712 | 0.078 | 3.043 | 3.7% |
| (d off) no hierarchical shrinkage | 0.714 [0.641, 0.800] | 0.114 | 11.6 | 3.180 | 0.1973 | 1.59 | 0.710 | 0.079 | 2.908 | 3.4% |
| (a') + quantile tracking (PID, P term) | 0.728 [0.600, 0.827] | 0.114 | 11.6 | 3.761 | 0.2167 | 2.07 | 0.720 | 0.079 | 3.566 | 2.1% |
| (a'') cluster-robust band (not selected) | 0.781 [0.704, 0.865] | 0.114 | 11.6 | 3.151 | 0.1963 | 2.19 | 0.777 [0.698, 0.863] | 0.079 | 2.884 | 2.8% |
| **v3 shipped** (a+d+e, tuned) | **0.729 [0.651, 0.818]** | **0.114** | **11.6** | **3.181** | **0.1973** | 1.59 | **0.722 [0.635, 0.820]** | **0.079** | **2.921** | **3.2%** |

Decision buckets = what drives install timing (every rep bucket: next-aug rep) and the destroy / long ETAs (level 1-3h
and >3h, money >3h). "Censored definite miss" = share of install-voided predictions whose band ended before the install.

Tuning (first half only, objective = interval score + 10 x (|coverage - 0.8| - 0.02)+, 144 configurations over
point mode {ensemble tau 0.1 / 0.3, median} x half-life {72 h, none} x ACI gamma {0, 0.03, 0.1} x quantile tracking
{0, 0.02} x cluster-robust weights {off, on} x batched ACI {off, on}): winner ensemble, tau 0.3, no decay, gamma 0.1,
no tracking, no cluster weights (tuning coverage 0.779, interval score 2.84). Runners-up within 0.03 objective all
used the ensemble with no decay. These are `DEFAULTS` in `lib/predcal.js`. The cluster-robust variant (a'') reaches
78% held-out but ranked 118th of 144 on the tuning half (objective 3.61: coverage 0.83, interval score 3.51); shipping it because of the held-out number would be
tuning on the test set, so it is reported, not shipped (see "Needs a decision").

Rolling folds (whole timeline in four consecutive blocks, every prediction out of sample): v3 coverage 0.806 / 0.769 /
0.674 / 0.770, v2 0.537 / 0.589 / 0.474 / 0.569. Fold 3 (late Oct, many installs) is the hard regime for both.

PIT histogram held-out, ten bins: v2 `295 74 45 57 83 116 109 90 71 282`, v3 `133 80 80 103 204 151 154 72 47 198`
(flat = 122 per bin). v3 removes most of the U shape; the remaining excess in the top bin is late outcomes (money
spending, work switches).

### R2. Per bucket, held-out (v2 -> v3)
| cell | n | install cycles | v2 coverage [CI] | v3 coverage [CI] | v2 median log err | v3 | change | v2 IS | v3 IS |
|---|---|---|---|---|---|---|---|---|---|
| level <20m | 15 | 13 | 0.467 [0.23, 0.69] | 0.800 [0.60, 1.00] | 0.364 | 0.249 | -32% | 2.70 | 2.72 |
| level 20-60m | 12 | 10 | 0.500 [0.18, 0.75] | 0.500 [0.21, 0.83] | 0.280 | 0.283 | +1% | 2.69 | 2.80 |
| level 1-3h | 18 | 12 | 0.444 [0.13, 0.70] | 0.778 [0.63, 0.94] | 0.408 | 0.330 | -19% | 2.70 | 1.80 |
| level >3h | 88 | 8 | 0.102 [0.02, 0.52] | 0.761 [0.70, 0.97] | 0.877 | 0.980 | +12% | 9.67 | 3.81 |
| money <20m | 35 | 21 | 0.343 [0.21, 0.50] | 0.714 [0.54, 0.85] | 1.335 | 1.571 | +18% | 13.79 | 7.21 |
| money 20-60m | 61 | 31 | 0.607 [0.45, 0.76] | 0.803 [0.70, 0.91] | 0.419 | 0.396 | -5% | 5.18 | 4.36 |
| money 1-3h | 76 | 28 | 0.605 [0.41, 0.81] | 0.789 [0.67, 0.91] | 0.487 | 0.358 | -26% | 4.77 | 4.04 |
| money >3h | 239 | 28 | 0.423 [0.22, 0.66] | 0.565 [0.32, 0.83] | 0.668 | 0.896 | +34% | 5.68 | 5.04 |
| rep <20m | 167 | 37 | 0.587 [0.43, 0.69] | 0.790 [0.69, 0.87] | 0.110 | 0.045 | -59% | 2.19 | 2.01 |
| rep 20-60m | 139 | 37 | 0.878 [0.82, 0.93] | 0.871 [0.81, 0.92] | 0.026 | 0.013 | -50% | 0.57 | 0.46 |
| rep 1-3h | 176 | 29 | 0.739 [0.63, 0.83] | 0.841 [0.73, 0.92] | 0.026 | 0.014 | -46% | 0.57 | 0.62 |
| rep >3h | 196 | 20 | 0.352 [0.15, 0.61] | 0.622 [0.44, 0.82] | 0.288 | 0.082 | -72% | 6.13 | 4.63 |

By cycle phase (v2 -> v3 coverage): rep first hour 0.43 -> 0.77, 1-4 h 0.60 -> 0.72, after 4 h 0.72 -> 0.83; money
0.28 -> 0.49, 0.56 -> 0.75, 0.48 -> 0.63; level 0.36 -> 0.68, 0.44 -> 0.76, 0.11 -> 0.76.

### R3. Regime-aware base models on telemetry (candidate c), not shipped
Walk-forward over the 7 days of telemetry, 8,114 synthetic targets, 22 runs, median |log error| by bucket of the
actual duration. Existing models vs new ones: a local-linear-trend Kalman filter (state restarted at each install),
an exponential rate-trend model (ln rate linear in time, integrated to the target) and a log-linear model.
- Long horizons (1-3h, >3h): the existing s45 / median are already at 0.00-0.03; Kalman 0.00-0.06, rate-trend
  0.00-0.12, log-linear 0.02-0.42. No gain.
- Short-horizon level (<20m, 20-60m): rate-trend 0.15-0.17 vs median 0.22-0.23 (a gain), Kalman 0.19-0.22.
- The gains sit where live errors are smallest. Live errors come from within-run breaks (D5) that no trend model
  sees coming. Adding a base model changes every logged `preds` vector and restarts the stacking history for it, so
  it is a follow-up (a work-switch-aware rep model is the better target).

### R4. Acceptance check (honest)
- Coverage 75-85% on held-out overall: **not met by the shipped v3: 72.9%, 95% CI 65.1-81.8%** (the CI contains 75-80%).
  v2: 52.8% [40.1, 63.9]. The pre-registered tuning picked v3; the one candidate inside 75-85% (a'', 78.1%) was not
  selected on the tuning half. Cause: the held-out half is a harder regime than the tuning half (fold 3), and long
  buckets have very few independent install cycles (D3), so the online band learns the shift late.
- Every bucket with >= 30 held-out outcomes inside 75-85%: **5 of 9 for v3** (level >3h 0.761, money 20-60m 0.803,
  money 1-3h 0.789, rep <20m 0.790, rep 1-3h 0.841), **v2: 0 of 9**. Outside: rep 20-60m 0.871 (slightly wide; v2 0.878),
  money <20m 0.714, rep >3h 0.622, money >3h 0.565. Buckets under 30: level <20m 0.800 (n 15), level 20-60m 0.500 (12),
  level 1-3h 0.778 (18).
- Median error -15% on the decision buckets: **met in aggregate (0.152 -> 0.079, -48%) and for every rep bucket
  (-46% to -72%, install timing)**. **Not met for the destroy ETA (level >3h: 0.877 -> 0.980, +12%) and money >3h
  (0.668 -> 0.896, +34%).** Data limitation: level >3h has 88 held-out outcomes but only 8 install cycles (lag-1
  autocorrelation 0.80, effective n about 10); one target is re-predicted all cycle, so the ensemble cannot learn its
  bias from more than a handful of independent cases, and the bias jumps between cycles (median -0.85 in v2's own
  errors held-out vs -0.05 on the tuning half). Money >3h has 41 distinct money targets in the whole log, and 74% of
  its squared error comes from outcomes that cross a home-RAM purchase (D5); v2's money point uses the 16k-sample
  telemetry table, which the prequential weights (28 cycles) do not reliably pick. The band side does improve there
  (interval score 9.67 -> 3.81 and 5.68 -> 5.04).
- Censored predictions: band ends before the install in 3.2% of voided predictions (v2: 20.7%).

## Decision
Ship (a+d+e) as v3: prequential ensemble (raw and bias-corrected base models, their median, v2's own point) +
per-edge adaptive conformal band on kind x bucket cells, shrunk toward kind and all, tuned on the first half. Not
shipped: (b) dispersion scaling (worse everywhere), (c) cycle-phase cells and regime-aware base models (sparser, no gain
where errors are), quantile tracking (worse interval score), decay (lost on the tuning half). Default stays v2;
rollout is one setting.

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
1. Merge; wait for the Railway deploy and confirm the deployed commit contains the merge (the server validates
   settings against the deployed `lib/settings-schema.js`).
2. `bb settings set predictor.version=v3` **before** the push. The old predictor ignores the key. Setting it first
   means the coverage window counts only v3 predictions from the start; pushing with v2 active would make the first
   check-in flag v2's known-bad buckets (correct, but it fires an escalation for F-002, which is already known).
3. `bb push lib/predcal.js agent/predictor.txt agent/checkin-lib.txt lib/settings-schema.js agent/PLAYBOOK.txt`. No
   process restart: every check-in re-evals `agent/predictor.txt`. The first check-in finds no `v3` entry in
   `data/pred-calib.txt` and calibrates at once (about 3.3 s in Node for 5,000 predictions; the snapshot is about 12 KB).
4. Verify: `bb read data/pred-calib.txt` has `v3` (v 3, recent t) and `liveCoverage`; the Predictions row says `v3 ·`.
5. After 24 h: `report().live3` = coverage of v3-answered predictions next to v2's shadow coverage on the same
   outcomes (`v2inBand`), plus `liveCoverage` per bucket.
Rollback: `bb settings set predictor.version=v2` (next check-in). The v3 calibration keeps running in shadow.

## Non-goals / follow-ups
- New base models in `predictor.txt` (see Results: the regime-aware models did not beat the existing ones where live
  errors are). A work-switch-aware rep model (predict the rate for the faction the autopilot will work for, not the
  current slope) and a spend-aware money model are the real next steps for point accuracy.
- Censoring-aware band fitting (Kaplan-Meier quantiles). Evaluated against the hits-only live metric it would widen
  bands past 80% on resolved outcomes; it is the right target only if the owner wants "reached before the install" in
  the metric.
- Moving install recovery time (aug-planner) onto the predictor.
