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

One, and it is not a defect. It is a thing nobody knows yet.

**#176** — guard scoring. Against the 417-decision corpus: precision 44.8%
(95% Wilson 32.7%–57.5%), recall **22.0%**, 92 false negatives against 26 true
positives. A ready-to-run closed packet sits at `.github/PACKET-176.md`.

Its first instruction is the one that matters: **read the 92 false negatives and
report the recurring shapes, with counts, before proposing any code.** Four
attempts on this guard have failed by tuning a threshold against a number instead
of looking at what was missed, and #157 closed on the finding that no
precision-safe cutoff exists.

Two rules for whoever picks it up. Do not change the corpus in the same commit as
the scorer — the corpus is the instrument now. And report both figures on every
change, because a scorer that suppresses firings lifts precision while making
recall worse and looks like an improvement. **The interval is the acceptance
criterion, not the point estimate**; at n=417 the interval is ±12 points, so a
2-point precision gain is not a result.

## What the numbers currently say

Measured on a quiet machine, single complete run, re-derivable:

```
retrieval at a two-record budget, corpus with superseded records (#173)
                            recall   stale returned
  BM25                       0/2         1
  embedding top-k            1/2         1
  hybrid RRF                 1/2         1
  embedding + path filter    1/2         1
  CommitLore path+lifecycle  2/2         0
  identical at 0, 10, 100, 1,000 and 10,000 distractors

query latency at 100k commits   496ms p50 / 503ms p95 indexed
  no-index, same fixture        86,673ms — ratio 4.8x at 1k, 36x at 10k, 175x at 100k
record capture cost             6,110 bytes / 1,524 tokens / 105ms, verify 36ms
hook overhead                   +228ms commit-msg, +120ms injection
guard, 417-decision corpus      precision 44.8% (CI 32.7–57.5%), recall 22.0%
record-bearing commits, here    73.9%
```

**Read the retrieval table before writing any marketing, and read both columns.**
The claim this product may make is narrow and it took three corrections to reach:

1. The README first said CommitLore beat "similarity retrieval (top-k, embeddings,
   RAG)" on the strength of a single lexical baseline. Overreach; retracted within
   the hour (#167) and #166 was filed to earn it.
2. #166 measured the four routes properly and **embedding top-k matched path scope
   at 2/2 with no path filter at all**. The differentiator did not exist.
3. #173 changed the question. On a corpus that contains superseded records, every
   similarity route returned one reversed decision and path scope returned none.

So the sentence is: *retrieval can find records; path scope keeps reversed
decisions out.* Not "better retrieval". The README says the #166 tie out loud, and
it must keep saying it — implying a general win would be contradicted by this
repository's own table, and a reader who catches that trusts nothing else.

The recall column is the weaker half. 2/2 against 1/2 is two records against one
at k=2; do not build a claim on it.

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
retrieval recall advantage    none over embedding retrieval (#166)
stale-record advantage        measured, one corpus, one query, one embedding model (#173)
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

## State at handoff

Nothing is in flight. Every worktree was removed after checking it for
uncommitted files and unmerged commits; `git worktree list` shows the main
checkout only. `dev` is green.

```
1,494 tests passing, 1 skipped
1 open issue (#176)
0 worktrees
```

Establish those yourself — `npx vitest run`, `gh issue list --state open`,
`gh run list --branch dev --limit 1`. Do not cite this block.

**The release is prepared but not tagged, and this is the first thing to decide.**
`dev` is at 0.3.0 with a written CHANGELOG. Tagging triggers a four-platform
binary build, so it is a deliberate act and was deliberately not taken. Three
bugs reported by real users against v0.2.1 are fixed on `dev` and unreleased —
**#128, #149, #107** — which means every day untagged is a day those users still
have the broken binary. #128 in particular is a `doctor` false failure on
binary-only installs, so an affected user's diagnostic tool tells them the wrong
thing. Tag it, or write down why not.

## Delegation

**The owner's current instruction is Claude subagents — `sonnet` or `opus`,
chosen by difficulty.** This replaced the `gpt-worker.sh` terra/sol routing on
2026-07-29; the routing hook was deleted. Earlier sections of the git history
assume the old broker, so do not restore it from a commit message.

Whichever executor is used, the packet shape is what made delegation work: goal,
task class, exact files, acceptance criteria, verification, forbidden scope. State
the test baseline and **require the agent to establish it themselves** rather than
trusting your number. Require every new test to be seen failing before it passes —
a test never observed to fail is not a test, and two cases this week turned out to
test nothing.

Verify submitted work by breaking the production code yourself. Reading a test
count catches nothing; three of this week's rejections passed their own tests.

Worktrees under `~/projects/wt/` hold git metadata in the parent repository, so
any sandboxed executor needs access above the worktree root. Remove a worktree as
soon as its branch merges — they reached 38 before I noticed, and two of the three
dual-dispatch incidents traced back to not knowing what was already checked out
where.

## Records

Every commit carries a CommitLore record; the dogfooding test fails a commit
without a `Record-Id`. Run `git log -3 --format=%B` to see the vocabulary before
writing one, and do not invent trailer names. Record what was ruled out and why —
the `Ruled-out` line is the most valuable part and the one a future reader needs.
