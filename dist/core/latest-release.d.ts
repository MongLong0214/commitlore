/**
 * What the newest release is, asked at most once a day and never fatally
 * (T-1602, #742).
 *
 * **The source is `git ls-remote --tags --refs`, not the GitHub API.** PRD-F16
 * records the correction: revision 1 justified the API by claiming the install
 * path already used it, and `install.sh` contains zero `api.github.com` calls.
 * `git ls-remote` has no 60-per-hour unauthenticated limit, works where the
 * API is blocked but git is not, and follows `COMMITLORE_INSTALL_SOURCE` to a
 * mirror for free.
 *
 * **This module prints nothing and decides nothing about when to speak.** The
 * context gates -- CI, a TTY, a hook subcommand -- belong to the notice
 * (T-1604). A module that applied them is a module `commitlore upgrade
 * --check` could not use, because that command answers inside CI on purpose.
 * What lives here are the switches that express a decision rather than a
 * context.
 *
 * **A failed check is cached, by kind.** `gh` writes its state only after a
 * successful fetch, so an offline machine retries on every invocation forever
 * -- an outbound attempt per command, which is what an egress-monitoring
 * organisation flags. One blanket interval is the opposite error: a
 * five-minute outage must not buy a day of silence about the staleness this
 * feature exists to expose. Hence three intervals rather than one.
 */
export type CheckOutcome = 
/** A tag was resolved. */
{
    readonly kind: 'resolved';
    readonly tag: string;
}
/** The check did not run, by an operator's decision. */
 | {
    readonly kind: 'disabled';
    readonly by: string;
}
/** git could not reach the remote at all: no network, DNS, timeout, spawn failure. */
 | {
    readonly kind: 'unreachable';
    readonly detail: string;
}
/** The remote answered and said no. A different fact, and a different interval. */
 | {
    readonly kind: 'refused';
    readonly detail: string;
}
/** git answered and nothing in the output was a release tag. A parsing bug, not weather. */
 | {
    readonly kind: 'no-tag-matched';
    readonly detail: string;
};
export interface CheckResult {
    readonly outcome: CheckOutcome;
    /** Whether this answer came from the cache rather than a spawn. */
    readonly cached: boolean;
    /** When the answer was produced, epoch ms. */
    readonly checkedAt: number;
}
export declare const sourceUrl: (env?: NodeJS.ProcessEnv) => string;
interface CacheEntry {
    readonly version: number;
    readonly checkedAt: number;
    readonly outcome: CheckOutcome;
    /** How long this answer is good for. Stored rather than derived, so that a
     *  doubling back-off survives a process that only ever runs once. */
    readonly ttlMs: number;
}
export declare const cachePath: (home?: string) => string;
/**
 * How long an outcome is trusted.
 *
 * Unreachable doubles from an hour to a day: a brief outage costs an hour of
 * quiet, a laptop that is offline for a week costs one attempt a day. Refused
 * is a settled answer and waits the full day. A parse failure waits an hour
 * *and* is reported under `--debug`, because burying a bug for a day hides it.
 */
export declare const ttlFor: (outcome: CheckOutcome, previous: CacheEntry | null) => number;
/** Long enough for a slow remote, short enough that no command waits on it. */
export declare const DEFAULT_TIMEOUT_MS = 3000;
export interface SpawnOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
    /** Injected so a test can drive the timeout without waiting for one. */
    readonly setTimer?: (fn: () => void, ms: number) => {
        unref?: () => void;
    };
    readonly clearTimer?: (handle: unknown) => void;
}
/**
 * Asks the remote for its tags.
 *
 * Cancellation is a mechanism, and each part of it is load-bearing:
 *
 * - **Its own process group** (`detached`), so the signal reaches whatever
 *   `git` spawned -- an SSH client, a credential helper -- rather than only
 *   `git` itself. A killed parent with a live child is not a cancelled check.
 * - **A hard timeout**, bounding the child independently of the caller.
 *   `commitlore --version` returns in milliseconds, so cancel-when-the-command-
 *   finishes is not a bound at all.
 * - **`SIGTERM`, then `SIGKILL`** after a grace period, because a remote that
 *   accepts the connection and never answers will not leave on a polite ask.
 * - **`GIT_TERMINAL_PROMPT=0`** and non-interactive credentials, so it can
 *   never block waiting for input nobody will type.
 */
export declare const fetchTags: (url: string, opts?: SpawnOptions) => Promise<CheckOutcome>;
export interface LatestReleaseOptions extends SpawnOptions {
    readonly home?: string;
    readonly now?: () => number;
    /** Skips the cache read and write. `upgrade --check --force`, and tests. */
    readonly fresh?: boolean;
}
/**
 * The newest release, from cache when it is young enough and from git
 * otherwise. Never throws: every path this can take ends in a `CheckOutcome`,
 * because a command that failed because a version check failed would be a
 * worse product than one that never checked.
 */
export declare const latestRelease: (opts?: LatestReleaseOptions) => Promise<CheckResult>;
/** Removes the cache. `upgrade` calls this after acting, so the next check is fresh. */
export declare const forgetCachedRelease: (home?: string) => void;
/** Where a test puts a cache without touching a real home. */
export declare const scratchHome: (label: string) => string;
/**
 * The same answer, fetched without a promise (T-1605).
 *
 * `doctor`'s checks are synchronous and making the registry async to carry one
 * of them would rewrite every other check for a caller that is allowed to
 * take a moment. The cache, the switches, the ranking and the back-off are
 * shared -- only the spawn differs -- so this cannot drift into a second
 * answer.
 *
 * `spawnSync`'s own `timeout` and `killSignal` are the bound here. That is
 * weaker than the async path's process group and SIGTERM-then-SIGKILL, and it
 * is the right trade: `doctor` is an invited, foreground report where a stuck
 * child is visible, while the notice is an uninvited line that must never cost
 * a command anything.
 */
export declare const latestReleaseSync: (opts?: LatestReleaseOptions) => CheckResult;
export {};
