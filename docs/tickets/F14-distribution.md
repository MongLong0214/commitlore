# F14 tickets — Distribution and install UX (M6)

> PRD: [PRD-F14-distribution.md](../prd/PRD-F14-distribution.md)
> ADR: [0026](../adr/ADR-0026-node-only-distribution.md) (distribution SSOT),
> [0011](../adr/ADR-0011-plugin-first-distribution.md), [0010](../adr/ADR-0010-node-floor.md)
> Acceptance: rows are added to [`../GATE-B-ACCEPTANCE.md`](../GATE-B-ACCEPTANCE.md) **as each
> ticket is approved**, never in advance — an acceptance row with no approved ticket is the
> dangling authority Gate A's matrix exists to prevent.
> Baseline head: **`5ef4692`** (T-1120 merged). The earlier baseline `8b0c9fa` is kept only
> where a ticket's RED justification cites what was true *before* T-1120 shipped; every
> anchor a later ticket must edit is re-derived below.
>
> **What T-1120 shipped, as facts the remaining tickets must match** (read at `5ef4692`):
>
> | Fact | Value |
> |---|---|
> | Node floor constant | `NODE_MAJOR_MIN=22`, `install.sh:44` |
> | Prerequisite failures | exit `1`, message names Node with its major or names Git, and nothing is written |
> | Checkout root | `${XDG_DATA_HOME:-$HOME/.local/share}/commitlore/<tag>`, `install.sh:111–112` |
> | Wrapper path | `$dest_dir/commitlore`, default `$HOME/.local/bin`, `install.sh:154` |
> | Wrapper marker | `# commitlore:wrapper:v1`, `install.sh:156` — how a re-run recognises its own wrapper |
> | Foreign target | exit `4`, left byte-identical |
> | Fetch failure | exit `2`, quoting git's first `fatal:` line |
> | Verification | retries once, then reports "installed, but unverified" and **exits 0** |
> | Wrapper node resolution | records the absolute `node` path found at install time, falling back to `node` on `PATH` when that path is gone |
> | Fallback when the recorded path disappears | still runs, on whatever `node` is on `PATH` — **with no version check**, so the Node >= 22 the installer enforced no longer holds |
> | No `node` anywhere | the shell's own `exec: node: not found`, **exit 127** — not a CommitLore message |
> | `release.yml` | `build` job from line 77, `publish` from 138 — unchanged by T-1120 |
>
> `install.sh` carries no `SHA256SUMS`, `.tar.gz`, `tar -xzf` or target triple, and `README*`
> carry none either. A ticket that plans to remove one is planning against a stale reading.

**No implementation code until this PRD and the individual ticket are both approved.**

**Order.** `T-1120 → T-1121` (shared contract) → `T-1124` (Windows containment) ; `T-1122`
and `T-1123` follow both installers ; `T-1125` (remove the compiled-binary code) is last, so
there is never a window with neither install path.

## Ownership map — one owner per region

The first draft of this file failed review on a contradiction: PRD-F14 requirement 29
requires the README's shell-install section to change **in the same change** that makes
`install.sh` Node-only, while T-1120 forbade `README*` and deferred it to T-1122, and T-1125
claimed the same pinned-asset block. Three tickets claimed one region and the requirement
claimed a fourth arrangement. Ownership is now single, and stated here so a later reader does
not have to reconstruct it:

| Region | Owner | Not owned by |
|---|---|---|
| `install.sh` Node-only behaviour | **T-1120** | — |
| The shell-install one-liner and the pinned-asset block in all four READMEs | **T-1120**, in the same commit as the installer change | T-1122, T-1125 |
| `test/readme.test.ts` and `scripts/check-readme-numbers.mjs` evidence for that region | **T-1120** | — |
| `install.ps1` | **T-1121** | — |
| `docs/COMPATIBILITY.md`, and a pointer line that names no installer behaviour | **T-1122** | T-1120 |
| `commitlore uninstall` | **T-1123** | — |
| Windows containment for the wrapper path | **T-1124** | — |
| Residual compiled-binary and release references left after T-1120 | **T-1125** | T-1120 |

`.github/workflows/ci.yml` is the one file with more than one owner, and deliberately so: the
four tickets own four **different jobs** in it. A filename-level scan cannot see that, so the
jobs are enumerated here and a scan should treat this file as owned per job rather than per file:

