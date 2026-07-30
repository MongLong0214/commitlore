# ADR-0021: on-disk pending-capture transaction format and single-consumption semantics

- Status: Accepted (2026-07-30)
- Issues: #193–#201, #213
- Related: ADR-0006 (push injection); P0-3 (acceptance matrix); P1-5 (policy resolution)

## Context

P0-3 accepts a unified capture pipeline (`commitlore capture`: prepare → verify →
stage). The `prepare-commit-msg` hook may apply the record to a candidate commit,
but the source review is explicit that the pending record is consumed **after
the commit finishes**. The pipeline therefore spans three processes: the
capture command (or MCP tools) writes a pending record, `prepare-commit-msg`
applies it, and `post-commit` finalises consumption. The contract between them
must be durable on disk.

Once MCP clients (`commitlore_prepare_capture`, `commitlore_verify_capture`,
`commitlore_stage_capture`) depend on this format and the hook depends on its
invariants, a breaking change to either one forces a coordinated update across
every agent integration. That makes the format an irreversible decision.

The pending directory lives at `.git/commitlore/pending/`, which is already
gitignored (`.gitignore:14`). It is per-worktree and per-clone; no pending file
is ever committed or pushed.

P1-5 (acceptance matrix) resolves a contradiction in the source review: capture
requires a policy notion (max records per commit, verified-evidence requirement)
while the user-editable policy file is deferred to Gate B. The resolution is
that capture ships with safe hardcoded defaults plus a policy **identity hash**
in each pending record, so the hook can detect a policy change between stage and
commit without depending on a policy file that does not yet exist. When the file
ships in Gate B, the hash changes from `sha256(hardcoded-defaults-json)` to
`sha256(policy-file-contents)`, and the pending format needs no breaking change.

## Decision

### 1. Pending transaction file

Each capture pipeline run creates exactly one file during `prepare` and updates
that same file through the later phases:

```
.git/commitlore/pending/<nonce>.json
```

where `<nonce>` is 16 bytes of `crypto.randomBytes` hex-encoded (32 characters).

### 2. Field set

```jsonc
{
  "version": 1,
  "nonce": "<hex>",
  "created_at": "<ISO 8601 UTC>",
  "expires_at": "<ISO 8601 UTC>",
  "phase": "prepared" | "verified" | "staged" | "applied" | "consumed",
  "consumed": false,
  "verified_at": null,
  "staged_at": null,
  "applied_at": null,
  "applied_record_hash": null,
  "consumed_at": null,
  "consumed_by": null,

  // Binding conditions — the hook checks all five before applying
  "base_head": "<full 40-char SHA of HEAD at prepare time>",
  "staged_diff_hash": "<sha256 of `git diff --cached` at prepare time>",
  "staged_tree_oid": "<full tree oid from `git write-tree` at prepare time>",
  "policy_identity_hash": "<sha256 of the serialised policy defaults>",
  "source_hashes": {
    "transcript": "<sha256>",
    "diff": "<sha256>"
  },

  // Added by verify; callers cannot supply these directly to stage
  "evidence_hash": null,
  "records": [ /* array of { trailers: Trailer[], evidence: DraftEvidence[] } */ ],
  "validation_result": null | "pass" | "partial" | "empty",
  "overlap_check": null | "canonical_exact_only",
  "incomplete": false
}
```

Fields are normative. No additional fields may be added without incrementing
`version`. Consumers must reject any file whose `version` they do not
understand.

The phase transitions are monotonic:

```
prepared -> verified -> staged -> applied -> consumed
```

`prepare`, `verify`, and `stage` all mutate this repository-local transaction.
`stage` accepts only a nonce; it must never accept caller-supplied accepted
records or evidence hashes. This makes it impossible for an MCP client to skip
verification and inject an arbitrary trailer block into pending state.

### 3. Consumption conditions (the five-gate check)

The `prepare-commit-msg` hook applies a `phase: "staged"` record, or retries a
still-unconsumed `phase: "applied"` record from an aborted commit attempt,
**only** when all five conditions hold:

1. **HEAD unchanged**: current HEAD equals `base_head`.
2. **Staged diff unchanged**: SHA-256 of the current `git diff --cached` output
   equals `staged_diff_hash`.
3. **Unexpired**: `now < expires_at` (default expiry: 5 minutes from creation).
4. **Unconsumed**: `consumed === false`.
5. **Policy unchanged**: SHA-256 of the current policy identity equals
   `policy_identity_hash`.

If any condition fails, the hook **does not apply the record** and **does not
block the commit**. The commit proceeds with no record. The hook writes a
one-line diagnostic to stderr naming which condition failed.

