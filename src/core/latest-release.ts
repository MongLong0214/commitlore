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

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { newestRelease } from './release-version.js';

/** Matches `install.sh:41`. */
const DEFAULT_SOURCE = 'https://github.com/MongLong0214/commitlore.git';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The schema of the cache file. A different number reads as absent. */
const CACHE_VERSION = 1;

export type CheckOutcome =
  /** A tag was resolved. */
  | { readonly kind: 'resolved'; readonly tag: string }
  /** The check did not run, by an operator's decision. */
  | { readonly kind: 'disabled'; readonly by: string }
  /** git could not reach the remote at all: no network, DNS, timeout, spawn failure. */
  | { readonly kind: 'unreachable'; readonly detail: string }
  /** The remote answered and said no. A different fact, and a different interval. */
  | { readonly kind: 'refused'; readonly detail: string }
  /** git answered and nothing in the output was a release tag. A parsing bug, not weather. */
  | { readonly kind: 'no-tag-matched'; readonly detail: string };

export interface CheckResult {
  readonly outcome: CheckOutcome;
  /** Whether this answer came from the cache rather than a spawn. */
  readonly cached: boolean;
  /** When the answer was produced, epoch ms. */
  readonly checkedAt: number;
}

/**
 * The switches that say "do not do this", as opposed to "not here, not now".
 *
 * `COMMITLORE_NO_AUTO_UPDATE` is deliberately absent: it stops `init` and
 * `upgrade` from *acting*, and a test asserts the check and the report still
 * run under it. An operator who declines automatic action has not asked to
 * stop being told.
 */
const OFF_SWITCHES = [
  'COMMITLORE_NO_UPDATE_CHECK',
  // Its stated scope names autoupdates, not only analytics.
  'DO_NOT_TRACK',
  // The de-facto convention; honouring it costs one line.
  'NO_UPDATE_NOTIFIER',
] as const;

const disabledBy = (env: NodeJS.ProcessEnv): string | null => {
  for (const name of OFF_SWITCHES) {
    const value = env[name];
    if (value !== undefined && value !== '' && value !== '0') return name;
  }
  return null;
};

export const sourceUrl = (env: NodeJS.ProcessEnv = process.env): string => {
  const configured = env['COMMITLORE_INSTALL_SOURCE'];
  return configured !== undefined && configured !== '' ? configured : DEFAULT_SOURCE;
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  readonly version: number;
  readonly checkedAt: number;
  readonly outcome: CheckOutcome;
  /** How long this answer is good for. Stored rather than derived, so that a
   *  doubling back-off survives a process that only ever runs once. */
  readonly ttlMs: number;
}

export const cachePath = (home?: string): string =>
  join(home !== undefined && home !== '' ? home : homedir(), '.cache', 'commitlore', 'latest-release.json');

const readCache = (path: string): CacheEntry | null => {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const entry = parsed as Partial<CacheEntry>;
    if (entry.version !== CACHE_VERSION) return null;
    if (typeof entry.checkedAt !== 'number' || typeof entry.ttlMs !== 'number') return null;
    if (typeof entry.outcome !== 'object' || entry.outcome === null) return null;
    return entry as CacheEntry;
  } catch {
    // Truncated, empty, unreadable, owned by somebody else: all "no cache".
    return null;
  }
};

/**
 * Written through a temporary file in the same directory, so a reader never
 * sees a half-written one and two writers cannot interleave.
 */
const writeCache = (path: string, entry: CacheEntry): void => {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const scratch = `${path}.${process.pid}.tmp`;
    writeFileSync(scratch, `${JSON.stringify(entry)}\n`, 'utf8');
    renameSync(scratch, path);
  } catch {
    // A cache that cannot be written is a slower check, not a failed one.
  }
};

/**
 * How long an outcome is trusted.
 *
 * Unreachable doubles from an hour to a day: a brief outage costs an hour of
 * quiet, a laptop that is offline for a week costs one attempt a day. Refused
 * is a settled answer and waits the full day. A parse failure waits an hour
 * *and* is reported under `--debug`, because burying a bug for a day hides it.
 */
export const ttlFor = (outcome: CheckOutcome, previous: CacheEntry | null): number => {
  switch (outcome.kind) {
    case 'resolved':
    case 'disabled':
      return DAY_MS;
    case 'refused':
      return DAY_MS;
    case 'no-tag-matched':
      return HOUR_MS;
    case 'unreachable': {
      const last = previous?.outcome.kind === 'unreachable' ? previous.ttlMs : 0;
      return Math.min(DAY_MS, Math.max(HOUR_MS, last * 2));
    }
  }
};

// ---------------------------------------------------------------------------
// The spawn, and getting rid of it
// ---------------------------------------------------------------------------

/** Long enough for a slow remote, short enough that no command waits on it. */
export const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Whether a non-zero `git` exit was the network failing or the remote
 * answering.
 *
 * The distinction is not cosmetic: an unreachable remote waits an hour and a
 * refusal waits a day, so classifying a DNS failure as a refusal buys a day of
 * silence about exactly the staleness this feature exists to expose. `git`
 * exits non-zero for both and says which in its stderr.
 */
const looksUnreachable = (stderr: string): boolean =>
  /could not resolve host|couldn't resolve host|connection refused|connection timed out|network is unreachable|failed to connect|operation timed out|temporary failure in name resolution/i.test(
    stderr,
  );

