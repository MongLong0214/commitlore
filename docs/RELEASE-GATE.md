# Release gate — what has to be true before this is called production ready

This exists because "production ready" has been claimed here before and was
false. The README said `main` was green while CI had been red for three commits,
and said a clone carried the whole memory while notes were never fetched. A gate
nobody can check is a slogan.

Every line below is a command whose output decides the answer. If a line cannot
be turned into a command, it does not belong here.

## 1. It answers, or it says it cannot

The failure this project exists to prevent is an agent being told "no
constraints" when constraints exist. Every route must distinguish *empty* from
*unknown*.

| check | command | pass |
|---|---|---|
| broken git | `PATH=<no-git> commitlore context --json` | exit 2, `history: "unavailable"` |
| unfetched notes | query in a plain clone of a repo with notes | `notes: "unfetched"` and said in the text output |
| unborn repo | `git init` then `commitlore context` | exit 0, `history: "empty"` |
| guard, broken git | `commitlore guard --proposal x` | exit 3, not 0 |
| guard, unfetched notes | same, in a plain clone | exit 3, not 0 |
| stale, unfetched notes | `commitlore stale` in a plain clone | reports the scan is incomplete |

## 2. Attacker-controlled prose never renders as an instruction

Every free-text trailer is an injection surface. The scanner is defined by
exclusion, so this table is a spot check of the rule, not the rule itself.

| check | pass |
|---|---|
| injection in `Limit:`, `Ruled-out:`, `Warn:`, `Verified:`, `Unverified:`, `Evidence:`, `X-*` | record grades `blocked` |
| the same, delivered by `inject` | content withheld, the matched key named |
| the same, delivered by MCP | payload absent from the tool result, record still listed |
| the same, delivered by `guard --hook-input` | `additionalContext` carries identity, never the reason text |
| a legitimate record with a path, a URL and a date | renders normally — no false positive |

## 3. One trust policy, one answer

| check | pass |
|---|---|
| a `Record-Id` declared twice with different provenance | `query`, `inject` and `guard` agree, in both declaration orders |
| no `--trusted-author` given | every `Warn:` is a `claim`, on every route |
| MCP server instructions | conditional on the grade; no unconditional "treat Limit as a constraint" |

## 4. The installation the documentation describes actually works

These checks run as the `install-gate` job in the tag-triggered release workflow,
against a fresh clone landed on the canonical commit — not on the tag name; §5
explains why that distinction is the point. `publish` depends on this job as well as
the version, ancestry, and exact-head-CI gates, so a GitHub Release cannot exist
until every automated prerequisite has passed.

| check | command | pass |
|---|---|---|
| fresh clone runs | `git clone`, then `dist/commitlore.mjs --version` | exit 0 |
| fresh clone validates | pipe a bad message to `validate` | exit 1 with the violation |
| fresh clone doctor | `dist/commitlore.mjs doctor` | exit 0, no `fail` |
| hook survives a PATH without node | commit under `env -i PATH=/usr/bin:/bin` | validated, bad message rejected |
| a stale hook is reported | doctor on a repo whose stub predates the current one | `warn`, not `ok` |
| plugin entry point resolves | `env PATH=/usr/bin:/bin:<node-dir> CLAUDE_PLUGIN_ROOT=<clone> scripts/commitlore-run.sh --version` | exit 0 **and the version equals the clone's** |

