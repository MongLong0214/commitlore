# CommitLoreBench

Measures the one thing that decides whether CommitLore is worth building: does an
agent that can see recorded decisions stop re-proposing the approaches a team
already rejected?

- Design: `docs/adr/ADR-0007-commitlorebench.md`
- Requirements: `docs/prd/PRD-F7-commitlorebench.md`
- **Pre-registration for the M1 measurement: `bench/PREREGISTRATION.md`** — the
  task set, detection rules, run parameters, analysis set and verdict rules, all
  fixed before the run. Read it before quoting any number from `bench/results/`.
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
| `no-scope` | supported (T-703) | yes | yes, **every** record, not just the path's |
| `no-grade` | supported (T-703) | yes | yes, all as instructions, nothing withheld |
| `no-lifecycle` | supported (T-703) | yes | yes, superseded and expired included |
| `records-uninjected` | planned | yes | no |

Planned arms are rejected at CLI parse time with a pointer to their ticket.

`--cond both` is the two arms of the primary comparison and `--cond all` is
every supported arm. Until T-703 those were the same list; they are not any
more, and against a live driver the difference is two arms or five. The runner
prints the arms it resolved and the run count before the first run for that
reason.

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

### The ablation arms, and the baseline they are read against

ADR-0007's *어블레이션 lite*: `commitlore-on` minus one guarantee, everything
else held fixed, so a difference in behaviour can be attributed to the
guarantee rather than to the harness.

| Arm | Removed | What the agent sees instead |
|---|---|---|
| `no-scope` | the routed projection (**not** the path scope — see below) | every trailer raw, per commit, bookkeeping keys included |
| `no-grade` | trust routing (SPEC §7) | every record as an instruction — including the ones grading withheld |
| `no-lifecycle` | the staleness filter (SPEC §5) | superseded and expired records alongside the active ones |

Two of these are inert on most of the current tasks and one is misnamed. Read
*What each arm can and cannot see today* below **before** quoting any number
from them.

**The one property the arms depend on is that the baseline did not move.** An
arm is read as a difference from `commitlore-on`, so an ablation that changed
what `commitlore-on` produces would leave every comparison measuring the change
to the harness. `AblationFlags` therefore defaults every flag to `false`, and a
projection built without an `ablation` is byte-identical — payload, counters and
`cacheKey` — to one built before the flags existed. The ablation joins the cache
key only when a flag is set, so an ordinary caller's cached projections are not
invalidated to record a feature they cannot reach.

Three things are worth knowing before a number from these arms is quoted.

**`no-grade` injects the attack.** Grading does two jobs: it tags a record
`[directive]` or `[claim]`, and it withholds the content of a record whose
`Warn:` matches an injection pattern. Removing the routing removes both — the
prompt-injection payload reaches the agent. An arm that kept withholding it
would be ablating the tag on the line rather than the guarantee, and would
understate what grading is worth. This is why the flags exist on
`InjectOptions` and nowhere else: `src/commands/inject.ts` builds that object
field by field from parsed flags, so there is no path from a command line, a
hook payload or a settings file into an ablation.

**`no-lifecycle` and `no-grade` overlap.** SPEC §7 grades a superseded record as
a claim — "no longer directs anything" — so `no-lifecycle` alone injects stale
records *labelled as claims*. Anything read off that arm is a lower bound on
what the lifecycle filter prevents; the two flags together are what removes both
defences. The runner accepts any combination, and `test/inject.test.ts` walks
all eight.

**The payload never says which arm it is.** An agent told it is inside an
experiment is a second treatment nobody registered, so the rendered text carries
no marker. What it does do is stop overstating itself: the header drops the word
"active" under `no-lifecycle`, and names the repository rather than the path
under `no-scope`, because a payload that misdescribes its own contents is worse
than one that says less.

#### Running the matrix, and reading it

```bash
node bench/runner.ts --tasks bench/tasks \
  --cond commitlore-on,commitlore-off,no-scope,no-grade,no-lifecycle \
  --seed 1,2,3 --driver claude-headless --model <model> \
  --timeout-ms 540000 --max-tokens 4000000 \
  --save-transcripts bench/results/transcripts-ablation \
  --out bench/results/t703-ablation.jsonl
node bench/verify.mjs bench/results/t703-ablation.jsonl
node bench/metrics.ts bench/results/t703-ablation.jsonl
```

