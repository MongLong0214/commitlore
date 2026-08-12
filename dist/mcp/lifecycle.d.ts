/**
 * A record of this MCP server's own life, so a disconnect leaves evidence
 * (#424).
 *
 * A session lost all seven commitlore tools mid-conversation after four of them
 * had returned real data. From inside that session the failure was invisible:
 * `ToolSearch` answers "no matching tools" for a capability that was withdrawn
 * exactly as it does for one that never existed, so an agent cannot tell a
 * regression from a repository that simply lacks the feature. `claude mcp list`
 * reported the server connected while no process was running at all, so it
 * cannot be used to check either. And the client was not started with
 * `--debug`, so the server's stderr went to a pipe and nothing reached disk.
 *
 * **This does not fix that, and must not be described as fixing it.** The
 * registration lives in the client. What is reachable from here is the other
 * half of the problem: that nobody could say afterwards whether the server had
 * even been running. Two lines on disk answer it —
 *
 *     started 16:14:02  pid 49700  0.4.0  /…/cache/commitlore/commitlore/0.4.0
 *     exited  16:16:31  pid 49700  clean
 *
 * — and their absence is itself the answer, because a start with no exit beside
 * it is a server that was killed rather than one that closed its session.
 *
 * Three properties this file will not trade away:
 *
 * - **It never breaks the server.** Every failure is swallowed. A server that
 *   refused to start because it could not write a log would be a worse bug than
 *   the one being investigated.
 * - **It stays inside `.git/`**, which is already ignored, so nothing here can
 *   reach a commit or a diff.
 * - **It is bounded.** The file is truncated once it passes `MAX_BYTES`, oldest
 *   first, so a long-lived checkout cannot accumulate an unbounded log from a
 *   server that starts on every session.
 */
export declare const LIFECYCLE_FILE = "mcp-lifecycle.log";
/**
 * `.git/commitlore/mcp-lifecycle.log`, or `null` outside a repository.
 *
 * `rev-parse --git-path` rather than `.git/` by hand, so a linked worktree
 * writes where its own git directory is.
 *
 * Git answers relative to `cwd` in an ordinary clone and absolutely in a linked
 * worktree, and `join` is not that distinction: joining an absolute answer onto
 * `cwd` produced `<worktree>/Users/.../.git/worktrees/<name>/commitlore/...`, a
 * directory created inside the working tree on every MCP start, in the one case
 * the comment above promises to handle. `resolve` takes the absolute answer as
 * given and still anchors a relative one at `cwd`.
 */
export declare const lifecyclePath: (cwd?: string) => string | null;
/**
 * Records that this server came up, and arranges for its exit to be recorded
 * too.
 *
 * The exit handlers are the point. A `started` line with no `exited` beside it
 * is a server that was killed — which is exactly the shape #424 describes and
 * exactly what nobody could establish afterwards.
 */
/** One process's lifecycle reporter, retained so a caught startup failure can be recorded too. */
export interface LifecycleRecorder {
    crash: (error: unknown) => void;
}
/**
 * Records a server start and classifies the eventual exit.
 *
 * `output` is deliberately supplied by the caller alongside the stdio
 * transport. The SDK writes protocol frames there but does not watch it for
 * errors, so the listener here is what turns an output-pipe EPIPE into the
 * ordinary client hangup it represents.
 */
export declare const recordServerStart: (cwd?: string, at?: Date, output?: typeof process.stdout) => LifecycleRecorder;
export interface LifecycleEntry {
    readonly kind: 'started' | 'exited';
    readonly at: string;
    readonly pid: number;
    readonly detail: string;
}
/** Parses the log. Unreadable or absent reads as empty — it is a breadcrumb trail. */
export declare const readLifecycle: (cwd?: string) => LifecycleEntry[];
/** A completed server process whose final record says why it crashed. */
export declare const crashedRuns: (cwd?: string) => LifecycleEntry[];
/**
 * Servers that started and never recorded an exit.
 *
 * The signal #424 needs: a start with no exit beside it did not close its
 * session, it was killed. A pid still running is excluded — that one is simply
 * the server currently serving.
 */
export declare const unfinishedRuns: (cwd?: string) => LifecycleEntry[];
