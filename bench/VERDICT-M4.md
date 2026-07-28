# M4 verdict — the qualified matrix, and it is still null

> **Historical executed report.** This file preserves the analysis M4 originally
> reported. Fisher exact is not valid for its paired design, and `over-turns`
> did not stop or truncate the recorded run. The canonical correction is
> [`docs/VERDICT-M4.md`](../docs/VERDICT-M4.md); the result remains null and no
> observation is retracted.

**n = 56 per arm, 7 of 7 seeds complete on all 8 qualifying tasks, 112 of 112
runs.** No truncation-driven shortfall in the matrix itself — one run finished
naturally after the unenforced turn budget and is labelled `over-turns`,
counted, not excluded (see *Limits* below).

Registered as `PREREGISTRATION.md` §16, after the control-only qualification
round recorded there. M1 (p = 0.7480), M1-b (p = 0.0522) and M2 (p = 0.2247)
are not revised; M3 is void (§15). Run from an isolated checkout outside the
working tree, per §16 precondition 2. Every one of the 112 rows carries
`harness_commit: 081d858c1667455f90b6d012e62a2cd2a549c50c` and
`dist_digest: f658927cae15c92a1cba2b7f0dc21119f47e2d72aea412d90489c42eb890b75e`
— one value each, verified before this document was written, satisfying §16
precondition 1 and the refusal `bench/metrics.ts` would otherwise raise.

Data: `bench/results/t702-m4-final.jsonl`, 112 transcripts committed alongside
at `bench/results/transcripts-m4/`. No manifest — see *Limits*.

---

## Result

| arm | re-proposed | rate | 95% CI (rate diff., vs. `commitlore-guard`) |
|---|---|---|---|
| `commitlore-on` | 35 / 56 | 62.5% | — |
| `commitlore-guard` | 41 / 56 | 73.2% | — |

**Fisher exact, two-tailed: p = 0.3117.** Rate difference −10.7pp (`on` minus
`guard`), 95% Newcombe interval [−27.1pp, +6.5pp]. Odds ratio 0.6098.

Violations: **0 / 56 in both arms.** The secondary outcome variable
registered in §16 point 3 — constraint violation of a recorded `Limit:` —
found nothing to report in either arm.

**The hypothesis is not supported at α = 0.05.** As registered: `commitlore-off`
is a reference only; the primary test is `commitlore-guard` against
`commitlore-on` (§16, §14 line 517), because guard against nothing would
confound the route with the presence of records at all.

Computed by `bench/metrics.ts` directly against `t702-m4-final.jsonl`; the
figures above are its output, not a transcription.

No subset was cut to look for an effect. §4 forbids it here more than
anywhere else in this project's history — this is the run built specifically
to give the hypothesis a fair matrix, and re-cutting a fair result after
seeing it would be the one move that could manufacture significance out of
the exact design meant to prevent that.

The Fisher exact test above is `PREREGISTRATION.md` §2's registered test, and
this document reports it as registered. It is also the wrong test for this
design, for a reason that has nothing to do with the p-value it produced —
see the next section.

---

## The registered test does not fit the design

Recorded here because a null result computed on an invalid test is not a
settled null; it is an open question with a number attached. Both problems
below are properties of the design, not of what the numbers came back as —
they would be exactly as true if p had come back significant. Independently
computed against `bench/results/t702-m4-final.jsonl`; the registered protocol
and canonical correction in `docs/` supersede the analysis in this section
without retracting the observations.

### 1. The 112 runs are not 112 independent observations — they are 56 pairs

Every seed × task cell ran once under `commitlore-on` and once under
`commitlore-guard`, sharing the workspace, task and seed. That is a paired
design. Fisher exact assumes two independent groups; the literature on
matched binary data is explicit that Fisher does not provide a valid
hypothesis test when the two samples are paired rather than independent — it
does not use the pairing and does not correct for it.

The correct paired test is McNemar's, on the pairs where the arms disagreed:

| | `commitlore-guard`: reproposed | `commitlore-guard`: did not |
|---|---:|---:|
| `commitlore-on`: reproposed | 33 | 2 |
| `commitlore-on`: did not | 8 | 13 |

56 pairs. Concordant 46 (33 both re-proposed, 13 both clean) — these carry no
information about a difference between the arms and Fisher's test spends
statistical power on them anyway. Discordant 10: 2 where `commitlore-on`
re-proposed and `commitlore-guard` did not, 8 where `commitlore-guard`
re-proposed and `commitlore-on` did not.

