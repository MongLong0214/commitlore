/**
 * One bounded last-result file — #1049, ADR D6.
 *
 * This is deliberately the smallest thing that answers "did the prototype do
 * anything the last time I committed". It replaces r2's per-attempt persistent
 * ledger, post-commit observer and consumed-source checkpoint, all of which were
 * removed: existing pending records and receipts already own capture lifecycle,
 * and a second bookkeeping system would be a second source of truth about
 * whether a record exists.
 *
 * Three properties, and each rules something out:
 *
 * - **Never read for a capture decision.** Nothing in `producer.ts` consults it.
 *   A diagnostic that can authorize is not a diagnostic.
 * - **Never asserts a commit exists.** Staging succeeded, or a message was
 *   published — neither is a commit. The commit can still fail afterwards, and a
 *   file written before that would be a claim about a commit that never
 *   happened. Actual Git and pending reads answer that question.
 * - **Never a prerequisite.** Every write is wrapped and every failure ignored.
 *   A full disk must not fail a commit whose validation passed.
 *
 * It holds no key, no source text and no provider prose. What it does hold is a
 * *stale* answer the moment the next commit runs, so its own timestamp is in the
 * file: a reader who takes it as describing the latest commit is reading it
 * wrong, and the timestamp is what lets them notice.
 */
import type { JevUsage } from './client.js';
export declare const DIAGNOSTIC_VERSION = 1;
export interface JevLastResult {
    readonly version: number;
    readonly at: string;
    /** `published`, or the skip cause. Never "committed". */
    readonly outcome: string;
    /** The nonce this invocation owned, when it created one. */
    readonly nonce: string | null;
    readonly usage: {
        readonly inputTokens: number | null;
        readonly outputTokens: number | null;
        /** An estimate from a dated price. Never an invoice. */
        readonly estimatedUsd: number | null;
    } | null;
    readonly notes: readonly string[];
}
export interface WriteDiagnosticInput {
    readonly cwd: string;
    readonly outcome: string;
    readonly nonce?: string | undefined;
    readonly usage?: JevUsage | null | undefined;
    readonly notes: readonly string[];
    readonly now?: () => Date;
}
/**
 * Writes the file, atomically, and swallows every failure.
 *
 * Returns whether it landed, so a test can assert the write without the caller
 * ever being able to branch on it.
 */
export declare const writeLastResult: (input: WriteDiagnosticInput) => boolean;
/**
 * Reads it, for `doctor --jev` and for tests. Never called during a commit.
 *
 * A missing file is `null` and means nothing has been recorded here — not that
 * the prototype is broken and not that the last commit was uninspected.
 */
export declare const readLastResult: (cwd: string) => JevLastResult | null;
/**
 * A sentence for `doctor --jev`, with the caveat attached rather than implied.
 *
 * The caveat is the whole reason this renders through a function: a reader who
 * sees "published" next to a time naturally concludes the latest commit carries
 * a record, and this file cannot support that. It describes one earlier
 * invocation, and the commit it belongs to may have failed afterwards.
 */
export declare const describeLastResult: (result: JevLastResult | null) => string;
