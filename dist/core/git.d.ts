/**
 * Thin `git` child-process wrapper (SPEC §2: parsing is delegated to git, so
 * every module that needs git behavior goes through here).
 *
 * There is no custom Error subclass by design. A non-zero exit is ordinary
 * data — `execGit` returns it in `GitResult` and lets the caller judge.
 * Callers that want a failure to be fatal use `execGitOrThrow`, which throws a
 * plain `Error` carrying `code` and `stderr` as own properties.
 */
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
    /** Max bytes buffered from stdout/stderr. Defaults to 64 MiB. */
    maxBuffer?: number;
}
/**
 * `code` reported when git never ran to completion (binary missing, output
 * over `maxBuffer`, killed by a signal). Distinct from any real git exit code,
 * which is 0-255.
 */
export declare const GIT_SPAWN_FAILED = -1;
/**
 * Runs `git` with `args` and returns its outcome. Never throws for a git-level
 * failure; check `code`.
 *
 * The child is spawned without a shell, so nothing in `args` or `stdin` can be
 * reinterpreted as shell syntax — commit messages are untrusted input (SPEC §7
 * grades records precisely because anyone who can push can write one).
 */
export declare const execGit: (args: string[], opts?: ExecGitOptions) => GitResult;
/**
 * Runs `git` and returns stdout, throwing on any failure. The thrown `Error`
 * carries `code` and `stderr` as own properties so a caller can branch on them
 * programmatically without a custom Error class.
 */
export declare const execGitOrThrow: (args: string[], opts?: ExecGitOptions) => string;
