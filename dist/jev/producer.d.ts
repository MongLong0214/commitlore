/**
 * The optional commit producer — #1048, ADR #1045 D1/D2/D5/D6.
 *
 * One function: `produce`. It is reached only from the internal commit-msg
 * dispatcher, only with an enabled activation, and it adds a *producer* — never
 * a second verifier. Every judgement about whether a record may exist is made by
 * native code that was already there: `prepareCaptureContext`,
 * `verifyCaptureRecords`, `stageCaptureRecord` and `runValidate`.
 *
 * ## The order, and why each step is where it is
 *
 * 1. **Eligibility, before any I/O that costs anything.** Policy, message,
 *    staged change, operation form, foreign hook. A commit that is not eligible
 *    must reach native validation having read no transcript and opened no socket.
 * 2. **Snapshot.** cwd, worktree, gitdir, HEAD, the inherited effective index,
 *    diff, tree, policy hash, the original message bytes, the source window.
 * 3. **One bounded request, outside every native pending lock.** Nothing is
 *    written yet, so a timeout costs the commit its latency and nothing else.
 * 4. **Recheck.** Anything that moved means skip. Never retry: a retry inside a
 *    commit hook is a second chance bought with the user's commit latency.
 * 5. **Native prepare, then compare its bindings against the snapshot.** The
 *    comparison is the point — checking immediately *before* prepare leaves the
 *    window between the check and prepare's own reads, which is exactly the race
 *    the ADR calls out.
 * 6. **Native verify** against that same canonical source and diff. Only an
 *    accepted result with *this* call's receipt may go on.
 * 7. **Compose into a private temporary file and run the real validator on it,
 *    before the real message is touched.** A candidate that does not validate is
 *    discarded whole; the original is never edited and then repaired.
 * 8. **Final recheck, stage with the owned receipt, then publish atomically.**
 *    The bytes published are byte-for-byte the bytes that validated.
 *
 * ## What it will not do
 *
 * It never turns a native failure into a success — `runValidate`'s result for
 * the bytes that are actually in the file is what comes back, on every path. It
 * never appends to a message a foreign hook already approved. It never stages
 * user code, resets, commits, pushes, or unsets `GIT_INDEX_FILE`. It never
 * retries, repairs, or asks again. And it cleans up only the one pending
 * transaction it created, by nonce, because deleting pending files by pattern is
 * deleting somebody else's capture.
 */
import type { JevEnabled } from './activation.js';
import { askJev, type JevOutcome } from './client.js';
/**
 * Why the producer did not run, or ran and produced nothing.
 *
 * Closed, and `skipped` is deliberately never collapsed into "nothing useful
 * found": a commit form this prototype does not support has not been assessed,
 * and reporting it as assessed would be the false-negative the PRD forbids.
 */
export type SkipCause = 'policy-not-auto' | 'not-unattended' | 'message-empty' | 'message-has-record' | 'competing-capture' | 'foreign-chained-hook' | 'no-staged-change' | 'unsupported-operation' | 'alternate-index' | 'unborn-head' | 'source-unavailable' | 'no-candidates' | 'provider-unavailable' | 'no-draft' | 'source-moved' | 'binding-moved' | 'verify-refused' | 'candidate-invalid' | 'stage-refused' | 'publish-failed';
export interface ProduceOutcome {
    /** True only when the real message file now holds the validated candidate. */
    readonly published: boolean;
    readonly cause?: SkipCause;
    /** Lines for the optional diagnostic. Never source text, never a key. */
    readonly notes: readonly string[];
    /** The nonce this invocation owned, when it created one. */
    readonly nonce?: string;
    /** Present when a request was dispatched, for the usage report. */
    readonly outcome?: JevOutcome;
}
export interface ProduceInput {
    readonly messageFile: string;
    readonly cwd: string;
    readonly activation: JevEnabled;
    readonly env: Readonly<Record<string, string | undefined>>;
    /** Injected by tests so a real request is never needed to exercise a branch. */
    readonly ask?: typeof askJev;
}
/**
 * The producer.
 *
 * Returns `published: false` for every outcome except the one where the real
 * message file now holds bytes that `runValidate` accepted. The caller runs
 * native validation on whatever is in the file afterwards — which is the same
 * call on both paths, and the reason a failure here cannot become a success.
 */
export declare const produce: (input: ProduceInput) => Promise<ProduceOutcome>;
