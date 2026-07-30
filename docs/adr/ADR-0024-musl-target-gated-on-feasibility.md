# ADR-0024: a musl target is gated on a feasibility spike, not assumed

- Status: Accepted (2026-07-31)
- Milestone: M6 · Universal Adoption (Gate B)
- Extends: [ADR-0015](ADR-0015-single-executable-binary.md) (single-executable binary)
- Closes acceptance row: `B-2` in [`../GATE-B-ACCEPTANCE.md`](../GATE-B-ACCEPTANCE.md)

## Context

The published Linux targets are `<arch>-unknown-linux-gnu`: a Node single-executable
binary dynamically linked against glibc's loader. A musl-libc host — Alpine being the
common case — has no `/lib/ld-linux-*.so.*` to load it, and the kernel's refusal to exec
surfaces as a bare `not found`.

**That part is already handled, and this ADR does not reopen it.** `install.sh` executes
the freshly extracted binary before copying it anywhere and, on failure, dies with a
named, attributed message that says musl is the likely cause and points at
install-from-source. The failure is clear; what is absent is an asset.

Two recorded constraints bound anything further, both from the record on
`install.sh`/`.github/workflows/release.yml`:

- publishing a `-musl` target was ruled out **as an installer or CI-verification fix** —
  "a release.yml/build-matrix change … orthogonal to making the existing failure clear
  instead of a raw crash". That rejection is about *justification*, not about the target
  itself. A musl target needs its own grounds, and Gate B is where it can have them.
- the same record states **no Docker in the release build matrix**.

Those two together are why this cannot be a plain implementation ticket. The honest
question is not "should we ship musl" but "**can** a musl-linked Node SEA be produced
under the constraint we have already accepted". A Node SEA embeds the Node binary
itself; a musl-linked one requires a musl-linked Node, and GitHub-hosted runners are
glibc. The candidate routes — an unofficial musl Node build, a static link, a
cross-toolchain, or a non-Docker container step — differ in whether the resulting
binary is one this project is willing to publish, sign for and checksum, not merely in
difficulty.

## Decision

**Gate B does not commit to a musl asset. It commits to deciding the question with
evidence.**

1. A spike ticket produces a recorded answer to one question: can a musl-linked
   single-executable binary be built in the release matrix without Docker, and is its
   provenance one this project can stand behind? The deliverable is a measurement and a
   recommendation, not a target.
2. The spike is allowed to conclude **no**. A recorded "no, for this reason" closes the
   row. An unrecorded "not done" does not.
3. Independent of the spike, and not blocked by it, the compatibility matrix
   (`B-4`) states musl's status as a first-class row rather than leaving it only in a
   README bullet, and the existing clear failure in `install.sh` stays exactly as it is.
4. If the spike concludes yes, publishing the target is a **separate ticket in a later
   wave**, with its own build, checksum and release-matrix change. This ADR does not
   pre-approve it.

## Ruled-out

- **Publish a `-musl` target now and treat it as the Alpine install fix** | still
  rejected, on the recorded grounds: it is a build-matrix change, and the installer gap
  it was offered against is already closed by a clear attributed failure. Nothing found
  since changes that.
- **Add a Docker build step to the release matrix to get a musl toolchain** | the
  recorded constraint says no Docker in the release build matrix. If the spike finds
  Docker is the only viable route, the correct outcome is a recorded "no" plus that
  finding — not a silent exception to a constraint that was written down.
- **Detect musl before download by probing for `/lib/ld-musl-*.so.1`** | already ruled
  out and still wrong: executing the checksum-verified binary catches *any* reason it
  cannot run here, not the one signature this repository happens to know.
- **Declare musl out of scope and delete the row** | the M6 description names musl
  builds. Removing the row would make the gate silent about the platform rather than
  decided about it.
- **Ship an unofficial third-party musl Node build without recording its provenance** |
  the product claim is verifiability. An asset whose base runtime came from an
  unattributed download cannot be defended, and its checksum would prove only that we
  published what we downloaded.

## Consequences

- Gate B may end with no musl asset and still pass this row. The pass condition is a
  recorded decision with its evidence, which is a different and weaker promise than an
  asset — stated here so it is not read as one.
- The spike's negative result, if that is the outcome, becomes the citable reason for
  every future "why not Alpine" question. That is the durable value even in the no case.
- `install.sh` is untouched by this ADR. Its musl behaviour is the current correct
  behaviour, and a spike result of "no" leaves it correct.
- The compatibility matrix row for musl must distinguish **unsupported** from
  **unknown**. After the spike it is unsupported-with-a-reason; before, it is
  unsupported-and-undecided. Those are not the same claim.

## Falsification

This ADR is wrong if any of the following is true:

- a `-musl` asset is published without a recorded feasibility result behind it
- the row is closed with no recorded answer — "we did not get to it" is not a decision
- a Docker step enters the release build matrix without the constraint that forbids it
  being explicitly revisited and superseded
- `install.sh`'s musl failure message is weakened or removed on the grounds that an
  asset is coming
