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
import { POLICY_FILE_NAME, resolvePolicy } from './capture-policy.js';
import { createPending, type GuardAdvisory, type GuardGap } from './pending.js';

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
  /**
   * Declare that this capture runs without asking: the pipeline prepares,
   * verifies and stages it with no person in the loop (ADR-0030, #511).
   * Refused unless the repository opted in — `.commitlore-policy.json` with
   * `"unattended": true` and mode `auto` — because consent is a repository
   * setting, not a caller's say-so.
   */
  unattended?: boolean;
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
  /**
   * A named reason when a policy file exists but could not be used (T-1110).
   * The defaults ran, and `policy_identity_hash` describes them — but the caller
   * must say so: silently ignoring an unusable policy file would let a user
   * believe a setting applied.
   */
  policy_error: string | null;
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

  // 5. Resolve the policy and take its identity (T-1110, ADR-0021 §7). A policy
  //    file that cannot be used yields the defaults plus a named reason; the
  //    identity then describes the defaults, which is the policy that ran.
  const policy = resolvePolicy(cwd);
  const policyIdentityHash = policy.identityHash;
  const policyError = policy.error;

  // ADR-0030 decision 5. `off` refuses here rather than later: no transcript is
  // hashed, no candidate is drafted, and no pending file is written. A switch
  // that still produced a candidate and discarded it would leave the user's
  // session text hashed on disk for a feature they turned off.
  if (policy.policy.mode === 'off') {
    throw new Error(
      `capture is off for this repository (${POLICY_FILE_NAME}: mode "off") — nothing was prepared`,
    );
  }

  // ADR-0030, #511. Declaring a capture unattended is claiming the repository
  // consented to capture without asking; prepare is the one moment that can
  // check the claim before anything is written. Refused without the consent:
  // no transcript hashed, no candidate drafted, no pending file — the same
  // shape as `off`'s refusal, for the same reason.
  if (
    opts.unattended === true &&
    !(policy.policy.mode === 'auto' && policy.policy.unattended)
  ) {
    throw new Error(
      `unattended capture is off for this repository (${POLICY_FILE_NAME}: "unattended": true with mode "auto" opts in) — nothing was prepared`,
    );
  }

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
    ...(opts.unattended === true ? { unattended: true } : {}),
  });

  return {
    nonce,
    base_head: baseHead,
    staged_diff_hash: stagedDiffHash,
    staged_tree_oid: stagedTreeOid,
    policy_identity_hash: policyIdentityHash,
    source_hashes: sourceHashes,
    prompt,
    policy_error: policyError,
    guard_advisory: advisory,
  };
};
