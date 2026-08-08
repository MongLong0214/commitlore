# Installing, and taking it back out

Which hosts are supported and what each install path requires is stated once, in
[COMPATIBILITY.md](COMPATIBILITY.md). This page is what each path actually
writes, and how to undo it.

Prerequisites for every path: Node.js 22 or newer, and Git. `install.sh` and
`install.ps1` check both before they write anything; the plugin path checks
nothing.

The copy-paste commands, pinned to the current release, are in the
[README](../README.md) — the version there is asserted against
`package.json` by `test/readme.test.ts`, so it is the one place a pin cannot go
stale unnoticed.

## The Claude Code plugin

```
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

That is the whole plugin: the MCP server, the pre-edit `PreToolUse` hook, and
the skills. It puts no `commitlore` on `PATH`, so the `commitlore …` commands
need `install.sh` / `install.ps1` as well.

### Staying current

Nothing updates the plugin on its own, and updating it is **two steps**:

```
/plugin marketplace update commitlore
/reload-plugins
```

The first downloads the new version beside the old one. The second is what makes
the running MCP server and hook use it — until then the cache holds the new
version while the process keeps serving the old one, and both are true at once:

```
$ ls ~/.claude/plugins/cache/commitlore/commitlore/
0.4.0
0.6.0
$ ps
… node .../commitlore/0.4.0/dist/commitlore.mjs mcp
```

This matters more than a stale dependency usually does, because **the agent runs
the hook, not the CLI**. A plugin left behind grades every edit by an older
build's rules while `commitlore --version` in your terminal reports something
newer.

`commitlore doctor` reports it, by asking the executable the hook actually
resolves to for its version:

```
warn    PreToolUse hook version — the agent's hook runs 0.4.0 but this CLI is 0.6.0
        — every edit is graded by 0.4.0's rules, not this one's
```

## The install scripts

`install.sh` (POSIX shell) and `install.ps1` (PowerShell) install a pinned
source checkout and a thin wrapper that runs `node <checkout>/dist/commitlore.mjs`.
They download no compiled artifact and run no build step, so what lands on the
machine is source you can read.

The one-liner is for convenience. For a reviewed or pinned install, download and
inspect `install.sh` first, or clone the repository — the checkout the script
makes is one you can make yourself. Both forms are shown in the README, under
*Prefer to inspect or pin the installation?*.

## From a source checkout

To inspect or run the source distribution without the wrapper at all:

```bash
git clone https://github.com/MongLong0214/commitlore ~/.commitlore
node ~/.commitlore/dist/commitlore.mjs init
node ~/.commitlore/dist/commitlore.mjs context src/auth
```

Every `commitlore <command>` in the documentation works as
`node ~/.commitlore/dist/commitlore.mjs <command>`.

## Per repository

Installing the CLI does not change any repository. Run this in each repository
where you want validation hooks and a local index:

```bash
cd your-repository
commitlore init
```

`init` installs the hooks, rebuilds the index, installs the Claude hook, and
runs `doctor --fix`. The installer detects supported coding agents and registers
the local MCP server where it can do so safely.

## Uninstall

```bash
commitlore uninstall
```

Removes what `install.sh` or `install.ps1` wrote — the wrapper, the pinned
checkout, and the MCP entry it added to each agent config. It removes nothing it
did not write, and names what it leaves:

| Left behind | Removed by |
|---|---|
| the per-repository hooks: `commit-msg`, `prepare-commit-msg`, `post-commit` | `commitlore hooks uninstall` |
| the agent hook | `commitlore inject uninstall-claude-hook` |
| the Claude Code plugin | `/plugin uninstall commitlore@commitlore` |

`commitlore uninstall --dry-run` reports what would be removed and changes
nothing. `commitlore hooks uninstall` restores any hook CommitLore replaced, and
`commitlore inject uninstall-claude-hook` leaves every other setting untouched.
