# PRD F9 — Unified Capture (prepare · verify · stage · MCP write-side)

- Milestone: M5 (post-v0.3.0) · ADR: 0021
- Depends on: ADR-0006 (push injection), P0-3 / P0-4 (acceptance matrix)

## Goal

Close the single largest gap between "works if you know it" and "works by
default": a user-facing `commitlore capture` that builds a verified record
without the user ever typing trailer syntax, and an MCP write-side that gives
every agent the same contract without per-agent prompts.

## Non-goals

- A `commitlore_write_record` MCP tool (forbidden — write tools may touch only
  the pending area, never Git history).
- Any model call or API key inside CommitLore core (the judgement belongs to the
  user's agent session; CommitLore owns everything on either side of it).
- Blocking a commit on verification failure (ADR-0006, ADR-0021).
- A user-editable policy file (Gate B, P1-5).
- Guard integration into the capture pipeline (Gate B). This non-goal stands on its own and
  is not acceptance-matrix row P0-8: that row is the unified `commitlore_before_change`
  query tool, which is a different subject.

## User stories

- As a developer using any agent, I run my normal workflow and commit normally.
  If the session produced a decision worth recording, `commitlore capture`
  (or the MCP tools) stages a verified record into the pending area and the
  `prepare-commit-msg` hook attaches it to my next commit and `post-commit`
  finalises it only after that commit succeeds — I never touch trailer syntax.
- As an agent integration author, I call three MCP tools (`prepare`, `verify`,
  `stage`) and the record appears in the user's commit. I never call a tool
  that writes to Git history.
- As a user whose capture produced nothing (most commits), nothing changes in
  my workflow — no error, no noise, no exit code.

## Requirements

1. **No trailer syntax exposure.** The user never types, edits, or sees trailer
   format during normal operation. The capture pipeline produces the trailer
   block internally.

2. **Most commits produce nothing.** Capture is optional enrichment. When no
   decision was made, or no evidence supports one, the pipeline exits silently
   with zero records. This is the normal, majority case.

3. **At most one record per commit.** The hardcoded default
   `max_records_per_commit: 1` is enforced at stage time. A pipeline that
   produces multiple candidate records must select or discard before staging.

4. **Evidence is verified mechanically.** Every record's evidence citations are
   checked against the actual transcript and diff by deterministic string/hash
   comparison (`src/core/harvest-verify.ts` `verifyDraft`). No citation is ever
   trusted from the draft without this check.

5. **Transcript is attacker-influenced input.** The transcript is produced by
   an LLM session whose prompt may contain injected instructions. The verifier
   must therefore treat the transcript as untrusted input and verify that
   quoted evidence actually appears verbatim in the source material. A record
   whose citations do not match is discarded, not repaired. Prompt injection
   that manufactures a plausible-but-false quote is caught by the verbatim
   match requirement. A prompt injection that causes the *agent* to produce a
   fabricated transcript quote that *does* appear (because the agent wrote it
   into the transcript) is outside scope: the verifier checks the quote exists
   in the transcript, not that the transcript is trustworthy — that boundary
   belongs to the agent runtime, not to CommitLore.

6. **No `commitlore_write_record` tool.** The MCP write-side exposes exactly
   three tools (`commitlore_prepare_capture`, `commitlore_verify_capture`,
   `commitlore_stage_capture`). None writes to Git history. All three write
   only to `.git/commitlore/pending/`.

7. **MCP write tools touch only the pending transaction.** `prepare` creates
   the nonce transaction, `verify` stores its verified result, and `stage`
   advances that stored result. All three therefore use `readOnlyHint: false`,
   `destructiveHint: false`, and `openWorldHint: false`, and may create or
   update files only under `.git/commitlore/pending/`.

8. **The final commit stays with the user's existing workflow.** CommitLore
   does not run `git commit`. The `prepare-commit-msg` hook attaches the record
   only when the user (or their agent) commits through their normal path.

9. **CommitLore core makes no model call and needs no API key.** All
   intelligence is delegated to the user's agent session via the prompt
   contract (`buildHarvestPrompt` in `src/core/harvest.ts`). The CLI and MCP
   server contain only deterministic logic.

10. **Verification failure never blocks a commit.** If all records are
    discarded, the pipeline writes a pending file with an empty records array.
    The hook finds nothing to attach and the commit proceeds normally.

11. **Successful-commit consumption semantics.** `prepare-commit-msg` may apply
    a record but must not consume it. `post-commit` consumes it only after Git
    creates the commit and the committed parent, tree, message, and record ids
    match the prepared transaction. A failed commit leaves the record retriable.

12. **Wrong-target prevention.** The five-gate check (HEAD unchanged, staged
    diff unchanged, unexpired, unconsumed, policy unchanged) ensures a pending
    record never attaches to a different commit than the one it was prepared
    for.

13. **Record validity and deterministic collision checks are part of
    verification.** The verifier rejects unknown keys, invalid value grammar,
    unsupported `Ruled-out` claims, duplicate `Record-Id` values, and a
    candidate whose canonical key/value/scope tuple duplicates an active
    record. It does not claim to detect paraphrased semantic overlap without a
    model; the result reports that boundary as `canonical_exact_only`. If
    active records cannot be read (for example, notes are unfetched),
    verification returns incomplete and stages no record.

14. **Verification cannot be bypassed between MCP calls.** The transaction
    moves monotonically `prepared -> verified -> staged -> applied ->
    consumed`. `stage` accepts only the nonce and reads the server-stored
    verified result. It never accepts records, evidence hashes, or a claimed
    verification result from the caller.

## AC

- [ ] `commitlore capture` composes prepare → verify → stage and produces a
  pending file when evidence is available, or exits 0 with no file when it is
  not.
- [ ] A pending record is consumed by the next commit only when all five
  binding conditions hold; otherwise the commit proceeds with no record.
- [ ] A fabricated evidence citation (quote not in transcript or diff) causes
  the record to be discarded, not attached.
- [ ] Invalid grammar, an unsupported rejection claim, a duplicate record id,
  or a canonical duplicate of an active record is discarded. An unavailable
  active-record source reports incomplete and stages nothing.
- [ ] A commit that fails after `prepare-commit-msg` leaves the pending record
  unconsumed; a successful commit finalises it through `post-commit`.
- [ ] MCP `commitlore_prepare_capture` / `commitlore_verify_capture` /
  `commitlore_stage_capture` produce the same outcome as the CLI pipeline.
- [ ] No tool named `commitlore_write_record` exists after implementation.
- [ ] Calling `stage` with an unverified nonce fails closed, and its input
      schema has no record/evidence fields that could bypass `verify`.
- [ ] The existing test baseline (45 files / 1500 passed / 1 skipped) is
  preserved. `npx tsc -p tsconfig.json --noEmit` and
  `npx tsc -p bench/tsconfig.json --noEmit` both exit 0.
