# ADR-0037: the CLI does not reimplement installing

- Status: Accepted (2026-08-18) — narrowed on review; revision 1's scope was wider than its evidence
- Owner: CTO
- Issue: [#742](https://github.com/MongLong0214/commitlore/issues/742)
- PRD: [F16](../prd/PRD-F16-release-awareness.md)
- Relates to: [ADR-0011](ADR-0011-plugin-first-distribution.md) (distribution is a git clone), #691 (one implementation of host wiring), #735 (the installer verifies its own work)

## Context

F16 wants an operator to learn that a newer release exists. The obvious next step is for the tool to install it — "auto-update" is what the request usually means.

Revision 1 decided that `commitlore upgrade` prints the command and rejected a `--apply` flag alongside it. **Two of the three arguments for that rejection did not survive review, and one of them was an error of fact.** This revision keeps what held and withdraws what did not.

## Decision

**The clone, the manifest and tag verification, the host wiring and the move are never written a second time.** No TypeScript reimplementation of installing, in any command, behind any flag.

That is the whole of this ADR now. **Upgrading itself is permitted** — invoking the installer is not reimplementing it, and checking what the invocation did is not either. [ADR-0038](ADR-0038-upgrade-invokes-the-installer.md) specifies `commitlore upgrade`.

This ADR's two attempts to forbid upgrading are recorded below rather than deleted. They are why the rule is now stated as narrowly as the evidence supports, and they are the reason to distrust the next wide version of it.

## Why the core holds

**There is one implementation of installing, and a TypeScript copy would be the second.** `install.sh` and `install.ps1` clone a pinned tag into `<data-root>/v<version>` and move `current` to it. #691 removed 845 lines to end exactly this shape, after three readers in three days mistook a dead copy for the live one.

**A copy would have to re-derive what the original learned the hard way.** #735 shipped in 1.0.2 and survived two releases: `mv -f` followed a symlink to a directory, moved the temporary link inside it, returned zero, and the installer printed `current -> v1.1.1` over a `current` that had not moved. The repair was not only the rename — it was that the success line is printed **after reading the link back** (`install.sh:648-671`). A second implementation of the move either re-derives that lesson or reports the same lie in a new place, and the second is what happens by default.

**What is forbidden is reimplementing the work, not checking it.** Revision 2 of this ADR stated the reason as *"the one implementation verifies itself, and a copy would not inherit that"* — making **verification** the thing a copy must not touch. That is too wide, and ADR-0038 collides with it head-on by reading the link from TypeScript. The two cannot both be right.

The narrower statement is the true one, and it is what #691 actually supports: **the clone, the manifest and tag verification, the host wiring and the move are what may not exist twice.** Reading a symlink after invoking the installer is none of those. And the alternative to reading it — trusting the installer's exit code — is precisely what #735 was, so a rule that forbade the check would mandate the defect.

So: these forbid **reimplementing** the installer. They do not forbid **invoking** it, and they do not forbid **verifying what it did**. Revision 1 used them as though they did both.

## What was withdrawn, and why

**The appeal to convention was backwards.** Revision 1 wrote that *"`gh` does not self-update. `npm` notifies. `rustup` has a dedicated command a human runs"*, offering all three as precedent for not self-replacing. Read at the source: `rustup` **does** replace itself, `auto-self-update` is enabled by default, and `--no-self-update` exists precisely because the default is to self-update. `deno upgrade` and `bun upgrade` replace their executables in place. Of the six tools surveyed in PRD-F16, three self-replace. **Self-replacement is the majority behaviour, and citing convention argues against this ADR rather than for it.** Only `gh` and the `update-notifier` family support the notify-only shape, and this decision now rests on the two repository-specific facts above instead.

**The rejection of `--apply` contradicted this document's own text.** Revision 1 rejected the flag while writing:

> *"If this is ever wanted, the right shape is for the CLI to invoke the installer, not to reimplement it."*

That sentence describes `--apply`. The rejection also argued that unasked action differs from reporting — true, and an operator who types `--apply` has asked. And the residual objection, *"fetching and executing a script from the network is the step being avoided"*, does not distinguish the two: the line F16 prints **is** that fetch-and-execute one-liner, and a human pasting it runs the same bytes.

## The obstacle that looked real, and did not hold either

Revision 2 of this ADR offered a replacement obstacle: `<data-root>/current/install.sh` is the **old** installer, so upgrading with it inherits its defects, and #735 is the proof rather than a hypothetical — a machine on 1.0.1 would clone the new version, fail to move `current`, and report success.

**That did not survive review either, and the refutation is verified in this repository's own source:**

- `install.sh:388` takes a version argument, and with one supplied it skips discovery entirely and goes to `install.sh:548` — `git clone --quiet --depth 1 --branch "$version"`. **The clone of the new tree does not touch `current` and cannot be affected by the move defect.**
- #735 is a defect in the *move*, and its one observable symptom is a `current` that did not move while the exit code said otherwise. **That is detectable from outside by reading the link.**
- `install.sh:523-538` reuses an existing checkout after verifying its runtime manifest and requested tag, so the new tree — already on disk from the first call — is not re-cloned by a second one.

So an `--apply` that calls the on-disk installer for the target tag, **verifies the move itself**, and falls back to the newly downloaded tree's installer is neither a second implementation nor a hostage to the old one. [ADR-0038](ADR-0038-upgrade-invokes-the-installer.md) specifies it.

**This ADR was wrong twice about the same thing, in the same direction — narrowing a request the owner made.** #742 asked for a version check *and* an update capability. Both rejections were reasoned rather than measured, and both dissolved when the source was read. What is left is the part that was never in doubt: no second installer.

## Consequences

**Every upgrade path goes through the shell installer, including the one the CLI drives.** That is the cost — a `sh`/`pwsh` process where a pure-TypeScript implementation would need none — and it buys the thing #691 paid 845 lines to get: exactly one place where installing is defined, and therefore exactly one place where a defect like #735 has to be fixed.

**The notice still prints the command, where `gh` cannot.** `gh` prints `brew upgrade gh` only when it detects a Homebrew install and otherwise falls back to a URL, because naming a command that will not work is worse than naming none. README:73 records that the Claude Code plugin *"puts no `commitlore` on `PATH`"* — the CLI always comes from `install.sh` or `install.ps1` — so there is exactly one correct command per platform and it can be named unconditionally. Picking the wrong platform's line is still a way to give bad advice, so it is a named test case in T-1603.

**A stale install stays stale until someone acts.** This ADR does not fix that; F16's passive notice makes the staleness visible, and visibility is the property being bought.

**`doctor` remains the check that catches the split.** It already reports a hook interpreter on a different version from the CLI, and that report is what found #735.

## Rejected

**Silent background update.** Removes the operator from a decision about which build validates their commits in every repository on the machine — something they are entitled to schedule. It would also have made #735 invisible rather than merely quiet: the failure would have been a machine that never upgraded and never said so. This rejection was not challenged on review and stands on its own; revision 1's error was bundling an explicit, operator-typed `--apply` into it.

**Bundling an updater with the installer** so `install.sh` schedules its own re-run. Moves the same step into a place with fewer eyes on it, and puts a network call on a timer inside an organisation that may forbid exactly that.
