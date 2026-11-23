# Predictor lab log (F-002)

One pre-registered experiment per run of the "Bitburner predictor lab" routine. Each entry is written BEFORE the
experiment runs (hypothesis, windows, metric, acceptance rule) and the result is appended after. Negative results stay.
Data is a read-only snapshot of the live game (`POST /api/ro/read`), never committed. Backlog order: (a) hybrid point,
(b) regime-aware reset prior, (c) install-aware censoring, (d) cycle-phase cells with shrinkage, (e) quantile regression
+ conformal, (f) local-linear-trend / change-point base model, (g) ensemble weights by recent pinball loss with forgetting.

Standing acceptance rule (every experiment): held-out interval score improves by >= 5% with a block-bootstrap 95% CI
(resampling install cycles) of the paired difference that excludes 0; median |log error| no worse than +10% on any
held-out kind x bucket with n >= 30; overall 80%-band coverage moves toward 80%; RAM/CPU limits of
docs/specs/predictor-v3.md hold (pure predcal.js, no new ns calls, calibration time about the same).

## Snapshot limits (read before comparing runs)
`/api/ro/read` returns at most the last 2,000,000 bytes of `data/pred2.txt`, so a lab snapshot starts later than the
v3 PR's full-file snapshot (first prediction 2026-09-27). Lab numbers are recomputed on the lab snapshot for both the
baseline and the candidate; they are not directly comparable with the PR #52 tables.

---

## Run 2026-11-16 — experiment (a): hybrid point per cell

Data: snapshot 2026-11-16 ~13:15 UTC. `pred2.txt` tail: 4,060 predictions (first 2026-10-08 13:34 UTC), 2,336 resolved
with their prediction present, 1,707 voided by an install; `install-log.txt` 164 installs. New since the v3 PR snapshot
(2026-11-14 03:10 UTC): 342 resolved outcomes (317 answered by v3 live, live since 2026-11-14 04:45 UTC).

### Pre-registration (written before the experiment ran)
- Hypothesis: v3's ensemble point is worse than a simpler point (v2's own logged point, or the plain median of the base
  models) in a few long-horizon cells (PR #52: level >3h +12%, money >3h +34% median error). Using the better point in
  those cells and calibrating v3's conformal band around it (honest residuals against the point actually used, same
  ACI + shrinkage) lowers point error there and, because the residual spread shrinks, the interval score.
- Windows: tuning = predictions made before the median `made` time of the snapshot (2026-10-29 22:11 UTC; 1,205
  resolved); held-out = made at or after it (1,131 resolved). Replay is rolling-origin over the whole snapshot (no
  look-ahead); only the cell choice is fit, on tuning rows only.
- Selection rule (tuning half only): for each kind x bucket with >= 30 tuning outcomes, compare the median |log error|
  of v3's point, v2's logged point and the base-model median; override the cell with the best alternative only if it
  beats v3's point by >= 10%. The override set is frozen before held-out rows are scored.
- Candidate: shipped `DEFAULTS` plus `pointOverride = {cell: "v2" | "med"}` for the chosen cells (band = v3's
  conformal band computed on residuals of the overridden point). A literal variant (v3's lo/hi kept, only the point
  swapped) is reported for point error only: its interval score equals v3's by construction.
- Metric: held-out interval score (log space, alpha 0.2), paired difference candidate - v3 with a 95% block bootstrap
  over install cycles (2,000 resamples, seed 7); secondary: median |log error| per bucket, coverage.
- Acceptance: the standing rule above.

### Baseline backtest (shipped v3 `DEFAULTS`, lab snapshot; 95% block-bootstrap CIs over install cycles)
| window | n | cycles | v2 coverage | v3 coverage [CI] | v2 IS | v3 IS [CI] | v2 median log err | v3 median log err [CI] |
|---|---|---|---|---|---|---|---|---|
| PR #52 held-out (2026-10-21 08:21 → 11-14 03:10) | 1,231 | 45 | 0.530 | 0.769 [0.680, 0.847] | 4.27 | 3.20 [2.39, 4.01] | 0.204 | 0.120 [0.052, 0.275] |
| PR #52 as published (full file) | 1,222 | 61 | 0.528 | 0.729 [0.651, 0.818] | 4.29 | 3.18 | 0.204 | 0.114 |
| new since v3 snapshot (made ≥ 11-14 03:10) | 333 | 6 | 0.616 | 0.865 [0.747, 0.886] | 2.59 | 2.49 [1.94, 4.07] | 0.165 | 0.161 [0.045, 0.606] |
| lab held-out (made ≥ 10-29 22:11) | 1,131 | 34 | 0.560 | 0.811 [0.719, 0.867] | 3.69 | 2.91 [2.29, 3.80] | 0.195 | 0.147 [0.067, 0.267] |

