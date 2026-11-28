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

PR policy (owner, 2026-11-24): every run opens its own non-draft PR for its log entry, any day of the week, changing
only this file. This replaces "Mondays only" in the routine prompt. Never leave a lab branch without a PR.

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

## Run 2026-11-17 — experiment (b): regime-aware reset prior

Data: snapshot 2026-11-17 ~13:15 UTC. `pred2.txt` tail (2 MB cap): 4,028 predictions (first 2026-10-12 07:37 UTC),
2,352 resolved, 1,658 voided by an install; `install-log.txt` 166 installs. New since the 2026-11-16 run: 202 resolved
outcomes (known at or after 2026-11-16 13:15 UTC), 193 of them made after it.

### Pre-registration (written before the experiment ran)
- Hypothesis: the base models extrapolate rates measured across the install reset, so early-cycle predictions of
  recurring targets (same kind, faction and target value; 66 rep and 28 money targets recur in >= 3 cycles) are biased.
  A new ensemble member `pri` built only from earlier cycles — the time since install at which the same target was
  reached in each earlier cycle (median per cycle, then median over the last K cycles), minus the current time since
  install — gives the prequential ensemble an anchor that does not extrapolate across the reset. Expected: lower point
  error on rep and money (all horizons), therefore narrower honest residuals and a lower interval score.
- Member rules (no look-ahead): only outcomes with knownAt <= made and an earlier `lastAug` count; at least `minCycles`
  earlier cycles with the same `tkey`; the member is offered only if the prior is > 60 s. It is never part of `med`
  and gets weight only through the existing prequential loss (minModelN 8, tau 0.3). Bands unchanged (v3 conformal on
  the honest residual of whatever point the ensemble produced).
- Windows: tuning = made before the snapshot's median made time (2026-11-04 14:05 UTC; 1,173 resolved); held-out = made
  at or after it (1,179 resolved, 40 install cycles). Replay is rolling-origin over the whole snapshot.
- Tuning (tuning half only): K in {3, 5, all} x minCycles in {2, 3}, chosen by the backtest objective (interval score +
  coverage penalty). Frozen before held-out rows are scored.
- Metric: held-out interval score (log space, alpha 0.2), paired difference candidate − v3 with a 95% block bootstrap
  over install cycles (2,000 resamples, seed 7); secondary: median |log error| per kind x bucket, coverage. Also
  reported on rows made after 2026-11-16 13:15 UTC (never seen by any lab run).
- Acceptance: the standing rule above.

### Baseline backtest (shipped v3 `DEFAULTS`, this snapshot; 95% block-bootstrap CIs over install cycles)
| window | n | cycles | v2 coverage | v3 coverage [CI] | v2 IS | v3 IS [CI] | v2 median log err | v3 median log err [CI] | paired v3 − v2 IS [CI] |
|---|---|---|---|---|---|---|---|---|---|
| this run's held-out (made ≥ 11-04 14:05) | 1,179 | 33 | 0.595 | 0.781 [0.687, 0.855] | 3.23 | 2.74 [2.12, 3.55] | 0.178 | 0.138 [0.071, 0.219] | −0.48 [−1.41, +0.11] |
| 2026-11-16 lab held-out (made ≥ 10-29 22:11) | 1,333 | 36 | 0.572 | 0.778 [0.701, 0.844] | 3.65 | 2.85 [2.27, 3.60] | 0.196 | 0.152 [0.083, 0.270] | −0.80 [−1.88, −0.02] |
| new since 2026-11-16 run (made ≥ 11-16 13:15) | 193 | 3 | 0.663 | 0.617 [0.306, 0.782] | 3.39 | 2.49 [1.17, 4.93] | 0.193 | 0.191 [0.078, 1.196] | −0.91 [−2.94, +0.18] |

Same-window comparison with the 2026-11-16 run (made ≥ 10-29 22:11): coverage 0.811 → 0.778, interval score 2.91 → 2.85,
median log error 0.147 → 0.152 (the snapshot also lost its oldest four days to the 2 MB cap). The new rows are the
story: v3 covers only 61.7%, with 34% of outcomes EARLY (reached before the lower edge). It is concentrated in rep >3h
(new rows n 62: coverage 0.26, early 0.71), matching live `liveCoverage` rep|>3h 0.46 and the open check-in attention.
Censored definite misses (held-out): 3.2%. Calibration replay of 4,028 predictions: 3.4 s (candidate 3.4 s).

### Result
Tuning half chose K = 3, minCycles = 2 (objective 3.280 vs v3 3.312; every grid point within 0.04). The member was
offered on 771 tuning and ~550 held-out predictions, but the prequential ensemble gave it little weight (mean weight
0.2-4% per cell; highest money <20m 4.1%, money >3h 2.7%, rep >3h 1.7%).

