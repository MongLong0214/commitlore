# Measurement protocol

- Status: **registered 2026-07-28**
- Scope: every benchmark whose collection begins after this registration
- Principle: the unit of analysis must match the unit that was paired, clustered,
  assigned, and exposed

This protocol does not rewrite an earlier registration after its outcome is
known. A benchmark-specific preregistration cites this file, fixes its estimand,
test statistic, confidence level, pairing key, clustering key, count rule,
power simulation, multiplicity family, and exposure gate. Any later divergence
is recorded without editing the registered rule.

## 1. Primary outcome: re-proposal label count

The primary outcome is `RunRecord.reproposal_matches`, the non-negative count
of distinct, mechanically detected `reproposed_if` labels matched in one run.
A label matched more than once still counts once. The runner records this field
directly from `reproposed_if`; it does not derive it from `matched`, because
`matched` combines re-proposal and `violation_if` evidence.

The previous registration named `RunRecord.violations` and described it as a
re-proposal count. That field does not measure what that description claimed:
it counts task-specific `violation_if` clause matches. It remains recorded as
instrumentation only. This corrects the registration's measurement label; it
does not change the hypothesis mid-study.

Before this outcome can be registered, the current-harness pilot is checked for
non-zero variance, for not being zero on every row, and for not being at each
task's structural maximum on every row. Refusal names the outcome and every
failed condition. A task's structural maximum is its number of distinct
`reproposed_if` labels, not the length of `matched`.

