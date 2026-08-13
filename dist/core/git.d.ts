/**
 * Thin `git` child-process wrapper (SPEC §2: parsing is delegated to git, so
 * every module that needs git behavior goes through here).
 *
 * There is no custom Error subclass by design. A non-zero exit is ordinary
 * data — `execGit` returns it in `GitResult` and lets the caller judge.
 * Callers that want a failure to be fatal use `execGitOrThrow`, which throws a
 * plain `Error` carrying `code` and `stderr` as own properties.
 */
import { type SpawnSyncReturns } from 'node:child_process';
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
export declare const GIT_SPAWN_FAILED = -1;
/** Maps a completed spawn result to the git wrapper's stable result shape. */
export declare const gitResultFromSpawn: (result: SpawnSyncReturns<string>) => GitResult;
/**
 * Runs `git` with `args` and returns its outcome. Never throws for a git-level
 * failure; check `code`.
 *
 * The child is spawned without a shell, so nothing in `args` or `stdin` can be
 * reinterpreted as shell syntax — commit messages are untrusted input (SPEC §7
 * grades records precisely because anyone who can push can write one).
 */
export declare const execGit: (args: string[], opts?: ExecGitOptions) => GitResult;
export declare const isGitFailure: (error: unknown) => boolean;
/**
 * Runs `git` and returns stdout, throwing on any failure. The thrown `Error`
 * carries `code` and `stderr` as own properties so a caller can branch on them
 * programmatically without a custom Error class.
 */
export declare const execGitOrThrow: (args: string[], opts?: ExecGitOptions) => string;
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
export declare const resolveRevision: (cwd: string, revision: string) => string | null;
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
/**
 * Asks git whether it can read this repository's history.
 *
 * Two questions, because one cannot separate the cases. `rev-parse --verify
 * --quiet HEAD` exits 1 both when there are no commits and when this is not a
 * repository, so `rev-parse --git-dir` is asked first: it succeeds for an empty
 * repository and fails for everything else.
 */
export declare const historyAvailability: (cwd: string) => HistoryAvailability;
export declare const SHALLOW_HISTORY_CAVEAT = "this clone has shallow history, so this answer may be missing records that exist upstream";
export declare const hasShallowHistory: (cwd: string) => boolean;
