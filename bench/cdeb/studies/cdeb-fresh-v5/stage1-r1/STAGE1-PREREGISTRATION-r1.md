---
document_id: cdeb-fresh-v5-stage1-r1-preregistration
preregistration_identifier: CDEB-FRESH-V5-STAGE1-R1
supersedes: cdeb-fresh-v5-stage1-preregistration
study_id: cdeb-fresh-v5
stage: stage1-r1-confirmatory
status: DRAFT-NOT-FROZEN-awaiting-buildability-and-oracles
measured_run_allowed: false
---

# CDEB-Fresh v5 Stage 1-r1 preregistration

A distinct preregistration, not an amendment. The first Stage 1 draft failed an
adversarial review on six defects; its own §7 said that anything but the
deferred N makes a change a new preregistration, so patching it would have been
the failure it existed to prevent. That draft stays at
`../STAGE1-PREREGISTRATION.md` marked as failed, with the review it failed at
`../stage1/adversarial-review.md`. It is history and is not to be tidied away:
a study whose failed drafts vanish looks like a study that never had one.

**This document is not frozen either, and it says why in §0.** No measured run
may begin against it.

## 0. What is still missing

Freezing a preregistration means fixing a population and an instrument. Neither
exists yet:

1. **The buildability census is unfinished.** All 62 candidates are enumerated
   in `buildability-census.jsonl`, every one carries the mechanical screens, and
   every one has `disposition: null`. The screens refuted nothing — all four
   snapshots resolve, 61 of 62 scopes survive intact and the fourth survives
   partially, and every repository has an executable test runner. So the
   screens cannot decide buildability; only oracle construction can, and none
   has been attempted. `assertCensusComplete` throws on the committed file.
2. **No oracle exists for any candidate.** Stage 0's G5 recorded that reviewers
   thought one *could* be written. Between that and a validated oracle sits the
   whole of gate G2, and nothing has crossed it.
3. **No task exists, so the firewall has never run.** The anti-circularity
   argument rests entirely on tasks authored without sight of the record. The
   machinery to prove that is in place and has never been exercised on a real
   task.
4. **The runtime lock is empty.** The agent under test has not been chosen.

Until 1–4 are closed this document fixes the *method* and not the *population*,
and a preregistration that does not fix its population is a plan.

## 1. Hypothesis

> Automatic CommitLore decision delivery before a relevant code mutation
> improves a coding agent's probability of completing a fresh maintenance task
> without reviving a functionally viable approach that a naturally recorded,
> pre-study repository decision explicitly ruled out.

Direction is specified. A result in the other direction is reported as
measured.

## 2. What is being estimated

The **total product effect of automatic delivery as shipped**: semantic
content, salience, payload and token load, and hook behaviour together. It does
not isolate semantic content, and the report may not describe it as though it
did.

Two consequences, carried here rather than left as footnotes:

- the arms differ in payload volume and hook activity as well as in decision
  content, so this is delivery-versus-no-delivery, not content-versus-nothing;
- the record stays in Git under both arms, so this is automatic delivery versus
  none, not access versus none. Natural discovery in the suppressed arm is
  logged as a manipulation check.

## 3. Primary endpoint

```text
DSFPS = completed AND functional_acceptance_pass AND revival == false
```

Judged by the oracle from the final tree alone. The oracle may not read the
arm, the transcript, the delivery log, a record citation, token usage or any
agent explanation; `assertOracleInputsAllowed` refuses a spec that names one.

Forbidden as endpoints, in every analysis: record citation, wording repetition,
reason restatement, Record-Id mention. Each would let the treatment satisfy the
measurement merely by arriving.

## 4. Population

The confirmatory corpus is **every reserve candidate marked BUILDABLE under the
frozen rules** — no hand selection afterward, and no selection at all from
among the buildable.

```text
reserve            50 candidates, disjoint from the 12-candidate pilot
per repository     agent-control-plane 7   agent-operator-score 14
                   gitseed            19   logic-pro-mcp        10
floor              5 buildable per repository, from power-and-resource-rule.json
```

Pilot candidates and every artifact built for them are excluded permanently.

If any repository falls below the floor, the answer is HOLD. The estimand is
not shrunk to fit, and missing decision diversity is not replaced with repeats
of what survived.

## 5. Estimand and analysis

Both are in `analysis-plan.md` and executed by
`bench/cdeb/freeze/analysis-v5.ts`. In summary:

