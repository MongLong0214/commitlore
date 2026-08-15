/**
 * Thin `git` child-process wrapper (SPEC §2: parsing is delegated to git, so
 * every module that needs git behavior goes through here).
 *
 * There is no custom Error subclass by design. A non-zero exit is ordinary
 * data — `execGit` returns it in `GitResult` and lets the caller judge.
 * Callers that want a failure to be fatal use `execGitOrThrow`, which throws a
 * plain `Error` carrying `code` and `stderr` as own properties.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { isFullObjectId } from './types.js';

/** One `git` invocation's outcome. A non-zero `code` is a result, not a throw. */
export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecGitOptions {
  /** Written to git's stdin. */
  stdin?: string;
  cwd?: string;
  /** Environment passed to git. Defaults to this process's environment. */
  env?: NodeJS.ProcessEnv;
  /** Max bytes buffered from stdout/stderr. Defaults to 64 MiB. */
  maxBuffer?: number;
  /** Maximum time to wait for git before terminating it, in milliseconds. */
  timeout?: number;
}

/**
 * `code` reported when git never ran to completion (binary missing, output
 * over `maxBuffer`, killed by a signal). Distinct from any real git exit code,
 * which is 0-255.
 */
export const GIT_SPAWN_FAILED = -1;

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/** Maps a completed spawn result to the git wrapper's stable result shape. */
export const gitResultFromSpawn = (result: SpawnSyncReturns<string>): GitResult => {
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  // A child can exit before Node finishes writing its input pipe, leaving EPIPE
  // alongside its real status and output. The completed child result wins.
  if (result.status !== null) return { stdout, stderr, code: result.status };
  if (result.error !== undefined) {
    return { stdout, stderr: `${stderr}${result.error.message}`, code: GIT_SPAWN_FAILED };
  }

  const signal = result.signal ?? 'unknown';
  return { stdout, stderr: `${stderr}git terminated by signal ${signal}`, code: GIT_SPAWN_FAILED };
};

/**
 * Runs `git` with `args` and returns its outcome. Never throws for a git-level
 * failure; check `code`.
 *
 * The child is spawned without a shell, so nothing in `args` or `stdin` can be
 * reinterpreted as shell syntax — commit messages are untrusted input (SPEC §7
 * grades records precisely because anyone who can push can write one).
 */
export const execGit = (args: string[], opts: ExecGitOptions = {}): GitResult => {
  const result = spawnSync('git', args, {
    shell: false,
    encoding: 'utf8',
    cwd: opts.cwd ?? process.cwd(),
    input: opts.stdin ?? '',
    env: opts.env,
    maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
    timeout: opts.timeout,
  });

  return gitResultFromSpawn(result);
};

/**
 * Marks a thrown `Error` as "git could not answer", so a caller can tell a
 * host failure from a usage error without matching on message text. A flag
 * rather than an Error subclass, same shape as `commitloreMissingInstalledFile`.
 */
const GIT_FAILURE = 'commitloreGitFailure';

export const isGitFailure = (error: unknown): boolean =>
  error instanceof Error && (error as unknown as Record<string, unknown>)[GIT_FAILURE] === true;

/**
 * Runs `git` and returns stdout, throwing on any failure. The thrown `Error`
 * carries `code` and `stderr` as own properties so a caller can branch on them
 * programmatically without a custom Error class.
 */
export const execGitOrThrow = (args: string[], opts: ExecGitOptions = {}): string => {
  const result = execGit(args, opts);
  if (result.code !== 0) {
    const error = Object.assign(
      new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr.trim()}`),
      { code: result.code, stderr: result.stderr },
    );
    Object.defineProperty(error, GIT_FAILURE, { value: true });
    throw error;
  }
  return result.stdout;
};

// ---------------------------------------------------------------------------
// Revisions — the one door an abbreviation comes through
// ---------------------------------------------------------------------------

/**
 * Resolves a revision a user typed — a branch, a tag, `HEAD~3`, or an
 * abbreviated object id — to the one full object id it names, or `null` when
 * git will not resolve it to exactly one commit.
 *
 * This is the only place an abbreviation is allowed to become an identity.
 * Everywhere downstream holds full ids and checks them with `isFullObjectId`,
 * so the ambiguity is settled once, by git, at the boundary where the user's
 * text arrives — rather than by a regex that cannot know what a prefix names.
 *
 * `--verify` is what makes an ambiguous prefix an error instead of a guess, and
 * `^{commit}` peels a tag to the commit it points at so an annotated tag does
 * not resolve to the tag object's own id. The result is checked rather than
 * trusted: `--quiet` turns "no such revision" into an empty stdout with a
 * non-zero code, and a caller reading stdout alone would accept `''` from a
 * git that failed in a way it did not anticipate.
 */
export const resolveRevision = (cwd: string, revision: string): string | null => {
  const result = execGit(
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`],
    { cwd },
  );
  if (result.code !== 0) return null;
  const resolved = result.stdout.trim();
  return isFullObjectId(resolved) ? resolved : null;
};

