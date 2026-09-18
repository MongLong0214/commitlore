# Automatic capture with a classifier: what was measured, and why it was dropped

Issues #1044–#1051 specified an optional producer that would read a session
transcript at commit time, ask the TypeSafe "Jev" classifier which passages are
a `Limit:`, `Warn:` or `Ruled-out:`, and copy the chosen passages **verbatim**
into the commit's trailers — so that a decision record appeared without anyone
running a capture command.

It was built, it works end to end against the live endpoint, and it produces
essentially no records. This document is why, and what the measurements say
about any future attempt at the same thing.

Everything here was run live against `api.typesafe.ai` on **2026-09-18**, model
`jev-1.13.0`, except §5 which needs no model at all.

---

## 1. The wire contract holds

Four synthetic cases with references written before the run: an explicit vendor
constraint, routine narration, a real constraint about something else, and the
same constraint in Korean. **4/4 answered, 4/4 agreed**, confidences ~0.96.
5,358 input tokens, ~$0.000225.

So the request shape, the answer validation, the assembly and the trailer values
all work. **This is not an accuracy measurement** — four cases written by the
same party that wrote the code cannot be one, and every case was authored to be
explicit.

## 2. End to end through a real commit

One `git commit` in a temporary repository, with the installed hook, the real
producer, a real network call, native verification and native staging:

```
Lower the retry ceiling

Ordinary prose with no trailers and no instruction to record anything.

Limit: The payment vendor caps us at three retries per minute on the settlement
  endpoint, so we cannot raise the ceiling past three no matter how the backoff
  is tuned.
Record-Id: r-0fdc7fef9c33
Provenance: drafted
```

A fresh keyless process retrieved it with `commitlore limits`. Commit wall clock
**1.37 s** against **0.65 s** disabled, on 2,395 input tokens.

One deviation, stated: the session was a bridge/child session, so
`CLAUDE_CODE_CHILD_SESSION` was set and the adapter refuses that by design. That
variable was cleared for the measurement. Everything else is the real path.

## 3. On real commits it produces nothing

Each case is a real commit from this repository. The prose body is the source;
the trailers the author wrote at the time are the reference, so the labels
predate the outputs by years of commits.

**29 commits that recorded a `Limit:`, `Warn:` or `Ruled-out:`:**

| stage | commits |
|---|---|
| at least one candidate the model called a decision | 15 / 29 |
| `kind` also at or above the 0.90 floor | 5 / 29 — all five `ruled_out` |
| `relevance` also at or above the floor | 2 / 29 |
| both span answers also at or above the floor | 0 / 29 |
| **records produced** | **0 / 29** |

15 commits with no record produced none. That figure carries no information: a
classifier that always says "no" scores the same.

44 requests, 353,970 input tokens, ~$0.0149.

## 4. On real conversation, and four question shapes

§3 runs on commit prose, which is distilled writing. The real input is a
transcript. **Six windows of a real session, 55 judgements:** `none` 49,
`ruled_out` 6, **`limit` 0, `warn` 0**. Nothing at or above 0.90. Records: 0.

Combined with §3, **`limit` and `warn` were chosen zero times in 257
judgements.** Three alternative shapes on the same windows:

| arm | shape | `limit` | ≥ 0.90 | median |
|---|---|---|---|---|
| A | the questions as #1047 specifies them | 0 | 0 | 0.73 |
| B | definitions only in `criteria`; the candidate text inline | 1 | 1 | 0.64 |
| C | one selector over all candidates plus `none` | — | 1 of 6 | 0.41 |

Arm B removes a documented failure mode (jev-1.13 lists "contradictory
instructions", and the specified instruction defines the taxonomy a second time
on top of `criteria`). The improvement is real and small.

Arm C is worse where it matters: it picked a passage in **6 of 6** windows,
never `none`, and the passages it picked were status reports. A selector that
always selects is a false-positive machine, whatever it costs.

### The confidence asymmetry

Split by what the answer was, over 239 answers:

