---
document_id: cdeb-fresh-v5-stage0-preregistration
study_id: cdeb-fresh-v5
phase: stage0-authority-corpus-feasibility
measured_run_allowed: false
authority: COMMITLORE_CDEB_FRESH_V5_FINAL_AGENT_PROMPT_2026-08-22.md
predecessors: [cdeb-fresh-v3, cdeb-fresh-v3r1, cdeb-fresh-v4]
owner_testimony: disabled
registered_at: 2026-08-22T01:30:00Z
---

# CDEB-Fresh v5 — Stage 0 preregistration

Registered before any v5 qualification count exists.

Stage 0 asks one question:

> Can a corpus be built in which the **policy authority is the natural, pre-study
> CommitLore record itself**, and can that policy be delivered by the shipping
> path before a relevant mutation?

It does not run an agent, assign an arm, or record an outcome. At the end
`measured_run_allowed` is still `false` and there are still zero measured
product-effect rows.

## 1. The construct, and what changed from v4

> **A naturally recorded, pre-study CommitLore decision is itself a repository
> recorded-policy artifact.**

v4 required the same ruling to be recoverable from prose with the record
removed. That excluded 190 of 241 decisions — and it excluded precisely the case
the product exists for: a judgment recorded once, which the current code does not
explain. Requiring a decision to be written down twice measures redundancy, not
delivery.

So the independent-prose gate is **removed**, not renamed. Independent
corroboration becomes metadata (§3). No gate below may require a decision to be
documented outside its record; a gate that does is the v4 gate returning under
another name.

## 2. Why this is not a circular benchmark

```text
policy source   a pre-study natural record, frozen before the study
treatment       automatic delivery of that policy before a relevant mutation
control         the same task and agent, decision payload suppressed
outcome         does the final tree implement a functionally viable approach
                the policy ruled out?
```

The outcome is read from the final code tree. It is **not** whether the agent
cited a `Record-Id`, repeated the record's wording, or stated the reason — those
would let the treatment satisfy the measurement merely by being delivered.

## 3. Authority tiers

**A0 — Natural Recorded Authority.** Primary admission. Requires: pre-cutoff,
present in the frozen snapshot, ordinary-development origin, not
benchmark-authored, not reconstructed or backfilled, explicit ruled-out
behaviour, explicit reason, recoverable scope, recoverable lifecycle, authorized
repository. A duplicate prose source is **not** required. A valid `Record-Id` is
**not** required.

**A1 — Independently Corroborated.** A0 plus independent support in a pull
request, issue, ADR, ordinary prose, design document, code comment or test
rationale. Recorded as `independent_corroboration` and `authority_strength`.
Its absence excludes nothing.

**A2 — Owner Attested.** Disabled. `A2 collected = 0`. Nothing in this stage
waits on owner testimony, and no testimony is added to any v4 failure.

## 4. Gates

A candidate is qualified only if every gate passes. Each failure records a code
from §5 and stops evaluation of that candidate.

**G1 — Natural Recorded Authority.** §3's A0 conditions, from immutable
evidence.

**G2 — Semantic decidability.** Two fresh reviewers, blind to each other, read
the frozen record and each state what policy it defines: ruled-out behaviour,
reason, scope, lifecycle, violation boundary, compliance boundary. They are
**not** asked whether the decision appears anywhere else. Disagreement goes to a
third blind vote. Still ambiguous → `record-ambiguous`. No lexical-overlap floor
is used as an admission gate, in this or any other form.

**G3 — Hidden rationale.** Without the record, is the rejection already obvious
from the current code, a neutral task and the obvious tests? If yes, exclude.
The rationale is **not** required to be documented elsewhere.

**G4 — Functionally viable wrong path.** Both classes must be possible: a
compliant implementation that passes functionally and complies, and a revival
that passes functionally and violates. A revival that fails functional tests is
an ordinary bug and out of scope.

**G5 — Deterministic oracle feasibility.** Could a future final tree be judged
for revival without reading the arm, the delivery log, the agent transcript or
any record citation? Preference order: runtime behaviour probe, AST or
structured parse, public API or CLI behaviour, semantic structural predicate.
Keyword-only oracles are acceptable only where the policy is genuinely lexical.

**G6 — Shipping content delivery.** At the frozen release, before the first
mutation: ruling visible, reason visible, scope correct, lifecycle current, not
stale-as-current, and the injector demonstrably ran. `Record-Id` presence is
metadata and never gates.

**G7 — Bounded realistic task.** A plausible maintenance task inside a normal
tool and time budget. Benchmark-only toy edits are rejected.

**G8 — Leakage safety.** No task prompt carrying the ruling or reason, no
exposure of a known bad implementation, no equivalence to a prior CDEB task, no
public artifact that supplies the answer. **The record existing in Git is not
leakage — it is the treatment content.**

## 5. Exclusion codes

```text
post-cutoff                    benchmark-authored
backfilled-or-reconstructed    reason-not-explicit
scope-unresolvable             lifecycle-unresolvable
record-ambiguous               reason-obvious-from-code
wrong-path-not-functionally-viable
oracle-not-deterministic       shipping-content-not-observable
task-not-bounded               leakage-risk
prior-benchmark-task-equivalent
```

`missing-record-id` and `insufficient-provenance` are **not** codes here and must
not become codes.

## 6. Task-author firewall

A task author may see the base tree, a neutral maintenance need, functional
acceptance criteria and the allowed scope. A task author may **not** see the
record, the ruled-out behaviour, the reason, the decision anchor, the gold, a
known bad patch, or any reviewer interpretation. This firewall is the core of
v5's anti-circularity and is checked executably where practical.

## 7. GO / HOLD

Registered before the census runs, taken unchanged from the owner's decision:

```text
eligible repository   final A0-qualified >= 8

GO requires all of:
  eligible repositories        >= 3
  total final A0-qualified     >= 36
  delivery observability demonstrated for identified and id-less decisions
    where each is present
  no unresolved integrity blocker
Otherwise HOLD.
```

After Stage 0: 4 pass → four-repository set; 3 pass → three-repository set;
≤2 pass → HOLD. Repository selection completes before any treatment outcome
exists, and selecting repositories after seeing an ON/OFF result is forbidden.

**36 is a feasibility floor, not a sample size.** It reserves at least 12
candidates for a pilot and leaves at least 24 distinct candidates for a possible
confirmatory study. The final N comes from a separately frozen power analysis
after the pilot.

Thresholds do not move after counts appear. On HOLD: no threshold relaxation, no
synthetic records, no post-hoc repository cherry-picking, no owner testimony.

## 8. Disclosure — what was already visible

v4's counts are public and known to this document's author: 241 decisions
(gitseed 104, agent-operator-score 59, logic-pro-mcp 43, agent-control-plane 35),
143 identified and 98 id-less, 154 of 207 delivered. Those are pre-gate counts
and v4 qualification outcomes under a discarded rule; none is imported, and no
threshold here is calibrated against them. The disclosure exists so a reader can
judge the thresholds knowing what their author knew.

## 9. Forbidden in Stage 0

```text
pilot runs        ON/OFF agent runs      randomization
outcome rows      effect sizes           significance tests
README metrics    product claims         owner testimony
importing any v4 qualification row, reviewer verdict or correspondence score
```

## 10. Termination

Stage 0 ends with a report and stops, GO or HOLD. A successor requires a new
confirmatory PRD, a new preregistration, a fixed repository set and separate
owner approval.

```text
CDEB-FRESH V5 STAGE 0 COMPLETE — PRODUCT-EFFECT MEASUREMENT NOT STARTED
```
