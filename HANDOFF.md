# Handoff — CommitLore · gitseed · repo-factory

> Nothing checks that this document stays current. The previous version was false for 25 commits,
> and nothing caught it. **Run the commands in §1 yourself before trusting any number written here.**
> The canonical source is `docs/ROADMAP-TO-DONE.md`; this document is its entrance.

---

## 0. Delegation failures — miss this and lose an hour

**The delegation mechanism changed.** It is not a subagent (Task/TeamCreate), but
`codex exec -m gpt-5.6-sol|terra`. The owner directive from 2026-07-27 supersedes the previous Codex
ban. The skill document (§Phase 5-D) still says Claude-only; that part is
stale.

**Check liveness only through file changes.** A delegated process appears as `codex exec` in `ps`,
but that does not show whether it completed. Only two signals are valid:

```bash
ps -eo pid,etime,command | grep "[c]odex exec"    # is it alive?
git -C <repo> status --porcelain                   # is it actually writing?
```

The output file remains **empty** until completion (buffering). 0 bytes is not a failure signal.

**4 delegation failures that actually happened**

| Symptom | Cause | Check |
|---|---|---|
| Test count below baseline (1108→943) | Partial collection while another delegation writes to the same worktree | Require `Test Files N passed` too |
| No files changed | `--cd` points to an unwritable directory | Confirm the spec target matches `--cd` |
| Every number is wrong | Sandbox has no `gh` authentication or network | Use `--sandbox danger-full-access` or accept "cannot measure" |
| Cut off at 10 minutes | Bash tool limit | `run_in_background: true` |

**Never run three or more concurrently.** 1 per repository; parallelize only across different repositories.

---

## 0-b. Other traps — every one happened

**Passing local tests does not mean CI passed.** While CI was red for 8 consecutive commits,
it was incorrectly reported "green" five times. The local suite passed on all 8 commits.

```bash
gh run list --repo MongLong0214/commitlore --limit 1 --json headSha,headBranch,conclusion
```

**The branch model changed.** The default is `dev`; `main` is protected and accepts merges only from
`release-*` and `hotfix-*`. Cut work branches named `feat-issue-<id>` from `dev`. `--no-ff` is required.

**No `git add -A`.** Two documents were swept into unrelated commits. Specify paths.

**No `git reset --hard`.** Three uncommitted files disappeared. Especially while delegation is running.

**`$?` after a pipe belongs to the pipe.** The exit code was misread twice after `cmd | sed`.

**Delegation reports are claims.** One report said 943 passed against a 1108 baseline (partial
collection during concurrent execution). Get `Test Files N passed` too, and **verify a fix against
the original incident, not its own test.**

**1 delegation per repository.** Different repositories may run in parallel; the same worktree is sequential.

Full list: `~/.claude/skills/repo-factory/references/self-improvement-loop.md`

---

## 1. Commands to verify current state yourself

```bash
# Phase 4 gates for both repositories — must exit 0
python3 ~/.claude/skills/repo-factory/scripts/phase-gate.py 4 \
  --repo MongLong0214/commitlore --path ~/projects/annals
python3 ~/.claude/skills/repo-factory/scripts/phase-gate.py 4 \
  --repo MongLong0214/gitseed --path ~/projects/gitseed

# CI — this is what counts, not a local run
gh run list --repo MongLong0214/commitlore --limit 1
gh run list --repo MongLong0214/gitseed --limit 1

# Tests
cd ~/projects/annals && npx vitest run
cd ~/projects/gitseed && python3 -m pytest tests/ -q
```

---

## 2. Owner-set decisions — not negotiable

| Item | Decision |
|---|---|
| Cost | **Free forever.** No paid tier, SaaS, or charges |
| Originality | Do not revive retired vocabulary — Constraint / Rejected / Directive / Scope-risk / Reversibility / Confidence / Tested / Not-tested / Related |
| Delegation | Code changes use `codex exec -m gpt-5.6-sol` or `-m gpt-5.6-terra`. The 2026-07-27 directive supersedes the previous decision banning Codex |
| Role | The operator is CTO — final judgment, deep inspection, and review. Does not edit code directly |
| External action | Do not perform real star/follow actions. Keep the approval contract and dry-run default |

### CTO review gate — every ticket, no exceptions

A delegation's "completed" is not approval. Pass all six items **yourself** before committing.

| # | Item | What to do |
|---|---|---|
| 1 | Compare evidence for every AC item | For each checkbox, ask "what proves this?" Without evidence, it is incomplete |
| 2 | Run build and tests yourself | Do not trust "passed" in a report |
| 3 | Adversarial review | How can it break? Especially whether it violates the project's own principles |
| 4 | Scope inspection | Changes beyond the directive, unnecessary abstractions, speculative design for the future |
| 5 | Consistency | Whether it conflicts with public documents or ADR decisions |
| 6 | Was the decision recorded? | Are rejections and constraints in trailers? Does `validate --commit HEAD` return 0? Was `guard --proposal` run **before starting**? |