```text
D_r        mean over candidates in r of (mean_repeat DSFPS_ON - mean_repeat DSFPS_OFF)
Delta      (1/4) * sum over the four fixed repositories of D_r
interval   20,000-replicate percentile bootstrap, resampling CANDIDATES WITHIN
           each fixed repository; the repositories themselves are never resampled
denominator intention-to-treat over assigned episodes; an unobserved assigned
           episode is a failure in the analysis, never a removal from it
empty stratum  Delta is undefined; the study stops and reports
```

Superiority requires the 95% interval to exclude zero in the predicted
direction. Non-degradation of completion and functional-pass rates is reported
against a −5 percentage-point margin.

## 6. Power

Fixed before the pilot in `power-and-resource-rule.json`: alpha 0.05, power
0.90, confidence 95%, minimum practically important effect 15 percentage
points, 8 repeats per arm, budget 880 episodes, floor 5 buildable per
repository.

The pilot may supply only nuisance parameters — baseline rate,
within-repository variance, completion rate, runtime, infrastructure failure
rate. It may not supply the effect, and `assertPowerInputsEffectBlind` refuses
a sizing input that names one.

**Registered before the fact:** this corpus detects roughly 12–17 percentage
points at the frozen envelope, depending on between-candidate heterogeneity. A
10-point effect needs 12 repeats and homogeneous candidates. A null result from
this study is therefore not evidence of no effect, and may not be reported as
one.

## 7. Pilot

12 candidates, 3 per repository, already allocated in
`../stage1/pilot-design.json` and not moveable. They run only after passing the
same gates as the confirmatory corpus.

The pilot tests the instrument: firewall, oracle controls, delivery
manipulation, runtime budget, evaluator reproducibility. Its output is `PASS`
or `HOLD` against `pilot-feasibility-thresholds.json` and nothing else.

Continuation is effect-independent by construction rather than by discipline:
the feasibility record has no field that could carry an arm contrast, and
`assertFeasibilityCarriesNoEffect` refuses one that does. This replaces the
draft's blind, which the review correctly found protected the analyst while the
operator held the key.

The pilot is reported whether it passes or holds.

## 8. Exclusion after registration

A task may be excluded only for a reason fixed here, recorded with evidence,
and decided without reference to an outcome:

```text
NOT_BUILDABLE under the frozen census, decided before any episode
leakage discovered in the task prompt, evidenced by the firewall check
```

That is the whole list. Harness failure, timeout, non-completion and oracle
indeterminacy are **not** exclusions — they are failures inside the ITT
denominator. The draft listed them as exclusions and that was defect 5.

A task may never be excluded because its result is surprising, because its
repository is short, or because including it moves the interval across zero.

## 9. Stopping rules

```text
stop and report   a repository falls below the buildable floor
stop and report   an oracle's controls fail and cannot be repaired without
                  seeing outcomes
stop and report   a leakage finding invalidates an authored task
stop and report   runtime or configuration drift between the arms
stop and report   randomization integrity is broken
continue          everything else, to the registered budget
```

No interim look at the effect. No adaptive rule. Adding one is a new
preregistration.

## 10. What a result may claim

Permitted, if supported:

> Automatic CommitLore delivery improved decision-safe completion of fresh
> coding-agent tasks for the frozen, oracle-buildable decisions in these four
> repositories.

Forbidden in every result:

```text
the recorded decisions were objectively optimal
the maintainers agreed with them
CommitLore finds globally correct architecture
all repositories benefit
Record-Id itself causes the improvement
access to the record, rather than automatic delivery of it, causes it
the semantic content alone, rather than the delivered payload, causes it
```

## 11. Carried-forward limits

Stage 0 established feasibility and not these. The confirmatory report repeats
them rather than inheriting silence:

- G3 and G4 were reviewer readings from the record, the paths and the commit
  prose. No reviewer read the current code or ran a test; G3's agreement was
  0.59.
- G5 recorded that an oracle could be written. None was built.
- 55 gates fail closed as unresolved, so 62 is a lower bound.
- A0 admitted every enumerated decision; seven of its eight conditions cannot
  fail on the input the census built.
- The anti-provenance guard cannot see a dependence running through the
  reviewers.
- The pilot allocation is deterministic pseudorandom under a hash assumption,
  not content-blind. An earlier draft claimed otherwise and was wrong; the
  correction stands in `../stage1/pilot-design.json`.

## 12. State at this revision

```text
measured product-effect rows = 0
measured_run_allowed         = false
buildability dispositions    = 0 of 62
oracles built                = 0
tasks authored               = 0
runtime lock                 = not frozen
randomization schedule       = not computable
```

The first agent episode under an assigned arm is the irreversible step. It
needs this document frozen, the four items in §0 closed, and a separate
explicit owner approval that no artifact in this tree can grant.
