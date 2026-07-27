# ADR-0013 — What CommitLore is not: closing the dashboard, the embedding layer, and the org graph

Status: accepted · Closes [#29](https://github.com/MongLong0214/commitlore/issues/29), [#30](https://github.com/MongLong0214/commitlore/issues/30), [#31](https://github.com/MongLong0214/commitlore/issues/31)

## Context

Three backlog issues describe a static CI dashboard (#30), an embedding search
layer (#31), and a cross-repository organisation decision graph (#29). All three
predate two things we now know.

**A competitor occupies that ground and is further along.** CodeAlmanac (659
stars, Apache-2.0, `uv tool install`) is a repo-local markdown wiki maintained by
coding agents, with full-text search, a topic graph, backlinks and a local web
viewer. Verified directly: it binds nothing to commits or git notes, and it has
no trust grading, no record lifecycle, no supersession, and no guard against a
previously-rejected approach. Its overlap with CommitLore is in the *problem
statement* — "give an agent what the code cannot say" — and almost nowhere in the
data model.

That overlap is exactly where these three issues sit. A dashboard, a semantic
index and a knowledge graph are the wiki's competition, entered late, with less.

**Our own benchmark does not support the premise.** Three registered measurements
— M1 (p = 0.7480), M1-b (p = 0.0522), M2 (p = 0.2247) — found no significant
effect from injecting records into an agent's context. M2 additionally found the
*shipped* delivery path performing worse than the session-start dump it replaced.
"More recorded context, better behaviour" is the hypothesis these three issues
are built on, and it is the hypothesis our own data declines to support.

If added context is not measurably the value, then the value has to be in
*control* — which records may be obeyed, which are stale, which revive something
already rejected, and what happens when the tool cannot answer. That is the layer
CodeAlmanac does not have, and it is the layer where every defect found in the
last production review lives.

## Decision

**#30, #31 and #29 are out of scope.** Not deferred: out of scope. They are
closed, and the roadmap no longer implies them.

CommitLore's surface is the four axes nothing else in this space has:

- commit-bound provenance
- a machine-readable decision lifecycle
- trust-graded delivery to an agent
- a guard against reviving what was ruled out

## Consequences

**Gained.** The backlog drops from eight speculative features to a scope that
matches the four defensible axes. Every remaining issue can be argued for from
the benchmark or from a reproduced defect.

**Lost.** A user who wants browsable, searchable prose about their codebase is
better served by CodeAlmanac, and we should say so rather than build a worse
version. There is a real composition here — a wiki that reads CommitLore records
to write its pages — and it is a better outcome than competing.

**Risked.** Narrowing while the differentiating layers are still defective is a
bet on finishing them. If trust, guard and fail-closed availability are not
closed, this decision leaves a tool that is *both* narrower than the competitor
and not yet correct. The production review's blocker list is therefore the
roadmap, not a distraction from it.

## Ruled out

**Keeping them open as "someday".** An open issue is a claim about intent. Eight
of them, seven labelled post-v0.1 with one-line bodies, describe a product nobody
has decided to build — and they read to a visitor as a plan.

**Building the dashboard only.** It is the cheapest of the three and the most
tempting. It is also pure overlap: a static HTML view of decision debt is a wiki
page, and it would be the first thing compared against a tool that already has a
viewer.

**Rewriting them as CommitLore-native features.** #31 in particular could be
re-scoped to "semantic matching inside guard". That may be worth doing later, but
it would be a new issue with a new argument, not a rescue of this one —
`GUARD-CANNOT-BLOCK.md` measured that guard's precision problem is not a recall
problem, and a better matcher does not address it.
