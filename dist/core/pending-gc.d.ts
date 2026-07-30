/**
 * Pending-transaction garbage collection — T-1019 (#215).
 *
 * Removes expired pending files that are not in a protected phase.
 * Never removes `staged` or `applied` files regardless of expiry — those may
 * still be finalised by T-1018's post-commit hook.
 * Never removes a file whose age or phase cannot be determined (fail-closed).
 */
export interface GcResult {
    removed: string[];
    kept: string[];
}
/**
 * Garbage-collect expired pending transaction files.
 *
 * Behaviour:
 * - Removes a file when `now > expires_at` AND `phase` is neither `staged`
 *   nor `applied`.
 * - Removes a `consumed: true` file older than the retention window (24h).
 * - Skips a file whose age or phase cannot be determined.
 * - Never guesses — fail-closed.
 */
export declare const gcPending: (cwd: string) => GcResult;
