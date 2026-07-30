# PRD F12 — Universal adoption (platform reach, packaging, lifecycle, matrix)

- Milestone: M6 · ADR: 0023 (Windows containment parity), 0024 (musl gated on a spike),
  0025 (package manager as verified pointer)
- Acceptance rows: `B-1`, `B-2`, `B-3`, `B-4`, `B-5` in
  [`../GATE-B-ACCEPTANCE.md`](../GATE-B-ACCEPTANCE.md)

## Goal

A person on a machine this project has never run on can install CommitLore, learn from
the product itself whether their platform is supported, and remove everything the
installer put there — without reading the source.

Four surfaces deliver this: the platform set, one package-manager channel, a lifecycle
inverse, and a compatibility matrix that a test keeps honest.

## Non-goals

- Any change to `install.sh`'s existing musl failure, which is already a clear attributed
  message and is the correct behaviour whether or not a musl asset ever ships.
- npm, or any registry account (ADR-0011; ADR-0025 restates why the rejection stands).
- A Windows package manifest (ADR-0025 — there is no asset to point at).
- A full Windows port of the test suite. The Windows CI job exists for #71's containment
  attacks, not for parity.
- Softening the README's Windows or musl statements. They stay until the corresponding
  asset exists.
- Anything that measures or claims adoption. The milestone is named for the goal, not for
  a metric this gate produces.

## User stories

- As someone on Alpine, I run the install one-liner, get a message that names musl as the
  cause and points somewhere useful, and can find musl's status in one table rather than
  inferring it from a failure.
- As someone on macOS who already uses Homebrew, I install with one `brew` command and can
  verify that what I got is the same asset the release published.
- As someone evaluating CommitLore who decided against it, I run one command and the
  binary and every agent config entry the installer added are gone — and the MCP server I
  had configured for something else is still there.
- As a maintainer, I add a target to the release matrix and a test fails until the
  compatibility matrix mentions it.

## Requirements

### Platform reach — Windows (B-1)

1. Every `REPO_ROOT`-style path resolution derives a filesystem path with
   `fileURLToPath`, never `URL.pathname`. Four sites at `e2b5725` —
   `scripts/adoption-range.mjs`, `scripts/build-binary.mjs`,
   `scripts/check-test-files-ran.mjs`, `scripts/check-engines.mjs` — converge on the
   pattern `scripts/check-release-version.mjs` already uses.
2. `classifyBinTarget` recognises a Windows executable by the exact extension `.exe`
   appended to the exact name, never by a prefix or a loosened match.
3. The `commit-msg` stub's allowlist recognises the same set as `classifyBinTarget`, and a
   test asserts the two agree rather than asserting each separately.
4. #71's two containment attacks execute on `windows-latest` in CI and are required, not
   `continue-on-error`.
5. `windows-latest` enters the release build matrix only after requirement 4 passes. If it
   does not pass, the gate records why and Windows stays absent.

### Platform reach — musl (B-2)

6. A spike answers one question with evidence: can a musl-linked single-executable binary
   be produced in the release build matrix without Docker, and is its provenance
   defensible? The output is a committed document with what was attempted, what was
   measured, and a recommendation.
7. The spike states what it could not determine. A route not attempted is recorded as not
   attempted, never as impossible.
8. No musl asset is published by this PRD. If the recommendation is yes, publishing is a
   separate later ticket.

### Package channel (B-3)

9. A Homebrew formula is **generated** from a published release: version from the tag, URL
   from the asset, digest from the release's `SHA256SUMS`.
10. The generator is re-runnable, and CI fails if regenerating produces a diff against the
    committed manifest — the same drift protection `dist/` has.
11. The formula performs no build step of any kind.
12. One real install through the channel is executed on a machine that did not build the
    asset, and the installed binary's `--version` is checked against the tag.
13. The channel is documented after `git clone` and `install.sh`, never ahead of them.

### Lifecycle (B-5)

14. A single command removes what `install.sh` wrote: the installed binary, and the agent
    MCP configuration entries the installer added.
15. It never removes an entry it did not write. An unrelated MCP server in the same config
    file survives, and the file's other contents are preserved byte-for-byte apart from
    the removed entry.
16. It reports, per agent, what was removed, what was left and why — the same
    wired/skipped/not-found shape `install.sh` already reports.
17. It is idempotent: a second run removes nothing, reports nothing removed, and exits 0.
18. It refuses to remove a binary at the target path that does not identify itself as
    CommitLore, by the same test `install.sh` uses before overwriting one.
19. Per-repository state is out of its scope: `hooks uninstall` and
    `inject uninstall-claude-hook` already own that, and this command points at them
    rather than duplicating them.

### Compatibility matrix (B-4)

20. One document is the authority for platform support, with a row per target and an
    explicit status. `unsupported` and `undecided` are distinct statuses and may not be
    collapsed.
21. A test fails if the matrix disagrees with the release build matrix in either
    direction — a published target with no row, or a row claiming a target the release
    does not build.
22. A test fails if the matrix disagrees with the architecture and OS mapping in
    `install.sh`.
23. Each unsupported row cites the issue or record that explains it, so the matrix carries
    reasons rather than only verdicts.

## Verification

Every requirement above is decided by a command, not by review. Requirement 12 is the one
exception in kind: it is a real-usage check on a machine that did not build the artifact,
and it is not satisfied by a passing test suite.
