# CDEB-P — the pilot that decides whether CDEB v1 is worth building

**Status:** registered, not yet run
**Protocol:** subordinate to `bench/cdeb/PRD.md` v1.2
**Produces:** no citable verdict, by construction (§8)

---

## 1. Why a pilot exists at all

CDEB v1 is a 180-run confirmatory study with three claim gates. Reviewing its own PRD against this repository turned up two gaps that no amount of additional protocol text can close, because both are empirical:

**The design's power was never stated.** M5 registered 1,160 measurements to reach 80% power. CDEB registers 180 runs to judge three gates and says nothing about what effect size it can detect. Simulating the registered analysis — 30 tasks, 3 repeats, the §16.3 paired bootstrap, the ≥10pp threshold and CI-lower-bound-above-zero rule:

| true lift | P(gate passes), OFF=0.40 | OFF=0.55 |
|---:|---:|---:|
| **10pp** (the threshold itself) | **0.30** | **0.31** |
| 15pp | 0.55 | 0.58 |
| **20pp** | **0.78** | **0.84** |
| 25pp | 0.93 | 0.96 |
| 30pp | 0.98 | 0.99 |

A study whose true effect sits exactly on its own threshold fails seven times in ten. CDEB certifies effects of roughly 20pp and up; §16.7 says so in words and this table says so in numbers.

**The token gate is stricter than the performance gate, and the PRD does not say so.** Since

```
TVPDSS(ON)/TVPDSS(OFF) = (T_on/T_off) × (S_off/S_on)
```

and ON spends *more* tokens per run (it injects context), the ≥15% reduction gate demands that the success lift outrun the injection overhead:

| injection token overhead | required S_on/S_off | if OFF=50%, ON must reach |
|---:|---:|---:|
| 0% | 1.18× | 58.8% |
| 10% | 1.29× | **64.7%** (+14.7pp) |
| 20% | 1.41× | 70.6% (+20.6pp) |

At a plausible 10% overhead the token gate needs +14.7pp — more than the performance gate's +10pp. The §16.6 full headline is therefore governed by the token gate, not by three independent tests.

**Both tables are ratios of quantities nobody has measured.** `T_on/T_off` and the OFF-arm base rates are exactly what a pilot returns.

**And the corpus does not exist.** §3.1 requires records created during ordinary work before cutoff; §3.3 requires five repositories and excludes CommitLore's own. This repository is 12 days old and has two authors, both the same person. Five external repositories that have used CommitLore in ordinary work long enough to yield six qualifying decisions each require users, which require a release. CDEB v1 is structurally *downstream* of adoption and cannot be the thing that produces it.

## 2. What CDEB-P asks

Three questions, in order of what they block:

1. **Does a fresh agent revive a rejected decision at all, and how often?** §16.5 needs ≥10 revivals in 90 OFF runs (≥11%). If the true OFF revival rate is near zero, the mechanism gate can never fire and the task-construction criteria of §4.3–4.4 need rework before anything else is built.
2. **What does one run cost?** Wall time and provider tokens per run, per arm — which gives `T_on/T_off` and turns the second table above from a shape into a number.
3. **Does the harness work end to end?** Same-history materialization, the real shipping hook, a deterministic oracle on the final tree, and a row that survives the CDEB-01 verifier.

## 3. Deliberate departures from CDEB v1, and their cost

| CDEB v1 | CDEB-P | Cost |
|---|---|---|
| 5 named repositories | **1** — CommitLore itself | Below Tier B. No repository-level generalization is available, not even the weak kind. |
| 30 sealed tasks | **4** | No claim gate can be evaluated. |
| 180 runs | **16** (4 × 2 arms × 2 repeats) | Estimates only; every interval will be wide and is reported as such. |
| Pinned OCI runtime, sandboxed evaluator | Local process isolation, evaluator owned by the harness | A determined candidate could tamper with an oracle. Acceptable because no verdict is produced and no adversary exists — a property CDEB v1 must not rely on. |
| Sealed corpus with public commitment | Prompts written before any run, committed after | Weaker than a hash commitment; the ordering is preserved but not provable to a third party. |