| held-out (made ≥ 11-04 14:05) | v3 | prior member | change |
|---|---|---|---|
| interval score | 2.742 | 2.718 | −0.9%, paired CI [−0.066, +0.028] |
| coverage | 0.781 | 0.779 | away from 80% (slightly) |
| median log err, rep 1-3h (n 159) | 0.013 | 0.016 | +23% (fails the 10% rule) |
| median log err, money <20m (n 32) | 1.177 | 0.921 | −22% |
| median log err, money >3h (n 224) | 0.785 | 0.743 | −5% |
| median log err, other buckets n ≥ 30 | — | — | within ±4% |
| new rows (made ≥ 11-16 13:15), IS | 2.486 | 2.450 | −1.4%, paired CI [−0.074, +0.041] (3 cycles) |

Verdict: **rejected.** Interval score improves 0.9%, not 5%, and its CI includes 0; rep 1-3h point error is 23% worse.

Learned: a "same target, earlier cycles" anchor is mostly redundant with the base models plus per-cell bias
correction; the ensemble already learns not to trust it. It helps a little on money (<20m −22%, >3h −5%), where
spending inside a cycle breaks the rate models, but not enough to move the band. The bigger, newer problem is rep >3h
going early since ~2026-11-16 (outcomes arrive far sooner than any model predicts, and ACI is not catching up within
the 50-outcome window). Donations are not the cause (last `donate` in audit.txt: 2026-11-12 12:55 UTC). To check
next: a work switch or a jump in share RAM that raised the rep rate after the predictions were made. Next backlog item: (c) install-aware censoring; a rep-jump-aware
member (donation / work-switch flag) deserves its own pre-registration.

---

## Run 2026-11-19 — experiment (c): install-aware censoring

Data: snapshot 2026-11-19 ~13:15 UTC. `pred2.txt` tail (2 MB cap; `POST /api/ro/read` without `tailLines`, since
`tailLines` is capped at 5,000 lines): 3,972 predictions (first 2026-10-15 02:55 UTC), 2,344 resolved, 1,608 voided by
an install; `install-log.txt` 168 installs. New since the 2026-11-17 run: 180 resolved outcomes (resolved at or after
2026-11-17 13:15 UTC), 162 of them made after it. No lab run was logged for 2026-11-18.

### Pre-registration (written before the experiment ran)
- Hypothesis: 41% of predictions (1,608; 84% of them in money >3h and rep >3h) are voided by an install and never reach
  the calibrator. The resolved long-horizon outcomes it does see come from cycles that lasted long enough, so they lean
  early. Treating a voided prediction as right-censored at its install (actual > censor time) and feeding that to the
  band brings back the information on the late side. Expected: fewer censored definite misses, coverage toward 80% in
  the >3h cells, and a lower interval score.
