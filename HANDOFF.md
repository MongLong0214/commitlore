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

Five, and none is a defect. All five are things nobody knows yet.

**#140** — the one that matters. M1, M2 and M4 all measured final coding
behaviour, four layers downstream of anything this product controls, and each
failed differently. The replacement claim is *fresh-agent decision recovery*: does
a fresh agent recover a code path's active decision context before its first edit?
The rule that makes it credible is that **gold answers must not be derived from
CommitLore records** — two annotators extract decision atoms from PR discussion and
commit bodies, the gold is frozen, and only then is the same information encoded
as trailers. Otherwise it measures whether CommitLore can read its own format. A
protocol registration is in flight on `protocol-issue-140`; it writes the
registration and deliberately builds no harness.

**#172** — the README hero does not survive #166 and must be revised. See the
numbers section below; this is the most urgent thing on the list because the claim
is live on the front page.

**#173** — the experiment that might restore a differentiator. Path scope withholds
superseded and expired records; a similarity retriever has no notion of a record
being stale and will return a decision that was already reversed. Missing a record
costs the model context; being handed a reversed decision costs it correctness, and
those are not the same failure. In flight on `feat-issue-173`. The corpus must be
built so the *opposite* outcome is reachable — if embedding retrieval also returns
zero stale records, that finding is as valuable as the expected one.

**#176** — guard scoring. Against the 417-decision corpus: precision 44.8%
(95% Wilson 32.7%–57.5%), recall **22.0%**, 92 false negatives against 26 true
positives. Do not change the corpus in the same commit as the scorer — the corpus
is the instrument now. Report both figures on every change, because a scorer that
suppresses firings lifts precision while making recall worse and looks like an
improvement. The interval is the acceptance criterion, not the point estimate.

**#161** — a committed benchmark result names the commit that produced it, and
every rebase of its own branch orphans that commit. It happened twice in one
sitting. In flight on `feat-issue-161`. Recording a commit id *and* a content
digest, with the fallback stating loudly which it used, is the shape I proposed.

## What the numbers currently say

Measured on a quiet machine, single complete run, re-derivable:

```
retrieval recall at a two-record budget, 10,002 records
  BM25                       0 of 2
  hybrid RRF                 1 of 2
  embedding top-k            2 of 2      <- matches us
  embedding + path filter    2 of 2
  CommitLore path scope      2 of 2

query latency at 100k commits   496ms p50 / 503ms p95 indexed
  no-index, same fixture        86,673ms — ratio 4.8x at 1k, 36x at 10k, 175x at 100k
record capture cost             6,110 bytes / 1,524 tokens / 105ms, verify 36ms
hook overhead                   +228ms commit-msg, +120ms injection
guard, 417-decision corpus      precision 44.8% (CI 32.7–57.5%), recall 22.0%
record-bearing commits, here    73.9%
```

**Read the retrieval table before writing any marketing.** The README currently
leads with CommitLore keeping both relevant records while a lexical baseline loses
one. That is true and it is misleading by omission: an embedding retriever matches
us at every corpus size with no path filter at all. #172 tracks the revision and
#173 tracks the lifecycle experiment that might restore a real differentiator.

Never say "99.98% token saving". The exposure figure measures how much irrelevant
decision context reaches the model — not cost, not accuracy, not agent behaviour.

The latency ratio is not a selling point: no-index is CommitLore's own fallback
mode, so it compares the product to itself. Lead with the absolute figure.

The **29.4x** figure from earlier notes is retired. It divided by a no-index time
that measured a parser stopping at a message's final record block — 77 µs per
commit, never plausible for opening and scanning a message. The current parser
reads every block at 900 µs (#163).

Not established, and the README says so:

```
token saving                  cost measured, benefit assumed (#127 closed on that boundary)
agent behaviour improvement   M1/M2/M4 all instrument failures
guard effectiveness           precision 44.8%, recall 22.0% — measured, and poor
retrieval advantage           none over embedding retrieval (#166)
```

On rationale density: this repository's 73.9% record-bearing rate is *lower* than
the Linux kernel's 98.9% rationale-sentence rate (ICPC 2024). The claim is
addressability, not abundance. Never imply CommitLore produces more rationale than
a disciplined project.

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

## In flight when this was written

Three sol jobs were queued on a single slot and run in sequence. Check each
worktree before assuming it is unstarted:

```
~/projects/wt/p161      feat-issue-161      provenance
~/projects/wt/p173      feat-issue-173      lifecycle experiment
~/projects/wt/proto140  protocol-issue-140  measurement protocol
```

`git log --oneline origin/dev..HEAD` and `git status --porcelain` in each. A
worktree with uncommitted files and no commit was mid-run; one with neither may
never have started, because the broker refuses a second concurrent sol worker.

The release is prepared but **not tagged**. `dev` is at 0.3.0 with a written
CHANGELOG; tagging triggers a four-platform binary build and is a deliberate act.
Two users reported bugs against v0.2.1 that are fixed on `dev` and unreleased —
#128, #149 and #107 — so tagging is worth doing soon.

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
