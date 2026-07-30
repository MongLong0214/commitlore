# F9 tickets — Unified Capture (M5)

> PRD: `docs/prd/PRD-F9-unified-capture.md` · ADR: 0021
> Modules: `src/core/pending.ts` (new), `src/commands/capture.ts` (new), `src/hooks/prepare-commit-msg.ts`, `src/hooks/post-commit.ts` (new), `src/mcp/server.ts`

---

## T-1001 Pending transaction store (M) — #193 · depends on nothing

**Owns**: `src/core/pending.ts` (new file), `test/pending.test.ts` (new file).

**Depends on**: None.

**Forbidden scope**: Release gate, `bench/fixtures/`, `README*`, any version string, `src/mcp/server.ts`, `src/hooks/prepare-commit-msg.ts`, `src/commands/`.

**RED test**: `test/pending.test.ts` — "createPending creates a phase-prepared JSON file under .git/commitlore/pending/ with all required fields". Must fail before the change because `src/core/pending.ts` does not exist and no `createPending` function is exported.

**Minimum GREEN**: Export `createPending(opts): string` (returns nonce), `readPending(nonce): PendingRecord | null`, `storeVerification(nonce, result): boolean`, `stagePending(nonce): boolean`, `markApplied(nonce, recordHash): boolean`, and `consumePending(nonce, commitSha): boolean` from `src/core/pending.ts`. Every mutation is an atomic rename and enforces the monotonic phase transition from ADR-0021. `createPending` writes `phase:"prepared"` and source/state hashes. `readPending` returns `null` only when the file is absent; corrupt or unknown-version content raises a typed `PendingFormatError`. `storeVerification` is the only API that may write accepted records/evidence. `stagePending` accepts a nonce only. `markApplied` records `applied_at` and `applied_record_hash` for the canonical trailer block, not the editable subject/body. `consumePending` may set `consumed:true` and `consumed_by` only for an applied record.

**Path resolution — resolve `.git/commitlore/pending/` via `git rev-parse --git-path commitlore/pending`, never via `path.join(cwd, '.git', ...)`.** This codebase already has the precedent: `src/core/index-db.ts:325` ("`--git-path` is what makes this correct") and `src/hooks/prepare-commit-msg.ts:27,75` both resolve git-internal paths this way. A linked worktree's `.git` is a *file* containing a pointer, not a directory — naive string-joining breaks there, and it is the exact case ADR-0021 claims this format handles ("It is per-worktree and per-clone"). Writing the path the same way the rest of the codebase already does is not optional.

**AC <-> test**:

| AC | Test | PRD-F9 requirement |
|---|---|---|
| File written with all ADR-0021 §2 fields | `writes all required fields` | 11 (single-consumption) |
| Atomic write (no partial file observable) | `concurrent read during write sees old or new, never partial` | 12 (wrong-target prevention) |
| Phase transitions are monotonic | `prepared -> verified -> staged -> applied -> consumed; skips rejected` | 14 |
| Caller cannot inject records at stage | `stagePending accepts nonce only and uses stored verification` | 14 |
| markApplied never consumes | `mark applied leaves consumed:false` | 11 |
| consumePending requires applied state and commit SHA | `unapplied consume is rejected` | 11 |
| consumePending sets consumed:true exactly once | `double consume returns false` | 11 |
| readPending distinguishes absent from invalid | `missing returns null; corrupt/version 2 throws PendingFormatError` | — (diagnostic honesty) |

**Commands**:
- Focused: `npx vitest run test/pending.test.ts`
- Full suite: `npx vitest run` → 45+ files, 1500+ passed, 1 skipped
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0

**Evidence invalidation**: All evidence is bound to the exact HEAD SHA at the time of test execution and is void if the branch moves.

**Stop / escalate**: Stop if (a) `.git/commitlore/` is not gitignored, (b) `node:fs` atomic-rename semantics differ on a CI platform from local, (c) any existing test fails after adding the new module.

**Safety checks**:
- Fail-closed: `readPending` returns `null` only for missing state and raises a typed error for corrupt/unknown-version state; the hook catches it, reports incomplete, and proceeds without attaching a record.
- Wrong-target: the `base_head` field is mandatory; `createPending` throws if HEAD cannot be resolved.
- Ambiguity: nonce collision probability is 2^-128 per file; no deduplication logic needed.
- Timeout: `expires_at` is always written; no file is valid without it.
- Partial state: atomic rename ensures the file is either fully written or absent.
- Privacy: no transcript content is stored in the pending file — only hashes and trailer blocks.
- Prompt injection: not applicable at this layer (no transcript parsing here).

**Completion evidence**: Paste output of `npx vitest run test/pending.test.ts` showing all assertions pass, plus `npx tsc -p tsconfig.json --noEmit` exit 0.

---

## T-1002 Prepare phase (M) — #194 · depends on T-1001

**Owns**: `src/core/capture-prepare.ts` (new file), `test/capture-prepare.test.ts` (new).

**Depends on**: T-1001.

