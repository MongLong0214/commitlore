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
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { formatCheckReport, runDoctor } from './doctor.js';
import { installHook } from './hooks.js';
import { closeIndex, indexInfo, openIndex, rebuildIndex } from '../core/index-db.js';
import { notesAvailability } from '../core/notes.js';
import { POLICY_FILE_NAME, capturePolicyPath, resolvePolicy, setUnattendedCapture, } from '../core/capture-policy.js';
import { claudeSettingsPath, installClaudeHook } from '../hooks/claude-settings.js';
import { installPrepareCommitMsgHook } from '../hooks/prepare-commit-msg.js';
import { installPostCommitHook } from '../hooks/post-commit.js';
import { installPrePushHook } from '../hooks/pre-push.js';
import { seedTrustedAuthor } from '../core/trusted-authors.js';
const messageOf = (error) => (error instanceof Error ? error.message : String(error));
/** `exactOptionalPropertyTypes` treats `{ cwd: undefined }` as distinct from omitting `cwd` entirely. */
const cwdOption = (opts) => opts.cwd === undefined ? {} : { cwd: opts.cwd };
/**
 * Stricter than `doctor`'s own exit code on purpose. `doctor` exits 0 for a
 * `warn` check by design — it reports, it never blocks a command on its own
 * (`commitlore-setup` skill). `init` is not just reporting: it is the command
 * that is supposed to have taken care of everything at once, so a warning it
 * cannot fix itself has to move the needle even though it would not move
 * `doctor`'s. A missing remote remains visible but is non-actionable: a fresh
 * repository has not reached sharing yet, rather than being misconfigured.
 * Folding actionable warnings back into "3/3 steps completed cleanly" is the
 * silent-success shape #63 and #67 were.
 */
