# Evidence

What this project has measured, what it has not, and where each figure comes
from. Every number here is regenerated from a log in
[`bench/`](../bench/README.md); the measurement rules are in
[MEASUREMENT-PROTOCOL.md](MEASUREMENT-PROTOCOL.md).

The README states the product claim; this page states what backs it. The
benchmark summary block itself stays in the README, in all four languages,
because CI regenerates it there from `bench/report.ts` and fails if a single
byte differs (`scripts/check-readme-numbers.mjs`).

## Measured

### Exposure and recall under path scope

In the [retrieval measurement](../bench/retrieval/result.md), at every size from
0 to 10,000 distractors, BM25, embedding top-k, hybrid RRF, and embedding with a
path filter each returned one superseded record. CommitLore path scope with
lifecycle returned zero stale records and both current records (2/2).

Recall is the supporting result: retrieval finds broadly the same records either
way, but only one route knows which are still current. On #166's corpus with no
superseded records, embedding retrieval matched path scope at 2/2. The advantage
appears when decisions have been reversed — the case this product exists for.

The separate #167 exposure run: only 2 of 10,002 records reached the model.

| route | model-visible records | relevant records | model-visible tokens |
|---|---:|---:|---:|
| inject everything | 10,002 | 2/2 | 1,004,554 |
| top-k lexical | 2 | 1/2 | 190 |
| CommitLore path scope | 2 | 2/2 | 335 |

This measures exposure and recall at a fixed two-record output budget — not
token cost, billed cost, accuracy, or agent behaviour. It is one corpus, one
query, and one pinned embedding model.

### How much of the active decision set reaches a fresh agent

On this repository's own history — 345 records, 338 active, 7 superseded, 0
expired — the shipped path-scoped projection delivers **81.7%** of the 2,217
active (path, record) pairs held for files an agent could edit, and **0 retired
records** among the 1,947 it hands over. Ordinary `git log` for the same path,
cut to the same 800-token budget, delivers **42.0%** and 7 retired records while
spending more tokens. Method and full tables: [active-record
delivery](../bench/DECISION-DELIVERY.md), measured in
[`decision-delivery-20260801T060225Z.jsonl`](../bench/results/decision-delivery-20260801T060225Z.jsonl).

Budget and scope are measured on separate axes, which is what the paired
budgeted and unbudgeted arms are for. Removing the token cap takes the
projection to 92.3%, so **the cap costs 10.6 points**; the repository-wide dump
with the same cap removed recovers the same 2,047 pairs, so **path scoping costs
nothing**. The remaining 170 pairs are records the trust grader withholds, which
puts the ceiling for any injection route on this corpus at 92.3%.

This measures delivery, not recovery: no agent was run, and a delivered record
is no evidence that one read it. It is one corpus, one repository, and one query
strategy per route. The corpus holds no expired records, so a zero
retired-delivery figure is evidence about the supersede filter on seven records
and none at all about expiry. It is **not** the fresh-agent study registered in
[MEASUREMENT-PROTOCOL.md](MEASUREMENT-PROTOCOL.md), which remains unrun.

### Latency and scaling

At 100,000 commits, indexed `context` p50 is 496 ms; CommitLore's own
`--no-index` fallback is 86,673 ms. That internal fallback gap grows 4.8× at 1k,
36× at 10k, and 175× at 100k ([complete deterministic
run](https://github.com/MongLong0214/commitlore/blob/2fade893f25917fce1ffb497aab96b1eb271a185/bench/results/deterministic-20260729T032652Z.md));
it is a scaling shape, not a product-versus-alternative result.

The guard costs injected context plus measured hook overhead: 185.85 ms p50 for
commit-msg and 102.40 ms p50 for the injection hook ([deterministic
measurements](../bench/results/deterministic-20260727T174801Z.md)).

### Adoption cost, on a real repository

From a field report on a ~768-commit Swift MCP server, one day after installing.
The engineer had already run a full census of the codebase before installing
CommitLore, and was working through the files that census had flagged.

```
$ commitlore context Sources/LogicProMCP/Accessibility/LibraryAccessor.swift
context for … — 0 limits, 0 ruled-out, 0 warnings, 2 other in 2 records

other
  -  01ff2705  [claim]  ax: eliminate clear-win coordinate actuations (8 sites)
                        with live-verified AX paths
```

> **I did not know that commit existed.** It is a merged PR from two weeks
> earlier that had already removed eight of these sites and replaced each with
> an accessibility-native equivalent, every one fail-closed and live-verified.
>
> It relocated my census. I had been treating the surviving sites as *the*
> problem. They are the **residual** after a shipped removal campaign — the ones
> that survived a deliberate attempt to remove them. That is a different
> engineering problem and a different risk assessment.
>
> None of this was in any chat history. It was in the repository, and I got it
> by naming a file path.

The alternative was reading two weeks of merged pull requests to find it. That
is not something an agent does spontaneously, and not something a person does
before every edit.

Adoption cost, from the same report: one command, and 7.4 seconds to index 768
commits. Nothing touched history or the working tree.

### Behaviour the repository can demonstrate

Decision history surviving rebase, squash, remote transfer and path renames;
uniform trust grading on every route; injection-like text withheld from
model-readable routes; an empty repository distinguished from an unfetched notes
mirror. These are asserted by the test suite and listed under *What the
repository proves* in the [README](../README.md).

## Not yet measured

### Whether the guard changes what an agent proposes

112 experiments were recorded, but M4 recorded no per-run guard exposure.
Whether the treatment was present is unverifiable, so it does not test, support,
or refute the agent-behavior claim. Read the [M4
verdict](../bench/VERDICT-M4.md) for the clean dataset and the withdrawal; the
full run table is the generated block in the README.

The matrix is only powered to detect a large effect, so a non-significant result
from it is a statement about the sample size rather than about CommitLore. The
power table is in [`bench/README.md`](../bench/README.md).

### Break-even

A break-even figure would require a per-turn ledger of provider-reported token
usage and an observed cost for work spent on an alternative the repository had
already rejected. Neither has been collected, so no such figure is published.

### How reliable the guard is as a signal

Guard (ruled-out alternative matching) is an experimental advisory: precision
44.8% (95% Wilson CI 32.7%–57.5%), recall 22.0% on the 417-decision corpus
([ADR-0020](adr/ADR-0020-guard-is-an-experimental-advisory.md)). An empty guard
result does not guarantee a proposal avoids all ruled-out alternatives — at 22%
recall, a miss is the common case. This disclosure also stays in the README's
Known-limitations section, where a test asserts it is still there.
