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
  /** Present when git was stopped by `timeout` rather than finishing. */
  timedOut?: true;
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
    // Read from the error's code, not its message, so a caller can name the
    // limit it set instead of repeating `spawnSync git ETIMEDOUT` (#1136).
    const timedOut = 'code' in result.error && result.error.code === 'ETIMEDOUT';
    return {
      stdout,
      stderr: `${stderr}${result.error.message}`,
      code: GIT_SPAWN_FAILED,
      ...(timedOut ? { timedOut: true as const } : {}),
    };
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
 * Facts about a repository that cannot change while one request is being
 * answered, read once and reused by whoever needs them next.
 *
 * The problem this solves is duplication inside a single invocation, not
 * between invocations. Answering one `query` resolves HEAD at least three times
 * -- the index refresh, `historyAvailability`, `readVantage` -- and two of those
 * run byte-identical argv: `rev-parse --verify --quiet HEAD^{commit}`. Measured
 * on this repository at 1,621 commits with a complete index, a query spends 18
 * git processes and a *repeated* query spends 18 again, of which 9 are
 * `rev-parse` and 4 are `config`.
 *
 * Keyed on the argv, so a reader opts in per call site and nothing is shared
 * that the caller did not ask to share. That matters more than it looks: a
 * command whose answer this invocation itself changes -- anything after a commit
 * or a notes write -- must not be memoized, and an argv-keyed cache cannot tell
 * the difference. The threading is the safety mechanism, not an inconvenience.
 *
 * The whole result is stored, never a parsed value. Callers distinguish "absent"
 * from "git could not answer" by exit code and stderr (`historyAvailability`
 * does exactly that), and a cache that kept only the sha would quietly flatten
 * those into one.
 *
 * Lifetime is the request. There is deliberately no module-level instance: a
 * cache that outlives an invocation is the staleness `r-staleonepass` rejects
 * for `CollectCache` and `RangeCache`, and this is not an argument for
 * revisiting that.
 */
export interface RepoFacts {
  /** Runs `args` once per instance; later callers get the first result. */
  once: (args: string[]) => GitResult;
  /** How many spawns this instance avoided. For measurement, not for logic. */
  reused: () => number;
}

/**
 * The spawn is the caller's, not this module's, and that is not a style choice.
 *
 * `r-pinnedmirror957` records what happens when a reader reaches git through a
 * door the tests do not know about: four tests here wrapped `execGit` and not
 * `execGitBytes`, and every failure they injected passed straight through the
 * unwrapped one while they went on passing. A memo that closed over this
 * module's own `execGit` would be a third such door — a test that stubs the
 * exported binding would not be consulted, and its injection would silently not
 * arrive. Taking the function from the caller means the memo runs whatever the
 * caller's binding resolves to, mocked or real.
 */
export const newRepoFacts = (cwd: string, exec: typeof execGit): RepoFacts => {
  const answered = new Map<string, GitResult>();
  let reused = 0;
  return {
    once: (args) => {
      const key = JSON.stringify(args);
      const already = answered.get(key);
      if (already !== undefined) {
        reused += 1;
        return already;
      }
      const result = exec(args, { cwd });
      answered.set(key, result);
      return result;
    },
    reused: () => reused,
  };
};

/**
 * `facts.once` when a request owns one, a plain spawn when it does not.
 *
 * Only for readers *in this module*, whose `execGit` is this module's either
 * way. A reader in another module must branch at its own call site, so the
 * spawn stays on the binding that module imported -- see `newRepoFacts`.
 */
const askGit = (cwd: string, args: string[], facts?: RepoFacts): GitResult =>
  facts === undefined ? execGit(args, { cwd }) : facts.once(args);

/**
 * The same spawn, with stdout kept as bytes.
 *
 * `git cat-file --batch` frames each object with a byte length, and a decoded
 * string cannot be indexed by it: one multi-byte character makes every
 * subsequent offset wrong, and the framing fails silently rather than loudly.
 * Only a reader that must honour a length git wrote should use this; everything
 * else wants {@link execGit} and its UTF-8 string.
 */
