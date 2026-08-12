/**
 * Pending transaction store — ADR-0021.
 *
 * Owns the monotonic prepare → verify → stage → apply → consume lifecycle
 * of a single capture pipeline run. Every mutation is an atomic rename so
 * no concurrent reader can observe a partial file.
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { markCaptureError } from './capture-outcome.js';
import { execGit, execGitOrThrow } from './git.js';
import type { RenderedGuardMatch } from './guard.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The three verification gaps, in canonical order (T-1024's closed vocabulary). */
export type GuardGap = 'history-unavailable' | 'shallow-history' | 'notes-unfetched';

export interface GuardAdvisory {
  matches: RenderedGuardMatch[];
  gaps: GuardGap[];
  disclosure: string;
}

export interface PendingRecord {
  version: 1;
  nonce: string;
  created_at: string;
  expires_at: string | null;
  phase: 'prepared' | 'verified' | 'staged' | 'applied' | 'consumed';
  consumed: boolean;
  verified_at: string | null;
  staged_at: string | null;
  applied_at: string | null;
  applied_record_hash: string | null;
  consumed_at: string | null;
  consumed_by: string | null;
  base_head: string;
  staged_diff_hash: string;
  staged_tree_oid: string;
  policy_identity_hash: string;
  source_hashes: { transcript: string; diff: string };
  evidence_hash: string | null;
  records: unknown[];
  validation_result: 'pass' | 'partial' | 'empty' | null;
  overlap_check: 'canonical_exact_only' | null;
  incomplete: boolean;
  guard_advisory?: GuardAdvisory | null;
  /**
   * Present — and only ever `true` — when the capture declared itself
   * unattended and the repository's policy consented (#511). Absent otherwise,
   * so a capture that made no declaration leaves byte-identical bytes on disk.
   */
  unattended?: boolean;
}

export class PendingFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PendingFormatError';
  }
}

// ---------------------------------------------------------------------------
// Nonce validation — trust boundary (CEO amendment 2)
// ---------------------------------------------------------------------------

const NONCE_RE = /^[0-9a-f]{32}$/;

const validateNonce = (nonce: string): void => {
  if (!NONCE_RE.test(nonce)) {
    throw new Error(`Invalid nonce: must be exactly 32 lowercase hex characters, got "${nonce}"`);
  }
};

// ---------------------------------------------------------------------------
// Path resolution — via git rev-parse --git-path (ADR-0021, per-worktree)
// ---------------------------------------------------------------------------

const pendingDir = (cwd: string): string => {
  const reported = execGitOrThrow(['rev-parse', '--git-path', 'commitlore/pending'], { cwd }).trim();
  return resolve(cwd, reported);
};

const pendingFilePath = (nonce: string, cwd: string): string => {
  validateNonce(nonce);
  const dir = pendingDir(cwd);
  return resolve(dir, `${nonce}.json`);
};

// ---------------------------------------------------------------------------
// Atomic write helper (pattern: claude-settings.ts:283-293)
// ---------------------------------------------------------------------------