**Forbidden scope**: Release gate, `bench/fixtures/`, `README*`, any version string, `src/mcp/server.ts`, `src/hooks/prepare-commit-msg.ts`.

**RED test**: `test/capture-prepare.test.ts` — "prepareCaptureContext returns a nonce, prompt contract, base_head, staged_diff_hash, and staged_tree_oid". Must fail before the change because `src/core/capture-prepare.ts` does not exist.

**Minimum GREEN**: Export `prepareCaptureContext(opts: { cwd: string, transcript: string }): PrepareResult` that:
1. Generates a nonce via `crypto.randomBytes(16)`.
2. Resolves HEAD → `base_head`.
3. Computes `sha256(git diff --cached)` → `staged_diff_hash`.
4. Resolves `git write-tree` → `staged_tree_oid`.
5. Computes `sha256(transcript)` and the canonical diff source hash.
6. Calls `buildHarvestPrompt` from `src/core/harvest.ts` to produce the prompt contract.
7. Computes `policy_identity_hash` from the hardcoded defaults.
8. Calls `createPending` to persist the `phase:"prepared"` transaction.
9. Returns `{ nonce, base_head, staged_diff_hash, staged_tree_oid, policy_identity_hash, source_hashes, prompt }`.

**AC <-> test**:

| AC | Test | PRD-F9 requirement |
|---|---|---|
| Nonce is 32 hex chars | `nonce format` | 11 |
| base_head matches current HEAD | `base_head equals git rev-parse HEAD` | 12 |
| staged_diff_hash is sha256 of cached diff | `staged_diff_hash matches manual computation` | 12 |
| staged_tree_oid matches the staged tree | `staged_tree_oid equals git write-tree` | 11, 12 |
| policy_identity_hash is deterministic | `same defaults produce same hash across calls` | 12 |
| prompt contains harvest contract fields | `prompt includes Record-Id instruction` | 9 |
| max_records_per_commit: 1 is enforced upstream | `prompt states maximum one record` | 3 |
| Prepare persists only hashes, not transcript | `prepared file has source_hashes and no raw source` | 5, 7, 14 |

**Commands**:
- Focused: `npx vitest run test/capture-prepare.test.ts`
- Full suite: `npx vitest run` → 45+ files, 1500+ passed, 1 skipped
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0

**Evidence invalidation**: All evidence is bound to the exact HEAD SHA at the time of test execution and is void if the branch moves.

**Stop / escalate**: Stop if (a) `buildHarvestPrompt` signature has changed since last read, (b) `git diff --cached` produces non-deterministic output for the same staged content (encoding issues), (c) the prompt contract's content exceeds what a single MCP tool result can carry (~100KB).

**Safety checks**:
- Fail-closed: if HEAD cannot be resolved (detached HEAD with no ref), throw rather than produce an invalid prepare result.
- Wrong-target: `base_head` is the full 40-char SHA, never abbreviated.
- Ambiguity: the prompt contract must state "at most one record" unambiguously.
- Timeout: not applicable (prepare does not write a pending file).
- Partial state: `createPending` is atomic; a crash leaves either no file or a complete prepared transaction that expires.
- Privacy: the prompt contract references the diff and transcript but does not embed them.
- Prompt injection: the prompt contract is generated by CommitLore, not read from user input.

**Completion evidence**: Paste output of `npx vitest run test/capture-prepare.test.ts` showing all assertions pass, plus `npx tsc -p tsconfig.json --noEmit` exit 0.

---

## T-1003 Verify phase (M) — #195 · depends on T-1001, T-1002

**Owns**: `src/core/capture-verify.ts` (new file), `test/capture-verify.test.ts` (new).

**Depends on**: T-1001, T-1002 (for the PrepareResult shape and nonce).

**Forbidden scope**: Release gate, `bench/fixtures/`, `README*`, any version string, `src/mcp/server.ts`, `src/hooks/prepare-commit-msg.ts`.

**RED test**: `test/capture-verify.test.ts` — "verifyCaptureRecords discards a record whose evidence quote is not in the transcript". Must fail before the change because `src/core/capture-verify.ts` does not exist.

**Minimum GREEN**: Export `verifyCaptureRecords(opts: { nonce: string, draft: DraftRecord[], transcript: string, diff: string, cwd: string }): VerifyCaptureResult` that:
1. Delegates to the existing `verifyDraft` from `src/core/harvest-verify.ts` for each record.
2. Therefore preserves its grammar, vocabulary, evidence, and `Ruled-out` rejection-context checks.
3. Reads active records for `cwd`; rejects duplicate `Record-Id` values and canonical duplicates with the same normalized key/value/scope tuple.
4. Reports `overlap_check: "canonical_exact_only"` and never claims paraphrased semantic equivalence was checked.
5. If active records cannot be read completely (including unfetched notes), returns `validation_result: "empty"` with `incomplete: true` and the reason; it does not stage a record.
6. Discards records that fail verification, logging the reason.
7. Re-reads the prepared transaction and rejects a source-hash, HEAD, staged-diff, staged-tree, or policy mismatch.
8. Calls `storeVerification(nonce, result)` so the verified result is bound to the server-side transaction; no caller replay is authoritative.
9. Returns `{ accepted, rejected, validation_result, incomplete, overlap_check }` where `validation_result` is `"pass"` (all accepted), `"partial"` (some rejected), or `"empty"` (all rejected).
10. Never throws on a record-verification failure — stores/returns `"empty"` instead.
11. Never blocks: an empty or incomplete result is a valid outcome, not an error.

