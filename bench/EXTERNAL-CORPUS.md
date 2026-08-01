# The same measurement, on repositories this project did not write

- Status: **registered 2026-08-01, before any run of this measurement**. The
  result section at the bottom was empty when the rest of this file was written.
- Provenance rules: [ADR-0018](../docs/adr/ADR-0018-benchmark-provenance-after-rewrites.md)
- Metric names in the result rows: `budgeted_log_coverage`, `revert_backfill`,
  `decision_delivery`
- Does not amend [`bench/DECISION-DELIVERY.md`](DECISION-DELIVERY.md). That
  document's metric, denominator, scoring and arms are used here unchanged; §6
  below records the one arm added for this corpus and why.

---

## 1. The weakness this addresses, stated plainly

Every headline figure this project has is CommitLore measuring CommitLore.
81.7% delivery, 42.0% for `git log`, the 92.3% injection ceiling, the
417-decision guard corpus — one repository, and the repository whose maintainer
wrote the tool. `bench/DECISION-DELIVERY.md` §7 says so in its own first bullet,
which makes the weakness declared rather than hidden, but declaring a weakness
is not measuring past it.

This document does not fix that. It establishes exactly how much of the existing
measurement can be carried to a repository nobody here wrote, and it separates
the part that transfers with no assumptions at all from the part that only
transfers on an oracle. Both are reported; the second is labelled as an upper
bound on a process no user has run, in those words, in the result section and
not only in a limits section underneath it.

Two things are true at once and the whole design follows from holding both:

- **The `git log` baseline needs no records.** It is a fact about a repository's
  shape — how deep each file's history is and how long its commit messages are —
  and it can be measured on any repository with a history. Whether 42.0% is a
  property of `git log` or a property of *our* repository is therefore an
  answerable question.
- **The delivery figure needs records, and no external repository has any.**
  Nobody wrote CommitLore trailers into Django. Records must be manufactured, and
  a manufactured record set is an oracle: it says what a perfectly diligent
  recorder would have left behind, not what anybody did leave behind.

---

## 2. What transfers, and what does not

| Quantity | Needs records? | Transfers? |
|---|---|---|
| `git-log-path-budgeted` cut behaviour | no | **yes**, directly (§4) |
| `git-log-path-budgeted` *record* recall | yes | only under backfill (§5, §6) |
| `commitlore` path recall | yes | only under backfill (§5, §6) |
| the 92.3% injection ceiling | yes, and a trust grader configured for that repository | **no** — reported if it appears, claimed for nothing |
| `rationale_density` | yes | **no** — an external repository's density is a fact about its authors, not about this tool |

The honest position on the third row: the ceiling is set by ten records in this
repository that a shipped injection pattern grades `blocked`. A backfilled
corpus produces records from a fixed template, so whether any of them trip the
grader is a fact about the template, not about the corpus. Any `withheld_records`
count the run reports is stated and nothing is concluded from it.

---

## 3. Corpus

Four external repositories, chosen for substantial history, permissive licences,
and — the load-bearing property for §5 — a history that contains revert commits
written by `git revert` itself.

| Repository | Upstream | Licence | Pinned clone SHA |
|---|---|---|---|
| `django/django` | https://github.com/django/django | BSD-3-Clause | `60121939f6b225c7a719dd561e372e1d8e5e2c4a` |
| `sympy/sympy` | https://github.com/sympy/sympy | BSD-3-Clause | `2af2aca14684997bfce7bcd7224a90b29b6d0f11` |
| `scikit-learn/scikit-learn` | https://github.com/scikit-learn/scikit-learn | BSD-3-Clause | `5799d3eac08bda44fbce3309e641cbf98c5d312a` |
| `psf/requests` | https://github.com/psf/requests | Apache-2.0 | `414f0513c33883adf6f2b46901d4f0b38a455851` |

Each SHA was read from `git rev-parse HEAD` on a full clone taken 2026-08-01.
The harness asserts the pinned SHA before it measures anything and refuses the
run otherwise, so a result file cannot describe a different tree than this table
names. Commit counts and date ranges are properties of the pinned SHA and are
reported by the run rather than typed here.

A fifth corpus is measured beside them in §4 only: **this repository**, at commit
`b3f569210554aab815a48c21ddef90dce029ba98` — the exact commit that produced the
81.7% and 42.0% rows in `bench/DECISION-DELIVERY.md` §9. It is the calibration
row. Without it, an external coverage figure has nothing to be compared against;
with it, the comparison is against the same tree that produced the published
number rather than against whatever `HEAD` happens to be when this runs.

Nothing is sampled. Every tracked path at the pinned SHA is measured.

---

## 4. What transfers with no records at all

### 4.1 The quantity

