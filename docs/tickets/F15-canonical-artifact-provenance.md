# F15 tickets — Who is entitled to publish the bytes (#719)

> PRD: [PRD-F15-canonical-artifact-provenance.md](../prd/PRD-F15-canonical-artifact-provenance.md)
> ADR: [0011](../adr/ADR-0011-plugin-first-distribution.md) (distribution is a git clone)
> Issue: [#719](https://github.com/MongLong0214/commitlore/issues/719)
> Baseline head: `ad6fee3` (1.1.2).

**T-1501 is a decision, not an implementation, and nothing after it may start until it
lands.** The credentials are in place; the reason this is unscheduled is that a commit the
App pushes has not been checked, and no ticket here pretends otherwise.

**Ordering is strict.** T-1501 → T-1502 → T-1503 → T-1504. Each removes something the next
depends on not existing.

---

## T-1501 Decide how a bot-pushed commit is verified (S) — decision only

**Owns**

- `docs/adr/ADR-00xx-*.md` (new) — the decision and what it costs
- `docs/prd/PRD-F15-canonical-artifact-provenance.md` — replace "The unsolved question"
  with the answer

**Depends on** — nothing. This is the gate.

**Problem**

For the App to push to `main` it must be in the branch protection bypass list. The commit
it pushes is a merge result plus a rebuild: a tree no required check ran against. "The
pull request was green" is a statement about a different tree.

Shipping the naive form moves the gate from *blocking before* to *reporting after* — the
limitation recorded against `preserve` in #723, adopted voluntarily.

**Evaluate exactly these three**, and record why the two that lose, lose:

1. **Staging ref + fast-forward.** App pushes to `refs/heads/canonical-staging`, checks run
   there, `main` fast-forwards only on green. Keeps blocking semantics. Costs the second CI
   cycle this whole effort exists to remove — so measure that before choosing it.
2. **Bypass plus a required push-event check.** App pushes to `main`; a push-event job
   re-derives the bundle and compares. Still after the fact; the window is bounded and the
   failure is loud. Requires an answer to "what happens to `main` between push and check".
3. **No bypass.** App pushes a branch containing only the rebuilt artifact and opens a
   pull request for it, which passes normally. Preserves every property. Costs a second
   merge per change and needs a rule for what happens when that second pull request fails.

**Acceptance**

- An ADR that names the chosen shape, the property it gives up if any, and the two
  rejected shapes with their costs.
- If the answer is that none is acceptable, that is a valid outcome: the ADR says so and
  #719 stays open with the reason sharpened. **Do not ship a design to close a ticket.**

**Not in scope** — any workflow file, any permission change.

---

## T-1502 Rebuild-and-push, behind whatever T-1501 chose (M)

**Owns**

- `.github/workflows/canonical-merge.yml` (new)
- `scripts/check-exact-head-ci.mjs` — `EXPECTED_CI_WORKFLOW_SHA256` if `ci.yml` moves
- `test/canonical-merge-workflow.test.ts` (new)

**Depends on** — T-1501 merged. Branch protection updated by the repository owner, which
is not a step any agent performs.

**Owns the assertions**, in the shape `test/preserve-workflow-safety.test.ts` established:
the workflow's safety properties are read from the file with comment lines stripped, so a
comment cannot satisfy them. At minimum:

- the App token is minted from `COMMITLORE_BOT_APP_ID` / `COMMITLORE_BOT_KEY` and never
  echoed;
- the job never checks out or executes a pull request's head — the same rule #723 fixed for
  `preserve`, and the same reason;
- the rebuild is `build:canonical`, not a local `npm run build`, or the pushed bytes are
  not the canonical ones.

**Acceptance**

- A source-only pull request merges and the commit that lands on `main` passes
  `artifact:verify` and `git diff --exit-code -- dist/` **without anyone rebuilding by
  hand**.
- Deliberately breaking the rebuild — e.g. skipping `artifact:manifest` — produces a red
  check, not a green merge. **A fixture that cannot fail is not evidence** (#722).

**Not in scope** — removing `dist/` from pull request requirements. That is T-1503, and
doing it here means a failure in this ticket has no fallback.

---

## T-1503 Stop requiring pull requests to carry the artifact (S)

**Owns**

- `.github/workflows/ci.yml` — the `check` job's `git diff --exit-code` line, on the pull
  request path only
- `scripts/verify-canonical-artifact.mjs` — a mode that verifies the manifest is
  self-consistent with this checkout's source, distinct from verifying it against the
  committed bundle
- `EXPECTED_CI_WORKFLOW_SHA256`

**Depends on** — T-1502 proven on at least one real merge. Not on a green test run: on a
merge that actually landed a matching commit.

**The trap.** `artifact:verify` compares the committed manifest's source checksum against
the checkout. A source change that does not rebuild fails there **before** `git diff` is
reached — #720 failed exactly this way. So "drop one line" is wrong: the verify script
needs the second mode, and adding it removes "the committed manifest does not lie" from the
pull request path. Say so in the commit record.

**Acceptance**

- A pull request touching `src/` with no `dist/` change is green.
- The same change, merged, lands a commit where `dist/` matches — by T-1502, not by hand.
- The push and tag paths are untouched: `canonical-artifact`, `version-consistency` and
  `exact-head-ci` still gate every tag.

---

## T-1504 Close #719, or record why it cannot close (S)

**Owns**

- `docs/prd/PRD-F15-canonical-artifact-provenance.md` — success criteria checked off
  against observations, not intentions
- #719

**Depends on** — T-1503 merged and at least one non-Linux contributor completing a source
change unaided. **That last one is an observation, not a test**, and it is what the issue
is actually about: #720 waited on a maintainer twice.

**Acceptance**

- Every success criterion in the PRD is either met with the run that shows it, or
  explicitly not met and recorded.
- If a property was given up — most likely blocking-before-merge — the issue says which,
  and where the compensating check lives.
