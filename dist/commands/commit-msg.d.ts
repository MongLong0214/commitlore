/**
 * The internal `commit-msg` dispatcher — #1048, ADR #1045 D1.
 *
 * The installed hook stub used to exec `validate --message-file "$1"`. It now
 * execs this, and this is a branch:
 *
 * ```
 * no key, or COMMITLORE_JEV=off  ->  runValidate(...)          exactly as before
 * enabled                        ->  try the optional producer, then runValidate
 * ```
 *
 * The disabled arm is the whole product for every default installation, so it is
 * written to be *provably* the old behaviour: same arguments, same repository,
 * same scan budget, same streams, same exit codes — and, because
 * `resolveJevActivation` answers before the dynamic import below is reached, no
 * optional module is executed, no transcript is read, no file is written and no
 * socket is opened. `validate` itself is untouched and stays read-only.
 *
 * ## Why `validate` is still its own command
 *
 * An old stub in an already-installed repository execs `validate` and keeps
 * working: it gets native validation and no prototype, which is exactly the
 * promise #1050 makes. Nothing about the prototype reaches a repository until
 * somebody reinstalls its hooks deliberately.
 *
 * ## Why the optional path cannot convert a failure into a success
 *
 * `runValidate` runs **after** the producer, over whatever is now in the file,
 * on every path. If the producer published a candidate, the file holds the
 * candidate and the result describes the candidate. If it did anything else —
 * skipped, failed, threw, could not even be imported — the file holds the
 * original and the result describes the original. There is no branch in which a
 * native verdict is replaced by an optional one, and no `catch` anywhere around
 * the `runValidate` call.
 */
import type { Command } from 'commander';
import { type ValidateResult } from '../commands/validate.js';
export interface CommitMsgInput {
    readonly messageFile: string;
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    /**
     * The transport, injected.
     *
     * It exists so a behavioural test can drive **this** dispatcher and **this**
     * producer through a real `git commit` with scripted choices, instead of a
     * test-only copy of the pipeline. The product never passes it, there is no
     * environment variable or flag that sets it, and no endpoint override
     * anywhere — a repository-settable provider address is the thing ADR D4
     * forbids, and this is not one.
     */
    readonly ask?: typeof import('../jev/client.js').askJev;
}
/**
 * The command body.
 *
 * `runValidate` is called once, at the end, with the same inputs the `validate`
 * action passes. That single call site is the property this file exists to hold:
 * there is exactly one verdict, it comes from native code, and it describes the
 * bytes that are actually in the message file.
 */
export declare const runCommitMsg: (input: CommitMsgInput) => Promise<ValidateResult>;
export declare const register: (program: Command) => void;