**McNemar's exact test (two-sided, binomial on the 10 discordant pairs):
p = 0.1094.**

**Still null.** That is exactly why it is safe to report this plainly rather
than treat it as a threat to the conclusion — nothing above turns the result
significant, so correcting the test cannot be read as motivated. It does mean
the p = 0.3117 in *Result* above is the registered number, not the right one,
and both facts belong in the same document.

### 2. The runs are also clustered by task, and were analyzed as if they were not

One-way ANOVA on `reproposed` (0/1) with task as the cluster, 8 clusters of
14 (both arms, all seven seeds, per task):

```
ICC = 0.581 · cluster size 14 · DEFF = 1 + (14-1)×0.581 = 8.56
effective n = 112 / 8.56 ≈ 13, against a nominal 112
```

A design effect this large means the 112 rows carry roughly the statistical
information of 13 independent ones. The published Newcombe interval,
[−27.1pp, +6.5pp], is a 95% interval under an independence assumption this
design does not satisfy.

**Two different quantities, two different factors — stated explicitly so the
next reader does not have to re-derive it:**

```
n_eff = n / DEFF        sample size divides by the design effect
SE ×= √DEFF              standard error, and CI half-width, scale with its square root
```

Design effect (`DEFF = 8.56`) corrects *variance*; a confidence interval's
half-width is proportional to standard error, i.e. to √variance, not to
variance itself. Scaling each half-width of the published interval by
√8.56 ≈ 2.92, as an illustrative approximation rather than a formal
re-analysis, gives **roughly [−58.7pp, +39.6pp]**.

That interval spans zero by a wide margin in both directions. The honest
statement is sharper than "not significant": at this design's actual
information content, **the study cannot distinguish a large benefit from a
large harm.** That is the finding, and it is the reason the statistical
protocol is being re-registered rather than this one number being patched in
place.

### 3. Four of the eight qualifying tasks are saturated, and that is itself a finding

`qualification-gitseed-boolean-security`, `-fake-tty`, `-grading-fail-fast`
and `-single-smoke-sample` ran 7/7 in **both** arms — every seed, every
condition, always reproposed. A task at ceiling in both arms contributes zero
information to a paired or clustered comparison: there is no discordant pair
it could produce and no variance it could contribute.

`PREREGISTRATION.md` §16's qualification round used a **floor** — 4-of-6
control re-proposals — to screen out silent tasks. It did not screen for a
ceiling, so the tasks that qualified most strongly are exactly the ones with
no headroom left to show an effect in either direction. M1 and M2 died of an
empty instrument, seven of ten tasks silent at zero. M4's paired analysis
dies of a saturated one, four of eight tasks pinned at one.

**Not dropped, and not re-run.** §4 forbids cutting a subset after seeing
outcomes, and it applies here with the same force it applies everywhere else
in this document: the saturation is the finding, not an inconvenience to
filter around before reporting the next number.

---

## What the qualification round changed, and what it did not

M1 and M2 were null because the instrument was mostly empty: seven of ten
tasks never showed a control-arm re-proposal at all, so seventy percent of
each matrix could not move the needle regardless of what CommitLore did. That
diagnosis is in `PREREGISTRATION.md` §16 and `docs/ROADMAP-TO-DONE.md`, and it
is measured, not guessed — the qualification round exists to test it directly
rather than assume it a second time.

It worked. The registered qualification brief supplies a **77% aggregate base
rate** across the ten candidate tasks (46/60; the eight that actually
qualified ran higher still, 43/48 = 89.6% — §16 records the discrepancy and
uses the lower, conservative figure for sizing). Here, with the full matrix
run, both arms reproposed in that same range:

| task | `commitlore-on` | `commitlore-guard` |
|---|---:|---:|
| `qualification-gitseed-approved-bool` | 2/7 | 2/7 |
| `qualification-gitseed-boolean-security` | 7/7 | 7/7 |
| `qualification-gitseed-drop-withheld` | 0/7 | 2/7 |
| `qualification-gitseed-fake-tty` | 7/7 | 7/7 |
| `qualification-gitseed-grading-fail-fast` | 7/7 | 7/7 |
| `qualification-gitseed-non-interactive` | 1/7 | 3/7 |
| `qualification-gitseed-numeric-sentinel` | 4/7 | 6/7 |
| `qualification-gitseed-single-smoke-sample` | 7/7 | 7/7 |