- Candidate (pure predcal.js change; point and ensemble weights untouched, they still learn from resolved outcomes only):
  - `censor: "aci"`: when the install voids a prediction, its band's per-edge ACI step uses the expected miss
    indicators given actual > c (redistribution to the right under the band's own piecewise-lognormal distribution,
    10% / 50% / 90% at lo / d / hi): late = 1 if c >= hi else S(hi) / S(c); early = 0 if c >= lo else
    (F(lo) - F(c)) / S(c). Scaled by a censored weight `cw`.
  - `censor: "km"`: as "aci", and the band quantiles of each cell also take censored residuals ln(c / d) through a
    Kaplan-Meier (redistribution-to-the-right) estimate of the residual distribution, with weight `cw`; mass left
    after the last resolved residual sits at the largest censored residual.
  - The censor time is known only at the install (the void record's `at`); it is fed in time order like any outcome
    (no look-ahead).
- Windows: tuning = made before the snapshot's median made time (2026-11-08 03:39 UTC; 1,122 resolved); held-out = made
  at or after it (1,222 resolved, 29 install cycles, 746 censored). Replay is rolling-origin over the whole snapshot.
  Also reported on rows made after 2026-11-17 13:15 UTC (never seen by any lab run).
- Tuning (tuning half only): `censor` in {aci, km} x `cw` in {0.5, 1}, chosen by the backtest objective (interval score
  + coverage penalty). Frozen before held-out rows are scored.
- Metric: held-out interval score (log space, alpha 0.2) on resolved outcomes, paired difference candidate − v3 with a
  95% block bootstrap over install cycles (2,000 resamples, seed 7); secondary: median |log error| per kind x bucket,
  coverage, censored definite misses (band ends before the install).
- Acceptance: the standing rule above. Caveat stated in advance: the primary metric is scored on resolved outcomes only,
  which is the selection this experiment corrects, so a candidate can improve censored misses and still fail the rule.
  The rule is applied as written.

### Baseline backtest (shipped v3 `DEFAULTS`, this snapshot; 95% block-bootstrap CIs over install cycles)
| window | n | cycles | v2 coverage | v3 coverage [CI] | v2 IS | v3 IS | v2 median log err | v3 median log err | paired v3 − v2 IS [CI] |
|---|---|---|---|---|---|---|---|---|---|
| this run's held-out (made ≥ 11-08 03:39) | 1,222 | 29 | 0.623 | 0.789 [0.665, 0.869] | 3.59 | 3.12 | 0.161 | 0.115 | −0.47 [−1.52, +0.16] |
| new since 2026-11-17 run (made ≥ 11-17 13:15) | 162 | 3 | 0.759 | 0.864 [0.316, 0.984] | 5.30 | 3.60 | 0.033 | 0.046 | −1.69 [−14.8, +0.50] |
| whole snapshot (rolling origin) | 2,291 | 71 | 0.567 | 0.778 [0.709, 0.836] | 3.75 | 3.14 | 0.170 | 0.110 | −0.61 [−1.43, +0.04] |

Censored definite misses: held-out v2 12.3%, v3 12.1% (746 censored; money >3h 25.7% of 210, money 1-3h 21.6%);
whole snapshot v2 17.1%, v3 6.1%. Held-out cells with n >= 30 outside 70-90%: level >3h 0.585 (n 53), money <20m 0.645
(n 31), rep 20-60m 0.909 (n 132). Calibration replay of 3,972 predictions: 3.2 s (candidate 3.3 s).

### Result
Tuning half: every candidate was worse than shipped v3 (objective: v3 3.308; aci/0.5 3.726, aci/1 3.749, km/0.5 3.897,
km/1 4.054; coverage fell 0.765 → 0.72-0.74). The rule picks the best grid point, aci with cw 0.5, frozen before scoring
held-out rows. A check run with `censor: "none"` reproduced the shipped scores exactly.

| held-out (made ≥ 11-08 03:39) | v3 | censored ACI (cw 0.5) | change |
|---|---|---|---|
| interval score | 3.122 | 2.952 | −5.4%, paired CI [−0.399, +0.052] (includes 0) |
| coverage | 0.789 | 0.767 | away from 80% |
| early / late | 0.120 / 0.091 | 0.156 / 0.077 | more early misses |
| censored definite misses | 12.1% | 12.1% | unchanged |
| rep >3h (n 292): coverage, IS | 0.760, 4.15 | 0.671, 3.47 | narrower band, coverage out of 70-90% |
| money >3h (n 211): coverage, IS | 0.735, 4.07 | 0.749, 3.95 | slightly better |
| median log err, every bucket | — | — | unchanged (the point is untouched) |
| new rows (made ≥ 11-17 13:15), IS | 3.602 | 3.506 | −2.7%, paired CI [−0.110, 0.000] (3 cycles) |

Verdict: **rejected.** The interval score falls 5.4%, but the CI includes 0, coverage moves away from 80%, and the
tuning half preferred shipped v3 over every censoring variant.

Learned: censored rows mostly carry lower-edge information. Most voids happen after the band's lower edge, which
counts as "not early" and narrows the lower edge, so early misses rise (rep >3h coverage 0.76 → 0.67). On the upper edge
the late signal is real: the live snapshot has the upper ACI alpha pinned at its 0.25 ceiling (narrowest band) in money
>3h, rep >3h, level >3h and money 1-3h, because late outcomes are voided and never seen as resolved. The candidate drives
money >3h's upper alpha to the 0.01 floor, but the censored definite misses do not move (25.7%). The 99th percentile of
resolved residuals still ends before the install, because resolved residuals never include the long-late tail. ACI
cannot widen past data it has not seen. Kaplan-Meier residuals should fix that in principle, but were the worst on the
tuning half, because the censoring is not independent of the residual (cycles end when the augs are bought). A fair test of
censoring needs a metric that also scores voided rows (for example a censored interval score). The standing rule scores
resolved rows only, so it cannot reward this fix. Next backlog item: (d) cycle-phase cells with shrinkage.

## Run 2026-11-22 — experiment (b): regime-aware reset prior

Data: snapshot 2026-11-22 ~13:07 UTC. `pred2.txt` tail (2,000,000 bytes, truncated): 3,845 predictions (first
2026-10-26 18:48 UTC, last 2026-11-22 12:51 UTC), 2,122 resolved, 1,701 voided by an install, 60 install cycles;
`install-log.txt` 172 installs. New since the last run (2026-11-16 13:15 UTC): 923 resolved outcomes. 1,894 of the
2,122 resolved outcomes (89%) resolve inside the install cycle they were made in, so within-cycle data exists for
every bucket except level >3h (92 of 159).

### Pre-registration (written before the experiment ran)
- Hypothesis: v3 pools the last `maxObs` outcomes of a cell with equal weight, so right after an install its bias
  corrections, member weights, band residuals and ACI alphas are those of the end of the previous cycle (a different
  regime: fresh augs, reset money and RAM, new faction work). Treating earlier cycles as a prior with a bounded
  pseudo-count, and letting outcomes of the current cycle take over as they arrive, lowers the interval score.
- Candidate (pure predcal.js option, no new ns calls): `cyclePrior = K`. When the calibrator predicts for install
  cycle C (the sample's `lastAug`), each cell is fitted with weight 1 for outcomes made in cycle C and weight
  min(1, K / n_prior) for outcomes of earlier cycles (their total weight is capped at K). Weights apply to the bias
  correction, the prequential member losses and the band residual quantiles. `aciReset`: at the first prediction of
  a new cycle every kind|bucket ACI alpha restarts from that cell's mean alpha over all earlier steps (the prior)
  instead of carrying its last value. K = infinity is v3 as shipped.
- Windows: tuning = predictions made before the median `made` of the snapshot (2026-11-15 19:29 UTC; 1,035
  resolved); held-out = made at or after it (1,087 resolved). Rolling-origin replay over the whole snapshot (no
  look-ahead); only the configuration choice is fit, on tuning rows only.
- Tuning grid (6 configs): K in {20, 50, 150} x aciReset in {false, true}, all other options = shipped `DEFAULTS`.
  Choose the config with the lowest `objective()` of scripts/predictor-backtest.js (interval score + 10 x coverage
  distance beyond 0.02) on the tuning half. That one config is scored on the held-out half once, whatever its
  tuning rank against v3.
- Metric: held-out interval score (log space, alpha 0.2), paired difference candidate - v3 with a 95% block
  bootstrap over install cycles (2,000 resamples, seed 7); secondary: median |log error| per kind x bucket,
  coverage, censored definite misses, replay time.
- Acceptance: the standing rule above.

### Baseline backtest (shipped v3 `DEFAULTS`, lab snapshot; 95% block-bootstrap CIs over install cycles)
| window | n | cycles | v2 coverage | v3 coverage [CI] | v2 IS | v3 IS [CI] | v2 median log err | v3 median log err [CI] |
|---|---|---|---|---|---|---|---|---|
| lab held-out (made ≥ 11-15 19:29) | 1,087 | 11 | 0.629 | 0.742 [0.611, 0.841] | 3.43 | 3.23 [2.06, 5.04] | 0.170 | 0.163 [0.066, 0.260] |
| new since last run (made ≥ 11-16 13:15) | 914 | 10 | 0.632 | 0.718 [0.570, 0.824] | 3.76 | 3.33 [2.00, 5.50] | 0.181 | 0.157 [0.064, 0.315] |
| whole snapshot | 2,117 | 44 | 0.577 | 0.736 [0.625, 0.828] | 3.89 | 3.79 [2.62, 5.34] | 0.196 | 0.180 [0.091, 0.266] |

Paired v3 − v2 interval score: lab held-out [−1.27, +0.33], new data [−1.74, +0.07] (both contain 0). Censored
definite misses, lab held-out: v2 10.4%, v3 7.6%. Last run's held-out (v3 coverage 0.811, IS 2.91, median 0.147) was
better than the new week: coverage drifted down to 0.72-0.74. Held-out cells outside 70-90%: rep >3h 0.661 (n 369,
CI 0.34-0.85), level >3h 0.467 (n 45, 5 cycles); live liveCoverage agrees (rep >3h 0.48, level >3h 0.54, last 50).
Both miss mostly early (outcome before the band): rep >3h early 24% / late 10%, median log bias −0.16; level >3h
early 40% / late 13%, bias −0.54; money >3h early 17% / late 7%, bias −0.56. Long horizons are reached sooner than
predicted. Calibration replay of 3,845 predictions: 1.6 s.

### Result
Tuning half (objective = IS + coverage penalty; v3 4.889): K 20 4.919, K 20 + reset 5.482, **K 50 4.857**, K 50 +
reset 5.427, K 150 4.875, K 150 + reset 5.473. Chosen: `cyclePrior 50, aciReset false` (0.7% better than v3 on
tuning). The scratch implementation with both options off reproduced v3 exactly (0 differing predictions).

| held-out | v3 | cycle prior K=50 | change |
|---|---|---|---|
| interval score | 3.226 | 3.316 | +2.8% (worse), paired CI [+0.002, +0.216] |
| coverage | 0.742 | 0.745 | +0.003 toward 80% |
| median log err, all | 0.163 | 0.162 | −0.6% |
| median log err, buckets with n ≥ 30 | — | — | all within ±1% |
| interval score, rep >3h (n 369) | 4.178 | 4.384 | +4.9% |
| interval score, money >3h (n 178) | 3.799 | 3.908 | +2.9% |
| censored definite misses | 7.6% | 8.4% | worse |
| new data only: interval score | 3.327 | 3.429 | +3.1% (worse), paired CI [+0.007, +0.226] |
| replay time | 1.60 s | 1.54 s | same |

Verdict: **rejected.** Interval score is worse, and the paired CI excludes 0 on the wrong side. Point error is
unchanged (within 1% on every bucket), so the limit holds, but the main rule fails.

Learned: earlier cycles are not a stale regime to be discounted; consecutive install cycles in one BitNode look
alike, and the outcomes inside one cycle are few and strongly autocorrelated (lag-1 ACF 0.65-0.84 on long buckets),
so up-weighting them adds noise. Resetting ACI at each install was clearly harmful on tuning (+11-12% objective):
the carried alpha is useful information. What the misses show instead is a one-sided bias: long horizons arrive
early (bias −0.16 to −0.56 in log), so the rate-extrapolating base models miss in-cycle acceleration (growing income,
rep multipliers, RAM). That points at (e) quantile regression on time-since-install / rates or (f) a trend model,
not at re-weighting. Found after looking at held-out data: a hypothesis for a later pre-registration, not a result.

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

---

## Run 2026-11-27 — experiment (d): cycle-phase cells for bands, with shrinkage

Data: snapshot 2026-11-27 ~13:10 UTC (BN3, install #178). `pred2.txt` tail (2 MB cap): 3,672 predictions (first
2026-11-13 16:47 UTC, last 2026-11-27 13:01 UTC), 2,144 resolved, 1,458 voided by an install, 70 open, 23 install
cycles; `install-log.txt` 177 installs (4 since the last run; cycles now last 16-37 h). New since the 2026-11-23 run
(resolved at or after 2026-11-23 13:15 UTC): 657 resolved outcomes (619 made after it, 6 cycles).

### Pre-registration (written before the experiment ran)
- Hypothesis: the band of a kind x bucket cell pools residuals from every point in an install cycle, but the base
  models extrapolate current rates, and in-cycle acceleration (income growth, RAM, rep multipliers) depends on how far
  into the cycle a prediction is made. Long horizons made early in a cycle should arrive earlier than predicted than
  those made late. Splitting only the BAND quantiles by cycle phase (time since install), shrunk toward the
  kind x bucket band by n / (n + K), with the point left as shipped, should fit the early-miss asymmetry of rep >3h and
  money >3h and lower the interval score. The shipped `useCycle` (point and band split, no separate shrinkage) was
  rejected in PR #52 as too sparse; this variant keeps the point pooled and only splits the band.
- Candidate (pure predcal.js options, off by default, no new ns calls): `cycleBand: true` adds kind|bucket|phase cells
  used only for the band (point, member weights and bias corrections keep kind|bucket cells); `cycleShrinkK` = K for
  those cells (the existing ACI alpha of the kind|bucket cell sets the quantile level); `cycleCuts` = phase boundaries
  in hours since install.
- Grid (tuning half only, 6 configs): `cycleCuts` in {[1, 4] (shipped CYCLES), [4, 12]} x `cycleShrinkK` in
  {15, 30, 100}; all other options = shipped `DEFAULTS`. Choose the lowest `objective()` of
  scripts/predictor-backtest.js (interval score + 10 x coverage distance beyond 0.02) on the tuning half. That one
  config is scored on the held-out half once, whatever its tuning rank against v3. The shipped `useCycle: true` is
  reported as a reference only, not eligible.
- Windows: tuning = predictions made before the snapshot's median `made` (2026-11-21 00:26 UTC; 1,063 resolved);
  held-out = made at or after it (1,081 resolved, 9 install cycles, 686 voided). Rolling-origin replay over the whole
  snapshot (no look-ahead). Also reported on rows made after 2026-11-23 13:15 UTC (never seen by any lab run).
- Metric: held-out interval score (log space, alpha 0.2), paired difference candidate - v3 with a 95% block bootstrap
  over install cycles (2,000 resamples, seed 7); secondary: median |log error| per kind x bucket, coverage, censored
  definite misses, replay time.
- Acceptance: the standing rule above. Caveat stated in advance: the held-out half has only 9 install cycles, so the
  bootstrap CI will be wide.

### Baseline backtest (shipped v3 `DEFAULTS`, 2026-11-27 snapshot; 95% block-bootstrap CIs over install cycles)
| window | n | cycles | v2 coverage [CI] | v3 coverage [CI] | v2 IS | v3 IS | v2 median log err | v3 median log err | paired v3 − v2 IS [CI] |
|---|---|---|---|---|---|---|---|---|---|
| this run's held-out (made ≥ 11-21 00:26) | 1,081 | 9 | 0.616 [0.46, 0.71] | 0.748 [0.63, 0.83] | 2.69 | 2.86 | 0.126 | 0.131 | +0.17 [−0.21, +0.44] |
| new since the 11-23 run (made ≥ 11-23 13:15) | 619 | 6 | 0.580 [0.38, 0.75] | 0.756 [0.59, 0.88] | 2.81 | 2.98 | 0.106 | 0.082 | +0.17 [−0.40, +0.45] |
| 11-23 run's held-out window (made ≥ 11-16 08:43) | 1,730 | 17 | 0.623 [0.52, 0.71] | 0.739 [0.66, 0.80] | 3.21 | 3.13 | 0.140 | 0.132 | −0.09 [−0.67, +0.25] |
| whole snapshot | 2,134 | 23 | 0.625 [0.54, 0.69] | 0.745 [0.68, 0.80] | 3.08 | 3.03 | 0.147 | 0.152 | −0.06 [−0.59, +0.25] |

Same window as the 2026-11-23 log (made ≥ 11-16 08:43): v3 coverage 0.721 → 0.739, interval score 3.14 → 3.13, median
log error 0.120 → 0.132 (the snapshot also lost 11-13 and earlier to the 2 MB cap). On the newest rows v3's interval
score is now slightly worse than v2's (not significant): v2's narrow bands miss often (coverage 0.58-0.62) but by
little. Held-out v3 cells with n >= 30 outside 70-90%: money >3h 0.628 [0.52, 0.72] (n 226; early 20% / late 17%),
money 1-3h 0.694 (n 85). rep >3h is 0.727 (n 399, early 22% / late 5%). Live liveCoverage (last 50) flags money >3h
0.60 and rep >3h 0.60. Censored definite misses, held-out: v2 4.2%, v3 3.4%. Replay of 3,672 predictions: 1.5 s.

### Result
Tuning half (objective; v3 3.588): cuts [1, 4] K 15 3.656, K 30 3.641, **K 100 3.543**; cuts [4, 12] K 15 4.007,
K 30 3.893, K 100 3.740. Chosen: `cycleBand: true, cycleCuts: [1, 4], cycleShrinkK: 100` (1.3% better than v3 on
tuning). The scratch implementation with the options off reproduced v3 exactly (0 differing predictions).

| held-out (made ≥ 11-21 00:26) | v3 | cycle-phase band (K 100) | change |
|---|---|---|---|
| interval score | 2.858 | 2.716 | −5.0% (−4.97%), paired CI [−0.407, +0.022] (includes 0; 9 cycles) |
| coverage | 0.748 | 0.751 | +0.003 toward 80% |
| early / late | 0.161 / 0.091 | 0.160 / 0.089 | about the same |
| median log err, every bucket | — | — | unchanged (the point is untouched) |
| money >3h (n 226): coverage, IS | 0.628, 3.80 | 0.695, 3.17 | −17% IS, coverage toward 80% |
| money 1-3h (n 85): coverage, IS | 0.694, 3.44 | 0.682, 3.56 | +3% IS |
| rep >3h (n 399): coverage, IS | 0.727, 3.42 | 0.734, 3.37 | −1% IS |
| rep 1-3h (n 154): coverage, IS | 0.896, 0.28 | 0.831, 0.30 | +8% IS, coverage toward 80% |
| censored definite misses | 3.4% | 3.1% | slightly better |
| new rows (made ≥ 11-23 13:15), IS | 2.975 | 2.805 | −5.7%, paired CI [−0.79, +0.09] (6 cycles) |
| 11-23 run's held-out window, IS | 3.125 | 3.015 | −3.5%, paired CI [−0.261, +0.002] (17 cycles; overlaps tuning) |
| replay time | 1.5 s | 1.9 s | +0.4 s per 3,672 predictions |

Verdict: **rejected.** The interval score falls 4.97%, just short of 5%, and the paired CI includes 0. Point error is
unchanged and coverage moves the right way, so only the main rule fails. This is the closest any lab candidate has come,
and the sign is the same in every window.

Learned: the mechanism is real for money >3h. Money >3h predictions made in the first 4 h of a cycle land early 41-44% of
the time (phase c0/c1, n 83), against 6% after 4 h (c2, n 143). A phase-specific band fixes most of that (IS −17%).
The longer cuts [4, 12] were worse on tuning: the early-cycle effect is in the first few hours. Most rep >3h misses are
early too, but within c1 (40% early) and c2 (16%), so a band split helps it less.
Two findings came from looking at held-out data. They are hypotheses for later pre-registrations, not results:
(1) the shipped `useCycle: true` (point and band split by phase), reported as a reference, scored held-out IS 2.596
(−9.2%) and cut median log error 0.131 → 0.113, but it was the worst option on the tuning half (objective 3.875).
(2) Re-running the backtest's own 144-point grid on this snapshot's tuning half picks `gamma 0, dedup 1, tau 0.1` (no
ACI, cluster-robust band, sharper ensemble). That config scores held-out IS 2.502 (−12.5% vs shipped `DEFAULTS`),
coverage 0.831 and median log error 0.111. It was chosen on the tuning half only, which is the retune the v3 handoff
asked for ("update `DEFAULTS` only through the tuning split"). It still needs its own pre-registration, with data
made after this snapshot (2026-11-27 13:01 UTC) as the held-out half, before any default changes.
Next backlog item: (e) quantile regression on features with conformal correction. A retune of `DEFAULTS` and a
money-only phase band each deserve their own pre-registration.

## Run 2026-11-28 — experiment (e): quantile regression on features + conformal correction

Data: snapshot 2026-11-28 ~13:00 UTC (BN3, install #180). `pred2.txt` tail (`tailLines` is now capped at 5,000 lines,
about 1.4 MB): 2,502 predictions (first 2026-11-19 18:09 UTC, last 2026-11-28 12:54 UTC), 1,445 resolved, 1,013
voided by an install, 44 open, 13 install cycles; `install-log.txt` 179 lines (2 installs since the last run). New since
the 2026-11-27 run (resolved at or after 2026-11-27 13:10 UTC): 151 resolved outcomes (107 made after its snapshot,
3 cycles).

### Pre-registration (written before the experiment ran)
- Hypothesis: v3's band is a cell constant (kind x bucket quantiles of the honest residual), but the residual's
  spread and skew depend on features known at prediction time: how far into the install cycle the prediction is made
  (run 11-27: money >3h made in the first 4 h lands early 41-44% of the time vs 6% later), the horizon itself, how much
  the base models disagree, and how far v3's point sits from v2's. Linear quantile regression of the honest residual
  r = ln(actual / v3 point) on those features gives a per-prediction 10% / 90% edge; a conformal correction on top
  (asymmetric CQR, Romano et al. 2019: per-edge scores E_lo = q10(x) - r, E_hi = r - q90(x), their empirical quantile
  per kind x bucket, shrunk toward the kind cell, with the shipped per-edge ACI) keeps coverage honest. This should
  lower the interval score without touching the point.
- Candidate (scratch, would be a pure predcal.js option `bandModel: "qr"`, off by default, no new ns calls): the point
  is v3's as shipped (median error therefore unchanged by construction). Per kind (rep, money, level), a linear QR at
  tau 0.1 and 0.9 is refitted on that kind's last W resolved outcomes (knownAt <= made only) after every resolution
  batch, by IRLS on the pinball loss with standardised features and a small ridge (1e-3). Until a kind has 60
  outcomes, its predictions use v3's band unchanged. Conformal scores use the last 400 per kind x bucket, shrinkK 30,
  ACI gamma 0.1 per edge (the shipped values).
- Features: F1 = intercept, ln(1 + hours since install), ln(v3 point in hours); F2 = F1 + base-model dispersion (sd of
  ln predictions) + ln(v2 point / v3 point) (0 when v2 is missing). Deviation from the backlog text, stated in advance:
  RAM, income rate, rep rate and hack level are not in `pred2.txt` records, so they are not available to the backtest;
  testing them needs new logging first.
- Grid (tuning half only, 4 configs): feature set {F1, F2} x W {400, 1000}. Choose the lowest `objective()` of
  scripts/predictor-backtest.js (interval score + 10 x coverage distance beyond 0.02) on the tuning half; that one
  config is scored on the held-out half once, whatever its tuning rank against v3.
- Windows: tuning = predictions made before the snapshot's median `made` (2026-11-24 02:04 UTC; 748 resolved);
  held-out = made at or after it (697 resolved, 8 install cycles). Rolling-origin replay over the whole snapshot (no
  look-ahead). Also reported on rows made after 2026-11-27 13:01 UTC (never seen by any lab run).
- Metric: held-out interval score (log space, alpha 0.2), paired difference candidate - v3 with a 95% block bootstrap
  over install cycles (2,000 resamples, seed 7); secondary: coverage, early / late, per-bucket coverage and IS,
  censored definite misses, replay time.
- Acceptance: the standing rule above. Caveat stated in advance: 8 held-out cycles, so the bootstrap CI will be wide;
  the snapshot is shorter than earlier runs (5,000-line cap), so the QR's early fits run on little data.

### Baseline backtest (shipped v3 `DEFAULTS`, 2026-11-28 snapshot; 95% block-bootstrap CIs over install cycles)
| window | n | cycles | v2 coverage [CI] | v3 coverage [CI] | v2 IS | v3 IS | v2 median log err | v3 median log err | paired v3 − v2 IS [CI] |
|---|---|---|---|---|---|---|---|---|---|
| this run's held-out (made ≥ 11-24 02:04) | 697 | 8 | 0.554 [0.39, 0.70] | 0.747 [0.60, 0.87] | 3.07 | 3.00 | 0.130 | 0.090 | −0.07 [−0.46, +0.16] |
| new since the 11-27 run (made ≥ 11-27 13:01) | 107 | 3 | 0.813 [0.66, 0.98] | 0.841 [0.71, 0.88] | 2.00 | 1.59 | 0.107 | 0.034 | −0.41 [−0.76, −0.01] |
| 11-27 run's held-out window (made ≥ 11-21 00:26) | 1,232 | 11 | 0.618 [0.49, 0.72] | 0.758 [0.63, 0.85] | 2.71 | 3.08 | 0.126 | 0.124 | +0.37 [−0.18, +0.77] |
| new since the 11-23 run (made ≥ 11-23 13:15) | 770 | 8 | 0.590 [0.43, 0.75] | 0.770 [0.64, 0.90] | 2.82 | 2.85 | 0.110 | 0.088 | +0.04 [−0.38, +0.33] |
| whole snapshot | 1,445 | 13 | 0.598 [0.48, 0.70] | 0.757 [0.64, 0.83] | 2.99 | 3.45 | 0.146 | 0.157 | +0.47 [−0.06, +0.94] |

Against the 11-27 log on the same window (made ≥ 11-23 13:15; this snapshot starts 11-19, the last one 11-13): v3
coverage 0.756 → 0.770, interval score 2.98 → 2.85, median log error 0.082 → 0.088. On the newest rows (3 cycles) v3
beats v2 on interval score with a CI that just excludes 0 (only 3 cycles, so weak evidence), and its point error is a
third of v2's. Held-out v3 cells with n >= 30 outside 70-90%: money >3h 0.657 [0.38, 0.81] (n 105; early 33% / late 1%),
rep >3h 0.667 [0.46, 0.90] (n 273; early 26% / late 8%), rep 20-60m 0.945 (n 55), rep 1-3h 0.907 (n 107). Live:
liveCoverage (last 50) flags money >3h 0.64 only; `predCoverage` (last 200 resolutions) also shows rep >3h 38/74 = 0.51,
driven by one batch (The Black Hand 150k, 2026-11-27 13:37 UTC: 20 of 22 predictions early). No v3 → v2 fallback.
Censored definite misses, held-out: v2 3.9%, v3 4.3%. Replay of 2,502 predictions: 0.6 s.

### Result
Tuning half (objective; v3 4.019, coverage 0.765): F1 W 400 7.228, F1 W 1000 7.223, F2 W 400 6.681,
**F2 W 1000 6.680** (coverage 0.566). Chosen by the rule: F2, W 1000, although it is far worse than v3 on tuning.
Implementation checks before scoring held-out: the IRLS fitter recovers known 10% / 90% quantiles on synthetic
heteroscedastic data (0.101 / 0.900 below); on tuning, the raw QR band covers 0.61 out of sample and the conformal layer
pulls the lower edge in (median correction −0.14), because the scores it learns from come from the regime before the
2026-11-21 break (QR rows made on 11-21 cover 0.23).

| held-out (made ≥ 11-24 02:04) | v3 | QR + CQR (F2, W 1000) | change |
|---|---|---|---|
| interval score | 3.003 | 3.084 | +2.7%, paired CI [−0.107, +0.454] (includes 0; 8 cycles) |
| coverage | 0.747 | 0.737 | −0.010, away from 80% |
| early / late | 0.189 / 0.063 | 0.198 / 0.065 | slightly worse |
| median log err, every bucket | — | — | unchanged (the point is untouched) |
| money >3h (n 105): coverage, IS | 0.657, 3.60 | 0.733, 2.69 | −25% IS, coverage toward 80% |
| money 1-3h (n 44): coverage, IS | 0.773, 3.17 | 0.886, 3.19 | +1% IS |
| rep >3h (n 273): coverage, IS | 0.667, 4.12 | 0.659, 4.52 | +10% IS |
| rep 1-3h (n 107): coverage, IS | 0.907, 0.19 | 0.766, 0.50 | +157% IS |
| rep 20-60m (n 55): coverage, IS | 0.945, 0.42 | 0.836, 0.57 | +35% IS |
| censored definite misses | 4.3% | 3.1% | better |
| new rows (made ≥ 11-27 13:01), IS | 1.589 | 1.946 | +22.5%, paired CI [−0.01, +0.74] (3 cycles) |
| whole snapshot, IS | 3.450 | 3.835 | +11.2%, paired CI [−0.15, +1.22] |
| replay time | 0.6 s | +0.65 s | about double (a QR refit per resolution batch) |

Verdict: **rejected.** The interval score gets worse, not 5% better, and coverage moves away from 80%. Point error is
unchanged by construction.

Learned: a linear model of the band on phase, horizon, dispersion and the v2/v3 gap helps money >3h again (−25% IS,
the same early-cycle effect the 11-27 run found with phase cells) but hurts the short rep buckets, where v3's cell
quantiles are already tight (rep 1-3h median error 0.008) and a pooled per-kind regression spreads the long-horizon
spread onto them. The conformal layer cannot rescue it across a regime break because its scores resolve hours later.
Twice now the money >3h band has improved with phase information while every pooled change hurts rep; the cleanest
remaining test is a money-only phase band (pre-register separately). Features the backlog named (RAM, income rate, rep
rate, hack level) are not logged in `pred2.txt`; logging them is a prerequisite for a fair (e). Next backlog item:
(f) local-linear-trend / change-point base model.
