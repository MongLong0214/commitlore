/**
 * `commitlore capture` — T-1006 (#198), ADR-0021.
 *
 * Composes the three capture phases (prepare → verify → stage) into a single
 * CLI command. Adds no new logic — every decision lives in the core modules.
 *
 * CEO amendment (binding):
 * - The CLI passes the nonce and nothing else to stage. It never forwards a
 *   caller-supplied `base_head`, diff hash, policy hash, or timestamp.
 * - The user never types trailer syntax.
 * - Most commits produce nothing.
 * - At most one record per commit by default.
 * - A verification failure produces no record and exits 0 as `rejected`.
 * - A host failure exits 3; an unanticipated exception exits 4. Neither is
 *   silence (#543). The hook wrapper, not this command, is what fails open.
 *
 * Structured for subcommand extension (T-1019 will add `capture gc`).
 */
import type { Command } from 'commander';
import { type CaptureOutcome } from '../core/capture-outcome.js';
import { type CaptureShadowResult } from '../core/capture-shadow.js';
import type { GuardAdvisory } from '../core/pending.js';
/** Why a drafted record did not survive. Empty when everything was accepted. */
export interface CaptureRejectionReport {
    /** Index in the submitted draft. */
    index: number;
    /** The check that refused it: a draft-shape rule, or a verification reason. */
    rule: string;
    /** What specifically was wrong, in the words the check itself used. */
    detail: string;
    /** Present for a verification refusal, where reason and rule differ. */
    reason?: string;
}
export interface CaptureResult {
    /**
     * What happened. Present on every path, including failures: `--json`
     * callers parse this instead of treating empty stdout plus exit 0 as
     * "nothing to record" (#543).
     */
    outcome: CaptureOutcome;
    nonce: string | null;
    staged: boolean;
    prompt?: string;
    guard_advisory?: GuardAdvisory | null;
    /**
     * Every reason a record was refused (#309). Both sources are included: the
     * draft parser, which rejects a shape, and the verifier, which rejects a
     * citation. Both were computed and discarded before this existed, so `capture`
     * printed "no record staged" while `harvest` printed the reason for the same
     * input.
     */
    rejected?: CaptureRejectionReport[];
    /** Host or invariant failure. Absent on empty / staged / a clean rejection list. */
    error?: string;
}
/** Render historical measurement output without ever echoing a blocked secret. */
export declare const formatCaptureShadow: (result: CaptureShadowResult) => string;
/**
 * Run the full capture pipeline: prepare → verify → stage.
 *
 * Returns a typed outcome on every path. Never throws: a verification refusal
 * is `rejected`, a git or filesystem failure is `operational`, and an
 * exception the code did not anticipate is `internal`. Silence is a
 * conclusion, not a place exceptions fall into (#543).
 */
export declare const runCapture: (opts: {
    transcriptPath: string;
    diffPath?: string;
    draftPath?: string;
    cwd: string;
    /** Authors whose guard-advisory records may render as directives. */
    trustedAuthors?: readonly string[];
    /**
     * Declare the whole run unattended (#511). Refused by prepare unless the
     * repository opted in — the CLI never decides consent on its own.
     */
    unattended?: boolean;
}) => CaptureResult;
export declare const register: (program: Command) => void;
