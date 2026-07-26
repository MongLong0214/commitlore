/**
 * `commitlore harvest` — hand the prompt contract to the session, take the draft
 * back (T-403, ADR-0006 §5).
 *
 * The command has three modes and one of them is doing nothing:
 *
 * - `--prompt-only` prints the contract. The user's agent session reads it,
 *   asks its own model, and writes a draft. This is the integration path.
 * - `--draft <f>` format-checks that draft and prints what survived.
 * - Neither: there is no model here, so there is nothing to do. Exit 0, print
 *   nothing, say so once on stderr.
 *
 * That last mode is the important one. Harvest runs next to a commit, and a
 * commit must never fail because an optional enrichment step had nothing to
 * work with (ADR-0006: 전량 실패 시 비차단). Only two things are errors here: a
 * path the user named that cannot be read, and a draft that is not a draft.
 */
import type { Command } from 'commander';
export interface HarvestOptions {
    transcript?: string | undefined;
    diff?: string | undefined;
    out?: string | undefined;
    promptOnly?: boolean | undefined;
    draft?: string | undefined;
    cwd?: string | undefined;
}
/** What the command would print. Returned rather than written so it is testable. */
export interface HarvestOutcome {
    stdout: string;
    stderr: string;
    exitCode: number;
}
/**
 * Runs the command and reports what it would print. Failures come back as an
 * outcome rather than an exception so the caller prints one line and never a
 * stack trace — a stack trace in the middle of somebody's commit is noise that
 * tells them nothing they can act on.
 */
export declare const runHarvest: (options: HarvestOptions) => HarvestOutcome;
export declare const register: (program: Command) => void;