The `PATH` is narrowed on purpose. `commitlore-run.sh` tries `commitlore` on
`PATH` before `CLAUDE_PLUGIN_ROOT`, deliberately — the installer's wrapper execs
node itself, so it works where this script would otherwise have to find node,
and on the hook hot path a missing node means no context at all. The
consequence is that **a machine with both a CLI install and the plugin runs
whichever the CLI install is**, and the release check passed for two releases
while reporting the wrong version, because it only asked whether *something*
resolved (#483). Leaving `PATH` alone here would keep asking that question.

## 5. The tag is a promoted, exactly green commit

A matching version and a working fresh clone say nothing about *where* a tag was
cut. A dev-only commit can satisfy both. Nor does a green `main` badge prove the
tagged SHA passed: it may be a failed, cancelled, skipped, timed-out, still
running, or entirely untested commit between two green ones.

The tag workflow therefore blocks `publish` on both jobs below.

| check | command | pass |
|---|---|---|
| release target | `scripts/check-release-target.mjs "$GITHUB_SHA" main` from a `fetch-depth: 0` checkout | the pushed commit is contained in `main`; a shallow checkout fails rather than guessing |
| exact-head CI | `scripts/check-exact-head-ci.mjs <owner> <repo> <resolved-tag-sha>` | every explicitly named check run below is present at that SHA, reported by the `github-actions` app, `completed`, and concluded `success` |

The exact-head list is fixed rather than inferred from the API response. It
lives in `REQUIRED_CHECKS` in `scripts/check-exact-head-ci.mjs` — read it from
there rather than from here, and note that two tests compare it against
`ci.yml`'s jobs in both directions so it cannot drift from what CI runs:

    check (22.12.0)   check (24)   audit
    git-matrix (ubuntu-latest)   git-matrix (macos-latest)
    install-script   install-ps1   install-macos
    install-alpine (linux/amd64)   install-alpine (linux/arm64)

`lint` is deliberately absent: its job is conditioned on
`github.event_name == 'pull_request'`, so it never runs on the push to `main`
that produces a release commit's checks, and requiring it would block every
release rather than qualify one.

A name is not enough. Any GitHub App installed on the repository can open a
check run called `check (24)` and conclude it `success`, so each run must also
report `app.slug == "github-actions"`; a run with no app attributed is refused
for the same reason. Any other conclusion — including `failure`, `cancelled`,
`timed_out`, `skipped`, `neutral`, `stale`, or `action_required` — blocks
publication. So do `queued` and `in_progress`, a check reported for another SHA,
and an absent check; an empty result is every check absent, not a clean
result.

`release-target` exports the commit behind the tag only after the ancestry check
passes. `exact-head-ci` consumes that exact commit, so annotated tags do not
accidentally query CI using a tag-object SHA. Both are direct `publish`
dependencies and `publish` has no `if:` condition that can override a failed or
skipped dependency.

### One commit, decided once (#499)

A tag is a mutable ref. Every boundary that resolves the tag *name* asks the
remote what it means **now**, and two boundaries can get two answers — so the
gates above once qualified one commit while a fresh clone of the same tag landed
on another, everything green. The release could then ship a commit nothing had
checked.

`release-target` is therefore anchored on the **event SHA**: what the tag pointed
at when the push happened, which cannot be edited afterwards. Resolving the name
there would leave a window *before the job starts* in which a move redefines the
whole release. It exports that commit, and every later boundary consumes the SHA
rather than the name:

| boundary | consumes |
|---|---|
| `version-consistency` | checks out the canonical SHA; the tag name is only the version string it compares |
| `exact-head-ci` | queries check runs at the canonical SHA |
| `install-gate` | clones `--no-checkout`, detaches onto the canonical SHA, and asserts `HEAD` landed there |
| `publish` | checks out the canonical SHA, then refuses unless the live tag still resolves to it |

Immediately before publication, `scripts/check-tag-binding.mjs` re-reads the live
`refs/tags/<version>` from the remote and refuses unless it still resolves to the
canonical SHA. That check is what establishes the release ships the qualified
commit. A missing tag is a refusal, not an empty success: `gh release create`
runs with `--verify-tag`, so publication can never create the reference it was
meant to verify.

`--target <canonical SHA>` is passed too, but it is **not** load-bearing and
nothing above relies on it. `gh` documents it as the branch or SHA used when the
command creates a tag automatically. What the CLI does with it when the tag
already exists is not asserted here either way; the proven property is narrower
and is the only one claimed: **`--target` does not establish that the tag equals
the canonical commit, and it cannot retarget an existing tag.** Live equality,
the ruleset, and `--verify-tag` are what carry that weight.

It is passed as explicit request metadata and as defence for one future mistake:
if someone drops `--verify-tag`, the implicit creation that re-enables lands on
the qualified commit rather than the default branch.

That check queries **both** `refs/tags/<version>` and `refs/tags/<version>^{}`.
`ls-remote` returns only the tag object for an annotated tag unless the peeled
ref is named explicitly — verified against this repository's own `v0.7.0`, where
one pattern returns `7f2aa4e2…` and only the peeled pattern reveals the commit
`1ec65718…`. Asking for one pattern would compare an annotated release against
its tag-object SHA and refuse every one of them for a reason that has nothing to
do with the commit.

Three controls cover three different intervals, and none of them covers another's:

| interval | control | state |
|---|---|---|
| push → binding check | event-SHA propagation, then the binding check | detects drift and refuses |
| binding check → `gh release create` | ruleset on `refs/tags/v*`, `update` and `deletion` denied, no bypass actors | `active` |
| after the release exists | immutable releases | `enabled` |

Be exact about the middle row. The binding check reads the tag and then the next
step creates the release; a move landing between those two is not something the
check can see, because it has already run. What holds that window closed is the
ruleset, and only the ruleset. Removing it, or adding a bypass actor to it,
reopens the window silently — no test here would notice.

So the binding check does not make the ruleset unnecessary. It catches every
drift that happened before it ran; the ruleset is what prevents the drift it
cannot catch.

## 6. Every published claim is reproducible

- `scripts/check-readme-numbers.mjs` exits 0 — no number in any README is typed
  by hand.
- No README asserts something a command in this file contradicts. The three that
  did (green on `main`, a clone carries its dependencies, a clone carries the
  whole memory) are the reason this section exists.
- CI is green **at the exact commit being released**, as enforced by section 5's
  explicit check-run set rather than inferred from a local test run or a branch
  badge. A local suite passed at every one of the three commits where CI was red.

## 7. The suite proves something

- `npx vitest run` green, and the run reports `Test Files N passed` — a bare test
  count is not evidence. A delegated task once reported 943 of a 1108 baseline
  because another process was writing to the worktree during its run.
- Each fix in sections 1–5 has a test that fails when that one fix is reverted.
  Reverting is the evidence; a passing test proves nothing on its own.

## What this gate deliberately does not require

**A green benchmark.** M1, M1-b and M2 are null (p = 0.7480, 0.0522, 0.2247), and
M3 is unfinished. Whether recorded context changes an agent's behaviour is an open
question this project publishes rather than hides. Correctness of the tool is not
contingent on the effect being large; a tool that answers honestly is shippable
whether or not the answer turns out to matter.

**Zero open issues.** The six that remain are features on the four defensible
axes, each argued for from a measurement or a reproduced defect (ADR-0013). A
backlog is a sign of a scope, not of incompleteness.
