/**
 * Notes mirror synchronisation — #416.
 *
 * `refs/notes/commitlore` was written locally and never published. `doctor
 * --fix` writes the fetch refspec, so a clone that runs it *receives* the
 * mirror on any `git fetch`; the machine that wrote a note had no way to send
 * one. The mirror was one-directional in the wrong direction — everyone could
 * read what nobody could publish.
 *
 * Three properties shape this module.
 *
 * ## It never breaks the operation it rides
 *
 * Every result is a value, never a throw, and the caller that matters — the
 * `pre-push` hook — exits 0 whatever comes back. A notes ref that will not push
 * is a synchronisation problem; a code push that fails because of it is a
 * worse one.
 *
 * ## It refuses rather than guesses
 *
 * When local and remote have both moved, a union merge is available and this
 * module will take it, because concatenating two sets of records loses nothing.
 * When git will not merge them cleanly, nothing is written and the reason is
 * reported. A mirror is derived state everywhere except here: the note *is* the
 * record, so clobbering one is destroying a record rather than a cache.
 *
 * ## The read path stays offline
 *
 * Nothing here is called by `notesAvailability`, `buildInjection` or the
 * PreToolUse hook. `src/core/notes.ts` states that availability reads git
 * config only, with no network, and that stands: a fetch on the injection path
 * would be felt on every edit.
 */

import { type ExecGitOptions, execGit } from './git.js';
import { NOTES_REF, listRemotes, type NotesOptions } from './notes.js';

/** What a sync did, per remote. */
export type SyncOutcome =
  /** Local and remote already agree. Nothing was transferred. */
  | 'in-sync'
  /** The remote had records this clone did not; they are now here. */
  | 'fetched'
  /** This clone had records the remote did not; they are now there. */
  | 'pushed'
  /** Both moved; the union was merged and published. */
  | 'merged'
  /** Nothing to publish and nothing to collect — no notes ref anywhere. */
  | 'nothing-to-do'
  /** Refused: git would not merge the two sides, so nothing was written. */
  | 'diverged'
  /** git or the network refused. `detail` says what it said. */
  | 'failed'
  /**
   * A dry run's plan: the transfer this call would have made and did not
   * (#1128). Kept apart from `fetched`, `pushed` and `merged` so that no
   * outcome describing a write is ever reported for one that did not happen.
   */
  | 'would-fetch'
  | 'would-push'
  | 'would-merge';

export interface SyncResult {
  readonly remote: string;
  readonly outcome: SyncOutcome;
  /** One line, for a human. Empty when there is nothing to say. */
  readonly detail: string;
}

export interface SyncOptions extends NotesOptions {
  /** Remotes to sync. Defaults to the ones `resolveSyncRemotes` chooses, never every remote. */
  readonly remotes?: readonly string[];
  /** Collect from the remote but publish nothing. */
  readonly fetchOnly?: boolean;
  /** Report what would happen and change nothing, locally or remotely. */
  readonly dryRun?: boolean;
  /** Limits applied only to network transport children (`git fetch` and `git push`). */
  readonly transport?: Pick<ExecGitOptions, 'env' | 'timeout'>;
}

const gitOptions = (opts: NotesOptions): { cwd?: string } =>
  opts.cwd === undefined ? {} : { cwd: opts.cwd };

/** Options for the only sync children that can contact a remote. */
const transportGitOptions = (opts: SyncOptions): ExecGitOptions => ({
  ...gitOptions(opts),
  ...(opts.transport?.env === undefined ? {} : { env: opts.transport.env }),
  ...(opts.transport?.timeout === undefined ? {} : { timeout: opts.transport.timeout }),
});

/** The ref a fetch lands on. Deliberately not `NOTES_REF`: see `syncRemote`. */
const FETCH_HEAD_REF = 'refs/notes/commitlore-remote';