`bench/DECISION-DELIVERY.md` §5 defines `git-log-path-budgeted` as
`git log --format=%B -- P` cut to 800 tokens from the newest end, with the
trailing partial line dropped. Its recall is, mechanically, *the share of a
path's record-bearing commits whose message survives that cut*. Records live in
commit messages; a message the cut removed delivers nothing.

Strip the records out of that sentence and what remains is measurable anywhere:

> **`budgeted_log_coverage`** — over the evaluation paths of a repository, the
> share of each path's commits whose message is **wholly contained** in the
> 800-token prefix of `git log --format=%B -- P`.

Wholly contained, not partially: a `Record-Id:` trailer sits at the end of a
message, so a message the cut severed would not have delivered its record. The
criterion is therefore the conservative one, and it is the one that matches what
the recall figure counts.

Micro-averaged over paths, the same way `path_recall` is:
`Σ_P commits_delivered(P) / Σ_P commits_total(P)`. The macro average, the count
of paths at 1.0 and the count at 0 are reported beside it, again matching.

### 4.2 How the byte layout is established rather than assumed

Counting *which* commits survive a prefix cut requires knowing where each
message ends in the concatenated output. `git log --format=%B -- P` emits each
commit's raw body followed by one LF, newest first. The harness does not take
that on trust: for every path it reads the same log with
`--format=%B%x00`, splits on NUL to recover the individual messages, rebuilds
`Σ (message + LF)`, and **asserts byte equality with the real
`--format=%B` output**. A path where the reconstruction disagrees stops the run
rather than being scored, because the offsets would be wrong and the coverage
figure would be quietly false.

The cut itself is `truncateToBudget` from `bench/deterministic/recovery.ts` —
the same function, not a copy — at `DEFAULT_BUDGET_TOKENS`, the shipped 800.

### 4.3 Evaluation paths

The same rule as `bench/DECISION-DELIVERY.md` §4, minus the clause that needs
records:

1. tracked at the pinned SHA (`git ls-tree -r --name-only <sha>`);
2. not declared generated by that repository's own `.gitattributes`
   (`git check-attr --source=<sha> linguist-generated`) — the repository's own
   declaration, as before;
3. `git log -- P` returns at least one commit.

Condition 3 replaces "at least one active record". Both populations are
reported, `authored` and `all-tracked`, exactly as the delivery metric reports
them, so the generated-path exclusion is a visible sensitivity here too.

### 4.4 What this figure is and is not

It is the *record-free skeleton* of the 42.0%. It answers "how much of a file's
history fits in 800 tokens" on each repository, which is the mechanism that
produces the 42.0% and the only part of it that survives having no records.

It is **not** a recall figure, and it equals one only under an assumption that
is false in detail: that each commit carries at most one record and that records
are spread evenly over a path's history. In this repository neither holds
exactly — the early history predates the tool and carries no records, some
commits carry several, and `git log` does not follow renames while the answer
key does. That is precisely why the calibration row exists. The gap between
this repository's `budgeted_log_coverage` and its published 42.0% recall is the
size of that assumption, measured rather than argued, and every external figure
must be read through it. It is reported as a named quantity, not buried.

---

## 5. Backfill: manufacturing an answer key from ground truth the project declared itself

### 5.1 Why reverts, and what a revert is evidence of

`Ruled-out: <alternative> | <reason>` says: this repository tried something and
undid it. A revert commit says exactly that, in the repository's own hand,
with a machine-written line naming the commit it undid. It is the only decision
class in an arbitrary repository that is (a) explicitly declared, (b) mechanically
identifiable, and (c) identifiable *without* a model reading prose and forming a
view.

That is the whole of the argument. Reverts are not a sample of a repository's
decisions — they are one atypical corner of them, and §7 says so.

### 5.2 Candidate selection

Walk `git log <pinned-sha>`. A commit `R` is a candidate when its message
contains a line matching

```
^\s*This reverts commit ([0-9a-f]{7,40})\.?\s*$
```

which is the line `git revert` writes itself. Keying on this line rather than on
a `Revert "…"` subject is deliberate: the subject is a human convention that
some projects rewrite, while this line is machine-written and — decisively —
*names the reverted commit*, which is what makes a record derivable instead of
guessed.

### 5.3 Filters, each with its reason, all fixed before the run

A candidate is dropped when any of these holds. The count dropped by each is
reported per repository.

