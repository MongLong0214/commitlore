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
   Node-only `install.sh` / `install.ps1` elsewhere. Its rows are added here by the revised
   PRD and its atomic tickets, each separately approved. **This file does not pre-empt them
   with placeholder rows** — an acceptance row with no approved ticket is exactly the
   dangling authority Gate A's matrix was written to stop.

## Rows

| Row | Asserts | Source authority | Closing ticket(s) | Decided by |
|---|---|---|---|---|
| B-6 | Guard participates in the capture pipeline as an advisory that **cannot block a capture or a commit** | `PRD-F9-unified-capture.md` "Non-goals" — a standalone deferral, explicitly **not** row `P0-8` (that row is `commitlore_before_change`, closed by T-1024 #219); [ADR-0020](adr/ADR-0020-guard-is-an-experimental-advisory.md); `bench/GUARD-CANNOT-BLOCK.md` | T-1109 (#273) — **shipped** | A differential test: a guard match at any score changes no exit code and no pending phase, and the two pending records differ in exactly one field |
| B-7 (row `P1-5`) | The user-editable policy file ships, and the pending-transaction format absorbs it **without a breaking change** | `P1-5`, cited as explicitly Gate B in [ADR-0021](adr/ADR-0021-capture-pending-transaction.md) §"P1-5" and `PRD-F9` "Non-goals". ADR-0021 already fixes the migration: the policy identity hash input changes from `sha256(hardcoded-defaults-json)` to `sha256(policy-file-contents)` | T-1110 (#274) | A pending file written by the pre-policy code path is still consumable after the policy file ships; the identity hash changes and the format version does not |

## Withdrawn rows, and why

Recorded rather than deleted, so that a later reader finds the reason instead of a gap.

| Row | Had asserted | Withdrawn because |
|---|---|---|
| B-1 | Windows shipped only with #71's containment verified on Windows | there is no Windows executable to ship. Windows becomes reachable through `install.ps1` and a Node wrapper, which is re-planned from ADR-0026. The containment property still has to be established for the wrapper path before any document calls Windows supported |
| B-2 | musl decided with recorded evidence | the question existed only because a glibc-linked binary cannot run on musl hosts. With no binary, Alpine needs Node and Git like any other host, so the question dissolves rather than being answered |
| B-3 | one package-manager channel as a verified pointer to a published release | the release it would have pointed at is a binary asset. A formula that installs a checkout plus a Node wrapper duplicates the shell installer, and ADR-0011's surviving objection still applies |
| B-4 | a compatibility matrix kept in sync with the release build matrix | its authority was the platform binary matrix. The replacement is a plugin-first plus shell/Node compatibility statement, re-planned from ADR-0026 (#271) |
| B-5 | `install.sh`'s writes are removable by a command | the requirement survives, but its contract changes: plugin uninstall and shell/Node uninstall are separate paths, and neither removes a binary (#272) |

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
