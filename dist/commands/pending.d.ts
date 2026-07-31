/**
 * `commitlore pending` — look at capture transactions without reading `.git`.
 *
 * A pending transaction was the one piece of context in this system that could
 * not be reviewed (#311). Everything worth knowing already sat in
 * `.git/commitlore/pending/<nonce>.json`, and the only way to reach it was to
 * point a JSON parser at another tool's `.git` subdirectory — which is what a CLI
 * exists to prevent, and which breaks silently the first time a field is renamed.
 *
 * Two facts are derived here rather than stored, because both are relative to the
 * repository as it is now:
 *
 * - `stale` — `base_head` no longer matches `HEAD`. The transaction will not apply
 *   to the commit being written, and at commit time that is a silent no-op.
 * - `gc_eligible` — whether `capture gc` would ever remove this file. A
 *   non-consumed transaction is collected only when `expires_at` parses, and
 *   `expires_at` is stamped at stage time, so a `verified` transaction that was
 *   never staged is kept indefinitely. That is reported, not changed: altering the
 *   collection rule is a separate decision from being able to see it.
 */
import type { Command } from 'commander';
import { type PendingRecord } from '../core/pending.js';
/** One row of `pending ls`: the fields worth scanning, plus the two derived ones. */
export interface PendingSummary {
    nonce: string;
    phase: PendingRecord['phase'];
    records: number;
    validation_result: PendingRecord['validation_result'];
    created_at: string;
    expires_at: string | null;
    base_head: string;
    /** `base_head` is no longer HEAD, so this transaction cannot apply. */
    stale: boolean;
    /** Whether `capture gc` would ever remove this file. */
    gc_eligible: boolean;
}
export interface PendingListResult {
    transactions: PendingSummary[];
    /** Present when a file exists but cannot be read as a transaction. */
    unreadable: string[];
}
export interface PendingShowResult {
    transaction: (PendingRecord & {
        stale: boolean;
        gc_eligible: boolean;
    }) | null;
    /** Why nothing is being shown, in the words a caller can act on. */
    error: string | null;
}
export declare const runPendingList: (opts: {
    cwd?: string;
}) => PendingListResult;
export declare const runPendingShow: (opts: {
    cwd?: string;
    nonce: string;
}) => PendingShowResult;
export declare const register: (program: Command) => void;
