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
 * - A verification failure produces no record and does not fail the command.
 *
 * Structured for subcommand extension (T-1019 will add `capture gc`).
 */
import type { Command } from 'commander';
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
interface CaptureResult {
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
}
/** Render historical measurement output without ever echoing a blocked secret. */
export declare const formatCaptureShadow: (result: CaptureShadowResult) => string;
/**
 * Run the full capture pipeline: prepare → verify → stage.
 *
 * Returns a structured result. Never throws on pipeline failures (verification
 * failure, nothing to stage) — those are communicated via the result. Only
 * throws for true usage errors (unreadable files).
 */
export declare const runCapture: (opts: {
    transcriptPath: string;
    diffPath?: string;
    draftPath?: string;
    cwd: string;
}) => CaptureResult;
export declare const register: (program: Command) => void;
export {};
