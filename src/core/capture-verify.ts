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

import { verifyDraft, type RejectedRecord, type VerifiedRecord } from './harvest-verify.js';
import { resolvePolicy } from './capture-policy.js';
const PROVENANCE_KEY = 'Provenance';
import { readPending, storeVerification, type PendingRecord } from './pending.js';
import { runQuery } from './query.js';
import { notesAvailability } from './notes.js';
import type { DraftRecord } from './harvest.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  activeRecordIds: Set<string>;
  activeCanonicalTuples: Set<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sha256 = (input: string): string =>
  createHash('sha256').update(input).digest('hex');

/** Extract Record-Id from a draft record's trailers. */
const recordIdOf = (record: DraftRecord): string | undefined =>
  record.trailers.find((t) => t.key === 'Record-Id')?.value;

/**
 * Canonical identity tuple for de-duplication: lowercased key + value, no scope
 * (scope is path, handled by the query layer). Two records with the same
 * canonical tuple are duplicates regardless of Record-Id.
 */
export const captureCanonicalTuple = (trailers: readonly { key: string; value: string }[]): string => {
  const keys = trailers
    .filter((t) => t.key !== 'Record-Id' && t.key !== 'Evidence' && t.key !== 'Provenance')
    .map((t) => `${t.key.toLowerCase()}=${t.value.toLowerCase()}`)
    .sort()
    .join('|');
  return keys;
};

/** Build the result classification. */
const classifyResult = (
  accepted: VerifiedRecord[],
  rejected: CaptureRejection[],
): 'pass' | 'partial' | 'empty' => {
  if (accepted.length === 0) return 'empty';
  if (rejected.length === 0) return 'pass';
  return 'partial';
};

/**
 * Read the active records exactly as verification does, without touching the
 * derived index. A caller with a known read-only history can provide it through
 * `VerifyCaptureOptions.history` instead.
 */
export const loadCaptureVerificationHistory = (cwd: string): CaptureVerificationHistory | null => {
  try {
    const activeRecordIds: Set<string> = new Set();
    const activeCanonicalTuples: Set<string> = new Set();
    const queryResult = runQuery({ cwd, noIndex: true });
    for (const rec of queryResult.records) {
      const idTrailer = rec.trailers.find((t) => t.key === 'Record-Id');
      if (idTrailer) activeRecordIds.add(idTrailer.value);

      const tuple = rec.trailers
        .filter(
          (t) =>
            t.key !== 'Record-Id' &&
            t.key !== 'Evidence' &&
            t.key !== 'Provenance',
        )
        .map((t) => `${t.key.toLowerCase()}=${t.value.toLowerCase()}`)
        .sort()
        .join('|');
      activeCanonicalTuples.add(tuple);
    }
    return { activeRecordIds, activeCanonicalTuples };
  } catch {
    return null;
  }
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
export const verifyCaptureRecords = (opts: VerifyCaptureOptions): VerifyCaptureResult => {
  const { nonce, draft, transcript, diff, cwd } = opts;

  const accepted: VerifiedRecord[] = [];
  const rejected: CaptureRejection[] = [];
  const persist = (result: VerifyCaptureResult): void => {
    if (opts.readOnly !== true) storeVerificationResult(nonce, cwd, result);
  };

  try {
    // 1. Re-read prepared transaction and verify source hashes
    const pending = opts.pending ?? readPending(nonce, { cwd });
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
      const result: VerifyCaptureResult = {
        accepted: [],
        rejected,
        validation_result: 'empty',
        incomplete: false,
        overlap_check: 'canonical_exact_only',
      };
      persist(result);
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
      const result: VerifyCaptureResult = {
        accepted: [],
        rejected,
        validation_result: 'empty',
        incomplete: false,
        overlap_check: 'canonical_exact_only',
      };
      persist(result);
      return result;
    }

    // 2. Check notes availability — unfetched means incomplete
    const notes = notesAvailability({ cwd });
    if (notes === 'unfetched') {
      const result: VerifyCaptureResult = {
        accepted: [],
        rejected: [],
        validation_result: 'empty',
        incomplete: true,
        overlap_check: 'canonical_exact_only',
      };
      persist(result);
      return result;
    }

    // 3. Load active records for duplicate checking
    const history = opts.history === undefined ? loadCaptureVerificationHistory(cwd) : opts.history;
    if (history === null) {
      // If we can't read active records, we cannot be sure → incomplete
      const result: VerifyCaptureResult = {
        accepted: [],
        rejected: [],
        validation_result: 'empty',
        incomplete: true,
        overlap_check: 'canonical_exact_only',
      };
      persist(result);
      return result;
    }
    const { activeRecordIds, activeCanonicalTuples } = history;

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
      const tuple = captureCanonicalTuple(verified.record.trailers);
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

    // ADR-0030. In `auto` the host stages without asking, so nobody read this
    // record — whatever the model wrote in its `Provenance:` line. Stamping
    // `drafted` here is the only moment the pipeline knows that for certain,
    // and grading caps a drafted record at `claim`.
    //
    // `suggest` is left alone: a host in that mode may have asked, and `stage`
    // has no way to tell whether it did (ADR-0028), so overwriting would be a
    // claim this code cannot support either way.
    if (resolvePolicy(cwd).policy.mode === 'auto') {
      for (const verified of accepted) {
        const trailers = verified.record.trailers.filter(
          (trailer) => trailer.key !== PROVENANCE_KEY,
        );
        trailers.push({ key: PROVENANCE_KEY, value: 'drafted' });
        verified.record.trailers = trailers;
      }
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
    const result: VerifyCaptureResult = {
      accepted,
      rejected,
      validation_result: validationResult,
      incomplete: false,
      overlap_check: 'canonical_exact_only',
    };

    persist(result);
    return result;
  } catch {
    // Never throws — return empty on any unhandled error
    const result: VerifyCaptureResult = {
      accepted: [],
      rejected: [],
      validation_result: 'empty',
      incomplete: false,
      overlap_check: 'canonical_exact_only',
    };
    // Best-effort store
    try {
      persist(result);
    } catch {
      // Ignore — we must never throw
    }
    return result;
  }
};

/**
 * Run the ordinary verifier against an in-memory transaction without writing a
 * verification result. This is intentionally a thin wrapper, so shadow keeps
 * every source, evidence, duplicate, and policy check the live path uses.
 */
export const verifyCaptureRecordsReadOnly = (
  opts: Omit<VerifyCaptureOptions, 'nonce' | 'pending' | 'readOnly'> & {
    nonce: string;
    pending: PendingRecord;
  },
): VerifyCaptureResult => verifyCaptureRecords({ ...opts, readOnly: true });

// ---------------------------------------------------------------------------
// Internal: store verification result in pending transaction
// ---------------------------------------------------------------------------

const storeVerificationResult = (
  nonce: string,
  cwd: string,
  result: VerifyCaptureResult,
): void => {
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
