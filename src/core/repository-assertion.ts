/**
 * #1030: a caller says which tree it means, and a mismatch refuses rather than
 * preparing a transaction bound to the wrong HEAD.
 *
 * The MCP server is registered against one checkout and answers from it. A
 * session whose working directory is a *linked worktree* of the same repository
 * — an ordinary way to work on a branch — called `prepare_capture` and received
 * a transaction bound to the other tree's HEAD. Nothing in the response said so:
 * `staged_diff_hash` was the SHA-256 of the empty string and `staged_diff_empty`
 * was `true`, which is also exactly what you get when you have staged nothing.
 * The harvest prompt then said `(no diff — nothing is staged)` and its rule 8
 * told the agent to proceed on the transcript alone, so the flow continued and
 * a record would have been bound to a tree its author never touched.
 *
 * ## Why an assertion rather than detection
 *
 * The server cannot discover the caller's working directory. MCP carries no such
 * field, and inferring one from the process tree would be a guess that is wrong
 * in exactly the multi-worktree case this exists for. So the caller states the
 * tree it means and the server *verifies the statement* — the shape `--diff`
 * already has on `capture` (#877/#1023): the argument cannot change the binding,
 * only assert it, and a wrong assertion is a refusal rather than a silent
 * rebinding.
 *
 * Omitting it keeps the old behaviour, because a caller in the server's own
 * checkout is the common case and must not be made to say so.
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { execGit } from './git.js';

/** What a tree is, as far as a refusal message needs to describe one. */
interface TreeFacts {
  /** The working tree root, as git resolves it. */
  root: string;
  /** `.git` for the main checkout, the shared directory for a linked worktree. */
  commonDir: string | null;
  head: string | null;
  branch: string | null;
}

const gitValue = (cwd: string, args: readonly string[]): string | null => {
  const result = execGit([...args], { cwd });
  if (result.code !== 0) return null;
  const value = result.stdout.trim();
  return value === '' ? null : value;
};

/**
 * `realpath` both sides before comparing.
 *
 * On macOS the same directory is reachable as `/tmp/x` and `/private/tmp/x`, and
 * git reports whichever it was handed — so a string comparison calls one tree
 * two repositories and refuses a caller who did nothing wrong. A path that
 * cannot be resolved is returned unchanged rather than throwing; the comparison
 * that follows then fails, which is the safe direction.
 */
const resolved = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const treeFacts = (cwd: string): TreeFacts | null => {
  const root = gitValue(cwd, ['rev-parse', '--show-toplevel']);
  if (root === null) return null;
  /*
   * Resolved against `cwd` rather than asked for absolute. `--path-format` is
   * git 2.31 and later; this project states no git floor beyond "and Git", and a
   * flag that makes an old git fail here would turn a correct assertion into a
   * refusal on the platform least able to explain it.
   */
  const commonDir = gitValue(cwd, ['rev-parse', '--git-common-dir']);
  return {
    root: resolved(root),
    commonDir: commonDir === null ? null : resolved(resolve(cwd, commonDir)),
    head: gitValue(cwd, ['rev-parse', 'HEAD']),
    branch: gitValue(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
  };
};

const describe = (label: string, facts: TreeFacts): string =>
  `${label} ${facts.root}` +
  (facts.branch === null ? '' : ` (branch ${facts.branch}`) +
  (facts.branch === null || facts.head === null ? '' : `, HEAD ${facts.head.slice(0, 12)}`) +
  (facts.branch === null ? '' : ')');

/**
 * Throws unless `asserted` names the same working tree as `root`.
 *
 * Runs before anything is prepared, so a refusal leaves no pending transaction
 * behind for `capture gc` to collect — the placement #877 settled for `--diff`.
 */
export const assertRepositoryBinding = (asserted: string, root: string): void => {
  const mine = treeFacts(root);
  const theirs = treeFacts(asserted);

  if (theirs === null) {
    throw new Error(
      `repository "${asserted}" is not a git working tree. ` +
        `This server is bound to ${mine === null ? root : mine.root}. ` +
        'Pass the working tree you are capturing from, or omit `repository` to accept ' +
        "this server's.",
    );
  }
  if (mine === null) {
    throw new Error(
      `this server's directory ${root} is not a git working tree, so the assertion ` +
        `"${asserted}" cannot be checked.`,
    );
  }
  if (theirs.root === mine.root) return;

  /*
   * Naming the shared repository matters more than the mismatch. Told only that
   * two paths differ, a caller reasonably reads "wrong repository" and goes
   * looking for a configuration error; what actually happened is that both trees
   * are the same project and the transaction would have bound to the other
   * branch's HEAD, which is the failure that is easy to miss and expensive to
   * find afterwards.
   */
  const sameRepository =
    mine.commonDir !== null && theirs.commonDir !== null && mine.commonDir === theirs.commonDir;

  throw new Error(
    'capture would bind to a different working tree than the one you named.\n' +
      `${describe('  you asked for ', theirs)}\n` +
      `${describe('  this server is', mine)}\n` +
      (sameRepository
        ? 'Both are worktrees of the same repository, so the transaction would have bound to ' +
          "the other branch's HEAD and staged diff, and nothing in the response would have " +
          'looked wrong.\n'
        : 'These are separate repositories.\n') +
      'Register the CommitLore MCP server against the tree you are working in, or run ' +
      '`commitlore capture` there — the CLI binds to its own working directory.',
  );
};

/**
 * A sentence for the response when nothing is staged, naming the tree that was
 * inspected (#1030).
 *
 * `staged_diff_empty: true` is a normal state, so it cannot by itself
 * distinguish "you staged nothing" from "I looked somewhere else". The reporter
 * found the mismatch by reading `repository`, which is one field among sixteen —
 * this puts the same fact where an empty diff is already being explained.
 */
export const emptyStagedDiffNote = (root: string): string =>
  `nothing is staged in ${root}, which is the tree this server is bound to. ` +
  'If you are working somewhere else — a linked worktree, another checkout — this ' +
  "transaction is bound to that tree's HEAD and not yours. Pass `repository` with your " +
  'working directory and this call will refuse rather than prepare against another tree.';
