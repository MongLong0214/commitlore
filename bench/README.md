# CommitLoreBench

Measures the one thing that decides whether CommitLore is worth building: does an
agent that can see recorded decisions stop re-proposing the approaches a team
already rejected?

- Design: `docs/adr/ADR-0007-commitlorebench.md`
- Requirements: `docs/prd/PRD-F7-commitlorebench.md`
- This directory implements **T-701** (harness skeleton). T-702 adds the tasks
  and the significance test, T-703 the ablation arms, T-704 the report.

## Running it

Node 22.6+ runs the TypeScript directly (verified on v24.18.0):

```bash
node bench/runner.ts --tasks bench/tasks --cond both --seed 1 \
  --driver dry-run --out bench/results/smoke.jsonl
node bench/verify.mjs bench/results/smoke.jsonl     # schema gate
node bench/metrics.ts bench/results/smoke.jsonl     # aggregate
```

On older Node, or if type stripping is disabled, build first — both paths are
verified:

```bash
npx tsc -p bench/tsconfig.json          # emits bench/dist/
node bench/dist/runner.js --cond both --seed 1 --driver dry-run --out out.jsonl
node bench/dist/metrics.js out.jsonl
```

Type check without emitting: `npx tsc -p bench/tsconfig.json --noEmit`.
The root `tsconfig.json` excludes `bench/`, so this directory has its own.

### Runner options

| Flag | Meaning |
|---|---|
| `--tasks <dir>` | task directory (default `bench/tasks`) |
| `--task <ids>` | comma-separated task ids; default is all |
| `--cond <list>` | `both`, `all`, or a comma-separated list |
| `--seed <list>` | comma-separated integers, e.g. `--seed 1,2,3` |
| `--driver <name>` | `dry-run` or `claude-headless` |
| `--out <file>` | JSONL path (default `bench/results/<run-id>.jsonl`) |
| `--max-tokens <n>` | global token cap for the whole invocation |
| `--max-turns <n>` | override every task's turn budget |
| `--timeout-ms <n>` | per-run wall clock (default 600000) |
| `--keep` | keep the temporary workspaces and print their paths |
| `--save-transcripts <dir>` | write each run's transcript, diff, commits and injected context |

Use `--save-transcripts` whenever a number will be quoted anywhere. A detector
verdict nobody can re-read is a verdict nobody can challenge.

## Conditions

Conditions are an open string enum, so M4 adds arms without touching the runner.

| Condition | Status | Records in history | Injected |
|---|---|---|---|
| `commitlore-on` | supported | yes | yes, route-scoped, lifecycle + grading applied |
| `commitlore-off` | supported | **no** | no |
| `records-uninjected` | planned | yes | no |
| `no-scope` / `no-grade` / `no-lifecycle` | planned (T-703) | yes | yes, one guarantee removed |

Planned arms are rejected at CLI parse time with a pointer to their ticket.

### Why the control arm has no records in history

The obvious control — same repository, injection withheld — does not work. In a
live run, the `commitlore-off` agent ran `git log` on its own and quoted the
trailers back:

> The commit that introduced this (`44f5c0d`) is not an accident — it records the
> decision and pre-rejects the obvious fixes: **`Ruled-out: shared Redis cache`** …

A control that contains the treatment measures nothing. So `commitlore-off`
seeds the same files and the same commit subjects and prose, with the trailer
block stripped — the repository of a team that never wrote records. Stripping
uses git's own notion of a trailer block (SPEC §2.1 B1/B2), and the workspace
refuses to start if a control arm still carries a `Record-Id`.

This leaves a real question for ADR-0007: `commitlore-on` differs from the
control both by having records in history *and* by injection. `records-uninjected`
would separate the two. It is registered as `planned` pending that decision.

## Detection surfaces

Every matcher runs against one of `transcript`, `diff`, `commits`, `artifacts`
(diff + commits) or `any`. **Re-proposal detection must use `artifacts`.**

A live `commitlore-on` run produced this, with a diff containing no mention of
either rejected option:

> **Redis** and **memcached** are both on the ruled-out list — ops won't take
> another stateful dependency for v1.

A literal matcher over the transcript scored that refusal as a re-proposal. The
error is not symmetric: injecting records is what makes an agent *name* the thing
it is declining, so the false positives land almost entirely in the treatment
arm and push the measured effect toward zero — the result that, per ADR-0007,
triggers an owner escalation and a change of project direction.

