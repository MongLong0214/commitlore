# ADR-0036: a bot merge goes through a pull request, because a push cannot be checked

- Status: Accepted (2026-08-17)
- Owner: CTO
- Issue: [#719](https://github.com/MongLong0214/commitlore/issues/719)
- PRD: [F15](../prd/PRD-F15-canonical-artifact-provenance.md) — closes its "unsolved question"
- Ticket: T-1501
- Relates to: [ADR-0011](ADR-0011-plugin-first-distribution.md) (distribution is a git clone), and #723's
  record that `preserve` reports rather than blocks

## Context

F15 wants pull requests to stop carrying `dist/`. The direction is a privileged merge: a
GitHub App merges the source, runs `build:canonical` and `artifact:manifest`, and publishes
that tree — so the commit that lands matches its own source from the start.

The question T-1501 exists to answer is what verifies that commit. **A tree the App
assembles has never been checked.** That the source pull request was green is a statement
about a different tree, and shipping the naive form moves the gate from *blocking before* to
*reporting after* — the limitation recorded against `preserve` in #723, adopted voluntarily.

## The finding that decides it

`main`'s branch protection requires **eleven** status contexts. Ten are the release gate's
`REQUIRED_CHECKS`. The eleventh is `lint`, and `demo-lint.yml` says why it cannot appear
anywhere else:

```yaml
lint:
  # The action's own range derivation works for PRs. On push events there is
  # no base_ref, so this job only runs for pull requests.
  if: github.event_name == 'pull_request'
```

A direct push produces no `lint` context, ever. Protection evaluates required contexts on
the commit being pushed, so **no push to `main` can satisfy protection on its merits** —
not the App's, not anyone's. Every push-shaped option therefore needs a bypass, and a
bypass is not "the check ran and passed"; it is "the check did not have to".

That is not a fact about this App. It is a fact about this repository's gate: `main` is
reachable only through a pull request by construction.

## Decision

**The App does not push to `main`. It opens a pull request.**

The App assembles a branch — the source change plus a canonical rebuild — and opens a pull
request for it. All eleven contexts run on that branch, including `lint`. It merges the way
every other change merges.

No bypass is requested, and none should be granted for this purpose.

## Consequences

**What is preserved.** Every commit reaching `main` has passed the same eleven checks as
any other. `git diff --exit-code -- dist/` keeps its meaning, and the two claims F15 refuses
to separate — *this source is deterministic* and *this checkout is the plugin* — stay
joined at the point the commit is admitted rather than reported on afterwards.

**What it costs.** One additional pull request and one additional CI cycle per change. That
is worse than today for a change that would not have conflicted, and better for one that
would. It also spends CI to buy a property rather than to buy speed, which is the trade F15
was reaching for in the other direction.

**What it fixes, and this is the point.** A contributor never needs `build:canonical`. #720
arrived from a Windows machine with `src/` and `test/` only — correctly, since a Windows
host cannot produce a `linux/amd64` Docker build — and waited on a maintainer twice. Under
this decision that wait does not exist, on any platform.

**What stays open.** Whether the saving is worth the second cycle. This ADR answers *how a
bot merge is verified*, not *whether to build one*. #719's reopening conditions are
unchanged, and T-1502 remains unscheduled.

## Rejected

**Bypass plus a required push-event check.** Cheapest, and the honest description is that
`main` may hold an unverified tree until the push job finishes. #723 records exactly this
shape as a limitation forced by an event; choosing it here would be adopting it by
preference. If the cost of the extra cycle ever makes this necessary, it should arrive as
its own ADR that says plainly which property is being traded.

**Staging ref, then fast-forward `main`.** Appealing because the staging commit could carry
its own green checks, so the push looks like it stands on its merits. It does not: `lint`
never runs on a branch push either, so the staging commit is missing the same context and
the fast-forward needs the same bypass. The finding above kills this one specifically, and
it is recorded because it is the option that looks safest before the `lint` detail is
noticed.

**Push the rebuild to the contributor's own branch.** Removes the contributor's dependency
on Docker without an extra pull request, and does not remove the conflict — every branch
still carries `dist/`. It also cannot reach a fork: the App is installed on this repository,
not on anyone's fork, so the case that actually hurt is the case it misses.

## What must be verified before T-1502

1. **That protection evaluates required contexts on the pushed commit**, as assumed above.
   The decision does not depend on it — going through a pull request is correct either way —
   but the *rejection* of the staging-ref option does.
2. **That a pull request opened by an App triggers the same eleven checks.** A workflow
   whose `on: pull_request` does not fire for App-opened pull requests would leave the
   rebuild pull request green with nothing having run, which is the empty-runner shape
   (#722) in a new place.

Neither has been measured. Recorded as assumptions rather than facts.
