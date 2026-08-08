# ADR-0029 — Lore is prior art for the protocol, and the difference is lifecycle, grading, and having measured it

Status: Accepted (2026-08-02)

- Related: [ADR-0022](ADR-0022-positioning-decision-authority.md) (the positioning
  this constrains), [ADR-0020](ADR-0020-guard-is-an-experimental-advisory.md)
  (what this project is willing to claim)

## Context

A competitive survey run for positioning found
[**Lore: Repurposing Git Commit Messages as a Structured Knowledge Protocol for AI
Coding Agents**](https://arxiv.org/abs/2603.15566) (Ivan Stetsenko, arXiv
2603.15566, published 2026-03-16), with an implementation at
[tmdgusya/lora](https://github.com/tmdgusya/lora).

Its abstract describes this product. Verified from the paper's own text: a
lightweight protocol that restructures commit messages using native git trailers
into self-contained decision records carrying constraints, rejected alternatives,
agent directives and verification metadata; no infrastructure beyond git;
queryable through a standalone CLI; discoverable by any agent that can run a
shell command.

This repository was created 2026-07-26. **Lore is four months earlier.**

The trailer vocabularies were compared directly against `README.md` in that
repository:

| Lore | CommitLore |
|---|---|
| `Constraint:` | `Limit:` |
| `Rejected:` | `Ruled-out:` |
| `Directive:` | `Warn:` |
| `Confidence:` | `Certainty:` |
| `Reversibility:` | `Undo:` |
| `Scope-risk:` | `Blast:` |
| `Tested:` / `Not-tested:` | `Verified:` / `Unverified:` |

Near one-to-one. Both worked examples are an auth-token-expiry commit.

## Decision

**Cite Lore as prior art in the README, in the section that claims a difference,
and say what the difference actually is.**

Two things are true and both are stated:

1. **The protocol idea is not novel to this project.** Someone published it first,
   in a paper, with a mapping this close. A reader who finds that themselves after
   reading a differentiator table that does not mention it has learned something
   about this project's honesty, not about Lore.

2. **Two mechanisms in CommitLore have no counterpart in Lore**, checked against
   its README rather than assumed: there is no `Supersedes:`, no `Expires:`, and
   no lifecycle concept of any kind — `grep -niE "supersede|expire|lifecycle|
   retire|reversed"` over that file returns only matches inside its worked example
   about expired auth *tokens*. There is no trust grading. And the paper is
   explicit that it "outlines an empirical validation path" — it runs no
   experiment.

The defensible claim is therefore not "we invented this." It is: **this is the
implementation of that protocol that added lifecycle and trust grading, and that
ran the validation the paper only outlined — including where the validation
failed.**

`bench/VERDICT-M1.md` (p = 0.7480 at 5.1% power), `bench/VERDICT-M4.md`
(withdrawn for unverifiable treatment exposure), `bench/ROUTE-GAP.md` (injected
context read and ignored) and `docs/adr/ADR-0020` (guard at 44.8% precision,
22.0% recall) are the part of that claim nobody else in this niche has published
anything comparable to.

## Consequences

- The README's differentiator section names Lore and links the paper. It gains a
  row, not a rebuttal.
- Any future claim of originality is scoped to lifecycle, grading and evidence,
  never to the protocol.
- If Lore adds a lifecycle, the second half of this decision expires and the
  differentiator has to be re-earned or dropped. That is the trigger to revisit.

## Alternatives ruled out

- **Say nothing.** The survey found it in an afternoon; anyone evaluating this
  project will. Being second is a fact about a date. Being second and quiet about
  it is a fact about the project.
- **Frame it as convergent design.** It may well be — the trailer idea is
  available to anyone who has read `git interpret-trailers` — but "we arrived
  independently" is unfalsifiable and asks a reader for trust this project has
  spent two releases arguing should not be extended to unverifiable claims.
- **Compare feature-by-feature in the README.** Lore is a design paper with a
  small implementation; a table scoring it against a shipped tool would be
  unfair and would read as defensive. One row and a link is the honest weight.

## Falsification

This decision is wrong if the vocabulary mapping above is coincidental rather
than near-identical, or if Lore does carry a lifecycle that the comparison missed.
Both are checkable against
[tmdgusya/lora](https://github.com/tmdgusya/lora) and
[arXiv 2603.15566](https://arxiv.org/abs/2603.15566) by anyone who wants to.