Matching on what the agent actually built is unambiguous. The cost is that a run
which proposes a rejected approach in prose and stops before writing code scores
as no re-proposal. Closing that gap — negation-aware matching, or a judge — is
T-702's calibration problem, and the saved transcripts are the input for it.

## Task files

```yaml
id: reproposal-redis-cache          # kebab-case, also the filename
description: ...
repo:
  kind: synthetic                   # synthetic | fixture
  seed_commits:                     # applied in order, one commit each
    - files: { "src/cache.ts": "..." }
      message: |
        Subject line

        Body prose.

        Ruled-out: shared Redis cache | ops refuses another stateful
          dependency for a v1
        Record-Id: r-7c1a45
        CommitLore-Version: 2.0.0
prompt: |
  The task the agent is given. It must not name the rejected approach.
detect:
  reproposed_if:
    any_of:                         # `all_of` is also supported; both AND together
      - kind: literal               # normalized: NFKC, lowercased, whitespace collapsed
        value: redis
        in: artifacts
      - kind: regex                 # `flags` defaults to "i"
        value: "\\bioredis\\b"
        in: artifacts
        label: regex:cache-client   # appears in the row's `matched[]`
  violation_if:
    any_of: []                      # empty means "no violation defined"
budget:
  turns: 12
  tokens: 60000
```

`kind: fixture` copies a repo-relative directory into the workspace before the
seed commits are applied. Unknown keys are rejected, regexes are compiled at load
time, and after seeding every commit message is parsed back through
`git interpret-trailers --parse`: a record broken by YAML indentation fails the
run instead of quietly weakening the treatment arm.

Task ids name the rejected approach, so nothing that reaches a detection surface
may echo the id. The dry-run driver hashes it for exactly this reason.

### The ten tasks

PRD-F7 requires at least ten "re-encounter a decision point that has a rejection
history" scenarios, split between this repository's own decisions and the kind of
choice any public repository makes. Five and five:

| Task | Decision re-encountered | Rejected in the seeded history |
|---|---|---|
| `reproposal-redis-cache` | caching strategy | shared Redis cache, memcached sidecar |
| `reproposal-prisma-orm` | ORM choice | Prisma, TypeORM |
| `reproposal-jwt-sessions` | auth mechanism | stateless JWT, refresh tokens in local storage |
| `reproposal-winston-logger` | logging | winston, pino |
| `reproposal-rabbitmq-queue` | queueing | RabbitMQ, SQS, BullMQ |
| `reproposal-index-server` | ADR-0003 — git is the SSOT | a shared database, a lookup service |
| `reproposal-llm-projection` | ADR-0006 — deterministic projection | model-generated summaries, embedding retrieval |
| `reproposal-static-global-context` | ADR-0006 — path-scoped injection | a checked-in repository-wide context file |
| `reproposal-sigstore-signing` | ADR-0005 — rule-based trust grading | sigstore keyless signing, required signed commits |
| `reproposal-node20-floor` | ADR-0010 — runtime floor | keeping the EOL floor, dropping `engines` |

Each prompt describes only the symptom. None of them names the rejected approach:
a prompt that did would be measuring reading comprehension.

### Calibrating a detector before it is allowed to score anything

A detector that fires on the correct solution manufactures re-proposals, and one
that never fires manufactures the absence of them. Both are checked, in both
directions, before a task is run:

- **negative** — the fix a competent agent that respected the records would write
  must *not* match `reproposed_if`;
- **positive** — a genuine re-proposal must match it.

The check builds a real workspace per task, applies a reference solution, and runs
the task's own matchers over the real `git diff`, so `^diff --git` and removed-line
(`^-`) patterns are exercised as they will be in a run. All ten tasks passed both
directions before the measurement was started.

**This check is not yet a committed test.** T-702 ran it as a one-off harness and
recorded its conclusions where they are load-bearing — each task's YAML carries a
comment naming what the reference correct solution contains and which matchers
were deliberately *not* used because they would have flagged it. That is enough to
audit a verdict but not enough to stop a detector from rotting: a matcher tightened
later, or a new task added by someone who has not read this section, gets no
mechanical objection. Promoting it to a committed test is listed under
*Still open*.

### Noise immunity

Not everything in the diff is the agent's decision. Two noise sources are real
and both were caught firing:

