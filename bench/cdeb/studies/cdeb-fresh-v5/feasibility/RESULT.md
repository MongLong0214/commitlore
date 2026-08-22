# CDEB-Fresh v5 Stage 0 Result

> Generated from this study's artifacts by `scripts/render-v5-stage0-result.mjs`.
> Every number below is read from a committed file; none is typed by hand.

## Live state

```text
study:                cdeb-fresh-v5
phase:                stage0-authority-corpus-feasibility
measured_run_allowed: false
predecessor v4:       stage0-hold, preserved, 0 measured rows
measured rows:        0
study cutoff:         2026-08-20T22:08:19Z
product release:      v1.2.0 (90a8b212e1db)
```

## Owner decisions

```text
repository rule:  eligible at >= 8 qualified; GO needs >= 3 eligible and >= 36 total
owner testimony:  disabled — A2 collected 0
```

## Scientific construct

> **A naturally recorded, pre-study CommitLore decision is itself a repository recorded-policy artifact.**

The eventual outcome is whether a final code tree implements a functionally viable
approach the policy ruled out — not whether an agent cited a record, repeated its
wording, or stated its reason. Those are named as forbidden outcomes because each
would let the treatment satisfy the measurement merely by arriving.

## Fresh census and authority

| repository           | raw | A0  | A1 | A0-only | identified | id-less |
|----------------------|-----|-----|----|---------|------------|---------|
| agent-control-plane  | 35  | 35  | 11 | 24      | 1          | 34      |
| agent-operator-score | 59  | 59  | 23 | 36      | 48         | 11      |
| gitseed              | 104 | 104 | 27 | 77      | 94         | 10      |
| logic-pro-mcp        | 43  | 43  | 19 | 24      | 0          | 43      |

```text
A0: 241    A1: 80    A2: 0
```

**A0 admitted every decision it was given, and that is mostly structural.** The
census emits a candidate only when a ruled-out alternative and its reason parsed
out of a record inside the frozen bundle, so most A0 conditions cannot fail on its
own input. Which conditions were inert on this corpus:

```text
pre_cutoff                         failed   0   (inert here)
in_frozen_snapshot                 failed   0   (inert here)
not_benchmark_authored             failed   0   (inert here)
not_reconstructed_or_backfilled    failed   0   (inert here)
explicit_reason                    failed   0   (inert here)
scope_recoverable                  failed   0   (inert here)
lifecycle_recoverable              failed   0   (inert here)
authorized_repository              failed   0   (inert here)
```

## Qualification funnel

| repository           | raw | A0  | A1 | semantic | hidden | viable | oracle | delivery | bounded | leak-safe | qualified | eligible |
|----------------------|-----|-----|----|----------|--------|--------|--------|----------|---------|-----------|-----------|----------|
| agent-control-plane  | 35  | 35  | 11 | 28       | 18     | 28     | 27     | 28       | 33      | 35        | 10        | yes      |
| agent-operator-score | 59  | 59  | 23 | 54       | 32     | 45     | 53     | 41       | 58      | 59        | 17        | yes      |
| gitseed              | 104 | 104 | 27 | 72       | 62     | 100    | 69     | 63       | 104     | 104       | 22        | yes      |
| logic-pro-mcp        | 43  | 43  | 19 | 34       | 23     | 30     | 33     | 43       | 43      | 43        | 13        | yes      |

## Identity

```text
enumerated identified: 143
enumerated id-less:    98
qualified identified:  36
qualified id-less:     26
missing-id exclusions: 0
qualified with no independent corroboration: 44
```

## Freshness

```text
old task reused:        0
old gold reused:        0
old trajectory reused:  0
old result row reused:  0
v4 qualification rows imported: 0
synthetic Record-Ids:   0
owner testimony:        0
```

## Delivery

```text
probed:              241
delivered:           175
  identified:        90
  id-less:           85
stale-as-current:    0
harness failures:    0
```

Three structural bounds, unchanged from v4 and restated because they bound this
number too: scope is tested against one non-touched path; lifecycle is not read
from the payload for an active decision, so that field discriminates only the
superseded cases; and the pre-mutation surface is a synthetic `PreToolUse` event
rather than an observation of a real agent.

## Reviewer agreement, per gate

| gate | compared | agreed | rate  |
|------|----------|--------|-------|
| G2   | 240      | 216    | 0.900 |
| G3   | 240      | 141    | 0.588 |
| G4   | 240      | 209    | 0.871 |
| G5   | 240      | 217    | 0.904 |
| G7   | 240      | 237    | 0.988 |

Both reviewers are independent sessions of one model family; their agreement bounds
reliability from above, not below. Where they split, a third blind vote decides by
majority rather than an adjudicator who already knows how the pair voted.

## How much the tie-break rule moves the answer

Where the two blind reviewers split, a gate is resolved only when **both**
tie-breakers -- one from each model, run fresh and blind -- return the same
answer. The first implementation used a single tie-break drawn from reviewer A's
own model, and it sided with A on 120 of the 180 splits it resolved. A tie-break
that agrees with one disputant two times in three is not breaking the tie.

```text
no_tiebreak                        qualified  44  eligible 3  GO
single_tiebreak_same_model_as_a    qualified  88  eligible 4  GO
both_tiebreakers_must_agree        qualified  62  eligible 4  GO  <- adopted
```

The adopted rule is the strictest of the three that resolves anything, and it
returns a smaller corpus than the biased single vote it replaced. The verdict is
GO under all three, and the repository set is four under both rules that break
ties at all.

## Where the candidates went

| exclusion reason                              | count |
|-----------------------------------------------|-------|
| record-ambiguous                              | 44    |
| reason-obvious-from-code-unresolved           | 43    |
| reason-obvious-from-code                      | 41    |
| shipping-content-not-observable               | 27    |
| record-ambiguous-unresolved                   | 9     |
| wrong-path-not-functionally-viable            | 8     |
| wrong-path-not-functionally-viable-unresolved | 3     |
| oracle-not-deterministic-unresolved           | 2     |
| oracle-not-deterministic                      | 2     |

No candidate was excluded for missing identity, missing corroboration, or a
decision not being documented outside its record. A guard refuses any run in which
one is, so this is checked rather than asserted.

## Repository set

```text
eligible repositories: 4  (threshold 3)
qualified per eligible repository floor: 8
total qualified:       62  (threshold 36)
fixed-set recommendation: agent-control-plane, agent-operator-score, gitseed, logic-pro-mcp
```

## Verdict

**GO**

### If GO — recommended next steps only

- a final v5 confirmatory PRD
- a pilot design over at least 12 of the qualified candidates
- a power-analysis plan, run after the pilot and frozen separately

None of these is executed here.

## Deviations recorded

- `CDEB-V5-SNAPSHOT-REUSE-OVER-RESNAPSHOT` — named-deviation-from-default-preference
- `CDEB-V5-COMBINED-INTERPRETATION-AND-GATES` — procedure-combined
- `CDEB-V5-REVIEWER-MODEL-FAMILY` — reviewer-independence-limitation
- `CDEB-V5-TWO-TIEBREAKERS-MUST-AGREE` — procedure-strengthened-after-measuring-its-own-bias

## Deliberately not done

- no pilot
- no measured run
- no randomization
- no README headline

```text
measured product-effect rows = 0
qualification rows written   = 241
```

CDEB-FRESH V5 STAGE 0 COMPLETE — PRODUCT-EFFECT MEASUREMENT NOT STARTED
