# ADR-0038: `commitlore update --apply` invokes the installer and verifies the move itself

- Status: Accepted (2026-08-18)
- Owner: CTO
- Issue: [#742](https://github.com/MongLong0214/commitlore/issues/742)
- PRD: [F16](../prd/PRD-F16-release-awareness.md)
- Relates to: [ADR-0037](ADR-0037-the-cli-does-not-replace-itself.md) (no second installer), #735 (the move that reported success without moving), #691 (one implementation), #723 (put the rule where it is enforced)

## Context

The request that opened #742 was for a version check **and an update capability**. ADR-0037 revision 1 rejected the second half, and the rejection did not survive two rounds of review: it contradicted its own text, and the obstacle offered in its place — that `<data-root>/current/install.sh` is the *old* installer, so applying an upgrade with it inherits its defects — turns out to be escapable.

**So the rejection narrowed a request on reasoning that did not hold.** This ADR restores it.

## What broke the obstacle

Three facts about `install.sh`, each read rather than recalled:

**A version argument bypasses discovery entirely.** `install.sh:388` takes `version="${1:-}"`, and with one supplied it skips the `git ls-remote` ranking and goes straight to `install.sh:548` — `git clone --quiet --depth 1 --branch "$version"`. The clone of the new tree does not touch `current` and cannot be affected by the `current`-move defect.

**#735 was a defect in the move, not in the clone.** `mv -f` followed a symlink into a directory, returned zero, and the installer printed `current -> v1.1.1` over a `current` that had not moved. The repair (`install.sh:648-671`) is `readlink`: *"Report what the link says, not what the command returned."* An old installer therefore fails in exactly one observable way — it leaves `current` unmoved while claiming otherwise — and **that failure is detectable from outside by reading the link.**

**A second invocation reuses the first one's work.** `install.sh:523-538` reuses an existing checkout once it has verified the runtime manifest and that the checkout is the requested tag. So the new tree, already on disk from phase one, is not re-cloned.

## Decision

`commitlore update --apply` **invokes `install.sh` / `install.ps1` with the target tag and then verifies the result itself.** It contains no clone, no move, and no unpack.

```
1. exec  <data-root>/current/install.sh <target-tag>
      the on-disk installer. It may be old. Its clone is sound either way.

2. readlink <data-root>/current
      the CLI's own check, not the installer's report. This is the #735 lesson
      applied from the outside: an exit code is not evidence that the link moved.

3. if it did not move:
      exec <data-root>/v<target-tag>/install.sh <target-tag>
      the NEW tree's installer, which carries the fixed move and reuses the
      checkout phase one already verified.

4. readlink again. If it still has not moved, fail loudly and print the manual
      command. Never report success from an exit code.
```

**Reading a symlink is not installing.** Step 2 is the only logic this adds outside the installer, and it duplicates none of the clone, verification, host-wiring or move that ADR-0037 protects. #723 is the precedent for putting a rule at the point where it is enforced rather than in a comment.

## Consequences

**The bootstrap is self-healing across the one defect it has to survive.** A machine on 1.0.1 — the last release with the #735 move — upgrades correctly, because phase three runs the installer it just downloaded. A machine on a future release with a different move defect is not covered, and nothing can cover that in general; step 4 is why it fails loudly instead of quietly.

**`--apply` is explicit, always.** Never a default, never on a timer, never implied by the notice. `rustup` enables `auto-self-update` by default and `deno`/`bun` replace in place on command; the majority behaviour supports having the capability, not having it unasked. ADR-0037's rejection of a silent background update stands untouched, and this is the distinction it was originally trying to draw before it bundled the two together.

**The hooks pointing at `current` during the move are unchanged by this.** `install.sh:658-660` already records that unlink-and-rename is not atomic and that a reader resolving in the gap *"fails visibly rather than silently using the old build"* — the correct trade, and `--apply` inherits it rather than widening it.

**`doctor` remains the check that catches a split**, and after `--apply` it is what an operator runs to confirm the hooks now resolve to the new build.

## Rejected

**Reimplementing the clone-and-move in TypeScript.** ADR-0037's surviving core, unchanged. The two-phase bootstrap exists precisely so that no step of installing is written twice.

**Trusting the installer's exit code.** #735 returned zero while doing nothing. An `--apply` that reported from the exit code would reproduce the exact failure this feature was built to expose, which is the strongest possible argument for step 2 and the reason it is a named test rather than a comment.

**Fetching a fresh `install.sh` from the network to run it.** Phase one's on-disk installer is enough, because its clone is unaffected and its lie is detectable. Downloading a script to execute is a step worth not taking when the outcome is identical.
