# Optional Jev prototype — measured behaviour

Everything here was produced by `bench/jev-live.mjs` and `bench/jev-accuracy.mjs`
against the live `api.typesafe.ai` endpoint on **2026-09-18**, model
`jev-1.13.0`. Both are explicitly-run harnesses with declared request budgets;
neither runs in CI and neither is required by any build.

Read the limitations section before quoting any number here.

## 1. The wire contract holds live

Four synthetic cases, written into `bench/jev-live.mjs` with their reference
answers **before** the run.

| case | expected | produced | |
|---|---|---|---|
| explicit vendor constraint | a record | a record | agrees |
| routine narration | nothing | nothing | agrees (`kind-none`) |
| real constraint, unrelated change | nothing | nothing | agrees (`low-confidence`) |
| the same constraint in Korean | a record | a record | agrees |

4/4 answered, 4/4 agreed. 5,358 input tokens, **~$0.000225** estimated.

This establishes that the request shape, the answer validation, the assembly and
the trailer values work end to end against the real provider. **It is not an
accuracy measurement.** Four cases written by the same party that wrote the code
cannot be one.

## 2. End to end through a real commit

One `git commit` in a temporary repository, with the installed hook, the real
dispatcher, the real producer, a real network call, native verification and
native staging:

```
Lower the retry ceiling

Ordinary prose with no trailers and no instruction to record anything.

Limit: The payment vendor caps us at three retries per minute on the settlement
  endpoint, so we cannot raise the ceiling past three no matter how the backoff
  is tuned.
Record-Id: r-0fdc7fef9c33
Provenance: drafted
```

A fresh keyless process then retrieved it with `commitlore limits`. Commit wall
clock **1.37 s** against **0.65 s** with the prototype disabled, on 2,395 input
tokens (~$0.0001).

**One deviation, stated:** the session driving it was a bridge/child session, so
`CLAUDE_CODE_CHILD_SESSION` was set and the adapter refuses that by design. That
variable was cleared for the measurement. Everything else — session id
propagation, the descriptor, the transcript read, the hook, the network call —
is the real path. Whether an ordinary root session leaves that variable unset has
**not** been confirmed, and until it is, the adapter may refuse to activate more
often than intended. One check in a normal session settles it.

## 3. Accuracy on real commits, and where recall goes

`bench/jev-accuracy.mjs`. Each case is a real commit from this repository. The
**prose body** is the source; the **trailers the commit carries** are the
reference — written by the author at the time, long before this prototype
existed, so the labels genuinely predate the outputs. Sampling is the most recent
commits of each class in `git log` order, declared before the run, with no
selection by content.

**29 commits that recorded a `Limit:`, `Warn:` or `Ruled-out:`** (median 8
candidate passages each):

| stage | commits |
|---|---|
| at least one candidate the model called a decision | **15 / 29** |
| `kind` also at or above the 0.90 floor | **5 / 29** — all five `ruled_out` |
| `relevance` also at or above the floor | **2 / 29** |
| both span answers also at or above the floor | **0 / 29** |
| **records produced** | **0 / 29** |

**15 commits that recorded nothing:** 0 produced a record. No false positives
(95% Wilson 0.0–20.4%).

Best-confidence-per-commit across the 29: median **0.24**, p75 **0.79**, max
**0.98**.

44 requests, 353,970 input tokens, **~$0.0149** estimated.

### What that says

**The conjunction is the binding constraint, not the model's judgement.** A
`Ruled-out` needs four independent answers at or above 0.90 — `kind`,
`relevance`, `alternative` and `reason`. The two commits that cleared the first
two gates were then stopped by the span answers. A `Limit` or `Warn` needs only
two, and the model chose `ruled_out` in every above-floor case.

**The 0.90 floor is doing most of the work.** It is documented as an
uncalibrated policy rather than a truth rate, and this is what that costs on this
input: 15 commits had an agreeing answer and 5 survived the floor.

**State size is a minor factor.** Running the same ten commits with the diff
excerpt removed moved the median agreeing confidence from 0.47 to 0.56 and the
agreement rate from 13 to 14 per 100 answers. jev-1.13's documented "large
irrelevant state" failure mode is visible but is not the cause.

**Nothing here was tuned.** The floor was not adjusted after seeing these
numbers, and the sample was not re-drawn. Doing either would make the figure a
description of the tuning rather than of the prototype.

## Limitations

- **Commit prose is not a conversation.** It is distilled writing by an author
  who had already decided to record something. A transcript is longer, noisier
  and mostly about something else. This measurement is therefore **not**
  representative of the input the prototype actually receives, and it is
  unclear in which direction the difference cuts.
- **The reference is "the commit recorded one", not "this passage is that
  record".** A commit's prose holds many sentences and only some correspond to
  its trailer, so "produced a record" is the fair per-commit question and
  per-candidate agreement is not a recall figure.
- **Relevance has no hard negatives.** A commit's record applies to its own
  change by construction.
- **One repository, one project's style, labels from that repository.** Nothing
  here generalises to another codebase, and no second annotator reviewed
  anything.
- **The live host observation is one session**, with the deviation noted in §2.
- Every figure is an estimate from a dated price ($0.042 per 1e6 input tokens,
  documentation read 2026-09-18) and is not an invoice.

## What is not claimed

No accuracy rate, no recall rate for real conversations, no token or rework
savings, and no statement that enabling the prototype is worthwhile. The
measurement that would support any of those has not been run.
