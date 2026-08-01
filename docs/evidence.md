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

### What a record costs to write, and how many reads pay for it

Two of the four terms on the write side are measurable with no model call, and
both are now measured on this repository's own history at the same commit the
delivery run above used. The generated harvest prompt's scaffold is **1,197
tokens**; adding each commit's staged diff takes a median capture to **3,537**
and the mean to 10,064 — the mean is 3.8× the median because a handful of
commits staged this benchmark's own machine-generated output, which a harvest
prompt then re-renders in full. Over 343 captures that is a **write floor of 3,451,848
tokens**, or 410,571 counting the scaffold alone. Verification adds **0 model
tokens**, checked by scanning the 14 built modules reachable from the verify
entry points rather than asserted. Method and full tables:
[token ledger](../bench/TOKEN-LEDGER.md), measured in
[`token-ledger-20260801T122953Z.jsonl`](../bench/results/token-ledger-20260801T122953Z.jsonl).

Restating the delivery run per read — one read is one first edit to one path —
the shipped projection costs **488.9 tokens** against `git log`'s 643.5 at the
same budget and 88,122.0 for the repository-wide dump. So:

| Projection | Denominator | Reduction | Recall, projection / denominator |
|---|---|---:|---:|
| shipped, 800-token budget | `git log -- <path>`, same budget | **24.0%** | 81.7% / 42.0% |
| shipped, 800-token budget | `git log -- <path>`, unbounded | 62.2% | 81.7% / 94.4% |
| shipped, 800-token budget | whole-repository dump, unbounded | 99.4% | 81.7% / 92.3% |
| **budget removed** | whole-repository dump, unbounded | **99.2%** | **92.3% / 92.3%** |
| shipped, 800-token budget | reading no history at all | **undefined** | 81.7% / 0.0% |

The fourth row is the one to quote and the fifth is the one not to hide. The
fourth is the only pair here whose two sides recover the same amount — 2,047
gold pairs each, so the percentage is not paid for with recall. It is the same
projection on both sides with the budget removed, which makes 99.2% the
reduction attributable to path scoping alone, at 124.3× fewer tokens. Equal in
*count*: the delivery row records counts and not sets, so it is not a claim that
the same 2,047 records came back.

The fifth row has no percentage because its denominator is zero. Against an
agent that reads no history the projection is a token *cost* of 488.9 per read,
and what it buys is 81.7% of the active decision set against 0%.

**Break-even, with its assumptions on the face of it.** Against an agent that
runs `git log -- <path>` and truncates it to the same 800 tokens, the saving is
154.6 tokens per read, so this repository's records pay for themselves after **at
least 22,326 path-scoped reads** — 21.3 passes over all 1,046 evaluated paths —
or at least 2,656 if the staged diff is charged at nothing on the assumption it
is already cached. Against the whole-repository dump it is at least 39 reads.
Against reading no history, **no break-even exists at any read count**.

Every one of those is a floor, because the write side omits two non-negative
terms (below), so the true break-even is further away rather than nearer.

What the arithmetic settles does not depend on guessing how much editing a
repository sees. At the same budget the saving is **154.6 tokens per read** and
the recall difference is **39.7 points**. One of those is small and the other is
not, so on this corpus **the case for the product rests on recall, not on
tokens** — and the token-reduction percentage, which is the number this market
runs on, is the weaker half of the answer. That is what this measurement was run
to find out, and publishing it is the point of having run it.

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

### What the drafting turn costs

The write side of a record has four terms. Two are now measured (above); one is
zero by construction and checked; the fourth needs a model call and is **not**
measured. The blocker is precise: `bench/drivers/claude-headless.ts` runs
`claude --output-format json` and reads one `usage` object out of the final
result, which is a **session total with no per-turn breakdown**, and the harvest
pipeline never runs inside a bench run at all — `bench/runner.ts` seeds records
from task YAML, which is why every CPAA the harness has printed reads *not
instrumented*.

Closing it needs two things and neither is a wiring job: `--output-format
stream-json` (or an equivalent per-turn capture) in the driver, and a bench arm
that runs `capture` against each run's own transcript and diff, at one model
call per run. A third term, the session transcript the prompt numbers into
itself, is not merely unmeasured for the existing records — those sessions were
never retained, so it is unrecoverable at any price and only a forward-looking
instrument could see it.

Until then no figure is published for what a model spends drafting a record, and
nothing here is estimated in its place.

This section used to say that break-even itself was unmeasured. One break-even
is now published, above, and one still is not, and the difference is the
denominator. The published one divides a measured write floor by a measured
difference in delivered tokens between two routes. The unpublished one divides a
measured cost by *the value of a prevented re-proposal* — a quantity this
project has never observed, which is why the earlier figure carrying it was
withdrawn rather than annotated. Section 12 of the deterministic report still
states that threshold with its denominator deliberately unsupplied.

### How reliable the guard is as a signal

Guard (ruled-out alternative matching) is an experimental advisory: precision
44.8% (95% Wilson CI 32.7%–57.5%), recall 22.0% on the 417-decision corpus
([ADR-0020](adr/ADR-0020-guard-is-an-experimental-advisory.md)). An empty guard
result does not guarantee a proposal avoids all ruled-out alternatives — at 22%
recall, a miss is the common case. This disclosure also stays in the README's
Known-limitations section, where a test asserts it is still there.
