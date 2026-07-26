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
