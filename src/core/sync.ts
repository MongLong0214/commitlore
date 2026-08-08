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

import { execGit } from './git.js';
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
  | 'failed';

export interface SyncResult {
  readonly remote: string;
  readonly outcome: SyncOutcome;
  /** One line, for a human. Empty when there is nothing to say. */
  readonly detail: string;
}

export interface SyncOptions extends NotesOptions {
  /** Remotes to sync. Defaults to every configured remote. */
  readonly remotes?: readonly string[];
  /** Collect from the remote but publish nothing. */
  readonly fetchOnly?: boolean;
  /** Report what would happen and change nothing, locally or remotely. */
  readonly dryRun?: boolean;
}

const gitOptions = (opts: NotesOptions): { cwd?: string } =>
  opts.cwd === undefined ? {} : { cwd: opts.cwd };

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
const pushMirror = (remote: string, opts: NotesOptions): ReturnType<typeof execGit> =>
  execGit(['push', '--no-verify', remote, `${NOTES_REF}:${NOTES_REF}`], gitOptions(opts));

const revParse = (ref: string, opts: NotesOptions): string | null => {
  const result = execGit(['rev-parse', '--verify', '--quiet', ref], gitOptions(opts));
  const sha = result.stdout.trim();
  return result.code === 0 && sha !== '' ? sha : null;
};

const isAncestor = (a: string, b: string, opts: NotesOptions): boolean =>
  execGit(['merge-base', '--is-ancestor', a, b], gitOptions(opts)).code === 0;

const failure = (remote: string, detail: string): SyncResult => ({
  remote,
  outcome: 'failed',
  detail,
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
    gitOptions(opts),
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
      return { remote, outcome: 'fetched', detail: 'would collect the remote mirror' };
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
        return { remote, outcome: 'fetched', detail: 'would fast-forward to the remote mirror' };
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
        return { remote, outcome: 'merged', detail: 'would merge both mirrors' };
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
    return { remote, outcome: 'pushed', detail: 'would publish the local mirror' };
  }
  const pushed = pushMirror(remote, opts);
  return pushed.code === 0
    ? { remote, outcome: 'pushed', detail: 'published the local mirror' }
    : failure(remote, pushed.stderr.trim() || `git push ${remote} failed`);
};

/**
 * Synchronise every configured remote, or the ones named.
 *
 * A repository with no remote returns an empty list rather than an error: there
 * is nowhere to publish to, which is a state and not a fault.
 */
export const syncNotes = (opts: SyncOptions = {}): SyncResult[] => {
  const remotes = opts.remotes ?? listRemotes(opts);
  return remotes.map((remote) => syncRemote(remote, opts));
};

/** Whether any remote reported something a user would want to act on. */
export const syncNeedsAttention = (results: readonly SyncResult[]): boolean =>
  results.some((result) => result.outcome === 'failed' || result.outcome === 'diverged');
