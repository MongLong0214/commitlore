---
document_id: cdeb-fresh-v5-stage1-r1-analysis-plan
study_id: cdeb-fresh-v5
stage: stage1-r1
status: frozen-before-any-episode
measured_run_allowed: false
---

# Analysis plan

Frozen before any episode exists, so nothing here can have been chosen to suit
a result. Every rule below is executed by `bench/cdeb/freeze/analysis-v5.ts`
rather than described here and implemented later — the prose and the code are
the same decision, and the tests hold them together.

## 1. The endpoint

```text
DSFPS = completed AND functional_acceptance_pass AND revival == false
```

Three conjuncts, and the third is `== false` rather than `!= true` on purpose.
An episode the oracle could not judge has `revival = null` and scores as a
failure. Treating "no judgement" as "no revival" would let an unparseable tree
count as a success.

## 2. The denominator

Intention-to-treat over **assigned** episodes. `ittEpisodes` takes the
assignment and the observations and returns one row per assignment; an assigned
episode with no observation is materialized as
`completed=false, functional_acceptance_pass=false, revival=null`.

`assertNoPostTreatmentDrop` then refuses an analysis set that has lost any
assigned episode.

The reason is the failure mode the draft's exclusion list would have allowed.
Completion, timeout and oracle indeterminacy can all differ by arm. If they may
be removed, a treatment that merely prevents the agent from finishing scores as
a treatment that prevents revival — the endpoint would reward breaking the
agent. So the exclusions are gone and the failures stay in.

A per-episode evaluable-pair analysis may be reported as a **sensitivity**
alongside the ITT result. It never replaces it.

## 3. The estimand

```text
D_r    = mean over candidates in r of ( mean_repeat DSFPS_ON  -  mean_repeat DSFPS_OFF )
Delta  = (1/4) * sum over the four fixed repositories of D_r
```

Equal weight per repository, so gitseed's 19 candidates do not outvote
agent-control-plane's 7.

The four repositories are passed into `equalWeightDelta` explicitly rather than
derived from the data. Deriving them is exactly how an empty stratum
disappears: a repository that contributed nothing would simply not appear in a
group-by, and the average would quietly become one over three. Passed in, an
empty stratum throws.

**An empty stratum is a stop and a report.** `Delta` is undefined, not
recomputed over the survivors.

## 4. The interval

```text
unit          the candidate cluster, carrying both arms and all repeats
resampling    with replacement, within each fixed repository, to that
              repository's own count
combination   recompute D_r from the drawn candidates, then equal-weight Delta
replicates    20,000
interval      percentile, 95%
seed          committed, from randomization-plan.json
```

**The four repositories are never resampled.** The Stage 1 draft did resample
them, and the adversarial review was right that this is invalid: it treats four
fixed strata as a draw from a superpopulation, ignores candidate and episode
variation inside each, and admits only 4⁴ = 256 distinct resamples however many
replicates are requested. Asking for 10,000 draws from 256 possibilities does
not make the interval finer; it makes the report look as though it did.

`assertNoRepositoryResampling` refuses the unit by name, so the old shape cannot
return under a new label.

Sensitivity analyses, reported alongside and never instead: a paired
randomization test, and the four per-repository estimates individually.

## 5. Superiority

The primary claim requires the 95% interval for `Delta` to exclude zero in the
predicted positive direction — automatic delivery raises DSFPS. A result in the
other direction is reported as measured, not reframed.

## 6. Non-degradation

Functional-pass rate and completion rate are reported with a preregistered
noninferiority margin of **−5 percentage points**.

A treatment that reduces revival by materially reducing completion or
functionality has not improved the agent, and may not be presented as improved
coding-agent performance whatever `Delta` shows.

## 7. Secondary endpoints

```text
functionally viable revival      functional PASS and the ruled-out approach implemented
functional acceptance pass rate
completion rate
per-repository DSFPS and FVR     reported individually, never pooled into a headline
manipulation checks              delivery arrival, and accidental discovery in the control arm
```

Never endpoints, in any analysis: record citation, wording repetition, reason
restatement, Record-Id mention. Each would let the treatment satisfy the
measurement merely by arriving.

## 8. What is descriptive only

`identity_present`, `authority_strength`, `independent_corroboration` and
`protocol_version` are described, never claimed on. They are confounded with
repository, protocol era and capture format, and a subgroup comparison across
them would be reporting the corpus.

## 9. What this plan cannot fix

The corpus is 50 reserve candidates over four fixed strata. At the frozen
envelope of 8 repeats it detects about 12–17 percentage points depending on
between-candidate heterogeneity. A smaller effect is not detectable by any
analysis choice, and `power-and-resource-rule.json` registers that before the
fact so a null result cannot later be read as evidence of no effect.
