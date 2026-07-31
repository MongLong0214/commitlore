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
}
export declare class PendingFormatError extends Error {
    constructor(message: string);
}
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
export interface ConsumePendingOptions {
    cwd: string;
}
/**
 * Consumes a pending transaction after a successful commit.
 * Only succeeds if phase is 'applied' and consumed is false.
 */
export declare const consumePending: (nonce: string, commitSha: string, opts: ConsumePendingOptions) => boolean;
