# Compatibility

The authoritative statement of which hosts CommitLore supports and what each
install path requires. Where a README and this document disagree, this document
is correct — and `test/compatibility-matrix.test.ts` compares every table below
to the files that provide what it claims, so a row that drifts fails rather than
misleads.

There is no compiled artifact anywhere in the product ([ADR-0026](adr/ADR-0026-node-only-distribution.md)),
and neither install script contains a platform, architecture or libc check —
there is no platform-specific artifact to choose between.

## The protocol contract (2.0 Stable)

`spec/SPEC.md` is Stable as of v1.0.0. What that promises, and what it does not:

**Will not change incompatibly within 2.x**

- The trailer grammar (SPEC §2) and where git decides a trailer block begins and
  ends. CommitLore does not overrule git on that boundary and will not start.
- The meaning of every key in SPEC §3, and `Record-Id`'s format.
- The `X-<Name>` extension slot. An organization's own keys are preserved
  verbatim, and no future version will start interpreting them.
- The three trust grades and what each asserts. Their *strength* depends on the
  configured mode — see `SECURITY.md` — but the words do not change meaning.
- A record written today validates under any 2.x reader.

**May change**

- New optional keys in §3. A reader that does not know a key ignores it, which
  is what makes this compatible.
- Diagnostics, exit-code detail, and output formatting outside the JSON
  contract. The JSON answer's shape is pinned by tests; prose is not.
- The index schema. It is a derived cache (ADR-0003) and rebuilds; a reader that
  meets an index it does not understand rebuilds rather than guessing.

**How anything is retired**

Nothing in §3 is removed in 2.x. If a key must go, it is deprecated in a minor
release — still accepted, still validating, documented as deprecated with what
replaces it — and removed no earlier than 3.0. A record already committed is
history and remains readable regardless: the repository is the record, and a
reader that cannot read old commits has broken the product's one promise.

## Install paths

| Path | Command | Who it is for |
|---|---|---|
| Codex plugin | `commitlore plugin install-codex` | Codex users |
| Plugin | `/plugin marketplace add MongLong0214/commitlore`, then `/plugin install commitlore@commitlore` | Claude Code users on macOS, Linux and Windows |
| Shell script | `install.sh` | everyone else on macOS and Linux |
| PowerShell script | `install.ps1` | Windows — see the host table below |

## Hosts

