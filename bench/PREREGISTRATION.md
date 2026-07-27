# Pre-registration — M1 re-proposal measurement

Written **before** the measurement it describes is run. Its purpose is to fix the
task set, the detection rules, the run parameters and the analysis in advance, so
that nothing about the analysis can be chosen after the numbers are visible.

- Ticket: T-702 (#23) · ADR-0007 · PRD-F7
- Supersedes: `bench/results/t702-pilot-haiku45-superseded.jsonl` (pilot, not citable)
- Status: **registered, not yet run**

---

## 1. Hypothesis

An agent that can see recorded decisions re-proposes previously rejected
approaches **less often** than an agent that cannot.

Direction is specified: the hypothesis predicts `commitlore-on <
commitlore-off`. A difference in the other direction is a refutation, not a
result, and is reported as such.

## 2. The single table that tests it

One 2×2 table, over all ten tasks and all three seeds:

|                    | re-proposed | did not |
|--------------------|-------------|---------|
| `commitlore-on`    | a           | b       |
| `commitlore-off`   | c           | d       |

- **Test**: two-tailed Fisher exact, α = 0.05. Chosen in ADR-0007 because n is
  small and cells can reach 0.
- **Effect size**: difference in re-proposal rates, in proportion points, with a
  95% Newcombe interval. The odds ratio is reported **only when every cell is
  non-zero**; on a zero cell it is not estimable and no number is given.
- **Unit**: one run = one (task, condition, seed).

**No other statistical test will be reported as a result.**

## 3. Analysis set — fixed now

A row enters the analysis set unless it is:

- `stopped_by: "error"` — the row carries no measurement; `reproposed: false` on
  it is a required field, not an observation;
- `simulated: true` — a fabricated transcript is never evidence;
- a run that never started (`stopped_by: "over-tokens"` with `turns: 0`).

Every exclusion is counted and reported by reason. The unfiltered table is
printed alongside it. **Rows are never dropped silently.**

## 4. Subset analysis — will not be done

Some tasks will produce no re-proposal in either arm. That count is reported as a
descriptive limitation, and the primary result is then read as a **lower bound**
on the effect: a task where nothing happened can only pull the measured
difference toward zero.

**No p-value will be computed for any subset of tasks** — not for the tasks that
produced an effect, not for "informative" tasks, not for any grouping chosen
after seeing the data. Selecting the analysis set by outcome is how a null result
gets converted into a positive one, and the refusal is enforced in the analysis
script, not merely intended.

## 5. Run parameters — fixed now

| Parameter | Value |
|---|---|
| Tasks | the ten in `bench/tasks/`, listed in §7 |
| Conditions | `commitlore-on`, `commitlore-off` |
| Seeds | 1, 2, 3 |
| Runs | 10 × 2 × 3 = 60 |
| Driver | `claude-headless` |
| Model | `claude-haiku-4-5-20251001` |
| Per-task turn budget | 24 (observed, not enforced — the CLI has no `--max-turns`) |
| Per-task token budget | 60000 |
| Global token cap | 6000000 |
| Wall clock per run | 300000 ms |
| Detection surface | `artifacts` (diff + commits) for every task |

**Every number produced is conditional on that model.** Re-proposal is a
behaviour and behaviours differ between models; these results do not transfer.

### Freeze procedure — required before the run starts

The pilot is uncitable because the code that produced it no longer exists on
disk. Satisfying PRD-F7's reproducibility AC is the whole point of this run, so
the freeze is part of the protocol rather than a precaution:

1. Commit everything the run will execute — at minimum `bench/`, and anything it
   imports. Nothing in that set may be edited until the run reports `RUNNER_EXIT`.
2. Record the commit SHA in the run's manifest as `environment.repo_sha`, along
   with the `claude` CLI version and the Node version. All three are inputs.
3. Declare the freeze to anyone else working in the repository. **A run in
   flight owns what it executes, not only what someone is editing** — see
   `bench/README.md`, "Freeze the code a long run reads".
4. After the run, verify the freeze held: `git status --porcelain` over the frozen
   set must be empty, and the recorded SHA must still be `HEAD`. If either fails,
   the run is a pilot, not a measurement.

Note for step 1: a running Node process is *not* affected by on-disk edits —
imports are resolved and cached once at startup, and there is no hot reload. The
damage from a mid-run edit is therefore to reproducibility, not to the data. That
is still disqualifying, and it is silent, which is why the check in step 4 exists.

### Command

```bash
node --experimental-strip-types bench/runner.ts \
  --tasks bench/tasks --cond commitlore-on,commitlore-off --seed 1,2,3 \
  --driver claude-headless --model claude-haiku-4-5-20251001 \
  --max-tokens 6000000 --timeout-ms 300000 \
  --save-transcripts bench/results/transcripts-final \
  --out bench/results/t702-m1-final.jsonl
```

The two arms are named explicitly rather than via `--cond both`. Both resolve to
the same pair today, but `--cond all` now expands to five arms (T-703 promoted
the three ablation arms to `supported`), and naming the arms means the command
cannot silently change meaning when the condition registry does.

Then, in order:

```bash
node bench/verify.mjs bench/results/t702-m1-final.jsonl      # schema gate
node --experimental-strip-types bench/metrics.ts bench/results/t702-m1-final.jsonl
```

## 5-b. Environment control — fixed now

The agent under test runs with the operator's machine taken out of the
measurement:

```
--strict-mcp-config --mcp-config <empty> --setting-sources "" --no-session-persistence
```

This was added after the first attempt at this matrix was stopped at row 1. Every
run had been loading eight MCP servers from the operator's global configuration —
a code-search server, a docs server, a web-search server and a **memory** server
among them. Three consequences, in increasing order of seriousness:

1. **Cost.** Runs took roughly three minutes each instead of ~51 seconds.
2. **Generalisability.** The numbers would have described one laptop's toolset.
   Nobody else could reproduce them.
3. **Independence.** A memory server persists across invocations. That is a
   channel between runs which this experiment assumes does not exist.

The third would have invalidated the result rather than merely explaining it.

The difference is not cosmetic: the same task, arm and seed
(`reproposal-redis-cache` / `commitlore-off` / 1) used 20,017 tokens across
**1 turn** under the inherited configuration and 15,704 tokens across **11
turns** under the controlled one. The environment was changing what the agent
did, not just how long it took.

The driver probes for each flag and, if the installed CLI lacks any of them,
prints a warning and proceeds **uncontrolled** rather than failing to spawn. A
run whose log carries that warning is not environment-controlled and must say so.

**The pilot was not environment-controlled.** Its observations about task
discriminating power stand — the property it identified is about task design,
not about tooling — but its rates are not comparable to this run's.

## 6. What changed since the pilot, and why

The distinction that matters: **the pilot is allowed to fix the design; it is not
allowed to choose the analysis.**

| Changed | Justification | Legitimate? |
|---|---|---|
| 8 task prompts rewritten | each failed the discriminative property in §7 | yes — a property, applied to all ten before outcomes were consulted |
| `budget.turns` 12 → 24 | observed 3–29 turns, p95 = 24; at 12 the label fired on 60% of runs and carried no information | yes — measured, and the budget is not enforced either way |
| 4 `violation_if` clauses fixed | each fired on text that was not a decision — a URL in a comment, a diff header, a function name | yes — correctness |
| `oddsRatio` → `null` on any zero cell | `OR = 0` asserted the treatment never re-proposes; 30 runs cannot establish that | yes — correctness |

**Not changed, deliberately:** no `reproposed_if` clause was widened. Widening
re-proposal detection would raise the measured rate, which is the one change that
could manufacture the result the project wants.

## 7. The ten tasks and why each qualifies

The property, established from the pilot's control-arm transcripts:

> **A task measures nothing unless its symptom is unfixable without confronting
> the rejected decision.**

In the pilot, **eight of ten failed it** — the control arm solved the stated
symptom locally, arriving at essentially the reference correct solution, so the
records had nothing to prevent. Each was rewritten to move the symptom onto a
boundary a local fix cannot cross. The full justification lives in each task's
YAML.

The verdict is drawn from **control-arm behaviour, not from silence**. Seven of
ten tasks were silent in both arms; the eighth failure,
`reproposal-sigstore-signing`, was not silent — its treatment arm re-proposed
once — but its control arm still reached the correct answer unaided, which is
what the property asks about. Using silence as the criterion would have left that
task in place; using control behaviour catches it. Note also that this is the one
pilot observation pointing *against* the hypothesis, and the property rewrote
that task rather than dropping it.

| Task | Boundary the symptom crosses | Rejected approach it forces |
|---|---|---|
| `reproposal-redis-cache` | process / instance | shared Redis cache, memcached |
| `reproposal-node20-floor` | install | keeping the EOL floor, dropping `engines` |
| `reproposal-prisma-orm` | build / deploy | Prisma, TypeORM |
| `reproposal-jwt-sessions` | deployment (no DB route) | stateless JWT |
| `reproposal-rabbitmq-queue` | organisation / credentials | RabbitMQ, SQS, BullMQ |
| `reproposal-index-server` | repository (40 repos) | shared database, lookup service |
| `reproposal-llm-projection` | semantic vs textual | model summarisation, embeddings |
| `reproposal-static-global-context` | tool (no hook exists) | checked-in global context file |
| `reproposal-sigstore-signing` | trust (signals are self-asserted) | sigstore, required signed commits |
| `reproposal-winston-logger` | latency on the critical path | winston, pino |

The first two were **not** rewritten: they already satisfied the property. They
are also the two that produced a re-proposal in the pilot, which is a consequence
of the property rather than the reason they were kept — the test was applied to
all ten independently of outcome, and the eight that failed were rewritten
whether or not they had shown an effect.

**This is the residual risk in this design, stated plainly:** the rewrites were
informed by pilot transcripts, so the task set is no longer independent of a
first look at the data. The property is outcome-blind and was applied uniformly,
but a reader is entitled to treat the re-run as a second look at a design tuned
against a first sample. The honest mitigation is that the rewrites make tasks
*harder* for the treatment arm, not easier — every one of them makes the rejected
approach a more attractive answer than it was before.

## 8. Detection rules

Unchanged from the pilot except the four `violation_if` corrections in §6. All
matching is mechanical — literal or regex, on the `artifacts` surface. No
subjective grading.

Both directions are verified before the run:

- **false positive** — the reference correct solution must not match
  `reproposed_if`;
- **sensitivity** — a genuine re-proposal must match it;
- **noise immunity** — nothing may match on agent-tooling files (`.serena/`) or
  on unified-diff scaffolding alone.

All ten tasks pass all three.

## 9. Verdict rules — fixed now

- **p < 0.05 and on < off** → hypothesis supported. Reported with the caveat that
  any silent tasks make the measured effect a lower bound.
- **p ≥ 0.05** → **immediate owner escalation** (ADR-0007, T-702 AC). The report
  must distinguish, with data:
  - *the hypothesis is wrong* — the control arm re-proposed and the treatment arm
    did too, at a similar rate;
  - *this matrix could not detect it* — the control arm rarely re-proposed at
    all, so there was little to prevent; the power table says how large an effect
    60 runs can find.
- **on > off** → reported as a refutation, in that direction, without softening.

**The log is committed regardless of the result.**

## 10. Power — what 60 runs can and cannot find

Exact, enumerated over all 31 × 31 outcomes at α = 0.05, 30 runs per arm:

| true control rate | treatment rate needed for 80% power |
|---|---|
| 0.20 | unreachable at any effect size (a true 0% gives 0.57) |
| 0.30 | ≤ 0.02 |
| 0.40 | ≤ 0.07 |
| 0.50 | ≤ 0.14 |
| 0.60 | ≤ 0.22 |

With the treatment arm at 0/30, the control arm must reach **6/30** for p < 0.05
(6/30 → p = 0.0237; 5/30 → p = 0.0522). This design finds large effects only. A
non-significant result here is a statement about 60 runs before it is a statement
about CommitLore.

### If the run is truncated at a seed boundary

Registered in advance so a shortened run is read correctly rather than
generously. Truncation is permitted **only** at a completed seed boundary, which
keeps the arms balanced; the runner's seed → task → condition ordering makes runs
1–20 a complete matrix at seed 1, 21–40 at seed 2, and 41–60 at seed 3.

Power with the treatment arm at a true 0%, by achieved n:

| true control rate | n=10/arm (1 seed) | n=20/arm (2 seeds) | n=30/arm (3 seeds) |
|---|---|---|---|
| 0.20 | 0.03 | 0.37 | 0.57 |
| 0.30 | 0.15 | 0.76 | 0.92 |
| 0.40 | 0.37 | 0.95 | 0.99 |
| 0.50 | 0.62 | 0.99 | 1.00 |

And the observed count the control arm must reach for p < 0.05, given a treatment
arm observed at zero:

| achieved n per arm | control must reach |
|---|---|
| 10 | 5/10 (50%) |
| 20 | 5/20 (25%) |
| 30 | 6/30 (20%) |

**One seed is not a smaller version of this experiment — it is a different one.**
At n=10 per arm the control has to re-propose in half of all runs before any
difference can clear α, which is far outside anything the pilot suggested is
plausible. A one-seed result that comes back non-significant carries almost no
information about the hypothesis.

The achieved n and the number of completed seeds go in **the first line of the
verdict**, and the power row for that n is quoted with it.

## 11. Known limitations that bound this result

Registered before the run, so they cannot be selected after it.

1. **Injection includes irrelevant records.** The treatment arm's assembled
   context has been observed to carry records scoped to paths the task never
   touches. Every such entry is noise the control arm does not receive, so it can
   only work against the treatment. **The measured effect is therefore an
   underestimate of what a correctly scoped injector would produce** — in the
   same direction as, and additional to, the silent-task dilution in §7. Neither
   is a reason to adjust the number; both are reasons the number is a floor.
2. **The turn budget is not enforced.** The installed CLI has no `--max-turns`,
   so `budget.turns: 24` is observed and reported, never applied. `over-turns`
   means "finished on its own past the budget", not "stopped".
3. **Fisher exact ignores the pairing.** The design is paired by (task, seed);
   the registered test treats runs as independent, which is conservative here.
4. **Everything is conditional on one model** (`claude-haiku-4-5-20251001`) and
   one CLI version. Re-proposal is a behaviour and behaviours differ between
   models.
5. **The pilot is not comparable.** It ran without environment control (§5-b),
   so its rates cannot be quoted beside this run's. Only its design findings
   carry over.

### Correction to 11-1 — it does not apply to this matrix

Appended while the matrix was still collecting and before any outcome was
aggregated. Limitation 1 above was written from an observation made in
`bench/tasks-ablation/`, and then stated as though it held for `bench/tasks/`.
It does not. Both task sets were read record by record against their prompts:

| set | tasks | records | off-path records | off-path share of trailer-block characters |
|---|---|---|---|---|
| `bench/tasks` (this matrix) | 10 | 12 | **0** | **0%** |
| `bench/tasks-ablation` | 7 | 35 | 7 (one per task, deliberate) | 16.6% |

The share is measured over trailer-block characters in the fixtures themselves
(SPEC §2.1 B1: the last paragraph of each seed commit), so it is reproducible
from the task files without running the injector. A figure measured over the
assembled payload instead comes out near but not equal to this one, because the
payload adds framing and drops what grading and lifecycle withhold.

Every record in every primary task concerns the subject its own prompt is
about. Two cases look like exceptions and are not: `reproposal-prisma-orm`'s
records sit under `src/db/`, which the prompt names as a directory rather than
a file, and `reproposal-jwt-sessions` carries `r-5b8c31`, a `reconstructed`
record chained to the main decision by `Follows:` whose purpose is to exercise
grading. Neither is unscoped noise. The `docs/publishing.md` record that
prompted the original claim is `r-lock05`, which exists only in the ablation
set.

**So limitation 1 is withdrawn for this matrix.** The floor argument in §7
(silent-task dilution) is unaffected and still stands on its own; there is
simply no second, additive floor from unscoped injection here. This correction
removes a reason to read the number as an underestimate, which makes the
registered claim weaker rather than stronger — it is recorded here rather than
in the verdict so that it cannot be mistaken for a result-driven revision.

Limitation 1 continues to hold for `bench/tasks-ablation`, where the off-path
records are planted on purpose and reach every arm, because the harness's
injector does not scope (#36).

---

## 12. Second measurement (M1-b) — corrected detector

Registered before the run, after the M1 result was known. The M1 result is not
revised: `p = 0.7480` stands as the registered outcome of that measurement. This
is a **new** measurement with a changed instrument, and it is reported as such.

### What changed and why

M1's `reproposed_if` matchers read the `artifacts` surface — diff plus commit
messages. An agent writes its reasoning into commit messages, markdown and code
comments, so a run that avoided the ruled-out alternative *and explained that it
had* scored as a re-proposal. That was three of the treatment arm's five flags
and none of the control arm's seven, because only the treatment arm is told the
names it then mentions (`bench/DETECTOR-DEFECT.md`).

`reproposed_if` now reads a new `code` surface: added diff lines, with
documentation files (`.md`, `.markdown`, `.txt`, `.rst`, `.adoc`) and comment
lines removed. Implementing an alternative leaves a manifest entry, an import, a
construction or a configured endpoint; explaining that it was avoided leaves a
sentence. `violation_if` is unchanged and stays instrumented-only.

### What is not permitted

- **The existing transcripts are not re-scored into a result.** Re-labelling
  data whose outcome is already known is the move §4 exists to forbid. The
  recorded runs were used only to check the surface behaves as intended, and
  those counts are calibration, not findings.
- **No comparison against M1's rates.** Different instrument, different
  measurement. M1-b's numbers stand alone.
- **§4 still holds.** One test on the full analysis set. No subset p-values.

### Hypothesis, unchanged

`commitlore-on` re-proposes a ruled-out alternative less often than
`commitlore-off`. Two-tailed Fisher exact on the 2×2, α = 0.05.

### Matrix

10 tasks × 2 conditions × seeds 1,2,3 = 60 runs, `claude-haiku-4-5-20251001`,
the environment controls of §5-b, against frozen code.

### Detector requirements, registered

1. **Calibrated against compliance.** The calibration set includes the case the
   original three-way calibration lacked: a correct fix that explains what it
   avoided. `test/bench-detect.test.ts` carries two of the M1 failures verbatim.
2. **False-positive rate reported per arm.** A detector whose error rate differs
   by arm biases the comparison at any magnitude, so the verdict states both.
3. **Fresh run.** Not a re-score.

### Verdict rules

As §9, with one addition: if the arms differ, the verdict must state how many
flags in each arm carry an implementation line, so that a repeat of the M1
defect is visible in the report rather than only in the p-value.

### Known limitations carried forward

§11 as amended, including the withdrawal of §11-1. `code` inherits the honest
limit of every lexical surface: an alternative implemented under a different
name is invisible to it, and one named in a string literal or a variable name is
counted. Both were true of `artifacts` too.

---

## 13. Third measurement (M2) — the shipped delivery path, at n = 40

Registered before the run. M1 (p = 0.7480) and M1-b (p = 0.0522) are not
revised. This is a third measurement with a **different delivery path**, and its
numbers stand alone.

### What changed, and why it is not a tweak

M1 and M1-b both handed the agent one block of text at session start, assembled
by `bench/context.ts`. **The product does not work that way.**
`src/core/inject.ts` is a PreToolUse hook: it fires per edit, it is scoped to
the path being edited, and it refuses an unscoped path outright.

M2 delivers through that hook, via a settings file the harness writes
(`bench/hooks-settings.ts`). Every arm now exercises the shipped injector. Two
consequences follow and both are intended:

- The treatment arm receives records **only for paths it actually edits**, and
  receives them **at the moment it edits**, rather than everything up front.
- `no-scope` becomes a real arm for the first time. It was inert because the
  harness never scoped, so removing scope removed nothing (#36).

`bench/context.ts` remains only as the fallback for an arm with no hook plan.

### Sample size

**4 seeds, n = 40 per arm, 80 runs.** §10's power table put n = 30 per arm at
0.57 power against a true control rate of 0.20, and M1-b missed α by a single
run at n = 30. Registering the larger n *before* seeing M2 is the difference
between a design choice and a retry until significance.

With the treatment arm at zero, the control arm needs **6 of 40** for p < 0.05
(6/40 → p = 0.0264; 5/40 → p = 0.0547). Registered now.

### Hypothesis, test, analysis set

Unchanged from §1–§4. One 2×2 over all tasks and all seeds, two-tailed Fisher
exact, α = 0.05. No subset p-values.

### Matrix

10 tasks × 2 conditions × seeds 1,2,3,4 = 80 runs,
`claude-haiku-4-5-20251001`, §5-b environment controls, frozen code.
Detection surface `code` (§12).

### What this run cannot answer

It measures **injection delivered as the product delivers it**. It does not
measure `guard`, which SPEC §5 assigns to `Ruled-out:` and which
`bench/GUARD-CANNOT-BLOCK.md` showed cannot block at usable precision. #37 is
narrowed to whether an *advisory* guard at edit time beats this, and it is a
separate registration.

### Verdict rules

As §9 and §12, including the per-arm false-positive report.

---

## 14. Fourth measurement (M3) — the guard route

Registered before the run. M1, M1-b and M2 are not revised.

### Why this arm exists

SPEC §5 assigns `Ruled-out:` to `commitlore guard`, and every measurement so far
has been of **injection**. The route the protocol names for the key the whole
hypothesis rests on has never been run (`bench/ROUTE-GAP.md`).

### What is compared

| arm | PreToolUse hook | in M2 |
|---|---|---|
| `commitlore-off` | none | 8/39 |
| `commitlore-on` | `inject --hook-input` | 4/40 |
| `commitlore-guard` | `guard --hook-input` | new |

**The primary test is `commitlore-guard` against `commitlore-on`.** Both get a
hook, both are scoped to the path being edited, and they differ only in which
route `Ruled-out:` travels. `commitlore-off` runs as a reference and is **not**
the primary comparison — guard against nothing would confound the route with the
presence of records at all.

Two-tailed Fisher exact, α = 0.05, one table over all tasks and seeds. §4 holds.

### Sample size

4 seeds × 10 tasks × 3 arms = **120 runs**, n = 40 per arm.

### What guard does, fixed now

Advisory: it prints what it matched and lets the edit through. It matches
`tool_input.new_string` with `--require-content`, so naming a record does not
flag. Blocking was excluded on measured evidence
(`bench/GUARD-CANNOT-BLOCK.md`) — true and false positives occupy one score
band and the only precision-safe threshold catches one in five.

### Pre-check, already run, not part of the analysis

Replaying M2's recorded treatment runs through the matcher on added code: **3 of
4 real re-proposals flagged, 2 of 34 compliant runs flagged.** A go/no-go signal
that the arm has something to measure, not an effect size.

### Cost, expected before the numbers exist

M2 put all three of its timeouts in the arm that ran a hook. Both hooked arms
are expected to show some, and counts are reported per arm. A timeout truncates
a run and so gives it fewer chances to re-propose, which **flatters** whichever
arm suffers it — stated here, before the data.

### Verdict rules

As §9 and §12: per-arm false-positive report, achieved n in the first line. If
the arms do not differ, that is the result. Three null measurements and a fourth
would be the finding, not a reason for a fifth.

---

## 15. M3 is void: the binary under test changed while it ran

Recorded **before any M3 outcome was examined**. §4 holds — no result below, no
result read.

### What happened

`bench/hooks-settings.ts` writes each arm's PreToolUse hook as a command pointing
at `CLI_ENTRY = <REPO_ROOT>/dist/cli.js` — the live working copy, not a snapshot.
The matrix launched at 2026-07-26T23:13:08Z against the tree frozen at `68d4c92`.
Over the following twelve hours this repository was under active repair, and
`npm run build` overwrote `dist/` at least eight times. Two of those rebuilds
changed the treatment itself:

- `a7673d0` widened the injection scanner from `Warn:` to every free-text
  trailer. That changes which records grade `blocked`, which changes what
  `inject` withholds — the `commitlore-on` arm.
- `27f73b0` rewrote `guard`: blocked records are no longer quoted, an incomplete
  check exits 3 instead of 0, and `additionalContext` is worded by trust grade.
  That is the `commitlore-guard` arm, the primary comparison of §14.

102 of 120 runs completed. Early runs measured one product and later runs measured
another, and the two are not the same intervention. No stratification recovers
this: the change is in the treatment, not in a covariate.

### The mistake

The freeze was recorded — "freeze: 68d4c92, uncommitted: 0" — and then treated as
if it had isolated anything. It had not. A commit hash pins what `git` will hand
you; it does not pin the bytes a running process reads from a working directory
that the same operator is editing. **A measurement that reads from the tree it is
being run out of is not frozen.**

This is the same class of error as three others closed this week: a check that
read the inputs to a decision instead of the decision, a doctor that probed the
artifact a developer has instead of the one a user gets, and a scanner keyed to
one field of a record whose every field was a surface. In each case the thing
being verified and the thing actually in play had drifted apart.

### What replaces it

`t702-m3.jsonl` and its transcripts are renamed `*-invalidated` and kept. They are
not evidence for or against anything and must never be cited as a result; they are
kept because deleting the record of a failed measurement is how a project stops
being able to tell you it failed.

M3 is re-registered as **M3-b** and re-run from an isolated checkout — a clone
pinned to a commit, outside this working tree, with its own `dist/`. §14 is
otherwise unchanged: same three arms, same 4 × 10 × 3 = 120 runs, same primary
comparison (`commitlore-guard` against `commitlore-on`), same two-tailed Fisher
exact at α = 0.05.

One thing is added, and it is a precondition rather than a hypothesis: the harness
must record the commit and the `dist/` digest each run actually executed, and the
verdict must refuse to report if they are not identical across every row. A run
that cannot prove what it measured has not measured anything.

---

## 16. M4 — the measurement designed against the reason the others failed

Registered before any M4 run. M1, M1-b and M2 stand as recorded; M3 is void (§15).

### What went wrong, measured rather than guessed

M1 and M2 returned null. The cause is not "no effect" — it is that **seven of the
ten tasks had a control base rate of zero**. Without CommitLore the agent never
proposed the ruled-out approach, so seventy percent of the matrix could not show a
difference no matter how well the tool worked.

    task                              M1 off      M2 off
    reproposal-index-server            3/3         4/4
    reproposal-node20-floor            2/3         3/4
    reproposal-jwt-sessions            1/3         2/4
    the other seven                    0/9         0/28

Power is governed by base rate far more than by sample size. To detect a halving at
80% power, α = .05:

| control base rate | n per arm |
|---|---|
| 20% (what M1/M2 had) | 98 |
| 50% | 29 |
| 70% | 16 |
| 80% | 11 |

M1 ran 30 per arm and M2 ran 40, against a 22% base rate. **The design could not
have detected the effect it was looking for.** That is a defect in the instrument,
and no amount of re-running fixes it.

### The three changes

**1. A qualification round, and the treatment arm is not run until it passes.**

Before the hypothesis is tested, every candidate task runs **control-only**, six
seeds. A task qualifies if the control arm re-proposes in **at least four of six**.
Tasks below that threshold are dropped, and the treatment arm never runs on them.

This is not selection on the outcome: the treatment arm is not looked at, not run,
and not knowable at the moment of the decision. The threshold is fixed here, before
any qualification run.

If fewer than six tasks qualify, M4 does not proceed. A matrix of two tasks is a
result about two tasks.

**2. Task material comes from decisions a project actually made.**

M1/M2's tasks were written to be re-proposal opportunities and mostly were not.
`gitseed` now carries thirty `Ruled-out:` values from its own v0.2 design — real
decisions, each rejecting the option an agent naturally reaches for:

- *let the LLM decide the final ranking* — far less code than a deterministic one
- *blend security results into the ranking score* — one number is simpler than a gate
- *build the hosted web app first* — it demos better than a CLI
- *predict a star count* — a number looks more like a product than a percentile

**Prediction, recorded before measuring:** these produce a higher control base rate
than the synthetic set, because doing the rejected thing is the path of least
resistance rather than an error. The qualification round tests that prediction and
may refute it.

**3. A second outcome variable.**

Re-proposal counts only what did not happen. Registered alongside it, with the same
detector discipline:

- **constraint violation** — the change contradicts a recorded `Limit:`
- **cited compliance** — the agent names the rejection and chooses differently

The primary test stays re-proposal. The second is reported whatever it shows and
does not decide the verdict; it exists because if the value is real and re-proposal
misses it, that is worth knowing before another null is published.

### Arms and sizing

Three arms, unchanged from §14: `commitlore-off`, `commitlore-on` (inject at
PreToolUse), `commitlore-guard` (guard at PreToolUse). The primary comparison is
**guard against on** — both receive a hook, both are path-scoped, and they differ
only in which route `Ruled-out:` travels.

Sizing follows qualification. At a 70% qualified base rate, 16 per arm detects a
halving; M4 runs **24 per arm** to hold 80% power down to a 40% reduction. Final n
is fixed after qualification and before the treatment arm runs, and recorded here.

### Preconditions — any one failing voids the run

1. Every row records `harness_commit` and `dist_digest`, and the verdict refuses on
   a mixed dataset (§15, enforced in `bench/metrics.ts`).
2. The matrix runs from a checkout **outside** the working tree it was built in.
   §15 exists because that was not true.
3. The qualification threshold and n are written here before the corresponding run.

### What a positive result would and would not license

A significant reduction supports one sentence: *records delivered before an edit
reduce how often an agent revives an approach the project already rejected.*

It would **not** support "CommitLore makes agents better", "improves code quality",
or any figure about time saved. Those need their own measurements, and this project
has already withdrawn one set of numbers for being published ahead of their
evidence.

### What a null result means

That records do not measurably change this behaviour at this sample size, on these
tasks, with these delivery routes. It is publishable and will be published.

The product claim then rests where it already holds: decisions bound to the commit
that made them, surviving rebase, squash and rename, with one trust grade across
every route — each of which has a test, and none of which depends on this
experiment.
