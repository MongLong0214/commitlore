/**
 * Pending transaction store — ADR-0021.
 *
 * Owns the monotonic prepare → verify → stage → apply → consume lifecycle
 * of a single capture pipeline run. Every mutation is an atomic rename so
 * no concurrent reader can observe a partial file.
 */
import type { RenderedGuardMatch } from './guard.js';
/** The three verification gaps, in canonical order (T-1024's closed vocabulary). */
export type GuardGap = 'history-unavailable' | 'shallow-history' | 'notes-unfetched';
export interface GuardAdvisory {
    matches: RenderedGuardMatch[];
    gaps: GuardGap[];
    disclosure: string;
}
export interface PendingRecord {
    version: 1;
    nonce: string;
    created_at: string;
    expires_at: string | null;
    phase: 'prepared' | 'verified' | 'staged' | 'applied' | 'consumed';
    consumed: boolean;
    verified_at: string | null;
    staged_at: string | null;
    applied_at: string | null;
    applied_record_hash: string | null;
    consumed_at: string | null;
    consumed_by: string | null;
    base_head: string;
    staged_diff_hash: string;
    staged_tree_oid: string;
    policy_identity_hash: string;
    source_hashes: {
        transcript: string;
        diff: string;
    };
    evidence_hash: string | null;
    records: unknown[];
    validation_result: 'pass' | 'partial' | 'empty' | null;
    overlap_check: 'canonical_exact_only' | null;
    incomplete: boolean;
    guard_advisory?: GuardAdvisory | null;
    /**
     * Present — and only ever `true` — when the capture declared itself
     * unattended and the repository's policy consented (#511). Absent otherwise,
     * so a capture that made no declaration leaves byte-identical bytes on disk.
     */
    unattended?: boolean;
}
export declare class PendingFormatError extends Error {
    constructor(message: string);
}
/**
 * The current commit, or null when there is not one to read (unborn branch,
 * broken repository). Never throws: both callers treat "cannot tell" as an
 * answer rather than a failure.
 */
export declare const resolveHead: (cwd: string) => string | null;
/**
 * Whether HEAD has left this transaction's base behind.
 *
 * This is the point of no return for anything before `staged`:
 * `stageCaptureRecord` refuses outright when `base_head` is not the current
 * HEAD, so once this is true no amount of waiting can advance the transaction.
 * `pending ls` reports it as `stale` and gc uses it to decide what can never be
 * finalised — deliberately the same function, so the listing and the collector
 * cannot drift into disagreeing about the same file.
 *
 * Undeterminable input answers `false`: no readable HEAD, or no well-formed
 * recorded base, means the caller must fail closed rather than guess.
 */
export declare const headHasMovedPast: (baseHead: unknown, head: string | null) => boolean;
export interface CreatePendingOptions {
    cwd: string;
    source_hashes: {
        transcript: string;
        diff: string;
    };
    staged_diff_hash: string;
    staged_tree_oid: string;
    policy_identity_hash: string;
    guard_advisory?: GuardAdvisory | null;
    /** Set only when prepare accepted an unattended declaration (#511). */
    unattended?: boolean;
}
/**
 * Creates a pending transaction in `prepared` phase.
 * Returns the nonce (32 hex chars).
 */
export declare const createPending: (opts: CreatePendingOptions) => string;
/**
 * The nonces of every pending transaction in this repository, sorted oldest name
 * first so a listing is stable between runs.
 *
 * Returns an empty list when the directory does not exist: a repository that has
 * never captured has nothing pending, which is an answer rather than an error
 * (#311).
 */
export declare const listPendingNonces: (cwd: string) => string[];
export interface ReadPendingOptions {
    cwd: string;
}
/**
 * Reads a pending transaction by nonce.
 * Returns null if the file is absent.
 * Throws PendingFormatError for corrupt or unknown-version content.
 */
export declare const readPending: (nonce: string, opts: ReadPendingOptions) => PendingRecord | null;
export interface StoreVerificationOptions {
    cwd: string;
    accepted: unknown[];
    rejected: unknown[];
    validation_result: 'pass' | 'partial' | 'empty';
    overlap_check: 'canonical_exact_only' | null;
    incomplete: boolean;
    evidence_hash: string;
}
/**
 * Stores verification results in the pending transaction.
 * Only succeeds if the current phase is 'prepared'.
 */
export declare const storeVerification: (nonce: string, opts: StoreVerificationOptions) => boolean;
export interface StagePendingOptions {
    cwd: string;
    expiryMinutes?: number;
}
/**
 * Stages a verified transaction.
 * Returns true on success, false if the phase is not 'verified'.
 * CEO amendment 1: stamps expires_at = staged_at + 5 minutes (or expiryMinutes).
 */
export declare const stagePending: (nonce: string, opts: StagePendingOptions) => boolean;
export interface MarkAppliedOptions {
    cwd: string;
}
/**
 * Records that the pending transaction was applied (trailer appended to commit message).
 * Only succeeds if phase is 'staged'.
 */
export declare const markApplied: (nonce: string, recordHash: string, opts: MarkAppliedOptions) => boolean;
export interface DeletePendingOptions {
    cwd: string;
}
/**
 * Deletes a pending transaction file outright.
 *
 * Returns false when there was nothing to delete. This store deliberately holds
 * no opinion on *whether* a given transaction may be deleted — the phase policy
 * lives with the caller that has the user in front of it (`pending rm`), and gc
 * keeps its own. Adding a second copy of that policy here is how the two would
 * come to disagree.
 */
export declare const deletePending: (nonce: string, opts: DeletePendingOptions) => boolean;
export interface ConsumePendingOptions {
    cwd: string;
}
/**
 * Consumes a pending transaction after a successful commit.
 * Only succeeds if phase is 'applied' and consumed is false.
 */
export declare const consumePending: (nonce: string, commitSha: string, opts: ConsumePendingOptions) => boolean;
