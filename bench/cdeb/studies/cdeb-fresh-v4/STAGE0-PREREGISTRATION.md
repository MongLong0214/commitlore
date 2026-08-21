---
document_id: cdeb-fresh-v4-stage0-preregistration
study_id: cdeb-fresh-v4
phase: stage0-corpus-feasibility
measured_run_allowed: false
authority: COMMITLORE_CDEB_FRESH_V4_STAGE0_FINAL_PRD_2026-08-22.md
predecessors: [cdeb-fresh-v3, cdeb-fresh-v3r1]
predecessor_status: terminal-invalidated-no-measured-data
registered_at: 2026-08-21T22:17:48Z
---

# CDEB-Fresh v4 — Stage 0 preregistration

Stage 0 answers one question and no other:

> Can a scientifically valid fresh benchmark corpus be built for historical
> repository **decision delivery**?

It does not answer whether the product works. No agent episode is run, no arm
is assigned, no outcome is recorded. At the end of Stage 0 the repository still
holds **zero measured product-effect rows**, and `measured_run_allowed` is still
`false`.

## 1. Owner estimand decision

> **The estimand concerns delivery of a prior repository decision, not delivery of a product Record-Id.**

Recorded verbatim, with its reasons, ruled-out options and limit, in
`owner-estimand-decision.json`.

The consequence that matters for this stage: **a missing `Record-Id` is never,
by itself, an exclusion reason.** It is descriptive metadata
(`identity_present`) and nothing else. The converse also holds — a present
`Record-Id` admits nothing on its own. Every candidate passes or fails on the
gates in §4.

## 2. What Stage 0 inherits, and what it must not

Reusable after verification (infrastructure, not findings):

```text
sealed Git bundles          source-packet redaction      role isolation
OCI isolation               ledger and lifecycle code    evidence-matrix tooling
schema validators           guard mutation infrastructure
```

Refused outright (findings, not infrastructure):

```text
study_id                    old selection                old task prompts
old gold                    old oracles                  old seeds
old trajectories            old result rows              old qualification outcomes
```

The predecessor's *qualification verdicts* are the specific thing this stage may
not inherit. v3r1 rejected every candidate it examined under a rule this study
has discarded; re-reading those verdicts would import the discarded rule under a
new name. Every candidate starts at `pending` and is decided again here.

### 2.1 Sealed bundles — a named reuse with its reason

The four sealed bundles frozen at `2026-08-20T22:08:19Z` are reused as the
source of repository history, rather than re-freezing from the live remotes.

- They are repository history, not benchmark artifacts. Nothing in them was
  authored for a benchmark.
- Re-freezing today would move the cutoff *past* the period in which benchmark
  work itself touched those repositories, admitting exactly the contamination
  §3 exists to exclude.
- Their digests are recomputed here and compared against the recorded
  `snapshots.json` before any read. A digest mismatch halts Stage 0; it is not
  repaired in place.

The bundles are read-only inputs. Their location inside a terminal study's
directory does not make this stage a continuation of that study.

## 3. Candidate universe

The pool of historical decisions carrying an explicit reason is a
**potential source-decision pool**. It is not a task count, not an eligible
count, and not a benchmark size. The following phrases are forbidden in every
artifact this study produces:

```text
158 tasks secured        158 eligible tasks        158 benchmark cases
```

Each candidate carries exactly one status: `pending`, `qualified`, or
`ineligible`. No row is deleted; an excluded candidate keeps its row and gains a
reason code.

## 4. Qualification gates

A candidate is `qualified` only if every gate below passes. Any failure records
the corresponding code from §5 and stops evaluation of that candidate.

**G1 — Natural provenance.** Exists before the study cutoff, arose in ordinary
development, is not benchmark-authored.

**G2 — Source sufficiency.** Decision, reason, path scope and lifecycle are all
recoverable from the frozen snapshot. Recoverable means *from ordinary source*
— see §6.

**G3 — Hidden rationale.** The current code or the task statement alone does not
trivially reveal why the rejected approach was rejected. The benchmark tests
preserved judgment, not a constraint a reader can see.

**G4 — Wrong-path viability.** The rejected approach could still satisfy the
functional acceptance criteria of a maintenance task. This study is about
`works, but violates repository judgment` — not about ordinary bugs, which
functional tests already catch.

**G5 — Oracle feasibility.** A future final tree could be classified
deterministically for revival of the rejected approach. Stage 0 records only
`oracle_feasible: true|false` with evidence. It does not build the oracle.

**G6 — Shipping content-delivery feasibility.** The latest shipping path
(v1.2.0) can render, before the first mutation, the load-bearing ruling, the
reason, the correct path scope and the current lifecycle. `identity_present` is
recorded as metadata and has no vote. No single substring match is a sufficient
delivery signal on its own.

