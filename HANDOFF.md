# Handoff — CommitLore

Written 2026-07-29 by the outgoing session. Read this before touching anything.

> Nothing checks that this document stays current. A previous version was false
> for 25 commits and nothing caught it. **Verify any number here before citing it.**

## What this project is

CommitLore stores decision rationale as structured git commit trailers — the
limits, ruled-out alternatives, warnings and verification gaps behind a change —
so a developer or coding agent can recover *why* code looks the way it does
before changing it. Local-first: no hosted service, no vendor chat history, and
records travel with the repository.

The product's credibility is its measurement discipline. Every published number
must be re-derivable, and a number that cannot be is removed rather than
annotated. That rule cost several real figures this week and is the reason the
remaining ones can be trusted.

## Branch and merge conventions

`main` is protected. `dev` is the default and takes pull requests only. Branches
are `feat-issue-<n>` or `bug-issue-<n>`, merged with `--no-ff`.

Before opening or updating any PR, in this order:

```
git rebase origin/dev
npm run build                          # dist/ is committed and CI compares it
npx tsc -p tsconfig.json --noEmit
npx tsc -p bench/tsconfig.json --noEmit
npx vitest run
```

**Do not skip the bench typecheck.** The test suite does not cover it, CI does,
and it broke CI four times this week — every one a change that passed the full
suite. It also caught a conflict resolution that had silently deleted type
definitions while looking correct.

**`dist/` must be committed and match `src/`.** A rebase that discards it fails
CI with `Committed dist/ matches src/`.

Check CI against the *latest* SHA before merging. `gh pr checks` mixes results
across a branch's history, so a passing line may belong to an older commit:

```
gh run list --branch <branch> --limit 1 --json headSha,conclusion
```

I merged a PR whose checks were failing because I read a stale line.

## The measurement rules, and why each exists

Not style preferences. Each was learned by publishing something wrong.

**A check must state what it could not see.** `validate` reports
`shape ok · references not checked (no repository)` rather than just `shape ok`.
This is the defect class found nine times in other people's code and four times
in this project's own.

**Never publish an extrapolation as a measurement.** The 261× index ratio at 1M
commits is a log-log projection from three measured points and is labelled so
everywhere it appears.

**A ratio inherits its weakest input.** The break-even figures (7.7% / 46.2% /
184.6%) were removed from the README because the numerator was measured and the
denominator assumed — this project has never observed a prevented re-proposal, so
the cost of preventing one was estimated from unrelated runs.

**Benchmarks refuse a dirty checkout and a concurrent run.** Both guards exist
because both failures happened. The concurrency guard caught two stale processes
I had missed; its first version's false positive was fixed rather than deleted — a
guard that fires on correct usage gets removed, and then the thing it prevented
happens silently.

**Machine load contaminates timing.** A five-hour scale run was discarded after
running at load 40–70 on 12 cores. Check `uptime` before any wall-clock
measurement and record it with the result.

## Open issues

**#127 · #131 · #134** — three deterministic measurements whose code is written,
tested and merged, waiting only for a quiet machine. `#131` is the index scale
ratio, `#134` the write-side cost (CPAA), `#127` the economic case. When idle, run
`node --experimental-strip-types bench/deterministic.ts` and commit the generated
result pair. `SCALE_SIZES` was lowered to `[1k, 10k, 100k]` because 300k never
produced a row in two attempts; nothing rules 300k out, it just cannot hold the
other eight sections hostage.

**#140** — the important one. M1, M2 and M4 all measured final coding behaviour,
four layers downstream of anything this product controls. The proposed primary
claim is *fresh-agent decision recovery*: does a fresh agent recover a code path's
active decision context before its first edit? The rule that makes it credible is
that gold answers must not be derived from CommitLore records — two annotators
extract decision atoms from PR discussion and commit bodies, the gold is frozen,
and only then is the same information encoded as trailers. Otherwise it measures
whether CommitLore can read its own format.

**#157** — guard precision peaks at 42.9% and collapses to zero at threshold 0.55.
Tuning is ruled out by the measured curve. The remaining causes are the scoring
composition or the corpus size, and the corpus gates the other: 30 labelled
decisions give the 3/8 precision a 95% Wilson interval of 13.7%–69.4%, which
contains both "unusable" and "fine". Expand the corpus first. Do not change the
corpus and the scorer in one commit — that is how M4 became unanswerable.

**#161** — a committed benchmark result names the commit that produced it, and
every rebase of its own branch orphans that commit. It happened twice in one
sitting. Four options are on the issue; I lean toward recording a commit id *and*
a content digest with the fallback stating which it used, but it deserves a
decision rather than a default.

