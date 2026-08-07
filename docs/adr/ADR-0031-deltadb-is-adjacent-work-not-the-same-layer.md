# ADR-0031 — DeltaDB is adjacent work, not the same layer, and the difference is what happens after the commit

Status: Accepted (2026-08-07)

- Related: [ADR-0029](ADR-0029-lore-is-prior-art-and-this-is-what-differs.md)
  (the same discipline applied to Lore) · [ADR-0022](ADR-0022-positioning-decision-authority.md)
  (the positioning this constrains)

## Context

Zed announced [**DeltaDB**](https://zed.dev/blog/introducing-deltadb) on
2026-06-12, with a waitlist at <https://zed.dev/deltadb>. It is a version
control system built on CRDTs that records **every operation** rather than every
commit, and permanently ties each operation to the agent conversation that
produced it.

From its own material:

> Git was designed for humans trading snapshots asynchronously and was never
> built for a world where an AI agent rewrites a function in seconds, a teammate
> needs to understand why it was rewritten, and another agent needs that context
> to keep going.

And, on scope:

> The aim is not to replace Git or CI, but to make collaborative work **before
> code is committed** easier.

**The thesis is ours.** An agent should inherit the reasoning behind code and
not only the code. A survey that did not say so would be dishonest, and this
project has already published one competitor's priority over its own
(ADR-0029).

It is also backed by Zed and Sequoia. This project cannot out-distribute it and
should not pretend the question is open.

## What actually differs

| | DeltaDB | CommitLore |
|---|---|---|
| Layer | a new VCS substrate (CRDT) | a protocol on top of git (trailers) |
| Unit | every operation, plus the conversation, captured wholesale | a curated record in a fixed vocabulary |
| Window | **before** the commit | after it, and years later |
| Records | what happened | **what did not** — the alternative ruled out, and why |
| Lifecycle | append-only history | `Supersedes:` / `Expires:` — a decision stops being in force |
| Trust | not a stated axis | `directive` / `claim` / `blocked` (SPEC §7) |
| Adoption | adopt a system | readable with `git log` |

Three of those carry the weight.

**Budget, not volume.** DeltaDB records everything; an agent's context window is
small. The measured figure this project has is retrieval under a budget — 81.7%
delivery at 800 tokens against 42.0% for `git log`. A full delta stream plus its
conversation does not fit in that budget, so retrieving from it is a search
problem where a sixteen-key vocabulary is a lookup.

**A path not taken leaves no delta.** "Redis was ruled out because ops refuses
another stateful dependency" is a negative fact about something that never
happened. It is not recoverable from a stream of operations. It may be buried in
a conversation, which returns to the search problem.

**Expiry.** An append-only log cannot say *this constraint no longer holds*.
That is the scene `commitlore demo` exists to show.

## The part that is a shared boundary rather than a wall

Capture takes a transcript and machine-checks every quote against its bytes.
Today the host writes that transcript. DeltaDB is a durable, structured
transcript already bound to the edits it produced.

**A DeltaDB-backed capture source is a coherent thing to build**, and it would
make this project's weakest input its strongest. Recorded here so the
relationship is on file as adjacency rather than only as competition.

## Decision

1. **Name DeltaDB in the README's comparison, ourselves**, in the section that
   claims a difference — the same treatment ADR-0029 gave Lore. It is not cited
   as prior art for the protocol: it is a different layer, announced after this
   repository existed, and the claim it makes about git is about a different
   part of the workflow.
2. **State the scope boundary in their words**, because they drew it: "not to
   replace Git or CI … before code is committed." This project's window starts
   where theirs ends.
3. **Do not claim DeltaDB cannot answer these questions.** Nothing here has been
   measured against it, and there is no build to measure. The table above is
   read off published descriptions and this repository's own numbers.
4. **Sharpen the positioning to the three differences that carry weight** —
   budgeted retrieval, the path not taken, and expiry — rather than to
   "curated versus complete", which is a preference and not a finding.

## Consequences

- The README gains a comparison it would rather not need. That is the same cost
  ADR-0029 accepted, for the same reason: a reader who finds the competitor
  first, and finds no mention here, discounts everything else on the page.
- The category is now contested by a better-funded team, and the honest read is
  that attention will flow there. What this project has that money does not buy
  is a record of trying to falsify its own claims — a withdrawn matrix (M4), a
  measured 5.1% power admitted in public (M1), and a pre-registration carrying
  its own deviations. That is the asset the positioning should lead with.
- If DeltaDB ships a capture source, the item above becomes work rather than a
  note.
