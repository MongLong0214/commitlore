# F14 tickets — Distribution and install UX (M6)

> PRD: [PRD-F14-distribution.md](../prd/PRD-F14-distribution.md)
> ADR: [0026](../adr/ADR-0026-node-only-distribution.md) (distribution SSOT),
> [0011](../adr/ADR-0011-plugin-first-distribution.md), [0010](../adr/ADR-0010-node-floor.md)
> Acceptance: rows are added to [`../GATE-B-ACCEPTANCE.md`](../GATE-B-ACCEPTANCE.md) **as each
> ticket is approved**, never in advance — an acceptance row with no approved ticket is the
> dangling authority Gate A's matrix exists to prevent.
> Baseline head: `da1c733`. `install.sh` is 483 lines there.

**No implementation code until this PRD and the individual ticket are both approved.**

**Order.** `T-1120 → T-1121` (shared contract) → `T-1124` (Windows containment) ; `T-1122`
and `T-1123` follow both installers ; `T-1125` (remove the compiled-binary code) is last, so
there is never a window with neither install path.

**Records that bind every ticket here** (active, on `install.sh`):

- editing the user's shell profile from the installer is ruled out — print the line instead
- a second, separate installer script for agent wiring is ruled out — one command is the point
- bash arrays are ruled out in `install.sh` — it is POSIX `sh`

---

## T-1120 Rewrite `install.sh` as a Node-only installer (L) — new · PRD-F14 req 4–15

**Owns**

- `install.sh` — the asset-resolution, download, checksum and extract region (lines ~48–200
  at `da1c733`); the wiring region (277–483) changes only where it writes the MCP command
- `.github/workflows/ci.yml` — the `install-script` job (line 325+), which currently builds
  the binary and stages a fake release
- `test/install-script.test.ts` (extend, or a new file if none covers the contract)

**Depends on** — ADR-0026 and PRD-F14 approved. Nothing else.

**Forbidden scope**

- no asset download, no `SHA256SUMS` fetch, no tarball checksum, no compile step
- do not touch `install.ps1` (T-1121), the uninstall command (T-1123), or `README*` (T-1122)
- do not remove `scripts/build-binary.mjs`, the release matrix, or the binary code (T-1125)
- do not edit a shell profile; do not add a second script; no bash arrays
- do not resolve a branch — the default install must not reach `dev`

**RED test**

1. with `node` absent from `PATH`, the installer exits non-zero, writes nothing, and its
   message names Node and the required major version
2. with a Node older than 22, the same, naming the version it found
3. with `git` absent, the same, naming Git
4. a successful install produces a wrapper whose contents exec `node <checkout>/dist/commitlore.mjs`
   and a checkout under `${XDG_DATA_HOME:-$HOME/.local/share}/commitlore/<tag>`
5. the installer's own output and body contain no `SHA256SUMS`, no `.tar.gz`, and no target triple
6. **upgrade over a running wrapper**: the wrapper is replaced by rename, and the install exits 0
7. **forced verification failure**: with the wrapper made unusable after installation, the
   installer still exits 0 and reports "installed but unverified"

All fail at `da1c733`: the current script has no Node or Git check and downloads a platform asset.

**Minimum GREEN** — requirements 4–15 implemented, POSIX `sh`, one command, wrapper written to
a temporary name in the target directory and renamed over the target, verification retried once
and never deciding the exit code.

**AC ↔ test**

| AC | Test | Traces to |
|---|---|---|
| Prerequisites checked before any write | tests 1–3 | req 4 |
| Pinned tag, never a branch | grep the resolved ref in a dry run | req 5 |
| Checkout in the data directory | test 4 | req 6 |
| Wrapper is a thin `node` exec | test 4 asserts the wrapper body | req 7 |
| No asset path anywhere | test 5 | req 8; ADR-0026 falsification |
| Atomic wrapper install | test 6 | req 9 — the same-day patch release this repeats |
| Verification never decides exit | test 7 | req 10 — the other half of that defect |
| No profile edit | assert no write to any rc file | req 11; active ruled-out record |
| Upgrade repoints, refuses a foreign wrapper | test 6 plus a foreign-wrapper case | req 12 |
| MCP command points at the wrapper | assert the written config value | req 13 |

**Commands** — focused `npx vitest run test/install-script.test.ts`; full `npx vitest run`;
`sh -n install.sh` exits 0; `shellcheck install.sh` if available; **LIVE (required)**: a real
install in a scratch `HOME` on a machine with Node ≥ 22 and Git, then `commitlore --version`;
then an upgrade run over it; then the same on a container image without Node, asserting the
named failure.

**Evidence invalidation** — line anchors are `da1c733`. Re-derive the asset region with
`grep -n "SHA256SUMS\|tar -xzf" install.sh` before editing; if T-1125 has already removed the
release matrix, this ticket is out of order — stop.

**Stop / escalate**

- if the pinned tag cannot be resolved without an authenticated API call, stop: the existing
  script resolves a fixed URL for exactly that reason and the replacement must too
- if a `git clone` of a tag is materially slower than the current download on a cold cache,
  measure it and report the number rather than choosing silently

