# Final roadmap — three goals, decidable completion conditions

> Basis for update: all 7 production re-review blockers closed, gitseed v0.2 PRD received, branch
> model migration complete.
>
> Every step in this document is **decided by a command**. Do not put an item here if a command
> cannot decide it. A checklist that failed this rule caused gitseed to skip three
> entire artifacts.

---

## The three goals form one loop

```
        Factory Skills (Goal 3)
     Phase gates · branch model · execution protocol
              │ build                     │ enforce the protocol
              ▼                           ▼
       gitseed (Goal 2)  ──record──▶  CommitLore (Goal 1)
      v0.2 Discovery Radar        trailers · guard · inject
              │                           │
              └──── defects in real use ─────┘
                        │
              Once is a bug; twice is a skill defect
```

**Only goal 3 is a function of the other two.** The skill does not improve unless more projects are built.

Procedure: `~/.claude/skills/repo-factory/references/self-improvement-loop.md`

---

## Goal 1 — CommitLore production-ready

Current: `dev` default branch, CI green, 1171 tests/33 files, 10/10 review blockers closed.

### Remaining phases

| Phase | Work | Gate |
|---|---|---|
| **3** | Plugin manifest redeclares conventional-location `hooks` — double registration likely. No manifest tests | Manifest suite green + clone contains every declared file |
| **4** | ~~Design and run M4~~ **Executed; withdrawn as guard evidence.** Repair and verify context delivery before a new guard experiment | A treatment arm demonstrably receives records, then all 6 gate sections pass and CI is green at that commit |

### M4 — valid data, no delivered treatment

