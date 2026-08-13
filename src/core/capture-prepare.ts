/**
 * Capture prepare phase — T-1002, ADR-0021.
 *
 * Computes binding conditions (hashes, HEAD, tree OID), generates the prompt
 * contract via `buildHarvestPrompt`, and persists the prepared transaction
 * through `createPending`.
 */

import { createHash, randomBytes } from 'node:crypto';
import { markCaptureError } from './capture-outcome.js';
import { execGitOrThrow } from './git.js';
import { guard, renderGuardMatch, type GuardResult } from './guard.js';
import { buildHarvestPrompt } from './harvest.js';
import { POLICY_FILE_NAME, resolvePolicy } from './capture-policy.js';
import {
  createPending,
  makePreparedPending,
  type GuardAdvisory,
  type GuardGap,
  type PendingRecord,
} from './pending.js';
import { isGitObjectId } from './types.js';

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
  readOnly?: boolean;
  trustedAuthors?: readonly string[];
}): GuardAdvisory => {
  try {
    const result = guard({
      proposal: opts.proposal,
      ...(opts.paths.length > 0 ? { paths: opts.paths } : {}),
      cwd: opts.cwd,
      ...(opts.readOnly === true ? { noIndex: true } : {}),
      ...(opts.trustedAuthors === undefined ? {} : { trustedAuthors: opts.trustedAuthors }),
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
  /** Authors whose guard-advisory records may render as directives. */
  trustedAuthors?: readonly string[];
  /**
   * Declare that this capture runs without asking: the pipeline prepares,
   * verifies and stages it with no person in the loop (ADR-0030, #511).
   * Refused unless the repository opted in — `.commitlore-policy.json` with
   * `"unattended": true` and mode `auto` — because consent is a repository
   * setting, not a caller's say-so.
   */
  unattended?: boolean;
}

/** A historical index snapshot supplied by the read-only shadow runner. */
export interface HistoricalCaptureSnapshot {
  /** HEAD immediately before the historical change was committed. */
  base_head: string;
  /** The patch that historical commit introduced. */
  staged_diff: string;
  /** The tree Git would have produced after staging that patch. */
  staged_tree_oid: string;
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

/** A prepared transaction that exists only in process memory. */
export interface ReadOnlyPrepareResult extends PrepareResult {
  pending: PendingRecord;
}

interface PreparedValues {
  base_head: string;
  staged_diff_hash: string;
  staged_tree_oid: string;
  policy_identity_hash: string;
  source_hashes: { transcript: string; diff: string };
  prompt: string;
  guard_advisory: GuardAdvisory | null;
  policy_error: string | null;
}

/**
 * The shared, side-effect-free half of prepare. The ordinary capture path and
 * historical shadow differ only in where their staged snapshot comes from and
 * whether the completed transaction is persisted.
 */
const prepareValues = (opts: {
  cwd: string;
  transcript: string;
  snapshot?: HistoricalCaptureSnapshot;
  readOnly: boolean;
  skipGuard?: boolean;
  unattended?: boolean;
  trustedAuthors?: readonly string[];
}): PreparedValues => {
  const { cwd, transcript, snapshot } = opts;

  const baseHead = snapshot?.base_head ?? execGitOrThrow(['rev-parse', 'HEAD'], { cwd }).trim();
  if (!isGitObjectId(baseHead)) {
    throw markCaptureError(
      new Error('Cannot resolve HEAD — is this a git repository with at least one commit?'),
      'operational',
    );
  }

  const diff = snapshot?.staged_diff ?? execGitOrThrow(['diff', '--cached'], { cwd });
  const stagedDiffHash = createHash('sha256').update(diff).digest('hex');

  const stagedTreeOid =
    snapshot?.staged_tree_oid ?? execGitOrThrow(['write-tree'], { cwd }).trim();
  if (!isGitObjectId(stagedTreeOid)) {
    throw markCaptureError(
      new Error('Cannot resolve staged tree — is this a git repository with at least one commit?'),
      'operational',
    );
  }

  const sourceHashes = {
    transcript: createHash('sha256').update(transcript).digest('hex'),
    diff: stagedDiffHash,
  };

  const policy = resolvePolicy(cwd);
  if (policy.policy.mode === 'off') {
    throw markCaptureError(
      new Error(
        `capture is off for this repository (${POLICY_FILE_NAME}: mode "off") — nothing was prepared`,
      ),
      'rejected',
    );
  }

  // ADR-0030, #511. Declaring a capture unattended is claiming the repository
  // consented to capture without asking; prepare is the one moment that can
  // check the claim before anything is written. Refused without the consent —
  // no pending file, nothing staged — the same shape as `off`'s refusal, for
  // the same reason. The read-only shadow never declares unattended, so a
  // repository's opt-in changes nothing about what shadow writes: nothing.
  if (
    opts.unattended === true &&
    !(policy.policy.mode === 'auto' && policy.policy.unattended)
  ) {
    throw markCaptureError(
      new Error(
        `unattended capture is off for this repository (${POLICY_FILE_NAME}: "unattended": true with mode "auto" opts in) — nothing was prepared`,
      ),
      'rejected',
    );
  }

  const diffPaths = extractPathsFromDiff(diff);
  const advisory = opts.skipGuard === true
    ? null
    : computeGuardAdvisory({
        proposal: transcript,
        paths: diffPaths,
        cwd,
        ...(opts.readOnly ? { readOnly: true } : {}),
        ...(opts.trustedAuthors === undefined ? {} : { trustedAuthors: opts.trustedAuthors }),
      });

  return {
    base_head: baseHead,
    staged_diff_hash: stagedDiffHash,
    staged_tree_oid: stagedTreeOid,
    policy_identity_hash: policy.identityHash,
    source_hashes: sourceHashes,
    prompt: buildHarvestPrompt({ transcript, diff }),
    guard_advisory: advisory,
    policy_error: policy.error,
  };
};

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
  const { cwd } = opts;
  const prepared = prepareValues({ ...opts, readOnly: false });

  // 8. Persist the prepared transaction via createPending (T-1001)
  const nonce = createPending({
    cwd,
    source_hashes: prepared.source_hashes,
    staged_diff_hash: prepared.staged_diff_hash,
    staged_tree_oid: prepared.staged_tree_oid,
    policy_identity_hash: prepared.policy_identity_hash,
    guard_advisory: prepared.guard_advisory,
    ...(opts.unattended === true ? { unattended: true } : {}),
  });

  return {
    nonce,
    base_head: prepared.base_head,
    staged_diff_hash: prepared.staged_diff_hash,
    staged_tree_oid: prepared.staged_tree_oid,
    policy_identity_hash: prepared.policy_identity_hash,
    source_hashes: prepared.source_hashes,
    prompt: prepared.prompt,
    policy_error: prepared.policy_error,
    guard_advisory: prepared.guard_advisory,
  };
};

/**
 * Prepare a historical capture without creating `.git/commitlore/pending`.
 *
 * This deliberately uses the same policy resolution, prompt construction,
 * hashes, and advisory as `prepareCaptureContext`; only the Git index snapshot
 * and the pending-store write are substituted.
 */
export const prepareCaptureContextReadOnly = (opts: PrepareCaptureOptions & {
  snapshot: HistoricalCaptureSnapshot;
  /** Guard is advisory-only; shadow may omit it to keep a large history scan bounded. */
  skipGuard?: boolean;
}): ReadOnlyPrepareResult => {
  const prepared = prepareValues({ ...opts, readOnly: true });
  const nonce = randomBytes(16).toString('hex');
  const pending = makePreparedPending({
    cwd: opts.cwd,
    nonce,
    base_head: prepared.base_head,
    source_hashes: prepared.source_hashes,
    staged_diff_hash: prepared.staged_diff_hash,
    staged_tree_oid: prepared.staged_tree_oid,
    policy_identity_hash: prepared.policy_identity_hash,
    guard_advisory: prepared.guard_advisory,
  });

  return {
    nonce,
    base_head: prepared.base_head,
    staged_diff_hash: prepared.staged_diff_hash,
    staged_tree_oid: prepared.staged_tree_oid,
    policy_identity_hash: prepared.policy_identity_hash,
    source_hashes: prepared.source_hashes,
    prompt: prepared.prompt,
    policy_error: prepared.policy_error,
    guard_advisory: prepared.guard_advisory,
    pending,
  };
};
