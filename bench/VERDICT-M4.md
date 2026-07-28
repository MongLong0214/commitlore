# M4 verdict — valid data; null withdrawn as guard evidence

> **Historical executed report and correction.** M4's 112 rows and their
> provenance remain valid. Its null is retained as an observation about those
> rows, but withdrawn as evidence about the guard: neither arm received the
> records that defined the comparison.

M4 was registered as a comparison of `commitlore-guard` and `commitlore-on`,
two arms defined by receiving records. The committed transcripts show
`injected_context: null` on **0 of 112** runs: 0/56 `commitlore-guard` and
0/56 `commitlore-on`. This is not a field that was never used: the earlier
`bench/results/transcripts-final/` set has injected context on 30 of 60 runs.

The pinned M4 harness (`081d858c1667455f90b6d012e62a2cd2a549c50c`) was restored
and probed under M4's conditions. It again produced `injected_context: None`
and `matched: []`; the agent transcript contained none of `commitlore`,
`Ruled-out`, `Limit:`, or active records. A recording gap would leave the
delivered context in that transcript. Nothing was delivered.

The two M4 arms therefore compared **nothing against nothing**. Its null is
not a weak result about the guard, and it is not a result about the guard at
all.

## What remains valid

**n = 56 per arm, 7 of 7 seeds on all 8 tasks, 112 rows.** The dataset is not
retracted and M4 is not called invalid. It faithfully records what the harness
ran; what it ran was both arms without records.

Provenance remains clean: every row has the single
`harness_commit: 081d858c1667455f90b6d012e62a2cd2a549c50c` and the single
`dist_digest: f658927cae15c92a1cba2b7f0dc21119f47e2d72aea412d90489c42eb890b75e`.
There are 112 rows and no mid-run rebuild. The failure is upstream of
provenance. The harness recorded faithfully what it did, and what it did was
run both arms without records.

Data: `bench/results/t702-m4-final.jsonl`, with 112 committed transcripts at
`bench/results/transcripts-m4/`. No manifest was written; the model provenance
limitation remains separate from this delivery failure.

## Observed M4 data, not a guard effect

| arm | re-proposed | rate | 95% CI (rate diff., vs. `commitlore-guard`) |
|---|---:|---:|---|
| `commitlore-on` | 35 / 56 | 62.5% | — |
| `commitlore-guard` | 41 / 56 | 73.2% | — |

The registered Fisher calculation is p = 0.3117; the observed rate difference
is −10.7pp (`on` minus `guard`), with Newcombe interval [−27.1pp, +6.5pp] and
odds ratio 0.6098. Violations were 0/56 in both arms.

Those are correct descriptions of the recorded data. They do not estimate a
guard effect, because neither label received the treatment it names.

## Corrected statistical analysis still describes the data

The statistical correction already made for M4 remains correct arithmetic on
the rows and is irrelevant as evidence about the guard. Both statements are
true.

The 56 seed × task cells are paired. On the recorded outcomes, the paired table
is:

| | `commitlore-guard`: reproposed | `commitlore-guard`: did not |
|---|---:|---:|
| `commitlore-on`: reproposed | 33 | 2 |
| `commitlore-on`: did not | 8 | 13 |

There are 10 discordant pairs, giving **McNemar's exact two-sided p = 0.1094**.
The original Fisher calculation is not the right test for paired rows; neither
calculation answers the guard question without delivered records.

The task clustering correction also remains true about the data:

```
ICC = 0.581 · cluster size 14 · DEFF = 1 + (14-1)×0.581 = 8.56
effective n = 112 / 8.56 ≈ 13, against a nominal 112
```

The independence-based Newcombe interval [−27.1pp, +6.5pp] is therefore not a
valid confidence interval for a treatment effect. Scaling its half-widths by
√8.56 ≈ 2.92 gives the existing illustrative corrected interval, roughly
**[−58.7pp, +39.6pp]**. It remains an interval over the observed label groups,
not evidence about a guard that was never delivered.

Four tasks were saturated at 7/7 in both recorded labels:
`qualification-gitseed-boolean-security`, `-fake-tty`,
`-grading-fail-fast`, and `-single-smoke-sample`. That saturation remains an
observation about the data. It cannot be used to explain or qualify a guard
effect that M4 did not measure.

## What does not change

- No row is discarded, and no provenance claim is withdrawn.
- The missing model manifest remains a limitation; one `commitlore-on` run
  labelled `over-turns` still finished naturally and remains included.
- The dataset may be cited for its recorded outcomes and clean provenance, but
  never as a test, null, or estimate of a guard effect.

The product claim remains the independently testable one: CommitLore binds
decision history to Git and preserves it in a human-verifiable form. M4 neither
supports nor refutes an agent-behavior claim; a repaired delivery path must be
verified before a new experiment can address that question.