Paired v3 − v2 interval score: lab held-out −0.77 [−1.87, −0.02]; new data −0.10 [−1.62, +0.47] (6 cycles, not
significant). Censored definite misses, lab held-out: v2 20.0%, v3 3.2%. Calibration replay of 4,060 predictions: 3.1 s.
v3 now slightly over-covers on new data (86.5%; rep 20-60m 0.97, level >3h 0.94), matching the live check-in (86%).

### Result
Override set chosen on the tuning half (>= 10% better than v3's point there): money >3h → v2, money 20-60m → v2,
rep >3h → med, rep 1-3h → med, level >3h → med.

| held-out | v3 | hybrid | change |
|---|---|---|---|
| interval score | 2.912 | 3.067 | +5.3% (worse), paired CI [−0.001, +0.362] |
| coverage | 0.811 | 0.799 | toward 80% |
| median log err, money >3h (n 194) | 0.766 | 0.578 | −25% |
| median log err, money 20-60m (n 58) | 0.468 | 0.578 | +24% |
| median log err, rep >3h (n 209) | 0.125 | 0.192 | +54% |
| median log err, rep 1-3h (n 138) | 0.013 | 0.013 | 0% |
| median log err, level >3h (n 105) | 0.963 | 0.980 | +2% |

Verdict: **rejected.** Interval score is worse, not 5% better, and two buckets with n >= 30 lose more than 10% point
accuracy. Same direction on the PR #52 window (+1.6%) and on the new data (+3.2%). The literal variant (v3 band kept)
has the hybrid's point errors and v3's interval score, so it fails the same rule.

Learned: per-cell point rankings from the tuning half mostly do not transfer (rep >3h median was 35% better than v3 on
tuning and 54% worse held-out; level >3h 65% better, then 2% worse). The prequential ensemble already adapts to this.
The one ranking that held in all three windows is money >3h → v2's point (tuning −24%, held-out −25%, new −32%).
That was found after looking at held-out data, so it is a hypothesis, not a result. If it is tested, it gets its own
pre-registration and only data made after 2026-11-16 13:15 UTC counts as held-out.

---

## Run 2026-11-23 — experiment (b): regime-aware reset prior (within-cycle offset)

Data: snapshot 2026-11-23 ~13:15 UTC. `pred2.txt` tail (2 MB cap): 3,807 predictions (first 2026-10-31 02:52 UTC),
2,167 resolved with their prediction present, 1,602 voided by an install; `install-log.txt` 173 installs. New since
the 2026-11-16 run (made >= 11-16 13:15 UTC): 1,037 resolved outcomes in 11 install cycles. The snapshot now starts
after the 2026-11-16 one, so the replay starts cold on 2026-10-31 for every candidate.

### Pre-registration (written before the experiment ran)
- Hypothesis: v3 carries the state of earlier cycles straight into each new install cycle; nothing in it knows that
  outcomes from the current cycle share one regime (faction, rep multiplier, RAM, spend pattern; lag-1 autocorrelation
  0.6-0.8 in the long buckets). Treat the pooled cross-cycle v3 model as the prior every cycle starts from, and learn a
  per-cycle log offset from the honest residuals ln(actual / v3 point) of outcomes in the SAME install cycle (same
  `lastAug`) and kind that were known before the prediction was made: offset = median(residuals) x n / (n + K). At a
  reset n = 0, so the cycle starts exactly at the prior (no extrapolation from the previous cycle's tail). The offset
  shifts the point and both band edges (band width unchanged). This should cut point error and the interval score in
  the long buckets, where one cycle's bias dominates.
- Grid (tuning half only): K in {5, 15, 40} x scope in {kind, kind x bucket}. Pick the lowest tuning interval score;
  frozen before held-out rows are scored.
- Windows: the backtest's own split. Tuning = predictions made before 2026-11-16 08:43 UTC (the median `made` time of
  the snapshot); held-out = made at or after it. The held-out half is almost entirely data no earlier experiment saw.
  Replay is rolling-origin (the offset only uses outcomes with knownAt <= made).
- Metric: held-out interval score (log space, alpha 0.2), paired difference candidate - v3 with a 95% block bootstrap
  over install cycles (2,000 resamples, seed 7); secondary: median |log error| per kind x bucket, coverage.
- Acceptance: the standing rule above.

### Baseline backtest (shipped v3 `DEFAULTS`, 2026-11-23 snapshot; 95% block-bootstrap CIs over install cycles)
| window | n | cycles | v2 coverage [CI] | v3 coverage [CI] | v2 IS | v3 IS [CI] | v2 median log err | v3 median log err [CI] |
|---|---|---|---|---|---|---|---|---|
| before the 11-16 run (made < 11-16 13:15) | 1,084 | 33 | 0.585 [0.48, 0.67] | 0.773 [0.65, 0.85] | 3.27 | 3.33 [2.52, 4.39] | 0.179 | 0.143 [0.07, 0.24] |
| new since the 11-16 run | 1,037 | 11 | 0.631 [0.51, 0.73] | 0.721 [0.59, 0.82] | 3.61 | 3.19 [2.01, 4.91] | 0.169 | 0.127 [0.07, 0.24] |
| lab held-out (made >= 11-16 08:43) | 1,073 | 12 | 0.634 [0.52, 0.73] | 0.721 [0.59, 0.81] | 3.54 | 3.14 [2.00, 4.72] | 0.167 | 0.120 [0.07, 0.23] |

Paired v3 − v2 interval score: held-out −0.40 [−1.50, +0.11]; new data −0.42 [−1.68, +0.11] (not significant).
Compared with the 2026-11-16 log, v3's coverage on new data fell from 0.865 (6 cycles) to 0.721 (11 cycles), while
point error improved (0.161 → 0.127). Held-out v3 by bucket (n >= 30): rep >3h 0.584 [0.32, 0.77] (n 320), level >3h
0.535 [0.05, 1.00] (n 43, 4 cycles), money >3h 0.698 [0.53, 0.81], money 1-3h 0.739, rep <20m 0.833, rep 20-60m 0.856,
rep 1-3h 0.869. Live liveCoverage (last 50 per cell, 2026-11-23 12:46 UTC) flags the same cells: rep >3h 0.40,
money >3h 0.50, level >3h 0.54, money 1-3h 0.68. Censored definite misses held-out: v2 10.7%, v3 8.9%. Replay of
3,807 predictions: about 1.5 s per candidate.

### Result
Chosen on the tuning half: K = 15, scope = kind (tuning interval score 3.380 → 3.281, −2.9%).

| held-out | v3 | candidate (b) | change |
|---|---|---|---|
| interval score | 3.141 | 3.224 | +2.6% (worse), paired CI [+0.008, +0.156] |
| coverage | 0.721 | 0.651 | away from 80% |
| median log err, rep >3h (n 320) | 0.111 | 0.153 | +38% |
| median log err, rep 1-3h (n 191) | 0.007 | 0.020 | +186% |
| median log err, rep 20-60m (n 104) | 0.011 | 0.020 | +82% |
| median log err, rep <20m (n 60) | 0.030 | 0.062 | +107% |
| median log err, money >3h (n 182) | 0.630 | 0.629 | 0% |
| median log err, money 1-3h (n 88) | 0.594 | 0.606 | +2% |
| median log err, level >3h (n 43) | 0.899 | 0.905 | +1% |

Verdict: **rejected.** The held-out interval score is significantly worse (the CI excludes 0 on the wrong side),
every rep bucket loses far more than 10% point accuracy, and coverage moves away from 80%. No grid point beat v3 on
the held-out half either (3.154 to 3.322 vs 3.141; reported, not used for selection).

Learned: the same-cycle residual is not a usable regime signal. The tuning-half gain (−2.9%) reversed out of sample,
as in experiment (a). Pooling by kind lets the large >3h residuals shift the already accurate short rep points; the
per-bucket scope has too few same-cycle outcomes before the long targets resolve. The live problem is now
under-coverage in the long buckets (rep >3h, level >3h, money >3h), which a point shift does not fix. The next
backlog items that target it directly are (c) install-aware censoring and (d) cycle-phase cells with shrinkage.
