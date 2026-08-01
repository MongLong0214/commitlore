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
 * - `gc_eligible` — whether `capture gc` would ever remove this file. Since #367
 *   that is a question about the phase alone: `staged` and `applied` are
 *   protected outright, and everything else is collected once its window has
 *   elapsed. The `stale` column says whether the wait has started.
 *
 * `rm` exists for the third question these two raised and could not answer: a
 * file the user simply wants gone now, without waiting out a retention window.
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
export interface PendingRemoveResult {
    /** The nonce that was removed, or null when nothing was. */
    removed: string | null;
    /** The phase it was in, when that could be read — the reason for a refusal. */
    phase: PendingRecord['phase'] | null;
    /** Why nothing was removed, in the words a caller can act on. */
    error: string | null;
}
export declare const runPendingList: (opts: {
    cwd?: string;
}) => PendingListResult;
export declare const runPendingShow: (opts: {
    cwd?: string;
    nonce: string;
}) => PendingShowResult;
/**
 * `pending rm` — delete one transaction file now, rather than waiting out a
 * retention window.
 *
 * Refuses `staged` and `applied`. Those are the two phases the post-commit hook
 * can still finalise, which is why gc will not touch them either (#367 changed
 * neither); deleting one loses a record the user is in the middle of writing,
 * and there is no way to tell that from a file they are tired of seeing. It
 * refuses a file it cannot read for the same reason inverted: an unknown phase
 * might be one of those two.
 */
export declare const runPendingRemove: (opts: {
    cwd?: string;
    nonce: string;
}) => PendingRemoveResult;
export declare const register: (program: Command) => void;
