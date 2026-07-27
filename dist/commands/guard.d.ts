/**
 * `commitlore guard` — the command shell around `core/guard.ts`.
 *
 *   commitlore guard --proposal <text|@file|@-> [paths...] [--threshold n] [--json]
 *
 * Three conventions here are load-bearing, because this command is designed to
 * run from a PreToolUse hook on every edit an agent proposes (ADR-0006 §4):
 *
 * **Exit 2 means "flagged".** 0 is a complete clean check, 1 is a broken
 * invocation, 2 is a warning, and 3 means the check was incomplete. Distinct
 * states keep an unavailable repository from being mistaken for approval.
 *
 * **Nothing is printed when a complete check finds nothing.** Incomplete checks
 * must speak because silence is otherwise indistinguishable from approval.
 *
 * **The warning goes to stderr, the JSON to stdout.** stderr is what the hook
 * protocol routes back to the agent, and it keeps `--json` a clean pipe.
 *
 * A safe warning carries the rejection *reason*. Blocked records are the
 * exception because their content is the attack, not useful decision context.
 */
import type { Command } from 'commander';
import { type GuardMatch, type GuardResult, type RenderedGuardMatch } from '../core/guard.js';
/** Exit status when at least one ruled-out alternative matched. */
export declare const FLAGGED_EXIT_CODE = 2;
export declare const INCOMPLETE_EXIT_CODE = 3;
export type JsonGuardMatch = RenderedGuardMatch;
export interface JsonGuardOutput {
    command: 'guard';
    at: string;
    paths: string[];
    threshold: number;
    /** The one field a hook needs to branch on. */
    matched: boolean;
    history: GuardResult['history'];
    notes: GuardResult['notes'];
    incomplete: boolean;
    matches: JsonGuardMatch[];
}
export declare const toJson: (result: GuardResult, at: Date, paths: readonly string[], threshold: number) => JsonGuardOutput;
/**
 * One block per match. The `because:` line is the whole point of the route, so
 * it sits directly under the alternative rather than in a details footer.
 */
export declare const formatMatches: (matches: readonly GuardMatch[]) => string;
export declare const formatHookContext: (result: GuardResult) => string;
export declare const register: (program: Command) => void;
