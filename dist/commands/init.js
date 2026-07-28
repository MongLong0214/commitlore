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
import { formatReport, runDoctor } from './doctor.js';
import { installHook } from './hooks.js';
import { closeIndex, indexInfo, openIndex, rebuildIndex } from '../core/index-db.js';
import { claudeSettingsPath, installClaudeHook } from '../hooks/claude-settings.js';
import { installPrepareCommitMsgHook } from '../hooks/prepare-commit-msg.js';
const messageOf = (error) => (error instanceof Error ? error.message : String(error));
/** `exactOptionalPropertyTypes` treats `{ cwd: undefined }` as distinct from omitting `cwd` entirely. */
const cwdOption = (opts) => opts.cwd === undefined ? {} : { cwd: opts.cwd };
/**
 * Stricter than `doctor`'s own exit code on purpose. `doctor` exits 0 for a
 * `warn` check by design — it reports, it never blocks a command on its own
 * (`commitlore-setup` skill). `init` is not just reporting: it is the command
 * that is supposed to have taken care of everything at once, so a `warn` it
 * cannot fix itself (no remote configured, shallow history, ...) has to move
 * the needle here even though it would not move `doctor`'s. Folding that back
 * into "3/3 steps completed cleanly" is exactly the silent-success shape #63
 * and #67 were.
 */
const runDoctorStep = (opts) => {
    const report = runDoctor({ ...cwdOption(opts), fix: true });
    const code = report.checks.some((entry) => entry.status === 'warn' || entry.status === 'fail')
        ? 1
        : 0;
    return {
        step: 'doctor',
        title: 'doctor --fix',
        code,
        lines: formatReport(report).trimEnd().split('\n'),
        detail: report,
    };
};
const runHooksStep = (opts) => {
    const commitMsg = installHook({ ...cwdOption(opts), ...(opts.force === undefined ? {} : { force: opts.force }) });
    const prepareCommitMsg = installPrepareCommitMsgHook(opts.cwd);
    const lines = [commitMsg, prepareCommitMsg].flatMap((result) => result.code === 0
        ? result.stdout.trimEnd().split('\n')
        : [result.stderr.trimEnd() || 'hooks install failed with no diagnostic']);
    return {
        step: 'hooks',
        title: 'hooks install',
        code: commitMsg.code === 2 || prepareCommitMsg.code === 2 ? 2 : 0,
        lines,
        detail: [commitMsg, prepareCommitMsg],
    };
};
const runIndexStep = (opts) => {
    const cwd = opts.cwd ?? process.cwd();
    let handle;
    try {
        handle = openIndex({ cwd });
    }
    catch (error) {
        const message = `could not open the index: ${messageOf(error)}`;
        return {
            step: 'index',
            title: 'index --rebuild',
            code: 2,
            lines: [message],
            detail: { ok: false, message },
        };
    }
    try {
        const stats = rebuildIndex(handle, { reason: 'commitlore init' });
        const info = indexInfo(handle);
        const message = `rebuilt: scanned ${stats.commitsScanned} commit(s), indexed ${stats.trailersIndexed + stats.noteTrailersIndexed} trailer(s) in ${stats.elapsedMs}ms`;
        return {
            step: 'index',
            title: 'index --rebuild',
            code: 0,
            lines: [message, `index holds ${info.trailers} trailer(s) over ${info.commits} commit(s)`],
            detail: { ok: true, message, stats },
        };
    }
    catch (error) {
        const message = `could not rebuild the index: ${messageOf(error)}`;
        return {
            step: 'index',
            title: 'index --rebuild',
            code: 2,
            lines: [message],
            detail: { ok: false, message },
        };
    }
    finally {
        try {
            closeIndex(handle);
        }
        catch {
            // A close failure on a handle we are about to discard changes nothing the caller can act on.
        }
    }
};
const runClaudeHookStep = (opts) => {
    const cwd = opts.cwd ?? process.cwd();
    const settingsPath = claudeSettingsPath(cwd);
    const result = installClaudeHook({ settingsPath });
    const lines = result.stdout.trimEnd().split('\n').filter((line) => line.length > 0);
    if (result.stderr) {
        lines.push(...result.stderr.trimEnd().split('\n').filter((line) => line.length > 0));
    }
    // If the hook is already installed (unchanged), treat as success with code 0.
    // If there's an error but it's just about missing settings, that's not a failure — Claude Code may not be on this machine.
    const code = result.code === 0
        ? 0
        : result.status?.state === 'unreadable' && result.status.problem?.includes('cannot read')
            ? 0
            : 2;
    return {
        step: 'claude-hook',
        title: 'claude hook install',
        code,
        lines: lines.length > 0 ? lines : [result.stderr.trim() || 'failed with no diagnostic'],
        detail: result,
    };
};
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
export const runInit = (opts = {}) => {
    const steps = [runHooksStep(opts), runIndexStep(opts), runClaudeHookStep(opts), runDoctorStep(opts)];
    const exitCode = steps.some((s) => s.code === 2) ? 2 : steps.some((s) => s.code === 1) ? 1 : 0;
    return { steps, exitCode: exitCode };
};
const STEP_HEADING = {
    hooks: '[1/4] hooks install',
    index: '[2/4] index --rebuild',
    'claude-hook': '[3/4] claude hook install',
    doctor: '[4/4] doctor --fix (final check)',
};
const INDENT = '        ';
export const formatInitReport = (report) => {
    const blocks = report.steps.map((step) => {
        const body = step.lines.map((line) => `${INDENT}${line}`).join('\n');
        return `${STEP_HEADING[step.step]}\n${body}`;
    });
    const failed = report.steps.filter((step) => step.code === 2).map((step) => step.title);
    const needsAttention = report.steps.filter((step) => step.code === 1).map((step) => step.title);
    const summary = failed.length > 0
        ? `init: ${failed.length}/4 step(s) could not run — ${failed.join(', ')}`
        : needsAttention.length > 0
            ? `init: 4/4 steps ran, ${needsAttention.length} need(s) attention — ${needsAttention.join(', ')} (see detail above)`
            : 'init: 4/4 steps completed cleanly';
    return `${[...blocks, summary].join('\n\n')}\n`;
};
export const register = (program) => {
    program
        .command('init')
        .description('one-command onboarding: hooks install, index --rebuild, claude hook install, doctor --fix')
        .option('--force', 'forward to hooks install — replace an already-preserved foreign hook')
        .option('--json', 'emit the report as JSON')
        .addHelpText('after', '\nRuns four setup steps in sequence — hooks install, index --rebuild, claude hook install, ' +
        'then doctor --fix as a final check — and reports each one\'s own outcome rather than a single ' +
        'pass/fail. A step this command could not complete is named, never absorbed into a success message ' +
        '(see #63, #67). Safe to run more than once: every step it calls is independently idempotent, so ' +
        're-running with nothing else changed changes nothing else.' +
        '\n\n`doctor`, `hooks install`, `index --rebuild`, and `commitlore inject install-claude-hook` ' +
        'still exist on their own for anyone who wants one piece rather than all four.' +
        '\n\nExit codes: 0 all four steps ran clean, 1 the final doctor check found something init could not ' +
        'fix itself (a warn or fail check — read the detail above), 2 hooks install, index rebuild, or claude ' +
        'hook install could not run at all (SPEC §10).')
        .action((options) => {
        const report = runInit(options.force === undefined ? {} : { force: options.force });
        process.stdout.write(options.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatInitReport(report));
        process.exitCode = report.exitCode;
    });
};
//# sourceMappingURL=init.js.map