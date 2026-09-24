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
import { writeConsideration } from './commit-consideration.js';
import { createHash } from 'node:crypto';
import { markCaptureError } from './capture-outcome.js';
import { readPending, stagePending } from './pending.js';
import { POLICY_FILE_NAME, resolvePolicy } from './capture-policy.js';
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
    // 1b. The receipt (#1005).
    //
    // Required when the transaction has one, and only then. That conditional is
    // the whole design: it was first planned as "require it always", which breaks
    // every transaction written before receipts existed and therefore needed a
    // format version bump and a release of its own. Keying the requirement on
    // what the transaction actually holds closes the hole for everything this
    // build creates while leaving an older transaction stageable, so nothing has
    // to be migrated at all.
    //
    // What still gets through is a transaction prepared by a build older than
    // receipts and staged after the upgrade. A pending transaction lives minutes
    // -- `expires_at` is `staged_at` plus five -- so that window closes itself.
    //
    // Thrown rather than returned as `null`: every other `null` here means "there
    // is nothing to stage", and a caller holding the wrong handle, or none, has a
    // different problem with a different fix. Reporting both the same way is how
    // a caller learns to read a real refusal as an empty transaction.
    //
    // The stored receipt is never echoed. A refusal that named it would hand the
    // caller exactly what it failed to prove it had.
    if (record.receipt !== undefined && opts.receipt === undefined) {
        throw markCaptureError(new Error('Staging rejected: this transaction was bound by a verification that issued a receipt, ' +
            'and none was presented. Pass the receipt `verify_capture` returned to you. If you do ' +
            'not have one, the transaction is not yours to stage: prepare a new one and verify it.'), 'usage');
    }
    if (opts.receipt !== undefined && opts.receipt !== record.receipt) {
        throw markCaptureError(new Error('Staging rejected: the receipt presented was not issued by the verification that bound ' +
            'this transaction. What is stored under this nonce belongs to another caller; prepare ' +
            'a new transaction and verify again.'), 'usage');
    }
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
        throw markCaptureError(new Error(`Staging rejected: ${record.records.length} records exceed max_records_per_commit (${policy.policy.max_records_per_commit}); ` +
            `merge their trailers into fewer records, or raise max_records_per_commit in ${POLICY_FILE_NAME}`), 'internal');
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
    /*
     * The tree was considered and a record came out of it -- recorded here, in
     * the one place both routes reach.
     *
     * The five-step flow and `commitlore commit` share this function, and until
     * this line only the second wrote a consideration. So an agent following the
     * plugin's own instructions -- prepare, verify, stage, then `git commit`, as
     * the MCP instructions and the commit skill both say -- had its commit
     * refused by the gate with "this staged tree has not been considered", and
     * was told to pass `records: []`: to discard the record it had just verified.
     * Reproduced before this line existed.
     *
     * Writing it here rather than in either caller is what keeps the two routes
     * from disagreeing about what considering means. The pending transaction is
     * untouched and stays the separate artifact #1021 made it.
     */
    writeConsideration({ cwd, outcome: 'recorded', records: 1 });
    return nonce;
};
//# sourceMappingURL=capture-stage.js.map