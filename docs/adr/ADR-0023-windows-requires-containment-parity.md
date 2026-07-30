# ADR-0023: Windows ships only after #71's containment is verified on Windows

- Status: Accepted (2026-07-31)
- Milestone: M6 · Universal Adoption (Gate B)
- Extends: [ADR-0015](ADR-0015-single-executable-binary.md) (single-executable binary)
- Closes acceptance row: `B-1` in [`../GATE-B-ACCEPTANCE.md`](../GATE-B-ACCEPTANCE.md)

## Context

Windows is excluded from the release matrix. [#95](https://github.com/MongLong0214/commitlore/issues/95)
recorded why, from a real `windows-latest` run rather than an assumption, and found
**two** independent problems.

1. **The build dies before SEA is reached.** `resolve(new URL('..', import.meta.url).pathname)`
   doubles the drive letter (`D:\D:\a\commitlore\...`).
2. **The installed hook would silently bypass #71's containment.** `classifyBinTarget`
   (`src/core/hook-target.ts:63`) recognises a binary only as `basename(path) === 'commitlore'`,
   and the `commit-msg` stub's allowlist glob (`src/hooks/commit-msg.ts:98`) is
   `*.mjs|*.js|*/commitlore|commitlore`. Neither knows `commitlore.exe`. On Windows the
   real binary would therefore not classify as a binary, and the install-root containment
   that stops `commitlore.bin` from pointing at an arbitrary executable would not apply
   to it.

Two facts measured at `e2b5725` while writing this ADR, both sharper than what #95
recorded:

- the `.pathname` pattern is in **four** scripts — `scripts/adoption-range.mjs:21`,
  `scripts/build-binary.mjs:62`, `scripts/check-test-files-ran.mjs:21`,
  `scripts/check-engines.mjs:21` — not the two #95 names.
- `scripts/check-release-version.mjs:37` already uses
  `resolve(fileURLToPath(new URL('..', import.meta.url)))`. The correct pattern is
  already in the repository, so this is an inconsistency to converge, not a technique
  to discover.

The distinction that matters for a gate: problem 1 is a defect, and a broken build is
loud. Problem 2 is a **security property that would be quietly false on a platform we
shipped to**. #71's containment was verified twice — on macOS. A property verified on
one platform is not a property of the product.

## Decision

**Windows enters the release matrix last, and only after #71's two containment attacks
have been executed on Windows and passed there.** Inference from macOS does not
substitute.

The order in #95 becomes binding, one ticket per step, in this sequence:

1. Converge all four `.pathname` sites onto `fileURLToPath`, matching
   `check-release-version.mjs`.
2. Teach `classifyBinTarget` and the `commit-msg` stub allowlist about `.exe`, with the
   extension recognised explicitly rather than by loosening the match.
3. Execute #71's two containment attacks in CI **on `windows-latest`** and require them
   to pass there.
4. Only then add `windows-latest` to the release build matrix.

Steps 1–3 are independently verifiable and mergeable. Step 4 is a matrix edit that
depends on all three.

Until step 4 lands, **a missing Windows asset stays the correct outcome**, and
`README.md`'s existing statement that Windows is unsupported stays accurate. That
sentence may not be softened by any ticket before step 4.

## Ruled-out

- **Fix the path bug and ship Windows, then fix containment** | ships a platform on
  which #71 is open. The order exists because the second problem is the reason the
  first one cannot be fixed alone. This is the specific sequencing #95 warned against.
- **Broaden `classifyBinTarget` to accept any basename starting with `commitlore`** |
  turns an exact-name allowlist into a prefix match, so `commitlore-evil` would classify
  as the binary. The containment property depends on the match being exact; add the one
  extension the platform requires, not a pattern.
- **Verify containment on Windows by reasoning from the macOS result** | the property is
  about how a shell stub and a path classifier behave against a specific filesystem and
  executable model. That is exactly what differs. #95 states the requirement as
  "verified there, not inferred from macOS", and this ADR does not weaken it.
- **Add `windows-latest` to the matrix with `continue-on-error`** | a green release run
  with a silently absent asset is worse than a missing asset, because the release then
  claims a platform it did not produce. Assets are checksum-listed; a partial matrix
  makes `SHA256SUMS` a document about what happened to succeed.
- **Drop Windows from Gate B entirely** | the M6 description names it. The gate may
  conclude that Windows is not ready, but it must reach that conclusion from executed
  steps, not by removing the row.

## Consequences

- Gate B carries four Windows tickets, not one, and three of them produce no Windows
  asset. The visible deliverable arrives only at the end.
- The `.pathname` convergence touches build and check scripts that run on every CI job,
  so it is verified by the existing CI passing, not only by a new unit test.
- CI acquires a `windows-latest` job before the release matrix does. That job's purpose
  is the containment attacks; it is not a full test-suite port and does not claim to be.
- If the containment attacks fail on Windows for a reason that is not the `.exe`
  classification, Gate B stops at step 3 and the finding becomes its own issue. The gate
  is allowed to end with "Windows is still unsupported, and here is the executed
  evidence" — that is a pass for this ADR, and a failure only for the row that wanted
  the asset.

## Falsification

This ADR is wrong if any of the following is true:

- a Windows asset is published while `classifyBinTarget` still matches only the bare
  name, or while #71's attacks have never run on `windows-latest`
- `README.md` stops stating Windows is unsupported before step 4 lands
- the containment attacks are marked non-blocking in CI