M5 cannot be registered from M4's data. M4 recorded no per-run
`guard_exposure`, so its rows cannot establish that a treatment was applied
(issue #122 and `bench/VERDICT-M4.md`). A pilot on the current harness, whose
rows carry `guard_exposure`, is required first; the registration guard runs on
that pilot.

This is a count rather than the old `reproposed: boolean`. Dichotomizing a count
loses granularity and reduced power in small cross-over studies, while
ceiling/floor compression makes a measure insensitive to real differences
([Geroldinger et al., 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10729462/);
[Šimkovic and Träuble,
2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6699673/)). That loss occurred in
M4: a run with one re-proposal and a run with five both scored `true`.

This choice uses the integer `reproposal_matches` count and optional `matched`
evidence. The type also carries
numeric effort measures (`turns`, `tokens`, and `duration_ms`), but not the turn
or time of the first re-proposal or an ordered severity judgment.

- **Rejected: binary outcome.** It recreates the observed ceiling and discards
  event intensity.
- **Rejected: time to first re-proposal.** It requires event-time
  instrumentation and a censoring rule that `bench/types.ts` does not carry,
  and it discards events after the first.
- **Rejected: ordinal severity.** Ordinal methods can handle clustered
  ceiling/floor data without dichotomizing it, but this harness has no
  registered severity scale or calibrated thresholds; inventing them would add
  judgment and still discard the available count
  ([Hedeker, 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4270960/)).

## 2. Primary test: paired permutation

The same `(task, seed)` is run in both arms, so it is one pair. Tasks are
clusters, and every task receives equal weight in the estimand. For task `k`,
seed `s`, and count `Y`, define
`D_ks = Y_treatment,ks - Y_comparator,ks`. The registered statistic is

`T = (1 / K) × Σ_k [(1 / m_k) × Σ_s D_ks]`.

Thus `T` is the mean of the task-specific mean paired differences. It is
negative when treatment prevents re-proposals and remains task-equal if a task
has fewer complete pairs.

The primary test is two-sided at `α = 0.05`. Under the null, swap the arm label
independently within every complete `(task, seed)` pair, retain its task
membership, and recompute `T`. Fully enumerate all `2^P` assignments when
`P ≤ 20`; otherwise draw **99,999** random assignments with a fixed recorded RNG
seed and include the observed assignment as the 100,000th. The Monte Carlo
p-value is `(1 + number of random assignments with |T*| ≥ |T_observed|) /
100,000`, so it is never zero. Under full enumeration, the p-value is the
proportion of all assignments with `|T*| ≥ |T_observed|`.

Permutation inference is registered because the assignment, pairing, and
cluster membership determine its null distribution without a small-cluster
model approximation. Eight task clusters and M4's `ICC = 0.581` put this design
in the few-cluster, high-correlation regime. Permutation procedures maintained
nominal type I error under model misspecification in cluster trials, and final
analyses commonly use 10,000 or 100,000 draws
([Maleyeff et al.,
2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12365356/);
[Watson, Akinyemi and Hemming,
2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10962558/)).

- **Rejected: uncorrected GEE or GLMM.** With four to eight clusters,
  uncorrected GEE exceeded 30% type I error in some simulations and mixed-model
  corrections were either inflated or conservative; no valid method reached
  nominal 80% power
  ([Leyrat et al.,
  2018](https://academic.oup.com/ije/article/47/1/321/4091562)).
- **Rejected: small-sample-corrected GEE or GLMM as primary.** Corrections can
  control type I error, but at eight clusters their power is low and sensitive
  to the chosen correction. They may be reported only as sensitivity analyses.
- **Rejected: McNemar or Fisher as primary.** Both require a binary outcome;
  Fisher additionally breaks the pairing. The two-sided permutation test also
  detects harm, unlike a one-sided benefit-only test.

## 3. Estimate and confidence interval

Report the observed task-equal mean count difference `T` and the two arm means.
The primary 95% randomization interval is obtained by inversion: for each
candidate additive effect `δ`, subtract `δ` from every treatment count, repeat
the registered paired permutation test, and retain values not rejected at
`α = 0.05`. Search to 0.01 event and report the full retained set; if it is
disconnected, report every component rather than filling a gap.

This inversion uses the same assignment mechanism and statistic as the test.
Permutation-based interval searches provide finite-sample coverage where
model-based small-cluster intervals can miss their nominal coverage
([Watson, Akinyemi and Hemming,
2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10962558/)).

- **Rejected: model-based Wald interval.** Its coverage inherits the
  small-cluster approximation that disqualified GEE/GLMM as primary.
- **Rejected: independent-proportions interval.** It discards both the count
  scale and the pairing.

## 4. Task-pool gate and sample size

Before either analysis arm runs, every candidate receives six runs on the
registered primary comparator. A task with structural maximum `M` qualifies
only when its six-run count rate is in the inclusive **4/6–5/6** band:

`Σ(reproposal_matches) / (6 × M)`.

The numerator is the count of distinct matched `reproposed_if` labels across
the six runs; the denominator is all labels the task could have matched across
those runs. This is a count rate, not the old binary proportion of runs with
any re-proposal. Thus a task with `M = 7` qualifies at 28 through 35 matched
labels out of 42, and one with `M = 8` at 32 through 40 out of 48. Both bounds
are inclusive.

Every task outside the band is refused from the analysis set. Its task id,
matched-label count, opportunity count, rate, and exclusion are retained in
the qualification record; it is never silently dropped or retained. If fewer
than the preregistered minimum number of tasks survive, collection stops and
the result states how many survived. The band is not widened after seeing the
qualification data; a new pool requires a new registration before either
treatment arm runs.

The old `n = 56` per arm is withdrawn. It assumed 56 independent binary
observations. At M4's `ICC = 0.581`, eight tasks and seven seeds give
`DEFF = 1 + 6 × 0.581 = 4.486` and only `56 / 4.486 = 12.48` effective paired
observations. At two-sided `α = 0.05` and 80% power, that design detects only a
standardized paired count difference of approximately `d = 0.87`. Adding seeds
cannot repair eight clusters: as seeds increase, effective information tends to
only `8 / 0.581 = 13.77`.

The minimum effect worth shipping for is **0.5 fewer re-proposal violations per
run**, planned conservatively as `d = 0.5` when the paired-difference SD is one
violation. Preventing one revival every two task runs is material rework avoided;
smaller effects are not a confirmatory shipping target. A two-sided 5%,
80%-power planning calculation needs 34 effective pairs. Holding seven seeds
and `ICC = 0.581` gives
`ceil(34 × 4.486 / 7) = 22` task clusters, or **154 pairs and 154
runs per arm**.

That is a planning minimum, not permission to use a model-based test. Before
collection, run at least 10,000 simulated experiments from the registered
calibration count distribution and ICC, analyze each with the exact registered
permutation procedure, and choose the first whole-task design at or above
22 tasks × 7 seeds whose simulated power is at least 80%. If none passes, add
tasks; do not add seeds to eight tasks and call the nominal rows independent.
Leyrat et al. found that valid few-cluster analyses lose substantial power and
that this loss must enter the sample-size calculation; Watson et al. recommend
design-stage simulation with the permutation procedure
([Leyrat et al.,
2018](https://academic.oup.com/ije/article/47/1/321/4091562);
[Watson, Akinyemi and Hemming,
2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10962558/)).

- **Rejected: 56 per arm.** Its detectable effect was misstated because it
  ignored task clustering and used a binary outcome.
- **Rejected: more seeds in the same eight tasks.** High ICC makes information
  asymptote; additional task clusters are the scarce unit.
- **Rejected: a smaller shipping threshold chosen only to reduce n.** The
  practical threshold is fixed before the power simulation.

## 5. Multiplicity across tasks

There is one confirmatory pooled test in §2, so it receives the full
`α = 0.05`. If the eight task-specific effects are tested, they are one
secondary family of eight hypotheses. Apply the two-sided **Romano–Wolf
stepdown** procedure using the same 99,999 joint within-pair permutations, and
report family-wise-error-adjusted p-values and simultaneous 95% randomization
intervals. A task-specific result never overrides the pooled verdict or changes
the registered analysis set. If the future power design expands the pool, all
registered task effects form one family rather than splitting it; at the
planning minimum in §4, that family has 22 hypotheses.

Romano–Wolf is registered because its permutation implementation maintained
nominal family-wise error and simultaneous coverage under correlated outcomes
while producing narrower intervals than the alternatives
([Watson, Akinyemi and Hemming,
2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10962558/)).

- **Rejected: no correction.** Eight unadjusted tests inflate the probability of
  at least one false task claim.
- **Rejected: Bonferroni.** It was conservative under high correlation.
- **Rejected: Holm.** It controlled error, but Romano–Wolf used the dependence
  structure more efficiently.

## 6. Cluster reporting

Every report states the nominal runs, complete pairs, task clusters and their
sizes, the named count-outcome ICC estimator and estimate, design effect,
effective n, calibration assumptions, simulated power, and Monte Carlo seed.
For equal cluster size `m`, the descriptive calculations are
`DEFF = 1 + (m - 1) × ICC` and `effective n = nominal n / DEFF`; unequal
clusters use the formula fixed in the benchmark-specific registration. These
quantities expose information loss and do not replace the permutation test.

## 7. Treatment exposure

Assignment is not exposure, and outcome detection is not exposure evidence.
Every `RunRecord` must separately record:

- assigned arm and treatment route;
- eligible treatment opportunities;
- actual treatment exposures, including the count and route; and
- outcome and outcome-matcher evidence.

For injection, exposure means the relevant treatment payload was delivered.
For guard, exposure means the instrumented guard route produced its registered
treatment action. A `matched` value from the outcome detector cannot establish
either event.

The exposure gate is evaluated before outcomes are analysed. If expected
treatment exposure cannot be verified from the artifact, the experiment is
reported as an instrumentation failure and receives no confirmatory outcome
analysis. Missing exposure is never filled in retroactively.

The same pre-analysis gate applies to model and executable provenance. Model
identity, harness commit and executable digest must be immutable fields in each
row or in a content-addressed manifest bound to those rows. The gate verifies
that each expected identity is present and uniform, unless multiple registered
strata were fixed in advance. Missing or unexpected mixing receives no
confirmatory outcome analysis. This rule limits attribution; it does not
retroactively erase otherwise valid observations.

## 8. Corrections after results exist

If a registered analysis is found to be invalid after results are visible:

1. preserve and report the original analysis;
2. name the error and the time of the correction;
3. report the corrected analysis beside it, without changing the analysis set;
4. state whether the two analyses agree on the registered conclusion; and
5. if they disagree, do not let the corrected result replace the registered
   result: register and run an independent confirmation.

This rule distinguishes correction from choosing a favourable analysis after
seeing the data.
