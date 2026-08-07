# Pre-registration — M5 re-proposal measurement, powered

Written **before** the measurement it describes is run, and committed before the
harness is invoked. Its purpose is to fix the task set, the model, the run
parameters, the stopping rule and the analysis in advance, so that nothing about
the analysis can be chosen after the numbers are visible.

- Follows: `bench/PREREGISTRATION.md` (M1) · ADR-0007 · PRD-F7
- Status: **registered, not yet run**

---

## 1. Why this run exists

M1 ran the right experiment at the wrong size. It reported 5/30 against 7/30,
Fisher exact p = 0.7480, and — the number that matters — **5.1% power to detect
the difference it observed.** `bench/VERDICT-M1.md` states the consequence
plainly: an experiment with a 5% chance of detecting its own effect has not
tested the hypothesis, it has reported that it cannot see.

M5 changes exactly one thing: **n**. Same tasks, same detection rules, same
analysis. If M5 returns a null, that null means something M1's could not.

## 2. Hypothesis

An agent that can see recorded decisions re-proposes previously rejected
approaches **less often** than an agent that cannot.

Direction is specified: the hypothesis predicts `commitlore-on <
commitlore-off`. A difference in the other direction is a refutation, not a
result, and is reported as such.

## 3. The single table that tests it

One 2×2 table, over all ten tasks and all registered seeds:

|                    | re-proposed | did not |
|--------------------|-------------|---------|
| `commitlore-on`    | a           | b       |
| `commitlore-off`   | c           | d       |

- **Test**: two-tailed Fisher exact, α = 0.05.
- **Effect size**: difference in re-proposal rates, in proportion points, with a
  95% Newcombe interval.
- **Unit**: one run = one (task, condition, seed).

**No other statistical test will be reported as a result.** Per-task rates are
reported as description, never as a second test, and no subset is analysed as if
it were the registered comparison.

## 4. Size, and the basis for it — fixed now

| parameter | value | basis |
|---|---|---|
| planning control rate | **23.3%** | M1's observed control rate over the full ten-task set |
| minimum effect of interest | **to 16.7%** (−6.6pp) | the difference M1 observed and could not resolve |
| α, two-sided | 0.05 | ADR-0007 |
| power | 0.80 | conventional |
| **n per arm** | **576** | two-proportion normal approximation |
| seeds × tasks × arms | **58 × 10 × 2 = 1,160 runs** | 580 per arm, the first multiple of 10 above 576 |

**The planning rate is M1's 23.3%, not the 33.3% measured in this run's pilot.**
The pilot covered three tasks and included `reproposal-index-server`, which M1
showed is the strongest single task in the set (3/3 in control). Planning from it
would assume a base rate the full task set has not demonstrated, and would size
the run too small. Where the two disagree, the more conservative and more broadly
measured number is used.

The pilot's job was wall-clock and base rate, not effect. Its 12 rows
(`20260801T114947Z-7e2a8f`) are **not** part of the analysis set and are not
citable as a result.

## 5. Model — fixed now

`sonnet`, passed with `--model` and recorded on every row. The harness refuses a
non-simulated run without it, so no row can be produced whose producer is
unknown. This is the defect that invalidated M4, whose rows record `Model | not
recorded`.

The model is a design parameter, chosen before the run and not revisited. Should
a later run use a different model, it is a different measurement reported
separately, not a substitution into this one.

## 6. Exposure — the check M4 lacked

M4 recorded no per-run treatment exposure, so whether the treatment was present
was unverifiable and the whole matrix was withdrawn. M5 requires, on every row:

- `guard_exposure.complete === true`
- `commitlore-on` rows: `accepted_records > 0` — the arm received records
- `commitlore-off` rows: `accepted_records === 0` — the arm did not

**A row failing its arm's exposure condition is reported and excluded**, with the
count of exclusions stated beside the result. If exclusions exceed 5% of either
arm, the run is reported as compromised rather than analysed.

## 7. Analysis set — fixed now

A row enters the analysis set unless it is:

- `stopped_by: "error"` — the row carries no measurement
- failing the exposure condition in §6

Exclusions are counted and reported per arm before the table is shown. No row is
excluded for its outcome.

## 8. Stopping rule — fixed now

**The run completes all 1,160 rows before any 2×2 table is computed.** No interim
analysis, no early stop, no extension after seeing a result. Sharding by seed
range is an operational convenience for restartability and carries no analytical
meaning; shards are concatenated and analysed once.

If the run is interrupted, it resumes at the next unrun (task, condition, seed)
cell. A partially completed run is not analysed and not reported as a result.

## 9. What would refute the hypothesis

- `commitlore-on` re-proposing at a rate **at or above** `commitlore-off`.
- A null at this n. Unlike M1's, a null here is informative: at 580 per arm the
  run has 80% power against the difference M1 observed, so failing to find it
  bounds the effect rather than reporting an inability to see.