## What the numbers currently say

Established, re-derivable, safe to cite:

```
irrelevant decision context withheld    99.98%   (2 of 10,002, recall 2/2)
p95 query latency at 100k commits       29.4x    (13,282ms → 451ms)
hook overhead                           +186ms commit-msg, +102ms injection
guard precision, best threshold         42.9%    (95% CI 13.7–69.4%)
record-bearing commits, this repo       73.9%
```

The exposure figure is the strongest thing here. A lexical top-k baseline drops
half the relevant records once distractors exceed 100; path scope does not,
because it selects by structure rather than similarity. Say **"99.98% less
irrelevant decision context reached the model"** — never "99.98% token saving". It
measures exposure, not cost and not accuracy.

Not established, and the README says so:

```
token saving                  cost measured, benefit assumed
agent behaviour improvement   M1/M2/M4 all instrument failures
guard effectiveness           precision too low, corpus too small to tell
```

On rationale density: this repository's 73.9% record-bearing rate is *lower* than
the Linux kernel's 98.9% rationale-sentence rate (ICPC 2024). The claim is
addressability, not abundance — prose rationale exists widely and no machine can
query it. Never imply CommitLore produces more rationale than a disciplined
project.

## Why M4 could not answer its question

Three independent confirmations, each from a different direction:

- **#122** — guard exposure was never recorded, so no row can show the treatment
  was applied. `injected_context: null` is the *designed* signature of the hook
  delivery path, not evidence of failure; I got that wrong first and corrected it.
- **#121** — the registered outcome had zero variance. It counted `violation_if`
  matches, was 0 on all 112 rows, and `PREREGISTRATION.md` already called that
  clause instrumented-only.
- **#109** — applying the registered 4–5 of 6 qualification band to M4's own task
  pool leaves **0 of 8** qualifying. Four sat at the ceiling, four at or below the
  floor. The one-sided gate could not see this because four tasks cleared the floor
  *by being pinned at the maximum*.

Before registering M5: the pool needs tasks whose comparator rate lands inside the
band, and none exist. #137 raised each task's opportunity count from 1 to 7 and 8,
which was necessary and not sufficient — an agent that revives every alternative is
still at the ceiling, just a higher one.

## Traps that cost real time

**Judging whether a long process is alive.** I killed three healthy benchmark
runs. Instantaneous CPU is 0 while a parent waits on a child; accumulated CPU
(`ps -o time=`) barely moves for the same reason; the log only prints between
sections; and on macOS `tmpdir()` is `/var/folders/.../T/`, not `/tmp` — I watched
an empty directory. The reliable signal is growth of the scratch directory under
the *real* tmpdir, and even that pauses during query measurement, which uses CPU
and no disk. When in doubt, wait.

**Do not dispatch two workers to one worktree.** I did it three times — twice on
the same directory, once on the same files from different directories. Check other
worktrees' uncommitted files before assigning work.

**Conflicts in `bench/deterministic/*`** are almost always additive: each side
registers a new section in the same four files. Keep both. Do not resolve by
stripping conflict markers and keeping what remains — that silently drops the other
side's definitions and only the bench typecheck notices. Check rendered section
numbers afterwards; two merges in a row produced duplicate `## 7` and `## 8`
headings that git could not see.

**EPIPE.** `spawnSync` with `input:` can fail with EPIPE while `status`, `stdout`
and `stderr` hold real values from a process that ran to completion. Checking
`error` before `status` discards them. Fixed in `src/core/git.ts` and
`src/commands/doctor.ts`; 15–25% hit rate on Linux, 0% on macOS, so it only ever
appears in CI. If you add a `spawnSync` with `input:`, prefer `status` whenever it
is non-null.

## Delegation

The owner's standing instruction is `gpt-worker.sh` with `terra` for general work
and `sol` for architecture, security and final gates. Claude subagents are not to
be used. Worktrees under `~/projects/wt/` need `danger-full-access` because their
git metadata lives in the parent repository, outside a `workspace-write` sandbox.

Write closed packets: goal, task class, exact files, acceptance criteria,
verification, forbidden scope. State the test baseline and require the agent to
establish it themselves rather than trusting the number. Require every new test to
be seen failing before it passes — a test never observed to fail is not a test, and
two cases this week turned out to test nothing.

## Records

Every commit carries a CommitLore record; the dogfooding test fails a commit
without a `Record-Id`. Run `git log -3 --format=%B` to see the vocabulary before
writing one, and do not invent trailer names. Record what was ruled out and why —
the `Ruled-out` line is the most valuable part and the one a future reader needs.
