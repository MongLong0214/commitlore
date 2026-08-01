# The token ledger: what a record costs to write, what it saves to read

- Status: **registered 2026-08-01, before any run of this measurement**;
  amended the same day by the history-ref deviation recorded in §3, before the
  run that reports it
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
Section 11 of the deterministic report still carries the re-proposal threshold
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
transcript into the prompt. For the 300-odd records already in this repository
the sessions that produced them were never retained, so the term cannot be
recovered retrospectively at any price. It is not merely unmeasured; it is
unrecoverable for this corpus. Measuring it forward requires recording the
transcript length at capture time, which the product does not do and which this
measurement does not add.

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
offers *that* reader is 81.7% of the active decision set against 0%, which is a
recall argument, not a token argument.

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

*Empty at registration. Filled from the generated file named here, and from
nothing else.*