`metrics.ts` prints a per-condition table for all five arms, but its
significance test compares exactly two: it picks `commitlore-on` against
`commitlore-off` whenever both are present. To test one ablation arm against the
treatment, aggregate a file that contains only those two conditions — with
`commitlore-on` and `no-scope` it reads `no-scope` as the treatment and
`commitlore-on` as the baseline. Splitting the file is a `grep`, and it keeps
each test to the pair it is about.

The power table under *What 60 runs can and cannot detect* applies to each of
those pairs unchanged: three seeds × ten tasks is 30 runs per arm, so an
ablation that costs less than roughly 30 points of re-proposal rate will not
reach significance here. Read the per-arm rates as the direction check ADR-0007
asked for, not as five independent hypothesis tests.

#### Two implementations, and the decision to keep them apart

The ablation exists twice, and they are not the same code:

- `src/core/inject.ts` — `AblationFlags` on the shipped projection. This is what
  T-402 ships and what `test/inject.test.ts` pins.
- `bench/context.ts` — `assembleContext`, which the runner actually calls, and
  which honours the same three axes off `ConditionSpec`
  (`injection_scope` / `apply_grading` / `apply_lifecycle`). **This is the one
  the numbers come from.**

**Owner decision, 2026-07-26: the ablation arms cut `bench/context.ts` down,
the primary arms keep the behaviour they were measured with, and "measure the
shipped injector instead" is a Backlog issue.** The reasons, in the order they
matter:

1. Re-defining `commitlore-on` mid-programme would break the comparison the
   re-run exists to make, and would invalidate the discriminating-task analysis
   the pilot produced.
2. `buildInjection` **requires a path and refuses the repository-wide request**
   (ADR-0006). `assembleContext` runs once, before the agent has been given the
   task, when no path exists. Wiring the shipped injector in means inventing a
   path-selection policy per task — an ADR decision, not a wiring change.
3. The gap between the harness injector and the shipped one is not what this
   benchmark is measuring.

The cost is real and is stated rather than hidden: **the measured ablation is an
ablation of the harness's re-implementation.** It differs from the shipped
injector in at least one respect that matters — the bench has no
injection-pattern scanner, so its `no-grade` arm cannot inject a withheld
payload, because it never withheld one.

#### What each arm can and cannot see today

Verified by running all four arms over all ten tasks under `--driver dry-run`
and diffing the `injected_context` each one produced:

| Arm | Payload identical to `commitlore-on` | Why |
|---|---|---|
| `no-scope` | 0/10 tasks | differs — but see below |
| `no-grade` | **9/10 tasks** | only `jwt-sessions` seeds a non-`authored` record |
| `no-lifecycle` | **9/10 tasks** | only `prisma-orm` seeds a `Supersedes:`/`Expires:` |

Across all ten tasks the fixtures carry eleven `Provenance: authored` records
and **one** `reconstructed`; **one** task declares a supersession or an expiry.
An arm that removes a guarantee the fixture never exercises injects the same
bytes as the treatment, and a run of that arm measures the seed data, not
CommitLore. **Both arms need richer fixtures before their numbers mean
anything**: a non-trusted or `reconstructed` record for `no-grade`, and a
superseded plus an expired record for `no-lifecycle`. That is a `bench/tasks/`
change, and since no ablation has been measured yet it is fixture design rather
than a post-hoc adjustment.

**`no-scope` is misnamed, and the name is the smaller problem.** It differs on
every task, but not by scope: both renderings start from every record in the
repository, and the arm swaps the routed projection (grouped by `Ruled-out` /
`Limit` / `Warn`, bookkeeping keys dropped) for a raw per-commit trailer dump.
Measured on `reproposal-redis-cache`, the two payloads are 733 and 789 bytes and
carry **exactly the same records** — the extra bytes are `Blast:`, `Undo:`,
`Certainty:`, `Record-Id:`, `Provenance:` and `CommitLore-Version:` becoming
visible.

