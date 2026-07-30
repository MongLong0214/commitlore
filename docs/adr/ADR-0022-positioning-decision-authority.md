# ADR-0022 — Positioning: decision authority for coding agents

- Status: Accepted (2026-07-30)
- Related: ADR-0013 (what CommitLore is not), ADR-0019 (guard signal insufficiency)

## Context

The project's public positioning has been "Git-native decision memory for
AI-assisted codebases" since v0.1.0. This framing emphasises *storage* —
CommitLore remembers decisions. It does not communicate what distinguishes
that storage from any document an agent can read.

The retrieval measurement (`bench/retrieval/result.md`, summarised in
`README.md:29-46`) found one concrete advantage: **lifecycle correctness**.

On #166's corpus with no superseded records, an embedding retriever matched
path scope at 2/2. The advantage is invisible when every decision in the
repository is still current. It appears only when decisions have been
reversed — the case this product exists for:

- At every size from 0 to 10,000 distractors, BM25, embedding top-k, hybrid
  RRF, and embedding with a path filter each returned **one superseded
  record**. CommitLore path scope with lifecycle returned **zero stale
  records** and both current records (2/2).

Recall is not the measured advantage. Retrieval finds broadly the same
records either way, but only one route knows which are still current.

The positioning that follows from this evidence is: **an agent must not
revive a decision the repository already reversed.** CommitLore is the
authority on which decisions are still in force — the decision authority.

## Decision

The public positioning moves from "Git-native decision memory for AI-assisted
codebases" to a framing centred on **decision authority**: what this product
delivers is the correct answer to "is this decision still active, or was it
reversed?" — and the consequence that an agent must not revive a reversed
decision.

### Claim boundary

"Authority" is a positioning word about what the product delivers. It is not a
measured outcome, and it must not be presented as one.

The following effect claims remain **forbidden** (per ADR-0013 and by the
absence of a completed recovery study, `docs/MEASUREMENT-PROTOCOL.md §9`):

- "prevents mistakes"
- "saves cost"
- "writes better code"
- "reduces re-proposals" (without a measured confidence interval)
- Any causal claim connecting CommitLore's presence to a change in agent
  behaviour quality

The positioning may say what the product *does* (tracks lifecycle, exposes
only current decisions, filters out reversed ones). It may not say what
*effect* that has on the agent's work quality without completing the
registered recovery pilot.

### Consistency across languages

All four language READMEs (`README.md`, `README.ko.md`, `README.ja.md`,
`README.zh-CN.md`) carry the new positioning or none do. A partial rollout
— English updated while translations lag — is not a valid intermediate state.
The change ships as a single coordinated ticket across all four files.

## Consequences

**Gained.** The product's first sentence communicates a concrete property a
visitor can evaluate: "does my coding agent know which decisions I reversed?"
This is testable and distinguishes CommitLore from general-purpose document
storage, knowledge-base tools, and wiki systems.

**Lost.** "Decision memory" is a gentler framing that does not require
explaining lifecycle or reversal up front. The new framing demands a concrete
scene before a visitor will credit it — hence the dependency on a demo
(`commitlore demo`, P0-5) or an equivalent README scene.

**Risked.** "Authority" may read as an effect claim to a visitor who does not
read the rest of the README. The README hero and surrounding text must make
clear that authority describes what CommitLore *delivers to the agent* (the
lifecycle-correct set), not what the agent *does with it* (which is
unmeasured). If this distinction proves too subtle for visitors to parse, the
falsification condition below applies.

## Ruled out

**Keeping "decision memory".** It is accurate but does not differentiate.
Any tool that stores text in a repository is a decision memory. The
distinguishing property is lifecycle correctness — knowing which decisions
are still active — and the positioning should name it.

**Leading with recall.** Recall is not the measured advantage. On a corpus
with no superseded records, embedding retrieval matched path scope at 2/2.
The advantage appears only with reversed decisions. Leading with recall
would claim an advantage the measurement does not support.

**Leading with guard.** Guard precision is 44.8% (95% Wilson 32.7%–57.5%)
and recall is 22.0% (ADR-0019). Leading with it as the authority mechanism
invites the obvious question "how often is it right?" and the honest answer
is "less than half the time it fires." The authority comes from lifecycle
data, not from the guard's signal processing.

**Using "authority" as a measured outcome.** It is a positioning word. The
measured property is: path scope with lifecycle returns zero stale records.
That is what the word stands for, and it is what the README must demonstrate.

## Falsification

This ADR's positioning decision is falsified — and the product should revert
to a neutral framing — if any of these conditions hold:

1. **The lifecycle advantage disappears.** A corpus is constructed where
   CommitLore path scope with lifecycle returns a superseded record that
   embedding retrieval does not, or where both routes return identical stale
   counts on a corpus with reversed decisions. This would eliminate the
   evidence that lifecycle filtering is the differentiator.

2. **The positioning cannot be distinguished from an effect claim.** A
   structured user test (≥5 participants unfamiliar with the project) finds
   that a majority (≥4/5) interpret the hero text as claiming CommitLore
   improves agent code quality — a claim ADR-0013 forbids and no study
   supports. If the framing cannot communicate "what it delivers" without
   being read as "what effect it has", it is too close to a forbidden claim.

3. **The consistency constraint becomes a blocking cost.** If maintaining
   four-language parity for positioning changes blocks release by more than
   one sprint (14 calendar days) on two separate occasions, the constraint
   should be relaxed to "English is canonical; translations are best-effort
   within one release."
