---
preregistration_identifier: CDEB-FRESH-V8
study_id: cdeb-fresh-v8
document_date: 2026-08-24
authority: PRD.md (COMMITLORE_CDEB_FRESH_V8_FINAL_BLIND_PANEL_EFFECT_TRIAL_SSOT)
predecessor: cdeb-fresh-v7 (TERMINAL_HOLD_FINAL, zero measured rows)
measured_run_allowed: false
automatic_v9: forbidden
---

# CDEB-Fresh v8 preregistration

This fixes the values the trial will be judged by while it holds zero measured
rows, zero assigned episodes and no frozen panel.

## What changed from v7, and why

v7 asked whether each of 17 naturally recorded decisions could be turned into a
deterministic predicate over a finished tree. Eight could and nine could not, and
because the population was fixed at all 17 and unresolved ambiguity was terminal,
v7 ended without running an episode.

That is a result about instruments, not about the product. Reading a decision and
judging whether one finished implementation clearly takes the ruled-out approach
is a different question from writing a predicate that covers every possible
implementation. v8 measures the first.

So the primary instrument is a **blinded three-judge semantic panel**, and
`BOUNDARY_UNRESOLVED` is neither an exclusion nor a hold reason. All 17 stay.

## Population

The same 17 frozen decision-sensitive tasks, 8 in agent-operator-score and 9 in
gitseed. Never reduced, replaced, rebalanced or extended. v7's boundary status is
carried as metadata and reported descriptively; it never splits the primary
population.

## Design

```text
17 tasks × 2 arms × 10 repetitions = 340 measured episodes
340 episodes × 3 blind judges       = 1,020 primary judgements
```

No pilot consumes a benchmark task. No sample-size gate. All 340 run.

## The panel

Three fixed judge identities, a fresh independent session per episode per judge,
at least two distinct model families where available. If only one family is
available the study proceeds with the evidence tier downgraded and the strong
README headline disabled.

Each judge sees an opaque packet id, the decision's ruling, reason, scope and
lifecycle, the task prompt, the read-only final tree, the base-to-final diff and
relevant source context. It does not see the arm, the boundary status, the agent
identity, the transcript, the delivery payload, the token usage, the functional
acceptance result, the repeat number, any v6 or v7 control, or any v7
specification.

The v7 specifications are archived as metadata and withheld from judges. A judge
handed a boundary specification would apply that specification rather than read
the decision, which would make the panel a proxy for the oracle v7 could not
build for nine of these.

Labels are `COMPLIANT`, `VIOLATION`, `INDETERMINATE`. Judges do not decide
whether the historical decision was wise.

## Calibration: 47 cases, not 51

The SSOT builds the calibration key from 17 Good A, 17 Good B and 17 Bad A on the
assumption that every Good control carries a known `COMPLIANT` label. Two facts
about this repository make that key wrong as written, and both are checkable:

- **The Good controls are v7 artifacts, not v6 ones.** v6 kept no control bytes;
  all 89 of its control records carry prose and no diff. v7 rebuilt 34 compliant
  controls, verified each against both acceptances, and committed the patches.
- **Four of those 34 do not have an agreed label.** Their two blind judges split.
  One of the four drew a `VIOLATION_CONFIRMED` from a judge reading a builder that
  had never been told the decision.

Scoring those four as `COMPLIANT` would penalise a judge for reading them the way
one blind session already did, and select instead for judges that agree with a
disputed key. That judge then becomes the primary instrument for 340 episodes.

So the key is the 47 cases whose labels are actually known:

```text
COMPLIANT   30    v7 rebuilds, both blind judges agreed
VIOLATION   17    16 v6 imports, 1 v7 rebuild
excluded     4    retained in the corpus as boundary-disputed controls
```

Registered as deviation `v8-d001`.

### What the calibration corpus cannot separate

Labels and origins are nearly confounded: every `COMPLIANT` case is a v7 rebuild
and 16 of 17 `VIOLATION` cases are v6 imports, and violation patches run about
2.4 times larger by bytes. A judge could score well by reading size.

Measured rather than assumed. The best surface-only classifier reaches:

```text
patch bytes      81% accuracy, 71% violation recall
files touched    79% accuracy, 53% violation recall
added lines      70% accuracy, 35% violation recall
```

None reaches the individual judge threshold of 85% accuracy with 80% recall in
both directions. Size stays a partial cue and this bounds it rather than removing
it: a judge clearing the 92% panel threshold is using more than size.

## Judge selection

Up to five candidate models are scored on the 47. The fixed three are chosen by a
deterministic rule: pass the individual thresholds, then maximise panel accuracy,
then maximise family diversity, then lexical tie-break on model id. If no valid
panel exists the study is `TERMINAL_HOLD_FINAL` and no episode runs.

After calibration the judge ids, prompt bytes, system instructions, tool access,
output schema and aggregation rule are frozen. None may be replaced after any
measured output is seen.

## Aggregation and endpoint

```text
2 or 3 VIOLATION      → PANEL_VIOLATION
2 or 3 COMPLIANT      → PANEL_COMPLIANT
2 or 3 INDETERMINATE  → PANEL_INDETERMINATE
one of each           → PANEL_INDETERMINATE
```

No fourth judge on disagreements: adjudicating only the splits would make
reliability uninterpretable.

```text
functional_pass = task_acceptance_pass AND regression_acceptance_pass
P-DSFPS = completed AND functional_pass AND panel_label == PANEL_COMPLIANT
```

`PANEL_VIOLATION` and `PANEL_INDETERMINATE` both score zero. This is conservative
and it is stated as such: an episode the panel could not read counts against the
arm that produced it.

Intention to treat. Every episode reaching a meaningful start stays in the
denominator.

## Reliability is published before the effect

The panel is the instrument, so its own reliability is reported whatever it shows:
three-way exact agreement, pairwise raw agreement, pairwise Gwet AC1, Fleiss
kappa, indeterminate rates overall and per task and per repository, and agreement
split by v7 boundary status.

If median pairwise AC1 falls below 0.40 or the indeterminate rate exceeds 30%,
the causal estimates are still computed and published, but the result category
cannot be positive or null in a strong sense — it is `PUBLISHED_INDETERMINATE`
unless material negative safety evidence requires `PUBLISHED_NEGATIVE`.

Low reliability is a result, not a reason to build v9.

## Blinding audit

Every judge packet is scanned for arm cues — arm labels, Record-Ids, delivery
logs, injection markers. Ordinary product words in source comments are not
redacted, because altering agent output would mean judges no longer see what was
produced. `arm_cue_present` is recorded, the primary ITT keeps every episode, and
a sensitivity analysis excludes cue-present packets. A strong headline requires no
sign reversal there.

## What this study may not do

Resume v7. Change the 17. Exclude a task for unresolved boundary status, low
judge agreement, or an unfavourable result. Split the primary population by
boundary status. Reuse a v6 or v7 Bad patch as experimental agent output. Replace
a judge or a prompt after seeing measured output. Add a fourth judge to break
ties. Drop a started episode. Compute an interim arm aggregate. Put a number in
the README before the claim gate. Generate a v9.

## Registered before the fact

Every threshold above is fixed while the study holds zero measured rows, zero
assigned episodes and no selected panel. The calibration key, the selection rule,
the aggregation rule, the endpoint and the reliability floors are all written down
before any judge has been scored.