export const execGitBytes = (
  args: string[],
  opts: ExecGitOptions = {},
): { stdout: Buffer; stderr: string; code: number } => {
  const result = spawnSync('git', args, {
    shell: false,
    cwd: opts.cwd ?? process.cwd(),
    input: opts.stdin ?? '',
    env: opts.env,
    maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
    timeout: opts.timeout,
  });

  const stderr = result.stderr === null ? '' : String(result.stderr);
  if (result.status !== null) {
    return { stdout: result.stdout ?? Buffer.alloc(0), stderr, code: result.status };
  }
  if (result.error !== undefined) {
    return { stdout: Buffer.alloc(0), stderr: `${stderr}${result.error.message}`, code: GIT_SPAWN_FAILED };
  }
  return {
    stdout: Buffer.alloc(0),
    stderr: `${stderr}git terminated by signal ${result.signal ?? 'unknown'}`,
    code: GIT_SPAWN_FAILED,
  };
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
export const historyAvailability = (cwd: string, facts?: RepoFacts): HistoryAvailability => {
  const dir = askGit(cwd, ['rev-parse', '--git-dir'], facts);
  if (dir.code !== 0) return 'unavailable';

  // The same argv the index's own HEAD resolution runs, so within one request
  // the two share a spawn rather than asking twice. `r-4e29b7` recorded this
  // pair as unmeasured; it is measured now, in `newRepoFacts`.
  const head = askGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], facts);
  if (head.code === 0 && head.stdout.trim() !== '') return 'ready';
  // Exit 1 with no output is git saying the ref is absent — an unborn HEAD.
  // Anything else (a spawn failure, 127, 128 from a corrupt object store) is git
  // being unable to answer, which is not the same fact.
  if (head.code === GIT_NO_SUCH_REF && head.stderr.trim() === '') return 'empty';
  return 'unavailable';
};

export const SHALLOW_HISTORY_CAVEAT =
  'this clone has shallow history, so this answer may be missing records that exist upstream';

export const hasShallowHistory = (cwd: string, facts?: RepoFacts): boolean => {
  // Only the pathname is memoized. Whether the file is *there* is read every
  // time, because `git fetch --unshallow` removes it without changing its name.
  const shallow = askGit(cwd, ['rev-parse', '--git-path', 'shallow'], facts);
  return shallow.code === 0 && existsSync(resolve(cwd, shallow.stdout.trim()));
};

/**
 * Where an answer was read from — the half of completeness nothing reported.
 *
 * Every other availability field describes a *source* or the *scan*: `history`
 * says whether the object store could be read, `notes` whether the mirror was
 * fetched, `coverage` and `unreadCommits` whether a budget truncated the walk.
 * All of them stay healthy while the walk starts from the wrong commit. The
 * commit source only ever reads `rev-list HEAD` (index-db.ts says so), so an
 * answer is complete *with respect to a vantage the caller never sees* — and a
 * checkout behind its own already-fetched upstream returns zero records with
 * `coverage: "complete"`, byte-identical to a repository where nobody wrote one.
 * That is the sentence `notes` exists to prevent, arriving by another door.
 *
 * `behind` is the whole signal, and the discrimination is the point:
 *
 *   at the tip                 behind 0     silent
 *   behind its upstream        behind n     the dangerous case, and only it
 *   detached (review worktree) upstream null, ref null -- stated, not warned:
 *                              that vantage is deliberate, and warning on it
 *                              would fire on every blind review
 *   an unmerged local branch   behind 0     silent; HEAD is not missing what
 *                              its own line never had
 *
 * Two cheaper-looking signals were measured and rejected because they fire on
 * healthy checkouts: `rev-list --branches --remotes --not HEAD` counts 202 on
 * this repository at the tip of main, and path-scoping it still counts 18 for
 * README.md. Both are answering "does any unreachable commit exist", which is
 * yes in every repository that has ever merged a branch.
 *
 * Cost, because r-4e29b7 asked for a number and had none: one `rev-parse` and
 * at most one `rev-list --count`, 18-21 ms together on a 1500-commit repository
 * with 623 refs, against 436 ms for the `context` call that carries it. Skipped
 * entirely when there is no upstream to be behind.
 */