| Job in `ci.yml` | Owner |
|---|---|
| `install-script` (line 325+ at `8b0c9fa`) | T-1120 |
| a new `windows-latest` job running `install.ps1` | T-1121 |
| that same Windows job, extended with #71's containment attacks | T-1124, strictly after T-1121 merges |
| `binary` (line 200+) | T-1125 |

No two of those touch the same job in the same change; T-1124 follows T-1121 by the ordering
rule above rather than editing beside it.

**The README truth window is why T-1120 owns the README.** The shipped `install.sh` downloads
and checksum-verifies a platform asset today, so the README documenting that is currently
true. Changing the README earlier would make it false; changing it later would leave it false
in between. Both changes landing in one commit is the only arrangement in which the README is
never wrong, and ADR-0026 already states it that way.

**Records that bind every ticket here** (active, on `install.sh`):

- editing the user's shell profile from the installer is ruled out — print the line instead
- a second, separate installer script for agent wiring is ruled out — one command is the point
- bash arrays are ruled out in `install.sh` — it is POSIX `sh`

---

## T-1120 Rewrite `install.sh` as a Node-only installer (L) — #281 · PRD-F14 req 4–15

**Owns**

- `install.sh` — the asset-resolution, download, checksum and extract region (lines ~48–200
  at `8b0c9fa`); the wiring region (277–483) changes only where it writes the MCP command
- `.github/workflows/ci.yml` — the `install-script` job (line 325+), which currently builds
  the binary and stages a fake release
- `test/install-script.test.ts` (extend, or a new file if none covers the contract)
- **`README.md` and the three translations — the shell-install region only**: the one-liner
  (line 37 in `README.md` at `8b0c9fa`) and the pinned-asset block (lines 113–124), together
  with their equivalents in `README.ko.md`, `README.ja.md`, `README.zh-CN.md`. All four change
  in the same commit as the installer, for the truth-window reason in the ownership map
- `test/readme.test.ts` — the assertions covering that region
- `scripts/check-readme-numbers.mjs` — evidence only: it must exit 0, and the byte-checked
  `BENCH:BEGIN`/`BENCH:END` block must be untouched

**Depends on** — ADR-0026 and PRD-F14 approved. Nothing else.

**Forbidden scope**

- no asset download, no `SHA256SUMS` fetch, no tarball checksum, no compile step
- do not touch `install.ps1` (T-1121) or the uninstall command (T-1123)
- **in the READMEs, touch only the shell-install region named in Owns.** The plugin-first
  block above it is already correct and stays byte-identical; the `BENCH:BEGIN`/`BENCH:END`
  block is byte-checked by CI and may not be edited; no compatibility statement or matrix
  pointer is added here — that is T-1122's, and adding one would recreate the overlap this
  ticket was corrected for
- do not remove `scripts/build-binary.mjs`, the release matrix, or the binary code (T-1125)
- do not edit a shell profile; do not add a second script; no bash arrays
- do not resolve a branch — the default install must not reach `dev`
- do not claim Windows support anywhere — Windows arrives with T-1121 and is only *supported*
  after T-1124

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
8. **README truth, all four languages together**: no README's shell-install region mentions
   `SHA256SUMS`, a `.tar.gz` asset, or a target triple; each states the Node ≥ 22 and Git
   prerequisites for the script path; and the plugin-first block above it is byte-identical to
   the base. Asserted over all four files in one test, so the state cannot be half-applied.

All fail at `8b0c9fa`: the current script has no Node or Git check and downloads a platform
asset, and all four READMEs document that asset path (`README.md` line 37 and lines 113–124).

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
| README describes the installer that ships in this commit | test 8 | req 29 — the truth window; ADR-0026 §Consequences |
| All four languages change together | test 8 asserts the set, not one file | req 29; the four-README convention |
| The byte-checked block is untouched | `scripts/check-readme-numbers.mjs` exits 0 | ownership map — evidence only |

**Commands** — focused `npx vitest run test/install-script.test.ts test/readme.test.ts`; full
`npx vitest run`; `sh -n install.sh` exits 0; `node scripts/check-readme-numbers.mjs` exits 0;
`shellcheck install.sh` if available; **LIVE (required)**: a real install in a scratch `HOME`
on a machine with Node ≥ 22 and Git, then `commitlore --version`; then an upgrade run over it;
then the same on a container image without Node, asserting the named failure.