**AC <-> test**:

| AC | Test | PRD-F9 requirement |
|---|---|---|
| Fabricated quote is discarded | `rejects record with quote not in transcript` | 4, 5 |
| Valid quote is accepted | `accepts record with verbatim transcript quote` | 4 |
| All-rejected returns validation_result "empty" | `all fabricated → empty` | 2, 10 |
| Never throws | `corrupt input returns empty, does not throw` | 10 |
| Diff evidence checked against diff, not transcript | `diff quote checked in diff source` | 4 |
| Prompt-injection: injected instruction in transcript does not bypass check | `transcript containing "ignore verification" still requires verbatim match` | 5 |
| Invalid grammar is discarded | `invalid Ruled-out grammar is rejected` | 13 |
| Mention without rejection is discarded | `Ruled-out mention-only draft is rejected` | 13 |
| Existing Record-Id is discarded | `duplicate id against active records is rejected` | 13 |
| Canonical duplicate is discarded | `same normalized key/value/scope is rejected` | 13 |
| Paraphrase boundary is honest | `result says canonical_exact_only` | 13 |
| Unfetched notes cannot read as clean | `unfetched notes returns incomplete and empty` | 13 |
| Source/state substitution is rejected | `changed transcript/diff/HEAD/tree/policy cannot update transaction` | 12, 14 |
| Result is stored server-side | `transaction phase becomes verified with exact accepted records` | 14 |

**Commands**:
- Focused: `npx vitest run test/capture-verify.test.ts`
- Full suite: `npx vitest run` → 45+ files, 1500+ passed, 1 skipped
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0

**Evidence invalidation**: All evidence is bound to the exact HEAD SHA at the time of test execution and is void if the branch moves.

**Stop / escalate**: Stop if (a) `verifyDraft` from `src/core/harvest-verify.ts` changes its interface, (b) a test for "never throws" actually observes an unhandled exception from a dependency, (c) the DraftRecord type changes shape between T-1002 and this ticket.

**Safety checks**:
- Fail-closed: any ambiguity in matching (partial quote, off-by-one in locator) results in discard, not acceptance.
- Wrong-target: verification reads active records from the same `cwd` captured by prepare; HEAD/staged-state binding remains T-1005's job.
- Ambiguity: a quote that appears multiple times in the transcript is accepted (it exists); uniqueness is not required.
- Timeout: verification is deterministic string matching with no I/O beyond reading the inputs already in memory.
- Partial state: verify is pure computation; no file writes, no cleanup needed.
- Privacy: rejected records are logged to stderr with the rejection reason only, never the quote content.
- Prompt injection: the transcript is treated as untrusted input. The verifier checks that quotes exist verbatim — it does not interpret instructions found in the transcript.

**Completion evidence**: Paste output of `npx vitest run test/capture-verify.test.ts` showing all assertions pass, plus `npx tsc -p tsconfig.json --noEmit` exit 0.

---

## T-1004 Stage phase (S) — #196 · depends on T-1001, T-1002, T-1003

**Owns**: `src/core/capture-stage.ts` (new file), `test/capture-stage.test.ts` (new).

**Depends on**: T-1001, T-1002, T-1003.

**Forbidden scope**: Release gate, `bench/fixtures/`, `README*`, any version string, `src/mcp/server.ts`, `src/hooks/prepare-commit-msg.ts`.

**RED test**: `test/capture-stage.test.ts` — "stageCaptureRecord writes a pending file with expiry and records". Must fail before the change because `src/core/capture-stage.ts` does not exist.

**Minimum GREEN**: Export `stageCaptureRecord(opts: { nonce: string, cwd: string, expiryMinutes?: number }): string | null` that:
1. Re-reads the transaction by nonce and requires `phase:"verified"`.
2. If stored `validation_result === "empty"` or `incomplete === true`, returns `null` (nothing to stage).
3. If the stored accepted-record count exceeds `max_records_per_commit`, throws.
4. Rechecks HEAD, staged diff, staged tree, and policy identity.
5. Calls `stagePending(nonce)`; it never accepts records/evidence from the caller.
6. Returns the nonce on success.
Default expiry: 5 minutes.

**AC <-> test**:

| AC | Test | PRD-F9 requirement |
|---|---|---|
| Pending file written with correct fields | `file contains base_head, staged_diff_hash, staged_tree_oid, expires_at` | 11, 12 |
| Empty verify result writes no file | `validation_result empty → returns null` | 2, 10 |
| Max records enforced | `>1 record throws` | 3 |
| Expiry defaults to 5 minutes from now | `expires_at is ~5min after created_at` | 11 |
| evidence_hash is deterministic | `same evidence → same hash` | 12 |
| Unverified nonce cannot stage | `prepared nonce is rejected` | 14 |
| Caller cannot substitute payload | `stage input has nonce only` | 14 |

