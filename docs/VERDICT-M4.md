# M4 verdict: valid observations, null result, failed measurement design

**112 of 112 rows are usable: 56 matched `(task, seed)` pairs across eight task
clusters. The result is null.**

M4 measured what it measured. Its rows are valid observations with one harness
commit (`081d858c1667455f90b6d012e62a2cd2a549c50c`) and one dist digest
(`f658927cae15c92a1cba2b7f0dc21119f47e2d72aea412d90489c42eb890b75e`).
What failed is the design's ability to detect a treatment effect: the registered
test assumed independence, the task set was half saturated, and the artifact
did not record whether treatment exposure occurred.

Source inspected: `m4-full.jsonl`, 112 rows, SHA-256
`d75aa94c76912751249c51bf4b92d879e88b6c2343dc6965ec6272ef64d76426`.
It is byte-identical to
[`bench/results/t702-m4-final.jsonl`](../bench/results/t702-m4-final.jsonl),
first committed as `1353809`.
No benchmark was re-run for this correction.

## Result, before and after correction

The raw rates are unchanged:

| arm | re-proposed | rate | Wilson 95% CI |
|---|---:|---:|---:|
| `commitlore-on` | 35/56 | 62.5% | 49.4%–74.0% |
| `commitlore-guard` | 41/56 | 73.2% | 60.4%–83.0% |

The correction artifact contains only the two arms in the registered primary
comparison. Section 16 registered a third, `commitlore-off` arm, but no off-arm
row is present here, so this verdict neither invents nor analyses one. The
registered constraint-violation outcome is 0/56 in each recorded arm (0%, Wilson
95% CI 0%–6.4%). A separate cited-compliance outcome was registered but is not
recorded in the artifact and cannot be reported. These are execution and
reporting divergences, not post-hoc exclusions.

One `commitlore-on` row (`grading-fail-fast`, seed 5) finished on its own after
exceeding the unenforced turn budget and is labelled `over-turns`; the other 55
on rows and all 56 guard rows finished within budget. It was not stopped or
truncated, it recorded a re-proposal, and it remains in every analysis.

| | Original registered analysis | Corrected analysis |
|---|---|---|
| unit treated as independent | 112 runs | 56 matched pairs in 8 task clusters |
| effect (`on` − `guard`) | −10.7pp | −10.7pp |
| test | two-tailed Fisher exact | McNemar mid-p, plus equal-weight task-cluster analysis |
| p-value | **0.3117** | **0.0654** paired; **0.0796** task-cluster |
| interval | independent Newcombe 95% CI [−27.1pp, +6.5pp] | cluster-level 95% CI [−23.1pp, +1.6pp] |
| conclusion at α = 0.05 | null | null |

The Fisher test was invalid for this design. The same task and seed appeared in
both arms, so the groups were not independent. Across the 56 pairs, 46 were
concordant, guard prevented a re-proposal in `b = 2`, and guard re-proposed when
`on` did not in `c = 8`. The paired correction under the newly registered
protocol gives McNemar mid-p `p = 0.0654`; the more conservative exact
conditional sensitivity result is `p = 0.1094`.

Seeds are also clustered within tasks. An equal-weight cluster-level analysis
of the eight task differences, using task-based degrees of freedom, gives
`on − guard = −10.7pp`, 95% CI `[−23.1pp, +1.6pp]`, `t(7) = −2.049`,
`p = 0.0796`. An exact sign-flip sensitivity analysis is `p = 0.25`: only three
task clusters have a non-zero arm difference. This transparent small-cluster
correction is supported as a sensitivity analysis for equal-size, high-ICC
settings and retains all eight tasks. It is not a substitute for the
prospectively registered GEE or GLMM in future benchmarks: choosing such a
model only after M4's result existed would add another post-result modelling
decision.

**The test was changed after the result was seen.** This is a correction of an
error, not a re-cut in search of significance. The honest reason it is safe
here is that **both analyses are null, so nothing about the conclusion turns on
the change**. If they had disagreed, the corrected analysis could not simply
replace the original; an independently registered run would be required.

## Nominal n was not the information n

On the pooled binary outcome, clustered by task:

| quantity | value |
|---|---:|
| nominal observations | 112 |
| task clusters | 8 |
| equal cluster size | 14 |
| ANOVA ICC | 0.581 |
| design effect | 8.56 |
| effective n | **13.09 (13 rounded)** |

The original independent-run interval is not cluster-valid. The design effect
means the nominal information count is overstated by 8.56; under the simple
equal-cluster approximation it inflates variance by 8.56 and standard error by
`sqrt(8.56) = 2.92`. ICC, design effect and effective n are diagnostics, not a
substitute for the task-cluster analysis above.

## Qualification selected saturation

No task is removed. Section 4 of the preregistration forbids post-hoc
subsetting, so all eight remain in every number above.

| task | `on` | `guard` | information |
|---|---:|---:|---|
| `boolean-security` | 7/7 | 7/7 | saturated |
| `fake-tty` | 7/7 | 7/7 | saturated |
| `grading-fail-fast` | 7/7 | 7/7 | saturated |
| `single-smoke-sample` | 7/7 | 7/7 | saturated |
| `approved-bool` | 2/7 | 2/7 | concordant |
| `numeric-sentinel` | 4/7 | 6/7 | discriminating |
| `non-interactive` | 1/7 | 3/7 | discriminating |
| `drop-withheld` | 0/7 | 2/7 | discriminating |

Four of eight tasks are 7/7 in both arms. Those 28 pairs contribute no
discordance. M1 and M2 failed on the empty side of the instrument; M4's
floor-only `≥ 4/6` qualification failed on the saturated side. Five tasks had
qualified at 6/6, and four of those became the four saturated tasks.

The registered replacement in
[`MEASUREMENT-PROTOCOL.md`](MEASUREMENT-PROTOCOL.md) qualifies only 4 or 5 of 6
on the primary comparator. It retains the evidence-based M4 floor and requires
one observed non-event as headroom.

## Treatment exposure is unrecorded

`matched.length > 0` equals `reproposed` on every row in both arms. `matched` is
the outcome detector's evidence; it is not evidence that injection delivered a
record or that guard fired. No row records treatment opportunity or treatment
exposure.

M4 therefore cannot distinguish "the treatment was applied and did nothing"
from "the treatment never applied." Under the newly registered protocol, a
future artifact with this gap is not analysed. M4 predates that gate, so the
numbers above are retained as a correction and audit, not promoted into a
verified treatment-effect claim.

The instrumentation work is tracked in
[#108](https://github.com/MongLong0214/commitlore/issues/108).

## Model provenance is also missing

The initial `m4.jsonl` tranche has 93 rows and the three resume files have 1, 2
and 16, producing the 112-row final file. Neither the original 93 nor the final
112 records a `model`, and no M4 manifest supplies one. A re-proposal rate is
model-dependent, so these results cannot be attributed to or compared with a
specific model. Tracked in
[#106](https://github.com/MongLong0214/commitlore/issues/106).

## Verdict

**Null, and unable to discriminate.** Do not retract M4 and do not call its data
invalid. Recorded harness-commit and dist-digest provenance is uniform, while
model provenance is missing. The Fisher analysis was wrong for the paired
design, the selected task set was ill-chosen, and exposure was uninstrumented.
Those failures prevent M4 from establishing whether guard changes re-proposal
behaviour; they do not erase the observations.
