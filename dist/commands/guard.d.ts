/**
 * `commitlore guard` — the command shell around `core/guard.ts`.
 *
 *   commitlore guard --proposal <text|@file|@-> [paths...] [--threshold n] [--json]
 *
 * Three conventions here are load-bearing, because this command is designed to
 * run from a PreToolUse hook on every edit an agent proposes (ADR-0006 §4):
 *
 * **Exit 2 means "flagged".** 0 is a clean proposal, 1 is a broken invocation,
 * 2 is the warning. Three states, because a hook that cannot distinguish "this
 * proposal revives a rejected approach" from "the path you gave does not exist"
 * will eventually treat both as noise. It is also the Claude Code hook
 * convention: exit 2 is the code whose stderr is fed back to the agent.
 *
 * **Nothing is printed when nothing matches.** Not a summary, not a count. A
 * command that prints on every edit is a command that gets removed from the
 * hook list within a day.
 *
 * **The warning goes to stderr, the JSON to stdout.** stderr is what the hook
 * protocol routes back to the agent, and it keeps `--json` a clean pipe.
 *
 * The warning always carries the rejection *reason*. "This was ruled out" alone
 * sends the agent back through the same reasoning to the same conclusion; the
 * reason is the part that changes the next proposal.
 */
import type { Command } from 'commander';
import { type GuardMatch } from '../core/guard.js';
/** Exit status when at least one ruled-out alternative matched. */
export declare const FLAGGED_EXIT_CODE = 2;
export interface JsonGuardMatch {
    recordId: string | null;
    sha: string;
    alternative: string;
    reason: string;
    score: number;
    signals: string[];
}
export interface JsonGuardOutput {
    command: 'guard';
    at: string;
    paths: string[];
    threshold: number;
    /** The one field a hook needs to branch on. */
    matched: boolean;
    matches: JsonGuardMatch[];
}
export declare const toJson: (matches: readonly GuardMatch[], at: Date, paths: readonly string[], threshold: number) => JsonGuardOutput;
/**
 * One block per match. The `because:` line is the whole point of the route, so
 * it sits directly under the alternative rather than in a details footer.
 */
export declare const formatMatches: (matches: readonly GuardMatch[]) => string;
export declare const register: (program: Command) => void;
