# ADR-0037: the CLI does not reimplement installing

- Status: Accepted (2026-08-18) — narrowed on review; revision 1's scope was wider than its evidence
- Owner: CTO
- Issue: [#742](https://github.com/MongLong0214/commitlore/issues/742)
- PRD: [F16](../prd/PRD-F16-release-awareness.md)
- Relates to: [ADR-0011](ADR-0011-plugin-first-distribution.md) (distribution is a git clone), #691 (one implementation of host wiring), #735 (the installer verifies its own work)

## Context

F16 wants an operator to learn that a newer release exists. The obvious next step is for the tool to install it — "auto-update" is what the request usually means.

Revision 1 decided that `commitlore update` prints the command and rejected a `--apply` flag alongside it. **Two of the three arguments for that rejection did not survive review, and one of them was an error of fact.** This revision keeps what held and withdraws what did not.

## Decision

**`commitlore update` reports: current version, latest version, and the exact install command for the platform. It does not fetch, unpack, move, or delete anything, and no second implementation of installing is written in TypeScript.**

`commitlore update --apply` is **out of scope for F16 and not rejected on principle.** The obstacle is named below and belongs to its own ADR.

## Why the core holds

**There is one implementation of installing, and a TypeScript copy would be the second.** `install.sh` and `install.ps1` clone a pinned tag into `<data-root>/v<version>` and move `current` to it. #691 removed 845 lines to end exactly this shape, after three readers in three days mistook a dead copy for the live one.

**The one implementation verifies itself, and a copy would not inherit that.** #735 shipped in 1.0.2 and survived two releases: `mv -f` followed a symlink to a directory, moved the temporary link inside it, returned zero, and the installer printed `current -> v1.1.1` over a `current` that had not moved. The repair was not only the rename — it was that the success line is printed **after reading the link back** (`install.sh:648-671`). A second implementation either re-derives that lesson or reports the same lie in a new place, and the second is what happens by default.

Both of these forbid **reimplementing** the installer. Neither of them forbids **invoking** it, and revision 1 used them as though they did.

## What was withdrawn, and why

**The appeal to convention was backwards.** Revision 1 wrote that *"`gh` does not self-update. `npm` notifies. `rustup` has a dedicated command a human runs"*, offering all three as precedent for not self-replacing. Read at the source: `rustup` **does** replace itself, `auto-self-update` is enabled by default, and `--no-self-update` exists precisely because the default is to self-update. `deno upgrade` and `bun upgrade` replace their executables in place. Of the six tools surveyed in PRD-F16, three self-replace. **Self-replacement is the majority behaviour, and citing convention argues against this ADR rather than for it.** Only `gh` and the `update-notifier` family support the notify-only shape, and this decision now rests on the two repository-specific facts above instead.

**The rejection of `--apply` contradicted this document's own text.** Revision 1 rejected the flag while writing:

> *"If this is ever wanted, the right shape is for the CLI to invoke the installer, not to reimplement it."*

That sentence describes `--apply`. The rejection also argued that unasked action differs from reporting — true, and an operator who types `--apply` has asked. And the residual objection, *"fetching and executing a script from the network is the step being avoided"*, does not distinguish the two: the line F16 prints **is** that fetch-and-execute one-liner, and a human pasting it runs the same bytes.

## The obstacle that is real, and it is new

Every shape `--apply` can take hits one of three walls, and the first was not visible in revision 1:

**Run the installer already on disk.** `<data-root>/current/` is a git clone of the installed tag, so `install.sh` is right there — and it is the **old** one. Upgrading with a stale installer inherits that installer's defects, and #735 is the proof rather than a hypothetical: a machine still on 1.0.1 would clone the new version, fail to move `current`, and report success. **That is precisely the silent staleness F16 exists to expose, reintroduced by F16's own convenience.**

**Fetch the current installer and run it.** This is the network fetch-and-execute step, now performed by a tool instead of a human. Defensible — the operator asked — but it is a genuine change in what the tool does, and it deserves a decision of its own rather than a flag added to a reporting feature.

**Clone the tag first, then run the new tree's installer.** The clone is then implemented twice, which the surviving core of this ADR forbids.

None of these is fatal. All three need an argument F16 does not have, so `--apply` waits for one.

## Consequences

**The operator runs one command that is not this tool.** That is the cost, and it is `gh`'s cost. The notice and `commitlore update` both print the command in full, so it is a copy and a paste rather than a search.

**We can print the command, where `gh` cannot.** `gh` prints `brew upgrade gh` only when it detects a Homebrew install and otherwise falls back to a URL, because naming a command that will not work is worse than naming none. README:73 records that the Claude Code plugin *"puts no `commitlore` on `PATH`"* — the CLI always comes from `install.sh` or `install.ps1` — so there is exactly one correct command per platform and it can be named unconditionally. Picking the wrong platform's line is still a way to give bad advice, so it is a named test case in T-1603.

**A stale install stays stale until someone acts.** This ADR does not fix that; F16's passive notice makes the staleness visible, and visibility is the property being bought.

**`doctor` remains the check that catches the split.** It already reports a hook interpreter on a different version from the CLI, and that report is what found #735.

## Rejected

**Silent background update.** Removes the operator from a decision about which build validates their commits in every repository on the machine — something they are entitled to schedule. It would also have made #735 invisible rather than merely quiet: the failure would have been a machine that never upgraded and never said so. This rejection was not challenged on review and stands on its own; revision 1's error was bundling an explicit, operator-typed `--apply` into it.

**Bundling an updater with the installer** so `install.sh` schedules its own re-run. Moves the same step into a place with fewer eyes on it, and puts a network call on a timer inside an organisation that may forbid exactly that.
