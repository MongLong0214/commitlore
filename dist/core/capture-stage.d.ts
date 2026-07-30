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
export interface StageCaptureOptions {
    /** Nonce identifying the pending transaction (32 lowercase hex chars). */
    nonce: string;
    /** Working directory of the git repository. */
    cwd: string;
    /** Override the expiry window (minutes). Default: 5. */
    expiryMinutes?: number;
}
/**
 * Stage a verified pending transaction.
 *
 * Returns the nonce on success, or `null` when there is nothing to stage
 * (empty verification result, incomplete, or wrong phase).
 *
 * Throws if the stored accepted-record count exceeds `max_records_per_commit`.
 */
export declare const stageCaptureRecord: (opts: StageCaptureOptions) => string | null;
