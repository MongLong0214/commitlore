/**
 * Capture stage phase — T-1004 (#196), ADR-0021.
 *
 * Advances a verified pending transaction to `staged` phase. On success,
 * stamps `staged_at` and `expires_at = staged_at + expiryMinutes` (default 5).
 *
 * CEO amendment (binding):
 * - `expires_at` is null for records in `prepared` or `verified` phase.
 * - `expires_at` is stamped only at stage success, anchored to `staged_at`.
 * - `expiryMinutes` overrides the window length only, never the anchor.
 * - Every binding (`base_head`, `staged_diff_hash`, `policy_identity_hash`,
 *   `staged_at`, `expires_at`) is computed server-side, never from the caller.
 * - Default maximum: one record per commit.
 */

import { createHash } from 'node:crypto';
import { readPending, stagePending, type PendingRecord } from './pending.js';
import { execGitOrThrow } from './git.js';

// ---------------------------------------------------------------------------
// Policy defaults — must match capture-prepare.ts (ADR-0021 §7)
// ---------------------------------------------------------------------------

const HARDCODED_DEFAULTS = {
  mode: 'suggest' as const,
  max_records_per_commit: 1,
  require_verified_evidence: true,
} as const;

const computePolicyIdentityHash = (): string =>
  createHash('sha256').update(JSON.stringify(HARDCODED_DEFAULTS)).digest('hex');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StageCaptureOptions {
  /** Nonce identifying the pending transaction (32 lowercase hex chars). */
  nonce: string;
  /** Working directory of the git repository. */
  cwd: string;
  /** Override the expiry window (minutes). Default: 5. */
  expiryMinutes?: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Stage a verified pending transaction.
 *
 * Returns the nonce on success, or `null` when there is nothing to stage
 * (empty verification result, incomplete, or wrong phase).
 *
 * Throws if the stored accepted-record count exceeds `max_records_per_commit`.
 */
export const stageCaptureRecord = (opts: StageCaptureOptions): string | null => {
  const { nonce, cwd, expiryMinutes } = opts;

  // 1. Re-read the transaction — requires phase "verified"
  const record = readPending(nonce, { cwd });
  if (!record) return null;
  if (record.phase !== 'verified') return null;

  // 2. Empty or incomplete verification → nothing to stage
  if (record.validation_result === 'empty') return null;
  if (record.incomplete) return null;

  // 3. Enforce max_records_per_commit (hardcoded: 1)
  if (record.records.length > HARDCODED_DEFAULTS.max_records_per_commit) {
    throw new Error(
      `Staging rejected: ${record.records.length} records exceed max_records_per_commit (${HARDCODED_DEFAULTS.max_records_per_commit})`,
    );
  }

  // 4. Recheck binding conditions (HEAD, staged diff, staged tree, policy)
  const currentHead = execGitOrThrow(['rev-parse', 'HEAD'], { cwd }).trim();
  if (currentHead !== record.base_head) {
    throw new Error(
      `Staging rejected: HEAD moved since prepare (expected ${record.base_head}, got ${currentHead})`,
    );
  }

  const currentDiff = execGitOrThrow(['diff', '--cached'], { cwd });
  const currentDiffHash = createHash('sha256').update(currentDiff).digest('hex');
  if (currentDiffHash !== record.staged_diff_hash) {
    throw new Error('Staging rejected: staged diff changed since prepare');
  }

  const currentTree = execGitOrThrow(['write-tree'], { cwd }).trim();
  if (currentTree !== record.staged_tree_oid) {
    throw new Error('Staging rejected: staged tree changed since prepare');
  }

  const currentPolicy = computePolicyIdentityHash();
  if (currentPolicy !== record.policy_identity_hash) {
    throw new Error('Staging rejected: policy identity changed since prepare');
  }

  // 5. Advance phase via stagePending (atomic rename)
  const stageOpts: { cwd: string; expiryMinutes?: number } =
    expiryMinutes !== undefined ? { cwd, expiryMinutes } : { cwd };
  const success = stagePending(nonce, stageOpts);
  if (!success) return null;

  return nonce;
};
