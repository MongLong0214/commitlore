# Compatibility

The authoritative statement of which hosts CommitLore supports and what each
install path requires. Where a README and this document disagree, this document
is correct — and `test/compatibility-matrix.test.ts` compares every table below
to the files that provide what it claims, so a row that drifts fails rather than
misleads.

There is no compiled artifact anywhere in the product ([ADR-0026](adr/ADR-0026-node-only-distribution.md)),
and neither install script contains a platform, architecture or libc check —
there is no platform-specific artifact to choose between.

## Install paths

| Path | Command | Who it is for |
|---|---|---|
| Plugin | `/plugin marketplace add MongLong0214/commitlore`, then `/plugin install commitlore@commitlore` | Claude Code users on macOS, Linux and Windows |
| Shell script | `install.sh` | everyone else on macOS and Linux |
| PowerShell script | `install.ps1` | Windows — see the host table below |

## Hosts

| Host | Status | Established by |
|---|---|---|
| macOS | supported | the conformance suite runs on `macos-latest` (`git-matrix` in CI). The install path itself is exercised on Linux only, so this row rests on the suite rather than on an executed macOS install |
| Linux, glibc | supported | the `install-script` job in CI: `install.sh` in `debian:stable-slim` with no prerequisites present, then in `node:22-bookworm-slim` with them |
| Linux, musl (Alpine 3.21) | supported | `install.sh` executed in `alpine:3.21` on `aarch64` and on `x86_64`, against a clone at a pinned tag. Supersedes the `unsupported` claim in [#99](https://github.com/MongLong0214/commitlore/issues/99), whose reason was that only glibc-linked binaries were published — there are no binaries now |
| Linux, musl (other distributions) | undecided | the reason #99 gave no longer describes anything, and no other musl distribution has been run. Neither a promise nor a warning would be honest |
| Windows | unsupported | [#71](https://github.com/MongLong0214/commitlore/issues/71)'s install-root containment has not been established there and the `commit-msg` hook does not return: [#95](https://github.com/MongLong0214/commitlore/issues/95), [#321](https://github.com/MongLong0214/commitlore/issues/321), T-1124 ([#283](https://github.com/MongLong0214/commitlore/issues/283)). `install.ps1` makes Windows reachable, which is a different claim |

### The three words

- **supported** — an install path reaches the host and the result was executed there.
- **unsupported** — a property the product depends on is known to be missing or broken there.
- **undecided** — the host has **not been measured**. Nobody has run it, so there is neither a
  result to promise nor a defect to warn about. It is not a gentler `unsupported`.

Reachability is not support. A script that runs on a host says nothing about
whether the properties the product depends on hold there, and the two are kept
apart on purpose.

## Prerequisites

Two columns, because **required** and **checked** are not the same claim. Only
the two install scripts check anything. The plugin path *enforces nothing*: its
pre-edit hook runs `scripts/commitlore-run.sh`, which resolves a CLI — the
installed `commitlore` wrapper if one is on `PATH`, otherwise
`node ${CLAUDE_PLUGIN_ROOT}/dist/commitlore.mjs` — and a machine that has neither
gets a hook that fails open at exit 0 with no context injected, rather than a
message naming what is missing. The MCP server runs the bundle directly.

| Prerequisite | Required by | Checked by `install.sh` | Checked by `install.ps1` |
|---|---|---|---|
| Node.js ≥ 22 | plugin path, `install.sh`, `install.ps1` | yes | yes |
| Git | plugin path, `install.sh`, `install.ps1` | yes | yes |
| A POSIX shell (`bash`) | plugin path only | — | — |

The Node floor is the one the package declares ([ADR-0010](adr/ADR-0010-node-floor.md)),
and the table states the same number both scripts hold.

The shell row is the prerequisite that is easiest to miss: `commitlore-run.sh`
carries a `#!/bin/bash` shebang, so the plugin's pre-edit hook needs a shell that
neither install script installs and neither one checks for. On a host without
one the MCP server still works and the hook does not.

## Plugin capabilities

Each row is a claim about a committed manifest, and the assertion reads the file
named in the middle column rather than one it assumed.

| Capability | Provided by | Value |
|---|---|---|
| MCP server | `.mcp.json` | `node ${CLAUDE_PLUGIN_ROOT}/dist/commitlore.mjs mcp` |
| pre-edit context hook | `hooks/hooks.json` | `PreToolUse` on `Edit\|Write\|MultiEdit\|NotebookEdit` |
| skills | `skills/` | `commitlore-commits`, `commitlore-query`, `commitlore-setup` |
| plugin identity | `.claude-plugin/plugin.json` | `commitlore` at the `package.json` version |
| marketplace | `.claude-plugin/marketplace.json` | `commitlore`, `source: "./"` |

The documented install command is `<plugin>@<marketplace>`, so it is derived from
the last two rows rather than asserted on its own.