- **Agent tooling writes into the workspace.** Every live run so far has
  `.serena/.gitignore` and `.serena/project.yml` in its diff, in *both* arms —
  about 10KB of YAML whose comments carry documentation URLs.
- **Unified-diff scaffolding.** `--- a/scripts/check-engines.mjs` begins with a
  `-` and contains the filename, so a matcher written as "a line starting with
  `-` mentioning check-engines" — meaning *this line was deleted* — fires on the
  agent merely **touching** the file. That is the opposite of what it was
  measuring.

So a second check runs every matcher against noise alone — the real `.serena`
hunks harvested from saved transcripts, and synthetic scaffolding (header,
`--- a/`, `+++ b/`, new-file and deleted-file forms) for every path each task
seeds. **Nothing may fire.** Three clauses did, and were fixed:
`network-in-injection-path` and `network-in-grading-path` dropped bare
`https?://` for call-shaped signatures only, and `enforcement-removed` gained a
`(?!--)` lookahead.

Worth being plain about the order this happened in: the correct-solution check
above ran and passed *before* the measurement started, and it did not catch any
of these three. It could not have. A reference solution exercises the matchers
against one plausible diff; it says nothing about text the agent did not write,
and the `---` header collision only appears when the correct solution happens to
touch that exact file — which the reference one did not. **Checking a detector
against the right answer is not the same as checking it against noise, and only
the second one catches a matcher that fires on nothing at all.** The noise check
was written after the run had begun, from auditing `matched[]` on the early rows.

All three were `violation_if` clauses. **No `reproposed_if` clause fired on
either noise source, for any of the ten tasks** — the primary metric was never
exposed to this.

### Matchers rejected during calibration

Three matchers were rejected for flagging correct behaviour:

- `createLogger(` in `reproposal-winston-logger` — a hand-rolled logger is a
  perfectly ordinary place to name a factory `createLogger`.
- an `authorization` violation clause in the same task — the honest fix for
  "never log the Authorization header" is redaction code, which necessarily
  contains the word.
- `^-.*index\.db` in `reproposal-index-server` — this one actually fired on the
  correct solution during calibration, because rewriting `src/core/index-db.ts`
  puts its own `.../commitlore/index.db` string on a removed diff line. It is now
  anchored to the whole `.gitignore` entry.

`reproposal-static-global-context` matches on the *creation of the file*
(`^diff --git a/CLAUDE.md`) rather than on the filename appearing in text. This is
the same rule as *Detection surfaces* above, one level down: naming a rejected
option is not proposing it, and a filename is unusually easy to name while
declining it. The identical matcher scores both arms.

## Isolation, stopping and reproducibility

- **Workspace** — one `git init` per (task, condition, seed) under
  `os.tmpdir()`, named with the pid and random bytes. Removed afterwards unless
  `--keep`; the remover refuses any path it did not create. Seeding runs with
  `GIT_CONFIG_GLOBAL=/dev/null` and fixed author dates, so a seed produces
  byte-identical commit SHAs on any machine. Paths from YAML are resolved and
  rejected if they escape the workspace.
- **Double stop, and an honest label for it** — a per-task turn cap
  (`budget.turns`) and a global token cap (`--max-tokens`) across the whole
  invocation. `stopped_by` distinguishes what was *enforced* from what was only
  *observed*, because the two are not the same and reading them as the same
  corrupts the numbers:

  | `stopped_by` | Meaning |
  |---|---|
  | `completed` | finished within every budget |
  | `timeout` | wall clock elapsed and the harness killed the process — **enforced** |
  | `over-turns` | finished on its own having exceeded `budget.turns` — **observed** |
  | `over-tokens` | global token cap exhausted — enforced between runs |
  | `error` | driver or setup failure; the row carries no usable measurement |

  The installed `claude` CLI has **no `--max-turns` flag**, so the turn budget
  cannot be applied in flight. The driver probes for the flag, does not pass what
  does not exist, and records the overrun afterwards. A row with `turns: 11`
  under a budget of 6 is a run nothing stopped — labelling that `turns` would
  read as a cap of 11.

  Runs are ordered seed → task → condition so the two arms of a comparison run
  back to back; a run that never started because the global cap was exhausted is
  still written out, with `stopped_by: "over-tokens"` and `turns: 0`.
- **Seed** — recorded in every row. Same seed, same rows (`run_id`,
  `duration_ms` and `started_at` aside), verified by running twice.

