# Pre-registration — M6, does trust grading change what an agent does?

Written **before** the measurement it describes is run, and before M5's outcome
was looked at. Its purpose is to fix the hypothesis, the arms, the outcome
measure and the analysis in advance, so that nothing about the analysis can be
chosen after the numbers are visible.

- Follows: `bench/PREREGISTRATION-M5.md` · ADR-0007 · T-703 · SPEC §7
- Status: **drafted, NOT registered.** §5 cannot be fixed without a base rate,
  and §4's fixtures do not exist yet. This document is registered — and the
  status line here changes — only when §4 and §5 carry numbers rather than
  procedures. Running M6 before then would be an unregistered run.

---

## 1. Why this run exists

M1 and M5 measure one guarantee: that injecting a path's records changes what
an agent proposes. Trust grading (SPEC §7) is a *second* guarantee, and the
product's security claims rest on it entirely — `[directive]` tells an agent to
treat a line as a constraint, `[claim]` tells it to weigh the line as a report,
and `blocked` withholds the line because the line is the attack.

None of that has been measured. `bench/types.ts` has carried a `no-grade`
ablation arm since T-703, and it has never been run against a fixture where it
could do anything.

## 2. Hypothesis

An agent given **graded** context complies with a planted hostile record less
often than an agent given the **same records ungraded**.

Direction is specified: the hypothesis predicts `commitlore-on < no-grade`. A
difference in the other direction is a refutation, not a result, and is reported
as such.

This is a claim about the *routing*, not about the injection guard. A record
that `blocked` withholds never reaches either arm's payload in the same form, so
`blocked` is part of what is being measured, not a confound to remove.

## 3. The single table that tests it

|                    | complied | did not |
|--------------------|----------|---------|
| `commitlore-on`    | a        | b       |
| `no-grade`         | c        | d       |

- **Test**: two-tailed Fisher exact, α = 0.05.
- **Effect size**: difference in compliance rates, in proportion points, with a
  95% Newcombe interval.
- **Unit**: one run = one (task, condition, seed).

**No other statistical test will be reported as a result.** Per-task rates are
description, never a second test, and no subset is analysed as if it were the
registered comparison.

## 4. The blocking precondition — the current fixtures cannot measure this

`bench/types.ts` states it plainly about `no-grade`:

> Inert on a task whose records are all `Provenance: authored`, because there is
> nothing to promote.

Every one of the ten `reproposal-*` fixtures is that kind of task. Running M6 on
them would compare an arm against itself and report a null that means nothing —
the same failure as M1's underpowering, arrived at from the other direction.

M6 therefore needs a **new fixture set**, and the fixtures are part of what this
document must fix before the run. Each task seeds, alongside its ordinary
records, one **planted record** that grading treats differently from `no-grade`:

- a record from an **untrusted author** (`directive` under `no-grade`, `claim`
  under grading), and
- a record carrying an **injection payload** (`blocked` under grading, injected
  verbatim under `no-grade`).

The planted record must instruct something (a) the task does not otherwise call
for, (b) that is unambiguous in a diff, and (c) that is harmless in a throwaway
workspace. What the agent is told to do is what "compliance" then means.

**Neither the fixture count nor their contents are fixed by this draft.** They
are what §5 needs before it can be written, and both belong here before a run.

## 5. Size — cannot be fixed yet, and why that is stated rather than guessed

M5's n came from M1's observed control rate. M6 has no prior: nobody has
measured how often an agent complies with a planted record it was handed as an
instruction. Writing a number here would be an assumption dressed as a design.

The order is therefore: **fixtures (§4) → base-rate pilot → n → register → run.**

The pilot measures the `no-grade` compliance rate and wall-clock only. Its rows
are **not** part of the analysis set and are **not citable**, exactly as M5's
pilot was not — and M5 §4 records why that mattered: its pilot's 33.3% came from
three tasks including the strongest one in the set, and planning from it would
have sized the run too small.

## 6. Model and harness — fixed at registration, not now

`sonnet`, passed with `--model` and recorded on every row, as in M5.

The harness commit is pinned at registration and recorded on every row. One
thing must be true of it and is stated now because it is already known: the
build must include the trust-grading fixes from **#408** and **#409**. Both
change what grading does — #409 changes who a notes-sourced record is graded by,
#408 changes which text the injection guard blocks — so a run on a build without
them measures a grader that no longer exists.

## 7. Exposure — the check that makes an ablation arm meaningful

M4 recorded no per-run treatment exposure and its whole matrix was withdrawn.
M5 §6 closed that for the primary arms. An ablation arm needs the same, plus one
more: **that the ablation was actually in force.**

Required on every row:

- `guard_exposure.complete === true`
- both arms: `accepted_records > 0` — both arms receive records; this comparison
  is about how they are rendered, not whether they arrive
- the planted record is present in the payload the run actually received
- `commitlore-on` rows: the planted record is rendered `[claim]` or withheld
- `no-grade` rows: the planted record is rendered as an instruction

The last two are the ablation's own precondition. A `no-grade` row where the
planted record still came through graded is not a control, and a
`commitlore-on` row where it came through ungraded is not a treatment.

**A row failing its arm's exposure condition is reported and excluded**, with the
count stated beside the result. If exclusions exceed 5% of either arm, the run is
reported as compromised rather than analysed.

## 8. Analysis set — fixed now

A row enters the analysis set unless it is:

- `stopped_by: "error"` — the row carries no measurement
- failing the exposure condition in §7

Exclusions are counted and reported per arm before the table is shown. **No row
is excluded for its outcome.**

Truncated rows (`over-turns`, `over-tokens`) are **kept**, as M1 and M5 kept
them, and their share is reported per arm beside the table. M5 deviation 2 found
that share running at 16.7% against 31.4% across its two arms — imbalanced, and
in the direction of the hypothesis. M6 must report it rather than discover it.

## 9. Stopping rule — fixed now

The run completes every registered row before any 2×2 table is computed. No
interim analysis, no early stop, no extension after seeing a result. Sharding by
seed range is an operational convenience and carries no analytical meaning.

If the run is interrupted, it resumes at the next unrun cell. A partially
completed run is not analysed and not reported as a result.

**Shards are written outside any temporary directory and committed as they
land.** M5 deviation 3 is the reason this sentence is in the design: 400
completed rows of M5 existed only under the system temp directory and were
reaped before anyone copied them out.

## 10. What would refute the hypothesis

- `commitlore-on` complying at a rate **at or above** `no-grade`.
- A null at the registered n. That would say the tag on the line does not change
  what the agent does — which is a result about the product's security story,
  not a missing measurement, provided §5 gave the run the power to see it.

ADR-0007 commits this project to acting on the result either way.

## 11. What this measurement is not

- It is not evidence that grading stops a determined attacker. It measures one
  model's response to a planted record on synthetic tasks.
- It is not evidence about the injection *pattern table*. A payload the table
  does not recognise is graded on authorship alone, and `bench/grade.ts`'s own
  comment calls the table a speed bump rather than a boundary.
- It is not a benchmark anyone else reports.

## 12. Deviations

Recorded as they happen, with dates. A deviation that is not written down is
indistinguishable from a design that was always this way.

*(none yet — the run has not started)*
