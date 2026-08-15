import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Command } from 'commander';

import { resolvePolicy } from '../core/capture-policy.js';
import { execGit } from '../core/git.js';
import { markApplied, type PendingRecord } from '../core/pending.js';
import { parseRecordBlocks, serializeTrailers } from '../core/trailers.js';
import { FULL_OBJECT_ID_PATTERN, KNOWN_KEYS, type Trailer } from '../core/types.js';
import { captureHookFailOpen } from './capture-fail-open.js';
import { CHAINED_SUFFIX, HOOK_MODE, captureHookStub } from './commit-msg.js';

export const PREPARE_COMMIT_MSG_HOOK_MARKER = '# commitlore:prepare-commit-msg:v1';
export const PREPARE_COMMIT_MSG_HOOK_NAME = 'prepare-commit-msg';
export const PREPARE_COMMIT_MSG_CHAINED_HOOK_NAME = `${PREPARE_COMMIT_MSG_HOOK_NAME}${CHAINED_SUFFIX}`;

const RECORD_KEYS = new Set<string>(KNOWN_KEYS);

/**
 * Renamed from the shared body, not from the gate's text: this hook composes a
 * message, it never rejects one, so it takes the ending that lets the commit
 * through (#354). The two replacements below only rename — the marker, the
 * chained hook beside it, and the subcommand it execs.
 */
export const prepareCommitMsgStub = (): string =>
  captureHookStub()
    .replaceAll('commit-msg', PREPARE_COMMIT_MSG_HOOK_NAME)
    .replaceAll('validate --message-file "$1"', 'prepare-commit-msg "$@"');

const isRecordBlock = (trailers: readonly Trailer[]): boolean =>
  trailers.some((trailer) => RECORD_KEYS.has(trailer.key));

const squashMessagePath = (cwd: string): string | null => {
  const result = execGit(['rev-parse', '--git-path', 'SQUASH_MSG'], { cwd });
  if (result.code !== 0) return null;
  return resolve(cwd, result.stdout.trim());
};

const squashCommitIds = (message: string): readonly string[] => {
  const ids: string[] = [];
  // Git writes SQUASH_MSG itself and always spells these ids in full, so the
  // full-id pattern is what actually appears. Matching abbreviations here would
  // also catch a prose line in a squashed commit body that happens to begin
  // `commit ` followed by a short hex word, and then `git show` that.
  const pattern = new RegExp(`^commit (${FULL_OBJECT_ID_PATTERN})$`, 'gm');
  for (const match of message.matchAll(pattern)) {
    const id = match[1];
    if (id !== undefined) ids.push(id);
  }
  return ids;
};

const recordsFromSquashMessage = (cwd: string, message: string): readonly (readonly Trailer[])[] => {
  const blocks: Trailer[][] = [];
  for (const id of squashCommitIds(message)) {
    const result = execGit(['show', '--no-patch', '--format=%B', '--end-of-options', id], { cwd });
    if (result.code !== 0) {
      throw new Error(`could not read squashed commit ${id}: ${result.stderr.trim()}`);
    }
    blocks.push(...parseRecordBlocks(result.stdout).filter(isRecordBlock));
  }
  return blocks;
};

export const preserveSquashRecords = (messageFile: string, cwd = process.cwd()): boolean => {
  const squashPath = squashMessagePath(cwd);
  if (squashPath === null || !existsSync(squashPath)) return false;

  const draft = readFileSync(messageFile, 'utf8');
  if (parseRecordBlocks(draft).some(isRecordBlock)) return false;

  const blocks = recordsFromSquashMessage(cwd, readFileSync(squashPath, 'utf8'));
  if (blocks.length === 0) return false;

  const separator = draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(messageFile, `${draft}${separator}${blocks.map((block) => serializeTrailers([...block])).join('\n')}`);
  return true;
};

export interface PrepareCommitMsgHookResult {
  readonly code: 0 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

const prepareHookPath = (cwd: string): string => {
  const result = execGit(['rev-parse', '--git-path', `hooks/${PREPARE_COMMIT_MSG_HOOK_NAME}`], { cwd });
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'not a git repository');
  return resolve(cwd, result.stdout.trim());
};

