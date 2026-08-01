/**
 * Pending-transaction garbage collection — T-1019 (#215).
 *
 * Removes expired pending files that are not in a protected phase.
 * Never removes `staged` or `applied` files regardless of expiry — those may
 * still be finalised by T-1018's post-commit hook.
 * Never removes a file whose age or phase cannot be determined (fail-closed).
 *
 * #367 narrows fail-closed by exactly one case. `expires_at` is stamped at stage
 * time (`capture-stage.ts`), so `prepared` and `verified` carry `expires_at:
 * null` and the expiry rule below could never fire on them — the branch that
 * kept them was not being cautious, it was unreachable by construction. Since
 * #341 made skipping the ordinary outcome of a capture, that leaked a file on
 * the common path. Those two phases age out on `created_at` instead, and only
 * once HEAD has moved past `base_head`. Fail-closed is otherwise untouched: the
 * protected phases, the consumed window, and every undeterminable file behave
 * exactly as before.
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
 * - Removes a `prepared` or `verified` file — which never gets an `expires_at`
 *   — once it is older than 24h AND HEAD has moved past its `base_head`, so
 *   staging would refuse it anyway (#367).
 * - Skips a file whose age or phase cannot be determined.
 * - Never guesses — fail-closed.
 */
export declare const gcPending: (cwd: string) => GcResult;
