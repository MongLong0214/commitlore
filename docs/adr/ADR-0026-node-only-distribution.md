# ADR-0026: distribution SSOT — plugin-first for Claude Code, Node-only installers elsewhere, no compiled executables

- Status: Accepted (2026-07-31)
- Supersedes: [ADR-0015](ADR-0015-single-executable-binary.md) entirely
- Withdraws: ADR-0023 (Windows containment parity), ADR-0024 (musl gated on a spike),
  ADR-0025 (package manager as verified pointer) — removed by this change, together with
  `PRD-F12-universal-adoption.md` and `docs/tickets/F12-universal-adoption.md`
- Keeps intact: [ADR-0011](ADR-0011-plugin-first-distribution.md) (registry-free git
  distribution), [ADR-0010](ADR-0010-node-floor.md) (Node floor ≥ 22),
  [ADR-0012](ADR-0012-drop-the-native-dependency.md)

## Context

ADR-0015 added a compiled Node single-executable binary as an additional artifact for
machines with no Node runtime. Everything built on top of it grew a platform surface: a
four-target release matrix, per-target checksums, a binary-versus-script classification in
the hook target logic, an installer that downloads and verifies a platform asset, and a
Gate B plan that had reached three ADRs and eight tickets covering Windows `.exe` support,
a musl feasibility question, and a Homebrew formula pointing at a published binary.

The owner has removed that surface from the product and fixed the install UX. The
requirement is that installation is easy and works — not that it produces a standalone
executable.

ADR-0011 already established that the repository is itself a Claude Code plugin and
marketplace. What was missing was a statement that this is the **primary** path rather than
one of several.

## Decision

**1. Claude Code users install the plugin. That is the first and preferred install UX.**