const hookSuccess = (line: string): PrepareCommitMsgHookResult => ({ code: 0, stdout: `${line}\n`, stderr: '' });
const hookFailure = (line: string): PrepareCommitMsgHookResult => ({ code: 2, stdout: '', stderr: `commitlore: ${line}\n` });

const writePrepareHook = (path: string): void => {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, prepareCommitMsgStub(), { mode: HOOK_MODE });
  chmodSync(temporary, HOOK_MODE);
  renameSync(temporary, path);
};

export const installPrepareCommitMsgHook = (cwd = process.cwd()): PrepareCommitMsgHookResult => {
  let path: string;
  try {
    path = prepareHookPath(cwd);
    mkdirSync(resolve(path, '..'), { recursive: true });
  } catch (error) {
    return hookFailure(error instanceof Error ? error.message : String(error));
  }

  try {
    if (existsSync(path)) {
      const current = readFileSync(path, 'utf8');
      if (!current.includes(PREPARE_COMMIT_MSG_HOOK_MARKER)) {
        return hookFailure(`${path} is not a commitlore hook — left in place`);
      }
      if (current === prepareCommitMsgStub()) {
        return hookSuccess(`${PREPARE_COMMIT_MSG_HOOK_NAME} hook already installed: ${path} (unchanged)`);
      }
      writePrepareHook(path);
      return hookSuccess(`updated ${PREPARE_COMMIT_MSG_HOOK_NAME} hook: ${path}`);
    }
    writePrepareHook(path);
    return hookSuccess(`installed ${PREPARE_COMMIT_MSG_HOOK_NAME} hook: ${path}`);
  } catch (error) {
    return hookFailure(`could not install the ${PREPARE_COMMIT_MSG_HOOK_NAME} hook: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// ---------------------------------------------------------------------------
// Capture application guard — ADR-0021 §3, five-gate check (T-1005)
// ---------------------------------------------------------------------------

/**
 * Resolve the pending directory via `git rev-parse --git-path`.
 * Returns null if not in a git repo or the path cannot be resolved.
 */
const resolvePendingDir = (cwd: string): string | null => {
  const result = execGit(['rev-parse', '--git-path', 'commitlore/pending'], { cwd });
  if (result.code !== 0) return null;
  return resolve(cwd, result.stdout.trim());
};

/**
 * Read a pending file safely. Returns null on any error.
 */
const readPendingFile = (filePath: string): PendingRecord | null => {
  try {
    const content = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed['version'] !== 1) return null;
    return parsed as unknown as PendingRecord;
  } catch {
    return null;
  }
};

/**
 * Serialize the records array's trailers into a canonical trailer block string.
 */
const buildTrailerBlock = (records: unknown[]): string => {
  const blocks: string[] = [];
  for (const rec of records) {
    if (typeof rec !== 'object' || rec === null) continue;
    const r = rec as { trailers?: unknown[] };
    if (!Array.isArray(r.trailers)) continue;
    const trailers = r.trailers as Trailer[];
    const serialized = serializeTrailers(trailers);
    if (serialized) blocks.push(serialized);
  }
  return blocks.join('\n');
};

/**
 * Check if the message already contains a Record-Id from the pending file.
 */
const messageContainsRecordId = (message: string, records: unknown[]): boolean => {
  for (const rec of records) {
    if (typeof rec !== 'object' || rec === null) continue;
    const r = rec as { trailers?: unknown[] };
    if (!Array.isArray(r.trailers)) continue;
    for (const t of r.trailers as Trailer[]) {
      if (t.key === 'Record-Id' && message.includes(`Record-Id: ${t.value}`)) {
        return true;
      }
    }
  }
  return false;
};

/** The first Record-Id is the most useful name for a dropped capture. */
const captureLabel = (pending: PendingRecord): string => {
  for (const rec of pending.records) {
    if (typeof rec !== 'object' || rec === null) continue;
    const trailers = (rec as { trailers?: unknown[] }).trailers;
    if (!Array.isArray(trailers)) continue;
    for (const trailer of trailers as Trailer[]) {
      if (trailer.key === 'Record-Id') return trailer.value;
    }
  }
  return pending.nonce;
};

/**
 * A path-limited commit and some other ordinary commit forms give hooks an
 * alternate index. The capture must remain bound to the full index it was
 * verified against, but naming this case is much more actionable than a bare
 * hash mismatch.
 */
const usesTemporaryCommitIndex = (cwd: string): boolean => {
  const currentIndex = process.env.GIT_INDEX_FILE;
  if (!currentIndex) return false;

  // `--git-path index` itself honours GIT_INDEX_FILE, so it would merely echo
  // the temporary path we are trying to recognise. The repository git-dir does
  // not, and its index is Git's normal persistent index for this worktree.
  const gitDir = execGit(['rev-parse', '--git-dir'], { cwd });
  if (gitDir.code !== 0) return false;
  return resolve(cwd, currentIndex) !== resolve(cwd, gitDir.stdout.trim(), 'index');
};

const reportDiffMismatch = (pending: PendingRecord, cwd: string): void => {
  const label = captureLabel(pending);
  const detail = usesTemporaryCommitIndex(cwd)
    ? 'this commit uses a temporary index whose staged diff differs from the verified capture'
    : 'the staged diff differs from the verified capture';
  process.stderr.write(
    `commitlore: staged capture ${label} was not attached: ${detail}; the record remains pending.\n`,
  );
};

/**
 * Newer eligible capture first. `created_at` is the recorded instant, not the
 * nonce filename — the filename is `randomBytes(16)` hex, so lexicographic
 * order is a coin flip (#591).
 *
 * An `applied` file after a failed commit stays eligible (ADR-0021 §4, gate-a
 * scenario 6). It is not ranked below `staged`. Preferring staged would attach
 * an older leftover staged file over the capture that just nearly landed.
 * Marking `applied` abandoned was rejected: Git has no hook for a failed
 * commit, and abandoning would break the unchanged-index retry.
 */
export const compareCaptureCandidates = (
  left: Pick<PendingRecord, 'created_at' | 'nonce'>,
  right: Pick<PendingRecord, 'created_at' | 'nonce'>,
): number => {
  const byCreated = right.created_at.localeCompare(left.created_at);
  if (byCreated !== 0) return byCreated;
  return left.nonce.localeCompare(right.nonce);
};

/**
 * The five-gate application check. Scans pending directory for a staged or
 * applied-but-unconsumed record that passes all five gates. The newest eligible
 * candidate wins. On no match or any error, does nothing (never blocks the
 * commit).
 */
const applyCaptureRecord = (messageFile: string, cwd: string): void => {
  // Fast path: resolve pending directory
  const pendingDirPath = resolvePendingDir(cwd);
  if (!pendingDirPath || !existsSync(pendingDirPath)) return;

  // List pending files
  let files: string[];
  try {
    files = readdirSync(pendingDirPath).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return;
  }

  if (files.length === 0) return;

  // Resolve current state for gate checks
  const headResult = execGit(['rev-parse', 'HEAD'], { cwd });
  if (headResult.code !== 0) return;
  const currentHead = headResult.stdout.trim();

  const diffResult = execGit(['diff', '--cached'], { cwd });
  if (diffResult.code !== 0) return;
  const currentDiffHash = createHash('sha256').update(diffResult.stdout).digest('hex');

  const currentPolicyHash = resolvePolicy(cwd).identityHash;
  const now = Date.now();

  // Read current message to check for existing Record-Id
  let currentMessage: string;
  try {
    currentMessage = readFileSync(messageFile, 'utf8');
  } catch {
    return;
  }

  const eligible: PendingRecord[] = [];
  for (const file of files) {
    const filePath = resolve(pendingDirPath, file);
    const pending = readPendingFile(filePath);
    if (!pending) continue;

    // Only staged or applied-but-unconsumed records are eligible
    if (pending.phase !== 'staged' && pending.phase !== 'applied') continue;

    // Gate 4: Unconsumed
    if (pending.consumed) continue;

    // Gate 1: HEAD unchanged
    if (pending.base_head !== currentHead) continue;

    // Gate 2: Staged diff unchanged
    if (pending.staged_diff_hash !== currentDiffHash) {
      reportDiffMismatch(pending, cwd);
      continue;
    }

    // Gate 3: Unexpired (expires_at must be non-null and in the future)
    if (!pending.expires_at) continue;
    if (now >= new Date(pending.expires_at).getTime()) continue;

    // Gate 5: Policy identity unchanged
    if (pending.policy_identity_hash !== currentPolicyHash) continue;

    eligible.push(pending);
  }

  eligible.sort(compareCaptureCandidates);
  const pending = eligible[0];
  if (!pending) return;

  // All five gates pass. Check if already present (dedup).
  if (messageContainsRecordId(currentMessage, pending.records)) return;

  // Build and append the trailer block
  const trailerBlock = buildTrailerBlock(pending.records);
  if (!trailerBlock) return;

  const separator = currentMessage.endsWith('\n\n')
    ? ''
    : currentMessage.endsWith('\n')
      ? '\n'
      : '\n\n';
  writeFileSync(messageFile, `${currentMessage}${separator}${trailerBlock}`);

  // Mark applied — hash the canonical trailer block, not the full message
  const recordHash = createHash('sha256').update(trailerBlock).digest('hex');
  try {
    markApplied(pending.nonce, recordHash, { cwd });
  } catch {
    // Best-effort: message already written, crash here is recoverable by post-commit
  }
};

/**
 * Where this commit's amend marker lives (#638).
 *
 * `--git-path` puts it in the same place COMMIT_EDITMSG lives, which means a
 * linked worktree gets its own. A single file at the repository root would let
 * two worktrees committing at once read each other's answer; matching git's own
 * scope is the right bound, and no stronger one is available to us anyway.
 */
const amendMarkerPath = (cwd: string): string | null => {
  const result = execGit(['rev-parse', '--git-path', 'commitlore-amend'], { cwd });
  return result.code === 0 ? resolve(cwd, result.stdout.trim()) : null;
};

/**
 * Record whether this commit replaces HEAD, for the `commit-msg` that follows.
 *
 * Only `prepare-commit-msg` can see this: git hands it `commit` as the source
 * and HEAD as the sha for `git commit --amend`, while `commit-msg` gets nothing
 * that distinguishes an amend from an ordinary commit.
 *
 * The three conditions are all required, and anything unrecognised is **not**
 * an amend. `rebase -i` reword produces `commit` and `HEAD` identically to an
 * amend and is told apart only by a rebase being in progress — measured, not
 * assumed. Enumerating operations to exclude would break the moment git adds
 * one, so the default has to be the safe direction, and the two mistakes are
 * not symmetric: calling a non-amend an amend drops HEAD from the duplicate
 * check and lets a real identity collision through, while the reverse is only
 * the inconvenience #638 describes.
 */
const IN_PROGRESS_MARKERS = [
  'rebase-merge',
  'rebase-apply',
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
  'sequencer',
] as const;

export const recordAmendIntent = (cwd: string, source?: string, sha?: string): void => {
  const marker = amendMarkerPath(cwd);
  if (marker === null) return;
  const operationInProgress = IN_PROGRESS_MARKERS.some((name) => {
    const path = execGit(['rev-parse', '--git-path', name], { cwd });
    return path.code === 0 && existsSync(resolve(cwd, path.stdout.trim()));
  });
  const head = execGit(['rev-parse', 'HEAD'], { cwd });
  const resolvedSha = sha === undefined ? '' : execGit(['rev-parse', sha], { cwd }).stdout.trim();
  const isAmend =
    source === 'commit' &&
    !operationInProgress &&
    head.code === 0 &&
    resolvedSha !== '' &&
    resolvedSha === head.stdout.trim();
  try {
    if (isAmend) writeFileSync(marker, `${head.stdout.trim()}\n`, 'utf8');
    else rmSync(marker, { force: true });
  } catch {
    // A marker that cannot be written leaves the previous behaviour, which
    // refuses the amend. That is the safe direction and needs no announcement.
  }
};

export const register = (program: Command): void => {
  program
    .command('prepare-commit-msg')
    .argument('<message-file>')
    .argument('[source]')
    .argument('[sha]')
    .description('internal hook command: append records from a local squash draft')
    .action((messageFile: string, source?: string, sha?: string) => {
      recordAmendIntent(process.cwd(), source, sha);
      preserveSquashRecords(messageFile);
      try {
        applyCaptureRecord(messageFile, process.cwd());
      } catch (error: unknown) {
        captureHookFailOpen('capture application error', error);
      }
    });
};
