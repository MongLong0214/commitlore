# CommitLore — where the work stands, 2026-08-15

Written to be picked up cold. Not a summary of what happened; the next step for
each thing, and what is known versus assumed.

Companion: `docs/handoff/2026-08-14-release-0.9.0.md` holds the release scope,
its ordering, and what waits on the owner. This file holds the in-flight work.

---

## #662 — `committedAt` spelling (closes #650)

Branch `fix-650-committedat`, head `9fa1922`. Rebased onto green main and still
failing — which read at the time as a defect of its own. It is not; see below.
Green main was not evidence of innocence, because main happened to take a path
that did not touch what was left of #661.

```
check (22.23.2)   FAILURE
check (24)        SUCCESS
```

Failing test: `test/doctor-snapshot.test.ts > #470 doctor text report header >
pins verbose diagnostics while the default adds no per-check lines`, comparing
the library's rendering against the shipped binary's.

**Known.** The test passes locally on macOS. It also passes in
`node:22.23.2-bookworm` when run alone, so the Node version is not the
discriminator — that hypothesis was measured and is dead. #664's `normalise`
helpers (`canonicaliseLiveRuntimes`, `canonicaliseTotals`) are present on this
branch; the merge brought them.

**The remaining difference** between local and CI is that CI runs the whole
suite in parallel. Sibling test files spawn doctor and MCP processes, and
`mcp-runtime-identity` enumerates whatever is running. When that check flips
between `ok` and `warn`, the **numbered warning list** gains or loses an entry
and every following number shifts. The totals line and the runtime detail line
are canonicalised; the numbering is not.

This was written down as an open question in #664's own commit — *whether the
warning list's numbering also shifts when the check flips is a question only CI
answers*. CI answered.

**Therefore this is not a #662 defect.** It is the remainder of #661, and #662
only walks into it by running the full suite. Fix it as #661 follow-up.

**Do not refresh the snapshot to make this green.** If the output depends on the
machine, refreshing it moves the failure rather than removing it. The repair is
to stop that comparison depending on machine state — either canonicalise the
numbered list, or keep the process-reading check out of tests whose whole
purpose is that two renderings agree.

---

## #638 — amend refused as a duplicate

Branch `fix-638-amend-marker`, pushed unfinished so a temporary worktree cannot
take it. The implementation and its regressions are there; the amend path does
not yet pass, and the commit message says so.

**Settled design.** `prepare-commit-msg` records whether this commit replaces
HEAD; `commit-msg` reads and consumes it, and only then does `duplicate-id`
ignore HEAD.

    amend  =  source == "commit"
              && the sha argument actually resolves to HEAD
              && no multi-commit operation in progress
                 (rebase-merge, rebase-apply, MERGE_HEAD, CHERRY_PICK_HEAD,
                  REVERT_HEAD, BISECT_LOG, sequencer)

**Anything unrecognised is not an amend.** The two mistakes are not symmetric:
calling a non-amend an amend drops HEAD from the duplicate check and lets a real
identity collision through, while the reverse is only the inconvenience #638
describes. A list of operations to exclude would break the day git adds one, so
the default has to be the safe direction.

The marker lives at `git rev-parse --git-path commitlore-amend`, which gives it
the same worktree scope `COMMIT_EDITMSG` has.

**Measured, and pinned in `test/amend-marker.test.ts` (4 cases, passing).**

| operation | source | operation in progress |
|---|---|---|
| ordinary commit | `message` | — |
| `commit --amend` | `commit` | — |
| `rebase -i` reword | `commit` | `rebase-merge` |
| cherry-pick | `message` | `CHERRY_PICK_HEAD` |
| revert | `message` | — |
| merge | `merge` | `MERGE_HEAD` |

Reword is the case that matters: its arguments are **identical** to an amend's,
and only the rebase directory separates them.

**Where it is stuck.** The amend is still refused. Measured against a real
repository, all three conditions hold — `src=[commit]`, the sha resolves to
HEAD, no operation in progress. So the decision logic is right and the fault is
before or after it.

**Narrowed since.** The read side is not the fault. `consumeAmendMarker(cwd)` is
called with the same `cwd` that `recordsFor` receives in the same scope, so
`validate` resolves the relative path against the repository it was handed.

**Next step.** That leaves the write side: whether `recordAmendIntent` runs at
all, and with what `process.cwd()`. The installed stub calls
`commitlore prepare-commit-msg "$@"`, so the arguments do arrive — measured. What
is not measured is the cwd of that CLI process. Print it beside the path
`git rev-parse --git-path commitlore-amend` resolves to, from inside the hook,
and compare against what `validate` computes. Do that before changing code:
the decision logic is already measured correct against a real amend, so the
fault is on either side of it, not in it.

**Why A was withdrawn** (do not re-propose it): not counting HEAD at all
reverses what #430 built. Its two assertions in
`test/amend-recorded-commit.test.ts` fail directly — *a divergent record under an
existing id was accepted* / *a bare id declared twice was accepted*. The loss was
estimated as narrow and is not: HEAD is the position every commit passes
through.

**Why C survived its own objection.** `git commit --no-verify` runs
`prepare-commit-msg` and skips `commit-msg`, so a marker can outlive its
attempt. That is true and was nearly fatal to C — but every commit path runs
`prepare-commit-msg` before that commit's `commit-msg`, so the next attempt
overwrites the stale marker before anyone reads it. Measuring one step further
is what saved C.

---

## Remaining `release:0.9.0`

Query the list rather than trusting this one: `gh issue list --label
"release:0.9.0"`.

- **#650** — #662 above.
- **#631** — CLI and MCP agree on one converged runtime; measured. What is
  missing is a regression pinning it through the **built** MCP server as a
  separate process, and a runtime identity travelling with the grade — a
  `commitlore_query` response carries none, so a client detecting divergence
  must ask twice and trust the same process answered.
- **#630** — narrower than filed. `capture` exists on the CLI and did on v0.8.2;
  the command list in the report is from a much older binary, consistent with
  #660. What survives: capture tools load from the session root, so a session
  rooted elsewhere silently gets none. A discoverability problem, not a missing
  capability.
- **#638** — above.
- **#590** — last on purpose. The README numbers move with everything above.

---

## Recorded today, for the record

- **#665** — a green merge broke main and nothing noticed for two hours. Also
  carries the two lessons from the repair: one failure was masking another, and
  a local artifact verification passes on a contaminated tree.
- **#648** — the canonical manifest serialises every branch touching `dist`.
  Carries the day's measurements: twelve forced rebuilds, eleven with zero
  source conflict, plus one rebuild that ran correctly and still produced a
  wrong artifact because the tree held unrelated uncommitted work.
- **#660** — four generations of this product running at once, two from a
  deleted plugin cache. `install.sh` never touches the Claude plugin cache, so a
  release does not reach the tools agents actually call.

---

## Release conditions

Judged by the CTO, tagged only through the owner's own path.

1. `release:0.9.0` at zero
2. the **full** suite green on dev — a partial script passing is not evidence,
   which is what the 8/14 README incident cost
3. `commitlore doctor` exit 0 and `commitlore validate --commit <head>` PASS
4. release notes carrying three items: the timeout's changed meaning (#636),
   generation binding (#653), and that the plugin cache does not follow
   `install.sh` (#660)

After installing, run `commitlore hermes install` and re-read `doctor` to
confirm the skills path points at the new version — `~/.hermes/config.yaml`
pins a version and old directories are never removed, so a new binary will read
old skills in silence otherwise. Without the re-read it is "attempted", not
"installed".
