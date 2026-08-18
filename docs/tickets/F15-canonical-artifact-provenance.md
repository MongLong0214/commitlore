# F15 tickets — Who is entitled to publish the bytes (#719)

> PRD: [PRD-F15-canonical-artifact-provenance.md](../prd/PRD-F15-canonical-artifact-provenance.md)
> ADR: [0011](../adr/ADR-0011-plugin-first-distribution.md) (distribution is a git clone)
> Issue: [#719](https://github.com/MongLong0214/commitlore/issues/719)
> Baseline head: `ad6fee3` (1.1.2).

**T-1501 is closed by [ADR-0036](../adr/ADR-0036-a-bot-merge-goes-through-a-pull-request.md).**
The App does not push to `main`; it opens a pull request. `main`'s protection requires
`lint`, which runs only on `pull_request`, so no push can satisfy protection on its merits
and every push-shaped option needs a bypass. Going through a pull request needs none.

**T-1502 is done, and was built rather than deferred (2026-08-18).** It read "unscheduled"
here because ADR-0036 answered how a bot merge is verified without deciding to build one. A
contributor still had to run a `linux/amd64` Docker build to open any pull request, which
is what #720 waited on a maintainer for twice.

It was observed rather than argued: #761 carried source only, `canonical-merge` rebuilt it
into #762, and `e4e5154` landed with `artifact:verify` and `git diff -- dist/` both clean
and the bundle commit authored by the build App. #763 is the control that went red.

**T-1503 is rejected**, after being shipped and reverted the same day — see below.
**T-1504's acceptance was rewritten** from a person-observation to the system properties it
was standing in for.

**Ordering is strict.** T-1501 → T-1502 → T-1503 → T-1504. Each removes something the next
depends on not existing.

---

## T-1501 Decide how a bot-pushed commit is verified (S) — **done**, ADR-0036

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

**Acceptance** — met by ADR-0036. It names the chosen shape (pull request, no bypass),
what it costs (one extra pull request and CI cycle per change), and the three rejected
shapes with their reasons. The staging-ref option is rejected by the same `lint` finding
that looked like it solved the problem, which is recorded because that is the shape a
reader reaches for first.

Two assumptions are named there as unmeasured, and **T-1502 verifies them before anything
else**: that protection evaluates required contexts on the pushed commit, and that an
App-opened pull request triggers the same checks. The second is the dangerous one — a
workflow that does not fire would leave the rebuild pull request green with nothing having
run, which is #722's empty runner in a new place.

**Not in scope** — any workflow file, any permission change.

---

## T-1502 The rebuild arrives as a pull request (M) — **done**, observed on #761 → #762 → `e4e5154`

**Owns**

- `.github/workflows/canonical-merge.yml` (new)
- `scripts/check-exact-head-ci.mjs` — `EXPECTED_CI_WORKFLOW_SHA256` if `ci.yml` moves
- `test/canonical-merge-workflow.test.ts` (new)

**Depends on** — ADR-0036. **No branch protection change is required, and none should be
requested** — that is the point of the decision.

**Verify first, before writing the workflow.** ADR-0036 names two assumptions it did not
measure, and the second can make everything downstream vacuous:

- protection evaluates required contexts on the pushed commit (this only affects why the
  staging-ref option was rejected, not the chosen shape);
- **a pull request opened by the App triggers all eleven contexts.** If `on: pull_request`
  does not fire for App-opened pull requests, the rebuild pull request is green with
  nothing having run — #722's empty runner in a new place. Open one throwaway pull request
  from the App and read the check list before building on it.

**Owns the assertions**, in the shape `test/preserve-workflow-safety.test.ts` established:
the workflow's safety properties are read from the file with comment lines stripped, so a
comment cannot satisfy them. At minimum:

- the App token is minted from `COMMITLORE_BOT_APP_ID` / `COMMITLORE_BOT_KEY` and never
  echoed;
- the job that holds the App credential never checks out or executes a pull request's
  head. **Amended 2026-08-18** — it read "the job never …", borrowed wholesale from the
  rule #723 fixed for `preserve`. `preserve` only reads a pull request; this one *rebuilds*
  it, and rebuilding somebody's change means running it: their `package.json`, their
  lockfile, every dependency lifecycle script it pulls in. Written the old way the
  assertion is unsatisfiable by any implementation of this feature, so it would have been
  quietly dropped rather than met. What is achievable, and what the split into
  `canonicalise` → `publish` exists to hold, is that the runner executing that code holds
  no credential — the token is minted in a second job, from `main`'s copy of the mint
  script, outside the workspace;
- the rebuild is `build:canonical`, not a local `npm run build`, or the pushed bytes are
  not the canonical ones.

**Acceptance**

- A source-only pull request merges and the commit that lands on `main` passes
  `artifact:verify` and `git diff --exit-code -- dist/` **without anyone rebuilding by
  hand**.
- Deliberately breaking the rebuild produces a red check, not a green merge. **A fixture
  that cannot fail is not evidence** (#722) — and the example this ticket first gave was
  one. **Amended 2026-08-18**: "skipping `artifact:manifest`" cannot be produced from a
  pull request. That step is hard-coded in the workflow, which is loaded from the default
  branch, and the source-only filter refuses any change under `.github/workflows/`,
  `dist/` or `installer/canonical-artifact.json`. A negative control nobody can perform is
  the same defect it was written to prevent.

  The producible one: after the workflow pushes `canonical/pr-N`, add a commit to that
  branch that edits `dist/` without rebuilding. `ci.yml`'s `git diff --exit-code -- dist/
  installer/canonical-artifact.json` must go red on the canonical pull request. That
  falsifies the property this ticket actually claims — *the bytes that land match the
  source that landed with them* — rather than the workflow's internal step list.

**The merge method is enforced by the repository, not by this workflow (2026-08-18).**
`allow_squash_merge` and `allow_rebase_merge` are off; a merge commit is the only method
GitHub offers here. That matters because the canonical pull request depends on its head
commit staying an ancestor: a squash lands new bytes instead, leaving the source pull
request open with nothing to point at.

This paragraph previously said the method was not enforceable and left the choice to the
owner. It was enforceable; it just was not enforced. Until it was, the canonical body's
"merge this with a merge commit" was a check somebody had to read — the shape that cost
#752 its `merged` label during the 1.1.3 release, in the sentence next to it rather than
in this one.

The body still says it, for a reader who wants to know why the branch is shaped this way.
It is no longer what holds the property.

**What this moves rather than removes.** The guarantee now lives in a repository setting,
which nothing in this repository reads. A future owner can re-enable squash and no test,
workflow or gate here will notice — only a canonical pull request quietly failing to close
its source. That is a smaller surface than a sentence in a body, and it is not zero.

**Not in scope** — removing `dist/` from pull request requirements. That is T-1503, and
doing it here means a failure in this ticket has no fallback.

---

## T-1503 Stop requiring pull requests to carry the artifact (S) — **rejected**, shipped and reverted

**Rejected 2026-08-18, after shipping and reverting it.** `532c30f4` made a source-only
pull request green, and green is mergeable. The button then lands `src/` with no rebuilt
`dist/`, and `main` carries a bundle that does not match its source until the next push run
goes red — after the fact rather than before it.

A red source pull request was not friction to be removed. It was the thing forcing the
canonical path, which is the path this feature exists to build. #761 was red, and that is
why it went through `canonical-merge` rather than through its own merge button.

What T-1503 was written to fix — *a contributor cannot open a pull request without running
a `linux/amd64` Docker build* — is already fixed by T-1502, and without this risk: the
contributor opens the source-only pull request and never rebuilds anything. Its checks
being red is a signal about the artifact, not a demand on them.

The measurement it produced stands, and anyone reopening this starts there: "drop the diff
line" was wrong, because CI rebuilds before it verifies, so a source-only pull request dies
at `artifact:verify` and never reaches the diff.

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

**Depends on** — T-1502, and the canonical handoff hardened against a contributor who is
not the owner.

**Amended 2026-08-18.** This read *"at least one non-Linux contributor completing a source
change unaided"*, and called that an observation rather than a test. It is both — and it is
the wrong kind for a completion gate. What #719 asks is whether a contributor can land a
change without producing the canonical artifact. Whether somebody has yet turned up to do
so measures the project's audience, not its behaviour, and a correctness gate that cannot
be satisfied from inside the repository leaves the work permanently unfinished for a reason
unrelated to the work.

The old wording was also indifferent to what it named. The canonical build never runs on a
contributor's machine — `linux/amd64` appears only in a container on a GitHub runner — so
"a non-Linux contributor" was a proxy for "somebody who cannot run the canonical build",
and the mechanism does not distinguish the two.

**Acceptance** — each met with the run that shows it:

- A contributor can submit a source-only change without producing the canonical
  `linux/amd64` artifact.
- The canonical workflow produces the merge candidate, and all required checks run against
  that candidate rather than against a tree resembling it.
- The candidate's artifact matches the source that lands with it, and a mismatched one is
  refused.
- The contributor's source head becomes reachable from `main` with no maintainer rebuilding
  `dist/` by hand, and no branch-protection bypass.
- The handoff between the job that runs contributor code and the job that holds the
  credential is checked rather than trusted, with a negative control for each check.

**Limit.** External contributor experience has not been observed in the field after this
change. That is adoption evidence, not a correctness gate. A real-world failure reopens
this issue, or opens a defect issue of its own.
