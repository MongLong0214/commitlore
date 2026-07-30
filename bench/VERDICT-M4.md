# M4 verdict — valid data; null withdrawn because guard exposure is unverifiable

> **Historical executed report and correction.** M4's 112 rows and their
> provenance remain valid. Its null is retained as an observation about those
> rows, but withdrawn as evidence about the guard: M4 recorded no per-run guard
> exposure, so the rows cannot establish whether the treatment was present.

M4 was registered as a comparison of `commitlore-guard` and `commitlore-on`.
Three verified facts overturn the previous basis for withdrawing its null:

1. In the runner, `injectedContext` is `null` whenever an arm uses a hook
   settings path. The shipped injector then runs per edit and path-scoped, as
   the product does; only an arm without that path uses the harness's
   session-start block. For a hook arm, `injected_context: null` is therefore
   the designed signature of that delivery route, not evidence of a failure.
2. Each M4 transcript artifact stores only the final assistant message (roughly
   1.5 KB), not a conversation log. Record text cannot be expected to appear in
   that field, so its absence establishes neither treatment nor non-treatment.
3. `bench/results/t702-m4-final.jsonl` has 112 rows and no
   `guard_exposure` field on any of them. `guard_exposure` and
   `readGuardExposure` were added later by issue #113, after M4 ran.

M4 therefore records outcomes without recording exposure. Whether either label
applied the treatment is unverifiable from these artifacts. Its null is not a
weak result about the guard, and it is not a result about the guard at all.

## What remains valid

**n = 56 per arm, 7 of 7 seeds on all 8 tasks, 112 rows.** The dataset is not
retracted and M4 is not called invalid. It faithfully records the outcomes and
provenance it was built to record; exposure was not among those things.

Provenance remains clean: every row has the single
`harness_commit: 081d858c1667455f90b6d012e62a2cd2a549c50c` and the single
`dist_digest: f658927cae15c92a1cba2b7f0dc21119f47e2d72aea412d90489c42eb890b75e`.
There are 112 rows and no mid-run rebuild. The gap is instrumentation, not
provenance: the harness recorded faithfully what it was built to record, and
exposure was not among those things.

Data: `bench/results/t702-m4-final.jsonl`, with 112 committed transcripts at
`bench/results/transcripts-m4/`. No manifest was written; the model provenance
limitation remains separate from the missing exposure instrumentation.

## Observed M4 data, not a guard effect

| arm | re-proposed | rate | 95% CI (rate diff., vs. `commitlore-guard`) |
|---|---:|---:|---|
| `commitlore-on` | 35 / 56 | 62.5% | — |
| `commitlore-guard` | 41 / 56 | 73.2% | — |

The registered Fisher calculation is p = 0.3117; the observed rate difference
is −10.7pp (`on` minus `guard`), with Newcombe interval [−27.1pp, +6.5pp] and
odds ratio 0.6098. Violations were 0/56 in both arms.

Those are correct descriptions of the recorded data. They do not estimate a
guard effect, because the exposure that such an estimate requires was never
recorded.

## Corrected statistical analysis still describes the data

The statistical correction already made for M4 remains correct arithmetic on
the rows and is irrelevant as evidence about the guard, because the exposure it
would be evidence about was never recorded. Both statements are true.

The 56 seed × task cells are paired. On the recorded outcomes, the paired table
is:

| | `commitlore-guard`: reproposed | `commitlore-guard`: did not |
|---|---:|---:|
| `commitlore-on`: reproposed | 33 | 2 |
| `commitlore-on`: did not | 8 | 13 |

There are 10 discordant pairs, giving **McNemar's exact two-sided p = 0.1094**.
The original Fisher calculation is not the right test for paired rows; neither
calculation answers the guard question without recorded exposure.

The task clustering correction also remains true about the data:

```
ICC = 0.581 · cluster size 14 · DEFF = 1 + (14-1)×0.581 = 8.56
n_eff = n / DEFF = 112 / 8.56 ≈ 13, against a nominal 112
```

The independence-based Newcombe interval [−27.1pp, +6.5pp] is therefore not a
valid confidence interval for a treatment effect. While n_eff = n / DEFF,
standard error scales by √DEFF: scaling the interval's half-widths by
√8.56 ≈ 2.92 gives the existing illustrative corrected interval, roughly
**[−58.7pp, +39.6pp]**. It remains an interval over the observed label groups,
not evidence about a guard whose exposure was not recorded.

Four tasks were saturated at 7/7 in both recorded labels:
`qualification-gitseed-boolean-security`, `-fake-tty`,
`-grading-fail-fast`, and `-single-smoke-sample`. That saturation remains an
observation about the data. It cannot be used to explain or qualify a guard
effect whose exposure M4 did not record.

## What does not change

- No row is discarded, and no provenance claim is withdrawn.
- The missing model manifest remains a limitation; one `commitlore-on` run
  labelled `over-turns` still finished naturally and remains included.
- The dataset may be cited for its recorded outcomes and clean provenance, but
  never as a test, null, or estimate of a guard effect.

## What would settle the guard question

The current harness on `dev` records `guard_exposure` per run: the runner reads
it with `readGuardExposure` and writes it into each row. `metrics.ts` refuses a
comparison when treatment exposure cannot be distinguished from its comparator,
including when any analysis-row exposure is unknown. A rerun on that harness can
answer the guard question. M4's rows cannot be retrofitted because the field
does not exist in them.

The product claim remains the independently testable one: CommitLore binds
decision history to Git and preserves it in a human-verifiable form. M4 neither
supports nor refutes an agent-behavior claim.