**Safety checks** — fail-closed (a missing prerequisite installs nothing); wrong-target (a
foreign wrapper is never overwritten); privacy (agent configs are read to add one entry and
no other entry's contents are echoed); prompt injection (nothing from a config or a tag name
is interpolated into a shell command unquoted); partial state (checkout completes before the
wrapper is renamed into place, so a failed run leaves no half-installed `PATH` entry).

**Completion evidence** — the seven RED tests passing; `sh -n` clean; the live fresh-install,
upgrade, and missing-Node transcripts; a diff containing no asset or checksum logic.

---

## T-1121 Add `install.ps1` for Windows, same contract (L) — new · PRD-F14 req 16–19

**Owns** — `install.ps1` (new); `.github/workflows/ci.yml` (one `windows-latest` job that
executes it); `test/install-ps1.test.ts` (new, shape and contract assertions)

**Depends on** — T-1120 merged. The two scripts must implement one contract, and the shell one
defines it.

**Forbidden scope**

- no compile step, no asset download, no `.exe`
- no administrator elevation, no `Program Files`, no machine-level `PATH` edit
- do not claim Windows is supported anywhere — that is T-1124's precondition
- do not touch `install.sh`, the uninstall command, or `README*`

**RED test** — the file does not exist at `da1c733`, so every assertion fails: Node and Git
checks with named messages; user-local checkout and shim paths; the shim invoking
`node <checkout>\dist\commitlore.mjs`; no asset or compile reference; correct line endings for
the shim type; idempotent re-run; and a `windows-latest` CI job that actually runs it.

**Minimum GREEN** — requirements 16–19, working in Windows PowerShell 5.1 and PowerShell 7+,
verified by a real `windows-latest` job in this ticket's own PR. The shape test is not the
evidence; the job is.

**Commands** — focused `npx vitest run test/install-ps1.test.ts`; full suite; **LIVE
(required)**: the `windows-latest` job installing and running `commitlore --version`.

**Evidence invalidation** — bound to T-1120's contract. If T-1120's wrapper layout changed
after merge, re-read it; the two must not diverge.

**Stop / escalate** — if `irm | iex` cannot run the script under the default execution policy,
stop and report: the documented one-liner must work as written, and changing a user's execution
policy from inside the script is not an option.

**Safety checks** — fail-closed on a missing prerequisite; user-local writes only; no elevation;
no execution-policy change; the shim is written to a temporary name and moved into place.

**Completion evidence** — the Windows job green in this PR, with the install and
`--version` output quoted from the runner rather than from a local shell.

---

## T-1122 One authoritative install and compatibility statement (M) — #271 · PRD-F14 req 1–3

**Owns** — `docs/COMPATIBILITY.md` (new); `test/compatibility-matrix.test.ts` (new);
`README.md` + the three translations (the install section and one pointer line)

**Depends on** — T-1120 and T-1121 merged. The document may not describe an installer that has
not shipped; that constraint is why this ticket is not first.

**Forbidden scope**

- no build target, release matrix, `SHA256SUMS`, or platform asset in the document
- do not touch the `BENCH:BEGIN`/`BENCH:END` block; all four READMEs change together
- do not mark Windows `supported` — T-1124 owns that claim

**RED test** — the document does not exist at `da1c733`. Assertions: every documented plugin
capability is backed by the manifest that provides it (`.mcp.json`, `hooks/hooks.json`,
`skills/`, both `.claude-plugin/` manifests); each installer's checked prerequisites match the
document; no row claims a platform no install path reaches; the status vocabulary is exactly
`supported`, `unsupported`, `undecided`, with the last two distinct.

**The test must be demonstrated failing on an injected disagreement** before it is accepted.

**Commands** — focused `npx vitest run test/compatibility-matrix.test.ts test/readme.test.ts`;
`node scripts/check-readme-numbers.mjs` exit 0; full suite.

**Stop / escalate** — if the two installers' prerequisite checks disagree with each other,
stop and report: the document must not paper over a divergence between them.

**Completion evidence** — the injected-disagreement failure and the subsequent pass, the
README diff across all four languages, and `check-readme-numbers.mjs` at 0.

---

## T-1123 `commitlore uninstall`: plugin path named, script path removed (L) — #272 · PRD-F14 req 20–25

**Owns** — `src/commands/uninstall.ts` (new); `src/core/agent-configs.ts` (new, the single
source of the agent config paths); `src/cli.ts` (one `register` line);
`test/uninstall.test.ts`, `test/agent-configs.test.ts` (new); `dist/` rebuilt

**Depends on** — T-1120 and T-1121 merged: the command removes what they wrote.

**Forbidden scope**

- do not reach into Claude Code plugin state — name the plugin uninstall step and stop
- never remove an entry the installer did not write; never reformat a config beyond the one
  entry removed
- do not duplicate per-repository uninstall; point at `hooks uninstall` and
  `inject uninstall-claude-hook`
- no binary premise: no asset, no checksum, no platform target

