# PRD F14 — Distribution and install UX (plugin-first, Node-only scripts)

- Milestone: M6 · ADR: [0026](../adr/ADR-0026-node-only-distribution.md) (distribution SSOT),
  [0011](../adr/ADR-0011-plugin-first-distribution.md) (registry-free git distribution),
  [0010](../adr/ADR-0010-node-floor.md) (Node floor ≥ 22)
- Replaces: `PRD-F12-universal-adoption.md`, removed with the executable scope
- Acceptance rows: added to [`../GATE-B-ACCEPTANCE.md`](../GATE-B-ACCEPTANCE.md) by the
  tickets in [`../tickets/F14-distribution.md`](../tickets/F14-distribution.md), one row per
  approved ticket — not in advance

## Goal

Installation is one step for a Claude Code user and one command for everyone else, on macOS,
Linux and Windows, with no compiled artifact anywhere in the path.

## Non-goals

- Any compiled artifact: single executable, Node SEA, `.exe`, musl binary, platform matrix,
  binary package channel (ADR-0026).
- A registry. ADR-0011's rejection of npm stands, and ADR-0026 restates why.
- Claiming Windows support before #71's install-root containment is established for the
  wrapper path. Reachability and a verified security property are different claims.
- Editing a user's shell profile. An active record rejects it: printing the line is honest,
  rewriting `.bashrc` silently is what makes people distrust `curl`-to-shell installers.
- A second discovery command. An active record rejects it: one `curl`-pipe-`sh` command is
  the point of the file, and a second command to run reintroduces the problem it removed.
- Any adoption metric.

## User stories

- As a Claude Code user, I run two `/plugin` commands and the MCP server, the pre-edit
  context hook and the skills are registered, with nothing else to configure.
- As a Codex, Cursor, Gemini, Windsurf or opencode user on macOS or Linux, I run one `curl`
  command and get a working `commitlore` on `PATH`, with my agent's MCP config wired.
- As a Windows user, I run one PowerShell command and get the same, for the first time.
- As someone on Alpine, it simply works, because Node runs there and nothing is
  dynamically linked against glibc any more.
- As someone missing Node or Git, the installer tells me which one and what to do, and
  installs nothing.
- As someone who changed their mind, one command removes exactly what the installer wrote.

## Requirements

### Plugin path — document and bind what already works (verified at `da1c733`)

1. The install documentation leads with the two Claude Code commands
   (`/plugin marketplace add MongLong0214/commitlore`, then
   `/plugin install commitlore@commitlore`) in every README language.
2. Each claimed plugin capability is asserted against the committed manifest that provides
   it: the MCP server against `.mcp.json`, the pre-edit hook against `hooks/hooks.json`,
   the skills against the `skills/` directories, and plugin identity against
   `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. A documented
   capability with no manifest backing it fails the test.
3. The documentation states the prerequisites (Node ≥ 22, Git) for the plugin path, because
   the plugin runs `node dist/commitlore.mjs`.

### Both install scripts — one shared contract

4. Prerequisites are checked **before anything is written**: Node present, Node major ≥ 22,
   Git present. A missing or too-old prerequisite names which one, what version was found,
   and what to do — and installs nothing.
5. The installer fetches a **pinned tag**, never a branch. The default install must not
   resolve to `dev`.
6. The checkout lands in the user's data directory, not on `PATH`:
   `${XDG_DATA_HOME:-$HOME/.local/share}/commitlore/<tag>` on macOS and Linux, the Windows
   user-local equivalent on Windows.
7. A **thin wrapper** goes on `PATH` and does nothing but exec
   `node <checkout>/dist/commitlore.mjs "$@"`: `~/.local/bin/commitlore` on macOS and Linux,
   a user-local `commitlore.cmd` or PowerShell shim on Windows.
8. **No asset download, no checksum of a platform tarball, no compile step, no `SHA256SUMS`
   fetch.** The bundle ships in the checkout.
9. The wrapper is installed **atomically** — written to a temporary name in the same
   directory and renamed over the target. An in-place overwrite of a file that may be
   executing is the defect this project already shipped and had to fix in a same-day patch
   release.
10. **Post-install verification never decides the exit code.** The installer may run the
    wrapper to confirm it works, retry once, and on continued failure report "installed but
    unverified" with a zero exit. A verification step whose signal became the installer's
    exit status is the other half of that same defect: the install had already succeeded and
    the script reported failure.
11. The installer never edits a shell profile. If the wrapper's directory is not on `PATH`,
    it prints the line the user can add.
12. Re-running the installer is an upgrade: a newer pinned tag installs beside the old
    checkout and the wrapper is repointed atomically. A wrapper at the target path that does
    not identify itself as CommitLore's is refused with a named reason, never overwritten.
13. Agent MCP registration points at the wrapper, or at
    `node <checkout>/dist/commitlore.mjs mcp`. It never writes a config for an agent that is
    not installed, and never overwrites an existing config without saying so.
14. `install.sh` stays POSIX `sh`. No bash arrays — an active record rejects them for this
    file.
15. Exactly one command per platform. No second script to run afterwards.

### `install.ps1` — Windows specifics

16. Invoked as `irm <raw>/install.ps1 | iex`, and works in Windows PowerShell 5.1 and
    PowerShell 7+.
17. Uses user-local paths only. No administrator elevation, no `Program Files`, no machine
    `PATH` edit.
18. Resolves `node` through the same explicit version check as `install.sh`, and reports the
    Windows-specific remedy when it is missing.
19. Line endings in the wrapper are correct for the shim type; a `.cmd` with LF-only endings
    that fails on some shells is a defect, not a preference.

### Uninstall — two paths kept separate

20. The plugin path is uninstalled through Claude Code. `commitlore uninstall` **names that
    step and stops**; it does not reach into plugin state.
21. `commitlore uninstall` owns the script path and removes exactly what it wrote: the
    checkout, the wrapper, and the agent MCP entries pointing at it.
22. It never removes an entry it did not write; an unrelated MCP server in the same file
    survives, and every other key survives byte-for-byte.
23. It reports per agent — removed, left, not found — each with a reason, and never echoes
    another entry's contents. Agent configs may hold tokens for other servers.
24. It is idempotent, supports `--dry-run`, refuses a wrapper that does not self-identify,
    and leaves an unparseable config untouched with a report rather than rewriting on a guess.
25. Per-repository state stays out of scope: `commitlore hooks uninstall` and
    `commitlore inject uninstall-claude-hook` own it, and this command points at them.

### Windows support is a claim with a precondition

26. #71's install-root containment must be established **for the wrapper path on Windows**
    before any document calls Windows supported. Reachability through `install.ps1` does not
    establish it, and no requirement above may be read as doing so.

### Removing the executable code

27. The compiled-binary code inventoried in ADR-0026 is removed only after the replacement
    install path ships, so there is never a window with neither.
28. Removal must **preserve #71's containment property for the wrapper case** rather than
    delete the check along with the binary arm. `src/core/hook-target.ts` and
    `src/hooks/commit-msg.ts` are the two sites that carry it.
29. The README's shell-install section is rewritten in the same change that makes the
    installer Node-only, never before it — otherwise the README describes behaviour the code
    does not have.

## Verification

Requirements 9, 10 and 12 are each verified against the incident that produced them, not
only against a new unit test: a fresh install, an upgrade over a running wrapper, and a
verification step forced to fail. Requirement 2 is verified by a test that fails when a
documented capability loses its manifest. Requirement 26 is verified on Windows or not at
all.