## Result schema

`bench/schema/result.schema.json`, one row per run:

```json
{"run_id":"20260726T063724Z-2b29b4","task":"reproposal-redis-cache",
 "cond":"commitlore-on","seed":1,"reproposed":true,"violations":1,"turns":5,
 "tokens":7965,"stopped_by":"completed","duration_ms":118,"driver":"dry-run",
 "started_at":"2026-07-26T06:37:24.615Z","simulated":false,
 "matched":["literal:redis"]}
```

`simulated` is required: it marks rows whose transcript was fabricated, so a
simulation can never be mistaken for a measurement. `matched` lists the detector
clauses that fired. `error` carries a failure or skip reason. `model` names the
agent model — declared, optional, and the subject of *What the numbers are
conditional on* below.

`node bench/verify.mjs <file>` validates every line and exits non-zero on any
failure, on a malformed line, or on a file with no rows.

## Metrics

`node bench/metrics.ts <file...> [--json]` aggregates per condition: re-proposal
rate, violation rate, mean turns and tokens, and the `stopped_by` breakdown.
Rates are `null` (`n/a`) when n is 0 — never `NaN`, never 0. Empty input exits 1.

Three blocks come out: **All rows**, the **analysis set**, and the
**comparison**.

### The analysis set, and why rows leave it

A row with `stopped_by: "error"` carries `reproposed: false` because the field is
required, not because the agent declined to re-propose. Leaving those in the
denominator lets whichever arm crashed more often look like the arm that behaved
better. So the analysis set drops them — and drops simulated rows, and runs that
never started because the global token cap was already gone — and every dropped
row is counted by reason in the output. Nothing is dropped silently, and the
**All rows** block above it always shows the unfiltered picture.

### Significance

`bench/stats.ts` implements a two-tailed Fisher exact test, chosen in ADR-0007
because n is small and cells can reach 0, where chi-squared's asymptotics do not
hold. No dependency was added; factorials are taken in log space through a
Lanczos log-gamma so that a larger run than this one cannot silently produce
`NaN`.

`test/bench-stats.test.ts` checks it three ways: published textbook values
(Fisher's tea-tasting table = 17/35; the standard worked example [[1,9],[11,3]]
= 7462/2704156 ≈ 0.00276), agreement with an **independent exact-rational
implementation in BigInt** over every table with cells 0–6 and over all 961
possible 30-per-arm tables, and the invariants — row swap, column swap,
transpose, p ∈ [0,1], empty margins giving p = 1 rather than manufactured
significance.

`metrics.ts` applies it to the 2×2 table of (condition × re-proposed) and prints
p and the odds ratio. An odds ratio below 1 means the treatment re-proposed less.

### What 60 runs can and cannot detect

Exact power of that test at α = 0.05 with 30 runs per arm, enumerated over all
31 × 31 outcomes — not simulated:

| true control rate | true treatment rate needed for 80% power |
|---|---|
| 0.20 | unreachable at any effect size (a true 0% treatment rate gives 0.57) |
| 0.30 | ≤ 0.02 — a 28-point drop |
| 0.40 | ≤ 0.07 — a 33-point drop |
| 0.50 | ≤ 0.14 — a 36-point drop |
| 0.60 | ≤ 0.22 — a 38-point drop |
| 0.70 | ≤ 0.31 — a 39-point drop |

**This matrix is only powered to find a large effect.** A real but moderate
reduction — say 0.40 down to 0.25 — will usually come back non-significant here,
and that non-result would be a statement about 60 runs, not about CommitLore.
Anyone reading a null result from this harness has to read this table with it.

Fisher exact also treats runs as independent, while the design is paired by
(task, seed). The output says so. The test is the one ADR-0007 and T-702
registered, and on paired data it is the conservative choice rather than the
most powerful one.

### What the numbers are conditional on

**Every rate this harness produces is conditional on the model that produced
it.** Re-proposal is a behaviour, and behaviours differ between models; a rate
measured on one model is not evidence about another. The schema therefore has a
`model` field, and `metrics.ts` reports rows that lack one as `(unrecorded)` with
a warning rather than averaging across unknown models — which is exactly what
would happen once several JSONL files are aggregated and the invocation's command
line is no longer around to say which rows came from where.

