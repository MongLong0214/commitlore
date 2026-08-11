---
name: commitlore-setup
description: Set up CommitLore in a repository when the operator asks for it.
metadata:
  hermes:
    category: commitlore
    tags: [git, decisions, setup]
---

# CommitLore setup

Use this skill only when the operator asks to wire CommitLore into the current
repository, or asks to diagnose its existing setup. Host configuration is
separate and is performed by `commitlore hermes install`.

Run `commitlore init` in the repository. It installs the repository hooks,
rebuilds the local decision index, writes only the notes transport setting that
belongs to that clone, and reports any step it could not complete. It is safe
to run again. Do not run it merely because this skill was discovered: hooks and
capture policy are repository choices.

For a diagnosis without changing the repository, run `commitlore doctor`.
Use `commitlore doctor --fix` only after explaining its local changes. The host
MCP configuration does not replace this repository setup.