**Commands**:
- Focused: `npx vitest run test/capture-stage.test.ts`
- Full suite: `npx vitest run` → 45+ files, 1500+ passed, 1 skipped
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0

**Evidence invalidation**: All evidence is bound to the exact HEAD SHA at the time of test execution and is void if the branch moves.

**Stop / escalate**: Stop if (a) the T-1001 transaction transition APIs change, (b) the max-records cap should be configurable (it should not — hardcoded per P1-5), (c) expiry duration needs to be configurable before Gate B.

**Safety checks**:
- Fail-closed: if `stagePending` throws (disk full, permissions, invalid phase), propagate — never report staged without persisting the transition.
- Wrong-target: `base_head`, `staged_diff_hash`, and `staged_tree_oid` are copied from the PrepareResult, binding the record to that exact state and giving `post-commit` a committed-tree identity.
- Ambiguity: `null` return is unambiguous "nothing staged"; a thrown error is unambiguous "staging failed".
- Timeout: the 5-minute expiry is set here; the hook enforces it.
- Partial state: the verified-to-staged transition is an atomic rename; a crash leaves the transaction wholly verified or wholly staged.
- Privacy: no transcript content is stored — only trailer blocks and evidence hashes.
- Prompt injection: not applicable (no transcript parsing at this layer).

**Completion evidence**: Paste output of `npx vitest run test/capture-stage.test.ts` showing all assertions pass, plus `npx tsc -p tsconfig.json --noEmit` exit 0.

---

## T-1005 prepare-commit-msg application guard (M) — #197 · depends on T-1001, T-1004

**Owns**: `src/hooks/prepare-commit-msg.ts` (modify: add application path), `test/prepare-commit-msg-capture.test.ts` (new).

**Depends on**: T-1001, T-1004.

**Forbidden scope**: Release gate, `bench/fixtures/`, `README*`, any version string, `src/mcp/server.ts`, existing `preserveSquashRecords` logic (must not regress).

**RED test**: `test/prepare-commit-msg-capture.test.ts` — "hook appends trailer block from pending file when all five conditions hold". Must fail before the change because `src/hooks/prepare-commit-msg.ts` has no code path that reads `.git/commitlore/pending/`.

**Minimum GREEN**: Add to the existing `prepare-commit-msg` action (after `preserveSquashRecords`):
1. Scan `.git/commitlore/pending/` for unconsumed, unexpired files.
2. For each candidate, check the five conditions (ADR-0021 §3): HEAD unchanged, staged diff unchanged, unexpired, unconsumed, policy unchanged.
3. On first file passing all five: append the record trailer block to the message file unless its `Record-Id` is already present; only after that write succeeds, call `markApplied(nonce, sha256(canonicalRecordBlock))`; stop. Do not hash the whole message because the user may still edit its subject/body.
4. On no match: do nothing, exit 0.
5. Never call `consumePending`; successful-commit finalisation belongs to T-1018.
6. On any error in the application path: log to stderr, exit 0 (never block).

**AC <-> test**:

| AC | Test | PRD-F9 requirement |
|---|---|---|
| All five conditions pass → record appended and prepared | `happy path appends trailers and leaves consumed:false` | 8, 11 |
| HEAD changed → no record | `different HEAD skips pending` | 12 |
| Staged diff changed → no record | `modified staging skips pending` | 12 |
| Expired file → no record | `expired pending is skipped` | 11 |
| Already consumed → no record | `consumed:true is never re-applied` | 11 |
| Policy hash changed → no record | `policy mismatch skips pending` | 12 |
| Existing Record-Id is not appended twice | `retry message containing id stays byte-identical` | 11 |
| Failed candidate commit remains retriable | `prepare leaves consumed:false` | 11 |
| Error in scan → exit 0 | `corrupt JSON in pending dir does not block` | 10 |
| Existing squash-preserve still works | `preserveSquashRecords path unchanged` | — (regression) |

**Commands**:
- Focused: `npx vitest run test/prepare-commit-msg-capture.test.ts`
- Full suite: `npx vitest run` → 45+ files, 1500+ passed, 1 skipped
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0

**Evidence invalidation**: All evidence is bound to the exact HEAD SHA at the time of test execution and is void if the branch moves.

**Stop / escalate**: Stop if (a) modifying `prepare-commit-msg.ts` causes any existing test in `test/hooks/` to fail, (b) the hook's action function signature needs to change (it currently takes `messageFile: string`), (c) git's `prepare-commit-msg` hook semantics differ from what ADR-0021 assumes (e.g., the hook runs before the staged diff is finalised on some git version).

