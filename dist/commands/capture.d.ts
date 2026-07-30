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
import type { GuardAdvisory } from '../core/pending.js';
interface CaptureResult {
    nonce: string | null;
    staged: boolean;
    prompt?: string;
    guard_advisory?: GuardAdvisory | null;
}
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