| answer | n | median confidence | ≥ 0.90 |
|---|---|---|---|
| `kind = none` — "not a decision" | 46 | **0.93** | 28 |
| `kind = a decision` | 13 | **0.65** | 2 |
| `relevance` | 60 | 0.99 | 55 |
| span selection | 120 | 0.85 | 54 |

**The model is confident saying no and unconfident saying yes.** It held across
every framing tried. `probabilities[choice]` tracks `confidence` within 0.02, so
this is not a matter of reading the wrong field.

## 5. The ceiling, measured with no model — the root cause

The design copies a passage **verbatim**, so a record is reachable only if the
author's words already exist as a passage of the source. `bench/jev-ceiling.mjs`
measures that over this repository's own records. No network, no key, no cost.

**121 reference trailers from 27 commits:**

| unit compared against | median overlap | ≥ 0.60 | ≥ 0.80 |
|---|---|---|---|
| best sentence | 0.20 | 1 / 121 | **0 / 121** |
| best paragraph | 0.29 | 2 / 121 | **0 / 121** |
| the entire prose body, as one unit | 0.44 | 17 / 121 | **2 / 121** |

By key at the 0.60 bar: `Limit` 0/41, `Warn` 0/36, `Ruled-out` 1/44.

The last row is the generous bound — every word the author wrote, scored as
though the model could select all of it at once. Two records in 121 survive it.

### What this explains

**A decision record is written, not quoted.** An author reads a conversation and
*synthesises* a `Limit:`; they do not lift a sentence out of it.

- 0 of 29 in §3 is largely "the answer was not in the input".
- `limit` and `warn` chosen 0 times in 257 judgements is the model being
  **right**: those passages are not limits stated verbatim, and it said so.
- No prompt shape, threshold, field or model lifts a 1% ceiling. Arms A, B and C
  were all measuring beneath it.

### Where the ceiling came from

```
native      trailer value = written by the agent    evidence.quote = verbatim
this        trailer value = the verbatim passage    evidence.quote = the same passage
```

`harvest-verify.ts` checks that the **quote** appears in the source. It has
never required the **value** to be a quote. ADR #1045 D3 says "Limit/Warn copy
the complete source passage", and implementing that faithfully is what caps this
at one per cent. The constraint exists for a good reason — a model writing
trailer values is a model authoring history — and the measurement says the
constraint and the goal are incompatible:

| | |
|---|---|
| Jev + verbatim values | **~1% reachable** |
| Jev + written values | impossible — jev-1.13 documents "not trained for generation" |
| an agent + written values + verbatim evidence | **what already ships, and works** |

## 6. Three other roles, all measured, all weak

**As a judge of an already-written draft.** One clean statement per question.
Positives: 40 real trailer values from this repository. Negatives: 40 real
assistant passages matching a narration pattern, selected with no model.

| class | judged "worth keeping" | at ≥ 0.90 | median |
|---|---|---|---|
| real records (40) | 26 (65%) | 1 | 0.38 |
| real narration (40) | 4 (10%) | 0 | 0.88 |

It separates the two populations, and at the 0.90 floor it keeps **3%** of real
records. As a gate it is unusable.

**As a suppressor of narration**, using the confident-negative direction: at
0.90 it removes 18 of 40 narration items and **destroys 3 of 40 real records**.
Precision of "not a record" is 72% at 0.5 and 86% at 0.90. Losing 7.5% of real
records permanently to remove noise the agent would not have drafted is a bad
trade.

**As a delivery relevance filter** — the only role that is not about capture.
Delivery discards 82% to 97% of a path's records on every edit (measured:
93/102, 187/214, 338/349, 127/154), cut by `(kind, recency)` with no relevance
judgement anywhere. Each request mixed records belonging to the changed file
with records from an unrelated file:

| | kept as relevant | median confidence |
|---|---|---|
| records from the changed file (24) | **6 (25%)** | 0.84 |
| records from an unrelated file (25) | **1 (4%)** | 0.99 |

