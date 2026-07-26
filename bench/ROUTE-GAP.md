# The route gap — what M1 actually measured

Written after `bench/VERDICT-M1.md`, from the same 60 recorded runs. No new
model calls: everything here is a replay of transcripts already on disk.

The M1 verdict says the measurement came back unable to answer, and blames the
task set and the sample size. Both are true. Neither is the largest problem.

---

## 1. The benchmark measured a route the spec does not assign

SPEC §5 assigns each key to exactly one consumer route:

| Key | Route | Behaviour |
|---|---|---|
| `Limit:` | path-scoped injection | surfaced before an agent edits the path |
| `Warn:` | graded injection | instruction when trusted, claim when not |
| **`Ruled-out:`** | **`commitlore guard`** | **blocks re-proposal *before execution*** |

The hypothesis under test is about `Ruled-out:`. The harness delivered it as
**injected context** — the route belonging to `Limit:` and `Warn:` — and
`guard` is never referenced anywhere in `bench/`.

`src/core/guard.ts` opened by claiming the opposite: *"AnnalsBench (T-702)
measures the re-proposal rate this route suppresses."* It did not. That comment
has been corrected, and it also carried a project name the rename missed —
which ADR-0009 predicted, having warned that a word-boundary regex would skip
compound words like `AnnalsBench`.

## 2. Injection was delivered correctly, and ignored

This is not an instrument failure. Every treatment run received a rendered,
imperative block. All 30 carried one; none was null; the control arm carried
none. A representative payload:

```
### Ruled out — do not re-propose without new evidence
- RabbitMQ — a publish cannot join the caller's Postgres transaction, so a
  rolled-back request would still leave a live job [r-8c33f7]
- SQS — same transactional objection, plus at-least-once delivery pushes the
  dedupe problem into every handler [r-8c33f7]
```

**Four of the five treatment-arm re-proposals implemented something named in
that list.** The agent read "RabbitMQ — do not re-propose without new evidence"
and added RabbitMQ. Same for Prisma, same for sigstore.

So the finding is sharper than "no significant difference". Advisory context,
delivered clearly and read demonstrably, does not reliably bind the agent.
Compliance moved from 23/30 in the control to 25/30 in the treatment. That is
the whole effect, and it is why n=30 could not resolve it.

## 3. Replaying the same runs through `guard`

Each task's synthetic repository was rebuilt from its fixture and the agent's
own recorded output was fed to `commitlore guard`. Threshold 0.35, the shipped
default.

| surface fed to guard | caught | missed | false alarms | correct silence |
|---|---|---|---|---|
| commit messages / prose | 3 / 5 | 2 | **9 / 25** | 16 |
| diff | 3 / 5 | 2 | 5 / 25 | 20 |

Against injection's 0 of 5, guard would have stopped three of the five
re-proposals **before execution**. That is the case for the route.

The case against it is the false-alarm column, and the prose row is worse than
it looks. `reproposal-jwt-sessions` seed 1 was flagged because the agent wrote:

> *Stateless JWTs are ruled out (no revocation path)*

It complied, said so, and got flagged for saying so. This is exactly the
failure `bench/README.md` designed the detectors to avoid — "a transcript
matcher scores a refusal as a re-proposal" — and it is **biased toward the
treatment arm**, because only that arm is told the alternative's name and so
only that arm can quote it.

Feeding guard the diff instead of the prose halves the false alarms and makes
every true positive an actual implementation. On a PreToolUse hook, one blocked
edit in five that should not have been blocked is still a rate that gets the
hook uninstalled.

An earlier tuning pass reported 0 false positives in 10 on curated proposals.
On real agent output it is 5 in 25. Curated proposals were the optimistic case.

## 4. What follows

- The M1 result stands exactly as written. Nothing here changes p = 0.7480.
- It should not be read as evidence about `Ruled-out:`, because the key was
  delivered through a route the spec assigns to other keys.
- Re-running the same design at 400–800 runs per arm would spend 20–40 hours
  buying precision on a lever there is now direct evidence is weak.
- The unmeasured route is the one the product's claim rests on, and a
  zero-API replay already shows it behaving differently. That is the next
  experiment (#37), not a larger version of this one.

**None of this is a reason to withhold v0.1.0.** The protocol, the CLI, the
conformance suite and the guard all work as specified. What has not been
demonstrated is the size of the benefit, and saying so plainly is the version
of this project worth publishing.