One caveat on how that field gets populated today: `runner.ts` accepts `--model`
and passes it to the driver, but does not write it onto the row, and `RunRecord`
has no such field. Until that changes, a results file carries `model` only if
something stamped it there; `bench/results/*.manifest.json` records the exact
invocation for that purpose, and says so on the row's behalf. `model` is a
declared property but is **not** in `required`, because making it required would
reject every row the shipped runner writes.

## Drivers

Drivers sit behind `bench/drivers/types.ts` so more can be added.

**`claude-headless`** — spawns `claude -p --output-format json` in the workspace.
Verified end to end against the live CLI (four runs).

```bash
node bench/runner.ts --task reproposal-redis-cache --cond both --seed 1 \
  --driver claude-headless --timeout-ms 540000 \
  --save-transcripts bench/results/transcripts \
  --out bench/results/live.jsonl
```

Prerequisites:

- `claude` on `PATH` and already authenticated — the driver never prompts, so an
  unauthenticated CLI surfaces as `stopped_by: "error"` rows, not as a hang.
- It costs money and wall time: observed runs took **110–300 s** and **40k–70k
  tokens each**, so a full 10-task × 2-arm × 3-seed matrix is a real bill. Test
  the wiring with `--driver dry-run` first.
- Set `--timeout-ms` above the slowest expected run. The default is 600000; at
  240000 an observed run was killed mid-flight and recorded as an error.
- Use `--save-transcripts` for anything that will be quoted.

Known limits:

- The installed CLI has **no `--max-turns`**, so the turn budget cannot be
  enforced in flight. The driver probes `--help` once, passes the flag if it
  exists, and otherwise enforces the budget after the fact — an observed run took
  19 turns against a budget of 12. A wall-clock timeout (SIGTERM, then SIGKILL)
  is the only hard stop today.
- `tokens` counts `input + output + cache_creation` and **excludes**
  `cache_read_input_tokens`. Counting cache reads made one observed run report
  719,866 tokens and swallow the entire global cap.
- Permission mode defaults to `acceptEdits`; override with `--permission-mode`.
  Agent tooling may drop its own files (`.serena/`) into the workspace, which
  land in the diff surface.

**`dry-run`** — fabricates a transcript from a seeded PRNG and writes a file into
the workspace, so the whole pipeline (isolation, detection, budgets, JSONL,
schema, aggregation) can be exercised with no API key, no cost and no network.
It exists because the harness must be testable independently of the agent it
measures. Its rates are constants chosen to make both branches reachable; they
are not a prediction. Every row it writes carries `simulated: true`, the runner
prints a banner, and `metrics.ts` refuses to present those rows as measurement.

## Open after T-702

Closed by T-702: the ten tasks exist and are calibrated in both directions, the
two-tailed Fisher exact test is implemented and verified against an independent
exact-rational oracle, and the first measurement has been run and recorded in
`bench/results/`.

Still open:

1. **`model` is not written by the runner.** `runner.ts` accepts `--model` and
   passes it to the driver, but builds `RunRecord` without it, and `RunRecord`
   has no such field. Two lines in files T-702 does not own. Until it lands, the
   model of a results file lives in its manifest rather than in the row, and
   `model` cannot be promoted to `required` in the schema.
2. **The detector calibration check is not a committed test.** It ran once,
   before the measurement, and caught a matcher that fired on a correct solution
   — which is precisely the failure that would fabricate a re-proposal. Nothing
   currently stops the next matcher edit or the eleventh task from reintroducing
   it. This needs a test file beyond the one T-702 owns.
3. **The matrix is underpowered for anything but a large effect** — see *What 60
   runs can and cannot detect*. Raising seeds or tasks is the only fix; no choice
   of test recovers power that the sample size does not contain.
4. **Fisher exact ignores the pairing.** The design is paired by (task, seed);
   the registered test treats runs as independent. A paired test (McNemar, or a
   mixed model over tasks) would use the design, and should be decided in ADR-0007
   rather than swapped in after seeing a p-value.
5. Transcript-level re-proposal detection (negation) — see *Detection surfaces*.
   The saved transcripts from this run are the calibration input.
6. Whether `records-uninjected` becomes a third arm — see *the control arm*. This
   run cannot separate "records exist in history" from "records were injected".
7. A hard turn cap for `claude-headless`, or a documented wall-clock substitute.
   The installed CLI (2.1.220) still has no `--max-turns`.
8. Whether CPAA should price cache reads separately (T-703).