const runDoctorStep = (opts) => {
    const report = runDoctor({ ...cwdOption(opts), fix: true });
    const code = report.checks.some((entry) => entry.needsAttention) ? 1 : 0;
    return {
        step: 'doctor',
        title: 'doctor --fix',
        code,
        lines: formatCheckReport(report).trimEnd().split('\n'),
        detail: report,
    };
};
const runHooksStep = (opts) => {
    const commitMsg = installHook({ ...cwdOption(opts), ...(opts.force === undefined ? {} : { force: opts.force }) });
    const prepareCommitMsg = installPrepareCommitMsgHook(opts.cwd);
    const postCommit = installPostCommitHook(opts.cwd);
    // #416: without this the notes mirror is written locally and never leaves the
    // machine, so a teammate's clone cannot see a record it holds.
    const prePush = installPrePushHook(opts.cwd);
    const lines = [commitMsg, prepareCommitMsg, postCommit, prePush].flatMap((result) => result.code === 0
        ? result.stdout.trimEnd().split('\n')
        : [result.stderr.trimEnd() || 'hooks install failed with no diagnostic']);
    return {
        step: 'hooks',
        title: 'hooks install',
        code: [commitMsg, prepareCommitMsg, postCommit, prePush].some((r) => r.code === 2) ? 2 : 0,
        lines,
        detail: [commitMsg, prepareCommitMsg, postCommit, prePush],
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
/**
 * #415: with no trusted author recorded, grading fails closed and every record
 * the agent ever sees is `[claim]` — the `[directive]` tier the injected legend
 * advertises was unreachable on every install. Seeding the installer's own
 * identity makes it reachable without weakening the property it protects: a
 * different author's commit still grades `claim`.
 */
const runTrustStep = (opts) => {
    const result = seedTrustedAuthor(opts.cwd ?? process.cwd());
    return {
        step: 'trust',
        title: 'trusted author',
        code: 0,
        lines: [result.author === null ? result.reason : `${result.author} — ${result.reason}`],
        detail: result,
    };
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
 * The unattended-capture decision (#511 added the switch; this is where a
 * repository acquires it without anyone hand-editing JSON).
 *
 * Two rules this step exists to enforce on itself:
 *
 * - **A policy file that is already there is never changed.** `init` gets
 *   re-run to repair a hook; the team's capture policy must not flip as a
 *   side effect. The step reports what is there and leaves it, and that
 *   includes a file the resolver rejects — the step names the error instead
 *   of rewriting whatever the user meant to put there.
 * - **The outcome is always stated in the output.** A repository that
 *   acquires a capture policy without the operator being told is the failure
 *   this whole feature has been careful to avoid.
 *
 * No TTY and no flag: this step does **not** enable. Consent to capture with
 * nobody in the loop should be an answer somebody gave, and a script that ran
 * `init` for the hooks did not answer this question. The policy file is
 * committed with the repository, so defaulting yes where nobody sees the
 * prompt would hand a CI run a team-wide flip the next time anyone commits
 * the tree. A script that wants the setting has one flag: `--unattended`.
 */
const runPolicyStep = (opts) => {
    const cwd = opts.cwd ?? process.cwd();
    const choice = opts.unattended ?? 'no-tty';
    const path = capturePolicyPath(cwd);
    if (path === null) {
        return {
            step: 'policy',
            title: 'capture policy',
            code: 2,
            lines: ['no git repository found here — the policy step needs a repository'],
            detail: { state: 'no-repository', path: null, unattended: null, error: 'no git repository' },
        };
    }
    const resolution = resolvePolicy(cwd);
    if (resolution.path !== null) {
        if (resolution.ok) {
            const { policy } = resolution;
            return {
                step: 'policy',
                title: 'capture policy',
                code: 0,
                lines: [
                    `policy already present: ${POLICY_FILE_NAME} (mode "${policy.mode}", unattended ${policy.unattended ? 'on' : 'off'}) — left unchanged`,
                ],
                detail: { state: 'existing', path, unattended: policy.unattended, error: null },
            };
        }
        return {
            step: 'policy',
            title: 'capture policy',
            code: 1,
            lines: [`${POLICY_FILE_NAME} present but rejected — left unchanged`, resolution.error ?? 'unknown error'],
            detail: { state: 'existing-rejected', path, unattended: null, error: resolution.error },
        };
    }
    if (choice === 'enable') {
        const result = setUnattendedCapture(cwd, true);
        if (!result.ok) {
            return {
                step: 'policy',
                title: 'capture policy',
                code: 2,
                lines: [result.error],
                detail: { state: 'write-failed', path, unattended: null, error: result.error },
            };
        }
        return {
            step: 'policy',
            title: 'capture policy',
            code: 0,
            lines: [
                `unattended capture enabled: wrote ${POLICY_FILE_NAME} (mode "auto")`,
                'the file is committed with the repository — it applies to everyone who clones it',
            ],
            detail: { state: 'enabled', path, unattended: true, error: null },
        };
    }
    const declineLine = {
        decline: ['unattended capture: not enabled — declined at the prompt (enable later: commitlore auto on)'],
        'no-answer': [
            'unattended capture: not enabled — the prompt got no answer (enable later: commitlore auto on)',
        ],
        'no-tty': [
            'unattended capture: not enabled — no interactive terminal to answer the prompt',
            "run 'commitlore init --unattended' or 'commitlore auto on' to enable it",
        ],
    };
    return {
        step: 'policy',
        title: 'capture policy',
        code: 0,
        lines: declineLine[choice],
        detail: { state: choice === 'decline' ? 'declined' : choice, path, unattended: false, error: null },
    };
};
/**
 * Order of execution:
 * 1. Hooks install — sets up the commit-msg hook
 * 2. Index rebuild — builds the index of trailers
 * 3. Claude hook install — wires the PreToolUse hook into .claude/settings.json
 * 4. Capture policy — asks about unattended capture, once, where no policy exists yet
 * 5. Doctor (final check) — verifies everything is working
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
    const notesBefore = notesAvailability(cwdOption(opts));
    const steps = [runHooksStep(opts), runTrustStep(opts), runIndexStep(opts), runClaudeHookStep(opts), runPolicyStep(opts), runDoctorStep(opts)];
    const exitCode = steps.some((s) => s.code === 2) ? 2 : steps.some((s) => s.code === 1) ? 1 : 0;
    return { steps, notesBefore, exitCode: exitCode };
};
/** User-facing step labels — no internal command names. */
const STEP_LABEL = {
    hooks: 'Hooks',
    trust: 'Trust',
    index: 'Index',
    'claude-hook': 'Agent integration',
    policy: 'Capture policy',
    doctor: 'Final check',
};
/** Verbose format headings (preserved for --verbose, T-1013). */
export const STEP_HEADING = {
    trust: 'trusted author',
    hooks: '[1/4] hooks install',
    index: '[2/4] index --rebuild',
    'claude-hook': '[3/4] claude hook install',
    // Unnumbered on purpose, the same way `trust` was added: the numbered four
    // are pinned by T-1013's tests, and renumbering them would move a frozen
    // contract for a step that does not need a number.
    policy: 'capture policy',
    doctor: '[4/4] doctor --fix (final check)',
};
export const VERBOSE_INDENT = '        ';
/**
 * The policy step's outcome in one clause. A clean run prints one line per
 * step and no detail lines, so the step's own line carries what happened —
 * "enabled" must be visible in the output, not merely inferable (#511's
 * consent rule: a repository never acquires the setting without being told).
 */
const policyOutcome = (step) => {
    const detail = step.detail;
    switch (detail.state) {
        case 'enabled':
            return 'unattended capture enabled (committed — applies to the whole team)';
        case 'declined':
            return 'unattended capture declined — enable later: commitlore auto on';
        case 'no-answer':
            return 'unattended capture not enabled — the prompt got no answer';
        case 'no-tty':
            return 'unattended capture not enabled — no interactive terminal';
        case 'existing':
            return `unchanged — unattended capture ${detail.unattended === true ? 'on' : 'off'}`;
        case 'existing-rejected':
            return 'policy file rejected — left unchanged';
        case 'write-failed':
            return 'could not write the policy file';
        case 'no-repository':
            return 'no repository';
    }
};
const stepLabel = (step) => step.step === 'policy' ? `${STEP_LABEL.policy} — ${policyOutcome(step)}` : STEP_LABEL[step.step];
/**
 * Result-oriented default output: a concise summary telling the user what is
 * ready and what is not. Internal command names are absent. Failures and
 * warnings are always named — never folded into a cheerful summary (#63, #67).
 */
export const formatInitReport = (report) => {
    const failed = report.steps.filter((step) => step.code === 2);
    const needsAttention = report.steps.filter((step) => step.code === 1);
    const lines = [];
    if (failed.length === 0 && needsAttention.length === 0) {
        // All clean — one summary line per step + a final ready line.
        for (const step of report.steps) {
            lines.push(`  ✓ ${stepLabel(step)}`);
        }
        lines.push('');
        lines.push('init: ready');
        // #402: every step succeeded and the index is still missing whatever the
        // team kept in notes, because `git fetch` does not carry
        // `refs/notes/commitlore`. That is the default state of a fresh clone, and
        // this is the one screen most users will read. The clean run has a line to
        // spare inside the ≤6 the output contract allows, and a `ready` that is not
        // ready costs more than the line does. The state is `notesAvailability`'s,
        // so this reports rather than checks.
        if (report.notesBefore === 'unfetched') {
            lines.push('note: the notes mirror has not been fetched, so the index covers commit messages alone — run: git fetch');
        }
    }
    else {
        // At least one step needs attention or could not run.
        for (const step of report.steps) {
            if (step.code === 0) {
                lines.push(`  ✓ ${stepLabel(step)}`);
            }
            else if (step.code === 2) {
                lines.push(`  ✗ ${STEP_LABEL[step.step]} — ${step.title} could not run`);
                for (const detail of step.lines) {
                    lines.push(`    ${detail}`);
                }
            }
            else {
                lines.push(`  ! ${STEP_LABEL[step.step]} — needs attention`);
                for (const detail of step.lines) {
                    lines.push(`    ${detail}`);
                }
            }
        }
        lines.push('');
        if (failed.length > 0) {
            lines.push(`init: ${failed.length}/6 step(s) could not run — ${failed.map((s) => s.title).join(', ')}`);
        }
        else {
            lines.push(`init: ${needsAttention.length} step(s) need(s) attention — ${needsAttention.map((s) => s.title).join(', ')}`);
        }
    }
    return lines.join('\n') + '\n';
};
/**
 * Verbose output: step-by-step `[1/4]`…`[4/4]` format with indented detail
 * lines. Preserves the pre-T-1012 output style for users who want the full
 * view. Failures and warnings are always visible — never folded (#63, #67).
 */
export const formatInitReportVerbose = (report) => {
    const lines = [];
    for (const step of report.steps) {
        lines.push(STEP_HEADING[step.step]);
        for (const detail of step.lines) {
            lines.push(`${VERBOSE_INDENT}${detail}`);
        }
    }
    return lines.join('\n') + '\n';
};
// ---------------------------------------------------------------------------
// The unattended-capture prompt
// ---------------------------------------------------------------------------
const parseYesNo = (answer) => {
    const normalized = answer.trim().toLowerCase();
    // A bare Enter takes the default, and the default is yes — the prompt says
    // so with [Y/n].
    if (normalized === '' || normalized === 'y' || normalized === 'yes')
        return true;
    if (normalized === 'n' || normalized === 'no')
        return false;
    return null;
};
/**
 * Ask on the controlling terminal. Resolves null when the input stream closes
 * without an answer (EOF, Ctrl-D) — that is "nobody answered", not "no".
 */
const askUnattended = async () => {
    for (;;) {
        const answer = await new Promise((resolveAnswer) => {
            const readlineInterface = createInterface({ input: process.stdin, output: process.stdout });
            let settled = false;
            const settle = (value) => {
                if (settled)
                    return;
                settled = true;
                readlineInterface.close();
                resolveAnswer(value);
            };
            readlineInterface.question('Enable unattended capture? [Y/n] ', (line) => settle(line));
            readlineInterface.on('close', () => settle(null));
        });
        if (answer === null)
            return null;
        const parsed = parseYesNo(answer);
        if (parsed !== null)
            return parsed;
        process.stdout.write('Please answer y or n — a bare Enter accepts the default (yes).\n');
    }
};
/**
 * How this invocation decides about unattended capture, before any step runs:
 *
 * 1. An explicit flag answers without a prompt — that is what scripts get.
 * 2. An interactive terminal gets the question. Default yes, bare Enter takes
 *    it; the prompt names the one thing a yes cannot take back quietly: the
 *    file is committed, so it applies to the whole team.
 * 3. Anything else — no TTY, or `--json`, which is a machine reading the
 *    output — gets no prompt and does not enable. The output states that.
 */
const resolveUnattendedChoice = async (options) => {
    if (options.unattended === true)
        return 'enable';
    if (options.unattended === false)
        return 'decline';
    // A policy file that already exists is never changed, whatever the answer —
    // so the question is not asked. Asking it would invite a yes that does
    // nothing, which reads as consent being taken rather than given.
    const existing = capturePolicyPath(process.cwd());
    if (existing !== null && existsSync(existing))
        return 'no-answer';
    if (options.json !== true && process.stdin.isTTY === true && process.stdout.isTTY === true) {
        process.stdout.write('Unattended capture prepares, verifies and stages a record on every commit without asking.\n' +
            `The answer is written to ${POLICY_FILE_NAME} and committed — enabling it applies to everyone who clones this repository.\n`);
        let answer;
        try {
            answer = await askUnattended();
        }
        catch {
            answer = null;
        }
        return answer === null ? 'no-answer' : answer ? 'enable' : 'decline';
    }
    return 'no-tty';
};
export const register = (program) => {
    program
        .command('init')
        .description('one-command onboarding: hooks install, trusted author, index --rebuild, claude hook install, capture policy, doctor --fix')
        .option('--force', 'forward to hooks install — replace an already-preserved foreign hook')
        .option('--verbose', 'show step-by-step detail output instead of the result summary')
        .option('--json', 'emit the report as JSON')
        .option('--unattended', 'enable unattended capture if the repository has no policy file yet (skips the prompt; for scripts)')
        .option('--no-unattended', 'leave unattended capture off if the repository has no policy file yet (skips the prompt; for scripts)')
        .addHelpText('after', '\nRuns six setup steps in sequence — hooks install, trusted author, index --rebuild, claude hook ' +
        'install, capture policy, then doctor --fix as a final check — and reports each one\'s own outcome rather than a single ' +
        'pass/fail. A step this command could not complete is named, never absorbed into a success message ' +
        '(see #63, #67). Safe to run more than once: every step it calls is independently idempotent, so ' +
        're-running with nothing else changed changes nothing else.' +
        '\n\nUnattended capture: with no policy file yet, init asks whether to enable it — the default is ' +
        'yes, and a bare Enter accepts. The answer is written to ' + POLICY_FILE_NAME + ', which is ' +
        'committed with the repository: enabling it applies to everyone who clones it. A policy file that ' +
        'already exists is reported and left unchanged, whatever the flags say. Without an interactive ' +
        'terminal (scripts, CI) init does not enable it and says so; pass --unattended to opt in ' +
        'explicitly.' +
        '\n\n`doctor`, `hooks install`, `index --rebuild`, and `commitlore inject install-claude-hook` ' +
        'still exist on their own for anyone who wants one piece rather than all six.' +
        '\n\nExit codes: 0 every step ran clean, 1 the final doctor check found something init could not ' +
        'fix itself, or a policy file exists that the resolver rejects (an actionable warning or failure — ' +
        'read the detail above), 2 hooks install, index rebuild, claude hook install, or the policy write ' +
        'could not run at all (SPEC §10).')
        .action(async (options) => {
        const choice = await resolveUnattendedChoice(options);
        const initOptions = options.force === undefined ? {} : { force: options.force };
        initOptions.unattended = choice;
        const report = runInit(initOptions);
        let output;
        if (options.json === true) {
            output = `${JSON.stringify(report, null, 2)}\n`;
        }
        else if (options.verbose === true) {
            output = formatInitReportVerbose(report);
        }
        else {
            output = formatInitReport(report);
        }
        process.stdout.write(output);
        process.exitCode = report.exitCode;
    });
};
//# sourceMappingURL=init.js.map