/**
 * `pre-push` hook — #416: the half of the notes round trip that was missing.
 *
 * `doctor --fix` writes the fetch refspec, so a clone *receives* the mirror on
 * any `git fetch`. Nothing ever sent one. This hook is where the other half
 * goes, and the choice of hook is the decision worth stating:
 *
 * **The mirror rides an operation the user already started.** Pushing notes on
 * every commit would put a network call, and a possible failure, into an
 * operation that had none — on a machine that may be offline, in a repository
 * whose remote the user was not ready to write to. `pre-push` fires exactly
 * when the user has decided to publish, and carries the records with the code
 * they describe.
 *
 * **It cannot fail a push.** git aborts a push when `pre-push` exits non-zero,
 * so every path here ends in 0. A notes ref that will not sync is a
 * synchronisation problem; a code push refused because of one is a worse
 * problem that this hook would have caused. Anything worth knowing goes to
 * stderr, where git shows it without acting on it.
 *
 * git passes the remote name as the first argument, so only the remote actually
 * being pushed to is synced — not every remote the repository happens to have.
 */
import type { Command } from 'commander';
import { type SyncResult } from '../core/sync.js';
export declare const PRE_PUSH_HOOK_MARKER = "# commitlore:pre-push:v1";
export declare const PRE_PUSH_HOOK_NAME = "pre-push";
export declare const PRE_PUSH_CHAINED_HOOK_NAME = "pre-push.commitlore-chained";
export interface PrePushHookResult {
    readonly code: 0 | 2;
    readonly stdout: string;
    readonly stderr: string;
}
/**
 * The stub, from the same shared body as the other hooks.
 *
 * `captureHookStub()` is the ending that lets the operation through, which is
 * the required one here: see the module comment.
 */
export declare const prePushStub: () => string;
export declare const installPrePushHook: (cwd?: string) => PrePushHookResult;
/** One line per remote, for stderr. Silence when there was nothing to say. */
export declare const describeSync: (results: readonly SyncResult[]) => string[];
export declare const register: (program: Command) => void;
