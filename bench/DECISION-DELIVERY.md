# Active-record delivery before the first edit

- Status: **registered 2026-08-01, before any run of this measurement**
- Issue: [#343](https://github.com/MongLong0214/commitlore/issues/343)
- Provenance rules: [ADR-0018](../docs/adr/ADR-0018-benchmark-provenance-after-rewrites.md)
- Metric name in the result rows: `decision_delivery`

This document fixes the metric, the corpus rule, the answer key, the arms and
the scoring **before** the harness produced a number. The result section at the
bottom was empty when the rest of this file was written, and every figure it
carries names the generated file it was read from.

---

## 1. What this measures, and what it is not

The question, from issue #343:

> Given a repository with recorded decisions, how much of the currently-active
> decision set does a fresh agent recover before its first edit?

The issue makes the answer key explicit: *the repository holds the records, so
recall against them is countable, and a record that was superseded and still
surfaced is countable as an error.*

That fixes the observation point. What a fresh agent can recover before its
first edit is bounded above by what it is handed, and what it is handed is
deterministic — no model runs, no annotators, no seeds. **This measurement is
that upper bound: the share of the repository's currently-active record set that
each information route actually delivers to an agent about to edit a path, and
the share of what it delivers that the repository has already retired.**

It is not the study registered in
[`docs/MEASUREMENT-PROTOCOL.md`](../docs/MEASUREMENT-PROTOCOL.md) under
[ADR-0017](../docs/adr/ADR-0017-decision-recovery-measurement.md), and it does
not consume, satisfy, or partially discharge that registration. Three
differences decide it:

| | This measurement | The registered study (ADR-0017) |
|---|---|---|
| Answer key | the repository's own records | decision atoms annotated independently from ordinary project evidence, frozen before any record is written |
| Observation | bytes delivered to the agent | a structured decision brief the agent writes |
| What a number means | a **ceiling** on recovery | recovery itself |

ADR-0017 rules out CommitLore records as gold *for that study*, because a brief
scored against them would measure whether CommitLore can read its own encoding.
That objection is precise and it stands. It does not apply to a ceiling: asking
how much of the record set reaches the agent is a question about delivery, and
the record set is the only correct denominator for it. The registered pilot
remains unrun, and no number here should be read as evidence about it.

A route that delivers a record has not shown that any agent used the record. A
route that fails to deliver one has shown that no agent could.

---

## 2. Corpus

This repository, at the commit recorded in `harness_commit` on every result row.

The result row carries the census, so a reader never has to re-derive it: total
commits walked, distinct records, and the active / superseded / expired split at
the evaluation instant. The corpus is the whole first-parent-inclusive history
of `HEAD`; nothing is sampled and nothing is held out.

**Evaluation instant.** `HEAD`'s committer instant, which is also what
`buildInjection` resolves by default when no `at` is passed. The wall clock is
never read, so a rerun at the same commit folds the same lifecycle.

---

## 3. The answer key

Gold is built from Git plumbing alone, by `bench/deterministic/census.ts`. That
module imports nothing from `src/` or `dist/` and a test pins the ban: the
lifecycle fold in it is a second implementation of SPEC §5, not a call into the
one under measurement. Where the two disagree, the disagreement is a finding and
is reported, not reconciled.

**Records.** `git log --format=…%B HEAD` supplies every commit message. Each
trailer paragraph is parsed by Git's own `git interpret-trailers --parse` — the
same call `bench/deterministic/density.ts` already makes. A paragraph carrying a
`Record-Id:` trailer is a record block; its record id is that trailer's value.
One commit may carry several (ADR-0014). A record id declared by more than one
commit is one record; its trailers resolve across every commit that declared it,
and its paths are the union.

**Lifecycle (SPEC §5), folded at the evaluation instant.**

| State | Rule |
|---|---|
| superseded | some commit in `HEAD`'s history carries `Supersedes: <id>` naming it |
| expired | the record's `Expires:` value matches `YYYY-MM-DD` and that date is strictly before the evaluation instant |
| active | neither of the above |

A free-text `Expires:` is a condition, not a date; SPEC §5 flags it for review
and leaves the record active, and so does this fold. Every commit in `HEAD`'s
history is at or before `HEAD`'s own instant, so every declared supersession is
in force at the evaluation instant; no supersession in this corpus can be
pending.

**Attachment to a path.** A record is attached to path `P` when `P`, or any
earlier name of `P` in `P`'s rename chain, is among the paths changed by a
commit that declares the record. The paths of a commit come from
`git show --name-only --format=`; the rename chain of `P` comes from
`git log --follow --name-only -- P`. Merge commits show no changed paths, so a
record on a merge attaches to nothing; this repository merges `--no-ff` and
merge commits carry no record by design, and the count of records found on merge
commits is reported so that assumption is checked rather than assumed.

---

## 4. Evaluation paths

A path is evaluated when all three hold:

1. it is tracked at `HEAD` — a fresh agent cannot make a first edit to a file
   that is not there;
2. the repository's own `.gitattributes` does not declare it generated
   (`git check-attr linguist-generated`), which is how `dist/**` leaves the set;
   the rule is the repository's declaration, not a list chosen for this
   measurement; and
3. at least one **gold-active** record is attached to it.

Condition 3 is the denominator's own definition: a path with no active record
has recall `0/0`, which is not a score. The count of tracked, non-generated
paths excluded by it is reported.

Because condition 2 is a judgement the repository already published, the run
also reports the same totals over **every** tracked path, generated included, as
a sensitivity check. If the two disagree in direction, the exclusion is doing
work and a reader can see it.

---

## 5. Routes

Each route is what a fresh agent has in front of it before its first edit to
`P`. Everything else — the repository, the instant, the answer key — is held
fixed.

| Route | Delivery |
|---|---|
| `code-only` | the working tree. Nothing is delivered. |
| `git-log-path` | `git log --format=%B -- P`, the ordinary Git history of the file |
| `every-record-budgeted` | `buildInjection` with `noScope` and `noLifecycle`: every record in the repository, unfiltered, at the shipped 800-token budget |
| `every-record-unbudgeted` | the same projection with a budget large enough that nothing is cut |
| `commitlore` | `buildInjection({ path: P })` — the shipped `PreToolUse` projection, path-scoped and lifecycle-filtered |

`code-only` scores zero by construction. It is measured anyway rather than
asserted, because a floor that is stated instead of run is one more number
nobody checked.

The two `every-record` routes are one arm split by budget. ADR-0017 asks whether
unfiltered structured memory is enough; the honest answer depends on whether the
tokens are paid, so both are reported and neither stands alone.

`git-log-path` is the primary comparator, the same role ADR-0017 gives ordinary
Git. It is deliberately the plain command: `--follow` is available to anyone who
knows to reach for it, and the count of gold attachments that exist only through
a rename is reported separately so that the part of any gap owed to renames is
visible rather than absorbed into the headline.

---

## 6. Scoring

**Delivered.** The set of record ids that appear *as a declared record* in the
text the route hands over. For the injection routes that is the record-id column
of each rendered entry line; for the git routes it is the value of every
`Record-Id:` trailer in the printed log. A record id mentioned inside a
`Supersedes:` value or inside prose is not delivered — being named is not being
handed over.

**No partial credit.** A record id either appears or it does not. Nothing is
scored for a paraphrase, a near-miss, or a related record.

Write `n(S)` for the size of set `S`, and sum over the evaluation paths `P`
(micro-averaging). For each route:

| Quantity | Definition |
|---|---|
| `recovered` | `Σ n(delivered(P) ∩ active(P))` |
| `path_active_total` | `Σ n(active(P))` |
| **`path_recall`** | `recovered / path_active_total` — **primary** |
| `macro_path_recall` | mean over `P` of `n(delivered(P) ∩ active(P)) / n(active(P))` |
| `repo_recall` | `Σ n(delivered(P) ∩ active(repo)) / (paths × n(active(repo)))` |
| `precision` | `recovered / Σ n(delivered(P))` |
| `stale_delivered` | `Σ n(delivered(P) ∩ (superseded ∪ expired))` — **the error count** |
| `stale_share` | `stale_delivered / Σ n(delivered(P))` |
| `off_path_delivered` | `Σ n(delivered(P) ∩ active(repo) minus active(P))` |
| `delivered_tokens` | `Σ ⌈len(text) / 4⌉`, the `CHARS_PER_TOKEN` constant the product already uses |
| `paths_complete` | paths whose recall is exactly 1 |
| `paths_zero` | paths whose recall is exactly 0 |

**The denominator, decided here and not after seeing the numbers.** The primary
denominator is the **path-scoped active set**: the records the repository holds
about the file the agent is about to edit. The question is what an agent has
before *this* edit, and a repository-wide denominator would make every route's
score a function of how large the repository has grown rather than of what bears
on the change. `repo_recall` is reported beside it anyway, so the choice is
auditable rather than hidden, and so that the cost of the repository-wide dump
is legible in the same table.

**The error term.** A delivered record that gold marks superseded or expired is
an error, counted once, whichever of the two it is. Both classes are reported
separately, because a corpus can exercise one and not the other, and a zero that
comes from an empty class is not evidence about a filter.

---

## 7. What this cannot show

- **One corpus, one repository.** Every figure describes this repository's
  record set and its record-writing habits. It is not an estimate for any other
  repository, and the corpus is the one whose maintainer also wrote the tool.
- **Delivery, not use.** A ceiling. No number here says an agent read, believed,
  or acted on a delivered record.
- **One query strategy per route.** `git-log-path` is one command; a different
  ordinary-Git strategy would score differently. The routes are not an
  exhaustive search over what an agent might try.
- **The answer key is the record set.** A decision the project made and never
  recorded is invisible to every route here and is not in any denominator. This
  measurement cannot see under-recording; `rationale_density` in the
  deterministic suite is the figure that speaks to it.
- **The path-scoped denominator is a modelling choice**, stated in §6 and
  reported beside its alternative rather than defended as the only one.
- **Attribution is by commit, not by intent.** A record attaches to every path
  its commit changed. A commit that touched twelve files attaches its record to
  twelve paths whether or not the decision was about all twelve.
- **The attachment predicate is the natural one, and the shipped route uses it
  too.** Gold attaches a record to the paths its commit changed and follows
  renames, which is how anyone would answer *which records does this repository
  hold about this file* — and also how `buildInjection` decides what to project.
  A high `commitlore` recall is therefore partly definitional. What the figure
  can still falsify is everything layered above that predicate: the token
  budget, a record withheld by trust grading, and the index's own path
  resolution. A value below 1 names one of those; a value at 1 says only that
  none of them lost anything, not that the predicate is right.

---

## 8. Where the numbers come from

The harness is `bench/deterministic/recovery.ts`, run through
`bench/deterministic.ts` with `COMMITLORE_DETERMINISTIC_RECOVERY_ONLY=1`. It
writes one JSONL row per (population, route) pair and a generated markdown
report beside it under `bench/results/decision-delivery-*`, both carrying the
`harness_commit` and `harness_digest` ADR-0018 requires, plus the `dist_digest`
of the product bytes that produced the projections. The same measurement runs as
section 9 of a full deterministic suite; `decision_delivery` is one of that
suite's required metrics, so a complete run cannot omit it.

---

## 9. Result

_Empty until the run lands._