| # | Filter | Why |
|---|---|---|
| F1 | the message names more or fewer than one reverted commit | a record needs one alternative; a bulk revert's `Ruled-out:` would be ambiguous |
| F2 | the named sha does not resolve, or is not an ancestor of `R` | nothing to read the alternative from |
| F3 | `R` or the reverted commit `A` is a merge | reverting a merge is `-m` semantics; the added-line extraction below has no single meaning |
| F4 | some later commit in the history reverts `R` itself | a revert-of-a-revert is the loudest possible statement that the change came back |
| F5 | `A` added fewer than 5 checkable lines in total | too little content to establish that it did not come back |
| F6 | **the change came back** (§5.4) | a record saying an alternative is ruled out, when it is in the tree at the pinned SHA, is false |

### 5.4 F6, the return check, in full

For the reverted commit `A` and each path `P` that `A` changed, let `L(A,P)` be
the set of distinct lines `A` **added** to `P` — the `+` lines of
`git show --format= --unified=0 A -- P`, excluding the `+++` header, trimmed,
and keeping only lines of at least 8 characters after trimming. Short and blank
lines are dropped because `)`, `}` and `import os` recur everywhere and would
report a return that never happened.

Walk forward to the pinned SHA and read the file as it stands there. For each
`P`, `matched(P)` is the number of lines of `L(A,P)` that occur in `P` at the
pinned SHA (trimmed comparison); a `P` that no longer exists contributes zero.

```
return_share(R) = max over P of matched(P) / |L(A,P)|
```

**A candidate with `return_share(R) ≥ 0.5` is excluded.** The threshold is fixed
here, before the run. The full distribution of `return_share` over candidates is
reported so a reader can see how much the choice of 0.5 is doing; the harness
also reports the survivor count at 0.25 and at 0.75 for the same reason.

Reading the tree at the pinned SHA is a stronger check than a walk that stops at
the first reintroducing commit: a change that came back and was removed again is
not back, and the tip is what an agent about to edit the file is looking at.

### 5.5 The record, generated and never hand-written

One record per surviving revert `R`, built only from `R`'s own message and the
reverted commit's subject line. No sentence in it is composed by a person or a
model for this benchmark.

```
Ruled-out: <alternative> | <reason>
Record-Id: r-<first 8 hex of sha256(R's sha)>
Provenance: reconstructed
```

- **alternative** — the reverted commit's subject (`%s`), whitespace collapsed,
  every `|` replaced by `/` (SPEC §3.1 splits on the first `|`, and there is no
  escape), cut to 120 characters.
- **reason** — `R`'s message with the subject line removed, every
  `This reverts commit …` line removed, and every line whose key is in the fixed
  list `Signed-off-by, Co-authored-by, Reviewed-by, Acked-by, Cc, Closes, Fixes,
  Refs, Ref, Resolves, Change-Id, Reverts` removed; the remainder joined with
  single spaces and cut to 240 characters at a word boundary, with ` [truncated]`
  appended when the cut fired. When nothing remains, the reason is the generated
  string `no reason recorded in the revert message`, which is a true statement
  about the commit rather than an invented rationale.
- **Record-Id** — derived from `R`'s sha, so the record set is a pure function of
  the pinned clone. The harness asserts no two records collide.
- **Provenance: reconstructed** — mandatory, and the same value
  `src/core/backfill.ts` forces on every record it writes. It is also
  consequential: SPEC §7 grades a reconstructed record as `claim`, never
  `directive`, so every backfilled record reaches an agent tagged as information
  rather than as an instruction. That is the correct grade for what these are.

### 5.6 Where the records are attached, and why history is not rewritten

Records are written to `refs/notes/commitlore` with `git notes add`, on the
revert commit. Nothing in the corpus is rewritten and every SHA in §3 stays
valid.

This is not a convenience. `src/core/backfill.ts` states the rule the product
already obeys — *"rewriting a commit message to add a trailer changes every
downstream sha, and no cold-start convenience is worth an irreversible operation
on somebody's history"* — and SPEC §1 makes `refs/notes/commitlore` an
authoritative record location, not a second-class one. Rewriting 34,838 Django
commits to plant trailers would also destroy the corpus statement in §3, since
the pinned SHA would no longer exist.

It has one consequence that §6 has to answer for: a record in a note is
invisible to `git log --format=%B`.

---

## 6. The delivery measurement on the backfilled corpus

Metric, denominator, answer key, scoring and error term: `bench/DECISION-DELIVERY.md`
§3, §4 and §6, unchanged, and executed by the same code —
`measureDecisionDelivery` in `bench/deterministic/recovery.ts`, whose answer key
is `bench/deterministic/census.ts` and which still imports nothing from the
product. Two additions, both registered here.

### 6.1 The answer key reads the notes mirror

`buildCensus` walks commit messages. The backfilled records are in
`refs/notes/commitlore`, so it gains an opt-in that also folds
`git log --notes=refs/notes/commitlore --format=…%N` into the same block walk,
parsed by the same `git interpret-trailers --parse` behind the same synthetic
subject the product uses for a bare block. **The option defaults to off**, so the
metric's behaviour on this repository is byte-identical to the registered one.

