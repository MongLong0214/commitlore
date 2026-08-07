# CDEB-P result

**Study:** `cdeb-p-01` · 16 runs · 4 tasks × 2 arms × 2 repeats
**Snapshot:** `fdc454f4` (pre-pilot `dev`) · **same-history mismatches: 0 across all 16**
**Registered:** `bench/cdeb/PREREGISTRATION-CDEB-P.md`, frozen in `r-cdebp01` before any run

> **This produces no citable verdict.** One repository, four tasks, six usable
> runs per arm, a local evaluator. No claim gate is evaluable and no number here
> may reach a public surface (preregistration §8).

---

## The matrix, as it came out

| task | arm | stop | revived | records delivered |
|---|---|---|---|---|
| verify-scope | off ×2 | completed | no | — |
| verify-scope | on ×2 | completed | no | **0** |
| lifecycle-fourth-value | off ×2 | **timeout** | yes | — |
| lifecycle-fourth-value | on ×2 | **timeout** | yes | `r-secondtie` |
| pending-rm-force | off ×2 | completed | **yes** | — |
| pending-rm-force | on ×2 | completed | **yes** | **`r-gcunstageable`** |
| guard-blocking-policy | off ×2 | completed | no | **0** |
| guard-blocking-policy | on ×2 | completed | no | **0** |

Completed runs only — the analysis set the stopping rule permits:

| arm | n | revived | decision-safe success | provider token volume |
|---|---:|---:|---:|---:|
| OFF | 6 | 2 | 4 | 7,572,744 |
| ON | 6 | 2 | 4 | 10,984,173 |

---

## The three registered questions, answered

### 1. Is the mechanism observable? **Yes.**

OFF revived a rejected decision in **2 of 6** completed runs, and in **4 of 8**
counting the timed-out task. The registered threshold was ≥ 2/8.

Per §6 this means: *the mechanism is observable; CDEB v1's task criteria work;
proceed to corpus construction.* A fresh agent does re-propose what this
repository already ruled out, at a rate the §16.5 mechanism gate could detect.

### 2. What does a run cost? **The ON arm costs 45% more.**

```
T_on / T_off  =  10,984,173 / 7,572,744  =  1.45
```

The registered consequence was: *`T_on/T_off` > 1.2 → the token gate needs
> +20pp and should be dropped from the full-headline conjunction, or its
threshold re-registered.*

1.45 is well past that. Working it through the identity in the preregistration:

```
TVPDSS(ON)/TVPDSS(OFF) = (T_on/T_off) × (S_off/S_on)
required S_on/S_off for a 15% reduction = 1.45 / 0.85 = 1.71×
```

At an OFF safe-success rate of 50%, **ON would have to reach 85.5%** — a
+35.5 point lift — to clear a gate whose sibling asks for +10. The §16.4 token
gate as registered is effectively unreachable, and §16.6's full commercial
headline is governed by it.

### 3. Does the harness work? **Yes, with one instrumentation gap.**

Same-history mismatches were zero across all sixteen runs. The snapshot froze
where it was pinned. The shipping hook delivered real records. The oracle
answered on the final tree. Provider usage was captured on every run.

The gap: the exposure counter counts **deliveries**, not **opportunities**. A
zero can mean "the hook never fired" or "the hook fired and the path had no
records", and this harness cannot tell them apart. CDEB v1 §9.5 requires that
distinction and CDEB-05 must build it.

---

## What the pilot found that it was not looking for

### A task can be too large to measure, and this one was

`lifecycle-fourth-value` hit the 15-minute wall in **all four runs** — 903, 902,
902, 902 seconds. Both arms timed out, so the task contributes nothing to any
comparison while consuming a quarter of the study.

PRD §4.6 asks for "bounded implementation … completable in one fresh agent
session" and had no way to check it. **Task qualification needs a wall-clock
probe per task before the corpus is sealed**, or CDEB v1 will seal thirty tasks
of which some fraction cannot finish.

### Delivering nothing is a common ON-arm outcome

For **two of four tasks** — `verify-scope` and `guard-blocking-policy` — the ON
arm received zero records. Those runs are ON by assignment and OFF in substance.
Intention-to-treat keeps them, correctly, but it means the pilot's real evidence
about delivery changing behaviour comes from **one task and two runs**.

§4 qualification must add: *the path the task's natural solution edits actually
carries the record*, verified before sealing rather than discovered afterward.

### The one observation that matters most

In `pending-rm-force`, the ON arm **received `r-gcunstageable` — the record that
ruled out exactly the `--force` escape the task invites — and built the force
escape anyway. Both repeats.**

n = 2. This establishes nothing statistically and is not a result. It is the
single most important thing to look at next, because it is a direct observation
of the mechanism failing on the case the product exists for. Whether it
generalises is what a powered study is for; that it happened at all is why one
should be run.

---

## What follows

**Build CDEB v1 — after three registered parameters are corrected.**

| finding | change required before v1 runs |
|---|---|
| `T_on/T_off` = 1.45 | re-register the §16.4 token threshold against measured overhead, or drop token efficiency from the §16.6 conjunction |
| 1 of 4 tasks unfinishable | add a per-task wall-clock probe to §4.6 qualification |
| 2 of 4 tasks delivered nothing | add "the edited path carries the record" to §4 qualification |
| exposure conflates opportunity and delivery | CDEB-05 must separate them (§9.5) |

None of this is reachable by reading the protocol more carefully. All four are
things only a run produces.

**And the corpus still does not exist.** The pilot answers *whether to build*,
not *whether it can run*. §3.3 wants five repositories that are not this one,
and those require users. CDEB v1 stays downstream of adoption.

---

## Deviations

### Deviation 1 — one outcome was seen before the study ran (2026-08-07)

Recorded in the preregistration. The smoke run for `pending-rm-force / on / r1`
produced a complete row and I read it. The cell was re-run fresh; the smoke row
sits in a scratch path under its own study id.

### Deviation 2 — harness validation findings (2026-08-07)

Recorded in the preregistration.

### Deviation 3 — rows carry two harness commits (2026-08-08)

Rows 1–4 carry `6cb710c9`; rows 5–16 carry `384c40e0`. A commit landed in the
worktree the runner reads `HEAD` from while the study was in flight.

**The executed harness was byte-identical across the two.** The commit touched
`bench/cdeb/verify.mjs` and the preregistration; `run.ts`, `tasks.ts`,
`repository-bundle.ts`, `hooks-settings.ts` and `git.ts` are unchanged between
`6cb710c9` and `384c40e0`, verified by diff. The snapshot under measurement is a
pinned sha and did not move.

It should not have happened, and the rule that prevents it is: **do not commit
in the worktree a running study reads `HEAD` from.** An earlier branch switch in
the same worktree was caught before any row absorbed it.

### Deviation 4 — one task produced no usable runs (2026-08-08)

`lifecycle-fourth-value` timed out in all four runs. Its rows are kept and
reported; they are excluded from the completed-only analysis by the registered
`stop_reason == completed` rule, not by a post-hoc decision.
