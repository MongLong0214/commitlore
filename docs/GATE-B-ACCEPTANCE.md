# Gate B acceptance matrix

Authority for which ticket closes which Gate B commitment. Same role for M6 that
[`GATE-A-ACCEPTANCE.md`](GATE-A-ACCEPTANCE.md) has for M5.

**Rewritten 2026-07-31 by an owner scope change.** Rows `B-1`…`B-5` are **withdrawn**, not
deferred: each existed to serve a compiled-executable and platform-asset plan that
[ADR-0026](adr/ADR-0026-node-only-distribution.md) removed from the product. The documents
they depended on — ADR-0023, ADR-0024, ADR-0025, `PRD-F12-universal-adoption.md` and
`docs/tickets/F12-universal-adoption.md` — are removed in the same change, and their issues
(#265–#270) are closed as not planned. No active row, requirement or dependency in this
repository asks for a binary.

## Scope of Gate B, as it now stands

1. The two items `PRD-F9-unified-capture.md`'s "Non-goals" defers to Gate B: guard
   integration into the capture pipeline, and the user-editable policy file. Both survive
   the reversal untouched — neither has anything to do with distribution.
2. Distribution work is **re-planned from ADR-0026**: plugin-first for Claude Code,
   Node-only `install.sh` / `install.ps1` elsewhere, specified by
   [`PRD-F14`](prd/PRD-F14-distribution.md) and broken into six atomic tickets in
   [`docs/tickets/F14-distribution.md`](tickets/F14-distribution.md). A row lands here **as
   its ticket becomes approval-ready**, never before — an acceptance row with no approved
   ticket is exactly the dangling authority Gate A's matrix was written to stop. `B-8` was the
   first, added when T-1120 was corrected to a single owner per region. `B-9`…`B-13` follow, one
   per shipped ticket, and two of them are for tickets that did not exist when this was written:
   measurement changed the plan twice, and the rows say so rather than presenting the result as
   what was intended.

## Rows

| Row | Asserts | Source authority | Closing ticket(s) | Decided by |
|---|---|---|---|---|
| B-6 | Guard participates in the capture pipeline as an advisory that **cannot block a capture or a commit** | `PRD-F9-unified-capture.md` "Non-goals" — a standalone deferral, explicitly **not** row `P0-8` (that row is `commitlore_before_change`, closed by T-1024 #219); [ADR-0020](adr/ADR-0020-guard-is-an-experimental-advisory.md); `bench/GUARD-CANNOT-BLOCK.md` | T-1109 (#273) — **shipped** | A differential test: a guard match at any score changes no exit code and no pending phase, and the two pending records differ in exactly one field |
| B-7 (row `P1-5`) — **shipped** | The user-editable policy file ships, and the pending-transaction format absorbs it **without a breaking change** | `P1-5`, cited as explicitly Gate B in [ADR-0021](adr/ADR-0021-capture-pending-transaction.md) §"P1-5" and `PRD-F9` "Non-goals". ADR-0021 already fixes the migration: the policy identity hash input changes from `sha256(hardcoded-defaults-json)` to `sha256(policy-file-contents)` | T-1110 (#274) — merged, issue closed | A pending file written by the pre-policy code path is still consumable after the policy file ships; the identity hash changes and the format version does not |
| B-8 — **shipped** | `install.sh` installs with **no compiled artifact** — Node ≥ 22 and Git checked before anything is written, a pinned checkout in the user's data directory, and a thin `PATH` wrapper that runs `node dist/commitlore.mjs` — and the README describes **that** installer, in the same commit | [ADR-0026](adr/ADR-0026-node-only-distribution.md); [PRD-F14](prd/PRD-F14-distribution.md) requirements 4–15 and 29 | T-1120 (#281) — merged at `5ef4692` | Eight RED assertions in `test/install-script.test.ts` and `test/readme.test.ts`, `sh -n install.sh` at 0, `node scripts/check-readme-numbers.mjs` at 0, and a live fresh-install, upgrade-over-running-wrapper and missing-Node run. **One commit** carries the installer and all four README shell-install regions, so no revision exists in which a README describes an installer that is not beside it |

| B-9 — **shipped** | `install.ps1` installs on Windows under the **same contract** as `install.sh` — the same prerequisites checked in the same order before anything is written, a pinned checkout, and a `PATH` shim that runs `node dist/commitlore.mjs` | [ADR-0026](adr/ADR-0026-node-only-distribution.md); [PRD-F14](prd/PRD-F14-distribution.md) requirements 16–19 | T-1121 (#282) — merged at `655a501` | A `windows-latest` job executing the script the way a user would, under Windows PowerShell 5.1 and PowerShell 7: the shim carries its marker with CRLF and reports the version `package.json` declares, a second run is an upgrade, an occupied destination is refused with exit 4 leaving the foreign file unmodified, and an unknown tag is refused with exit 2 leaving no checkout |
| B-10 — **shipped** | One authoritative statement of **which hosts are supported and what each install path checks**, kept honest by machine — and it distinguishes *required* from *checked by the installer*, because the plugin path enforces nothing | [PRD-F14](prd/PRD-F14-distribution.md) requirements 1–3; [ADR-0010](adr/ADR-0010-node-floor.md) | T-1122 (#271) — merged at `ac1eb5d` | `test/compatibility-matrix.test.ts` compares every table to the file that provides what it claims — the MCP command and hook matcher against their manifests, the skills against the directories on disk, each prerequisite against the installer said to check it — and fourteen injected disagreements each fail where the unmutated document passes. musl was decided by executing `install.sh` in `alpine:3.21` on `aarch64` and `x86_64`, which is also what closes withdrawn row `B-2` |
| B-11 — **shipped** | `install.sh` and `install.ps1`'s writes are **removable by a command**, and that command removes nothing it did not write | [PRD-F14](prd/PRD-F14-distribution.md) requirements 20–25; the surviving requirement of withdrawn row `B-5` | T-1123 (#272) — merged at `2c1eeaa` | A live install-then-uninstall in a scratch `HOME` with unrelated entries planted first: the wrapper, the checkout and both MCP entries are removed, while another server's entry, an unrelated top-level key and a neighbouring `[mcp_servers.someone-else]` block survive byte for byte. Entries are matched on shape **and** on the wrapper they point at, never on the key — ten refusal cases assert it — and the path table is asserted against both installers in both directions, which is what found the fifth agent config the ticket's inventory had missed |
| B-12 — **shipped** | The `commit-msg` hook **returns** on Windows, and #71's install-root containment compares two path representations of one location as the same place | [#71](https://github.com/MongLong0214/commitlore/issues/71); [#321](https://github.com/MongLong0214/commitlore/issues/321); [PRD-F14](prd/PRD-F14-distribution.md) requirement 26 | T-1127 (#321) — merged at `7c4f14f`. **Not in the original plan**: T-1124's measurement found the hook broken rather than unverified, and its stop condition sent the repair to a ticket of its own | The walk executes the **shipped stub text** and terminates from a drive-letter root, a bare drive letter, a posix root and a relative path — all four hung before. `doctor`'s mirror now reads the recorded root rather than the running CLI's, so it can no longer report no problem for a hook that refuses. An already-installed repository is reported `outdated` and repaired by re-running `commitlore hooks install`, which works because it is not a commit |
| B-13 — **shipped** | Windows is **supported**, and the word rests on #71's containment established there rather than on reachability | [PRD-F14](prd/PRD-F14-distribution.md) requirement 26; the surviving requirement of withdrawn row `B-1` | T-1124 (#283) — merged at `51abef8`, blocked on B-12 until it passed | On `windows-latest`, in the ticket's own required job: a real commit through the recorded install is **accepted**, an invalid record is refused, and both of #71's containment attacks execute and refuse at `commit exit 1` with the tampered program run zero times. Each attack's positive control fires first, so an absent witness means not-executed rather than a witness the harness could not observe — a fix that had loosened the match to make the legitimate path work would have passed the baseline and failed there |
## Withdrawn rows, and why

Recorded rather than deleted, so that a later reader finds the reason instead of a gap.

| Row | Had asserted | Withdrawn because |
|---|---|---|
| B-1 | Windows shipped only with #71's containment verified on Windows — **the surviving requirement is now closed by `B-13`** | there is no Windows executable to ship. Windows becomes reachable through `install.ps1` and a Node wrapper, which is re-planned from ADR-0026. The containment property still has to be established for the wrapper path before any document calls Windows supported |
| B-2 | musl decided with recorded evidence — **decided by execution under `B-10`** | the question existed only because a glibc-linked binary cannot run on musl hosts. With no binary, Alpine needs Node and Git like any other host, so the question dissolves rather than being answered |
| B-3 | one package-manager channel as a verified pointer to a published release | the release it would have pointed at is a binary asset. A formula that installs a checkout plus a Node wrapper duplicates the shell installer, and ADR-0011's surviving objection still applies |
| B-4 | a compatibility matrix kept in sync with the release build matrix — **replaced by `B-10`** | its authority was the platform binary matrix. The replacement is a plugin-first plus shell/Node compatibility statement, re-planned from ADR-0026 (#271) |
| B-5 | `install.sh`'s writes are removable by a command — **the surviving requirement is closed by `B-11`** | the requirement survives, but its contract changes: plugin uninstall and shell/Node uninstall are separate paths, and neither removes a binary (#272) |

## Disposition

Every row is closed, and the tickets that closed them are named above.

| Scope item | Closed by |
|---|---|
| Guard as a capture advisory | `B-6` — T-1109 (#273) |
| The user-editable policy file | `B-7` — T-1110 (#274) |
| Distribution, re-planned from ADR-0026 | `B-8`…`B-13` — T-1120…T-1124, T-1126, T-1127 |

Two of those tickets were not in the plan. `T-1126` exists because measurement
overtook a README claim that no ticket was allowed to edit, and `T-1127` because
`T-1124` set out to verify a property and found the hook broken instead. Both are
recorded as what happened rather than folded into the tickets that discovered
them: a gate that reads as if the plan was right the first time teaches nothing
about how it was actually closed.

The word this gate spent the longest earning is `supported` for Windows, and it
is worth stating what it does **not** mean. It means #71's containment was
established there by execution, in a required job, with the legitimate install
working in front of it. It does not mean Windows has the same amount of use
behind it as macOS and Linux, and it does not extend to a repository whose hook
was installed before `B-12` — that one keeps the old stub and must re-run
`commitlore hooks install`.

## What this gate does not claim

- **B-6 does not make guard accurate.** ADR-0020's measured precision 44.8% / recall 22.0%
  is unchanged by integrating it. The row is about where an advisory appears.
- **Nothing here measures adoption.** The milestone is named for the goal; every row is a
  capability or a decision. No row claims a user count, and none may be added that does
  without an interval.
- **No row claims Windows support.** Reachability through a PowerShell installer is not the
  same claim as a verified containment property, and the two must not be conflated.

## Execution constraints

- T-1109 merged before T-1110; both touch the capture pipeline. T-1109 is shipped, so
  T-1110 must re-derive its line numbers rather than trusting the ticket's `e2b5725` anchors.
- Every ticket that changes `src/` must rebuild and commit `dist/`; CI compares them.
- **No implementation code for the re-planned distribution work** until the revised ADR, the
  revised PRD and each atomic ticket have separately passed review.
- The existing compiled-binary code stays in place until its own approved removal ticket.
  ADR-0026 carries the inventory.