**G7 — Bounded task feasibility.** A maintenance task can be posed within a
reasonable timeout and tool budget.

**G8 — Leakage safety.** No exposure to an old benchmark answer, task, fixture,
prompt hash or candidate id.

## 5. Exclusion reason codes

```text
benchmark-authored                  prior-benchmark-task-equivalent
insufficient-provenance             reason-not-explicit
scope-unresolvable                  lifecycle-unresolvable
reason-obvious-from-code            wrong-path-not-functionally-viable
oracle-not-deterministic            shipping-content-not-observable
task-not-bounded                    source-packet-empty
legacy-exclusion-match              stale-superseded-decision
```

`missing-record-id` is not a code and must not become one.

## 6. Ordinary source, and what gold may not copy

Gold is never a copy of a rendered CommitLore record. The evidence chain is:

```text
candidate discovery → source refs → sealed bundle → ordinary-source packet
→ CommitLore trailers, notes and rendered records removed → independent review
```

A candidate with no independent ordinary-source support is never automatically
qualified. Its default outcome is `insufficient-provenance`.

## 7. Provenance tiers

```text
P1  independent ordinary-source supported
P2  owner-attested, bound to a frozen historical anchor
```

P2 is permitted only when produced before any outcome is visible, frozen before
task authoring, not copied from record text, bound to a source commit and
snapshot, and accompanied by the owner's statement of participation at the time.

P1 and P2 are never silently mixed. Stage 0 reports them separately and takes no
position on whether P2 may enter a future primary corpus; that is a decision for
the Stage 1 preregistration.

## 8. Adjudication

Judgment gates (G2, G3, G4) are decided by paired reviewers who are blind to
each other, run in fresh sessions, and where possible drawn from different model
families. Roles: `SRC-A/B`, `PROV-A/B`, `VIABILITY-A/B`, `ORACLE-FEASIBILITY`,
`DELIVERY-FEASIBILITY`, `ADJUDICATOR`, `OWNER`.

Disagreement between a pair is resolved by `ADJUDICATOR` on the evidence, and
the disagreement is recorded, not erased. Agreement rate per gate is reported.
The owner sees only what adjudication could not resolve.

**Ties and unresolved cases fail closed:** a candidate that cannot be resolved
is `ineligible`, never `qualified`.

## 9. GO / HOLD

Registered before v4's own census runs, and taken unchanged from the owner's
Stage 0 PRD §10 and §17:

```text
GO requires all of:
  eligible repositories                        >= 3
  qualified candidates per eligible repository >= 12
  total qualified non-pilot candidates         >= 48
  delivery observability demonstrated for both identified and id-less decisions
  no unresolved provenance blocker
  freshness audit passes
Otherwise HOLD.
```

A repository is *eligible* when it holds at least 12 qualified candidates.

On HOLD the following are forbidden: relaxing any threshold, minting synthetic
records, cherry-picking repositories after seeing counts, or re-running a gate
until it yields a different answer.

### 9.1 Threshold provenance — disclosure

These thresholds were authored by the owner in the Stage 0 PRD dated
2026-08-22, before this study existed. They were not chosen after seeing v4
counts.

What *was* visible beforehand, and is disclosed here rather than left implicit:
the predecessor's census recorded 157 explicit-reason candidates across the four
surveyed repositories (gitseed 71, agent-operator-score 30, logic-pro-mcp 29,
agent-control-plane 27). Those are pre-gate counts under the discarded rule.
They are not qualification outcomes, and no gate below is calibrated against
them. The disclosure exists so that a reader can judge the thresholds knowing
what the author of this file already knew.

## 10. Forbidden in Stage 0

```text
task execution        agent ON/OFF        pilot                confirmatory run
randomization         outcome collection  token accounting     README metrics
product claims        effect sizes        significance tests   v3/v3r1 resumption
```

Directories `tasks/`, `gold/`, `oracles/`, `pilot/`, `rows/` and
`randomization/` are not created by this stage.

## 11. Stage 0 outputs

```text
study.json                    STATUS.json               owner-estimand-decision.json
STAGE0-PREREGISTRATION.md     deviations.jsonl
feasibility/
  decision-anchor.schema.json candidate-census.jsonl    provenance-audit.jsonl
  qualification.jsonl         repository-summary.json   qualification-summary.json
  RESULT.md
```

## 12. Termination

Stage 0 ends with a report and stops. Even on GO it does not create confirmatory
prompts, gold, oracles, a pilot, a randomization or a measured row. A successor
stage requires a new confirmatory PRD, a new preregistration, a fixed repository
set and separate owner approval.

Terminal condition:

```text
STAGE 0 COMPLETE — MEASURED PRODUCT-EFFECT DATA STILL ZERO
```
