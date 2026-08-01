# ADR-0027 — Entropy review is a different product, and this one does not become it

Status: accepted · Closes [#342](https://github.com/MongLong0214/commitlore/issues/342)

## Context

A review of v0.5.0 scored CommitLore's direct effect on AI code entropy at 7.1
and asked, reasonably, whether the tool should detect the things an agent
actually does to a codebase: comments that restate the code, an abstraction used
once, a function's responsibility quietly widened, a compatibility branch added
to protect a caller that should have moved.

That list is accurate. Those are real failures, they are common in
agent-written code, and this repository does nothing about them.

The question is not whether they matter. It is whether they belong here, and
the honest answer has been neither promised nor refused — which is the state
that lets a claim drift in later, when somebody writes a launch post.

## The distinction that decides it

Those checks read a **diff**. Everything in this product reads a **record store**.

| | reads | decides |
|---|---|---|
| entropy review | the change in front of it | is this code well-shaped |
| CommitLore | the decisions this repository has recorded | does this decision still apply |

They share a motivation and no mechanism. A tool that judges whether an
abstraction is premature needs taste about code. A tool that says "this was
ruled out in March and the reason still holds" needs provenance, lifecycle and
a trust boundary. Building the first inside the second would give the combined
thing two data models, two failure modes, and one name.

This is the same argument [ADR-0013](ADR-0013-what-commitlore-is-not.md) made
about a dashboard, an embedding layer and an organisation graph: adjacent
problem, different product, and a market position entered late with less. A
linter and a review bot already occupy this ground.

## What the measurements say

ADR-0013 records that M1 (p = 0.7480), M1-b (p = 0.0522) and M2 (p = 0.2247)
found no significant effect from injecting more context into an agent. The value
this product has is not volume of context; it is **control** — which records may
be obeyed, which are stale, which revive something already rejected.

Entropy review is a bet on the other hypothesis. Making that bet inside a
product whose own data declines to support it would be building on a foundation
this repository has already measured and found absent.

## Decision

**Entropy review is out of scope for CommitLore.** Not deferred — out of scope.
No skill, no command, and no roadmap entry implies it.

The positioning stays where the README already has it, and it is worth stating
in the negative because the two are easy to conflate:

> CommitLore does not slow the rate at which an agent produces entropy. It stops
> that entropy being inherited by the next agent as settled design.

Those are different sentences. The first is a claim this repository cannot
support. The second is what the lifecycle, the path scope and the trust grading
actually do.

## Consequences

**A separate tool may be built.** Nothing here forbids `commitlore-entropy-review`
existing as its own repository with its own name, and a diff-reading skill would
compose with this one at the agent rather than in the codebase. That is a
different decision than the one recorded here.

**The scoring stands unchallenged.** A future review that scores direct entropy
suppression low is describing the product accurately, not finding a gap. The
answer is this ADR, not a feature.

**A claim to the contrary is a defect.** "Reduces AI code entropy", "improves
code quality" or "prevents over-engineering" in any README, skill description,
release note or launch post contradicts this decision. `docs/COMPATIBILITY.md`
and the README both currently decline to say it; that is the state to hold.

## Alternatives ruled out

**Ship it as an optional skill inside this repository.** Optional does not solve
it. The skill would carry the product's name, be installed by its plugin, and
inherit its claims — and its failures would be read as this tool's failures. The
separation that matters is the name, not the load order.

**Defer it to a later milestone.** A deferral is a promise with no date. This
question has been open in reviews twice; leaving it open a third time invites the
same conversation rather than settling it.

**Do nothing and let the README stay silent.** Silence is what produced the
question. An unclaimed capability is indistinguishable from an unbuilt one, and
somebody eventually resolves the ambiguity in the direction that sells better.