It said `unrelated` in **42 of 49** answers, so the "everything is relevant"
worry was wrong, and it discriminates about six to one. It is also a harsh
filter: it drops three quarters of the records belonging to the file being
edited. **This is the one role still worth pursuing**, on 49 answers, and the
number that matters — whether the records it keeps are the ones a human would
keep — is not measured.

## 7. What was decided

The capture producer, its dispatcher, the SessionStart source adapter and the
commit-msg gate change were **removed**. Nothing in the shipped tree references
a classifier; `dist/commitlore.mjs` contains no reference to `COMMITLORE_JEV` or
to the provider, and the installed hook stub is byte-identical to the one before
this work.

What remains is this document, `bench/jev-ceiling.mjs`, `bench/jev-relevance.ts`
and the modules the latter needs, plus a sanitized fixture of a real host
transcript format. `jev-ceiling.mjs` is the useful artefact: **it tests any
future auto-capture proposal for the same ceiling, without a model and without a
key.** Run it first.

### The real gap, and what actually closes it

`commitlore auto status` states the gap in its own words:

> unattended start: an agent host must initiate capture; init installs no
> initiator — ordinary git commits only apply a staged transaction

With `mode: auto` and `unattended: true`, the most permissive settings the
product has, a plain `git commit` records nothing. Measured over the last 400
commits of this repository: 249 substantive source commits, **204 carry a record
(82%) and 45 do not**.

So the gap is not capability — the agent writes records well and 204 of them
prove it — it is that **nothing starts the flow**. That is a compliance problem,
and no classifier fixes it. What does:

1. One tool that commits, collapsing prepare → verify → stage → commit, with
   "considered, nothing found" as a first-class exit that still leaves a binding
   for the staged tree.
2. A `PreToolUse` hook on `Bash` matching `git commit` that denies unless that
   binding exists — the same hook class delivery already uses.
3. A mechanical bypass for trivial commits: diffstat, paths, message pattern. No
   model call.

And one constraint that decides whether this helps or hurts: **enforce that the
flow ran, never that a record exists.** Enforcing production produces invented
`Limit:` lines under pressure, and a wrong record is permanent. This repository's
own notes already record three records that turned out to be false.

## Limitations

- **§3's input is commit prose**, which is distilled writing by an author who
  had already decided to record something. It is not representative of a
  transcript, and which direction the difference cuts is unknown.
- **§3's reference is "this commit recorded a decision"**, not "this passage is
  that record", so the per-commit funnel is the fair reading and no per-passage
  precision figure is available.
- **§4's windows are unlabelled.** The `none` share is not a false-negative rate.
- **§5's metric is lexical.** It ignores word order and takes the best unit
  rather than requiring a match, which flatters the score. A record paraphrased
  with different words is unreachable by a *verbatim* selector either way, so the
  direction is right for the question asked.
- **§6's positives are labelled "somebody recorded this"**, not "this was worth
  recording", so a rejected positive may be the judge being right. The negatives
  are narration, not *false* records — the plausible-and-wrong class, which is
  the one that matters, has no measurement here.
- **§6's relevance ground truth is a proxy**: a record's own path is the path its
  commit changed, and a record can legitimately bear on another file. The
  contrast is the finding, not either side alone.
- **One repository, one project's style, one annotator**, and the reference
  author is plausibly the same agent whose transcripts are the input.
- Costs are estimates from a dated price ($0.042 per 1e6 input tokens,
  documentation read 2026-09-18), not invoices.

## Running what is left

Both harnesses send real repository content to a third party and spend money.
Neither is wired into a build; both are run deliberately.

```sh
npm run bench:jev-ceiling                        # no key, no network, no cost
COMMITLORE_JEV_API_KEY=... npm run bench:jev-relevance -- --n 6
```

## What is not claimed

No accuracy rate for real conversations, no recall rate, no token or rework
saving, and no statement that a classifier is worthless — only that in four
roles, measured, three are dead and one is unproven.