**Safety checks**:
- Fail-closed: any exception in the new code path logs to stderr and exits 0. The commit proceeds.
- Wrong-target: the HEAD and staged-diff checks are mandatory; if either fails, the record is not attached.
- Ambiguity: at most one pending file is applied per hook invocation (first-match wins, ordered by `created_at`).
- Timeout: expired files are skipped, never prepared.
- Partial state: message write precedes `markApplied`. A crash before the message write changes nothing; a crash after the write but before marking may leave an unfinalised staged record, but it never marks an absent record consumed.
- Privacy: the trailer block (not the evidence quotes) is appended to the commit message. No transcript content is copied.
- Prompt injection: the hook reads only the pending file's `records[].trailers` (structured data), never raw transcript text.

**Completion evidence**: Paste output of `npx vitest run test/prepare-commit-msg-capture.test.ts` showing all assertions pass, plus full suite still at 45+ files / 1500+ passed / 1 skipped, plus `npx tsc -p tsconfig.json --noEmit` exit 0.

---

## T-1006 `commitlore capture` CLI (M) — #198 · depends on T-1002, T-1003, T-1004

**Owns**: `src/commands/capture.ts` (new file), `test/capture.test.ts` (new).

**Depends on**: T-1002, T-1003, T-1004.

**Forbidden scope**: Release gate, `bench/fixtures/`, `README*`, any version string, `src/mcp/server.ts`, `src/hooks/prepare-commit-msg.ts`.

**RED test**: `test/capture.test.ts` — "commitlore capture --transcript <f> --diff <f> --draft <f> produces a pending file". Must fail before the change because no `capture` command is registered in the CLI.

**Minimum GREEN**: Register `commitlore capture` with options `--transcript <f>`, `--diff <f>`, `--draft <f>`, `--out <f>` (optional), `--json` (optional). The command:
1. Calls `prepareCaptureContext({ cwd })` (T-1002).
2. If `--draft` is provided, calls `parseDraft` then `verifyCaptureRecords` (T-1003) with the transcript and diff.
3. If `--draft` is not provided, prints the prompt contract to stdout (same as `harvest --prompt-only`) and exits 0.
4. Calls `stageCaptureRecord` (T-1004) with the prepare + verify results.
5. Prints the nonce (or "no record staged") and exits 0.
Exit codes: 0 always (success or no-record). 2 only for usage errors (missing required file, unreadable path).

**AC <-> test**:

| AC | Test | PRD-F9 requirement |
|---|---|---|
| Full pipeline produces pending file | `capture with valid draft stages a pending record` | 1, 8 |
| No draft → prompt-only mode | `capture without --draft prints prompt` | 9 |
| Fabricated draft → no pending file | `capture with bad evidence stages nothing` | 4, 10 |
| Exit 0 in all non-usage-error cases | `no-record case exits 0` | 2 |
| --json prints structured output | `--json output matches schema` | — (UX) |
| Usage error exits 2 | `missing --transcript exits 2` | — (contract) |

**Commands**:
- Focused: `npx vitest run test/capture.test.ts`
- Full suite: `npx vitest run` → 45+ files, 1500+ passed, 1 skipped
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0

**Evidence invalidation**: All evidence is bound to the exact HEAD SHA at the time of test execution and is void if the branch moves.

**Stop / escalate**: Stop if (a) the CLI registration pattern (commander `program.command`) conflicts with an existing command name, (b) `parseDraft` or `buildHarvestPrompt` interfaces have diverged from what T-1002/T-1003 expect, (c) the command needs to call a model (it must not — PRD-F9 requirement 9).

**Safety checks**:
- Fail-closed: any internal error in prepare/verify/stage is caught; the command prints a diagnostic to stderr and exits 0 (never blocks a workflow).
- Wrong-target: the PrepareResult binds to the current HEAD; if HEAD moves between prepare and stage within the same invocation, stage will write a pending file that the hook will correctly reject.
- Ambiguity: the command either stages one record or stages none. There is no partial-stage state.
- Timeout: not applicable (expiry is set by stage, not by the CLI).
- Partial state: if the process is killed between verify and stage, no pending file exists (stage has not run).
- Privacy: the command reads the transcript and diff from files the user provides; it does not copy transcript content into the pending file beyond verified trailer blocks.
- Prompt injection: the command does not interpret the transcript content — it passes it to the verifier, which treats it as untrusted.

**Completion evidence**: Paste output of `npx vitest run test/capture.test.ts` showing all assertions pass, plus `npx tsc -p tsconfig.json --noEmit` exit 0.

---

## T-1007 MCP `commitlore_prepare_capture` (S) — #199 · depends on T-1002

**Merge sequencing**: T-1007, T-1008, T-1009 and T-1020 (F11) all edit
`src/mcp/server.ts`. Merge strictly in that order; do not open a second PR
against this file while one of the four is unmerged. See
`docs/GATE-A-ACCEPTANCE.md` "Execution constraint".

**Owns**: `src/mcp/server.ts` (add tool declaration + handler for `commitlore_prepare_capture`), `test/mcp-capture.test.ts` (new or added to existing `test/mcp.test.ts`).

**Depends on**: T-1002.

**Forbidden scope**: Release gate, `bench/fixtures/`, `README*`, any version string, existing MCP tool declarations (must not alter `commitlore_query`, `commitlore_stale`, `commitlore_guard`), `src/hooks/`.