| Host | Status | Established by |
|---|---|---|
| macOS | supported | the `install-macos` job in CI: `install.sh` runs on `macos-latest`, the wrapper it writes reports the requested version, and `init`, `doctor` and `context` are then run in a repository it set up. The conformance suite also runs there (`git-matrix`) |
| Linux, glibc | supported | the `install-script` job in CI: `install.sh` in `debian:stable-slim` with no prerequisites present, then in `node:22-bookworm-slim` with them |
| Linux, musl (Alpine 3.21) | supported | the `install-alpine` job in CI: `install.sh` runs in `alpine:3.21` on `linux/amd64` and on `linux/arm64` (the second through QEMU), the wrapper reports the requested version, and `init`, `doctor` and `context` are then run in a repository it set up. Supersedes the `unsupported` claim in [#99](https://github.com/MongLong0214/commitlore/issues/99), whose reason was that only glibc-linked binaries were published — there are no binaries now |
| Linux, musl (other distributions) | undecided | the reason #99 gave no longer describes anything, and no other musl distribution has been run. Neither a promise nor a warning would be honest |
| Windows | supported | #71's install-root containment established on `windows-latest` in this ticket's own job: the hook returns, a valid record is accepted and an invalid one refused through the recorded install, and both of [#71](https://github.com/MongLong0214/commitlore/issues/71)'s attacks are refused with the tampered program run zero times. The hang and the dead comparison behind it are fixed in [#321](https://github.com/MongLong0214/commitlore/issues/321); [#95](https://github.com/MongLong0214/commitlore/issues/95) is closed by this. Repositories that installed the hook before that fix keep the old one and must re-run `commitlore hooks install` |

### The three words

- **supported** — an install path reaches the host and the result was executed there.
- **unsupported** — a property the product depends on is known to be missing or broken there.
- **undecided** — the host has **not been measured**. Nobody has run it, so there is neither a
  result to promise nor a defect to warn about. It is not a gentler `unsupported`.

Reachability is not support. A script that runs on a host says nothing about
whether the properties the product depends on hold there, and the two are kept
apart on purpose.

### A diagnosis this product cannot make (#657)

`doctor` probes a registered MCP command by starting it and waiting for the
protocol. On Windows, a `.cmd` launcher naming an interpreter that is not on disk
produces no signal at all: `cmd.exe` exits silently, nothing ever speaks, and the
probe waits out its budget and reports `initialize-timed-out`.

Measured on `windows-latest` with three independent drivers, so this is the
host's behaviour rather than a defect in the probe.

The consequence is that **two different faults share one report**: a registration
that is slow, and a registration whose interpreter does not exist. `doctor` says
*could not verify this time* for both, which is honest about what it observed and
silent about which of the two it was.

This is accepted rather than fixed. Distinguishing them would mean inspecting the
launcher's contents and resolving the interpreter it names — reimplementing part
of the host's own command resolution, in a place where being subtly wrong would
produce a confident diagnosis that is false. A timeout that names both
possibilities is the weaker claim and the true one.

What still holds: execution correctness is unaffected. A registration that works
is verified normally, and one that is genuinely broken is still reported as
unverified — a user is never told a broken registration is healthy.

## After upgrading, run `doctor` (#693)

An upgrade updates the CLI. It does not reach two things:

- **Hooks already installed in a repository.** `commitlore hooks install` records
  the exact bundle it ran from, which pins that repository to one release. The
  installer cannot fix this for you — it has no way to know which repositories
  have hooks.
- **Sessions already running.** A host loads its runtime once and keeps it.

So after installing a new version:

```sh
commitlore doctor
```

Two warnings are the ones to expect and act on:

```
runtime identity — hook identity differs from CLI: hook v<old>; CLI v<new>
  fix: commitlore hooks install          # run it in that repository

live MCP runtime identity — N live CommitLore MCP runtime(s) are unusable
  restart those sessions                 # a host keeps the runtime it loaded
```

Neither is a defect in the release. Both are state a release cannot reach, and
`doctor` naming them is the product doing what it can — which is to say what it
knows rather than to guess that everything is current.

### What the hook records, and why it is a path

The hook resolves through an absolute path recorded in `commitlore.bin`, so it
is independent of `PATH` and of whatever `node_modules/.bin/commitlore` sits
above the repository. The interpreter is recorded beside it, because a hook runs
where `PATH` may carry no `node` at all.

Since v1.0.2 that path is version-free: `install.sh` maintains
`<data-root>/current` beside the versioned checkouts, and a hook installed after
that records it.

That is the path. The **stub** is a second thing, and it moved later — so there
are three generations, not two. This section said "New installs follow upgrades
on their own", which was true of the path and false of the stub for every hook
installed between v1.0.2 and v1.1.2.

| installed with | what it records | what an upgrade does | what to run |
|---|---|---|---|
| before v1.0.2 | one release directly | the hook keeps naming a release you no longer have | `commitlore hooks install`, once per repository |
| v1.0.2 – v1.1.2 | `current`, with the pre-1.1.3 containment stub | the stub does not recognise an ordinary upgrade and refuses the commit under the `PATH` git gives a hook | `commitlore hooks install`, once per repository |
| v1.1.3 or later | `current`, with the rebinding stub | ordinary upgrades are followed automatically | nothing |

The middle row is the one that surprises. Under a login shell the hook falls
through to a `PATH` lookup and commits succeed, so nothing looks wrong. Under the
`PATH` a hook actually gets — a GUI client, an IDE, a launcher — there is no
`commitlore` on `PATH`, and the commit is refused.

**The installer cannot repair any of them.** It has no way to know which
repositories have hooks, and not touching a repository's `.git` is policy rather
than omission. `doctor` reports the mismatch and names `commitlore hooks install`
as the repair; from v1.1.3 the installer also says so on every install.

The `bin` wrapper cannot serve as that path, and this was measured rather than
reasoned: recording it made hooks fail under the restricted `PATH` a hook
actually runs in, because a wrapper is a shell script and cannot be launched
with a recorded interpreter. A `.mjs` under `current` keeps both properties.

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
| Node.js ≥ 22.23.2 | plugin path, `install.sh`, `install.ps1` | yes | yes |
| Git | plugin path, `install.sh`, `install.ps1` | yes | yes |
| A POSIX shell (`bash`) | plugin path only | — | — |

The Node floor is the one the package declares ([ADR-0034](adr/ADR-0034-node-floor-22-23.md),
superseding [ADR-0033](adr/ADR-0033-node-floor-22-13.md)),
and the table states the same number both scripts hold.

The shell row is the prerequisite that is easiest to miss: `commitlore-run.sh`
carries a `#!/bin/bash` shebang, so the plugin's pre-edit hook needs a shell that
neither install script installs and neither one checks for. On a host without
one the MCP server still works and the hook does not.

## Codex plugin

`commitlore plugin install-codex` is the one-command, idempotent route. It calls
`codex plugin marketplace add` only when the `commitlore` marketplace is absent,
then calls `codex plugin add commitlore@commitlore` only when the plugin is not
installed. Codex owns its configuration and cache; CommitLore never writes
either directly. A fresh Codex session is required to discover the installed
skill and MCP server.

| Capability | Provided by | Value |
|---|---|---|
| MCP server | `.mcp.json` | `node ./dist/commitlore.mjs mcp` with plugin-root `cwd` |
| capture skill | `skills/commitlore-codex/SKILL.md` | transcript-backed capture; claims lacking support are dropped, never cited by invention |
| plugin identity | `.codex-plugin/plugin.json` | `commitlore` at the `package.json` version |

## Plugin capabilities

Each row is a claim about a committed manifest, and the assertion reads the file
named in the middle column rather than one it assumed.

| Capability | Provided by | Value |
|---|---|---|
| MCP server | `.mcp.json` | `node ./dist/commitlore.mjs mcp` |
| pre-edit context hook | `hooks/hooks.json` | `PreToolUse` on `Read\|Edit\|Write\|MultiEdit\|NotebookEdit` |
| skills | `skills/` | `commitlore-commits`, `commitlore-codex`, `commitlore-query`, `commitlore-setup` |
| plugin identity | `.claude-plugin/plugin.json` | `commitlore` at the `package.json` version |
| marketplace | `.claude-plugin/marketplace.json` | `commitlore`, `source: "./"` |

The documented install command is `<plugin>@<marketplace>`, so it is derived from
the last two rows rather than asserted on its own.