/** Shared by both spawns, so one ranking answers for both. */
const outcomeFromRefs = (stdout: string): CheckOutcome => {
  const tags = stdout
    .split('\n')
    .map((line) => line.split('\t')[1] ?? '')
    .map((ref) => ref.replace(/^refs\/tags\//, '').trim())
    .filter((tag) => tag !== '');
  const newest = newestRelease(tags);
  return newest === null
    ? { kind: 'no-tag-matched', detail: `${tags.length} ref(s), none a release tag` }
    : { kind: 'resolved', tag: newest };
};
/** Between asking the child to stop and making it. */
const GRACE_MS = 500;

export interface SpawnOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  /** Injected so a test can drive the timeout without waiting for one. */
  readonly setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
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
export const fetchTags = async (
  url: string,
  opts: SpawnOptions = {},
): Promise<CheckOutcome> => {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));

  return await new Promise<CheckOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: CheckOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimer(killTimer);
      clearTimer(graceTimer);
      resolve(outcome);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('git', ['ls-remote', '--tags', '--refs', url], {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...(opts.env ?? process.env),
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
          GCM_INTERACTIVE: 'never',
        },
      });
    } catch (error) {
      resolve({ kind: 'unreachable', detail: `git could not be started: ${String(error)}` });
      return;
    }

    /** Signals the group when there is one, the child otherwise. */
    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid === undefined) return;
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // Already gone. That is the outcome this was reaching for.
      }
    };

    let graceTimer: unknown = null;
    const killTimer = setTimer(() => {
      signalGroup('SIGTERM');
      graceTimer = setTimer(() => signalGroup('SIGKILL'), GRACE_MS);
      finish({ kind: 'unreachable', detail: `no answer within ${timeoutMs}ms` });
    }, timeoutMs);

    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      finish({ kind: 'unreachable', detail: `git could not be started: ${error.message}` });
    });
    // `close` rather than `exit`: the streams are drained by then, and the
    // child has been reaped either way, which is what keeps a long-lived
    // `commitlore mcp` from accumulating zombies.
    child.on('close', (code) => {
      if (code === 0) {
        finish(outcomeFromRefs(out));
        return;
      }
      // git answered and declined: auth, a repository that is not there, a
      // protocol it will not speak. Settled, so it waits the full day.
      const detail = err.trim().split('\n')[0] ?? `git exited ${String(code)}`;
      finish(looksUnreachable(err) ? { kind: 'unreachable', detail } : { kind: 'refused', detail });
    });
  });
};

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

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
export const latestRelease = async (opts: LatestReleaseOptions = {}): Promise<CheckResult> => {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  // The home comes from the env this call was handed, not from the process.
  // A module that takes its switches from `env` and its cache location from
  // `process` is one that writes to the developer's real cache from inside a
  // test -- which is how two of these tests first passed by reading each
  // other's answer.
  const path = cachePath(opts.home ?? env['HOME']);

  const off = disabledBy(env);
  if (off !== null) {
    return { outcome: { kind: 'disabled', by: off }, cached: false, checkedAt: now() };
  }

  const previous = opts.fresh === true ? null : readCache(path);
  if (previous !== null && now() - previous.checkedAt < previous.ttlMs) {
    return { outcome: previous.outcome, cached: true, checkedAt: previous.checkedAt };
  }

  const outcome = await fetchTags(sourceUrl(env), opts);
  const checkedAt = now();
  if (opts.fresh !== true) {
    writeCache(path, { version: CACHE_VERSION, checkedAt, outcome, ttlMs: ttlFor(outcome, previous) });
  }
  return { outcome, cached: false, checkedAt };
};

/** Removes the cache. `upgrade` calls this after acting, so the next check is fresh. */
export const forgetCachedRelease = (home?: string): void => {
  try {
    rmSync(cachePath(home), { force: true });
  } catch {
    // Nothing to forget.
  }
};

/** Where a test puts a cache without touching a real home. */
export const scratchHome = (label: string): string =>
  join(tmpdir(), `commitlore-${label}-${String(process.pid)}`);

// ---------------------------------------------------------------------------
// The synchronous form, for doctor
// ---------------------------------------------------------------------------

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
export const latestReleaseSync = (opts: LatestReleaseOptions = {}): CheckResult => {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const path = cachePath(opts.home ?? env['HOME']);

  const off = disabledBy(env);
  if (off !== null) {
    return { outcome: { kind: 'disabled', by: off }, cached: false, checkedAt: now() };
  }

  const previous = opts.fresh === true ? null : readCache(path);
  if (previous !== null && now() - previous.checkedAt < previous.ttlMs) {
    return { outcome: previous.outcome, cached: true, checkedAt: previous.checkedAt };
  }

  let outcome: CheckOutcome;
  try {
    const run = spawnSync('git', ['ls-remote', '--tags', '--refs', sourceUrl(env)], {
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GCM_INTERACTIVE: 'never' },
    });
    if (run.error !== undefined) {
      outcome = { kind: 'unreachable', detail: run.error.message };
    } else if (run.status === 0) {
      outcome = outcomeFromRefs(run.stdout ?? '');
    } else if (run.signal !== null) {
      outcome = { kind: 'unreachable', detail: `no answer within the timeout (${run.signal})` };
    } else {
      const stderr = run.stderr ?? '';
      const detail = stderr.trim().split('\n')[0] ?? `git exited ${String(run.status)}`;
      outcome = looksUnreachable(stderr) ? { kind: 'unreachable', detail } : { kind: 'refused', detail };
    }
  } catch (error) {
    outcome = { kind: 'unreachable', detail: `git could not be started: ${String(error)}` };
  }

  const checkedAt = now();
  if (opts.fresh !== true) {
    writeCache(path, { version: CACHE_VERSION, checkedAt, outcome, ttlMs: ttlFor(outcome, previous) });
  }
  return { outcome, cached: false, checkedAt };
};