### 4. Apply before commit; consume only after commit succeeds

When all five conditions pass, `prepare-commit-msg`:

1. Appends the record trailer block to the message file unless the same
   `Record-Id` is already present.
2. Only after that write succeeds, atomically sets `phase: "applied"`,
   `applied_at`, and `applied_record_hash` (the canonical serialised trailer
   block, not the editable subject/body) in the pending file.
3. Leaves `consumed: false`.

It must never set `consumed: true`: a later `commit-msg` hook, signing failure,
or Git error can still abort the commit. Consuming before success loses the
record while creating no commit, contradicting the accepted source review.

After Git creates the commit, `post-commit` finds the applied nonce whose:

1. `base_head` is the new commit's first parent,
2. `staged_tree_oid` is the new commit's tree,
3. record ids are present in the new commit message, and
4. `applied_record_hash` matches the canonical record block in that message.

It then atomically sets `phase: "consumed"`, `consumed: true`, `consumed_at`,
and `consumed_by` to the new commit SHA. A failed commit leaves the pending
file retriable. A successful commit
changes HEAD even if `post-commit` crashes, so the five-gate check prevents the
same nonce from attaching to a later commit; a subsequent repair may finalise
that already-applied nonce by matching the committed parent, tree, and record
ids.

### 5. Verification failure never blocks

A transaction whose `validation_result` is `"empty"` (all records were
discarded by the verifier) reaches `phase: "verified"` with zero records.
`stage` returns "nothing staged" and does not advance it to `staged`; the hook
therefore finds no eligible transaction. At no point does a verification
failure cause a non-zero exit from the hook. This is the same non-blocking
contract as `harvest-verify` (ADR-0006: 전량 실패 시 비차단).

### 6. Maximum one record per commit (default)

The hardcoded policy default is `max_records_per_commit: 1`. A pending file
whose `records` array exceeds this limit is rejected at stage time (before the
file is written), not at hook time. The hook never needs to count because the
pipeline enforces the cap upstream.

### 7. Policy identity hash: why now, file later

The policy identity hash is `sha256(JSON.stringify(HARDCODED_DEFAULTS))` where
`HARDCODED_DEFAULTS` is:

```jsonc
{
  "mode": "suggest",
  "max_records_per_commit": 1,
  "require_verified_evidence": true
}
```

This value is deterministic and changes only when the defaults change (a code
change) or when the user-editable policy file ships in Gate B (which replaces
the hash input). Shipping the hash now means:

- The hook detects when the code that generated the pending file ran under
  different policy than the code that consumes it (e.g., after an upgrade
  between stage and commit).
- The pending-transaction format does not need a breaking change when the policy
  file arrives.

## Consequences

- `src/core/pending.ts` (new) owns the monotonic
  prepare/verify/stage/apply/consume transitions.
- `src/hooks/prepare-commit-msg.ts` gains an application path gated on the five
  conditions; it never consumes before Git succeeds.
- A `post-commit` hook finalises consumption against the committed parent, tree,
  message, and record ids.
- `src/mcp/server.ts` gains three write-side tools that touch only
  `.git/commitlore/pending/` and are annotated `readOnlyHint: false`. `stage`
  accepts a nonce only and trusts the stored verified result, never an agent
  replay of that result.
- The existing three MCP tools retain `readOnlyHint: true` and are unchanged.
- `.git/commitlore/pending/` is created on first capture; `commitlore init`
  does not pre-create it.
- No migration is needed: the directory did not exist before and agents have no
  prior format to forget.

## Falsification

This ADR's format and consumption contract is falsified — and must be revised —
if any of the following is demonstrated:

1. A pending record is applied to a commit whose HEAD differs from `base_head`
   (wrong-target violation).
2. A pending record is applied twice to two different commits from the same
   nonce file (double-consumption violation).
3. A failed commit marks its pending record consumed even though no commit
   contains that record (pre-success consumption violation).
4. A successful commit contains a prepared record but the pending record cannot
   be deterministically finalised against that commit (finalisation violation).
5. A verification failure causes a non-zero hook exit code that blocks a user's
   commit (non-blocking violation).
6. A legitimate capture workflow is unable to produce a record because the
   policy identity hash changed between `stage` and `commit` under conditions
   where the effective policy was actually unchanged (false-invalidation — would
   indicate the hash input is too broad or unstable).
7. The five-gate check adds measurable latency (>50ms p99) to commits that have
   no pending file, indicating the hook's fast-path exit is broken.
