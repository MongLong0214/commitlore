/**
 * The consideration binding: evidence that the capture flow ran against the
 * tree that is about to be committed, and what came out of it.
 *
 * The product enforces that the flow *ran*, never that a record exists. Those
 * are different claims and only the first one can be enforced honestly: an
 * agent that must produce a record will produce one, and a false record is
 * permanent. So the question a gate may ask is "was this tree considered", and
 * `records: []` is a complete, first-class answer to it.
 *
 * **Why this is not the pending transaction.** The three keys below are exactly
 * the ones `stageCaptureRecord` compares, and the obvious move is to let a
 * capture that found nothing settle the transaction and read that instead. It
 * was tried, shipped and reported (#1021): a verification accepting nothing
 * used to reach `verified`, and `pending ls` is the only way a host can ask
 * "is a capture staged for the commit about to happen". `verified` reads as
 * yes, so a host that built that check had every commit after the first empty
 * capture read as covered. The fix was to leave such a transaction `prepared`,
 * and that decision is load-bearing — this file exists because "a capture is
 * waiting" and "this tree was considered" are separate facts that must not
 * share one artifact.
 *
 * **What it is keyed to.** `head`, the staged diff's hash, and the effective
 * policy's identity hash — the same triple the staging gates already compare,
 * rather than a fourth identity of its own. The PRD this implements also asked
 * for `git write-tree`; that is left out deliberately, because it writes
 * objects into the database to answer a question these three already answer,
 * and a read that mutates is a poor thing to put on a hook's hot path.
 *
 * Every commit moves `head`, so no binding outlives the commit it was made
 * for. Staging anything changes the diff hash; editing policy changes the
 * policy hash. A stale file, a copied file, or one from another worktree fails
 * the comparison. The expiry is hygiene on top of that, not the mechanism.
 *
 * **What it does not defend against, stated plainly.** Anything running as this
 * user can write this file by hand. No secret can be hidden from such a
 * process, so the binding is not unforgeable against a deliberate agent — and
 * one of those could equally pass `--no-verify` or delete the hook. The threat
 * model is *inadvertence*: the agent that forgets. Against that, the legitimate
 * path is one tool call and the forge is three hashes and a JSON file.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { resolvePolicy } from './capture-policy.js';
import { execGit, execGitOrThrow } from './git.js';

/** Under the git directory, so a linked worktree keeps its own and none is committed. */
export const CONSIDERATION_GIT_PATH = 'commitlore/considered.json';

/**
 * The same five minutes a staged transaction gets, for the same reason: it is
 * the window in which the tree the flow examined is still the tree being
 * committed. A second number here would be a second answer to one question.
 */
export const CONSIDERATION_EXPIRY_MINUTES = 5;

const CONSIDERATION_VERSION = 1;

/** What a consideration is bound to. Null `head` is an unborn branch. */
export interface ConsiderationBinding {
  readonly head: string | null;
  readonly staged_diff_hash: string;
  readonly policy_identity_hash: string;
}

export interface Consideration extends ConsiderationBinding {
  readonly version: number;
  /** `empty` is a complete answer, not a failure to find one. */
  readonly outcome: 'empty' | 'recorded';
  readonly records: number;
  readonly created_at: string;
  /** Which build wrote it, so a mixed-runtime machine can be told apart. */
  readonly tool: string;
}

/** Why a binding does not cover the tree in front of us. */
export type ConsiderationGap =
  | 'none'
  | 'unreadable'
  | 'head-moved'
  | 'staged-diff-changed'
  | 'policy-changed'
  | 'expired';

export type ConsiderationVerdict =
  | { covered: true; consideration: Consideration }
  | { covered: false; gap: ConsiderationGap; consideration: Consideration | null };

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

/**
 * Absolute path, resolved through `git rev-parse --git-path` so a linked
 * worktree gets its own rather than the main checkout's (ADR-0021, the same
 * route pending files take).
 */
export const considerationPath = (cwd: string): string | null => {
  const result = execGit(['rev-parse', '--git-path', CONSIDERATION_GIT_PATH], { cwd });
  if (result.code !== 0) return null;
  const reported = result.stdout.trim();
  return reported === '' ? null : resolve(cwd, reported);
};

/**
 * What the tree in front of us hashes to right now.
 *
 * `head` is null on an unborn branch rather than an error: the first commit of
 * a repository is a commit like any other, and `rev-parse HEAD` failing there
 * is the normal case, not a broken one.
 */
