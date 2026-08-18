# ADR-0038: `commitlore upgrade` upgrades, by invoking the installer and checking the link

- Status: Accepted (2026-08-18) — revision 2, after a third review round broke revision 1's mechanism three ways
- Owner: CTO
- Issue: [#742](https://github.com/MongLong0214/commitlore/issues/742)
- PRD: [F16](../prd/PRD-F16-release-awareness.md)
- Relates to: [ADR-0037](ADR-0037-the-cli-does-not-replace-itself.md) (no second installer), #735 (the move that reported success without moving), #382 (an upgrade does not visit the repositories that pinned the old build), #691 (one implementation), #723 (put the rule where it is enforced)

## Context

#742 asked for a version check **and an update capability**. ADR-0037 rejected the second half twice on grounds that dissolved when the source was read.

Revision 1 of this ADR restored it as `commitlore update --apply`. Two things then landed:

**The verb should not need a flag** — a command whose verb is the action should perform it, and `--apply` was this repository inventing a convention.

**But the verb was the wrong one, and the argument for it was the survey misread.** Revision 1 wrote that *"`brew update`, `rustup update` and `npm update` all update"*. Two of those three are a different operation: `brew update` refreshes Homebrew and its formula index — **`brew upgrade`** replaces installed packages — and `npm update` updates a project's dependencies, not npm. Only `rustup update` self-replaces, and only as a side effect of updating the toolchains it manages.

**`brew` and `rustup` are managers with an inventory; this is not.** CommitLore has no dependencies and no toolchains — it is one tree that gets replaced, which is exactly the shape of `deno` and `bun`. Both of those call it **`upgrade`** and keep `update` for dependencies. So does this.

**Where the acting tools act is more specific than "always".** Homebrew does not auto-update on every `brew` invocation; it updates on `brew install`, a moment already about package management. `rustup update` is the update command. **The standard is not "auto everywhere" — it is "auto at the moment that is already about installation."**

## Decision

**`commitlore upgrade` performs the upgrade** by invoking `install.sh` / `install.ps1`. `--check` is the read-only form. There is no `--apply`.

**`commitlore init` checks, says so loudly, and does not upgrade. `commitlore init --upgrade` upgrades first.**

Revision 1 had `init` upgrade unconditionally, on the Homebrew analogy. **The analogy does not reach here, and three independent things say so:**

- **`brew install` refreshes the index; `brew upgrade` replaces packages.** Installing one formula does not change the runtime of anything already installed. Moving `current` does exactly that — every repository already wired on this machine resolves its hook interpreter through it. That is `brew upgrade --all` wearing `brew install`'s name.
- **`terraform init` — the closest analogue by name — refuses this explicitly.** Its own documentation: *"Re-running init with modules already installed will install the sources for any modules that were added to configuration since the last init, but will not change any already-installed modules. Use `-upgrade` to override this behavior."* A flag is required to touch what is already pinned.
- **#746, measured on this machine.** An upgrade moves `current` while `commitlore.root` stays on the old version, and the commit-msg hook's containment check compares them — so today an upgrade *invalidates the recorded path in every already-wired repository*. Auto-upgrading from `init` would break repositories the operator never named.

**Announcement is not scoping.** Revision 1 bounded the blast radius with non-CI, TTY, an opt-out and a spoken line — every one of which limits *when* it fires, not *what it hits*. ADR-0037 rejected the silent background update on precisely that distinction, and accepting it here under a different name would be the same mistake with better manners.

What `init` does instead still fixes what #742 actually named. `init` writes `commitlore.bin` through `<data-root>/current` — verified on this machine — so a stale install at `init` time wires a repository to a stale protocol. `init` now **says that in its own output**, names the pinned version, and prints the command. The repository still gets wired; the operator learns, at the moment it matters, that they wired it to something old. Machine-wide movement stays behind a command somebody asked for.

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

**Nothing changes the machine unless somebody typed a command that says so.** `upgrade` and `init --upgrade` are the only two, and both are the operator naming the blast radius. Revision 1 accepted that radius for a bare `init` on an analogy that did not hold; withdrawing it costs a flag and buys back the property that a repository-scoped command has repository-scoped effects.

**A machine that never runs `init` or `upgrade` still goes stale.** The passive notice is what makes that visible; this ADR does not replace it.

**`doctor` remains the check for a split**, and after an update it is what confirms the hooks resolve to the new build. #382 is the reason that is a separate question: an upgrade does not visit the repositories that pinned an old root.

## Rejected

**A y/n prompt.** Not the standard, and actively wrong for a CLI: in scripts, CI, pipes and hooks a prompt either blocks forever or reads a keystroke nobody typed. Every surveyed tool that acts, acts without asking and offers a switch.

**Auto-update on arbitrary commands.** This is where Homebrew's shape stops and the unattended fetch-and-execute ADR-0037 refuses begins. `status` and `query` are not installation moments.

**Reimplementing the clone-and-move in TypeScript.** ADR-0037's surviving core. The invoke-and-check shape exists so that no step of installing is written twice.

**Trusting the installer's exit code.** #735 returned zero while doing nothing. An update that reported from the exit code would reproduce the exact failure this feature exists to expose — which is why step 2 is a named test rather than a comment.

**Fetching a fresh `install.sh` to run in step 1.** The on-disk installer's clone is unaffected by the one defect at issue, and its lie is detectable. Step 4 is the only place a fresh script is named, and there it is printed for a human rather than executed.
