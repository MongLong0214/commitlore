---
document_id: cdeb-fresh-v5-stage1-preregistration
study_id: cdeb-fresh-v5
stage: stage1-confirmatory
status: DRAFT-NOT-FROZEN-failed-adversarial-review
measured_run_allowed: false
registered_at: 2026-08-22T05:10:00Z
---

# CDEB-Fresh v5 Stage 1 preregistration — DRAFT, NOT FROZEN

> **This document does not register anything yet.** An adversarial review of the
> Stage 1 design, run before freezing and committed at
> `stage1/adversarial-review.md`, found six defects that would let a wrong
> conclusion through. Under §7 of this document, anything but the deferred N
> requires a replacement preregistration — so these are not amendments and this
> draft is superseded, not patched.
>
> **A measured run may not begin against this document.**

## 0. What must be resolved before any preregistration is frozen

1. **The endpoint is not yet shown judgeable.** Stage 0 recorded that reviewers
   thought an oracle possible; none was built. Each oracle needs a ruled-out
   patch that passes functional acceptance *and* trips the oracle, plus
   compliant passing patches that do not. Determinism is not sensitivity.
2. **No rule covers oracle-construction failure.** The population is the 50
   reserve candidates but N may be smaller, with no frozen selection rule — so a
   builder could keep the candidates with crisp boundaries and lose the awkward
   ones. Every reserve candidate needs an outcome-blind buildability disposition
   and a content-blind sampling rule fixed before N.
3. **The interval in §6 is invalid.** Bootstrapping four *fixed* repositories
   treats them as drawn from a superpopulation, ignores candidate and episode
   variation inside each, and admits only 4^4 = 256 distinct resamples whatever
   number is requested. No confidence level was stated. Replace with a
   repository-stratified analysis that resamples candidates within each fixed
   repository, or a randomization test.
4. **Too much is deferred.** Opaque arm labels hide direction, not magnitude.
   Alpha, power, the target effect, the paired correlation model, the attrition
   allowance and the stopping rule must all be fixed before the pilot; only N
   may follow from it.
5. **The exclusions condition on post-treatment events.** Completion, timeout
   and oracle indeterminacy can differ by arm, so removing them can manufacture
   the contrast. Needs an intention-to-treat denominator, a paired-missingness
   rule, and task success as a co-primary — otherwise a treatment that merely
   prevents completion scores as preventing revival.
6. **The pilot blind protects the analyst, not the operator.** The study
   operator holds the key and would see the pilot effect before deciding to
   continue. The key needs an independent custodian and effect-independent
   continuation thresholds.

Two further findings are recorded as limitations rather than defects: the two
arms differ in payload volume and hook activity as well as in decision content,
so the contrast is the total effect of automatic delivery rather than the effect
of the content alone; and the record stays discoverable in Git under both arms,
so the contrast is automatic delivery versus none, not access versus none.

## 1. Hypothesis (draft)

> Automatically delivering a naturally recorded, pre-study repository decision
> before a relevant code mutation reduces the rate at which a coding agent
> implements a functionally viable approach that the decision ruled out.

Direction is specified: the study predicts fewer revivals under delivery. A
result in the other direction is reported as measured, not reframed.

## 2. Population

The 50-candidate confirmatory reserve in `stage1/pilot-design.json`. Pilot
candidates are excluded permanently, as is every artifact built for them.

```text
agent-control-plane 7   agent-operator-score 14
gitseed            19   logic-pro-mcp        10
```

## 3. Assignment

Each candidate yields one task, run under both arms. Assignment order within a
candidate is randomized against a seed recorded in the randomization artifact
before the first episode. The seed is committed, not chosen at run time.

## 4. Primary endpoint

```text
revival = the final tree implements the ruled-out approach while passing the
          task's functional acceptance criteria
```

Judged by the oracle from the final tree alone. The oracle may not read the arm,
the delivery log, the transcript, a record citation or token usage. Record
citation, wording repetition and reason restatement are forbidden as endpoints.

## 5. Estimand

```text
Delta = (1/4) * sum over the four fixed repositories of (revival_off - revival_on)
```

Equal weight per repository. If any repository contributes zero analysable
tasks, `Delta` is undefined and the study stops and reports; it is not
recomputed over the surviving strata.

## 6. Analysis

```text
point estimate     Delta as defined in §5
interval           paired bootstrap over repositories, 10,000 resamples,
                   percentile interval
primary claim      requires the interval to exclude zero in the predicted
                   direction
secondary          per-repository differences, reported individually and never
                   pooled into a headline
descriptive only   identity_present, authority_strength, protocol_version
```

Subgroup comparisons by identity or corroboration are **descriptive only** and
may not support a claim. Those attributes are confounded with repository,
protocol era and capture format.

## 7. The deferred slot

```text
final N per repository            from the power artifact
repeats per arm                   from the power artifact
stopping rule                     from the power artifact
minimum detectable difference     from the power artifact, stated before running
```

The power analysis runs after the pilot, blinded to arm labels, and may not read
the pilot's effect estimate. Writing these four values in from that artifact is
the only permitted amendment to this document. Any other change makes this a new
preregistration with a new identifier.

## 8. Exclusion after registration

A task may be excluded after registration only for these reasons, each recorded
with evidence:

```text
harness failure -- the agent or evaluator did not run
oracle indeterminate -- the negative control failed on the day
task did not complete within the registered budget
leakage discovered in the task prompt
```

A task may **not** be excluded because its result is surprising, because its
repository is short, or because including it moves the interval across zero.

## 9. Stopping rules

```text
stop and report    any repository reaches zero analysable tasks
stop and report    the oracle's negative control fails and cannot be repaired
                   without seeing outcomes
stop and report    a leakage finding invalidates an authored task
continue           everything else, to the registered N
```

No interim look at the effect. There is no adaptive rule here, and adding one
later is a new preregistration.

## 10. What a result may claim

Permitted, if supported:

> CommitLore delivery reduced violations of naturally recorded repository
> decisions in fresh coding-agent tasks.

Forbidden in every result:

```text
recorded decisions were objectively optimal
all maintainers agreed with them
CommitLore finds globally correct architecture
all repositories benefit
Record-Id itself causes improvement
```

## 11. Carried-forward limits

Stage 0 established feasibility, not the following, and the confirmatory report
must repeat these rather than inherit silence:

- G3 and G4 were reviewer readings; no reviewer read code or ran a test, and
  G3's agreement was 0.59.
- G5 recorded that an oracle could be written; none was built.
- 55 gates fail closed as unresolved, so 62 is a lower bound.
- A0 admitted every enumerated decision, seven of its conditions being
  structurally unable to fail.
- The anti-provenance guard cannot see a dependence running through reviewers.

## 12. State at registration

```text
measured product-effect rows = 0
measured_run_allowed         = false
tasks, gold, oracles, randomization: none exist
```
