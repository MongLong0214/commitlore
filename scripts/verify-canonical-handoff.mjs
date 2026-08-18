#!/usr/bin/env node
/**
 * Verify what a canonical rebuild handed over, without trusting the job that
 * produced it (T-1502, #719).
 *
 * `canonical-merge.yml` runs in two jobs. The first executes a contributor's
 * `package.json` and every lifecycle script `npm ci` pulls in, then hands a git
 * bundle to the second. The second holds the App credential. If it publishes
 * what it was given, a lifecycle script can add a commit touching `src/`,
 * `scripts/` or `.github/` and have it force-pushed under the App's identity
 * for a reviewer to read as a rebuild.
 *
 * So the shape is checked here rather than assumed. Every input is a commit the
 * caller resolved from GitHub or from `main` — never a value the untrusted job
 * wrote.
 *
 * This lives in a file rather than inline in the workflow because the invariant
 * is about a commit graph, and a graph is testable. The inline version asserted
 * that the branch tip had two parents; the tip of a real run has one, because
 * the rebuild commits on top of the merge whenever `dist/` actually changes.
 * Nothing that reads the workflow as text could see that — only running it
 * against a repository could, and that is what `test/verify-canonical-handoff.test.ts`
 * now does.
 *
 * Usage:
 *   node scripts/verify-canonical-handoff.mjs --base <sha> --source <sha> --tip <ref> [--cwd <dir>]
 *
 * Exit codes follow SPEC §10:
 *   0  the tip is main + this source, plus at most an artifact-only commit
 *   1  it is something else
 *   2  bad input, or git could not answer
 */

import { execFileSync } from 'node:child_process';

/** Paths a rebuild is entitled to write. Everything else is somebody's edit. */
export const REBUILD_PATHS = Object.freeze(['dist/', 'installer/canonical-artifact.json']);

/**
 * Paths a source pull request may not carry. The first job filters these too;
 * repeating it here means the filter is not the only thing holding it, and this
 * job's copy is the one running from `main`.
 */
export const FORBIDDEN_SOURCE_PATHS = Object.freeze([
  'dist/',
  'installer/canonical-artifact.json',
  '.github/workflows/',
]);

class HandoffError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  } catch (error) {
    throw new HandoffError(`git ${args.join(' ')} failed: ${error.stderr ?? error.message}`, 2);
  }
};

const parentsOf = (commit, cwd) => {
  const line = git(['rev-list', '--parents', '-n1', commit], cwd);
  return line.split(' ').slice(1);
};

const isRebuildPath = (path) =>
  REBUILD_PATHS.some((allowed) => (allowed.endsWith('/') ? path.startsWith(allowed) : path === allowed));

/**
 * @returns {{ merge: string, artifactCommit: string | null, rebuiltPaths: string[] }}
 */
export const verifyHandoff = ({ base, source, tip, cwd }) => {
  for (const [name, value] of Object.entries({ base, source, tip })) {
    if (typeof value !== 'string' || value === '') throw new HandoffError(`--${name} is required`, 2);
  }

  const baseSha = git(['rev-parse', `${base}^{commit}`], cwd);
  const sourceSha = git(['rev-parse', `${source}^{commit}`], cwd);
  const tipSha = git(['rev-parse', `${tip}^{commit}`], cwd);

  // The tip is either the merge itself -- when the merged source already
  // produces the committed bundle -- or one artifact-only commit on top of it.
  // Both are honest; a chain of two is not, because the second one had no
  // rebuild left to record.
  const tipParents = parentsOf(tipSha, cwd);
  let merge;
  let artifactCommit = null;
  if (tipParents.length === 2) {
    merge = tipSha;
  } else if (tipParents.length === 1) {
    artifactCommit = tipSha;
    merge = tipParents[0];
  } else {
    throw new HandoffError(`the tip has ${tipParents.length} parents; expected a merge, or one commit on a merge`);
  }

  const mergeParents = parentsOf(merge, cwd);
  if (mergeParents.length !== 2) {
    throw new HandoffError(`${merge.slice(0, 8)} is not a merge commit — it has ${mergeParents.length} parent(s)`);
  }
  if (mergeParents[0] !== baseSha || mergeParents[1] !== sourceSha) {
    throw new HandoffError(
      `the merge joins ${mergeParents[0].slice(0, 8)} and ${mergeParents[1].slice(0, 8)}, ` +
        `not ${baseSha.slice(0, 8)} and ${sourceSha.slice(0, 8)}`,
    );
  }

  // Recomputed here from the two commits the caller resolved, so a merge that
  // quietly carries an extra edit does not survive having the right parents.
  const expectedTree = git(['merge-tree', '--write-tree', baseSha, sourceSha], cwd).split('\n')[0];
  const actualTree = git(['rev-parse', `${merge}^{tree}`], cwd);
  if (expectedTree !== actualTree) {
    throw new HandoffError(
      `the merge's tree is ${actualTree.slice(0, 8)}; merging ${baseSha.slice(0, 8)} with ` +
        `${sourceSha.slice(0, 8)} here produces ${expectedTree.slice(0, 8)}`,
    );
  }

  const sourceChanged = git(['diff', '--name-only', `${baseSha}...${sourceSha}`], cwd)
    .split('\n')
    .filter(Boolean);
  const forbidden = sourceChanged.filter((path) =>
    FORBIDDEN_SOURCE_PATHS.some((bad) => (bad.endsWith('/') ? path.startsWith(bad) : path === bad)),
  );
  if (forbidden.length > 0) {
    throw new HandoffError(`the source carries paths a source-only pull request may not: ${forbidden.join(', ')}`);
  }

  let rebuiltPaths = [];
  if (artifactCommit !== null) {
    rebuiltPaths = git(['diff', '--name-only', merge, artifactCommit], cwd).split('\n').filter(Boolean);
    if (rebuiltPaths.length === 0) {
      throw new HandoffError('the commit on top of the merge changes nothing');
    }
    const strayed = rebuiltPaths.filter((path) => !isRebuildPath(path));
    if (strayed.length > 0) {
      throw new HandoffError(`the rebuild changed paths it is not entitled to change: ${strayed.join(', ')}`);
    }
  }

  return { merge, artifactCommit, rebuiltPaths };
};

const parseArgs = (argv) => {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith('--')) throw new HandoffError(`unexpected argument: ${flag}`, 2);
    const value = argv[index + 1];
    if (value === undefined) throw new HandoffError(`${flag} needs a value`, 2);
    parsed[flag.slice(2)] = value;
    index += 1;
  }
  return parsed;
};

const main = () => {
  const { base, source, tip, cwd } = parseArgs(process.argv.slice(2));
  const result = verifyHandoff({ base, source, tip, cwd: cwd ?? process.cwd() });
  const where =
    result.artifactCommit === null
      ? 'the merged source already produced the committed bundle'
      : `plus ${result.rebuiltPaths.length} rebuilt path(s) in ${result.artifactCommit.slice(0, 8)}`;
  process.stdout.write(`canonical handoff verified: ${result.merge.slice(0, 8)} is that merge, ${where}\n`);
};

if (process.argv[1] !== undefined && process.argv[1].endsWith('verify-canonical-handoff.mjs')) {
  try {
    main();
  } catch (error) {
    if (error instanceof HandoffError) {
      process.stderr.write(`canonical handoff refused: ${error.message}\n`);
      process.exit(error.exitCode);
    }
    throw error;
  }
}