**Evidence invalidation** — line anchors are `8b0c9fa`. Re-derive the asset region with
`grep -n "SHA256SUMS\|tar -xzf" install.sh` and the README region with
`grep -n "install.sh | sh\|SHA256SUMS" README*.md` before editing; never edit a README by line
number, because the install section moves whenever positioning work lands. If T-1125 has
already removed the release matrix, this ticket is out of order — stop.

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

**Completion evidence** — the eight RED tests passing; `sh -n` clean;
`node scripts/check-readme-numbers.mjs` at 0; the live fresh-install, upgrade, and missing-Node
transcripts; a diff containing no asset or checksum logic; and **one commit** carrying both the
installer change and all four README shell-install regions, so no revision of this branch
exists in which a README describes an installer that is not the one beside it.

---

## T-1121 Add `install.ps1` for Windows, same contract (L) — #282 · PRD-F14 req 16–19

**Owns** — `install.ps1` (new); `.github/workflows/ci.yml` (one `windows-latest` job that
executes it); `test/install-ps1.test.ts` (new, shape and contract assertions)

**Depends on** — T-1120, **merged at `5ef4692`**. The two scripts implement one contract and
the shell one defines it, so the contract is now a fact rather than a plan: see the table in
this file's header. `install.ps1` must produce the Windows equivalent of each row — the same
Node floor and the same "nothing was installed" guarantee, a user-local checkout keyed by tag,
a shim carrying a marker its own re-run recognises, a foreign target left untouched, and a
verification step that reports without deciding the exit code.

One asymmetry is deliberate and must not be "fixed" by accident: the shell wrapper resolves
`node` at install time and falls back to `PATH`. A PowerShell shim has the same choice, and
whichever it makes has to be stated in the ticket's own record rather than inherited silently.

**Two measured consequences of that fallback, to decide about rather than copy:**

1. **The fallback is unchecked.** Measured: with the recorded path removed, the wrapper runs on
   whatever `node` is on `PATH` and performs **zero** version checks. The Node >= 22 the
   installer enforced stops holding the moment a version manager switches away, and nothing says
   so. Whether an older Node breaks the bundle was **not established** — none was available — so
   the statement is that the check no longer holds, not that it fails.
2. **The no-Node failure is the shell's, not the product's.** With no `node` anywhere the user
   gets `exec: node: not found` at exit 127, while the installer for the same missing
   prerequisite says "Node.js 22 or newer is required ... Nothing was installed." Fixing that in
   the wrapper costs a `command -v` on every invocation including the hook hot path, which is why
   requirement 7 calls the wrapper thin. This ticket states which side it takes for the shim, and
   says why if it diverges.

**Forbidden scope**

- no compile step, no asset download, no `.exe`
- no administrator elevation, no `Program Files`, no machine-level `PATH` edit
- do not claim Windows is supported anywhere — that is T-1124's precondition
- do not touch `install.sh`, the uninstall command, or `README*`

**RED test** — the file does not exist at `5ef4692`, so every assertion fails: Node and Git
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
`README.md` + the three translations — **one pointer line each, and nothing else**

**Contract with T-1124** — ship the Windows row present, with status `unsupported`, citing #95
and T-1124. T-1124 then changes that one cell and nothing else. Shipping the row absent would
force T-1124 to add a row, which is this ticket's job and would put two owners on the table's
shape.

**Depends on** — T-1120 and T-1121 merged. The document may not describe an installer that has
not shipped; that constraint is why this ticket is not first.

**Measured correspondence** (at `e8e19cd`) — every capability the document may claim, and the
file that provides it. The assertion checks this table, not prose:

| Capability | Provided by | Value |
|---|---|---|
| MCP server | `.mcp.json` | `node ${CLAUDE_PLUGIN_ROOT}/dist/commitlore.mjs mcp` |
| pre-edit context hook | `hooks/hooks.json` | `PreToolUse` on `Edit\|Write\|MultiEdit\|NotebookEdit` |
| skills | `skills/` | `commitlore-commits`, `commitlore-query`, `commitlore-setup` |
| plugin identity | `.claude-plugin/plugin.json` | `commitlore` at the `package.json` version |
| marketplace | `.claude-plugin/marketplace.json` | `commitlore`, `source: "./"` |

`/plugin install commitlore@commitlore` resolves as `<plugin>@<marketplace>` from the last two
rows, so the documented command is derivable from the manifests rather than asserted separately.