/**
 * Publishing the mirror, with hooks disabled.
 *
 * `--no-verify` is not a convenience: the `pre-push` hook runs `sync`, and a
 * plain `git push` from inside it re-triggers that hook, which pushes again.
 * Measured before the flag existed — a single `git push` fired the hook 1,240
 * times in 40 seconds and never returned, so every user's push would hang.
 *
 * It belongs here rather than in the hook because the recursion is a property
 * of this push, not of the caller: nothing is served by a notes push running a
 * hook whose only job is to push notes.
 */
const pushMirror = (remote: string, opts: SyncOptions): ReturnType<typeof execGit> =>
  execGit(['push', '--no-verify', remote, `${NOTES_REF}:${NOTES_REF}`], transportGitOptions(opts));

const revParse = (ref: string, opts: NotesOptions): string | null => {
  const result = execGit(['rev-parse', '--verify', '--quiet', ref], gitOptions(opts));
  const sha = result.stdout.trim();
  return result.code === 0 && sha !== '' ? sha : null;
};

const isAncestor = (a: string, b: string, opts: NotesOptions): boolean =>
  execGit(['merge-base', '--is-ancestor', a, b], gitOptions(opts)).code === 0;

/**
 * `SyncResult.detail` promises one line, and git does not. A fetch against a
 * deleted remote answers with two -- `remote: Repository not found.` and
 * `fatal: repository '...' not found` -- and putting both in the column split
 * the row in half, so the second line read as a bare `fatal:` standing above
 * the table rather than as that remote's result (#865). Collapse here, at the
 * one place a git diagnostic becomes a detail, so the table, the JSON and the
 * hook all inherit the promise.
 */
const oneLine = (detail: string): string => detail.replace(/\s+/g, ' ').trim();

/**
 * A remote that no longer exists is a normal thing to find in a clone that has
 * outlived a fork, and the useful report is which remote, not git's two-line
 * phrasing of it.
 *
 * Bounded to git's own two phrasings — `remote: Repository not found.` and
 * `fatal: repository '<url>' not found` — rather than "the words repository and
 * not found somewhere in the message". The first draft was the loose version,
 * and review found it: `repository metadata not found` and
 * `repository credentials not found` would both have been relabelled as a
 * missing remote.
 */
const REMOTE_NOT_FOUND = /\brepository\b(?:\s+'[^']*'|\s+"[^"]*")?\s+not found/i;

/**
 * A timeout outranks the classification. `describeSync` reads `detail` for
 * `ETIMEDOUT` to say *why* the mirror failed, and `execGit` appends that to
 * whatever partial stderr the child had already written — so a message can
 * carry both. Replacing it with `remote not found` would erase the one part the
 * hook actually parses, and the operator would be told a fork is missing when
 * the remote simply did not answer in time.
 */
const TIMED_OUT = /\bETIMEDOUT\b/;

export const classifyFailureDetail = (detail: string): string =>
  !TIMED_OUT.test(detail) && REMOTE_NOT_FOUND.test(detail) ? 'remote not found' : oneLine(detail);

const failure = (remote: string, detail: string): SyncResult => ({
  remote,
  outcome: 'failed',
  detail: classifyFailureDetail(detail),
});

/**
 * Synchronise one remote.
 *
 * The remote side is fetched to a **scratch ref** rather than onto
 * `refs/notes/commitlore` directly. A fetch that overwrote the working ref
 * would discard local notes that had not been published yet — silently, and
 * before anything had a chance to merge them. Landing it beside the working
 * ref makes the three-way comparison below possible at all.
 */