ADR-0007 commits this project to acting on the result either way. That commitment
is the reason for the stopping rule in §8.

## 10. What this measurement is not

- It is not evidence about agents in general. Ten synthetic tasks, one model, one
  harness.
- It is not evidence that the delivered record was *read*. `bench/ROUTE-GAP.md`
  records treatment-arm runs that implemented something explicitly listed in the
  injected block. Re-proposal rate is an outcome measure and says nothing about
  the mechanism.
- It is not a benchmark anyone else reports. No third party has published a
  number on this instrument, and a sceptic should discount it accordingly.

---

## 11. Deviations

Recorded as they happen, with dates. A deviation that is not written down is
indistinguishable from a design that was always this way.

### Deviation 1 — 2026-08-01: the first launch ran 20 tasks, not the registered 10

`bench/runner.ts --task` defaults to every task in `bench/tasks/`, and the first
launch omitted it. `bench/tasks/` holds the ten `reproposal-*` fixtures this
document registers **and** ten `qualification-gitseed-*` fixtures, which are
harness qualification cases and are not part of any hypothesis here. The run was
producing all twenty.

**Detected** 3.6 hours in, at 80 rows, during a §6 precondition check.

**Action.** The run was stopped and restarted with `--task` naming the ten
registered fixtures explicitly. The shard script now passes them and carries a
comment saying why, so the default cannot silently reassert itself.

**The 80 rows are kept**, at `bench/results/m5-off-design-20-tasks.jsonl`, and are
**not** part of the analysis set and not citable as a result. They are the record
that this happened.

**No outcome was examined before the restart.** What was checked is what §6 and §7
require to be monitored — exposure completeness, the arm-correctness of
`accepted_records`, `stopped_by` balance, and that the model is recorded. The 2×2
table of §3 was not computed, and the restart's cause has nothing to do with
results: the invocation did not match the registered task set.

For the record, since it bears on whether the preconditions are satisfiable at
all, those 80 rows showed `guard_exposure.complete` on 79 of 79 scored rows,
`accepted_records > 0` on 40 of 40 treatment rows, `accepted_records === 0` on 39
of 39 control rows — a §6 exclusion rate of 0.0% against the 5% threshold — and
`over-turns` balanced at 15 in each arm.

**Timing, measured rather than planned.** 2.7 minutes per run against the pilot's
4.0, with no harness idle between runs. The registered 1,160 rows project to
roughly 2.2 days.

### Observation, not a change — `over-turns` and the analysis set

Audited alongside deviation 1: every other runner default in force was checked
against the M5 command line. `--tasks` resolves to `bench/tasks/`, which is
correct. `--max-turns` is deliberately not passed, so each task's own turn budget
applies, as in M1. `--timeout-ms` and `--permission-mode` take their defaults, as
in M1.

That leaves one figure worth stating in advance of the verdict rather than
discovering in it. On the registered fixtures, `stopped_by: "over-turns"` ran at
22.5% in the off-design sample against **15.0%** in `t702-m1-final.jsonl`. A run
cut off at its turn budget had less opportunity to re-propose, so `reproposed:
false` on such a row is weaker evidence than on a completed one.

**The analysis set is not being changed.** §7 keeps these rows, M1 kept them, and
altering the rule now — after the rate is visible — is precisely the post-hoc
choice this document exists to prevent. The rate was balanced across arms in the
sample (15 and 15), so it dilutes rather than biases.

**The verdict must report the `over-turns` share per arm** beside the 2×2 table,
so a reader can weigh it. That requirement is registered here, before the run's
outcome is known.

### Deviation 2 — 2026-08-01: a second truncation reason, and an imbalance in it

`stopped_by: "over-tokens"` appeared in the registered run and is not named
anywhere above. It is the per-task token budget in the fixture YAML
(`tokens: 60000`), not the invocation-wide `--max-tokens`, which stands at
200,000,000 against roughly 3,000,000 spent at the time of writing. It is
therefore the same kind of state as `over-turns`: a run cut off before it
finished, on which `reproposed: false` is weaker evidence than on a completed
one.

**Observed at 71 of 1,160 rows**, monitoring §6 and §7 as those sections require:

| | truncated (`over-turns` + `over-tokens`) |
|---|---:|
| `t702-m1-final.jsonl`, for reference | 15.0% |
| M5 `commitlore-on` | 16.7% |
| M5 `commitlore-off` | **31.4%** |

The off-design sample reported in deviation 1 was balanced at 15 and 15. This is
not, and the imbalance runs against the arm the hypothesis predicts will
re-propose more. Two readings are available and this document deliberately does
not choose between them before the run ends:

1. **A confound.** Truncation suppresses re-proposal, so a control arm truncated
   twice as often has its rate pushed down — which makes the hypothesis *harder*
   to demonstrate, not easier. Conservative, but it is still noise in the
   comparison.