// ---------------------------------------------------------------------------
// Availability — whether git could answer at all
// ---------------------------------------------------------------------------

/**
 * Whether this repository's history can be read, and if not, why.
 *
 * - `ready`       — git answered; an empty result is a statement about content
 * - `empty`       — a repository with no commits yet: a true empty
 * - `unavailable` — git could not answer. An empty result here is **not** a
 *                   statement about content, and must not be reported as one
 *
 * The third case is the reason this exists. `scanTrailers` read `git rev-parse
 * HEAD`, took `null` for an answer, and returned `[]` — so a repository whose
 * git was broken, absent, or not a repository at all produced
 * `{"records": [], "diagnostics": []}` and exit 0. That is the most dangerous
 * output this tool can produce: an agent reads "no constraints" as "nothing is
 * off limits", and here it was said with the same confidence as a genuine empty.
 *
 * `empty` is separated from `unavailable` deliberately. A freshly initialised
 * repository legitimately has nothing, and folding it into the failure case
 * would make `commitlore` refuse to run on the first commit of every project —
 * which trains people to ignore the failure that matters.
 */
export type HistoryAvailability = 'ready' | 'empty' | 'unavailable';

/** git's own exit code for "the ref does not exist", as opposed to a failure. */
const GIT_NO_SUCH_REF = 1;

/**
 * Asks git whether it can read this repository's history.
 *
 * Two questions, because one cannot separate the cases. `rev-parse --verify
 * --quiet HEAD` exits 1 both when there are no commits and when this is not a
 * repository, so `rev-parse --git-dir` is asked first: it succeeds for an empty
 * repository and fails for everything else.
 */
export const historyAvailability = (cwd: string): HistoryAvailability => {
  const dir = execGit(['rev-parse', '--git-dir'], { cwd });
  if (dir.code !== 0) return 'unavailable';

  const head = execGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { cwd });
  if (head.code === 0 && head.stdout.trim() !== '') return 'ready';
  // Exit 1 with no output is git saying the ref is absent — an unborn HEAD.
  // Anything else (a spawn failure, 127, 128 from a corrupt object store) is git
  // being unable to answer, which is not the same fact.
  if (head.code === GIT_NO_SUCH_REF && head.stderr.trim() === '') return 'empty';
  return 'unavailable';
};

export const SHALLOW_HISTORY_CAVEAT =
  'this clone has shallow history, so this answer may be missing records that exist upstream';

export const hasShallowHistory = (cwd: string): boolean => {
  const shallow = execGit(['rev-parse', '--git-path', 'shallow'], { cwd });
  return shallow.code === 0 && existsSync(resolve(cwd, shallow.stdout.trim()));
};

/**
 * Git's `%cI` for a UTC commit, spelled one way (#650).
 *
 * `%cI` is strict ISO 8601, and git changed how it renders a zero offset:
 * 2.39 emits `+00:00`, 2.50 emits `Z`. The same commit therefore reads
 * differently depending on the machine, and `committedAt` is a documented
 * field of the `--json` output — a consumer comparing strings, matching a
 * pattern, or feeding a strict parser gets different answers for one
 * repository.
 *
 * Only the UTC spelling is touched. A real offset carries information about
 * where the commit was made and is left exactly as git wrote it.
 */
export const canonicalCommittedAt = (value: string): string =>
  value.endsWith('+00:00') ? `${value.slice(0, -6)}Z` : value;