**RED test** — in a temporary `HOME` holding a checkout, a wrapper, and an agent config with
both a `commitlore` entry and an unrelated entry: the checkout, wrapper and `commitlore` entry
are removed while the unrelated entry and every other key survive byte-for-byte; a foreign
wrapper is left with a named reason; the second run removes nothing and exits 0; `--dry-run`
changes nothing; the report and `--json` contain no other entry's contents; and a bidirectional
test asserts the config-path table agrees with both installers. All fail at `da1c733` — no such
command exists and `src/` holds no agent config path knowledge.

**Why bidirectional** — two sources of the same truth diverge silently. This repository already
carries that shape as three independent copies of one hash function agreeing only by coincidence
of key order.

**Commands** — focused on both test files; full suite; `npm run build` with `dist/` committed;
`npx tsc --noEmit`; **LIVE (required)**: a real install-then-uninstall cycle in a scratch `HOME`
with an unrelated MCP entry present beforehand.

**Stop / escalate** — a config format with no safe partial edit is declined with a named reason
rather than reformatted; an unparseable config is left untouched and reported.

**Completion evidence** — both RED suites passing, the live cycle transcript, `dist/` with no
drift, and the bidirectional agreement test green.

---

## T-1124 Establish #71's containment for the wrapper path on Windows (M) — new · PRD-F14 req 26

**Owns** — `.github/workflows/ci.yml` (extend T-1121's Windows job, or one adjacent required
job); `test/hook-target.test.ts` (wrapper-path cases); `docs/COMPATIBILITY.md` (the Windows row,
only if the property holds)

**Depends on** — T-1121 merged. There is no wrapper on Windows before it.

**Forbidden scope**

- `continue-on-error` is forbidden; the job is required or the ticket is not done
- do not mark Windows `supported` unless the attacks pass **on Windows**
- do not loosen any containment match to make a test pass — that is the property itself

**RED test** — #71's two containment attacks, executed against a **wrapper** target on
`windows-latest`: a recorded `commitlore.bin` pointing outside the install root is refused, and
a recorded target that is neither a script nor a recognised wrapper is refused. Both fail or are
absent at `da1c733`, where no Windows job exists and the classification knows only a bare
binary name.

**Minimum GREEN** — the attacks pass on `windows-latest` for the wrapper path, in a required
job, in this ticket's own PR. Only then may any document call Windows supported.

**Stop / escalate** — **if the attacks fail on Windows for any reason, stop.** Do not weaken the
job, do not skip the assertion, do not mark Windows supported. Record the failure as its own
issue. Ending with "Windows is reachable but not supported, and here is the executed evidence"
is an acceptable outcome; a supported claim without the property is not.

**Completion evidence** — `gh pr checks` showing the Windows containment job green, quoted from
the runner, and the compatibility row flipped in the same commit — or the row left unflipped
with the recorded reason.

---

## T-1125 Remove the compiled-binary code (L) — new · PRD-F14 req 27–29

**Owns** — every site in ADR-0026's inventory: `scripts/build-binary.mjs`;
`package.json` `build:binary`; `.github/workflows/release.yml` `build` and `publish` asset and
`SHA256SUMS` steps; `.github/workflows/ci.yml` `binary` job; `scripts/commitlore-run.sh`'s
compiled-binary probe; `src/core/hook-target.ts`; `src/hooks/commit-msg.ts`; the README
pinned-asset verification block in all four languages; `dist/` rebuilt

**Depends on** — T-1120, T-1121 and T-1122 merged. Requirement 27: the replacement must ship
first, so there is never a window with neither.

**Forbidden scope**

- **do not delete #71's containment check along with the binary arm.** Requirement 28: the
  property must hold for the wrapper case after this ticket. A diff that removes
  `matchesRunningBinary` without a wrapper equivalent is the failure mode
- do not change the version, the tag procedure, or the release gate's other checks
- do not remove the plugin path's Node resolution in `scripts/commitlore-run.sh` — only the
  compiled-binary probe ahead of it

**RED test** — a repository-wide invariant asserting no tracked file builds, downloads, or
classifies a compiled executable: no `build:binary`, no SEA call, no `SHA256SUMS` fetch in an
installer, no `BinKind` arm for a compiled binary. Fails at `da1c733`, where all of those exist.
Plus a containment test proving the wrapper case is still refused when it points outside the
install root — which must pass **before and after** this ticket.

**Commands** — focused on `test/hook-target.test.ts`, `test/hooks.test.ts` and the new
invariant; full suite; `npm run build` with `dist/` committed; both `tsc --noEmit`;
`node scripts/check-readme-numbers.mjs` exit 0; **LIVE (required)**: the next release run
publishes no platform asset and the plugin path still resolves and runs.

**Evidence invalidation** — the inventory is bound to `69e5208` in ADR-0026 and re-anchored at
this ticket's own head. Re-derive every line number before editing; if any site has already
been removed, drop it from **Owns** rather than re-editing.

**Stop / escalate** — if removing the binary arm cannot preserve containment for the wrapper
without redesigning the check, stop: that is a security design change and needs its own ADR,
not a removal ticket.

**Completion evidence** — the invariant test passing, the containment test green on both sides
of the change, a release run with no platform asset, and the plugin path exercised end to end.