**Executed, with clean provenance.** `bench/PREREGISTRATION.md` §16 ran 8 qualifying
tasks × 7 seeds × 2 labels = 112 rows, all with one `harness_commit` and one
`dist_digest`. But both labels were defined by receiving records and none of the
112 transcripts has injected context. The recorded 62.5% and 73.2% rates, and
their corrected paired/clustered analysis, remain true about the data and say
nothing about the guard. M4 is neither retracted nor invalidated: the failure
is upstream of provenance, because the harness faithfully recorded two arms
without records. See `bench/VERDICT-M4.md` and [#122](https://github.com/MongLong0214/commitlore/issues/122).

**Diagnosis (measured)**: of 10 tasks, **7 have a control base rate of 0**. Even without CommitLore,
the agent does not propose the rejected approach. Tasks with nothing to block made up 70% of the
aggregate. The null means not "no effect," but **"most of the measuring instrument was empty."**

Power is governed more by the base rate than the sample. For an effect that cuts the rate in half, at 80% power:

| Control base rate | Required n per arm |
|---|---|
| 20% (current) | 98 |
| 50% | 29 |
| 80% | 11 |

**Three design changes**

1. **Task qualification round.** Before hypothesis testing, run only the control arm to measure base rates.
   Reject low-rate tasks **without running the treatment arm at all**. The decision does not inspect
   the treatment arm, so this is not p-hacking. Fix the threshold and procedure in preregistration §16 first.
2. **Source tasks from real decisions.** The 7 options rejected by gitseed v0.2 PRD §35 are wrong answers
   an agent would naturally choose — "let the LLM decide the final ranking" takes far less code.
   Their base rate is expected to exceed synthetic tasks (an expectation, not a measurement).
3. **Add outcome variables.** Re-proposal rate counts only "did not do it." Candidates: violation of a recorded `Limit:`,
   an alternative design that cites the rejection reason, asking rather than guessing, **whether the reviewer had to
   say "we tried that."** The last may be the actual business value, in which case the current measurement axis
   is wrong.

**M3 is void.** While the hook read `dist/` from the working copy, the operator rebuilt it 8 times
(preregistration §15). Preserve the data as `*-invalidated`; do not cite it as a result.

### Completion condition

Every section of `RELEASE-GATE.md` has been executed and passed, CI is green **at that commit**,
and every remaining issue is a feature on a defensible axis rather than a defect.

**A positive benchmark is not required.** M4 did not apply its treatment, so it
establishes nothing about agent behavior. The product claim is not "makes agents
better," but **"binds decision history to git and preserves it in a
human-verifiable form."** The latter is already proven by tests and remains
true independent of the benchmark.

---

## Goal 2 — gitseed v0.2 Discovery Radar

Current: v0.1 complete (151 tests, CI green, Phase 4 gate exit 0, issue #5 closed).
v0.2 PRD received — 6 milestones.

### Milestones (PRD §32)

| # | Name | Core output |
|---|---|---|
| 1 | **Truthful Core** | ports/domain/application separation · run artifact · model smoke connection |
| 2 | Persistence | SQLite adapter · migration · replay |
| 3 | Categories | CategoryPack schema · validator · deterministic classifier |
| 4 | Scoring | Quality/Risk → Momentum → Undervalued → recommendation gate |
| 5 | Product CLI | radar · explain · export · init/doctor |
| 6 | Seeded at | immutable discovery event · lifecycle · static HTML |

**Milestone 1 is the keystone.** Everything else depends on the port/adapter boundary.

### Invariants to preserve (PRD §3.1)

INV-001 incompleteness is not silent · INV-002 high risk blocks recommendation · INV-003 unevaluated items
are not deleted · INV-004 external writes require Approval · INV-005 dry-run by default ·
INV-006 discovery history is immutable · INV-007 deterministic facts > model prose · INV-008 every score
has a version · INV-009 backtest is not live · INV-010 expose evidence coverage.

INV-004·005 are already implemented and verified (pty cycle, 5 mutations). The rest are in v0.2 scope.

### Completion condition

The Phase 4, 5, and 6 gates each exit 0, CI is green, and there is a **record of the product
actually completing one cycle**. Decide v0.2 by the EPIC A~G acceptance criteria in PRD §30.

---

## Goal 3 — factory skill

Current: SKILL.md (6 phases, 11 invariants) · 9 references · 3 scripts.
`phase-gate.py` was demonstrated in both directions — caught 6 real gaps, exposed and then fixed 1 false failure.

### What remains

| Item | Why |
|---|---|
| `create-issues.py` and `verify-citations.py` produce raw tracebacks on directories and unreadable files | Discovery complete (STATUS.md). Fix in a separate ticket — mixing discovery and the fix in one commit lets the fix skip review |
| The gate covers **only Phase 4** | 11 invariants were created but applied to only one phase. Phase 5 and 6 are next |
| `phase-gate.py` lives in `~/.claude/skills/`, so it is **absent from the CI runner** | CI use requires vendoring. Nobody is doing it |

### Completion condition

Every **recurring defect pattern** discovered while building two or more projects has become a gate
or invariant, and each gate has been demonstrated to **fail on a real gap and pass in a healthy
state**.

---

## Rules for every phase — every one came from a real incident

1. **1 delegation per repository.** Concurrent execution produced a false test count (943 against
   a 1108 baseline) and mixed diffs. Different repositories may run in parallel.
2. **Specify paths when committing.** `git add -A` swept documents into unrelated commits twice.
3. **Do not write "green" before checking CI.** This was violated five times in one day, including
   in the commit that created the rule.
4. **Delegation reports are claims.** A fix reported as passing failed to catch the original incident.
   **Verify a fix against the incident, not its own test.**
5. **Ask once more whether the verification target is the actual running artifact.** This mismatch
   happened six times in four days — local↔CI, commit hash↔bytes, entry-point hash↔module, YAML parse↔workflow acceptance,
   checklist↔stop line, sandbox condition↔project state.

---

## Branch model (applied to both repositories)

| Branch | Role | Cut from | Merge into |
|---|---|---|---|
| `main` | Production. Tags land here. Protected | — | — |
| `dev` | Integration. Default branch | — | — |
| `feat-issue-<id>` | 1 feature | `dev` | `dev` |
| `bug-issue-<id>` | 1 bug | `dev` | `dev` |
| `release-<semver>` | Release preparation | `dev` | `main` + `dev` |
| `hotfix-issue-<id>` | Emergency fix | Tag on `main` | `main` + `dev` |

Merges always use `--no-ff`. After a release or hotfix enters `main`, run `git tag -a`.
**Because branch names require an issue ID, a wave cannot start without an issue.**
