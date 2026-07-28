/**
 * `commitlore init` — one command instead of the three-command onboarding
 * sequence (`doctor --fix`, `hooks install`, `index --rebuild`; see
 * `runInit` below for why this file runs them hooks, index, doctor instead
 * of that order).
 *
 * The three pieces stay: this file calls the same functions their own
 * commands call (`runDoctor`, `installHook`, `rebuildIndex`) rather than
 * re-implementing them, so `init` can never disagree with running the steps
 * by hand. It exists only to remove the four-command discovery problem (the
 * install path sits ~100 lines into the README) and the three-command
 * sequencing problem (a new clone has to know the order and that all three
 * are needed at all).
 *
 * The one rule this command exists to enforce on itself: **a step that fails
 * is reported as failed, never folded into a cheerful "done".** #63 (`doctor
 * --fix` silently broke `git fetch`) and #67 (a hook could fail with nothing
 * on stderr) were both this same defect — a step that did not do what it
 * claimed, discovered later, far from the command that hid it. `init` runs
 * three steps that can each fail independently and are not allowed to hide
 * that from one another: doctor's own fail/warn distinction is preserved
 * verbatim, and a hook or index step that could not run is a step this
 * command marks failed, not a step it skips past.
 *
 * Idempotent by construction, not by a special case: every step it calls is
 * already idempotent on its own (doctor's checks re-report `ok` once fixed,
 * `hooks install` reports "already installed ... (unchanged)", and an index
 * rebuild is a deterministic function of repository state) — running `init`
 * twice with nothing else changing degrades gracefully because with nothing
 * else changing, none of the three sub-invocations do.
 */
import type { Command } from 'commander';
import { type DoctorReport } from './doctor.js';
import { type HookResult } from './hooks.js';
import { type IndexStats } from '../core/index-db.js';
import { type ClaudeHookResult } from '../hooks/claude-settings.js';
export interface InitOptions {
    cwd?: string;
    /** Forwarded to `hooks install --force` — replace an already-preserved foreign hook. */
    force?: boolean;
}
type StepName = 'doctor' | 'hooks' | 'index' | 'claude-hook';
export interface InitStep {
    step: StepName;
    title: string;
    /** 0 clean, 1 doctor found something it could not fix itself, 2 the step could not run. */
    code: 0 | 1 | 2;
    /** Human-readable lines this step contributes to the report. */
    lines: string[];
    detail: DoctorReport | HookResult | IndexStepDetail | ClaudeHookResult;
}
interface IndexStepDetail {
    ok: boolean;
    message: string;
    stats?: IndexStats;
}
export interface InitReport {
    steps: InitStep[];
    /** Worst of the three step codes — 2 outranks 1 outranks 0, same order SPEC §10 gives the codes themselves. */
    exitCode: 0 | 1 | 2;
}
/**
 * Order of execution:
 * 1. Hooks install — sets up the commit-msg hook
 * 2. Index rebuild — builds the index of trailers
 * 3. Claude hook install — wires the PreToolUse hook into .claude/settings.json
 * 4. Doctor (final check) — verifies everything is working
 *
 * Doctor runs last on purpose. `doctor` diagnoses the hook and the index among
 * its checks, and it does not install either: run it first and its own
 * report would open with "no commit-msg hook" and "no index yet" for
 * conditions this same invocation is about to fix in earlier steps. That is
 * not wrong, but it reads as though `init` shipped with a problem it did not
 * — a false alarm this command is specifically trying not to raise. The other
 * steps do not depend on each other or on doctor's fixes, so running doctor
 * last costs nothing and makes its report describe the state `init` actually
 * leaves behind, not the state it started from.
 */
export declare const runInit: (opts?: InitOptions) => InitReport;
export declare const formatInitReport: (report: InitReport) => string;
export declare const register: (program: Command) => void;
export {};
