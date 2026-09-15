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
    /**
     * The staged diff. Optional: omitted, the server reads it itself (#1023).
     *
     * It was required and compared byte for byte against the hash `prepare`
     * stored, which asks a model to reproduce content the server produced -- on
     * the reporting branch, 190,300 characters with zero drift. The server read
     * the repository to make that diff and can read it again; the hash comparison
     * is unchanged either way, so a caller that sends nothing gets the same
     * guarantee without the echo.
     *
     * Still accepted, because a caller with the bytes in hand asserting them is a
     * strictly stronger statement than the server asserting them to itself, and
     * `capture --diff` exists to make exactly that assertion.
     */
    diff?: string;
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
    /**
     * The receipt this call's verification was issued (#1005), when it bound the
     * transaction.
     *
     * Absent for a read-only check, which binds nothing, and absent for a call
     * that found the transaction already bound by someone else — that caller
     * holds no handle to records it did not store, which is the point. Present
     * for a refusal this caller *did* bind, including one that bound an empty
     * result: this reports who bound the transaction, not whose records passed.
     */
    receipt?: string;
    /**
     * Which source did not match what `prepare` hashed (#1022).
     *
     * Record-independent on purpose. The mismatch used to be reported only by
     * rejecting each draft record, so a draft of `{"records": []}` -- which the
     * harvest contract calls a correct and common answer -- produced an empty
     * `rejected`, `incomplete: false`, and a receipt: the shape of a clean final
     * verification, for a call whose transcript and diff were both substituted.
     *
     * Whether the sources match has nothing to do with how many records the draft
     * holds, so it is answered here rather than per record.
     */
    source_mismatch?: 'transcript' | 'diff';
    /**
     * Set when the nonce names no transaction at all (#1023).
     *
     * That case returned `validation_result: "empty"` with `incomplete: true` and
     * nothing saying why, which is indistinguishable from the ordinary "nothing
     * survived" outcome. It was covered by accident: the required-`diff` check ran
     * first and turned a typo'd nonce into a usage error. With the diff optional
     * the cover is gone, so the fact is reported on its own.
     */
    no_transaction?: true;
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
 * - Reference resolution (`findDanglingRefs`) against the same declared set
 *   `validate --message-file` uses: history plus same-batch siblings
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
