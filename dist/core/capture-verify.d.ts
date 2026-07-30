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
import type { DraftRecord } from './harvest.js';
export interface VerifyCaptureOptions {
    nonce: string;
    draft: DraftRecord[];
    transcript: string;
    diff: string;
    cwd: string;
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
/**
 * Verifies capture records against the transcript and diff.
 *
 * Delegates to `verifyDraft` for each record, then performs:
 * - Source hash verification (transcript/diff match what prepare stored)
 * - Duplicate Record-Id detection against active records
 * - Canonical duplicate detection
 * - Notes availability check (unfetched → incomplete)
 *
 * Never throws on a record-verification failure — returns `"empty"` instead.
 * Never blocks: an empty or incomplete result is a valid outcome, not an error.
 */
export declare const verifyCaptureRecords: (opts: VerifyCaptureOptions) => VerifyCaptureResult;