export const syncRemote = (remote: string, opts: SyncOptions = {}): SyncResult => {
  // `--refmap=` is load-bearing, and the reason is measured rather than
  // assumed: `git fetch <remote> <refspec>` applies the **configured** refspecs
  // in addition to the one on the command line. Without this, a repository
  // configured for the mirror would move `refs/notes/commitlore` underneath the
  // three-way comparison below, which is the same overwrite #417 is about.
  const fetched = execGit(
    ['fetch', '--refmap=', '--force', remote, `${NOTES_REF}:${FETCH_HEAD_REF}`],
    transportGitOptions(opts),
  );
  // A remote with no notes ref is not an error: it is a remote nobody has
  // published to yet, which is the ordinary state of a fresh repository.
  const remoteMissing =
    fetched.code !== 0 && /couldn't find remote ref|does not appear to be a git repository/i.test(fetched.stderr);
  if (fetched.code !== 0 && !remoteMissing) {
    return failure(remote, fetched.stderr.trim() || `git fetch ${remote} failed`);
  }

  const local = revParse(NOTES_REF, opts);
  const theirs = remoteMissing ? null : revParse(FETCH_HEAD_REF, opts);

  if (local === null && theirs === null) {
    return { remote, outcome: 'nothing-to-do', detail: 'no notes mirror on either side' };
  }

  // Only the remote has records: adopt them.
  if (local === null && theirs !== null) {
    if (opts.dryRun === true) {
      return { remote, outcome: 'would-fetch', detail: 'would collect the remote mirror' };
    }
    const updated = execGit(['update-ref', NOTES_REF, theirs], gitOptions(opts));
    return updated.code === 0
      ? { remote, outcome: 'fetched', detail: 'collected the remote mirror' }
      : failure(remote, updated.stderr.trim() || 'could not update the local notes ref');
  }

  if (local !== null && theirs !== null) {
    if (local === theirs) return { remote, outcome: 'in-sync', detail: '' };

    // The remote is ahead: take it, nothing of ours is lost.
    if (isAncestor(local, theirs, opts)) {
      if (opts.dryRun === true) {
        return { remote, outcome: 'would-fetch', detail: 'would fast-forward to the remote mirror' };
      }
      const updated = execGit(['update-ref', NOTES_REF, theirs], gitOptions(opts));
      return updated.code === 0
        ? { remote, outcome: 'fetched', detail: 'fast-forwarded to the remote mirror' }
        : failure(remote, updated.stderr.trim() || 'could not update the local notes ref');
    }

    // Both moved. `cat_sort_uniq` keeps every record from both sides, which is
    // the only merge that cannot lose one.
    //
    // It concatenates two writers' notes into a single blob, and #409 covers
    // what that means for trust: a merged note is graded against every identity
    // that has written it and keeps the floor, so a note merged here holds at
    // `claim` until every one of its writers is trusted. That is the correct
    // outcome for a note two people wrote, and it is stated in `docs/cli.md`
    // rather than left to be discovered.
    if (!isAncestor(theirs, local, opts)) {
      if (opts.dryRun === true) {
        return { remote, outcome: 'would-merge', detail: 'would merge both mirrors' };
      }
      const merged = execGit(
        ['notes', `--ref=${NOTES_REF}`, 'merge', '-s', 'cat_sort_uniq', FETCH_HEAD_REF],
        gitOptions(opts),
      );
      if (merged.code !== 0) {
        return {
          remote,
          outcome: 'diverged',
          detail: merged.stderr.trim() || 'git refused to merge the two mirrors; nothing was written',
        };
      }
      if (opts.fetchOnly === true) {
        return { remote, outcome: 'merged', detail: 'merged both mirrors; not published' };
      }
      const pushed = pushMirror(remote, opts);
      return pushed.code === 0
        ? { remote, outcome: 'merged', detail: 'merged both mirrors and published' }
        : failure(remote, pushed.stderr.trim() || `git push ${remote} failed`);
    }
  }

  // We are ahead, or the remote has nothing: publish.
  if (opts.fetchOnly === true) {
    return { remote, outcome: 'in-sync', detail: 'local records are not published (--fetch-only)' };
  }
  if (opts.dryRun === true) {
    return { remote, outcome: 'would-push', detail: 'would publish the local mirror' };
  }
  const pushed = pushMirror(remote, opts);
  return pushed.code === 0
    ? { remote, outcome: 'pushed', detail: 'published the local mirror' }
    : failure(remote, pushed.stderr.trim() || `git push ${remote} failed`);
};

/** The git config key listing the remotes a sync writes to by default (#1128). */
export const SYNC_REMOTE_CONFIG = 'commitlore.syncRemote';

