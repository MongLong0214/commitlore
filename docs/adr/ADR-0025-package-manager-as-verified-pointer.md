# ADR-0025: a package manager may be a verified pointer to a release, never a second channel

- Status: Accepted (2026-07-31)
- Milestone: M6 · Universal Adoption (Gate B)
- Extends: [ADR-0011](ADR-0011-plugin-first-distribution.md) (registry-free git distribution),
  [ADR-0015](ADR-0015-single-executable-binary.md) (single-executable binary)
- Closes acceptance row: `B-3` in [`../GATE-B-ACCEPTANCE.md`](../GATE-B-ACCEPTANCE.md)

## Context

M6 names package managers. ADR-0011 ruled out **"keep npm alongside the plugin"**, on
the grounds that "two channels split versions and preserve the OTP ritual for every
release". Taken at face value that rejection forbids the whole row, so this ADR has to
say precisely which part of it still binds and why the remainder does not.

ADR-0011 gave three reasons against npm. They do not survive equally.

| ADR-0011's reason | Applies to a git-hosted tap? |
|---|---|
| The owner acquires a release ritual — accounts, tokens, an OTP that actually blocked the first attempt | **No.** A tap is a file in a git repository. No account, no token, no OTP. |
| Users inherit an ecosystem bias — `npm install -g` inside a Python or Go repository | **No.** A system package manager is not tied to the repository's language. |
| It is disconnected from the agent ecosystem — no agent discovers tools in a registry | **Still true**, and it is why this is not a first-class surface. Nothing about this ADR changes the fact that MCP and the plugin are how agents find CommitLore. |

What does still bind is the first half of the sentence: **two channels split versions.**
That is the failure to prevent, and it is preventable by construction. A formula that
carries its own build splits versions. A formula that carries the tag, the asset URL and
the checksum that the release already published cannot — it resolves to the identical
bytes or it fails.

ADR-0015 established the shape for exactly this situation once already: the binary is
"an additional, uncommitted, reproducible build artifact rather than a second registry or
a replacement channel." A package manifest is the same kind of thing one level up.

## Decision

**A package-manager manifest is permitted only as a verified pointer to an existing
tagged release.** Four properties, all of them mechanical:

1. **No second build.** The manifest downloads a published release asset. It never
   compiles, never bundles, never produces bytes of its own.
2. **Version from the tag.** The version in the manifest is the release tag. It is not
   written by hand and not maintained on a separate cadence.
3. **Checksum from `SHA256SUMS`.** The digest in the manifest is the one the release
   published. A mismatch is an install failure, not a warning.
4. **Generated, never hand-edited.** The manifest is produced from the release by a
   script that CI can re-run, so drift between the manifest and the release is a
   detectable diff rather than a discovery months later.

**Homebrew is the one channel Gate B adds**, as a tap, covering macOS and Linuxbrew.
`git clone` remains canonical and `install.sh` remains the one-liner; the tap is a third
way to reach the same asset, listed after them.

**No Windows package manager in Gate B.** Scoop or WinGet would package an asset that
does not exist, and [ADR-0023](ADR-0023-windows-requires-containment-parity.md) forbids
that asset until #71's containment is verified on Windows. The rule above is written to
be reusable so that a Scoop manifest is a later ticket, not a later argument.

## Ruled-out

- **Publish to npm after all, now that the binary exists** | the OTP ritual and the
  ecosystem bias are both unchanged, and ADR-0011's rejection was not conditional on the
  binary. Nothing in Gate B is evidence against it.
- **A formula that builds from source** | reintroduces a toolchain requirement at install
  time, which ADR-0011 rejected for the clone path, and produces bytes no release
  published — the exact version split this ADR exists to prevent.
- **Hand-maintain the formula and bump it during the release checklist** | one more
  manual step in a release procedure that already caught a version-pin defect. A
  hand-edited digest is also a digest nobody can recompute from the release.
- **Submit to `homebrew-core` instead of running a tap** | core submission adds an
  external review cadence between a tag and its availability, so the two would visibly
  diverge, and it imposes notability and maintenance requirements this project has no
  reason to take on to make one command work.
- **Add Scoop or WinGet in the same wave for symmetry** | there is no Windows asset to
  point at. A manifest for a missing asset is a broken install that reports itself as a
  supported platform.
- **Treat the tap as the recommended install path** | agents do not discover tools
  through a system package manager, which is ADR-0011's surviving reason. The tap serves
  a human setting up a machine; it does not lead.

## Consequences

- The release surface grows by one generated file and one script. Because the script is
  re-runnable, CI can assert that the checked-in manifest equals the one regenerated
  from the current release — the same drift check `dist/` already has.
- A tap is a second repository or a second directory to host. Whichever it is, it is
  public, and it contains no secrets: a URL and a digest.
- The first release after this lands must be verified by an actual install through the
  tap, on a machine that did not build it. A formula that was never installed is a claim.
- If the tap ever needs to diverge from the published asset for any reason, that is the
  signal this ADR was wrong, not a reason to allow one exception.

## Falsification

This ADR is wrong if any of the following is true:

- a manifest compiles or bundles anything
- a manifest's version or digest is edited by hand, or cannot be regenerated from the
  release it names
- a package-manager channel is presented ahead of `git clone` or `install.sh`
- a Windows package manifest ships before a Windows release asset exists