**RED test**: `test/mcp-capture.test.ts` — "calling commitlore_prepare_capture returns a nonce and prompt contract". Must fail before the change because the tool is not registered in `TOOLS` array (`src/mcp/server.ts`).

**Minimum GREEN**: Add to `src/mcp/server.ts`:
1. A tool declaration `commitlore_prepare_capture` with `inputSchema` accepting `{ transcript: string }` and annotations `{ readOnlyHint: false, destructiveHint: false, openWorldHint: false }`.
2. A handler that calls `prepareCaptureContext({ cwd: root, transcript })`, persists the prepared transaction, and returns its nonce, state/source hashes, and prompt as JSON text content.

**AC <-> test**:

| AC | Test | PRD-F9 requirement |
|---|---|---|
| Tool registered with correct annotations | `ListTools includes commitlore_prepare_capture with readOnlyHint:false` | 6, 7 |
| Returns nonce and prompt | `CallTool returns JSON with nonce and prompt fields` | 9 |
| No commitlore_write_record tool exists | `ListTools does not include commitlore_write_record` | 6 |
| Existing tools unchanged | `commitlore_query still has readOnlyHint:true` | 7 |

**Commands**:
- Focused: `npx vitest run test/mcp-capture.test.ts` (or `npx vitest run test/mcp.test.ts` if co-located)
- Full suite: `npx vitest run` → 45+ files, 1500+ passed, 1 skipped
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0

**Evidence invalidation**: All evidence is bound to the exact HEAD SHA at the time of test execution and is void if the branch moves.

**Stop / escalate**: Stop if (a) adding a tool to `TOOLS` changes the existing tool indices and breaks snapshot tests, (b) the `Server` class from `@modelcontextprotocol/sdk` requires Zod for tool input validation (it should not — ADR-0021 uses JSON Schema directly per the existing pattern in `server.ts`), (c) any existing MCP test fails.

**Safety checks**:
- Fail-closed: if `prepareCaptureContext` throws (e.g., not a git repo), the tool returns an `isError: true` result, never crashes the server.
- Wrong-target: the tool reads the current repository state; if called outside a git repo it errors cleanly.
- Ambiguity: the tool always returns a JSON object; empty results are `{ nonce, prompt }` — never a bare string.
- Timeout: not applicable (prepare is fast, no I/O beyond git).
- Partial state: prepare atomically creates one complete transaction; a crash leaves no file or a complete expiring prepared file.
- Privacy: the prompt contract does not embed the transcript or diff — only instructions for the agent.
- Prompt injection: the tool produces output (a prompt contract) that will be read by the calling agent. The contract is generated by CommitLore (trusted), not derived from user or transcript input.

**Completion evidence**: Paste output of focused test showing pass, plus `npx tsc -p tsconfig.json --noEmit` exit 0.

---

## T-1008 MCP `commitlore_verify_capture` (S) — #200 · depends on T-1003

**Merge sequencing**: merges after T-1007, before T-1009. See
`docs/GATE-A-ACCEPTANCE.md` "Execution constraint".

**Owns**: `src/mcp/server.ts` (add tool declaration + handler for `commitlore_verify_capture`), `test/mcp-capture.test.ts` (extend).

**Depends on**: T-1003.

**Forbidden scope**: Release gate, `bench/fixtures/`, `README*`, any version string, existing MCP tool declarations (must not alter `commitlore_query`, `commitlore_stale`, `commitlore_guard`), `src/hooks/`.

**RED test**: `test/mcp-capture.test.ts` — "calling commitlore_verify_capture with a draft and transcript returns validation_result". Must fail before the change because the tool is not registered.

**Minimum GREEN**: Add to `src/mcp/server.ts`:
1. A tool declaration `commitlore_verify_capture` with `inputSchema` accepting `{ nonce: string, draft: string, transcript: string, diff: string }` and annotations `{ readOnlyHint: false, destructiveHint: false, openWorldHint: false }`.
2. A handler that parses the draft JSON, calls `verifyCaptureRecords` from T-1003, atomically stores the verified result in the nonce transaction, and returns the result as JSON text content.

**AC <-> test**:

| AC | Test | PRD-F9 requirement |
|---|---|---|
| Tool registered with correct annotations | `ListTools includes commitlore_verify_capture with readOnlyHint:false` | 6, 7 |
| Valid draft → accepted records returned | `CallTool with good draft returns pass` | 4 |
| Fabricated draft → empty result | `CallTool with bad evidence returns empty` | 4, 5 |
| Malformed draft JSON → isError result | `CallTool with non-JSON draft returns error` | 10 |

**Commands**:
- Focused: `npx vitest run test/mcp-capture.test.ts`
- Full suite: `npx vitest run` → 45+ files, 1500+ passed, 1 skipped
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0

**Evidence invalidation**: All evidence is bound to the exact HEAD SHA at the time of test execution and is void if the branch moves.

**Stop / escalate**: Stop if (a) the `DraftRecord` type exported from `src/core/harvest.ts` cannot be cleanly deserialised from a JSON string (e.g., it uses non-serialisable types), (b) any existing MCP test fails after adding the tool, (c) the input size for transcript + diff + draft risks exceeding MCP transport limits (surface this as a design question).

