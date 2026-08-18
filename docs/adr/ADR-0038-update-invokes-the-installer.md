# ADR-0038: `commitlore update` updates, by invoking the installer and checking the link

- Status: Accepted (2026-08-18) — revision 2, after a third review round broke revision 1's mechanism three ways
- Owner: CTO
- Issue: [#742](https://github.com/MongLong0214/commitlore/issues/742)
- PRD: [F16](../prd/PRD-F16-release-awareness.md)
- Relates to: [ADR-0037](ADR-0037-the-cli-does-not-replace-itself.md) (no second installer), #735 (the move that reported success without moving), #382 (an upgrade does not visit the repositories that pinned the old build), #691 (one implementation), #723 (put the rule where it is enforced)

## Context

#742 asked for a version check **and an update capability**. ADR-0037 rejected the second half twice on grounds that dissolved when the source was read.

Revision 1 of this ADR restored it as `commitlore update --apply`. Two things then landed:

**The verb should not need a flag.** `brew update`, `rustup update` and `npm update` all update. Requiring `--apply` to make an update command update is the part that is not standard — and the survey in PRD-F16 exists precisely to stop this repository inventing conventions.

**Where the acting tools act is more specific than "always".** Homebrew does not auto-update on every `brew` invocation; it updates on `brew install`, a moment already about package management. `rustup update` is the update command. **The standard is not "auto everywhere" — it is "auto at the moment that is already about installation."**

## Decision

**`commitlore update` performs the upgrade** by invoking `install.sh` / `install.ps1`. `--check` is the read-only form. There is no `--apply`.

**`commitlore init` updates first, then does its work.** This is the highest-value point in the feature and the reason #742 exists: `init` writes `commitlore.bin` pointing through `<data-root>/current`, so the repository validates every commit with whatever `current` resolves to — verified on this machine, where `commitlore.bin` is `…/commitlore/current/dist/commitlore.mjs`. A stale install at `init` time is a repository wired to a stale protocol.

**Every other command: the passive notice only.** **Hooks: silence** — no notice, no check, no update. A commit is not a package-management moment, and replacing the interpreter while the hook runs is a different act from Homebrew refreshing before an install.

**The opt-out is `COMMITLORE_NO_AUTO_UPDATE`**, mirroring `HOMEBREW_NO_AUTO_UPDATE` in name and meaning. The naming convention is part of the standard: an operator who knows the Homebrew switch should be able to guess this one.

## The mechanism, and what it is honestly worth

```
1  exec  <data-root>/current/install.sh <target-tag>
      the on-disk installer, which may be old. Its clone is sound regardless:
      install.sh:388 takes a version argument and install.sh:548 clones that tag
      directly, never touching `current`.

2  readlink <data-root>/current  and compare it to <data-root>/v<target-tag>
      NOT "did it change" -- "does it resolve to the tag we asked for". Revision 1
      said "if it did not move", which an installer that moved it somewhere wrong
      would satisfy, and the retry would never fire.

3  if it does not resolve to the target:
      exec <data-root>/v<target-tag>/install.sh <target-tag>
      the NEW tree's installer, carrying the fixed move, reusing the checkout
      step one verified (install.sh:523-538).

4  readlink and compare again. If it still does not resolve to the target, fail
      with a non-zero exit and print the canonical install one-liner -- the same
      line the notice prints, fetched fresh. NOT the local install.sh, which is
      the bytes that just failed twice.
```

**This is a retry across one named defect, not a general recovery, and revision 1 overclaimed it.** It said the bootstrap "is self-healing" and then admitted in the next sentence that a future release with a different move defect is not covered. Both cannot be the headline. The bounded claim is the true one:

- A machine on 1.0.1 or 1.0.2 — the releases with the #735 move — upgrades correctly, because step 3 runs the installer it just downloaded.
- A machine whose *target* release has a broken move is not recovered by anything here. Step 4 is why it fails loudly with a command that does not come from either failed installer.
- **Step 2's comparison against the target is what keeps a wrong-but-successful move from being read as success.** Without it, "the link changed" would stand in for "the link is right", and that substitution is the same shape as #735 reading an exit code for an outcome.

**What still cannot be checked from here:** a `current` that resolves to the right tag over a checkout whose contents are wrong. `install.sh:523-538` verifies a reused checkout's runtime manifest and tag, and `doctor` compares the running build against the pinned one (#382). Neither belongs in this command, and step 4's failure text names `doctor` for that reason.

**Reading a symlink is not installing.** ADR-0037 revision 3 narrows its own rule to say so: the clone, the manifest and tag verification, the host wiring and the move may not exist twice; checking the result of an invocation is not one of them. Refusing to look would be trusting the exit code, which is what #735 was.

## Consequences

**`init` can now change what every repository on the machine validates with.** That is a real blast radius for a repository-scoped command, and it is the cost of this decision rather than an oversight. Three things bound it: it happens only when an update exists, only outside CI and off a pipe, and it says what it did. `COMMITLORE_NO_AUTO_UPDATE` declines it. Homebrew makes the same trade at `brew install`.

**A machine that never runs `init` or `update` still goes stale.** The passive notice is what makes that visible; this ADR does not replace it.

**`doctor` remains the check for a split**, and after an update it is what confirms the hooks resolve to the new build. #382 is the reason that is a separate question: an upgrade does not visit the repositories that pinned an old root.

## Rejected

**A y/n prompt.** Not the standard, and actively wrong for a CLI: in scripts, CI, pipes and hooks a prompt either blocks forever or reads a keystroke nobody typed. Every surveyed tool that acts, acts without asking and offers a switch.

**Auto-update on arbitrary commands.** This is where Homebrew's shape stops and the unattended fetch-and-execute ADR-0037 refuses begins. `status` and `query` are not installation moments.

**Reimplementing the clone-and-move in TypeScript.** ADR-0037's surviving core. The invoke-and-check shape exists so that no step of installing is written twice.

**Trusting the installer's exit code.** #735 returned zero while doing nothing. An update that reported from the exit code would reproduce the exact failure this feature exists to expose — which is why step 2 is a named test rather than a comment.

**Fetching a fresh `install.sh` to run in step 1.** The on-disk installer's clone is unaffected by the one defect at issue, and its lie is detectable. Step 4 is the only place a fresh script is named, and there it is printed for a human rather than executed.