2. **A consequence.** The treatment arm has the records, settles sooner, and
   spends fewer turns and tokens; the control arm searches longer and hits the
   caps. That is not a confound at all. It is an effect, on an outcome this
   measurement did not register.

**Nothing changes.** §7's analysis set still excludes only `stopped_by: "error"`,
and §8's stopping rule still forbids computing the table before all 1,160 rows
land. Excluding truncated rows now — after their rate is visible and after it is
visibly asymmetric — is the exact move this document exists to prevent, and it
would break comparability with M1, which kept them.

**The verdict must report, per arm: the `over-turns` share, the `over-tokens`
share, and the combined truncation share**, beside the 2×2 table. §11's earlier
obligation covered `over-turns` only; this extends it. It is registered here
while the outcome is still unknown, which is the only condition under which such
an obligation means anything.

**What was read to produce this note:** `stopped_by`, `turns`, `tokens`,
`accepted_records` and `guard_exposure`. Not `reproposed`, and not any
cross-tabulation of it.

### Deviation 3 — 2026-08-07: 400 completed rows were lost, and are being re-run

**The run finished.** Its log records all six shards and a final count of 1,160:

```
=== seeds  1-10 done 2026-08-02T02:46:04Z rows=200 ===
=== seeds 11-20 done 2026-08-02T12:46:57Z rows=200 ===
=== seeds 21-30 done 2026-08-02T23:08:55Z rows=200 ===
=== seeds 31-40 done 2026-08-03T10:03:56Z rows=200 ===
=== seeds 41-50 done 2026-08-03T20:36:31Z rows=200 ===
=== seeds 51-58 done 2026-08-04T01:16:13Z rows=160 ===
ALL SHARDS COMPLETE 2026-08-04T01:16:13Z
```

**The first two shards no longer exist.** They were written only to a session
scratchpad under the system temporary directory and were never copied anywhere
durable. Between 2026-08-04 and 2026-08-07 the operating system's temp reaper
removed them. No other copy was made, and a search of every local filesystem
found none. 400 rows — seeds 1–20, both arms, all ten tasks — are unrecoverable.

This was an operational failure in how the run was stored, not a fault in the
harness or the design. A sixty-hour measurement was left with a single copy in a
directory whose contract is that it may be emptied.

**Why the loss is outcome-independent.** The reaper selects by age and cannot
read a row. The two shards deleted are exactly the two oldest, written
2026-08-01 and 2026-08-02; the four that survive are the four most recent. No
property of a result influenced what was removed, and what survives is a
contiguous seed range, 21–58, complete in both arms at 380 each.

**Nothing was analysed.** Establishing what survived required `run_id`,
`harness_commit`, `dist_digest`, `task`, `cond`, `seed` and `model`.
`reproposed` was not read on any row and no 2×2 table was computed, then or
since. `bench/m5-analysis.ts` enforces this independently: it exits before the
table on any input short of 1,160 rows.

**The lost rows are being re-run, restoring n = 1,160.** The alternative — 
analysing the surviving 760 as a reduced-power run — was rejected. §8 registers
1,160 rows and calls anything less a partially completed run that "is not
analysed and not reported as a result." 760 rows carry roughly 62% power against
the registered effect where the design specifies 80%, and choosing a smaller n
after part of the data is gone is the shape of decision this document exists to
forbid, however innocent its cause.

**What is held constant.** The re-run is pinned to the harness commit the
surviving rows record, `788a9db`, whose committed `dist/` reproduces the recorded
digest `f54cda47…` exactly — verified before the re-run was launched, not
asserted. Same ten registered fixtures, same `--model sonnet`, same `--cond
both`, same caps, same seeds 1–20. Every row of the completed set will therefore
agree on `harness_commit` and `dist_digest`.

**What differs, and must be reported.** The re-run rows are produced roughly five
days after the originals, against a `sonnet` alias that is not pinned to a build,
so the provider's model may not be byte-identical to the one that produced seeds
21–58. This is a real limitation and cannot be engineered away at this point. Two
things bound it: the re-run covers whole seeds, and within each seed both arms,
so any drift falls on treatment and control equally and cannot manufacture a
difference between them.

**The verdict must report the production window per shard** — seeds 21–58 from
2026-08-01 to 2026-08-04, seeds 1–20 on 2026-08-07 — and state that seeds 1–20
are a re-run, beside the 2×2 table. Registered here before those rows exist.

**Storage, changed so this cannot repeat.** Results are written outside the
scratchpad and each shard is committed to `bench/results/` as it lands. The four
surviving shards were committed before the re-run was launched.

**One harness check preceded the re-run**, at seed 999 — outside the registered
range of 1–58, so no registered cell was touched. It confirms the pinned harness
runs and stamps the expected commit and digest. Its rows are discarded and are
not citable.
