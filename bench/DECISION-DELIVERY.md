# Active-record delivery before the first edit

- Status: **registered 2026-08-01, before any run of this measurement**;
  amended the same day by the arm deviation recorded in §5, before the run that
  reports it
- Issue: [#343](https://github.com/MongLong0214/commitlore/issues/343)
- Provenance rules: [ADR-0018](../docs/adr/ADR-0018-benchmark-provenance-after-rewrites.md)
- Metric name in the result rows: `decision_delivery`

This document fixes the metric, the corpus rule, the answer key, the arms and
the scoring **before** the harness produced a number. The result section at the
bottom was empty when the rest of this file was written, and every figure it
carries names the generated file it was read from. An arm added later is
recorded as a deviation with its date and its reason, in the section it changes,
rather than folded into the original text.

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

| Route | Budget | Delivery |
|---|---|---|
| `code-only` | — | the working tree. Nothing is delivered. |
| `git-log-path-budgeted` | 800 | `git log --format=%B -- P`, cut to the shipped budget |
| `git-log-path` | none | `git log --format=%B -- P`, the file's ordinary Git history, entire |
| `every-record-budgeted` | 800 | `buildInjection` with `noScope` and `noLifecycle`: every record in the repository, unfiltered |
| `every-record-unbudgeted` | none | the same projection, with a budget large enough that nothing is cut |
| `commitlore` | 800 | `buildInjection({ path: P })` — the shipped `PreToolUse` projection, path-scoped and lifecycle-filtered |
| `commitlore-unbudgeted` | none | the same projection, with a budget large enough that nothing is cut |

**Every delivering family appears twice, once at the shipped 800-token budget
and once with none.** A route measured under a cap, compared against one
measured without, differs in two ways at once — the cap and the mechanism — and
no reader can separate them from the result afterwards. Paired rows make the
budget axis and the scoping axis independently readable, which is the only way a
recall gap can be attributed to either. An unbounded route is also not one
anybody can use: a real agent's context is finite, so the budgeted rows are the
comparison it actually faces and the unbudgeted rows are the mechanism's ceiling.

An unbudgeted arm that silently truncated would be read as a fact about the
route rather than about the constant, so both unbudgeted injection arms assert
that the projection did not truncate and stop the run if it did.

`code-only` scores zero by construction. It is measured anyway rather than
asserted, because a floor that is stated instead of run is one more number
nobody checked.

**Which end the budgeted Git arm is cut from, and why.** `git log` prints newest
first. `buildInjection` orders records newest first and drops the tail when the
budget runs out, on the argument its own source gives: the constraint recorded
most recently is the one an agent is most likely to be about to break. Keeping a
prefix of the log therefore cuts the same end the product cuts — oldest first.
The trailing partial line goes with it, because a `Record-Id:` line severed
halfway was not delivered. Cutting from the other end would be a different route
with a different number; the choice is stated because it decides the figure.

`git-log-path` and `git-log-path-budgeted` are the comparators, the role
ADR-0017 gives ordinary Git, and both read the same `git log` bytes. The command
is deliberately the plain one: `--follow` is available to anyone who knows to
reach for it, and the count of gold attachments reachable only through a rename
is reported separately so the part of any gap owed to renames is visible rather
than absorbed into the headline.

The two `every-record` routes answer ADR-0017's question about whether
unfiltered structured memory is enough. The honest answer depends on whether the
tokens are paid, so both are reported and neither stands alone.

> **Deviation, recorded 2026-08-01, before the run that reports these arms.**
> `git-log-path-budgeted` and `commitlore-unbudgeted` were added after the first
> run (§10). That run's headline compared an unbounded `git log` against an
> 800-token projection, which measures the cap and the path filter together and
> licenses no statement about either. The metric, the denominator, the error
> term and the scoring are unchanged; only arms were added. Both original arms
> are kept and re-measured, and the first run stays committed as the measurement
> of the arms it covered.

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

One run, on this repository, at harness commit
`b3f5692f7d1bd0af2f27b3f31b8ebac1e2dcb0e0` with dist digest
`37ffd480ee146131c82b93acbefa14d6bbcabbbfb4b8234f4617ed6c4561878f`. Raw output:

- [`bench/results/decision-delivery-20260801T060225Z.jsonl`](results/decision-delivery-20260801T060225Z.jsonl) — 14 rows, one per (population, route);
- [`bench/results/decision-delivery-20260801T060225Z.md`](results/decision-delivery-20260801T060225Z.md) — the generated report, both tables in full.

Every figure below is read from those files. Nothing was computed by hand and no
figure is carried over from another benchmark or from the earlier run in §10.

### 9.1 Corpus

345 records over 549 commits (192 merges; 346 commits carry a record) —
**338 active, 7 superseded, 0 expired** at the evaluation instant. 1,229 paths
are tracked at `HEAD`; 160 are declared generated by the repository's own
`.gitattributes`.

The answer key's self-checks agree: 9 `Supersedes:` trailers resolved by the
block walk against 9 found by a raw line scan of the same messages, and 0
`Expires:` against 0. Six records sit on commits that changed no path.

Primary population: 1,046 of 1,069 authored paths carry at least one active
record. The denominator is **2,217 (path, active record) pairs**, 164 of them
reachable only through a rename.

### 9.2 The number

| Route | Budget | Path recall | Retired delivered | Precision | Tokens |
|---|---:|---:|---:|---:|---:|
| `code-only` | — | **0.0%** | 0 | — | 0 |
| `git-log-path-budgeted` | 800 | **42.0%** | 7 | 99.3% | 673,134 |
| `git-log-path` | none | **94.4%** | 75 | 96.5% | 1,351,382 |
| `every-record-budgeted` | 800 | **2.2%** | 0 | 0.5% | 783,454 |
| `every-record-unbudgeted` | none | **92.3%** | 7,322 | 0.6% | 92,175,612 |
| `commitlore` | 800 | **81.7%** | **0** | 93.0% | 511,412 |
| `commitlore-unbudgeted` | none | **92.3%** | **0** | 93.6% | 741,429 |

**The answer to the question the issue asks is 81.7%.** The shipped path-scoped
projection delivers 1,811 of the 2,217 active (path, record) pairs this
repository holds for files an agent could edit, and not one of the 1,947 records
it hands over has been retired.

**At the budget an agent actually has, that is 39.7 points ahead of ordinary
Git.** `git-log-path-budgeted` — the same `git log` output cut to the same 800
tokens — recovers 42.0%, delivers 7 retired records, and spends *more* tokens
doing it (673,134 against 511,412), because raw commit prose carries subject
lines, bodies and trailers the projection does not render. It leaves 183 of
1,046 paths with nothing, against 117.

An unbounded `git log` recovers 94.4%. That is a real number and it is not a
comparison anyone can act on: it is 1.35 million tokens across the population,
2.6 times the shipped route's, and no agent has that context. The unbudgeted
rows are each mechanism's ceiling, not a route.

### 9.3 Budget or scope: the cap costs 10.6 points, scoping costs nothing

This is what the paired arms were added to settle, and the two rows settle it
exactly.

- `commitlore` 1,811 → `commitlore-unbudgeted` 2,047. **The 800-token cap costs
  236 pairs, 10.6 points.**
- `commitlore-unbudgeted` 2,047 and `every-record-unbudgeted` 2,047 — the same
  number. **Path scoping costs nothing at all.** Given the same budget, the
  path-scoped projection reaches every pair the repository-wide dump reaches,
  and it does so with 741,429 tokens against 92,175,612 and with 0 retired
  records against 7,322.

Whatever is wrong with the shipped route's recall, the path filter is not it.
The earlier framing in §10, which read the shortfall as a cost of scoping, was
reading a confounded table.

### 9.4 The ceiling the grader sets

`commitlore-unbudgeted` recovers 2,047 of 2,217 and misses exactly 170 — which
is exactly the `withheld_records` count on both `commitlore` rows. Ten records
in this repository grade `blocked`, so **92.3% is the ceiling for any injection
route on this corpus, and the trust grader sets it.** Those ten matched a
shipped injection pattern and their content is withheld by design (ADR-0005).
This run counts them; it does not adjudicate them and cannot say how many are
false positives.

### 9.5 Where ordinary Git is still ahead, and what that costs

Unbudgeted against unbudgeted, `git-log-path` recovers 2,093 and
`commitlore-unbudgeted` 2,047 — Git is ahead by 46 pairs, because it renders the
blocked records the grader withholds. It pays for that by also rendering 75
retired records, where the projection renders 0.

Git's own miss is 124 pairs. The denominator contains 164 pairs reachable only
through a rename, and plain `git log` does not follow renames; the run reports
both counts and does not assert the identity between them.

### 9.6 Sensitivity to the generated-path exclusion

Over **every** tracked path, generated included: the denominator grows from
2,217 to 2,925 pairs, `commitlore` reads 81.7% against 81.7%,
`git-log-path-budgeted` 37.8% against 42.0%, `commitlore-unbudgeted` 93.9%
against 92.3%, and `git-log-path` 95.0% against 94.4%. Nothing reverses; the
equal-budget gap widens rather than closing.

### 9.7 What this run does not establish

Everything in §7 holds. Four points bear repeating beside the number:

- **One corpus, one repository, one query strategy per route.** These are this
  repository's figures, and the corpus is the one whose maintainer wrote the
  tool.
- **This is delivery, not recovery.** No agent was run. The figures bound what an
  agent could recover; they say nothing about what one would.
- **The error term is half-exercised.** Seven superseded records and zero
  expired. `commitlore` delivering 0 retired records is evidence about the
  supersede filter on seven records and no evidence at all about expiry.
- **The budgeted Git arm is one truncation of one command.** Cutting the other
  end, or reaching for `--follow`, would score a different route. §5 says which
  choice was made and why.

---

## 10. The first run, and why it is superseded

> **Superseded by §9. Its headline comparison was confounded and its conclusion
> was wrong.** This run had no budgeted Git arm and no unbudgeted CommitLore
> arm, so its lead figure set an unbounded `git log` against an 800-token
> projection and read the 12-point difference as a property of path scoping.
> §9 measures both axes and finds the opposite: at equal budget the scoped route
> is 39.7 points ahead, and path scoping costs nothing. The rows below are still
> a correct measurement of the five arms they cover — that is why they are kept
> — but no conclusion in this section should be quoted.
>
> **Provenance.** This branch was rebased onto `dev` after the run, so the
> recorded `harness_commit` no longer resolves, and `bench/deterministic/` has
> changed since, so the recorded `harness_digest` no longer matches `HEAD`
> either. Under ADR-0018 that means these rows can no longer be re-derived from
> an identified commit or from identical harness code. They are kept as a record
> of what was measured, not as a re-derivable result.

One run, on this repository, at harness commit `57e4a2256ac0158f582da5f8ced566be130f9ddd`
with dist digest `37ffd480ee146131c82b93acbefa14d6bbcabbbfb4b8234f4617ed6c4561878f`.
Raw output:

- [`bench/results/decision-delivery-20260801T051755Z.jsonl`](results/decision-delivery-20260801T051755Z.jsonl) — 10 rows, one per (population, route);
- [`bench/results/decision-delivery-20260801T051755Z.md`](results/decision-delivery-20260801T051755Z.md) — the generated report, both tables in full.

Every figure below is read from those files. Nothing here was computed by hand,
and no figure is carried over from another benchmark.

### 10.1 Corpus

327 records over 518 commits (179 merges; 328 commits carry a record) —
**320 active, 7 superseded, 0 expired** at the evaluation instant
`2026-08-01T05:17:45Z`. 1,220 paths are tracked at `HEAD`; 160 of them are
declared generated by the repository's own `.gitattributes`.

The answer key's two self-checks agree: the block walk resolved 9 `Supersedes:`
trailers against 9 found by a raw line scan of the same messages, and 0
`Expires:` against 0. Six records sit on commits that changed no path, so no
path-scoped route can reach them.

In the primary population, 1,037 of 1,060 authored paths carry at least one
active record. The denominator is **2,149 (path, active record) pairs**, 164 of
them reachable only through a rename.

### 10.2 The number

| Route | Path recall | Retired records delivered | Precision | Tokens delivered |
|---|---:|---:|---:|---:|
| `code-only` | **0.0%** | 0 | — | 0 |
| `git-log-path` | **94.2%** | 75 (3.6% of delivered) | 96.4% | 1,288,852 |
| `every-record-budgeted` | **2.3%** | 0 | 0.5% | 785,009 |
| `every-record-unbudgeted` | **92.1%** | 7,259 (2.2%) | 0.6% | 82,961,037 |
| `commitlore` | **82.1%** | 0 | 92.8% | 500,550 |

**The answer to the question the issue asks is 82.1%.** The shipped path-scoped
projection delivers 1,764 of the 2,149 active (path, record) pairs this
repository holds for files an agent could edit. It hands over 1,900 records in
all and **not one of them has been retired**.

That is not the best recall in the table. Ordinary `git log -- <path>` delivers
**94.2%** — twelve points more — and it never leaves a path empty-handed, where
the shipped route delivers nothing at all on 117 of 1,037 paths. What ordinary
Git also delivers is 75 retired records and 2.6 times the tokens. The two
figures are the trade the product makes, and recall is the side it loses.

The unfiltered dump is not an alternative to either. At the shipped 800-token
budget it recovers **2.3%**: the budget cuts it to ten records for the whole
repository, and those ten are almost never the ones the path needs. Removing the
budget takes it to 92.1%, at 83 million delivered tokens and 7,259 retired
records surfaced — 166 times the tokens of the path-scoped route, to deliver
ten points more context mixed with the decisions the repository has withdrawn.

### 10.3 Where the missing 17.9 points went

The rows locate most of the gap without any further run.

**7.9 points never leave the grader.** The `every-record-unbudgeted` row
recovers 1,979 of 2,149 — every gold pair except 170 — while its
`withheld_records` field records that ten records in this repository grade
`blocked` and are therefore never rendered on any injection route. 2,149 − 1,979
= 170 is exactly the `withheld_records` count for the shipped route. So **92.1%
is the ceiling for any injection route on this corpus**, and the trust grader,
not path scoping, sets it. Those ten records matched a shipped injection pattern
and their content is withheld by design (ADR-0005). This run counts them; it
does not adjudicate them, and it cannot say how many are false positives.

**The remaining 10.0 points separate the path-scoped projection from the
repository-wide dump** — 215 pairs that the dump delivers and the scoped
projection does not. The committed rows do not decompose that further into
budget truncation and path-scope disagreement, and this document does not guess.
One further arm would settle it: the same path-scoped projection at a budget
large enough to cut nothing. Whatever it does not recover is scope; the rest is
the 800-token budget. That arm was not registered before this run and is not
reported from it. It was added afterwards and §9.3 reports it: the cap costs
10.6 points and scoping costs nothing.

**Attachment disagrees in both directions.** The shipped route also delivers 136
pairs that the answer key does not attach to the path, which is what holds its
precision to 92.8%. Two independent implementations of "which records belong to
this file" disagree on 215 pairs one way and 136 the other, out of 2,149. That
is a finding about the question, not only about the tool: the phrase *the
repository's decisions about this file* does not have a single mechanical
meaning, and any recall figure inherits whichever one the measurer chose.

### 10.4 Sensitivity to the generated-path exclusion

Reading the same run over **every** tracked path, generated included: the
denominator grows from 2,149 to 2,804 pairs, `commitlore` reads 82.0% against
82.1%, and `git-log-path` 94.8% against 94.2%. The exclusion moves nothing and
reverses nothing; it is reported so a reader does not have to take that on
trust.

### 10.5 What this run does not establish

Everything in §7 still holds, and three points bear repeating beside the number
rather than below it:

- **One corpus, one repository, one query strategy per route.** 82.1% is this
  repository's figure. It is not an estimate for any other, and the corpus is the
  one whose maintainer also wrote the tool.
- **This is delivery, not recovery.** No agent was run. The figure bounds what an
  agent could recover; it says nothing about what one would.
- **The error term is half-exercised.** Seven superseded records and *zero*
  expired ones. `commitlore` delivering 0 retired records is evidence about the
  supersede filter on seven records and no evidence at all about expiry.
