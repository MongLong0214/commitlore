# ADR-0017: measure fresh-agent decision recovery before coding behaviour

- Status: Accepted (2026-07-29)
- Supersedes: ADR-0007's primary measurement framing, not its requirement to
  register measurements before collection
- Issue: [#140](https://github.com/MongLong0214/commitlore/issues/140)

## Context

M1, M2, and M4 measured whether an agent's eventual code re-proposed a rejected
approach. That outcome is downstream of record preservation, retrieval, model
reasoning, tool use, task difficulty, and implementation quality. CommitLore
controls preservation and retrieval; it does not control the rest.

The studies did not fail in one repeatable way that a larger rerun could fix.
M1 and M2 had an almost empty behavioural instrument. M4 then selected against
that floor and encountered three independent validity failures:

- [#109](https://github.com/MongLong0214/commitlore/issues/109): a one-sided
  qualification floor admitted saturated tasks; under the registered
  two-sided re-proposal band, 0 of the current 8 qualify;
- [#122](https://github.com/MongLong0214/commitlore/issues/122): M4 recorded
  assignment but no treatment exposure, so delivery was unverifiable; and
- [#121](https://github.com/MongLong0214/commitlore/issues/121): the prospective
  replacement outcome was a field that had always been zero.

Each repair moved another part of the coding-behaviour instrument while leaving
the product's controlled layer four steps upstream. A fourth coding study would
therefore be a new bet on the same framing, not a repair.

The prospective M5 record later rejected per-task comparator qualification.
Issue #109 supplied the evidence to revisit that rejection: a floor-only gate
selected a pool with no usable mid-band tasks. The replacement protocol uses a
fixed two-sided F1 band on disjoint comparator runs before any treatment exists.

## Decision

The primary product claim moves to:

> Does a fresh agent recover a code path's active decision context before its
> first edit?

The agent produces a structured decision brief. It is scored against gold for
active constraints, ruled-out alternatives with reasons, warnings, evidence
status, and superseded or expired decisions. Primary scoring is F1 with no
partial atom credit.

Gold is built first by two independent annotators from ordinary project
evidence—PR discussion, issue threads, commit bodies, and maintainer
explanations—and is frozen before the same information is encoded as
CommitLore records. CommitLore output can never define its own answer key.

Four arms separate the questions that the old on/off comparison mixed:

- code only: what the source makes inferable;
- ordinary Git prose: whether existing rationale is addressable;
- every record injected: whether unfiltered structured memory is enough; and
- CommitLore path-scoped and lifecycle-filtered: whether scope and lifecycle
  make the rationale recoverable.

Ordinary Git is the primary comparator. The protocol, scoring, qualification
band, exposure refusal, variance refusal, pilot size, and confirmatory gate are
registered in
[`docs/MEASUREMENT-PROTOCOL.md`](../MEASUREMENT-PROTOCOL.md).

## Consequences

**Gained.** The primary outcome now observes the retrieval layer directly.
Precision penalises invented reasons and stale decisions, while recall still
penalises missed context. Exposure and variance can be refused before a null is
misread as evidence about the product.

**Lost.** A positive result will not show that agents write better code, finish
faster, or save money. Those remain separate downstream claims. The existing
M1, M2, and M4 observations remain historical results and are not re-scored.

**Cost.** Credible gold requires two annotators and adjudication. The project
can afford an eight-episode pilot now; a 24-to-30-episode confirmatory study is
conditional on the registered feasibility gates.

**Risked.** A structured brief may reward agents that summarise well without
later applying the decision. That is deliberate: application is outside this
claim. If decision recovery does not vary or ordinary Git already reaches the
ceiling, the protocol stops rather than moving downstream again.

## Ruled out

- **Repair and rerun the coding-behaviour harness** | #109, #121, and #122 show
  independent failures, while coding remains downstream of the controlled
  layer.
- **Use CommitLore records as gold** | that would measure whether CommitLore can
  read its own encoding.
- **Use recall as primary** | listing every plausible rationale would improve
  the score; F1 charges false and stale claims to precision.
- **Compare only code-only with CommitLore** | that confounds rationale presence
  with addressability and avoids the ordinary-prose comparator that matters.