So what it ablates is the **projection** (ADR-0006 decision 2), which is a real
guarantee and worth measuring — just not the one on the label. Path scoping
cannot be ablated here at all, because a pre-prompt injection never had a path
to scope to; measuring it requires per-path injection at tool time, which means
installing the `PreToolUse` hook into each workspace and running the shipped
injector. That is the Backlog issue above. Until then, read a `no-scope` number
as *"routed projection vs. raw dump"* and nothing more.

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

### The property that decides whether a task measures anything

Most of these tasks do not discriminate, and the reason is a design rule that
was not obvious until the transcripts were read:

> **A task measures nothing unless its symptom is unfixable without confronting
> the rejected decision.**

Two counts, and they are not the same measure:

- **7 of 10 tasks were silent** — neither arm re-proposed on any seed, so the
  task contributed nothing in either direction.
- **8 of 10 failed the property** — judged from what the *control* arm did, not
  from whether anything fired. `reproposal-sigstore-signing` was not silent (the
  treatment arm re-proposed once) yet still fails: its control arm reached the
  correct answer unaided, so the record had nothing to prevent there either.

The property verdict is the one that drives the rewrites, because silence is a
symptom and control-arm behaviour is the cause.

In the control transcripts the rejected approach was usually absent *entirely* —
not narrowly missed by the matchers, but not present under a deliberately wide
natural-language probe (`orm`, `prisma`, `drizzle`, `kysely`, `query builder`,
`jwt`, `stateless`, `refresh token`, `llm`, `embedding`, `similarity`, `broker`,
`rabbit`, `sqs`, `kafka`, `redis`, `amqp`, `shared database`, `central`,
`hosted`, …). What the control did instead was fix the stated symptom locally,
inside the file the prompt pointed at:

| Task | What the control arm did with no records at all |
|---|---|
| `reproposal-prisma-orm` | extracted a `USER_COLUMNS` constant |
| `reproposal-jwt-sessions` | added a short-TTL in-memory session cache |
| `reproposal-rabbitmq-queue` | wrapped the claim in `SELECT ... FOR UPDATE` |
| `reproposal-llm-projection` | deduplicated the entries with a `Map`/`Set` |
| `reproposal-index-server` | hashed the git state and cached against it |

Each of those is, near enough, the reference "correct solution" used to calibrate
the detector. **The control arm reached the right answer without the records, so
the records had nothing to prevent.** A task like that cannot show an effect in
either direction; including it only dilutes the measured difference toward zero.

The two tasks that did discriminate share the missing property — their symptom
has no local remedy:

- `reproposal-redis-cache` — "sessions vanish on restart or on another instance"
  is cross-process state, which cannot be fixed inside one process. The control
  arm went straight to *"Redis-backed session storage with in-memory fallback"*;
  the treatment arm on the same task and seed chose *"file-based persistence"*.
- `reproposal-node20-floor` — "users on an older runtime cannot install" leaves
  the declared floor as the only lever. The control arm lowered `engines.node`
  from `>=22` to `>=18` **and** rewrote the enforcement script's threshold to 18
  so its own change would pass.

This is a property of the task, not of the arm: it applies to tasks written for
this repository and to tasks ported from anywhere else. Any task added for T-703
should be checked against it before it is allowed into the set, and the tasks
above that fail it should be rewritten so that the symptom forces the decision.

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

### A known false positive, left in place on purpose

`whole-repo-record-fetch` in `reproposal-static-global-context` is wrong and is
**still in the task file**. It fired on this, which does not violate anything:

```ts
if (!cache.has(repo)) cache.set(repo, loadRecordsForRepo(repo));
const allRecords = cache.get(repo)!;
return allRecords.filter(r => r.path === filePath);   // still path-scoped
```

The Limit is about what gets *injected*, and this filters by path on the very
next line. The clause matched `loadRecordsForRepo(` — matchers default to
case-insensitive — and the underlying mistake is that it keys on a **function
name**, which is the author's free choice rather than a semantic signature. That
is the identical error as `createLogger(`, which was rejected for exactly this
reason two tasks earlier.

