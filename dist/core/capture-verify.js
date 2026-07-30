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
import { createHash } from 'node:crypto';
import { verifyDraft } from './harvest-verify.js';
import { readPending, storeVerification } from './pending.js';
import { runQuery } from './query.js';
import { notesAvailability } from './notes.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sha256 = (input) => createHash('sha256').update(input).digest('hex');
/** Extract Record-Id from a draft record's trailers. */
const recordIdOf = (record) => record.trailers.find((t) => t.key === 'Record-Id')?.value;
/**
 * Canonical identity tuple for de-duplication: lowercased key + value, no scope
 * (scope is path, handled by the query layer). Two records with the same
 * canonical tuple are duplicates regardless of Record-Id.
 */
const canonicalTuple = (record) => {
    const keys = record.trailers
        .filter((t) => t.key !== 'Record-Id' && t.key !== 'Evidence' && t.key !== 'Provenance')
        .map((t) => `${t.key.toLowerCase()}=${t.value.toLowerCase()}`)
        .sort()
        .join('|');
    return keys;
};
/** Build the result classification. */
const classifyResult = (accepted, rejected) => {
    if (accepted.length === 0)
        return 'empty';
    if (rejected.length === 0)
        return 'pass';
    return 'partial';
};
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
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
export const verifyCaptureRecords = (opts) => {
    const { nonce, draft, transcript, diff, cwd } = opts;
    const accepted = [];
    const rejected = [];
    try {
        // 1. Re-read prepared transaction and verify source hashes
        const pending = readPending(nonce, { cwd });
        if (!pending) {
            // No transaction found — return empty (never throw)
            return {
                accepted: [],
                rejected: [],
                validation_result: 'empty',
                incomplete: false,
                overlap_check: 'canonical_exact_only',
            };
        }
        // Source hash verification: reject if the transcript or diff was substituted
        const transcriptHash = sha256(transcript);
        const diffHash = sha256(diff);
        if (pending.source_hashes.transcript !== transcriptHash) {
            // Source mismatch — every record is rejected
            for (const record of draft) {
                rejected.push({
                    record,
                    reason: 'source-mismatch',
                    detail: 'transcript hash does not match the prepared transaction',
                });
            }
            const result = {
                accepted: [],
                rejected,
                validation_result: 'empty',
                incomplete: false,
                overlap_check: 'canonical_exact_only',
            };
            storeVerificationResult(nonce, cwd, result);
            return result;
        }
        if (pending.source_hashes.diff !== diffHash) {
            for (const record of draft) {
                rejected.push({
                    record,
                    reason: 'source-mismatch',
                    detail: 'diff hash does not match the prepared transaction',
                });
            }
            const result = {
                accepted: [],
                rejected,
                validation_result: 'empty',
                incomplete: false,
                overlap_check: 'canonical_exact_only',
            };
            storeVerificationResult(nonce, cwd, result);
            return result;
        }
        // 2. Check notes availability — unfetched means incomplete
        const notes = notesAvailability({ cwd });
        if (notes === 'unfetched') {
            const result = {
                accepted: [],
                rejected: [],
                validation_result: 'empty',
                incomplete: true,
                overlap_check: 'canonical_exact_only',
            };
            storeVerificationResult(nonce, cwd, result);
            return result;
        }
        // 3. Load active records for duplicate checking
        let activeRecordIds = new Set();
        let activeCanonicalTuples = new Set();
        try {
            const queryResult = runQuery({ cwd, noIndex: true });
            for (const rec of queryResult.records) {
                // Collect Record-Id values
                const idTrailer = rec.trailers.find((t) => t.key === 'Record-Id');
                if (idTrailer)
                    activeRecordIds.add(idTrailer.value);
                // Collect canonical tuples
                const tuple = rec.trailers
                    .filter((t) => t.key !== 'Record-Id' &&
                    t.key !== 'Evidence' &&
                    t.key !== 'Provenance')
                    .map((t) => `${t.key.toLowerCase()}=${t.value.toLowerCase()}`)
                    .sort()
                    .join('|');
                activeCanonicalTuples.add(tuple);
            }
        }
        catch {
            // If we can't read active records, we cannot be sure → incomplete
            const result = {
                accepted: [],
                rejected: [],
                validation_result: 'empty',
                incomplete: true,
                overlap_check: 'canonical_exact_only',
            };
            storeVerificationResult(nonce, cwd, result);
            return result;
        }
        // 4. Delegate to verifyDraft for evidence/grammar checking
        const verifyResult = verifyDraft(draft, { transcript, diff });
        // Process accepted records — additional checks
        for (const verified of verifyResult.accepted) {
            const id = recordIdOf(verified.record);
            // Check duplicate Record-Id
            if (id && activeRecordIds.has(id)) {
                rejected.push({
                    record: verified.record,
                    reason: 'duplicate-record-id',
                    detail: `Record-Id "${id}" already exists in active records`,
                });
                continue;
            }
            // Check canonical duplicate
            const tuple = canonicalTuple(verified.record);
            if (tuple && activeCanonicalTuples.has(tuple)) {
                rejected.push({
                    record: verified.record,
                    reason: 'canonical-duplicate',
                    detail: 'a record with the same normalized key/value/scope already exists',
                });
                continue;
            }
            accepted.push(verified);
        }
        // Collect rejections from verifyDraft
        for (const rejectedRec of verifyResult.rejected) {
            rejected.push({
                record: rejectedRec.record,
                reason: rejectedRec.reason,
                detail: rejectedRec.detail,
            });
        }
        // 5. Build and store result
        const validationResult = classifyResult(accepted, rejected);
        const result = {
            accepted,
            rejected,
            validation_result: validationResult,
            incomplete: false,
            overlap_check: 'canonical_exact_only',
        };
        storeVerificationResult(nonce, cwd, result);
        return result;
    }
    catch {
        // Never throws — return empty on any unhandled error
        const result = {
            accepted: [],
            rejected: [],
            validation_result: 'empty',
            incomplete: false,
            overlap_check: 'canonical_exact_only',
        };
        // Best-effort store
        try {
            storeVerificationResult(nonce, cwd, result);
        }
        catch {
            // Ignore — we must never throw
        }
        return result;
    }
};
// ---------------------------------------------------------------------------
// Internal: store verification result in pending transaction
// ---------------------------------------------------------------------------
const storeVerificationResult = (nonce, cwd, result) => {
    const evidenceHash = sha256(JSON.stringify(result.accepted.map((a) => a.record)));
    storeVerification(nonce, {
        cwd,
        accepted: result.accepted.map((a) => a.record),
        rejected: result.rejected,
        validation_result: result.validation_result,
        overlap_check: result.overlap_check,
        incomplete: result.incomplete,
        evidence_hash: evidenceHash,
    });
};
//# sourceMappingURL=capture-verify.js.map