**Checked is not the same as required, and the document must not blur them.** Measured:
`install.sh` enforces Node ≥ 22 and a working `git` before it writes anything. **The plugin path
enforces nothing** — it needs Node just as much, because the hook and the MCP server both run
`node dist/commitlore.mjs`, but a user without Node gets a hook that fails open with
"CLI could not be resolved; no context was injected" at exit 0 and no statement that Node is
missing. A compatibility statement that lists Node under one heading for both paths would imply
an enforcement the plugin path does not perform, so the two columns are separate: **required**,
and **checked by the installer**.

**Do not inherit the musl reason.** `README.md`'s Known limitations still says Alpine and other
musl hosts are unsupported *because only glibc binaries are published*. Measured at `e8e19cd`,
`install.sh` has no platform gate at all — no `uname`, no architecture mapping, no libc check —
so that reason no longer describes anything. Whether musl now works is **unverified**: it was not
executed, because the container daemon was unavailable. This ticket must resolve musl's row from
an executed check rather than by carrying the old reason forward or by assuming the gate's
removal implies support. The stale bullet itself is T-1125's, per the ownership map.

**Forbidden scope**

- no build target, release matrix, `SHA256SUMS`, or platform asset in the document
- **do not touch the shell-install region of any README.** T-1120 owns the one-liner and the
  pinned-asset block and rewrites them in the same commit as the installer. This ticket adds a
  pointer to the compatibility document and changes nothing else in those files — a wider diff
  here is the overlap the ownership map exists to prevent
- do not restate any installer behaviour in prose. The document states host support and the
  prerequisites each installer *checks*; it does not re-describe how either installs
- do not touch the `BENCH:BEGIN`/`BENCH:END` block; the pointer line lands in all four READMEs
  together
- do not mark Windows `supported` — T-1124 owns that claim

**RED test** — the document does not exist at `8b0c9fa`. Assertions: every documented plugin
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

**Measured inventory** (shipped installer, scratch `HOME`, at `6e1d46d`) — the contract is bound
to these numbers rather than to a description:

| Owner | Artefact | Count |
|---|---|---|
| **this ticket** | wrapper `~/.local/bin/commitlore` | 1 file |
| **this ticket** | checkout `~/.local/share/commitlore/<tag>/` | 1206 files |
| **this ticket** | agent MCP entries — `.codex/config.toml`, `.gemini/settings.json`, `.cursor/mcp.json`, `.config/opencode/opencode.json` | 4 configs |
| **Claude Code** | `~/.claude/plugins/cache/**` | 6948 files, of which 4527 are `node_modules` |
| **Claude Code** | `~/.claude.json` | written by the `claude` CLI |

The plugin cache is a full copy of the repository with its dependencies, keyed by plugin
version. It is why this ticket names the plugin uninstall step instead of performing it: a
command that removed 6948 files it did not write would be doing Claude Code's job badly.

**The entry shape to match** is `{"command": "<wrapper path>", "args": ["mcp"]}` — the value is
the wrapper, not `node` and not the bundle. Recognition matches that shape. Matching any entry
whose command merely contains `commitlore` would also match an unrelated server a user happened
to name that way, which is the "never remove an entry the installer did not write" rule failing
in the one case nobody would notice. Two of the four configs pre-existed and were merged into,
and an unrelated entry with its token plus an unrelated top-level key both survived — so the
byte-for-byte survival requirement below is measured, not hoped for.

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
test asserts the config-path table agrees with both installers. All fail at `8b0c9fa` — no such
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

## T-1124 Establish #71's containment for the wrapper path on Windows (M) — #283 · PRD-F14 req 26

**Owns** — `.github/workflows/ci.yml` (extend T-1121's Windows job, or one adjacent required
job); `test/hook-target.test.ts` (wrapper-path cases)

**Also changes, under the single-writer rule** — the compatibility document's Windows row
`status` cell and its reason, and **nothing else in that file**. T-1122 owns the document and
ships that row already present with status `unsupported`, citing #95 and this ticket, so this
ticket has exactly one cell to change and never has to add or restructure a row. A diff here
that adds a row, edits another row, or touches the table's shape belongs to T-1122. The path is
deliberately not listed under **Owns**, so an ownership scan that matches on filenames still
reports one owner per file.