On failure, do not say "try again." Give a rework instruction that states **what is wrong, why,
and what state will pass**. Do not repeat the same instruction 3 times.

**Item 2 paid off most in this session.** It caught a delegated fix reported as passing that did not
catch the original incident, a case that recorded sandbox conditions as project state, and a case that
reported YAML parsing as workflow verification.

---

## 3. Three goals and what remains

Canonical source: `docs/ROADMAP-TO-DONE.md`

**Goal 1 — CommitLore production-ready.** All 7 production re-review blockers are closed.
2 phases remain: the plugin manifest redeclares conventional-location `hooks` (double registration likely,
no manifest tests) · **design and run M4** + every release-gate item.

**Goal 2 — gitseed v0.2.** PRD received; 11 ADRs, tickets, and issues organized.
**ADR-0005 reverses the PRD order** — the M0 backtest comes before scoring machinery.

**Goal 3 — repo-factory.** `phase-gate.py` was demonstrated in both directions (caught 6 real gaps,
exposed and then fixed 1 false failure). Remaining: raw tracebacks in 2 scripts, the gate covers
only Phase 4, and the gate is absent from the CI runner.

---

## 4. What you must know about the benchmark

**M3 is void.** While the hook read `dist/` from the working copy, the operator rebuilt it 8 times
in 12 hours. The treatment changed during the run (`bench/PREREGISTRATION.md` §15).
Preserve the data in `bench/results/*-invalidated*`. **Do not cite it as a result.**

**All published numbers were withdrawn.** No dataset can prove which binary created it.
The README in 4 languages carries the withdrawal text, enforced by `scripts/check-readme-numbers.mjs`
— **it fails if a provenanced dataset exists while the README still shows the withdrawal state.**

**The reason M1 and M2 were null was measured.** Of 10 tasks, **7 have a control base rate of 0**.
Even without CommitLore, the agent does not propose the rejected approach, so there is nothing to block.
Power is governed by the base rate, not sample size (at 20%, n≈98 per arm; at 80%, 11).

M4 runs a **task qualification round** first — run only the control arm to measure base rates,
and reject low-rate tasks without running the treatment arm at all. Because the treatment arm is unseen,
this is not p-hacking.

---

## 5. Dogfooding state

The depth at which gitseed uses CommitLore is the scope of CommitLore's real-use verification.

| Path | Status |
|---|---|
| `validate` (commit-msg hook) | Active for a long time — 3 defects came from here |
| `inject` (PreToolUse) | Connected (`.claude/settings.json`) |
| `guard` | **Real-use trigger confirmed** — 3 rejected approaches were caught in actual proposals |
| MCP | **Confirmed** — `serverInfo: commitlore 0.1.0`, 3 tools respond |
| notes mirror | refspec configured and ref exists |
| CI | Job added; does not pass silently when the tool is absent |

**CommitLore #53 emerged during connection** — mirrored notes disappear from `sources` and are
misread as "not reflected." This is the design of `dropMirroredNotes`, not a defect, but an experienced
operator actually misread it. This is the sixth case this week where one expression covers two facts.

---

## 6. Canonical vocabulary (SPEC §3)

`Limit` · `Ruled-out`(`alternative | reason`) · `Warn` · `Blast`(local|module|system) ·
`Undo`(easy|costly|permanent) · `Certainty`(firm|tentative|guess) · `Verified` ·
`Unverified` · `Record-Id`(`r-[a-z0-9]{6,}`) · `Follows` · `Supersedes` ·
`Expires` · `Evidence` · `Provenance`(authored|inherited &lt;sha&gt;|reconstructed|unknown) ·
`CommitLore-Version` · `X-<Name>` extensions.

### Rejection fixtures — values the validator must block

These are actual values from `spec/fixtures/invalid/`. If you touch the parser, first check that
they are still rejected.

| Fixture | Value | Violation |
|---|---|---|
| `01-enum-blast` | `Blast: wide` | enum — only `local\|module\|system` |
| `02-format-ruled-out-no-pipe` | `Ruled-out: pointless without a pipe separator` | format — missing `\|` from `alternative \| reason` |
| `03-unknown-key` | `Constraint: must ship by friday…` | unknown-key — **retired old vocabulary. Do not revive** |

The third is especially important. `Constraint:` was retired by the originality decision,
and the fixture ensures it is not revived.

**Every free-text key is an injection surface.** The scanner operates from an exclusion list —
exclude only enum, id-shaped, and semver fields; scan everything else. An allowlist created this bug,
and failing so that a new key goes unscanned is the dangerous direction.
