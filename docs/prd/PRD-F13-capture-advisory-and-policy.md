# PRD F13 — Capture advisory and policy resolution (the two items Gate A deferred)

- Milestone: M6 · ADR: 0020 (guard is an experimental advisory), 0021 (capture pending
  transaction), 0006 (push injection)
- Acceptance rows: `B-6`, `B-7` in [`../GATE-B-ACCEPTANCE.md`](../GATE-B-ACCEPTANCE.md)

## Authority, and one attribution this document must not get wrong

The two items here were deferred to Gate B by `PRD-F9-unified-capture.md`'s "Non-goals",
and they are deferred on **different** grounds:

- **Guard integration into the capture pipeline** is a non-goal that stands on its own.
  PRD-F9 states, in the same bullet, that it "is not acceptance-matrix row `P0-8`: that
  row is the unified `commitlore_before_change` query tool, which is a different subject."
  `P0-8` was closed in Gate A by T-1024 (#219). **Nothing in this document closes `P0-8`.**
- **The user-editable policy file** *is* acceptance-matrix row `P1-5`, cited as explicitly
  Gate B in ADR-0021 §7 and in PRD-F9's "Non-goals".

The distinction is recorded here because an earlier session attributed capture-pipeline
guard integration to `P0-8`, and `GATE-A-ACCEPTANCE.md` had to correct three rows whose
subject had been reconstructed from where a label was cited. Repeating that attribution
would recreate a row that does not exist.

## Goal

Close the two deferred items without weakening either property Gate A established: guard
is an advisory that cannot block, and the pending transaction's format does not break.

## Non-goals

- Improving guard's accuracy. ADR-0020's measured precision 44.8% / recall 22.0% is the
  number this PRD works with, not a number it moves.
- Letting guard block anything — a capture, a stage, a commit, or a push (ADR-0020,
  ADR-0006, `bench/GUARD-CANNOT-BLOCK.md`).
- Any change to the `commitlore_before_change` tool T-1024 shipped. That is a closed row.
- A policy schema beyond the three keys that already exist in the hardcoded defaults.
  Adding a fourth key is a later decision, not part of shipping the file.
- Changing the pending format version. ADR-0021 already fixed the migration so that no
  version bump is needed; producing one would falsify that ADR.
- Any model call, any network call.

## User stories

- As an agent capturing a decision, I see that the approach I described matches a
  previously ruled-out alternative, in the same output I already read — and my capture
  still completes, because the match is information, not a gate.
- As a user who wants one record per commit but two on this repository, I edit one file
  rather than rebuilding the tool.
- As a user who upgrades between staging a capture and committing it, the hook tells me
  the policy changed underneath, exactly as it already does for the hardcoded defaults.

## Requirements

### Guard as a capture advisory (B-6)

1. When a capture is prepared, guard runs against the drafted record's own text and the
   paths the staged diff touches, and its matches are attached to the pending record as an
   advisory field.
2. The advisory field is additive. No existing field changes meaning, and a pending record
   written without it stays readable.
3. A guard match at **any** score leaves the exit code, the `phase`, and every gate
   decision identical to a run with no match. A test asserts this by running the same
   capture with the guard match forced on and off and comparing everything except the
   advisory field.
4. The advisory carries guard's measured precision and recall wherever it is displayed, in
   the same form ADR-0020 requires of every other guard surface. An empty advisory is
   never rendered as "no ruled-out alternative applies".
5. Guard failing — for any reason, including a missing index — degrades the advisory to a
   recorded "could not check, and why". It never fails the capture.
6. The advisory states what it could not see, reusing the closed gap vocabulary T-1024
   already fixed (`history-unavailable`, `shallow-history`, `notes-unfetched`) rather than
   inventing a second one.

### User-editable policy file (B-7, row `P1-5`)

7. **Before the policy input changes, the three duplicated definitions of it are
   consolidated into one.** At `e2b5725`, `computePolicyIdentityHash` and its defaults
   object exist independently in `src/core/capture-prepare.ts`,
   `src/core/capture-stage.ts` and `src/hooks/prepare-commit-msg.ts` — under two different
   constant names — and agree only because the three object literals happen to list the
   same keys in the same order, which is what `JSON.stringify` hashes. A test asserts the
   three call sites resolve to one implementation.
8. The policy file is optional. With no file present, resolution produces exactly today's
   hardcoded defaults and exactly today's identity hash, so an existing pending record
   remains valid.
9. With a file present, the identity hash input becomes the file's contents, per
   ADR-0021: `sha256(policy-file-contents)` replaces `sha256(hardcoded-defaults-json)`.
   The pending record's `version` stays `1`.
10. An invalid policy file is a named, actionable error that leaves the previous behaviour
    in place. It is never silently ignored, and it never falls back to defaults without
    saying so — a silent fallback would make the identity hash lie about which policy ran.
11. The file is read from one location, resolved the same way in the CLI and in the hook.
    A repository-local file and a user-global file may not both apply in the same run
    without a stated precedence, and that precedence is asserted by a test.
12. The policy file is untrusted input. It may set only the declared keys, and a key it
    does not declare is rejected rather than merged. It may not influence any path
    resolution, any command execution, or anything that touches Git history.
13. The stage-to-commit mismatch behaviour already implemented for a defaults change
    applies unchanged when the change came from the file: the hook detects a differing
    identity hash and reports it.

## Verification

Requirement 3 is the load-bearing one and is verified by differential test, not by
inspection: the same capture, guard forced to match and forced not to match, everything
but the advisory field identical. Requirement 7 is verified by a test that would fail if a
fourth copy of the policy definition were introduced.