/** Why a sync chose the remotes it did. */
export type SyncRemoteSource =
  /** Named by the caller: `--remote`, or the remote git is pushing to. */
  | 'named'
  /** Listed in `commitlore.syncRemote`. */
  | 'configured'
  /** The current branch's push remote, resolved as `git push` resolves it. */
  | 'push-remote'
  /** No push remote is configured, so `origin`, as `git push` falls back to. */
  | 'origin'
  /** The repository has exactly one remote. */
  | 'only-remote'
  /** Several remotes and nothing to choose between them, or none at all. */
  | 'none';

export interface SyncTargets {
  readonly remotes: readonly string[];
  /** Configured remotes this sync leaves alone: never fetched, never written. */
  readonly skipped: readonly string[];
  readonly source: SyncRemoteSource;
}

const configValues = (key: string, opts: NotesOptions): string[] => {
  // Exit 1 means "key not set", which is an answer, not a failure.
  const result = execGit(['config', '--get-all', key], gitOptions(opts));
  if (result.code !== 0) return [];
  return result.stdout.split('\n').map((value) => value.trim()).filter((value) => value.length > 0);
};

const configValue = (key: string, opts: NotesOptions): string | null => configValues(key, opts).at(-1) ?? null;

/** The remote `git push` with no arguments would use, or null when none is configured. */
const pushRemote = (opts: NotesOptions): string | null => {
  const head = execGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], gitOptions(opts));
  const branch = head.code === 0 ? head.stdout.trim() : '';
  const forBranch = (key: string): string | null =>
    branch === '' ? null : configValue(`branch.${branch}.${key}`, opts);
  return forBranch('pushRemote') ?? configValue('remote.pushDefault', opts) ?? forBranch('remote');
};

/**
 * The remotes a sync writes to when the caller names none (#1128).
 *
 * It used to be every configured remote, and a remote is often added only to
 * read from it -- a contributor's fork, fetched to check out a pull request.
 * Publishing the mirror there sends every record in the repository to someone
 * else's repository, and a fork that allows edits by maintainers accepts it.
 * The refusals from forks that did not were reported as failures to fix.
 *
 * So the default is the remote this branch is pushed to, which is where its
 * code goes and so where the records describing it belong: the list in
 * `commitlore.syncRemote` when one is set, else the push remote in the order
 * `git push` reads it, else `origin`, else the only remote. With several
 * remotes and nothing to choose between them it chooses none, because every
 * guess here is a write to a remote nobody picked.
 */
export const resolveSyncRemotes = (opts: SyncOptions = {}): SyncTargets => {
  const configured = listRemotes(opts);
  const target = (remotes: readonly string[], source: SyncRemoteSource): SyncTargets => ({
    remotes,
    skipped: configured.filter((remote) => !remotes.includes(remote)),
    source,
  });

  if (opts.remotes !== undefined) return target(opts.remotes, 'named');
  // A listed name that is not a remote is kept: syncing it fails and says so,
  // where dropping it would hide the typo behind a sync that looked complete.
  const listed = [...new Set(configValues(SYNC_REMOTE_CONFIG, opts))];
  if (listed.length > 0) return target(listed, 'configured');
  const push = pushRemote(opts);
  if (push !== null && configured.includes(push)) return target([push], 'push-remote');
  if (configured.includes('origin')) return target(['origin'], 'origin');
  if (configured.length === 1) return target(configured, 'only-remote');
  return target([], 'none');
};

/**
 * Synchronise the remotes `resolveSyncRemotes` chooses, or the ones named.
 *
 * A repository with no remote returns an empty list rather than an error: there
 * is nowhere to publish to, which is a state and not a fault.
 */
export const syncNotes = (opts: SyncOptions = {}): SyncResult[] =>
  resolveSyncRemotes(opts).remotes.map((remote) => syncRemote(remote, opts));

/** Whether any remote reported something a user would want to act on. */
export const syncNeedsAttention = (results: readonly SyncResult[]): boolean =>
  results.some((result) => result.outcome === 'failed' || result.outcome === 'diverged');
