/**
 * Capture stage phase — T-1004 (#196), ADR-0021.
 *
 * Advances a verified pending transaction to `staged` phase. On success,
 * stamps `staged_at` and `expires_at = staged_at + expiryMinutes` (default 5).
 *
 * CEO amendment (binding):
 * - `expires_at` is null for records in `prepared` or `verified` phase.
 * - `expires_at` is stamped only at stage success, anchored to `staged_at`.
 * - `expiryMinutes` overrides the window length only, never the anchor.
 * - Every binding (`base_head`, `staged_diff_hash`, `policy_identity_hash`,
 *   `staged_at`, `expires_at`) is computed server-side, never from the caller.
 * - Default maximum: one record per commit.
 */
import { createHash } from 'node:crypto';
import { markCaptureError } from './capture-outcome.js';
import { readPending, stagePending } from './pending.js';
import { resolvePolicy } from './capture-policy.js';
import { execGitOrThrow } from './git.js';
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Stage a verified pending transaction.
 *
 * Returns the nonce on success, or `null` when there is nothing to stage
 * (empty verification result, incomplete, or wrong phase).
 *
 * Throws if the stored accepted-record count exceeds `max_records_per_commit`.
 */
export const stageCaptureRecord = (opts) => {
    const { nonce, cwd, expiryMinutes } = opts;
    // 1. Re-read the transaction — requires phase "verified"
    const record = readPending(nonce, { cwd });
    if (!record)
        return null;
    if (record.phase !== 'verified')
        return null;
    // 2. Empty or incomplete verification → nothing to stage
    if (record.validation_result === 'empty')
        return null;
    if (record.incomplete)
        return null;
    // 3. Enforce max_records_per_commit from the resolved policy (T-1110).
    //    Reading the current policy here is safe because gate 4 below rejects when
    //    the policy identity differs from the one `prepare` recorded: a changed
    //    policy cannot pass both gates. Where it changes anything, it changes only
    //    which of the two rejection messages the user sees, never whether the
    //    staging is rejected.
    const policy = resolvePolicy(cwd);
    if (record.records.length > policy.policy.max_records_per_commit) {
        throw markCaptureError(new Error(`Staging rejected: ${record.records.length} records exceed max_records_per_commit (${policy.policy.max_records_per_commit})`), 'internal');
    }
    // 4. Recheck binding conditions (HEAD, staged diff, staged tree, policy)
    const currentHead = execGitOrThrow(['rev-parse', 'HEAD'], { cwd }).trim();
    if (currentHead !== record.base_head) {
        throw markCaptureError(new Error(`Staging rejected: HEAD moved since prepare (expected ${record.base_head}, got ${currentHead})`), 'operational');
    }
    const currentDiff = execGitOrThrow(['diff', '--cached'], { cwd });
    const currentDiffHash = createHash('sha256').update(currentDiff).digest('hex');
    if (currentDiffHash !== record.staged_diff_hash) {
        throw markCaptureError(new Error('Staging rejected: staged diff changed since prepare'), 'operational');
    }
    const currentTree = execGitOrThrow(['write-tree'], { cwd }).trim();
    if (currentTree !== record.staged_tree_oid) {
        throw markCaptureError(new Error('Staging rejected: staged tree changed since prepare'), 'operational');
    }
    const currentPolicy = policy.identityHash;
    if (currentPolicy !== record.policy_identity_hash) {
        throw markCaptureError(new Error('Staging rejected: policy identity changed since prepare'), 'operational');
    }
    // 5. Advance phase via stagePending (atomic rename)
    const stageOpts = expiryMinutes !== undefined ? { cwd, expiryMinutes } : { cwd };
    const success = stagePending(nonce, stageOpts);
    if (!success)
        return null;
    return nonce;
};
//# sourceMappingURL=capture-stage.js.map