export interface Vantage {
  /** The commit walked from. Every record in the answer is reachable from it. */
  readonly head: string | null;
  /** The branch HEAD is on, or null when detached. */
  readonly ref: string | null;
  /** The tracked upstream, or null when the branch tracks nothing. */
  readonly upstream: string | null;
  /**
   * Commits the upstream has that this vantage cannot reach, and whose records
   * are therefore absent from the answer. `null` when there is no upstream to
   * compare against -- unknown, not zero.
   */
  readonly behind: number | null;
}

export const readVantage = (cwd: string, facts?: RepoFacts): Vantage => {
  /*
   * One `rev-parse`, not three. It takes several arguments and prints a line
   * for each, and every case this has to answer leaves usable output even when
   * it exits non-zero -- a detached head prints the sha and `HEAD` alongside
   * `fatal: HEAD does not point to a branch`, and a branch with no upstream
   * prints the sha and its ref. This runs on the injection path, where the
   * measured baseline already sits at 74% of that path's test budget under
   * load, so three spawns for facts one call carries is not a cost worth paying.
   *
   * Lines are matched by shape rather than by position, because which of them
   * are present is exactly what varies between those cases.
   */
  const read = askGit(
    cwd,
    ['rev-parse', 'HEAD', '--symbolic-full-name', 'HEAD', '@{upstream}'],
    facts,
  );
  const lines = read.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');

  const sha = lines.find((line) => isFullObjectId(line)) ?? '';
  // `refs/heads/x`, never the bare `HEAD` a detached head prints -- reading that
  // as a branch name is the mistake `symbolic-ref` was here to avoid.
  const branchRef = lines.find((line) => line.startsWith('refs/heads/'));
  const branch = branchRef === undefined ? null : branchRef.slice('refs/heads/'.length);
  const upstreamRef = lines.find((line) => line.startsWith('refs/remotes/'));
  const upstream =
    upstreamRef === undefined ? null : upstreamRef.slice('refs/remotes/'.length);

  if (upstream === null) {
    return { head: sha === '' ? null : sha, ref: branch, upstream: null, behind: null };
  }

  const counted = execGit(['rev-list', '--count', `HEAD..${upstream}`], { cwd });
  const parsed = Number.parseInt(counted.stdout.trim(), 10);
  return {
    head: sha === '' ? null : sha,
    ref: branch,
    upstream,
    // A git that cannot answer leaves this unknown rather than zero: reporting
    // 0 here would be this defect rebuilt, an unknown presented as an all-clear.
    behind: counted.code === 0 && Number.isInteger(parsed) ? parsed : null,
  };
};

/** The caveat for a vantage that is behind, in the words a caller can act on. */
export const vantageCaveat = (vantage: Vantage): string | null =>
  vantage.behind === null || vantage.behind === 0
    ? null
    : `this checkout is ${String(vantage.behind)} commit(s) behind ${vantage.upstream ?? 'its upstream'}, ` +
      'and records written in them are absent from this answer — an empty result here is not ' +
      'evidence that nothing was recorded. ' +
      'fix: git merge --ff-only, or ask again from a checkout that is up to date';

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

/**
 * The environment for a git call that must not stop to ask anyone anything:
 * the pre-push notes push and doctor's remote probes (#1136, #1138).
 *
 * git itself is told not to prompt. The SSH client is told the same only when
 * the caller has not chosen one. git reads `GIT_SSH_COMMAND` before `GIT_SSH`
 * and `core.sshCommand`, so setting it replaces a command chosen either of
 * those ways, and with it the key, config file or jump host that command
 * carries. The config lookup is passed in rather than run here, so doctor
 * keeps reading git through its injected context and the hook through
 * `execGit`. It runs only when neither variable is set.
 */
export const nonInteractiveGitEnv = (
  env: NodeJS.ProcessEnv,
  coreSshCommandSet: () => boolean,
): NodeJS.ProcessEnv => {
  const chosenSsh = env['GIT_SSH_COMMAND'] !== undefined || env['GIT_SSH'] !== undefined || coreSshCommandSet();
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    ...(chosenSsh ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }),
  };
};