**Depends on** — T-1121 merged. There is no wrapper on Windows before it.

**Forbidden scope**

- `continue-on-error` is forbidden; the job is required or the ticket is not done
- do not mark Windows `supported` unless the attacks pass **on Windows**
- do not loosen any containment match to make a test pass — that is the property itself

**RED test** — #71's two containment attacks, executed against a **wrapper** target on
`windows-latest`: a recorded `commitlore.bin` pointing outside the install root is refused, and
a recorded target that is neither a script nor a recognised wrapper is refused. Both fail or are
absent at `8b0c9fa`, where no Windows job exists and the classification knows only a bare
binary name.

**The question is narrower than it looks.** Measured on macOS at `7b23e71`, a wrapper install
records the `.mjs` bundle inside the checkout — not the wrapper, and not an executable — so
there is no `.exe` to classify and the compiled-binary arm is not involved. What is unknown is
whether Windows `init` records the same shape and whether the stub's root resolution agrees
under Windows path semantics. The macOS baseline to compare against, including both attacks
refused with the tampered program run zero times, is on #283.

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

## T-1125 Remove the compiled-binary code (L) — #284 · PRD-F14 req 27–29

**Owns** — the sites in ADR-0026's inventory that remain after T-1120:
`scripts/build-binary.mjs`; `package.json` `build:binary`;
`.github/workflows/release.yml` `build` (from line 77 at `8b0c9fa`) and `publish` (from 138)
asset and `SHA256SUMS` steps; `.github/workflows/ci.yml` `binary` job;
`scripts/commitlore-run.sh`'s compiled-binary probe; `src/core/hook-target.ts`;
`src/hooks/commit-msg.ts`; `dist/` rebuilt.

**Not the README shell-install region.** T-1120 removed the one-liner's asset path and the
pinned-asset block already. This ticket touches a README only if a *residual* compiled-binary
or release reference survived elsewhere in it, and its RED test names which one — an empty
README diff is the expected outcome.

**Depends on** — T-1120, T-1121 and T-1122 merged. Requirement 27: the replacement must ship
first, so there is never a window with neither.

**Forbidden scope**

- **do not delete #71's containment check along with the binary arm.** Requirement 28: the
  property must hold for the wrapper case after this ticket. **Measured at `7b23e71`, the check
  to protect is the script arm's install-root resolution, not `matchesRunningBinary`:**
  `commitlore init` through the wrapper records `commitlore.bin` as the `.mjs` bundle inside the
  checkout, so a wrapper install never reaches the compiled-binary arm. Both of #71's attacks
  were executed against that install — a target outside the root, and an arbitrary executable —
  and each was refused with a named message, exit 0, and the tampered program run zero times.
  Building a "wrapper equivalent" of the binary arm would be work with nothing behind it, while
  the check that actually holds the property went unnamed and unguarded. Evidence is on #284
- do not change the version, the tag procedure, or the release gate's other checks
- do not remove the plugin path's Node resolution in `scripts/commitlore-run.sh` — only the
  compiled-binary probe ahead of it

**RED test** — a repository-wide invariant asserting no tracked file builds, downloads, or
classifies a compiled executable: no `build:binary`, no SEA call, no `SHA256SUMS` fetch in an
installer, no `BinKind` arm for a compiled binary. Fails at `8b0c9fa`, where all of those exist.
Plus a containment test proving the wrapper case is still refused when it points outside the
install root — which must pass **before and after** this ticket.

**Commands** — focused on `test/hook-target.test.ts`, `test/hooks.test.ts` and the new
invariant; full suite; `npm run build` with `dist/` committed; both `tsc --noEmit`;
`node scripts/check-readme-numbers.mjs` exit 0; **LIVE (required)**: the next release run
publishes no platform asset and the plugin path still resolves and runs.

**Evidence invalidation** — the inventory is bound to `69e5208` in ADR-0026, re-anchored to
`8b0c9fa` here, and must be re-anchored again at this ticket's own head, which is several
merges later by construction. Re-derive every line number before editing; if any site has already
been removed, drop it from **Owns** rather than re-editing.

**Stop / escalate** — if removing the binary arm cannot preserve containment for the wrapper
without redesigning the check, stop: that is a security design change and needs its own ADR,
not a removal ticket.

**Completion evidence** — the invariant test passing, the containment test green on both sides
of the change, a release run with no platform asset, and the plugin path exercised end to end.
