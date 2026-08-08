# The token ledger: what a record costs to write, what it saves to read

- Status: **registered 2026-08-01, before any run of this measurement**;
  amended the same day by the history-ref deviation recorded in §3, before the
  run that reports it; amended again 2026-08-02 by §5.1, *after* the run,
  appended rather than edited in, and changing no figure in §9
- Closes the gap `docs/evidence.md` records under *Not yet measured → Break-even*
- Provenance rules: [ADR-0018](../docs/adr/ADR-0018-benchmark-provenance-after-rewrites.md)
- Metric name in the result rows: `token_ledger`
- Prior art this must not contradict:
  [#138](https://github.com/MongLong0214/commitlore/issues/138) (which token
  accounting), [#134](https://github.com/MongLong0214/commitlore/issues/134)
  (write-side cost), [#127](https://github.com/MongLong0214/commitlore/issues/127)
  (economic case)

This document fixes the units, the terms, the denominators and the refusal
conditions **before** the harness produced a number. The result section at the
bottom was empty when the rest of this file was written, and every figure it
carries names the generated file it was read from.

---

## 1. The question, and why it was open

CommitLore spends tokens on the write side — it builds a prompt, a model drafts
a record, a verifier checks it — and claims to save them on the read side, by
handing an agent a scoped projection instead of a broad dump.

> How many reads does a record set need before it has paid for itself?

`docs/evidence.md` has carried that question as a one-line disclaimer:

> A break-even figure would require a per-turn ledger of provider-reported token
> usage and an observed cost for work spent on an alternative the repository had
> already rejected. Neither has been collected, so no such figure is published.

That sentence is about a **different** break-even. #138 removed an earlier
figure whose denominator was *work saved by one prevented re-proposal* — a
behavioural quantity this project has never observed. The denominator here is
not behavioural. It is the difference in delivered tokens between two
information routes, and `decision_delivery` already measured it. That is the
whole reason this ratio can be stated where the earlier one could not, and it is
also why this document does not reopen #138's question: nothing here prices a
prevented re-proposal.

The two break-evens are not interchangeable and neither supersedes the other.
Section 12 of the deterministic report still carries the re-proposal threshold
with its denominator deliberately unsupplied.

---

## 2. Unit, and the accounting it commits to

Every figure on both sides of the ratio is in **tokens under the product's own
`CHARS_PER_TOKEN` constant** (`⌈characters / 4⌉`, `dist/core/inject.js`). That is
the unit `delivered_tokens` already uses on the read side, so numerator and
denominator are in the same unit by construction.

Three things that unit is not, stated here rather than in a footnote:

- **It is not a provider tokenizer.** A real tokenizer would give a different
  count for the same bytes, and the error is not uniform across prose, diffs and
  JSON. Every figure here is a byte-derived proxy.
- **It is not a bill.** It counts text the product constructs and sends. It says
  nothing about cache pricing, and `bench/drivers/claude-headless.ts` excludes
  `cache_read_input_tokens` for its own separate reason. This measurement does
  not inherit that choice, because it never reads a provider usage object at
  all.
- **It is not a dollar figure**, so it cannot be compared against a published
  cost-per-task without a rate, and no rate is supplied.

Because both sides use the identical proxy, a *ratio* between them is more
robust than either side alone: a proxy that is wrong by a constant factor
cancels. A proxy that is wrong by different factors on prose and on diffs does
not cancel, and that residual is a stated limit in §7.

---

## 3. The write side: four terms, two measurable

`prepareCaptureContext` (`src/core/capture-prepare.ts`) builds the prompt with
`buildHarvestPrompt({ transcript, diff })`. That prompt is
`scaffold + numbered transcript + staged diff`, with no truncation anywhere in
the path. A model then drafts a record; `capture verify` checks it.

| Term | Measurable without a model call? | How |
|---|---|---|
| **W1 scaffold** | **yes** | `buildHarvestPrompt({ transcript: '', diff: '' })`, measured on the built product |
| **W2 staged diff** | **yes** | reconstructed per record-bearing commit from Git |
| **W3 session transcript** | **no** | not retained; see §5 blocker A |
| **W4 the drafting turn's output** | **no** | needs a model call; see §5 blocker B |
| **W5 verification** | **yes, and it is zero** | the shipped verifier is a local process that calls no model |

**W1.** The scaffold is a constant of the shipped build: rules, the trailer
vocabulary loaded by `loadVocabulary()`, and the output contract. Passing an
empty transcript and an empty diff renders it together with the two empty
markers the prompt emits in their place (`1 | ` and `(no diff)`), so the figure
reported is the prompt's floor as the product would actually print it, not a
subtraction.

**W2.** For each commit in the measured history that carries a `Record-Id:`
trailer and has exactly one parent, the diff `capture` would have hashed is the
difference between the parent tree and the commit tree. The harness reconstructs
it with `git diff --no-color <sha>^ <sha>` and feeds it through the same
`buildHarvestPrompt`. Merge commits are excluded, not skipped silently: this
repository merges `--no-ff` and merge commits carry no record by design, and the
count of records found on merge commits is reported so the assumption is checked
rather than assumed. A root commit, having no parent, is excluded and counted.

This is a **reconstruction**, and it is stated as one. It is the diff the commit
made, not a recording of the bytes `git diff --cached` printed on the day. They
differ if the author staged and unstaged across several commits, or if rename
detection resolves differently now than then.

**W5.** `src/core/capture-verify.ts` and `src/core/harvest-verify.ts` are
deterministic local code. `bench/types.ts` already records that
`verify_tokens` is "structurally zero for the shipped verifier", and this
measurement declines to leave that as an assertion: the harness walks the
transitive local import graph of the built verify entry points and counts
references to any network client. A count of zero is reported as a measurement;
a count above zero is a finding and the run says so rather than reporting a
zero it no longer earns.

> **Deviation, recorded 2026-08-01, before the run that reports these figures.**
> This section first said "each commit in `HEAD`'s history". A trial run at
> `HEAD` was thrown away without being committed, because that choice put two
> corpora in one ratio: the write side priced the history at `HEAD` while the
> read side came from a delivery run three records earlier, and §4 objects to
> exactly that on the other side of the same argument. The measured history is
> now pinned to the `harness_commit` the delivery run recorded, so both halves
> of every ratio describe one repository state. A commit that no longer resolves
> stops the run rather than falling back: ADR-0018's digest fallback establishes
> that harness *code* is identical, which is not the same as having the history
> back. Nothing else changed — same terms, same unit, same denominators.

**The floor.** W3 and W4 are both non-negative. So

```
W  =  W1 + W2 + W3 + W4 + 0     ≥     W1 + W2
```

and `W1 + W2` is a **floor** on what one capture costs. Every break-even derived
from it is therefore also a floor: the true figure is larger, never smaller.
The direction is stated because it decides how the number may be quoted.

**Two accountings, both reported.** #138's lesson was that a break-even which
does not say what it counted is underspecified, and that the fix is to publish
both readings rather than the flattering one. So the floor is reported twice:

| Accounting | Numerator | The assumption it makes |
|---|---|---|
| `with-diff` | W1 + W2 | the staged diff is new input, charged in full |
| `scaffold-only` | W1 | the staged diff is already in the session's cached prefix and is charged at nothing |

Neither is privileged. The truth is between them and depends on a cache
behaviour this harness does not observe.

---

## 4. The read side: a per-read figure from a per-corpus one

`decision_delivery` reports `delivered_tokens` as `Σ ⌈len(text) / 4⌉` summed
over the evaluation paths, and reports `evaluation_paths` beside it. The run
builds **exactly one delivery per evaluation path**, so

```
tokens per read  =  delivered_tokens / evaluation_paths
```

is an arithmetic identity on that row, not a new estimate. **One read = one
first edit to one path**, which is the event the shipped `PreToolUse` hook fires
on.

The read side is **not remeasured here.** It is read from a committed
`decision-delivery-*.jsonl`, named in the row, whose `harness_commit`,
`harness_digest` and `dist_digest` are copied into the ledger row so the
derivation carries its source's provenance with it. Remeasuring would move the
corpus — this repository's record count grows with every commit, including the
commits that add this document — and would leave `docs/evidence.md` citing two
different corpora for two halves of the same ratio.

That argument cuts both ways, which is what the §3 deviation is about: it is the
read side's `harness_commit` that fixes the history, and the write side is
measured over that same commit rather than over `HEAD`.

The primary population is `authored`, the same population
`bench/DECISION-DELIVERY.md` makes primary.

### 4.1 The reduction pairs, fixed before the run

A token-reduction percentage is the number this market runs on, and it is
usually published without saying what it was divided by. Five pairs are
registered here, chosen before any of them was computed, and each is reported
with its denominator's token count *and* its denominator's recall on the same
line:

| Subject | Denominator | Why this pair |
|---|---|---|
| `commitlore` | `git-log-path-budgeted` | equal budget — the comparison an agent actually faces |
| `commitlore` | `git-log-path` | against an unbounded `git log`, which recovers **more**; cheaper at lower recall is a trade |
| `commitlore` | `every-record-unbudgeted` | against the whole-repository dump: the largest number and the least useful |
| `commitlore-unbudgeted` | `every-record-unbudgeted` | the iso-recovery pair — same projection, budget removed on both sides |
| `commitlore` | `code-only` | against reading no history: the denominator is **zero**, so no percentage exists at all |

Two of the five are unfavourable to the product by construction, and they are in
the list for that reason. A pair chosen after seeing the numbers would not be
evidence of anything.

The fifth is the sharpest of the five and it has no number. A reduction against
a route that spends nothing is a division by zero, so it is reported as
undefined rather than as a large negative percentage — the shipped route is a
token *cost* against reading no history, and a market-shaped percentage cannot
say that.

The fourth pair is the one that isolates scoping, and it carries one caveat that
must travel with it: the delivery row records **how many** gold pairs a route
recovered, not **which**. Equal counts are therefore reported as equal counts and
never as the same set.

---

## 5. What is missing, named exactly

**Blocker A — the session transcript (W3).** `buildHarvestPrompt` numbers the
transcript into the prompt. For the records already in this repository the
sessions that produced them were never retained, so the term cannot be recovered
retrospectively at any price. It is not merely unmeasured; it is unrecoverable
for this corpus. Measuring it forward requires recording the transcript length
at capture time, which the product does not do and which this measurement does
not add.

**Blocker B — the drafting turn (W4).** The number of tokens a model emits
answering the harvest prompt is a property of the model and the change, and
there is no way to obtain it without calling a model. That is the ordinary half
of this blocker. The sharp half is that **the harness could not attribute the
answer to the drafting turn even if a call were made**:

- `bench/drivers/claude-headless.ts` runs `claude --output-format json` and
  reads one `usage` object out of the final result. That object is a **session
  total**. There is no per-turn breakdown in it.
- `sumTokens` counts `input_tokens + output_tokens +
  cache_creation_input_tokens` and deliberately drops
  `cache_read_input_tokens`, so even the session total is a marginal figure
  rather than a bill.
- The harvest pipeline never runs inside a bench run at all: `bench/runner.ts`
  seeds records from task YAML and writes `accepted_records` only, which is why
  every CPAA the harness has ever printed reads `not instrumented`.

So the missing instrument has a name and a shape: **a per-turn usage ledger,
which needs `--output-format stream-json` (or an equivalent per-turn capture)
in the driver, and a bench arm that actually runs `capture` against each run's
own transcript and diff.** That is the same instrument `docs/evidence.md` names,
and this measurement does not build it.

**Blocker C — the rate, not the count.** Whether the prompt's input tokens are
billed as fresh input or as a cache read is a provider-side property this
harness cannot see. It is why §3 reports two accountings instead of one.

### 5.1 Amendment, 2026-08-02: half of blocker B is closed

Appended rather than edited in place. §5 above is pre-registration — it was
written before the run in §9 and it is the reason that run's figures can be
read as a floor rather than as a total. Rewriting it now would remove the
evidence that the floor was declared in advance. What follows is what changed
after the fact, and nothing above this heading has been altered.

Blocker B named two obstacles in one paragraph, and they had different
lifetimes. The ordinary one — W4 needs a model call — still stands. The sharp
one — *the harness could not attribute the answer to the drafting turn even if
a call were made* — no longer does.

**What the CLI actually emits.** The installed `claude` CLI (2.1.220) was run
twice and its raw stdout kept; both captures are committed as
`test/fixtures/claude-stream/*.jsonl` so this paragraph can be checked rather
than believed.

- `--output-format stream-json` emits an `assistant` event **per content
  block**, each carrying the same `message.usage` and the same `message.id`.
  Summing them double-counts every turn.
- On those events, `input_tokens` and both cache fields are already final and
  reconcile exactly with the session total. `output_tokens` does not: it is the
  `message_start` snapshot. In one probe three turns reported 4, 1 and 1
  against real outputs of 157, 193 and 36 — a session total of 6 against 403.
  Nothing on the event marks it provisional while its neighbours are not, which
  makes it the kind of field a parser reads confidently and gets wrong by two
  orders of magnitude.
- The turn's real output arrives on the `message_delta` event, and that event
  is emitted **only** under `--include-partial-messages`. It also breaks out
  `output_tokens_details.thinking_tokens`.

So the term W4 needs — the tokens a model *emits* — is precisely the one term
`stream-json` alone reports wrongly. That is the finding, and it is why the
driver passes `--include-partial-messages` rather than the format flag alone.

**What is now measurable.** `bench/runner.ts --per-turn-usage` writes a
`turn_usage` object on the row: one entry per assistant API call, with its four
usage fields, its thinking tokens, its stop reason, its model and the kinds of
its content blocks. Each ledger carries its own audit — `turn_total`,
`session_total`, and a `reconciled` boolean that is true only when the turns
sum to the total the CLI states for itself, field for field. On the probe run
all four fields reconciled exactly (26 / 386 / 307 / 72,845).

An answer can therefore be attributed to the turn that produced it. If a
harvest were run as one headless invocation, W4 would be that invocation's
answering turn's `output_tokens`, read from the row and checkable against the
session total on the same row.

**What remains blocked, and why the term stays on the list.**

1. **W4 is still unmeasured.** No bench arm runs `capture` against a run's own
   transcript and diff, so no drafting turn has been priced. The instrument
   exists; the measurement has not been made. Every figure in §9 was produced
   without a model call and none of it changes.
2. **Blocker A is untouched.** W3 remains unrecoverable for this corpus. A
   per-turn ledger records what a session spent; it cannot recover a transcript
   that was never retained.
3. **Blocker C is untouched.** The ledger reports cache creation and cache
   reads as separate counts, which is more than the session total gave, but a
   count is not a rate. §3 still reports two accountings.
4. **The unit changes if this is ever used.** Everything in §2 and §9 is in the
   product's own `⌈chars / 4⌉` proxy. `turn_usage` carries the *provider's*
   tokenizer. Mixing them in one ratio would silently compare two units, so a
   future W4 figure must be reported beside the floor rather than added into
   it, until both sides are on one tokenizer.

The row constant in `bench/deterministic/ledger.ts` was narrowed to match:
future rows say the attribution half is closed and the model call is not. The
committed row in §9 keeps the text it was written with.

---

## 6. Break-even, and when it does not exist

For a comparator route `A` and the shipped route `commitlore`:

```
saving_per_read  =  tokens_per_read(A) − tokens_per_read(commitlore)

break_even_reads =  Σ over captures of W_floor
                    ────────────────────────────
                          saving_per_read
```

Reported for **every** route in the delivery run, including the ones where the
answer is unfavourable, and in two derived units: reads, and full passes over
the evaluation set (`break_even_reads / evaluation_paths`).

**`saving_per_read ≤ 0` means no break-even exists**, and that is printed as
such rather than as a large number or a negative one. `code-only` — an agent
that reads no history at all — spends zero tokens, so against it CommitLore is a
net token cost forever. That row is the most important one in the table and it
is reported first-class, because a reader who does not run `git log` before
edits is not a reader this arithmetic can promise anything to. What CommitLore
offers *that* reader is the delivery run's already-published path recall against
`code-only`'s zero — a recall argument, not a token argument. (That figure is
cited from `bench/DECISION-DELIVERY.md`, not produced here; this section was
written before this measurement ran and carries no result of its own.)

**A break-even against a route with different recall is not an iso-quality
comparison**, and the recall of both sides is carried in the same table so a
reader cannot read the token column alone.

---

## 7. What this cannot show

- **One corpus, one repository.** Every write-side figure describes this
  repository's diffs and its record-writing habits, and the corpus is the one
  whose maintainer wrote the tool. A repository that commits generated files
  will have a larger W2 and a worse break-even; one that does not will have a
  better one.
- **The floor is a floor.** Two of the four write terms are omitted, both
  non-negative. No figure here may be quoted as *the* cost of a record.
- **Both sides are byte-derived proxies.** §2. A ratio cancels a uniform error
  and does not cancel a differential one, and diffs and prose are exactly the
  two text kinds most likely to tokenize at different rates.
- **The write side is reconstructed, not recorded.** §3, W2.
- **Reads are not uniformly distributed.** Break-even in reads assumes reads
  land on the evaluation set the way the delivery run's per-path average
  describes. Real editing is concentrated on a few files, and a repository whose
  hot paths are cheap to project breaks even sooner than this figure says.
- **Nothing here is about quality, accuracy, or agent behaviour.** It is
  arithmetic on two measured token counts.
- **It prices delivery, not use.** A delivered projection is no evidence that an
  agent read it — the limit `bench/DECISION-DELIVERY.md` states, inherited whole.

---

## 8. Where the numbers come from

The harness is `bench/deterministic/ledger.ts`, run through
`bench/deterministic.ts` with `COMMITLORE_DETERMINISTIC_LEDGER_ONLY=1`. It
writes one JSONL row and a generated markdown report beside it under
`bench/results/token-ledger-*`, both carrying the `harness_commit`,
`harness_digest` and `dist_digest` ADR-0018 requires. The same measurement runs
as section 11 of a full deterministic suite; `token_ledger` is one of that
suite's required metrics, so a complete run cannot omit it.

---

## 9. Result

One run, at harness commit `8665be34564683362b419d7dd15cd4322793e4c5` with
harness digest `9c91253e4cb06a0c07076620ecdad01ebf7c13f9` and dist digest
`f54cda4795ccc1083e00aa38d8637a2e6f22466ef20213fa7d127c7fd301d1d2`, over the
history `b3f569210554aab815a48c21ddef90dce029ba98`. Raw output:

- [`bench/results/token-ledger-20260801T122953Z.jsonl`](results/token-ledger-20260801T122953Z.jsonl) — one row;
- [`bench/results/token-ledger-20260801T122953Z.md`](results/token-ledger-20260801T122953Z.md) — the generated report, all four tables in full.

Every figure below is read from those files. Nothing was computed by hand and no
figure is carried over from another benchmark.

### 9.1 The write side, and the check that it is the right corpus

| | |
|---|---:|
| prompt scaffold, as the product prints it | 4,788 chars / 4,802 bytes / **1,197 tokens** |
| commits walked | 549 (192 merges) |
| captures priced | **343** |
| record blocks on them | 343 |
| record blocks excluded, on merge commits | 3 |
| record blocks excluded, on a root commit | 0 |
| staged-diff tokens | mean 8,869, p50 **2,342**, p95 28,391, max 260,276 |
| prompt tokens per capture | mean 10,064, p50 **3,537**, min 1,197, max 261,471 |
| **write floor, with the diff term** | **3,451,848 tokens** |
| **write floor, scaffold only** | **410,571 tokens** |
| verification | **0 model tokens in 0 model calls** |

343 + 3 = 346, which is exactly the `record_bearing_commits` the delivery run's
own census reports for the same commit. Two independent walks of the same
history agree on how many commits carry a record, which is the only free
cross-check this measurement gets and it passes.

**Three merge commits do carry a record**, against §3's stated assumption that
this repository's `--no-ff` merges carry none. The count was reported so the
assumption would be checked rather than assumed, and it is wrong by three — all
three are `Merge dev into <branch>` integrations whose record documents the
conflict resolution, which is a use of a merge record rather than an accident.
Those three are excluded from the write floor, because a merge has no single
parent to reconstruct a staged diff against. The exclusion makes the floor
smaller by whatever they cost, and therefore leaves it a floor. The delivery run
saw the same thing from its own side: six of its records sit on commits that
changed no path.

The diff term dominates and it is badly behaved: its mean is 3.8× its median.
A median capture costs 3,537 prompt tokens; the mean is 10,064 because a handful
run to 261,471. The five most expensive captures all staged this benchmark's own
committed output — result JSONL, runner logs, agent transcripts — which is
machine-generated text that a harvest prompt then re-renders in full. **A
repository's break-even is a function of what it commits**, and the mean is the
wrong number to carry away from this table.

Verification's zero is a measurement: 14 built modules reachable from
`dist/core/capture-verify.js` and `dist/core/harvest-verify.js` were scanned and
0 carried a network client.

### 9.2 The read side, per read

| Route | Budget | Tokens per read | Path recall |
|---|---:|---:|---:|
| `code-only` | — | 0.0 | 0.0% |
| `git-log-path-budgeted` | 800 | 643.5 | 42.0% |
| `git-log-path` | none | 1,292.0 | 94.4% |
| `every-record-budgeted` | 800 | 749.0 | 2.2% |
| `every-record-unbudgeted` | none | 88,122.0 | 92.3% |
| **`commitlore`** | 800 | **488.9** | 81.7% |
| `commitlore-unbudgeted` | none | 708.8 | 92.3% |

### 9.3 Token reduction, with the denominator on every line

| Subject | Denominator | Reduction | Ratio | Recall, subject / denominator |
|---|---|---:|---:|---:|
| `commitlore` | `git-log-path-budgeted` | **24.0%** | 1.3× | 81.7% / 42.0% |
| `commitlore` | `git-log-path` | 62.2% | 2.6× | 81.7% / **94.4%** |
| `commitlore` | `every-record-unbudgeted` | 99.4% | 180.2× | 81.7% / 92.3% |
| **`commitlore-unbudgeted`** | **`every-record-unbudgeted`** | **99.2%** | **124.3×** | **92.3% / 92.3%** |
| `commitlore` | `code-only` | **undefined** | — | 81.7% / 0.0% |

**The defensible headline is the fourth row, and it is 99.2%.** Both sides are
the same projection with the budget removed, both recovered 2,047 of the 2,217
gold pairs, and the scoped one spends 708.8 tokens per read against 88,122.0.
That is the reduction attributable to path scoping with recovery held equal —
equal in *count*; the delivery row records counts and not sets, so it is not a
claim that the same records came back.

The first row is the one an agent actually faces: at the same 800-token budget
the shipped route spends **24.0% fewer tokens and recovers 39.7 points more**.
Cheaper and better is not a trade-off and needs no denominator argument.

The second row is a trade and is published as one: against an unbounded
`git log` the projection is 62.2% cheaper and **12.7 points worse**.

The last row has no number and that is the finding. Against an agent that reads
no history, CommitLore's read side is a *cost* of 488.9 tokens per read, and a
percentage reduction cannot be computed against zero. What it buys there is
81.7% of the active decision set against 0%.

### 9.4 Break-even

| Comparator | Saving per read | Break-even reads, with diff / scaffold only | Full passes |
|---|---:|---:|---:|
| `code-only` | −488.9 | **none exists** | — |
| `git-log-path-budgeted` | 154.6 | **≥ 22,326** / ≥ 2,656 | 21.3 / 2.5 |
| `git-log-path` | 803.0 | ≥ 4,299 / ≥ 511 | 4.1 / 0.5 |
| `every-record-budgeted` | 260.1 | ≥ 13,272 / ≥ 1,579 | 12.7 / 1.5 |
| `every-record-unbudgeted` | 87,633.1 | **≥ 39** / ≥ 5 | 0.0 / 0.0 |
| `commitlore-unbudgeted` | 219.9 | ≥ 15,697 / ≥ 1,867 | 15.0 / 1.8 |

**The break-even that can be stated, in one sentence with its assumptions on the
face of it:** against an agent that runs `git log -- <path>` and truncates it to
the same 800 tokens, this repository's 343 captures pay for themselves after
**at least 22,326 path-scoped reads** — 21.3 passes over all 1,046 evaluated
paths — if the staged diff is charged as fresh prompt input, or **at least
2,656** if it is charged at nothing. Every one of those is a floor: the session
transcript and the model's drafting output are both omitted and both
non-negative, so the true figure is larger.

Two readings follow and they point opposite ways:

- **Against a naive whole-repository dump, break-even arrives almost
  immediately — 39 reads.** That is a real number about an unreal baseline: no
  agent has 92 million tokens of context, so the route it beats is one nobody
  runs.
- **Against the realistic comparator it is 22,326 reads**, and whether a
  repository reaches that depends on how much editing it sees, which this
  measurement does not know and does not guess.

What does not depend on that guess is the shape of the two columns. At the same
budget the token saving is **154.6 per read** and the recall difference is
**39.7 points**. One of those is small and the other is not. So on this corpus
**the case for CommitLore rests on recall rather than on tokens**, and the
token-reduction percentage — the figure this market runs on — is the weaker half
of the answer. This measurement was run to find out which, and that is what it
found.

`code-only` has no break-even at any read count and never will: a comparator
that spends nothing offers nothing to amortize against.

Two rows in that table are not routes anyone would choose and are there for
completeness. `every-record-budgeted` costs more and recovers 2.2%, so a
break-even against it prices the shipped route against a strictly worse option.
`commitlore-unbudgeted` is not an alternative at all — it is the shipped route
with the cap removed — and its row reads as what the 800-token cap buys: 219.9
tokens per read saved, at the cost of the 10.6 recall points
`bench/DECISION-DELIVERY.md` §9.3 attributes to the cap.

### 9.5 What this run does not establish

Everything in §5 and §7 holds. Four points bear repeating beside the number:

- **The write side is a floor, not a cost.** Two of four terms are missing and
  both are non-negative. A mean of 10,064 tokens per capture is a lower bound on
  the mean, not the price of writing a record.
- **The drafting turn is still unmeasured and the blocker is named.** §5,
  blocker B, as amended by §5.1: the attribution instrument now exists, the
  model call has still not been made, and no figure here is evidence about it.
- **One corpus, one repository, and the write side is dominated by what that
  repository commits.** Its mean capture is 3.8× its median because a few
  commits staged this benchmark's own machine-generated output. Another
  repository's ledger will differ by more than a little.
- **Break-even in reads assumes reads are distributed like the delivery run's
  per-path average.** Real editing concentrates on a few files. This is the
  limit in §7 and it applies to every figure in §9.4.