**Safety checks**:
- Fail-closed: malformed input returns `isError: true`, never crashes the server.
- Wrong-target: verify does not check repository state — it is a pure computation on the provided inputs.
- Ambiguity: `validation_result` is one of three enum values; the agent always knows whether records survived.
- Timeout: verification is O(records × evidence × source-length) string matching — bounded and fast for single-record inputs.
- Partial state: verify stores its result by atomic phase transition; a crash leaves the transaction prepared or wholly verified.
- Privacy: rejected records are reported with rejection reasons only, not with the failed quotes.
- Prompt injection: the transcript is passed to `verifyCaptureRecords` which treats it as untrusted input (verbatim match only).

**Completion evidence**: Paste output of focused test showing pass, plus `npx tsc -p tsconfig.json --noEmit` exit 0.

---

## T-1009 MCP `commitlore_stage_capture` (S) — #201 · depends on T-1004, T-1007, T-1008

**Merge sequencing**: last of T-1007/T-1008/T-1009; T-1020 (F11) merges after
this one, not concurrently. See `docs/GATE-A-ACCEPTANCE.md` "Execution
constraint".

**Owns**: `src/mcp/server.ts` (add tool declaration + handler for `commitlore_stage_capture`), `test/mcp-capture.test.ts` (extend).

**Depends on**: T-1004, T-1007, T-1008.

**Forbidden scope**: Release gate, `bench/fixtures/`, `README*`, any version string, existing MCP tool declarations (must not alter `commitlore_query`, `commitlore_stale`, `commitlore_guard`), `src/hooks/`, Git history (must not call `git commit`, `git notes add`, or any history-modifying command).

**RED test**: `test/mcp-capture.test.ts` — "calling commitlore_stage_capture with a valid prepare result and verify result writes a pending file". Must fail before the change because the tool is not registered.

**Minimum GREEN**: Add to `src/mcp/server.ts`:
1. A tool declaration `commitlore_stage_capture` with `inputSchema` accepting only `{ nonce: string }` and annotations `{ readOnlyHint: false, destructiveHint: false, openWorldHint: false }`.
2. A handler that calls `stageCaptureRecord({ nonce, cwd: root })`, trusting only the verified result already stored in that transaction, and returns `{ staged: true, nonce }` or `{ staged: false, reason }`.

The tool writes only to the nonce transaction under `.git/commitlore/pending/`. It never touches Git history.

**AC <-> test**:

| AC | Test | PRD-F9 requirement |
|---|---|---|
| Tool registered with correct annotations | `ListTools includes commitlore_stage_capture with readOnlyHint:false` | 6, 7 |
| Valid input → pending file written | `CallTool stages a file under .git/commitlore/pending/` | 7, 8 |
| Stored empty result → staged:false | `CallTool with verified-empty nonce returns staged:false` | 2, 10 |
| Tool does not write to Git history | `after CallTool, git log is unchanged` | 6, 8 |
| Pending file passes readPending validation | `readPending(nonce) returns valid record after stage` | 11 |
| Verify cannot be bypassed | `prepared nonce and caller-supplied extra payload are rejected` | 14 |

**Commands**:
- Focused: `npx vitest run test/mcp-capture.test.ts`
- Full suite: `npx vitest run` → 45+ files, 1500+ passed, 1 skipped
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0

**Evidence invalidation**: All evidence is bound to the exact HEAD SHA at the time of test execution and is void if the branch moves.

**Stop / escalate**: Stop if (a) writing to `.git/commitlore/pending/` from the MCP server requires elevated permissions not available in the server's process, (b) the `stageCaptureRecord` interface from T-1004 changes, (c) any implementation attempts to add records, evidence, or claimed verification fields to the stage input schema.

**Safety checks**:
- Fail-closed: if `stageCaptureRecord` throws (disk full, permissions, exceeded max records), return `isError: true` — never crash the server, never leave a partial file.
- Wrong-target: `base_head`, `staged_diff_hash`, and `staged_tree_oid` are embedded in the pending file from the values the agent passes. The prepare hook rejects moved state, and the post-commit finaliser verifies the committed tree.
- Ambiguity: `staged: true` vs `staged: false` with a reason string — the agent always knows the outcome.
- Timeout: the 5-minute expiry is set by `stageCaptureRecord`; the agent should proceed to commit within that window.
- Partial state: same as T-1004 — atomic rename ensures the file is complete or absent.
- Privacy: the tool writes only trailer blocks and hashes to the pending file; no raw transcript content.
- Prompt injection: stage accepts only a nonce and reads records stored by T-1008; caller-supplied records/evidence are impossible by schema.

**Completion evidence**: Paste output of focused test showing pass, plus full suite at 45+ files / 1500+ passed / 1 skipped, plus `npx tsc -p tsconfig.json --noEmit` exit 0.

---

## T-1018 post-commit consumption finaliser (M) — #213 · depends on T-1001, T-1005

**Owns**

