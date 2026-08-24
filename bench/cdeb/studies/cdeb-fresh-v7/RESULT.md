---
document_id: cdeb-fresh-v7-result
study_id: cdeb-fresh-v7
preregistration_revision: r1
status: TERMINAL_HOLD_FINAL
measured_product_effect_rows: 0
measured_run_allowed: false
document_date: 2026-08-24
---

# CDEB-Fresh v7 — TERMINAL_HOLD_FINAL

> CDEB-Fresh v7 reached TERMINAL_HOLD_FINAL before any product-effect episode.
> Eight of the fixed 17 decisions yielded a semantic boundary precise enough for
> deterministic oracle construction and nine did not. Because the preregistered
> population was fixed at all 17 tasks and unresolved ambiguity was terminal under
> v7, the population was not reduced post hoc. This result concerns deterministic
> machine adjudicability, not the causal effect of CommitLore delivery.

## The number

```text
fixed benchmark population              17
semantic boundary settled                8
semantic boundary unresolved             9
measured product-effect episodes         0
```

Each of the seventeen decisions was read twice by independent sessions that saw
the rule and the repository at the frozen snapshot and nothing else. Where both
drew a boundary, a third session tried to construct a tree the two would
classify differently. Where they split, a fourth read the rule again with both
attempts anonymised, and was asked the original question rather than which
attempt to prefer.

| how it was settled | candidates |
| --- | ---: |
| both readers drew the same boundary | 3 |
| third reading resolved the split | 5 |
| **settled** | **8** |
| third reading found the rule does not settle it | 5 |
| both readers agreed it cannot be drawn | 4 |
| **unresolved** | **9** |

## What the nine have in common

They fail the same way. Each rule turns on a term it never defines, and the
reason recorded beside it reaches further than the words do:

```text
literally              does a frozen count, hash or snapshot count as pinning it
a badge                which badges, when the tree carries CI and licence badges
add the two paths      is classifying one of the two already a violation
hand-maintained        provenance, which a finished tree does not record
prose field            with derives, fixes numerically, and literal digest
```

These decisions were written by people for people, in a commit trailer, and they
read perfectly well that way. Serving as a machine-decidable predicate over a
finished tree is a harder demand than they were written to meet.

One is not vagueness at all. "Hand-maintained" is a claim about how a file came
to exist. The oracle's admissible input is the final tree, which does not record
that, so no rereading fixes it — the rule settles its own question and no
admissible instrument can apply it.

## What this is not

It is not a result about CommitLore. No episode ran, no arm was assigned, and
nothing here supports or refutes any claim about whether automatic decision
delivery helps an agent.

It is not a claim that these decisions are poor. Every one of them is legible to
a human reader, and the eight that settled show the corpus is not uniformly
vague.

It is a measurement of one thing: how far naturally recorded repository decisions
survive being turned into deterministic predicates. Eight of seventeen.

## Why the population was not reduced

The preregistration fixed the population at all 17 before any task was built, and
made unresolved ambiguity terminal. Running v7 on the eight that settled would
have been a study of the decisions that happen to be machine-adjudicable,
reported as though it were a study of the seventeen. The floor was registered to
prevent exactly that, and it was not moved.

## What v7 also established, and did not need to

Two things were repaired in flight and are worth reading before any successor
reuses this corpus:

- **v6 kept no control bytes.** All 89 v6 control records carry prose and no
  diff. The Bad A patches survived only because the blind judges had been handed
  a diff; Good A and Good B did not survive at all. v7 rebuilt 34 compliant
  controls, all passing both acceptances, and committed the patches. Recorded as
  `v7-d003`.
- **v6 rendered judge diffs with `git diff`,** which omits files the builder
  created. All seventeen imported patches carry zero new-file entries, and the
  one Bad A that created a module could not be replayed. Rebuilt and confirmed a
  violation by two blind judges. Recorded as `v7-d004`.

Both were corrected before any outcome existed.

## Artifacts

```text
PREREGISTRATION.md                          endpoint, pairing, interval method, claim gate
benchmark-manifest.json                     the 17, every input bound by path and digest
product-lock.json                           measured dist digest, and the declared one that matches nothing
preflight/control-replay.json               Base and Bad A replayed, 17/17
preflight/good-control-verification.json    34 rebuilt controls against both acceptances
preflight/good-control-compliance.json      68 blind judgements on those controls
oracle-specs/                               51 specifications: two per candidate, plus ten third readings
spec-agreement/                             9 boundary comparisons with their attempted refutations
preflight/phase5-summary.json               where each of the 17 ended up
v7-controls/                                the rebuilt control patches
imported-controls/                          the surviving v6 Bad A patches
deviations.jsonl                            v7-d001 through v7-d004
transitions.jsonl                           every state change, inputs and outputs hashed
```

## Limitations

- **Every session in the boundary work is one model family.** Independent of each
  other, not independent of what that family finds hard to pin down. A different
  family might settle more or fewer than eight.
- **Agreement is bounded by one comparator's effort.** A separating tree that
  exists and was not constructed reads here as agreement, so three of the eight
  rest on a failure to refute rather than a proof of equivalence.
- **Eight settled is a count of boundaries, not of working oracles.** None was
  implemented, run against a control, or attacked by a red-team.
- **The rebuilt Good controls are v7 artifacts.** They occupy the v6 slots and are
  not what v6's builders wrote; four of the 34 were not read as cleanly compliant
  by their blind judges.

## Successor

v7 is terminal and is not resumed. A successor requires a separate owner decision
and is not generated automatically.
