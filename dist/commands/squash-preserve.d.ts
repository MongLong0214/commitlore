/**
 * `commitlore squash-preserve` — carry a branch's records onto the commit that
 * squashed it (T-302, ADR-0004, PRD-F3 AC 1·2).
 *
 * Two contracts hold this command in place, because a GitHub Action will run it
 * unattended on every merge:
 *
 *   exit 0  the plan was produced (and applied, if asked). Conflicts warn here.
 *   exit 2  the range is not a range, names nothing, is empty, or a write failed
 *
 * A conflict is a warning and never a failure. Two commits disagreeing about a
 * record is a normal thing for a branch to do, and blocking a merge over it
 * would teach people to stop writing records — the opposite of the point.
 *
 * Doing nothing is the default. With neither `--message-file` nor `--target`
 * the command prints what it would write and touches nothing, so it is safe to
 * run against somebody else's repository to see what a merge would inherit.
 *
 * Nothing here pushes. `refs/notes/commitlore` is written locally and published
 * by whoever owns the remote (ADR-0004).
 */
import type { Command } from 'commander';
import { type SquashPlan } from '../core/squash.js';
export interface SquashPreserveInput {
    range?: string;
    /** The merge commit to mirror the inherited record onto. */
    target?: string;
    /** A merge message draft to rewrite in place. */
    messageFile?: string;
    json?: boolean;
    /** Overwrite an existing note on `--target`. */
    force?: boolean;
    cwd?: string;
}
/** Exit code plus the streams the caller writes, so tests can drive this in-process. */
export interface SquashPreserveOutcome {
    code: 0 | 2;
    stdout: string;
    stderr: string;
    plan: SquashPlan | null;
}
/**
 * Runs the command and reports what it would print. Input failures come back as
 * a `code`, never as an exception, so the caller prints one line rather than a
 * stack trace into somebody's merge.
 */
export declare const runSquashPreserve: (input?: SquashPreserveInput) => SquashPreserveOutcome;
export declare const register: (program: Command) => void;