This is a fidelity improvement, not a fudge: SPEC §1 names both locations, and
an answer key that read only one of them would have been incomplete all along.

### 6.2 One arm is added: `git log` that can see the notes

`git-log-path` and `git-log-path-budgeted` read `git log --format=%B`, which
cannot see a note. On the backfilled corpus they therefore score **0% by
construction** — a fact about where §5.6 had to put the records, not a fact
about Git, and reporting it as though it were the latter would be the most
dishonest number this document could produce.

So both are kept and reported *and* two arms are added:

| Route | Budget | Delivery |
|---|---|---|
| `git-log-path-notes` | none | `git log --format=%B%x0a%N --notes=refs/notes/commitlore -- P`, entire |
| `git-log-path-notes-budgeted` | 800 | the same bytes, cut by the same `truncateToBudget` from the same end |

`git-log-path-notes-budgeted` is the arm comparable to the 42.0% row. It is
ordinary Git — one command, no tool — reading the same records from the same
place the projection reads them, cut to the same budget. The plain arms are
reported beside it so the 0% is visible and explained rather than omitted.

On this repository the two families would coincide, because records here live in
commit messages and are mirrored to notes. On the backfilled corpus they do not,
and the notes arm is the honest comparator.

### 6.3 Everything else is held fixed

Budgets, populations, the rename-chain attachment, the micro-averaged
denominator, the `stale` error term, `withheld_records`, and the assertion that
an unbudgeted arm did not truncate: all unchanged and all re-run by the same
code. The index is rebuilt after backfill and before measurement, since the
projection reads it.

---

## 7. What this cannot show

Stated here and repeated in the result section, because a limit that appears
only under the number is a limit the reader meets too late.

- **The backfilled figure is an oracle, not a workflow.** No Django maintainer
  wrote a CommitLore record. The records were generated, from a fixed template,
  by a program, from commits chosen by a filter — and every one of them is
  *correct by construction*, because the filter kept only the reverts whose
  change is provably still gone. A delivery number on that corpus is **an upper
  bound on a process no user has run**. It says what delivery would look like if
  a repository's revert history had been recorded perfectly and nothing else had
  been recorded at all. It is not evidence that anyone would record it, that
  what they recorded would be right, or that the recall would survive a record
  set with the ordinary amount of noise in it.
- **Reverts are one atypical corner of a repository's decisions.** They are the
  decisions loud enough to reach the history as an undo. Constraints, warnings
  and quietly-abandoned alternatives — most of what `Limit:`, `Warn:` and the
  other half of `Ruled-out:` exist for — leave no revert and are invisible here.
  The backfilled record set is not a sample of what a repository would record.
- **One template means one record shape.** Every backfilled record carries
  exactly one `Ruled-out:` and nothing else. Token costs, precision and the
  budget's bite all depend on record size, and this corpus has one.
- **`budgeted_log_coverage` is not recall.** §4.4 says what it is and names the
  assumption between the two. Read the external figures through the calibration
  row, never on their own.
- **The return check is a heuristic with a threshold.** §5.4 fixes it at 0.5
  before the run and reports the distribution and two alternative thresholds. It
  can still be wrong in both directions: a rewritten reintroduction escapes it,
  and a file that legitimately reuses a reverted line is caught by it.
- **Four repositories, all Python, all large and long-lived.** Nothing here
  speaks to a small repository, a young one, or one in another ecosystem with
  other commit-message habits.
- **Delivery, not use**, exactly as before. No agent was run, no model was
  called, no judge was consulted. Every figure is a ceiling.

---

## 8. Where the numbers come from

`bench/external/run.ts`, driving `bench/external/coverage.ts` (§4),
`bench/external/backfill.ts` (§5) and `measureDecisionDelivery` (§6). It writes
one JSONL row per (corpus, metric, …) and a generated markdown report beside it
under `bench/results/external-corpus-*`, both carrying the `harness_commit`,
`harness_digest` and `dist_digest` ADR-0018 requires. The harness digest for
these rows covers `bench/external/` as well as `bench/deterministic/`, because
both produced them.

The run needs the four clones on disk at the pinned SHAs of §3; their location
is passed in and is not part of any result.

Before this document was written, the *plumbing* was probed once on
`psf/requests` — a single hand-made note, to establish that a notes-borne record
reaches `commitlore inject` at all and that its id appears in the rendered
entry line. No figure from that probe is reported here, nothing was measured in
it, and the harness was written afterwards.

---

## 9. Result

*Empty at registration. Filled from generated files, each named, after the run.*