Every one of these is a reason CDEB-P produces no citable number. That is the point: it is an instrument for deciding, not for claiming.

## 4. What is preserved, because these are not optional

- **Same repository state in both arms**, proved by `bench/cdeb/freeze/repository-bundle.ts` (CDEB-02), not asserted.
- **The real shipping delivery path.** ON runs `commitlore inject --hook-input`; nothing renders context for the benchmark.
- **Deterministic oracle on the final tree**, never on the transcript.
- **Intention-to-treat.** A run where the product failed to deliver stays in.
- **No reroll after the first model turn.**
- **No peeking.** Progress output carries no outcome field.
- **Rows written to the repository as each task completes** — not to a scratch directory. M5 lost 400 completed rows to a temp reaper (M5 deviation 3).
- **A null result is published in the same format as any other.**

## 5. Design

**Repository.** CommitLore at a frozen snapshot, bundled by CDEB-02, materialized fresh per run.

**Tasks.** Four, each built from a `Ruled-out:` declaration already in this repository's history — written during ordinary development by a developer who was not constructing a benchmark. 87 such declarations exist; the four chosen are the ones that admit a deterministic oracle over the final tree, and each is pinned by a good/bad control pair in `test/cdeb-pilot-tasks.test.ts`. Each task must satisfy §4.2 (natural prompt, no mention of CommitLore or of the rejected approach), §4.3 (the rejected path is what a competent fresh agent would plausibly pick), §4.4 (the rejected path is functionally viable), §4.5 (a deterministic oracle exists over the final tree).

**Conditions.** ON = the shipping PreToolUse inject hook, with the trusted author `init` now records, so records arrive `[directive]` (#415). OFF = no hook, identical everything else. Capture surfaces are installed in neither arm (PRD v1.2 §2.3).

**Repeats.** 2. **Runs.** 16 — 8 per arm.

**A confound this design cannot remove.** The agent works inside the repository of the product being measured. It can read `src/core/inject.ts`, see how delivery works, and in the ON arm can in principle recognise where its context came from. CDEB v1 avoids this by excluding CommitLore's own repository from the corpus (§3.3); CDEB-P cannot, because no other repository qualifies yet. Prompts name no product and no `commitlore` command — `pending rm` rather than `commitlore pending rm` — but a determined reader of the tree still learns what it is working on. Recorded here rather than mitigated, and it is one more reason a pilot number is not a result.

**Outcome per run.** `functional_pass`, `rejected_decision_revived`, `stop_reason`, provider token categories, exposure.

## 6. What each answer means, stated before the numbers exist

| finding | what follows |
|---|---|
| OFF revival ≥ 2/8 | the mechanism is observable; CDEB v1's task criteria work; proceed to corpus construction |
| OFF revival 1/8 | borderline; the §16.5 threshold of 10/90 is a coin flip; task criteria need sharpening first |
| OFF revival 0/8 | the tasks do not create the failure CommitLore prevents; **CDEB v1 does not get built** until §4.3–4.4 are reworked |
| `T_on/T_off` > 1.2 | the token gate needs > +20pp and should be dropped from the full-headline conjunction, or its threshold re-registered |
| any run's usage unrecoverable | the ledger is not ready; CDEB-05 needs work before v1 |

## 7. Stopping rule

All 16 runs complete, or the study is incomplete and reports as incomplete. No partial analysis. If a run cannot produce a row, it is recorded as a failure to produce a row — never replaced by a rerun after its first model turn.

## 8. What CDEB-P may never be used for

- Any number in the README, the release notes, or any public claim.
- Any statement of the form "CommitLore improves/does not improve X."
- Any input to CDEB v1's corpus. Its four tasks are disposable and are excluded from the eventual sealed corpus by name (PRD §22.4).

Its rows carry `simulated: false` but live under a `pilot/` path the CDEB-01 verifier treats as outside any study, so a pilot row can never be counted into a verdict by accident.

## 9. Deviations

Recorded here as they happen, with dates, in the M5 style.

*(none yet — the study has not run)*
