/**
 * Capture prepare phase — T-1002, ADR-0021.
 *
 * Computes binding conditions (hashes, HEAD, tree OID), generates the prompt
 * contract via `buildHarvestPrompt`, and persists the prepared transaction
 * through `createPending`.
 */

import { createHash, randomBytes } from 'node:crypto';
import { execGitOrThrow } from './git.js';
import { buildHarvestPrompt } from './harvest.js';
import { createPending } from './pending.js';

// ---------------------------------------------------------------------------
// Policy defaults — ADR-0021 §7
// ---------------------------------------------------------------------------

const HARDCODED_DEFAULTS = {
  mode: 'suggest',
  max_records_per_commit: 1,
  require_verified_evidence: true,
} as const;

const computePolicyIdentityHash = (): string =>
  createHash('sha256').update(JSON.stringify(HARDCODED_DEFAULTS)).digest('hex');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrepareCaptureOptions {
  cwd: string;
  transcript: string;
}

export interface PrepareResult {
  nonce: string;
  base_head: string;
  staged_diff_hash: string;
  staged_tree_oid: string;
  policy_identity_hash: string;
  source_hashes: { transcript: string; diff: string };
  prompt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Prepares a capture context: computes all binding conditions, generates
 * the prompt contract, and persists a `phase:"prepared"` transaction.
 *
 * CEO amendment 1: `expires_at` is written as `null` — expiry is stamped
 * only when stage succeeds (`staged_at + 5 minutes`).
 *
 * CEO amendment 2: nonce is 32 lowercase hex chars (`randomBytes(16)`),
 * satisfying the store's `^[0-9a-f]{32}$` validation.
 */
export const prepareCaptureContext = (opts: PrepareCaptureOptions): PrepareResult => {
  const { cwd, transcript } = opts;

  // 1. Resolve HEAD → base_head (fail-closed: throw if no HEAD)
  const baseHead = execGitOrThrow(['rev-parse', 'HEAD'], { cwd }).trim();
  if (!/^[0-9a-f]{40}$/.test(baseHead)) {
    throw new Error('Cannot resolve HEAD — is this a git repository with at least one commit?');
  }

  // 2. Compute sha256(git diff --cached) → staged_diff_hash
  const diff = execGitOrThrow(['diff', '--cached'], { cwd });
  const stagedDiffHash = createHash('sha256').update(diff).digest('hex');

  // 3. Resolve git write-tree → staged_tree_oid
  const stagedTreeOid = execGitOrThrow(['write-tree'], { cwd }).trim();

  // 4. Compute source hashes (transcript and diff)
  const transcriptHash = createHash('sha256').update(transcript).digest('hex');
  const sourceHashes = { transcript: transcriptHash, diff: stagedDiffHash };

  // 5. Compute policy identity hash
  const policyIdentityHash = computePolicyIdentityHash();

  // 6. Build the prompt contract via buildHarvestPrompt
  const prompt = buildHarvestPrompt({ transcript, diff });

  // 7. Persist the prepared transaction via createPending (T-1001)
  const nonce = createPending({
    cwd,
    source_hashes: sourceHashes,
    staged_diff_hash: stagedDiffHash,
    staged_tree_oid: stagedTreeOid,
    policy_identity_hash: policyIdentityHash,
  });

  return {
    nonce,
    base_head: baseHead,
    staged_diff_hash: stagedDiffHash,
    staged_tree_oid: stagedTreeOid,
    policy_identity_hash: policyIdentityHash,
    source_hashes: sourceHashes,
    prompt,
  };
};