**Zero of eight tasks are silent.** Every task that qualified produced
re-proposals in both arms, at aggregate rates of 62.5% and 73.2% — in the same
band the qualification round predicted, not the ~20% M1 and M2 measured
against an unqualified task set. Compare that to M1's task table (§7 of the
pre-registration; `VERDICT-M1.md`): seven of ten silent, control re-proposing
in only four of ten at all.

**The instrument was full this time, and the effect still did not appear.**
That is a materially stronger null than M1's or M2's. Those two results could
be, and were, read as "the matrix could not detect an effect of this size" —
`VERDICT-M1.md` computed 5.1% power at n = 30. M4 was sized for 80% power
against a one-third reduction in a 77% base rate, ran on tasks that reproduce
at the rate the design predicted, and against a fully powered, non-silent
instrument the guard route did not reduce re-proposal below the injection
route. The absence of an effect here is not the absence of an opportunity to
see one.

Full is not the same claim as informative, though, and the next section
narrows it: four of these eight tasks are saturated at 7/7 in *both* arms,
which contribute nothing to a paired or clustered analysis even though they
are not silent. M1/M2 failed by emptiness; the paired/clustered re-analysis
below shows M4 failing by a related but distinct mechanism — see
*The registered test does not fit the design*.

---

## Two limitations the tooling surfaced

Both flagged by the runner and the schema themselves, not inferred after the
fact.

### 1. The model that produced these 112 rows cannot be proven

`RunRecord` has no `model` field, and `runner.ts` accepts `--model` and passes
it to the driver without ever writing it onto the row —
`bench/README.md`, "Open after T-702", item 1. For M1, M1-b and M2 the gap was
closed by a `*.manifest.json` sidecar that records the invocation, including
`model`. **No manifest was written for this run.** `bench/metrics.ts` reports
it plainly: every row's model reads `(unrecorded)`, with the warning the tool
prints whenever that happens.

This was theoretical when `bench/README.md` first listed it. It is not
theoretical now: there is no artifact anywhere in this repository, this
checkout, or this run's logs that names the model behind the original 93 rows
(`bench/results/t702-m4-final.runner.log`) or the 19 resumed afterward
(`t702-m4-final-resume.runner.log`). Re-proposal is a model-dependent
behaviour (§5), and this dataset cannot say whose behaviour it measured. Filed
as its own issue,
[#106](https://github.com/MongLong0214/commitlore/issues/106), rather than
folded into this document, because a gap in the harness is not a property of
the M4 result — it is a property of every dataset this harness produces until
the two lines `bench/README.md` names are written.

### 2. One run exceeded the turn budget, and it is recorded, not excluded

`qualification-gitseed-grading-fail-fast`, `commitlore-on`, seed 5, is labelled
`over-turns` at 31 turns rather than `completed`. In this harness the label
means that the process finished on its own after an observed, unenforced turn
budget; the harness did not stop or truncate it. §4 still governs the analysis
set: **it is not excluded.** `stopped_by: "error"`, `simulated: true` and
never-started rows leave the analysis set; `over-turns` is not one of those
three, and this row carries a real measurement (`reproposed: true`) like every
other row in the table above.

---

## What this does and does not license

- **It does not license claiming guard is worse than injection.** The
  observed direction (`on` 62.5% vs. `guard` 73.2%) is the opposite of what
  the hypothesis in §14 predicts, but the interval crosses zero by a wide
  margin and a non-significant result is not evidence for either ordering —
  the same discipline `VERDICT-M1b.md` applied to the interval-vs-test
  question.
- **It does not license a fifth measurement on this task set with more
  seeds.** Unlike M1, this instrument was not underpowered on its own terms —
  it was sized for the effect the qualification round predicted, and it did
  not find it. §16 governed this: "three null measurements and a fourth would
  be the finding, not a reason for a fifth." This is the fourth.
- **It does license retiring the "was the matrix broken" explanation.** That
  explanation was available for M1 and M2 and is not available here.

---

## What the product may claim now

`docs/ROADMAP-TO-DONE.md` committed to this outcome before the run existed:

> **A positive benchmark is not required.** If M4 is null again, that is the
> result, and it will be published. In that case, the product claim is not
> "makes agents better," but **"binds decision history to git and preserves it
> in a human-verifiable form."** The latter is already proven by tests and
> remains true independent of the benchmark.

M4 is null again. The claim narrows to that sentence, and it is not a
downgrade invented after the fact — it is the position this project registered
in advance of knowing which way this document would come out.
