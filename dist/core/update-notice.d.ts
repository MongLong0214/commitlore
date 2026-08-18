/**
 * The passive notice (T-1604, #742): one line, on stderr, at most once a day,
 * and never when it would be in the way.
 *
 * **This module owns the context gates, and T-1602 deliberately does not.**
 * They apply to an uninvited line, not to an answered question -- `commitlore
 * upgrade --check` must keep working inside CI, and a module that applied
 * these to the check itself is one that command could not use.
 *
 * **Latency is zero by construction, not by timeout.** `gh` starts its check
 * concurrently and cancels before reading the result, so a slow network aborts
 * and the notice is simply skipped rather than waited for. Same shape here:
 * `beginUpdateCheck` starts the work, the command runs, and `finishUpdateCheck`
 * prints only what has already resolved. A check that never finishes never
 * delays anything, because nothing ever awaits it.
 */
/**
 * Subcommands that must never see a stray line.
 *
 * Named individually rather than matched by a pattern: `prepare-commit-msg`
 * writes the commit message file, so a stray line is a corrupted commit, and
 * `mcp` speaks a protocol where one is a parse error. A future command added
 * here cannot be quietly dropped from the test if each is its own case.
 */
export declare const SILENT_SUBCOMMANDS: readonly string[];
export interface NoticeContext {
    readonly argv: readonly string[];
    readonly env: NodeJS.ProcessEnv;
    readonly stdoutTty: boolean;
    readonly stderrTty: boolean;
}
/** Why the notice stayed quiet. `null` means it may speak. */
export declare const suppressedBecause: (ctx: NoticeContext) => string | null;
/**
 * Starts the check without awaiting it. Nothing downstream may await this
 * promise: that would trade the property this design exists for.
 */
export declare const beginUpdateCheck: (ctx: NoticeContext) => void;
/**
 * Prints the line if the check already finished and there is something to say.
 *
 * `failed` is passed rather than inferred: when the command itself failed the
 * operator is already reading an error, and `gh` stays quiet for the same
 * reason.
 */
export declare const finishUpdateCheck: (ctx: NoticeContext, current: string, failed: boolean, write: (line: string) => void) => void;
/**
 * Test seam: reports whether an answer has landed, without offering a way to
 * *wait* for one. Awaiting the check is the single thing this design forbids,
 * so the seam a test needs must not be one production code can misuse.
 */
export declare const hasSettledCheck: () => boolean;
/** Test seam: forgets any in-flight or settled check. */
export declare const resetUpdateCheck: () => void;
