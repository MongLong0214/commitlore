# PRD F15 — Who is entitled to publish the bytes (#719)

- ADR: 0011 (distribution is a git clone), 0021 §7 is unrelated and must not be cited here
- Issue: [#719](https://github.com/MongLong0214/commitlore/issues/719)
- Status: **specified, not scheduled.** The credentials exist; the design problem in
  "The unsolved question" below does not have an answer yet, and this document does not
  invent one.

## What this is about, and what it is not

`dist/commitlore.mjs` is committed. The `check` job rebuilds it twice in
`docker linux/amd64 node:24-bookworm`, compares the two builds to each other, verifies
both against `installer/canonical-artifact.json`, and then runs
`git diff --exit-code -- dist/ installer/canonical-artifact.json`.

That last line is easy to read as a formality and is not. `build:canonical` **overwrites
the worktree**, and every step after it splits into two trees:

| step | runs against |
|---|---|
| `node dist/cli.js validate` / `doctor` | the **rebuilt** tree |
| `git clone --depth 1 "file://$PWD"` — the ADR-0011 test | **HEAD**, the committed bundle |
| `audit` | the committed bundle, copied, not rebuilt |
| `install-script` / `install-ps1` / `install-macos` / `install-alpine` | tag the checkout, clone the tag — the committed bundle |

`git diff --exit-code -- dist/` is the only thing making those two trees the same bytes.

So the subject is not merge conflicts. It is **which commit is entitled to be the
product**, in a repository whose first-class install is a git clone of the checkout
(ADR-0011). The conflict cost is what that entitlement is currently bought with.

## Goal

Remove the cost of carrying `dist/` in every pull request **without** separating two
claims that are currently one:

1. this source builds deterministically on `linux/amd64`; and
2. this checkout **is** the plugin.

## Non-goals

- **Removing the committed bundle.** Not a preference — ADR-0011 already decided it, and
  rejected the alternative by name: *"Do not commit `dist/` + require a source build |
  requiring a toolchain during installation breaks the 'one clone and done' promise."*
  Its opening line is *"Distribution is git clone. Do not use a registry."* Any proposal
  that starts by removing `dist/` is reopening ADR-0011, which is a different document
  from this one.
- Weakening `artifact:verify`. It answers "does the committed manifest describe the
  committed bundle", and nothing else answers that.
- Moving the guarantee to the tag gate alone. The tag gate cannot rejoin claims 1 and 2
  if the PR-level evidence for 2 was never gathered — see "Rejected" below.
- Any change to what `install.sh` / `install.ps1` fetch. Users still clone a tag.
- Speeding up the canonical build itself. This is about how many times it must run, not
  how long one run takes.

## The measured cost

Recorded on 2026-08-17, a day with three releases:

- **Four rebuild cycles** across overlapping source pull requests. `.gitattributes` marks
  `dist/**` as `-diff -merge`, so git does not attempt a text merge at all — every second
  pull request must rebuild, at roughly one Docker build plus one 20–32 minute CI cycle.
- **`Verified:` digests go stale.** Two commit records merged that day carry artifact
  digests that do not match the merged tree. Both are true of their own commit; a reader
  who does not know that reads it as drift.
- **A contributor could not finish their own work.** #720 arrived from a Windows machine
  with `src/` and `test/` only — correctly, because a Windows host cannot produce a
  `linux/amd64` Docker build — and waited on a maintainer twice.

The third is the one that changes the threshold. A cost measured in CI minutes is an
annoyance. A cost measured in *which contributors can complete a change* is not.

## Rejected, with reasons

| proposal | why not |
|---|---|
| Drop `git diff --exit-code -- dist/` from the PR path, keep it on push and tags | decouples claims 1 and 2. The clone, audit and install jobs would go on validating the previous bundle, so a change breaking self-containment or a plugin entry point would never be executed by the job ADR-0011 exists to satisfy |
| Upload `dist/` as a PR artifact and apply it on push | two source pull requests merging in sequence apply the wrong tree: PR-B's artifact was built from `main+B`, not `main+A+B` |
| A merge queue | serialises without inserting a rebuild into the merge commit; a required check demanding a matching `dist/` fails queued commits forever |
| A `.gitattributes` merge driver that picks a side | resolves the conflict by discarding the property |
| CI rebuilds `dist/` and pushes it to the pull request branch | keeps both claims and frees same-repository contributors, but does not remove the conflict, and a `pull_request` token cannot push to a fork — the case that actually hurt |

## The direction

**A privileged merge.** A GitHub App merges the source, runs `build:canonical` and
`artifact:manifest`, and pushes that tree. Pull requests then carry no `dist/` at all, the
commit that lands matches its own source from the start, and today's `artifact:verify` and
`git diff --exit-code` stay exactly where they are on the push side.

Credentials exist as of 2026-08-17: App `4622872`, `contents: read and write` on this
repository only, with `COMMITLORE_BOT_APP_ID` and `COMMITLORE_BOT_KEY` registered as
repository secrets.

A weaker variant — rebuild and push on `push` to `main` — keeps `HEAD` consistent but
leaves one stale parent in history, which must never be tagged. It is recorded so that it
is rejected deliberately rather than rediscovered.

## How a bot merge is verified — answered (ADR-0036)

`main`'s protection requires **eleven** contexts, and the eleventh is `lint`, which a push
to `main` cannot produce for two independent reasons: `demo-lint.yml`'s push trigger is
scoped to `dev`, so the workflow does not run at all, and the `lint` job is additionally
gated on `github.event_name == 'pull_request'` because a push event has no `base_ref`. So a
direct push produces no `lint` context, ever, and **no push to `main` can satisfy
protection on its merits** — the App's or anyone's. Every push-shaped option needs a
bypass, and a bypass is not "the check passed"; it is "the check did not have to".

So the App does not push. **It opens a pull request** carrying the source change plus a
canonical rebuild, all eleven contexts run on it, and it merges like anything else. No
bypass is requested, and none should be granted for this purpose.

Cost: one extra pull request and one extra CI cycle per change — worse than today for a
change that would not have conflicted, better for one that would. The staging-ref option
was rejected for the same `lint` reason it initially seemed to solve; ADR-0036 records why,
because it is the shape that looks safest before that detail is noticed.

Two assumptions behind it are unmeasured and named there: that protection evaluates
required contexts on the pushed commit, and that a pull request opened by an App triggers
the same checks. The second matters most — a workflow that does not fire for App-opened
pull requests would leave the rebuild green with nothing having run, which is #722's empty
runner in a new place.

## Success — final, and each line names the run that shows it

Rewritten 2026-08-18, when the work shipped. The first version said *"no pull request
carries `dist/`"*, which the built thing contradicts: the **canonical** pull request carries
exactly that, and carrying it is how all eleven required contexts run on the tree that
lands. The criterion had described a shape rather than a property.

1. **A contributor never produces the canonical artifact.** #761 carried `src/` and
   `test/`; `linux/amd64` ran only in a container on a GitHub runner.
2. **A source-only pull request becomes a merge candidate.** `canonical-merge` opened #762
   from #761 with no human step between them.
3. **Every required check runs against that candidate.** Twelve contexts attached to #762,
   which is an App-opened pull request — the assumption ADR-0036 named and did not measure.
4. **The candidate's artifact matches the source landing with it.** At `e4e5154`, with no
   local build: `canonical artifact verified: fcd0832f…` and `git diff --exit-code -- dist/
   installer/canonical-artifact.json` clean.
5. **A mismatched artifact is refused.** #763 was #762's rebuild with `dist/commitlore.mjs`
   edited by hand; both `check` jobs failed. `artifact:verify` *passed* there — the manifest
   binds `src/`, which was untouched — so the rebuild-and-diff is what caught it, and the
   two checks are not one check twice.
6. **The contributor's head reaches `main` with nobody rebuilding by hand.** #761 is
   recorded merged, by reachability rather than by keyword, and the bundle commit's author
   is `commitlore-canonical-build[bot]`.
7. **No branch-protection bypass, and the tag gate is untouched.** `canonical-artifact`,
   `version-consistency` and `exact-head-ci` still hold, and no tag is reachable without
   them.

**Limit — external contributor experience is unobserved.** Nobody outside this repository
has yet taken this path. That is adoption evidence rather than a correctness gate: it
measures whether anyone has arrived, not whether the mechanism works. Holding the feature
open for it would leave the work permanently unfinished for a reason unrelated to the work.
A real-world failure reopens #719 or opens a defect issue of its own.

## What reopened the schedule

Both conditions below were written while this was deferred. Condition 2 is what happened —
the same contributor blocked twice on a maintainer-only `build:canonical` — and rather than
wait for a second person to confirm a pattern already visible, the work was scheduled. The
conditions are kept for the record.

1. Three or more overlapping source-PR rebuilds in an ordinary week with no release.
   2026-08-17's four were a release-day spike; the same rate on a quiet week is the
   ordinary cadence.
2. A **second** non-Linux contributor blocked on a maintainer-only `build:canonical`. One
   contributor twice is an anecdote with a repeat; two people is the pattern.
