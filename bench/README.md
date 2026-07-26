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

## Isolation, stopping and reproducibility

- **Workspace** — one `git init` per (task, condition, seed) under
  `os.tmpdir()`, named with the pid and random bytes. Removed afterwards unless
  `--keep`; the remover refuses any path it did not create. Seeding runs with
  `GIT_CONFIG_GLOBAL=/dev/null` and fixed author dates, so a seed produces
  byte-identical commit SHAs on any machine. Paths from YAML are resolved and
  rejected if they escape the workspace.
- **Double stop** — a per-task turn cap (`budget.turns`) and a global token cap
  (`--max-tokens`) across the whole invocation. Whichever fires first is recorded
  in `stopped_by`. Runs are ordered seed → task → condition so the two arms of a
  comparison run back to back; a run that never started because the cap was
  exhausted is still written out, with `stopped_by: "tokens"` and `turns: 0`.
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
clauses that fired. `error` carries a failure or skip reason.

`node bench/verify.mjs <file>` validates every line and exits non-zero on any
failure, on a malformed line, or on a file with no rows.

## Metrics

`node bench/metrics.ts <file...> [--json]` aggregates per condition: re-proposal
rate, violation rate, mean turns and tokens, and the `stopped_by` breakdown.
Rates are `null` (`n/a`) when n is 0 — never `NaN`, never 0. Empty input exits 1.

`fisherExact()` is exported with its signature and **throws**: the two-tailed
test is T-702 (#23). A placeholder that returned a number would be a fabricated
result.

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

## Open for T-702

1. Transcript-level re-proposal detection (negation) — see *Detection surfaces*.
2. Whether `records-uninjected` becomes a third arm — see *the control arm*.
3. A hard turn cap for `claude-headless`, or a documented wall-clock substitute.
4. Whether CPAA should price cache reads separately (T-703).