- `src/hooks/post-commit.ts` (new)
- `src/cli.ts` — register the internal `post-commit` command
- `src/commands/init.ts` — install the post-commit hook in the existing hooks step
- `test/post-commit-capture.test.ts` (new)
- `test/init.test.ts` — installation/regression assertions only

**Depends on**

- T-1001 (`markApplied`, `consumePending`)
- T-1005 (prepared candidate and message identity)

**Forbidden scope**

- Do not alter Git history or run `git commit`
- Do not consume from `prepare-commit-msg`
- Do not weaken the five-gate application checks
- Do not modify capture verification, MCP tools, README files, or release code
- Do not overwrite a foreign `post-commit` hook; preserve or refuse by the
  existing hook-containment policy

**RED test**

- File: `test/post-commit-capture.test.ts`
- Reason: after a prepared candidate commit succeeds, no post-commit command or
  hook exists to bind the nonce to the new commit. The pending file remains
  unconsumed, while consuming before success would lose it on a failed commit.

**Minimum GREEN**

1. Register an internal `commitlore post-commit` command and an installable
   `post-commit` hook stub.
2. After a successful commit, inspect only prepared, unconsumed pending files.
3. Match a candidate only when the new commit's first parent equals
  `base_head`, its tree equals `staged_tree_oid`, its canonical record-block
  hash equals `applied_record_hash`, and every applied `Record-Id` is present.
4. Call `consumePending(nonce, HEAD)` for exactly one matching candidate.
5. If no candidate matches, do nothing and exit 0.
6. If state is unreadable or finalisation fails, print one diagnostic and exit
   0; never retroactively fail a successful Git commit.
7. `commitlore init` installs the hook idempotently and preserves/refuses a
   foreign hook under the existing containment rules.

**AC <-> test**

| AC | Test assertion | PRD-F9 requirement |
|---|---|---|
| Successful commit finalises exact nonce | `parent/tree/message/ids match -> consumed_by=HEAD` | 11 |
| Failed commit does not consume | `commit-msg failure leaves consumed:false` | 11 |
| Wrong parent cannot consume | `different first parent is skipped` | 12 |
| Wrong tree cannot consume | `different committed tree is skipped` | 12 |
| Wrong/missing record block cannot consume | `message without prepared id/hash is skipped` | 12 |
| Finaliser is idempotent | `second post-commit run changes nothing` | 11 |
| Crash-repair is safe | `prepared record already present in HEAD can be finalised later` | 11 |
| Foreign hook is preserved/refused | `init does not overwrite foreign post-commit` | containment |
| Error cannot fail commit | `corrupt pending state reports and exits 0` | 10 |

**Commands**

| Scope | Command | Expected result |
|---|---|---|
| Focused | `npx vitest run test/post-commit-capture.test.ts test/init.test.ts` | all assertions pass |
| Full | `npx vitest run` | 45+ files, 1500+ passed, <=1 skipped |
| Release | `npx tsc -p tsconfig.json --noEmit && npx tsc -p bench/tsconfig.json --noEmit` | both exit 0 |
| Manual | make one successful and one deliberately failed commit in a temporary repo | success consumes once; failure stays pending |

**Evidence invalidation**

- Bound to the exact implementation HEAD. Any change to the pending schema,
  prepare hook, hook installer, or commit-message serialisation invalidates the
  focused and manual evidence.

**Stop / escalate**

- Stop if Git does not expose a stable first-parent/tree/message tuple from
  `post-commit`.
- Stop if a foreign `post-commit` hook cannot be preserved with the same
  containment guarantees as existing hooks.
- Stop if concurrent commits in one worktree can make two prepared candidates
  match the same committed tuple; add an explicit lock/claim design before
  implementation.

**Safety checks**

| Check | Mechanism |
|---|---|
| Fail-closed | ambiguous or unreadable state consumes nothing and reports incomplete |
| Wrong-target | parent + tree + message hash + record ids must all match |
| Ambiguity | exactly one match is required; zero or multiple matches consume nothing |
| Timeout | expired-but-already-prepared state may finalise only when the committed tuple matches exactly |
| Partial state | consume is an atomic rename after the commit exists |
| Privacy | only hashes, ids, and SHAs are read; no transcript content |
| Prompt injection | committed message is compared structurally; no content is executed |

**Completion evidence**

- Focused and full test outputs tied to exact HEAD
- Manual receipt for successful and failed commit paths
- `git diff` shows no pre-success `consumePending` call
- `commitlore init` idempotently reports the post-commit hook state

---

## T-1019 Pending-transaction recovery and garbage collection (M) — new · depends on T-1001, T-1018

## T-1023 Gate A integrated E2E acceptance (M) — new · depends on all of T-1001–T-1022

Full specifications for both live in `docs/GATE-A-ACCEPTANCE.md`, not here —
they close acceptance-matrix rows P0-7 and P0-4 respectively, and that document
is the authority for which ticket closes which row. This entry exists so the
F9 ticket count and dependency graph in `TICKETS.md` stay accurate; do not
duplicate the ticket body in both places.
