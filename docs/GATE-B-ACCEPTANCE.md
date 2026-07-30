# Gate B acceptance matrix

Authority for which ticket closes which Gate B commitment. Same role for M6 that
[`GATE-A-ACCEPTANCE.md`](GATE-A-ACCEPTANCE.md) has for M5.

Gate A's matrix had to be reconstructed from citations, and five of its eight rows were
wrong on the first attempt because a citation is not a definition. This file is written
**before** any Gate B ticket exists, so every row below has a source that predates it:
the M6 milestone description, an issue closed with its finding recorded, an active
ruled-out record, or a Gate A row that was explicitly deferred here. Each row names that
source. No row is reconstructed.

## Scope of Gate B

Exactly two sets, and nothing else:

1. The four areas the M6 milestone description names — Windows/musl builds, package
   managers, update/uninstall, a compatibility matrix.
2. The two items `PRD-F9-unified-capture.md`'s "Non-goals" defers to Gate B: guard
   integration into the capture pipeline, and the user-editable policy file.

**One attribution to get right.** Of those two, only the policy file is an
acceptance-matrix row (`P1-5`, cited as explicitly Gate B in ADR-0021 §7). Guard
integration into the capture pipeline is a non-goal that stands on its own; PRD-F9 says so
in the same bullet, and adds that it "is not acceptance-matrix row `P0-8`". `P0-8` is the
unified `commitlore_before_change` tool and was **closed in Gate A by T-1024 (#219)**.

This file's first draft cited `P0-8` for row `B-6` anyway. That is precisely the failure
`GATE-A-ACCEPTANCE.md` documents — three of its rows had a subject reconstructed from
where a label was cited — and it was caught here by reading the merged Gate A matrix
rather than a stale local checkout. The corrected citation is recorded rather than quietly
replaced, because the check is the point.

## Rows

| Row | Asserts | Source authority | Closing ticket(s) | Decided by |
|---|---|---|---|---|
| B-1 | Windows is either shipped with #71's containment verified **on Windows**, or still absent — never shipped with the property unverified | [#95](https://github.com/MongLong0214/commitlore/issues/95) (closed, with the order of work recorded); [ADR-0023](adr/ADR-0023-windows-requires-containment-parity.md) | T-1101, T-1102, T-1103, T-1104 | `windows-latest` CI job running #71's two containment attacks exits 0; release matrix contains `windows-latest` only after it does |
| B-2 | musl has a **recorded decision with its evidence**, not an absence | active ruled-out record on `install.sh`/`release.yml` ("a release.yml/build-matrix change … DO NOT: no Docker in the release build matrix"); [ADR-0024](adr/ADR-0024-musl-target-gated-on-feasibility.md) | T-1105 | A committed spike result answering "can a musl-linked SEA be built in the release matrix without Docker" with a measurement and a recommendation. **A "no" closes this row.** |
| B-3 | One package-manager channel exists and is a verified pointer to a published release — no second build, no hand-edited digest | M6 description ("package managers"); [ADR-0025](adr/ADR-0025-package-manager-as-verified-pointer.md), reconciled against [ADR-0011](adr/ADR-0011-plugin-first-distribution.md)'s rejection of a second channel | T-1106 | Regenerating the manifest from the current release produces a byte-identical file (CI diff), and one install through the channel succeeds on a machine that did not build it |
| B-4 | A single authoritative compatibility matrix exists, and a test fails if it disagrees with `install.sh`'s target mapping or the release build matrix | M6 description ("compatibility matrix") | T-1107 | `npx vitest run test/compatibility-matrix.test.ts` fails when a target is added to `release.yml` without a matrix row |
| B-5 | What `install.sh` writes can be removed by a command — the binary and the agent MCP entries it added — and it never removes what it did not write | M6 description ("update/uninstall"); measured absence at `e2b5725`: `hooks uninstall` and `inject uninstall-claude-hook` undo per-repository state only | T-1108 | A test installs, uninstalls, and asserts both that the written entries are gone and that a pre-existing unrelated entry in the same config survived |
| B-6 | Guard participates in the capture pipeline as an advisory that **cannot block a capture or a commit** | `PRD-F9-unified-capture.md` "Non-goals" — a standalone deferral, explicitly **not** row `P0-8` (that row is `commitlore_before_change`, closed by T-1024 #219); [ADR-0020](adr/ADR-0020-guard-is-an-experimental-advisory.md); `bench/GUARD-CANNOT-BLOCK.md` | T-1109 | A test asserts a guard match at any score changes no exit code and no pending phase — it only adds an advisory field |
| B-7 (row `P1-5`) | The user-editable policy file ships, and the pending-transaction format absorbs it **without a breaking change** | `P1-5`, cited as explicitly Gate B in [ADR-0021](adr/ADR-0021-capture-pending-transaction.md) §"P1-5" and `PRD-F9` "Non-goals". ADR-0021 already fixes the migration: the policy identity hash input changes from `sha256(hardcoded-defaults-json)` to `sha256(policy-file-contents)` | T-1110 | A pending file written by the pre-policy code path is still consumable after the policy file ships; the identity hash changes and the format version does not |

## What this gate does not claim

Stated here so no row is read as more than it is.

- **B-2 can pass with no musl asset.** Its pass condition is a decision, which is a
  weaker promise than a build. ADR-0024 says so, and this table repeats it because a
  matrix row is where the overclaim would happen.
- **B-1 can pass with Windows still unsupported.** If the containment attacks fail on
  Windows for a reason outside `.exe` classification, the gate stops at T-1103 and the
  finding becomes its own issue. "Executed, and Windows is still not ready" is a pass for
  the safety property and a failure only for the asset.
- **B-3 adds one channel, not a packaging strategy.** No Windows package manifest is in
  scope, because no Windows asset exists to point at.
- **B-6 does not make guard accurate.** ADR-0020's measured precision 44.8% / recall
  22.0% is unchanged by integrating it. This row is about where an advisory appears, not
  about what it is worth.
- **Nothing here measures adoption.** The milestone is named Universal Adoption; every
  row above is a capability or a decision. No row claims a user count, and none should be
  added that does without an interval.

## Execution constraints

- **T-1101 → T-1102 → T-1103 → T-1104 is a chain, not a wave.** ADR-0023 makes the order
  binding; T-1104 is a release-matrix edit that must be last.
- **T-1104 and T-1106 must not merge in the same wave.** Both change what a release
  publishes or points at; sequencing them keeps a broken manifest from being attributed
  to a matrix change.
- **T-1109 and T-1110 both touch the capture pipeline.** T-1110 changes the policy
  identity hash input, which T-1109's advisory field is written alongside. T-1109 merges
  first, or T-1110 carries its field forward.
- Every ticket that changes `src/` must rebuild and commit `dist/`; CI compares them.
- `README.md`'s Windows and musl statements may not be softened by any ticket before its
  row's asset actually exists.