It is documented rather than fixed because it was found after the measurement had
started, and changing a condition partway through a matrix breaks the comparison
the matrix exists to support. The consequence is bounded and stated here: the
violation count for this task is not trustworthy. Neither the re-proposal metric
nor the significance test is affected — this is a `violation_if` clause, and
violations are instrumented only.

Note the pattern across all four defects found in this run: **every one was a
`violation_if` clause, and none was a `reproposed_if` clause.** The re-proposal
matchers are literal technology names and import shapes, which are hard to get
wrong. The violation matchers try to encode *"the agent broke a stated
constraint"*, which is a much harder thing to express as a regex over a diff, and
three of the four failures came from matching incidental text — a URL in a
comment, a diff header, a function name — rather than a decision.

## Pilot and measurement are different things

The first full matrix is a **pilot**. What a pilot produces is not numbers, it is
design defects — tasks that cannot discriminate, detectors that fire on noise,
budgets that do not match reality, harness bugs. All four turned up here.

The line that has to hold:

| A pilot may change | A pilot may never change |
|---|---|
| a task, to satisfy a stated **property** | which tasks to keep, based on which showed an effect |
| a detector that fires on the wrong thing | a detector widened to raise the measured rate |
| a budget, against measured usage | the analysis set, chosen after seeing the data |

Both columns are "changing things after looking at data". The difference is
whether the reason is a property fixed in advance or an outcome observed
afterwards. The first is how a pilot is supposed to work; the second is how a
null result quietly becomes a positive one.

So the changes are enumerated with their justifications in
`bench/PREREGISTRATION.md` §6, and the measurement is registered in full before
it runs. Pilot results carry `"status": "pilot — superseded"` in their manifest
and are not citable; **no p-value is computed from pilot data.**

## Freeze the code a long run reads

A results file is only evidence if the code that produced it still exists. The
first 60-run matrix lost that property while it was running: `bench/runner.ts`
and `bench/types.ts` were edited on disk at 17:24, 43 runs in, by work that
legitimately owned those files.

Two things are worth separating, because they lead to different conclusions.

**What did not happen.** The runs did not split into "before" and "after". Node
resolves the runner's imports once at process start and does not hot-reload;
every import in `bench/` is static (no `await import`, no `require`), and
`loadTasks()` is called once in `main()`. The process that produced the file
started at 16:41:11 and never restarted, so **all 60 runs executed one code
version** — the one loaded at 16:41:11. The edits never reached it. `src/core/inject.ts`
was edited too, and that one is irrelevant twice over: the bench never imports
from `src/` at all (the injector it uses is `bench/context.ts`, which was last
touched an hour before the run began).

**What did happen.** The code on disk no longer matches the code that produced
the file. Nobody can re-run and get those numbers back, so PRD-F7's
"re-running the whole runner reproduces the numbers (fixed seed)" is permanently
unsatisfiable for that file. That is enough to make it uncitable on its own, and
it is the actual reason the matrix was demoted to a pilot — not a mid-flight
behaviour change, which did not occur.

The rule this produces:

> **Before starting a long measurement, declare every file that run will read as
> frozen until it finishes.** File ownership is usually split by who *edits* a
> file. A run in flight also owns what it *executes*.

And once it has happened, do not revert — reverting is another change. Demote the
run to a pilot, freeze, and re-run. Record the frozen commit SHA in the manifest
so the next incident is traceable rather than reconstructed.

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

  Ordering seed-major has a second use: runs 1–20 are a complete balanced matrix
  over all ten tasks and both arms at seed 1, 21–40 the same at seed 2, and so
  on. A run stopped at a seed boundary is a smaller experiment, not a broken one.

  **What the budgets actually did in the live run:** nothing. Across the measured
  runs there were zero timeouts and zero errors; the longest run took 105s
  against a 300s wall clock, and the heaviest used 39k tokens against a 60k
  per-task budget. `stopped_by: "over-turns"` was the majority label, but since
  the CLI has no `--max-turns` that label stopped nothing — every run ended when
  the agent decided it was finished, including the several that finished in three
  turns. This matters for reading a null result: **no run was cut off before it
  could reach the decision point.** `budget.turns: 12` is nonetheless unrealistic
  against an observed 3–22, and should be raised for the label to carry
  information; it was deliberately left alone mid-run, because changing a
  condition partway through breaks the comparison it exists to support.
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