/**
 * The staged diff, asked for in a way that makes it a function of the tree.
 *
 * A bare `git diff --cached` is a function of the tree *and the configuration*,
 * and two ordinary settings collapse it to nothing. Measured here:
 *
 *     diff.external = /usr/bin/true            103 bytes -> 0
 *     diff.relative = true, cwd in a subdir    103 bytes -> 0
 *
 * Zero bytes hash the same for every tree, so a binding made under either
 * setting would cover every later tree too -- a gate that opens itself on a
 * config nobody thought was security-relevant. `--no-ext-diff` and
 * `--no-relative` restore both, and `--no-textconv` closes the same shape for a
 * repository with a textconv filter.
 *
 * This is also the correction to why `git write-tree` was not used. The first
 * argument was that the diff hash already answers the question; it does not,
 * unless asked like this. The real reason to prefer the diff is that every
 * content change appears in its `index <old>..<new>` header, so binary files
 * and `-diff` attributes are covered without reading their contents -- and the
 * reason not to reach for `write-tree` is that it is one more identity to keep
 * in step, not that it is expensive.
 *
 * The staging gates in `capture-stage.ts`, `capture-prepare.ts` and
 * `capture-verify.ts` ask the bare form and inherit the weakness. Changing them
 * moves every hash in flight, so it is a separate decision with its own blast
 * radius rather than something to slip in here.
 */
const STAGED_DIFF_ARGS = ['diff', '--cached', '--no-ext-diff', '--no-relative', '--no-textconv'] as const;

export const currentBinding = (cwd: string): ConsiderationBinding => {
  const headResult = execGit(['rev-parse', 'HEAD'], { cwd });
  const head = headResult.code === 0 && headResult.stdout.trim() !== '' ? headResult.stdout.trim() : null;
  const diff = execGitOrThrow([...STAGED_DIFF_ARGS], { cwd });
  return {
    head,
    staged_diff_hash: sha256(diff),
    policy_identity_hash: resolvePolicy(cwd).identityHash,
  };
};

/** Atomic replacement, so an interrupted write never leaves invalid JSON. */
const writeAtomic = (path: string, contents: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  let mode: number | undefined;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    mode = undefined;
  }
  const temporary = `${path}.tmp-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(temporary, contents, mode === undefined ? {} : { mode });
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Never created, or already gone.
    }
    throw error;
  }
};

export interface WriteConsiderationOptions {
  readonly cwd: string;
  readonly outcome: 'empty' | 'recorded';
  readonly records: number;
  /** Injected so a test can pin the window rather than race a real clock. */
  readonly now?: Date;
  readonly tool?: string;
}

/**
 * Record that this tree was considered. Returns what was written, or null when
 * `cwd` is not inside a repository.
 */
export const writeConsideration = (opts: WriteConsiderationOptions): Consideration | null => {
  const path = considerationPath(opts.cwd);
  if (path === null) return null;
  const consideration: Consideration = {
    version: CONSIDERATION_VERSION,
    ...currentBinding(opts.cwd),
    outcome: opts.outcome,
    records: opts.records,
    created_at: (opts.now ?? new Date()).toISOString(),
    tool: opts.tool ?? 'commitlore',
  };
  writeAtomic(path, `${JSON.stringify(consideration, null, 2)}\n`);
  return consideration;
};

/** Remove the binding. Absent is success: the post-state is what matters. */
export const clearConsideration = (cwd: string): void => {
  const path = considerationPath(cwd);
  if (path === null) return;
  try {
    unlinkSync(path);
  } catch {
    // Absent already, or not ours to remove — either way there is none to honour.
  }
};

const isConsideration = (value: unknown): value is Consideration => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['version'] === CONSIDERATION_VERSION &&
    (record['head'] === null || typeof record['head'] === 'string') &&
    typeof record['staged_diff_hash'] === 'string' &&
    typeof record['policy_identity_hash'] === 'string' &&
    (record['outcome'] === 'empty' || record['outcome'] === 'recorded') &&
    typeof record['records'] === 'number' &&
    typeof record['created_at'] === 'string'
  );
};

/** The stored binding, or null when there is none this build understands. */
export const readConsideration = (cwd: string): Consideration | null => {
  const path = considerationPath(cwd);
  if (path === null || !existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  return isConsideration(parsed) ? parsed : null;
};

/**
 * Whether the stored binding covers the tree in front of us.
 *
 * The gap is named rather than folded into a boolean, because the three ways a
 * binding can fail to apply are three different things to tell somebody: HEAD
 * moved (the commit already happened), the staged diff changed (stage first,
 * then consider), and the policy changed (the rules the flow ran under are not
 * the rules in force).
 */
export const considerationVerdict = (cwd: string, now: Date = new Date()): ConsiderationVerdict => {
  const stored = readConsideration(cwd);
  if (stored === null) {
    const path = considerationPath(cwd);
    return { covered: false, gap: path !== null && existsSync(path) ? 'unreadable' : 'none', consideration: null };
  }

  const current = currentBinding(cwd);
  if (stored.head !== current.head) return { covered: false, gap: 'head-moved', consideration: stored };
  if (stored.staged_diff_hash !== current.staged_diff_hash) {
    return { covered: false, gap: 'staged-diff-changed', consideration: stored };
  }
  if (stored.policy_identity_hash !== current.policy_identity_hash) {
    return { covered: false, gap: 'policy-changed', consideration: stored };
  }

  const createdAt = Date.parse(stored.created_at);
  if (!Number.isFinite(createdAt)) return { covered: false, gap: 'unreadable', consideration: stored };
  if (now.getTime() - createdAt > CONSIDERATION_EXPIRY_MINUTES * 60_000) {
    return { covered: false, gap: 'expired', consideration: stored };
  }

  return { covered: true, consideration: stored };
};