const atomicWriteJson = (filePath: string, data: unknown): void => {
  const dir = resolve(filePath, '..');
  mkdirSync(dir, { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  const body = JSON.stringify(data, null, 2) + '\n';
  try {
    writeFileSync(temporary, body);
    renameSync(temporary, filePath);
  } catch (error: unknown) {
    try { unlinkSync(temporary); } catch { /* best-effort cleanup */ }
    const thrown = error instanceof Error ? error : new Error(String(error));
    throw markCaptureError(thrown, 'operational');
  }
};

// ---------------------------------------------------------------------------
// Point of no return — one definition, two readers (#367)
// ---------------------------------------------------------------------------

const COMMIT_ID_RE = /^[0-9a-f]{40}$/;

/**
 * The current commit, or null when there is not one to read (unborn branch,
 * broken repository). Never throws: both callers treat "cannot tell" as an
 * answer rather than a failure.
 */
export const resolveHead = (cwd: string): string | null => {
  const result = execGit(['rev-parse', 'HEAD'], { cwd });
  if (result.code !== 0) return null;
  const head = result.stdout.trim();
  return COMMIT_ID_RE.test(head) ? head : null;
};

/**
 * Whether HEAD has left this transaction's base behind.
 *
 * This is the point of no return for anything before `staged`:
 * `stageCaptureRecord` refuses outright when `base_head` is not the current
 * HEAD, so once this is true no amount of waiting can advance the transaction.
 * `pending ls` reports it as `stale` and gc uses it to decide what can never be
 * finalised — deliberately the same function, so the listing and the collector
 * cannot drift into disagreeing about the same file.
 *
 * Undeterminable input answers `false`: no readable HEAD, or no well-formed
 * recorded base, means the caller must fail closed rather than guess.
 */
export const headHasMovedPast = (baseHead: unknown, head: string | null): boolean => {
  if (head === null) return false;
  if (typeof baseHead !== 'string' || !COMMIT_ID_RE.test(baseHead)) return false;
  return baseHead !== head;
};

/**
 * Whether this transaction can no longer reach a commit — the question `pending
 * ls` prints as `stale` and doctor reads as a lost capture (#584).
 *
 * `headHasMovedPast` alone cannot answer it. A `consumed` transaction's
 * `base_head` is behind HEAD *by construction*: the commit that consumed it is
 * what moved HEAD past it, and `consumed_by` names that commit. So the gap the
 * predicate measures is the signature of success on this phase, and reading it
 * as staleness made every completed capture report itself as a decision that
 * was never written — inverting the one alarm a user runs doctor to trust.
 *
 * Only `consumed` is excluded. `applied` looks similar and is not: the record
 * hash is stamped before the commit object exists, so a commit the user aborted
 * leaves an applied transaction whose decision really did go nowhere. Staleness
 * there is a real warning, and the fix for a false alarm must not silence it.
 */
export const pendingIsStale = (
  record: Pick<PendingRecord, 'phase' | 'base_head'>,
  head: string | null,
): boolean => {
  if (record.phase === 'consumed') return false;
  return headHasMovedPast(record.base_head, head);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CreatePendingOptions {
  cwd: string;
  source_hashes: { transcript: string; diff: string };
  staged_diff_hash: string;
  staged_tree_oid: string;
  policy_identity_hash: string;
  guard_advisory?: GuardAdvisory | null;
  /** Set only when prepare accepted an unattended declaration (#511). */
  unattended?: boolean;
}

/**
 * The in-memory form of a newly prepared transaction.
 *
 * `createPending` persists this exact shape. Read-only callers such as capture
 * shadow use the same transaction input without first creating a file they
 * would have to clean up afterwards.
 */
export const makePreparedPending = (
  opts: CreatePendingOptions & { nonce: string; base_head: string; created_at?: string },
): PendingRecord => {
  validateNonce(opts.nonce);
  if (!/^[0-9a-f]{40}$/.test(opts.base_head)) {
    throw new Error('Cannot resolve HEAD — is this a git repository with at least one commit?');
  }

  return {
    version: 1,
    nonce: opts.nonce,
    created_at: opts.created_at ?? new Date().toISOString(),
    // CEO amendment 1: expires_at is null while phase is prepared or verified
    expires_at: null,
    phase: 'prepared',
    consumed: false,
    verified_at: null,
    staged_at: null,
    applied_at: null,
    applied_record_hash: null,
    consumed_at: null,
    consumed_by: null,
    base_head: opts.base_head,
    staged_diff_hash: opts.staged_diff_hash,
    staged_tree_oid: opts.staged_tree_oid,
    policy_identity_hash: opts.policy_identity_hash,
    source_hashes: opts.source_hashes,
    evidence_hash: null,
    records: [],
    validation_result: null,
    overlap_check: null,
    incomplete: false,
    guard_advisory: opts.guard_advisory ?? null,
    // Written only when true: the stored bytes of an ordinary capture must be
    // exactly what they were before the setting existed (#511).
    ...(opts.unattended === true ? { unattended: true } : {}),
  };
};

/**
 * Creates a pending transaction in `prepared` phase.
 * Returns the nonce (32 hex chars).
 */
export const createPending = (opts: CreatePendingOptions): string => {
  const nonce = randomBytes(16).toString('hex');
  const baseHead = execGitOrThrow(['rev-parse', 'HEAD'], { cwd: opts.cwd }).trim();
  const record = makePreparedPending({ ...opts, nonce, base_head: baseHead });

  const filePath = pendingFilePath(nonce, opts.cwd);
  atomicWriteJson(filePath, record);
  return nonce;
};

/**
 * The nonces of every pending transaction in this repository, sorted oldest name
 * first so a listing is stable between runs.
 *
 * A missing directory means a repository has never captured and therefore has
 * nothing pending. An unreadable directory is deliberately distinct: callers
 * must not turn an unknown pending state into an empty one.
 */
export type PendingDirectoryState = 'ready' | 'absent' | 'unreadable';

export interface PendingNonceList {
  state: PendingDirectoryState;
  nonces: string[];
  /** A stable filesystem error code when the pending directory could not be read. */
  error: string | null;
}

const errorCode = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'unknown';

const UNREADABLE_PENDING_FILE = 'commitloreUnreadablePendingFile';

export const isUnreadablePendingFile = (error: unknown): boolean =>
  error instanceof Error &&
  (error as unknown as Record<string, unknown>)[UNREADABLE_PENDING_FILE] === true;

export const listPendingNonces = (cwd: string): PendingNonceList => {
  // Resolving the path and reading it are different questions, and collapsing
  // them puts "this is not a repository" in the same bucket as "the directory
  // is there and I was refused". The first is an absence — there is no pending
  // state where there is no repository — and the second is the unknown this
  // state exists to report. A git that cannot answer produces no errno either,
  // so the collapsed form reported `unreadable` with the error `unknown`.
  let dir: string;
  try {
    dir = pendingDir(cwd);
  } catch {
    return { state: 'absent', nonces: [], error: null };
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') return { state: 'absent', nonces: [], error: null };
    return { state: 'unreadable', nonces: [], error: code };
  }
  return {
    state: 'ready',
    nonces: entries
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter((nonce) => /^[0-9a-f]{32}$/.test(nonce))
      .sort(),
    error: null,
  };
};

export interface ReadPendingOptions {
  cwd: string;
}

/**
 * Reads a pending transaction by nonce.
 * Returns null if the file is absent.
 * Throws PendingFormatError for corrupt or unknown-version content.
 * Throws a marked plain Error when the file exists but cannot be read.
 */
export const readPending = (nonce: string, opts: ReadPendingOptions): PendingRecord | null => {
  validateNonce(nonce);
  const filePath = pendingFilePath(nonce, opts.cwd);

  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;

    const unreadable = new Error(
      `Could not read pending file for nonce ${nonce} at ${filePath} (${code})`,
    );
    Object.defineProperty(unreadable, UNREADABLE_PENDING_FILE, { value: true });
    unreadable.cause = error;
    throw unreadable;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new PendingFormatError(`Corrupt pending file for nonce ${nonce}: invalid JSON`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new PendingFormatError(`Corrupt pending file for nonce ${nonce}: not an object`);
  }

  const obj = parsed as Record<string, unknown>;
  if (obj['version'] !== 1) {
    throw new PendingFormatError(
      `Unsupported pending file version ${String(obj['version'])} for nonce ${nonce}`,
    );
  }

  return obj as unknown as PendingRecord;
};

export interface StoreVerificationOptions {
  cwd: string;
  accepted: unknown[];
  rejected: unknown[];
  validation_result: 'pass' | 'partial' | 'empty';
  overlap_check: 'canonical_exact_only' | null;
  incomplete: boolean;
  evidence_hash: string;
}

/**
 * Stores verification results in the pending transaction.
 * Only succeeds if the current phase is 'prepared'.
 */
export const storeVerification = (nonce: string, opts: StoreVerificationOptions): boolean => {
  validateNonce(nonce);
  const record = readPending(nonce, { cwd: opts.cwd });
  if (!record) return false;
  if (record.phase !== 'prepared') return false;

  const now = new Date().toISOString();
  const updated: PendingRecord = {
    ...record,
    phase: 'verified',
    verified_at: now,
    // CEO amendment 1: expires_at remains null in verified phase
    expires_at: null,
    records: opts.accepted,
    evidence_hash: opts.evidence_hash,
    validation_result: opts.validation_result,
    overlap_check: opts.overlap_check,
    incomplete: opts.incomplete,
  };

  const filePath = pendingFilePath(nonce, opts.cwd);
  atomicWriteJson(filePath, updated);
  return true;
};

export interface StagePendingOptions {
  cwd: string;
  expiryMinutes?: number;
}

/**
 * Stages a verified transaction.
 * Returns true on success, false if the phase is not 'verified'.
 * CEO amendment 1: stamps expires_at = staged_at + 5 minutes (or expiryMinutes).
 */
export const stagePending = (nonce: string, opts: StagePendingOptions): boolean => {
  validateNonce(nonce);
  const record = readPending(nonce, { cwd: opts.cwd });
  if (!record) return false;
  if (record.phase !== 'verified') return false;

  const now = new Date();
  const minutes = opts.expiryMinutes ?? 5;
  const expiresAt = new Date(now.getTime() + minutes * 60_000);

  const updated: PendingRecord = {
    ...record,
    phase: 'staged',
    staged_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  const filePath = pendingFilePath(nonce, opts.cwd);
  atomicWriteJson(filePath, updated);
  return true;
};

export interface MarkAppliedOptions {
  cwd: string;
}

/**
 * Records that the pending transaction was applied (trailer appended to commit message).
 * Only succeeds if phase is 'staged'.
 */
export const markApplied = (nonce: string, recordHash: string, opts: MarkAppliedOptions): boolean => {
  validateNonce(nonce);
  const record = readPending(nonce, { cwd: opts.cwd });
  if (!record) return false;
  if (record.phase !== 'staged') return false;

  const now = new Date().toISOString();
  const updated: PendingRecord = {
    ...record,
    phase: 'applied',
    applied_at: now,
    applied_record_hash: recordHash,
  };

  const filePath = pendingFilePath(nonce, opts.cwd);
  atomicWriteJson(filePath, updated);
  return true;
};

export interface DeletePendingOptions {
  cwd: string;
}

/**
 * Deletes a pending transaction file outright.
 *
 * Returns false when there was nothing to delete. This store deliberately holds
 * no opinion on *whether* a given transaction may be deleted — the phase policy
 * lives with the caller that has the user in front of it (`pending rm`), and gc
 * keeps its own. Adding a second copy of that policy here is how the two would
 * come to disagree.
 */
export const deletePending = (nonce: string, opts: DeletePendingOptions): boolean => {
  validateNonce(nonce);
  const filePath = pendingFilePath(nonce, opts.cwd);
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
};

export interface ConsumePendingOptions {
  cwd: string;
}

/**
 * Consumes a pending transaction after a successful commit.
 * Only succeeds if phase is 'applied' and consumed is false.
 */
export const consumePending = (nonce: string, commitSha: string, opts: ConsumePendingOptions): boolean => {
  validateNonce(nonce);
  const record = readPending(nonce, { cwd: opts.cwd });
  if (!record) return false;
  if (record.phase !== 'applied') return false;
  if (record.consumed) return false;

  const now = new Date().toISOString();
  const updated: PendingRecord = {
    ...record,
    phase: 'consumed',
    consumed: true,
    consumed_at: now,
    consumed_by: commitSha,
  };

  const filePath = pendingFilePath(nonce, opts.cwd);
  atomicWriteJson(filePath, updated);
  return true;
};
