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
import { type ExecGitOptions } from './git.js';
import { type NotesOptions } from './notes.js';
/** What a sync did, per remote. */
export type SyncOutcome = 
/** Local and remote already agree. Nothing was transferred. */
'in-sync'
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
    /** Limits applied only to network transport children (`git fetch` and `git push`). */
    readonly transport?: Pick<ExecGitOptions, 'env' | 'timeout'>;
}
/**
 * Synchronise one remote.
 *
 * The remote side is fetched to a **scratch ref** rather than onto
 * `refs/notes/commitlore` directly. A fetch that overwrote the working ref
 * would discard local notes that had not been published yet — silently, and
 * before anything had a chance to merge them. Landing it beside the working
 * ref makes the three-way comparison below possible at all.
 */
export declare const syncRemote: (remote: string, opts?: SyncOptions) => SyncResult;
/**
 * Synchronise every configured remote, or the ones named.
 *
 * A repository with no remote returns an empty list rather than an error: there
 * is nowhere to publish to, which is a state and not a fault.
 */
export declare const syncNotes: (opts?: SyncOptions) => SyncResult[];
/** Whether any remote reported something a user would want to act on. */
export declare const syncNeedsAttention: (results: readonly SyncResult[]) => boolean;
