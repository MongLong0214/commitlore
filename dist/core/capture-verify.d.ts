/**
 * Capture verify phase — T-1003 (#195), ADR-0021.
 *
 * Security-critical: the transcript is attacker-influenced input. Evidence is
 * verified *mechanically* against the transcript and diff that prepare hashed —
 * never trusted because the draft asserts it. A quote that does not appear in
 * the actual source is discarded with a reason.
 *
 * Non-negotiable properties:
 * - Verification failure never blocks a commit. A failed record is discarded
 *   and logged; the commit proceeds with no record.
 * - Prompt injection: nothing in the transcript may cause verify to accept a
 *   record it would otherwise reject, and no trailer content is executed or
 *   interpreted as an instruction.
 * - A record that verifies empty produces no record at all rather than an
 *   empty one.
 * - Default maximum is one record per commit.
 */
import { type VerifiedRecord } from './harvest-verify.js';
import { type PendingRecord } from './pending.js';
import type { DraftRecord } from './harvest.js';
export interface VerifyCaptureOptions {
    nonce: string;
    draft: DraftRecord[];
    transcript: string;
    diff: string;
    cwd: string;
    /**
     * An in-memory prepared transaction. Shadow uses this instead of reading a
     * pending file it deliberately never created.
     */
    pending?: PendingRecord;
    /** Do not persist verification back to `.git/commitlore/pending`. */
    readOnly?: boolean;
    /** A read-only snapshot of active records, reusable across a historical run. */
    history?: CaptureVerificationHistory | null;
}
export interface CaptureRejection {
    record: DraftRecord;
    reason: string;
    detail: string;
}
export interface VerifyCaptureResult {
    accepted: VerifiedRecord[];
    rejected: CaptureRejection[];
    validation_result: 'pass' | 'partial' | 'empty';
    incomplete: boolean;
    overlap_check: 'canonical_exact_only';
}
/** The duplicate-check view used by capture verification. */
export interface CaptureVerificationHistory {
    /** Every identity declared in repository history, including retired records. */
    recordIds: Set<string>;
    /** Canonical tuples of active records, which are the only duplicate content. */
    activeCanonicalTuples: Set<string>;
    /** Whether the history scan could not cover the whole repository. */
    incomplete: boolean;
}
/**
 * Canonical identity tuple for de-duplication: lowercased key + value, no scope
 * (scope is path, handled by the query layer). Two records with the same
 * canonical tuple are duplicates regardless of Record-Id.
 */
export declare const captureCanonicalTuple: (trailers: readonly {
    key: string;
    value: string;
}[]) => string;
/**
 * Read the active records exactly as verification does, without touching the
 * derived index. A caller with a known read-only history can provide it through
 * `VerifyCaptureOptions.history` instead.
 */
export declare const loadCaptureVerificationHistory: (cwd: string) => CaptureVerificationHistory | null;
/**
 * Verifies capture records against the transcript and diff.
 *
 * Delegates to `verifyDraft` for each record, then performs:
 * - Source hash verification (transcript/diff match what prepare stored)
 * - Duplicate Record-Id detection against every historical identity
 * - Canonical duplicate detection
 * - Notes availability check (unfetched → incomplete)
 *
 * Never throws on a record-verification failure — returns `"empty"` instead.
 * Never blocks: an empty or incomplete result is a valid outcome, not an error.
 */
export declare const verifyCaptureRecords: (opts: VerifyCaptureOptions) => VerifyCaptureResult;
/**
 * Run the ordinary verifier against an in-memory transaction without writing a
 * verification result. This is intentionally a thin wrapper, so shadow keeps
 * every source, evidence, duplicate, and policy check the live path uses.
 */
export declare const verifyCaptureRecordsReadOnly: (opts: Omit<VerifyCaptureOptions, "nonce" | "pending" | "readOnly"> & {
    nonce: string;
    pending: PendingRecord;
}) => VerifyCaptureResult;