### CPAA — cost per accepted annal

ADR-0007's operational metric, reported per arm and over the analysis set:

```
CPAA = (harvest tokens + verify tokens) / accepted records
```

It prices the pipeline that *writes* records, which is not the pipeline every
other number in this file measures — those all describe an agent solving a task.
Three optional row fields carry it: `harvest_tokens`, `verify_tokens` and
`accepted_records`.

**A row counts only if it carries all three.** A row with a denominator and no
numerator would add accepted records at a cost of nothing and drag the ratio
down — the same shape of error as leaving a crashed run in a re-proposal
denominator, and pointing the same way: it would make CommitLore look cheaper
than anything measured it to be. Partly instrumented rows are counted separately
and reported.

CPAA is never `NaN`, never `Infinity` and never `0` by accident. It has two
distinct undefined states, and they are different findings printed as different
sentences:

| State | Means |
|---|---|
| `not instrumented` | no row recorded what a record cost. A gap in the measurement |
| `undefined — 0 records accepted` | rows did record it, and nothing was accepted. A measurement |

The second is the control arm's honest answer on every run: `commitlore-off`
strips the trailer block, so its workspace holds no records and a cost per
record has no value.

**What is instrumented today, and what is not.** The runner writes
`accepted_records` — counted from the seeded workspace after seeding and before
the agent runs, because a record the agent writes during its own run is not one
the harvest pipeline paid for. It does **not** write `harvest_tokens` or
`verify_tokens`, and it does not fabricate them as zero: the bench seeds records
from task YAML rather than harvesting them, so no model token was ever spent
producing them, and a zero there would price CommitLore's record-writing
pipeline as free. Every CPAA this harness prints today therefore reads
`not instrumented`, naming the missing field.

Two things would close it, in order of size:

1. Run the real harvest pipeline over each run's own transcript and diff, and
   record what it spent. That is the measurement ADR-0007 asked for. It needs a
   model call per run, so it is a cost decision, not just a wiring one.
2. Note that `verify_tokens` is structurally **0** for the shipped verifier —
   `src/core/harvest-verify.ts` is deterministic and calls no model. That term
   of the numerator is free by design and will stay free unless verification
   grows a model. The field is written only when the step actually ran, because
   a measured zero and an absent field are different claims.

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

Both sides of this experiment's decision boundary are pinned as regressions, so a
future change cannot move the verdict without moving a test:
`[[0,30],[5,25]]` → p = 0.0521855 (does not clear α) and `[[0,30],[6,24]]` →
p = 0.0237207 (does).

`metrics.ts` applies it to the 2×2 table of (condition × re-proposed) and prints
p, the rate difference, and the odds ratio when one exists.

### Why the headline effect size is a rate difference, not an odds ratio

`oddsRatio` is `null` whenever **any** cell is 0, and the reason is recorded in
`oddsRatioReason`.

Only half of that is a division by zero. With the treatment arm at 0 events the
arithmetic is perfectly finite and returns **0** — and an odds ratio of 0 reads
as *the treatment never re-proposes*, which 30 runs cannot establish. What was
actually observed is zero events in thirty trials, and the honest upper bound on
that rate is **11.4%** (Wilson, 95%), not zero. Reporting a boundary estimate as
a point estimate is precisely the overstatement this benchmark exists to prevent,
so no number is given.

This is the table the experiment actually produces, so it is not a hypothetical:
an earlier version returned `oddsRatio: 0` for `[[0,30],[6,24]]`, and it took a
cross-check to catch it.

The effect size is therefore the **difference in re-proposal rates**, in
proportion points, with a 95% Newcombe interval built from two Wilson intervals.
It stays defined at zero and it carries its own uncertainty, so the magnitude
claim is bounded rather than asserted:

```
   Fisher exact (two-tailed)  p = 0.0237
   rate difference            -20.0pp   95% CI [-37.3pp, -4.5pp]
   odds ratio                 not estimable
                              cell a (treatment, re-proposed) is 0 …
```

**Headline any result with the p-value and the rate difference. Quote the odds
ratio only when it is estimable, and never state how large the effect is without
the interval.**

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