```
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

The plugin registers, with no further steps:

| Surface | Registered by | Verified at `69e5208` |
|---|---|---|
| MCP server | `.mcp.json` → `node ${CLAUDE_PLUGIN_ROOT}/dist/commitlore.mjs mcp` | present, already Node-based |
| Pre-edit context hook | `hooks/hooks.json` → `PreToolUse` on `Edit\|Write\|MultiEdit\|NotebookEdit` | present |
| Skills | `skills/commitlore-commits`, `skills/commitlore-query`, `skills/commitlore-setup` | three present |
| Plugin and marketplace manifests | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`source: "./"`) | both present |

Prerequisites: **Node.js 22+ and Git**. No executable, no SEA, no platform binary.

**2. Everyone else uses a Node-only install script, as the secondary path.**

- macOS and Linux: `install.sh`
- Windows: `install.ps1`

Both check for Node ≥ 22 and Git explicitly and fail with a named, actionable message when
either is missing. Both install a pinned tag or source checkout into the user's data
directory and put a **thin wrapper** on `PATH` that invokes
`node <checkout>/dist/commitlore.mjs` — `~/.local/bin/commitlore` on macOS and Linux, a
user-local `commitlore.cmd` or PowerShell shim on Windows. Agent MCP registration points at
the wrapper, or directly at `node <checkout>/dist/commitlore.mjs mcp`. Uninstall removes
only what that installer wrote: the checkout, the wrapper, and the agent config entries
pointing at it.

**No compile step and no platform asset download in either path.**

**3. Compiled executables are out of product scope entirely** — single executable, Node SEA,
Windows `.exe`, musl binary, the platform binary matrix, and binary Homebrew distribution.

**4. Windows is reachable by path 2 for the first time**, because the obstacle was never
packaging alone: it was a compiled artifact plus a hook containment property (#71) that had
only ever been verified on macOS. A Node wrapper removes the first. The second must still be
established for the wrapper path before any document calls Windows supported.

**5. Implementation order.** Documents, issues and the milestone are made canonical first;
then a revised PRD; then atomic tickets; each approved separately before code. Removing the
existing binary code is itself a separately approved ticket, not part of this reversal.

## Ruled-out

- **Keep the binary as an optional extra alongside the Node path** | the whole platform
  surface — release matrix, per-target checksums, per-platform classification in the hook
  logic, a compatibility matrix of targets — exists because of that one artifact. Optional
  keeps all of it.
- **Lead with the shell one-liner and mention the plugin second** | for a Claude Code user
  the plugin is one step that also registers MCP, the pre-edit hook and skills. Leading with
  a script that only installs a CLI hides the shorter path and leaves the agent surfaces
  unwired.
- **Ship a Windows `.exe` only** | same compile toolchain, same per-platform containment
  verification. PowerShell plus a Node wrapper reaches Windows without either.
- **Keep ADR-0024's musl question open** | it existed only because a glibc-linked binary
  cannot run on musl hosts. With no binary, Alpine needs Node and Git like any other host,
  and the question dissolves rather than being answered.
- **Keep ADR-0025's Homebrew formula, pointed at a source tarball instead of a binary** |
  a formula that installs a checkout and a Node wrapper duplicates what the shell installer
  already does, and ADR-0011's surviving objection — no agent discovers tools through a
  system package manager — still applies. A package channel later needs its own grounds.
- **Delete ADR-0015 rather than mark it superseded** | ADR-0011 links to it, and a record
  that vanishes leaves a broken reference and hides that the decision was ever made.
- **Remove the binary build code in this change** | a documented scope reversal and a code
  removal are different reviews, and mixing them lets the removal skip its own. The
  inventory below is the handoff.
- **Rewrite the README's shell-install instructions now** | the shipped `install.sh` still
  downloads and checksum-verifies a platform asset. Describing it as Node-only before the
  code changes would make the README false, which is the failure this project treats as
  most serious. The README leads with the plugin path — true today — and its shell section
  is rewritten by the same change that rewrites the installer.

## Consequences

- The four-platform release matrix and `SHA256SUMS` no longer have a product reason to
  exist. Until the removal ticket lands they keep running and keep publishing, so nothing
  is silently half-removed.
- The Gate B acceptance matrix loses rows `B-1` through `B-5`. `B-6` (guard capture
  advisory, shipped) and `B-7` (user-editable policy file) are unaffected by this reversal.
- `scripts/commitlore-run.sh` still probes for a compiled `dist/commitlore` **before** the
  Node bundle. In a plugin clone that file does not exist, so the Node path is what actually
  runs today; the probe is dead weight rather than a live binary dependency. It is inventoried
  rather than edited.
- `hook-target.ts`'s `BinKind` gains a dead arm once the binary is gone, and it carries a
  security property. Left alone here on purpose.

## Inventory — executable-producing code left in place, for a separately approved ticket

No code is mutated by this change. Measured at `69e5208`:

| Site | What it does |
|---|---|
| `scripts/build-binary.mjs` | builds the Node SEA |
| `package.json` → `build:binary` | the script entry that invokes it |
| `.github/workflows/release.yml` → `build` job, four-target matrix (lines 77–137) | compiles and uploads one asset per target |
| `.github/workflows/release.yml` → `publish` job asset and `SHA256SUMS` steps (lines 138–170) | asserts every asset landed, publishes checksums |
| `.github/workflows/ci.yml` → `binary` job (lines 200+) | builds the compiled binary on two runners |
| `install.sh` → asset resolution, download, checksum, extract (lines ~71–160) | fetches `SHA256SUMS`, downloads the per-target tarball, verifies and extracts it |
| `scripts/commitlore-run.sh` → `resolve()` first branch | probes `$CLAUDE_PLUGIN_ROOT/dist/commitlore` before the Node bundle |
| `src/core/hook-target.ts` → `BinKind`, `classifyBinTarget`, `matchesRunningBinary` | classifies an install target as `script` or compiled `binary` |
| `src/hooks/commit-msg.ts` → the stub allowlist glob | accepts a bare `commitlore` executable as a hook target |
| `README.md` and the three translations | the pinned-asset verification block and the platform limitation bullets |

`src/core/hook-target.ts` and `src/hooks/commit-msg.ts` are the two carrying #71's
install-root containment. Their removal must **preserve that property for the wrapper case**
rather than delete the check along with the binary arm.

## Records this reversal retires, and the ones it deliberately does not

The documents above are not the only place the withdrawn decision is served. CommitLore's own
record surface answers `commitlore ruled-out scripts/build-binary.mjs`, and at `9b57019` it
returned `r-seabin39` as **active** — the record that adopted the Node SEA build. Every
alternative it rules out is a way of producing an executable (`pkg`/`nexe`, Deno or Bun
compile, a Go or Rust rewrite, committing the binary, an ESM SEA main), and one of them states
that Windows `commitlore.exe` is "a small additive follow-up, not a redesign".

An agent reading that today would be told the compiled-binary approach is the live one and a
Windows executable is nearly free. That is the precise failure this product exists to prevent:
a reversed decision still reading active. Documentation saying otherwise does not fix it,
because the agent asks the tool, not the docs.

So this change carries `Supersedes: r-seabin39`. Nothing is deleted — the record stays in
history with its measurements intact; it stops being served as live guidance.

**Records deliberately left active**, because they describe code this change does not touch:

| Record | On | Why it stays |
|---|---|---|
| `r-1e58d3`, `r-83d43117`, `r-3d92a8`, `r-5b9e37`, `r-9a5e17` | `src/core/hook-target.ts`, `src/hooks/commit-msg.ts` | they describe the install-root containment logic, which is still live and must survive the removal. T-1125 retires only what it actually changes |
| `r-instci99a` | `install.sh` | its ruled-out items about installer CI verification are still sound reasoning; only its musl-target clause is affected, and that alternative remains rejected — for a new reason |
| `r-relinstall` | `install.sh` | it describes how the shipped installer resolves an asset, and the shipped installer still does that. T-1120 retires it when the behaviour actually changes |
| `r-relworkflow` | `.github/workflows/release.yml` | the release workflow is unchanged here |

The rule applied: **retire a record when the decision is reversed, not when a document says it
will be.** A record that describes running code stays active until that code changes.


## Falsification

This ADR is wrong if any of the following is true:

- a release publishes a compiled executable, a platform binary, or a Windows `.exe`
- an installer downloads a platform asset or runs a compile step
- a document presents the shell one-liner ahead of the plugin commands for a Claude Code user
- a document claims Windows is supported before the containment property is established for
  the wrapper path
- the binary build code is removed without its own approved ticket
- a README describes an installer behaviour the shipped code does not have
