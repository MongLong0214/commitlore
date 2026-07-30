/**
 * Capture prepare phase — T-1002, ADR-0021.
 *
 * Computes binding conditions (hashes, HEAD, tree OID), generates the prompt
 * contract via `buildHarvestPrompt`, and persists the prepared transaction
 * through `createPending`.
 */

import { createHash, randomBytes } from 'node:crypto';
import { execGitOrThrow } from './git.js';
import { guard, renderGuardMatch, type GuardResult } from './guard.js';
import { buildHarvestPrompt } from './harvest.js';
import { createPending, type GuardAdvisory, type GuardGap } from './pending.js';

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
// Guard advisory — ADR-0020, T-1109
// ---------------------------------------------------------------------------

const GUARD_DISCLOSURE =
  'Experimental advisory: precision 44.8%, recall 22.0% on the 417-decision corpus. ' +
  'An empty `matched` array does not guarantee the proposal avoids every ruled-out alternative.';

/**
 * Extracts file paths from a unified diff (git diff --cached output).
 * Parses `diff --git a/<path> b/<path>` lines.
 */
const extractPathsFromDiff = (diff: string): string[] => {
  const paths = new Set<string>();
  for (const line of diff.split('\n')) {
    const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (m && m[1] && m[2]) {
      paths.add(m[1]);
      paths.add(m[2]);
    }
  }
  return [...paths];
};

/**
 * Maps GuardResult availability fields into the closed gap vocabulary.
 */
const deriveGuardGaps = (result: GuardResult): GuardGap[] => {
  const gaps: GuardGap[] = [];
  if (result.history === 'unavailable') gaps.push('history-unavailable');
  if (result.shallow) gaps.push('shallow-history');
  if (result.notes === 'unfetched') gaps.push('notes-unfetched');
  return gaps;
};

/**
 * Compute the guard advisory for a capture. Never throws — any error becomes
 * a recorded gap. The capture must always succeed regardless of guard outcome.
 */
const computeGuardAdvisory = (opts: {
  proposal: string;
  paths: readonly string[];
  cwd: string;
}): GuardAdvisory => {
  try {
    const result = guard({
      proposal: opts.proposal,
      ...(opts.paths.length > 0 ? { paths: opts.paths } : {}),
      cwd: opts.cwd,
    });
    return {
      matches: result.matches.map(renderGuardMatch),
      gaps: deriveGuardGaps(result),
      disclosure: GUARD_DISCLOSURE,
    };
  } catch {
    // Guard failure degrades to a recorded gap — never a capture failure
    return {
      matches: [],
      gaps: ['history-unavailable'],
      disclosure: GUARD_DISCLOSURE,
    };
  }
};

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
  guard_advisory: GuardAdvisory | null;
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

  // 7. Compute guard advisory — T-1109
  //    Uses the transcript as proposal text (the "draft record text") and the
  //    staged diff's paths as the path scope.
  const diffPaths = extractPathsFromDiff(diff);
  const advisory = computeGuardAdvisory({
    proposal: transcript,
    paths: diffPaths,
    cwd,
  });

  // 8. Persist the prepared transaction via createPending (T-1001)
  const nonce = createPending({
    cwd,
    source_hashes: sourceHashes,
    staged_diff_hash: stagedDiffHash,
    staged_tree_oid: stagedTreeOid,
    policy_identity_hash: policyIdentityHash,
    guard_advisory: advisory,
  });

  return {
    nonce,
    base_head: baseHead,
    staged_diff_hash: stagedDiffHash,
    staged_tree_oid: stagedTreeOid,
    policy_identity_hash: policyIdentityHash,
    source_hashes: sourceHashes,
    prompt,
    guard_advisory: advisory,
  };
};
