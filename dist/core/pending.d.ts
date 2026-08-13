/**
 * Pending transaction store — ADR-0021.
 *
 * Owns the monotonic prepare → verify → stage → apply → consume lifecycle
 * of a single capture pipeline run. Every mutation is an atomic rename so
 * no concurrent reader can observe a partial file. The prepared → verified
 * write is also exclusive per nonce (#591): a rename makes one write complete,
 * it does not make a read-modify-write exclusive.
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
export interface PendingLock {
    /** This process may mutate the nonce. */
    held: boolean;
    /** This call created the lock file and must release it. */
    created: boolean;
}
/**
 * Claim exclusive mutation of one pending nonce.
 *
 * `O_EXCL` (`wx`) makes the create the arbitration: two processes cannot both
 * observe an absent lock and both proceed. Re-entry from the same pid is
 * allowed so `verifyCaptureRecords` can hold the lock across the store.
 * A lock whose owner pid is gone is stolen once — a crash must not pin the
 * nonce forever.
 */
export declare const tryLockPending: (nonce: string, cwd: string) => PendingLock;
/** Release a lock this process created. A lock owned by someone else is left. */
export declare const unlockPending: (nonce: string, cwd: string) => void;
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
/**
 * Whether this transaction can no longer reach a commit — the question `pending
 * ls` prints as `stale` and doctor reads as a lost capture (#584).
 *
 * `headHasMovedPast` alone cannot answer it. A `consumed` transaction's
 * `base_head` is behind HEAD *by construction*: the commit that consumed it is
 * what moved HEAD past it, and `consumed_by` names that commit. So the gap the
 * predicate measures is the signature of success on this phase, and reading it
 * as staleness made every completed capture report itself as a decision that
 * was never written — inverting the one alarm a user runs doctor to trust.
 *
 * Only `consumed` is excluded. `applied` looks similar and is not: the record
 * hash is stamped before the commit object exists, so a commit the user aborted
 * leaves an applied transaction whose decision really did go nowhere. Staleness
 * there is a real warning, and the fix for a false alarm must not silence it.
 */
export declare const pendingIsStale: (record: Pick<PendingRecord, "phase" | "base_head">, head: string | null) => boolean;
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
 * The in-memory form of a newly prepared transaction.
 *
 * `createPending` persists this exact shape. Read-only callers such as capture
 * shadow use the same transaction input without first creating a file they
 * would have to clean up afterwards.
 */
export declare const makePreparedPending: (opts: CreatePendingOptions & {
    nonce: string;
    base_head: string;
    created_at?: string;
}) => PendingRecord;
/**
 * Creates a pending transaction in `prepared` phase.
 * Returns the nonce (32 hex chars).
 */
export declare const createPending: (opts: CreatePendingOptions) => string;
/**
 * The nonces of every pending transaction in this repository, sorted oldest name
 * first so a listing is stable between runs.
 *
 * A missing directory means a repository has never captured and therefore has
 * nothing pending. An unreadable directory is deliberately distinct: callers
 * must not turn an unknown pending state into an empty one.
 */
export type PendingDirectoryState = 'ready' | 'absent' | 'unreadable';
export interface PendingNonceList {
    state: PendingDirectoryState;
    nonces: string[];
    /** A stable filesystem error code when the pending directory could not be read. */
    error: string | null;
}
export declare const isUnreadablePendingFile: (error: unknown) => boolean;
export declare const listPendingNonces: (cwd: string) => PendingNonceList;
export interface ReadPendingOptions {
    cwd: string;
}
/**
 * Reads a pending transaction by nonce.
 * Returns null if the file is absent.
 * Throws PendingFormatError for corrupt or unknown-version content.
 * Throws a marked plain Error when the file exists but cannot be read.
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
 * Only succeeds if the current phase is 'prepared', and only for the caller
 * that holds the nonce lock — a losing racer returns false rather than
 * reporting a write that another process will overwrite (#591).
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
