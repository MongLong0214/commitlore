/**
 * `commitlore backfill` — reconstruct records for commits made before this
 * repository kept any (T-801, PRD-F8).
 *
 * Three modes, and the default one does no reconstruction at all:
 *
 * - no flags: index the past commits that already carry trailers. There is no
 *   model here (ADR-0006), so there is nothing to reconstruct *with*, and
 *   indexing what already exists is the whole of what can be done for free.
 * - `--prompt-only`: emit the reconstruction contract for each target commit.
 *   The user's own session answers it. This is the integration path.
 * - `--draft <file>`: take that answer back, verify it against the same text,
 *   and attach what survives to the notes mirror.
 *
 * The output always names what stopped the run, because a cold-start command
 * that quietly does part of the job is worse than one that does none: "12
 * records, stopped at --limit" and "12 records, that was all of them" are
 * different facts and the user acts differently on each.
 */
import type { Command } from 'commander';
import { type BackfillOptions } from '../core/backfill.js';
export interface BackfillCommandOptions {
    limit?: string | undefined;
    withPrs?: boolean | undefined;
    budgetTokens?: string | undefined;
    draft?: string | undefined;
    promptOnly?: boolean | undefined;
    dryRun?: boolean | undefined;
    json?: boolean | undefined;
    cwd?: string | undefined;
    batchSize?: number | undefined;
}
export interface BackfillOutcome {
    stdout: string;
    stderr: string;
    exitCode: number;
}
export declare const toBackfillOptions: (options: BackfillCommandOptions) => BackfillOptions;
/**
 * Runs the command and reports what it would print. A failure comes back as an
 * outcome rather than an exception: the one thing a user of a cold-start command
 * should never see is a stack trace telling them nothing they can act on.
 */
export declare const runBackfill: (options: BackfillCommandOptions) => BackfillOutcome;
export declare const register: (program: Command) => void;
