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
 * command marks failed, not a step it skips past. Repository MCP registration
 * is deliberately advisory: failure is visible in its own line but does not
 * make the installation fail, because doctor already reports its absence when
 * unattended capture makes an initiator necessary.
 *
 * Idempotent by construction, not by a special case: every step it calls is
 * already idempotent on its own (doctor's checks re-report `ok` once fixed,
 * `hooks install` reports "already installed ... (unchanged)", and an index
 * rebuild is a deterministic function of repository state) — running `init`
 * twice with nothing else changing degrades gracefully because with nothing
 * else changing, none of its sub-invocations do.
 */
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { formatCheckReport, runDoctor } from './doctor.js';
import { installHook } from './hooks.js';
import { closeIndex, indexInfo, openIndex, rebuildIndex } from '../core/index-db.js';
import { notesAvailability } from '../core/notes.js';
import { POLICY_FILE_NAME, POLICY_LOCAL_FILE_NAME, capturePolicyLocalPath, capturePolicyPath, resolvePolicy, setUnattendedCapture, } from '../core/capture-policy.js';
import { claudeSettingsPath, installClaudeHook } from '../hooks/claude-settings.js';
import { pluginDeliveryProof } from '../hooks/claude-plugin.js';
import { spawnSync } from 'node:child_process';
import { latestReleaseSync } from '../core/latest-release.js';
import { packageVersion } from '../core/paths.js';
import { isNewerRelease } from '../core/release-version.js';
import { performUpgrade } from './update.js';
import { installPrepareCommitMsgHook } from '../hooks/prepare-commit-msg.js';
import { installPostCommitHook } from '../hooks/post-commit.js';
import { installPrePushHook } from '../hooks/pre-push.js';
import { seedTrustedAuthor } from '../core/trusted-authors.js';
import { MCP_REGISTRATION_FILE, registerCommitloreMcpServer, } from '../core/mcp-registration.js';
import { installAgentsGuidance } from '../core/agents-guidance.js';
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
 * #415: with no directive author string recorded, grading fails closed and every record
 * the agent ever sees is `[claim]` — the `[directive]` tier the injected legend
 * advertises was unreachable on every install. Seeding the installer's own
 * author string makes it reachable as explicit repository policy: a different
 * string still grades `claim`, while a matching one is not identity proof.
 */
const runTrustStep = (opts) => {
    const result = seedTrustedAuthor(opts.cwd ?? process.cwd());
    return {
        step: 'trust',
        title: 'directive author string',
        code: 0,
        lines: [result.author === null ? result.reason : `${result.author} — ${result.reason}`],
        detail: result,
    };
};
/**
 * A `ClaudeHookResult` for the case where the hook was deliberately not
 * written. Code 0: nothing failed, and the report says what happened rather
 * than staying quiet about a step it skipped.
 */
const skippedClaudeHook = (settingsPath, reason) => ({
    code: 0,
    changed: false,
    stdout: `PreToolUse injection hook not written to ${settingsPath}: ${reason}\n`,
    stderr: '',
});
/**
 * The shared AGENTS.md block is the host-neutral capture initiator.  Keep it
 * beside the existing Claude-specific hook in one integration step: init's
 * compact report is a frozen surface, while both are agent wiring that should
 * report their own outcome instead of hiding a failed guidance write.
 */
const runAgentIntegrationStep = (opts) => {
    const cwd = opts.cwd ?? process.cwd();
    const settingsPath = claudeSettingsPath(cwd);
    // Two installers, one tool call. The plugin registers this same hook, and
    // writing a second one means every matched call is answered twice -- two
    // payloads and two process starts (#781). Neither installer could see the
    // other, so this asks Claude Code's own state instead.
    //
    // It skips only on an affirmative answer. A registry that will not parse, a
    // plugin nobody enabled, a shape that changed under us: all of those write
    // the hook, because being wrong toward a duplicate is a cost somebody
    // notices and being wrong toward silence is one nobody does.
    const plugin = pluginDeliveryProof(cwd);
    const result = plugin.willFire
        ? skippedClaudeHook(settingsPath, plugin.reason)
        : installClaudeHook({ settingsPath });
    // `AGENTS.md` is a convention, not a requirement, and this step writes into a
    // file the repository owns -- 105 lines into an existing one, or a new file
    // where the repository had none. Capture works without it: an end-to-end run
    // with no AGENTS.md drove prepare, verify and stage and landed a `drafted`
    // record, because the Claude plugin carries the same procedure as a skill.
    // What the file buys is hosts that load no skills. Somebody who does not use
    // AGENTS.md should be able to say so rather than delete it after every init.
    if (opts.agentsGuidance !== true) {
        const lines = [
            'AGENTS.md left alone — the capture procedure ships in the MCP server every host receives (--agents-md writes it into the repository as well)',
            ...result.stdout.trimEnd().split('\n').filter((line) => line.length > 0),
        ];
        if (result.stderr) {
            lines.push(...result.stderr.trimEnd().split('\n').filter((line) => line.length > 0));
        }
        return {
            step: 'claude-hook',
            title: 'agent integration',
            code: result.code === 0 ? 0 : 2,
            lines,
            detail: { guidance: null, claude: result },
        };
    }
    const guidance = installAgentsGuidance(cwd);
    const guidanceLine = {
        created: `created AGENTS.md with the CommitLore capture instructions`,
        added: `added the marked CommitLore capture instructions to AGENTS.md`,
        updated: `updated the marked CommitLore capture instructions in AGENTS.md`,
        unchanged: `AGENTS.md already carries the current marked CommitLore capture instructions (unchanged)`,
        invalid: `AGENTS.md has an unsafe CommitLore marker layout and was left unchanged: ${guidance.error ?? 'unknown marker error'}`,
        'write-failed': `could not install the CommitLore capture instructions in AGENTS.md: ${guidance.error ?? 'unknown write error'}`,
    };
    const lines = [guidanceLine[guidance.state], ...result.stdout.trimEnd().split('\n').filter((line) => line.length > 0)];
    if (result.stderr) {
        lines.push(...result.stderr.trimEnd().split('\n').filter((line) => line.length > 0));
    }
    // If the hook is already installed (unchanged), treat as success with code 0.
    // If there's an error but it's just about missing settings, that's not a failure — Claude Code may not be on this machine.
    const code = guidance.state === 'invalid' || guidance.state === 'write-failed'
        ? 2
        : result.code === 0
            ? 0
            : result.status?.state === 'unreadable' && result.status.problem?.includes('cannot read')
                ? 0
                : 2;
    return {
        step: 'claude-hook',
        title: 'agent integration',
        code,
        lines: lines.length > 0 ? lines : [result.stderr.trim() || 'failed with no diagnostic'],
        detail: { guidance, claude: result },
    };
};
/**
 * Make this repository advertise the capture tools a repository-scoped MCP
 * host can load.
 *
 * A failure here used to be reported at code 0, so `init` printed a checkmark
 * and finished with `init: ready` over a repository where nothing can start a
 * capture. Capture is the product; a setup command that cannot wire it is not
 * ready, whatever else succeeded.
 *
 * It is still not fatal — the other steps run, the hooks work, delivery works —
 * so this raises init to 1, the code that already means "ran, and something
 * needs you", never 2. And it says what to do, because the repair is one file
 * and the operator is the only one who can decide what belongs in it.
 */
const runMcpRegistrationStep = (opts) => {
    const cwd = opts.cwd ?? process.cwd();
    const result = registerCommitloreMcpServer(cwd);
    if (!result.ok) {
        return {
            step: 'mcp-registration',
            title: 'MCP registration',
            code: 1,
            lines: [
                `could not register the capture server: ${result.error}`,
                'nothing in this repository can start a capture until it is registered — delivery and the hooks still work',
                `to register it by hand, put this in ${MCP_REGISTRATION_FILE} at the repository root:`,
                '  { "mcpServers": { "commitlore": { "command": "commitlore", "args": ["mcp"] } } }',
                'then run commitlore doctor to confirm it',
            ],
            detail: result,
        };
    }
    const headline = {
        created: `registered the capture server for repository-scoped hosts: wrote ${MCP_REGISTRATION_FILE}`,
        merged: `registered the capture server for repository-scoped hosts in ${MCP_REGISTRATION_FILE}, preserving its existing servers`,
        'already-registered': `${MCP_REGISTRATION_FILE} already registers commitlore — left unchanged`,
    }[result.state];
    return {
        step: 'mcp-registration',
        title: 'MCP registration',
        code: 0,
        lines: [
            headline,
            ...(result.changed
                ? [
                    'the file is committed with the repository — it applies to everyone who clones it',
                    'hosts that keep MCP configuration outside the repository are unchanged',
                ]
                : []),
        ],
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
    // Either file counts as a policy already present (#709). An overlay on its
    // own resolves with `path` null, and treating that as "no policy" would make
    // init write the committed file over an answer the operator already gave.
    if (resolution.path !== null || resolution.localPath !== null) {
        const present = resolution.localPath === null
            ? POLICY_FILE_NAME
            : resolution.path === null
                ? POLICY_LOCAL_FILE_NAME
                : `${POLICY_LOCAL_FILE_NAME} over ${POLICY_FILE_NAME}`;
        if (resolution.ok) {
            const { policy } = resolution;
            return {
                step: 'policy',
                title: 'capture policy',
                code: 0,
                lines: [
                    `policy already present: ${present} (mode "${policy.mode}", unattended ${policy.unattended ? 'on' : 'off'}) — left unchanged`,
                    ...(policy.unattended
                        ? [
                            'unattended capture is authorised, not initiated — an agent host must supply the session transcript before commit; ordinary git commits cannot start it',
                        ]
                        : []),
                ],
                detail: { state: 'existing', path, unattended: policy.unattended, error: null },
            };
        }
        return {
            step: 'policy',
            title: 'capture policy',
            code: 1,
            lines: [`${present} present but rejected — left unchanged`, resolution.error ?? 'unknown error'],
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
                `unattended capture policy enabled: wrote ${POLICY_FILE_NAME} (mode "auto")`,
                'unattended capture is authorised, not initiated — an agent host must supply the session transcript before commit; ordinary git commits cannot start it',
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
 * What `init` pinned, and whether something newer exists (T-1607, #742).
 *
 * `init` writes `commitlore.bin` through `<data-root>/current`, so the
 * repository then validates every commit with whatever that resolves to.
 * Initialising on a stale install wires a repository to a stale protocol,
 * which is #742's opening sentence.
 *
 * **A bare `init` reports and does not move `current`.** That was the plan for
 * two revisions on the Homebrew analogy, and the analogy does not reach:
 * `brew install` refreshes an index, `brew upgrade` replaces packages, and
 * moving `current` is the second. `terraform init` -- the closest analogue by
 * name -- says re-running it "will not change any already-installed modules.
 * Use `-upgrade` to override this behavior." And #746 makes it concrete: an
 * upgrade leaves `commitlore.root` on the old version while `current` moves,
 * so it invalidates the recorded path in every already-wired repository. A
 * repository-scoped command must not do that to repositories nobody named.
 */
const runReleaseStep = (opts) => {
    const env = process.env;
    const current = packageVersion();
    const { outcome } = latestReleaseSync({ env });
    const latest = outcome.kind === 'resolved' ? outcome.tag : null;
    const updateAvailable = latest !== null && isNewerRelease(latest, current);
    const lines = [];
    let code = 0;
    let acted = false;
    if (opts.upgrade !== true) {
        lines.push(updateAvailable
            ? `this repository is pinned to ${current}; ${String(latest)} is available. To move it: commitlore upgrade`
            : `this repository is pinned to ${current}`);
        return { step: 'release', title: 'release', code, lines, detail: { current, latest, updateAvailable, acted } };
    }
    // `--upgrade` is the acting form, and the three ways it can fail are three
    // different facts. Collapsing them into one `catch` is what the ticket names
    // three cases to prevent.
    const blocked = env['COMMITLORE_NO_AUTO_UPDATE'];
    if (blocked !== undefined && blocked !== '') {
        lines.push(`COMMITLORE_NO_AUTO_UPDATE is set; wiring with ${current} and changing nothing`);
    }
    else if (outcome.kind === 'unreachable' || outcome.kind === 'disabled') {
        // Offline still needs a working repository.
        lines.push(`could not check for a newer release; wiring with ${current}`);
    }
    else if (outcome.kind === 'refused' || outcome.kind === 'no-tag-matched') {
        // A different fact from offline, and named as one.
        lines.push(`the release list was reachable but gave no usable answer; wiring with ${current}`);
    }
    else if (!updateAvailable) {
        lines.push(`${current} is already the newest release`);
    }
    else {
        acted = true;
        const result = performUpgrade(String(latest), {
            env,
            platform: process.platform,
            runInstaller: (script, tag) => spawnSync(process.platform === 'win32' ? 'powershell' : 'sh', [script, tag], { stdio: 'inherit' }),
        });
        lines.push(...result.lines);
        // An installer that ran and failed is not "offline", and the explicit verb
        // is allowed to exit non-zero.
        if (result.code !== 0)
            code = 2;
    }
    return { step: 'release', title: 'release', code, lines, detail: { current, latest, updateAvailable, acted } };
};
export const runInit = (opts = {}) => {
    const notesBefore = notesAvailability(cwdOption(opts));
    // First, so `--upgrade` has moved `current` before anything records a
    // path through it.
    const steps = [runReleaseStep(opts), runHooksStep(opts), runTrustStep(opts), runIndexStep(opts), runAgentIntegrationStep(opts), runMcpRegistrationStep(opts), runPolicyStep(opts), runDoctorStep(opts)];
    const exitCode = steps.some((s) => s.code === 2) ? 2 : steps.some((s) => s.code === 1) ? 1 : 0;
    return { steps, notesBefore, exitCode: exitCode };
};
/** User-facing step labels — no internal command names. */
const STEP_LABEL = {
    release: 'Release',
    hooks: 'Hooks',
    trust: 'Trust',
    index: 'Index',
    'claude-hook': 'Agent integration',
    'mcp-registration': 'MCP registration',
    policy: 'Capture policy',
    doctor: 'Final check',
};
/** Verbose format headings (preserved for --verbose, T-1013). */
export const STEP_HEADING = {
    release: 'Release',
    trust: 'directive author string',
    hooks: '[1/4] hooks install',
    index: '[2/4] index --rebuild',
    'claude-hook': '[3/4] agent integration',
    'mcp-registration': 'repository MCP registration',
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
            return 'unattended policy enabled — agent host must initiate capture (committed — applies to the whole team)';
        case 'declined':
            return 'unattended capture declined — enable later: commitlore auto on';
        case 'no-answer':
            return 'unattended capture not enabled — the prompt got no answer';
        case 'no-tty':
            return 'unattended capture not enabled — no interactive terminal';
        case 'existing':
            return detail.unattended === true
                ? 'unchanged — unattended policy on; agent host must initiate capture'
                : 'unchanged — unattended capture off';
        case 'existing-rejected':
            return 'policy file rejected — left unchanged';
        case 'write-failed':
            return 'could not write the policy file';
        case 'no-repository':
            return 'no repository';
    }
};
/** The repository-owned MCP step's outcome in the concise result report. */
const mcpRegistrationOutcome = (step) => {
    const detail = step.detail;
    if (!detail.ok)
        return 'not registered for repository-scoped hosts — doctor will report it when unattended capture needs an initiator';
    switch (detail.state) {
        case 'created':
            return 'registered for repository-scoped hosts (committed — applies to the whole team)';
        case 'merged':
            return 'registered alongside existing servers for repository-scoped hosts (committed — applies to the whole team)';
        case 'already-registered':
            return 'already registered for repository-scoped hosts — left unchanged';
    }
};
const stepLabel = (step) => step.step === 'policy'
    ? `${STEP_LABEL.policy} — ${policyOutcome(step)}`
    : step.step === 'mcp-registration'
        ? `${STEP_LABEL['mcp-registration']} — ${mcpRegistrationOutcome(step)}`
        : // The pinned version belongs in the compact report, not only the
            // verbose one: an operator who wired a repository to a stale build has
            // to learn it at the moment it happened, and the summary is what they
            // read (T-1607).
            step.step === 'release'
                ? `${STEP_LABEL.release} — ${step.lines[0] ?? ''}`
                : STEP_LABEL[step.step];
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
            lines.push(`init: ${failed.length}/7 step(s) could not run — ${failed.map((s) => s.title).join(', ')}`);
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
    const overlay = capturePolicyLocalPath(process.cwd());
    if (existing !== null && existsSync(existing))
        return 'no-answer';
    // Same reason for the overlay: a policy is already set here, so the prompt
    // would invite a yes that changes nothing (#709).
    if (overlay !== null && existsSync(overlay))
        return 'no-answer';
    if (options.json !== true && process.stdin.isTTY === true && process.stdout.isTTY === true) {
        process.stdout.write('Unattended capture authorises an agent host to prepare, verify and stage a record without asking.\n' +
            'It does not make ordinary git commits start capture: the host must provide the session transcript.\n' +
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
        .description('one-command onboarding: hooks install, directive author string, index --rebuild, agent integration, repository MCP registration, capture policy, doctor --fix')
        .option('--force', 'forward to hooks install — replace an already-preserved foreign hook')
        .option('--verbose', 'show step-by-step detail output instead of the result summary')
        .option('--json', 'emit the report as JSON')
        .option('--upgrade', 'upgrade to the newest release before wiring this repository')
        .option('--unattended', 'enable unattended capture if the repository has no policy file yet (skips the prompt; for scripts)')
        .option('--no-unattended', 'leave unattended capture off if the repository has no policy file yet (skips the prompt; for scripts)')
        .option('--agents-md', 'also write the capture procedure into AGENTS.md (off by default; the MCP server already carries it)')
        .addHelpText('after', '\nRuns seven setup steps in sequence — hooks install, directive author string, index --rebuild, agent ' +
        'integration, repository MCP registration, capture policy, then doctor --fix as a final check — and reports each one\'s own outcome rather than a single ' +
        'pass/fail. A step this command could not complete is named, never absorbed into a success message ' +
        '(see #63, #67). Safe to run more than once: every step it calls is independently idempotent, so ' +
        're-running with nothing else changed changes nothing else.' +
        '\n\nUnattended capture: with no policy file yet, init asks whether to authorise it — the default is ' +
        'yes, and a bare Enter accepts. The answer is written to ' + POLICY_FILE_NAME + ', which is ' +
        'committed with the repository: enabling it applies to everyone who clones it. The policy does not ' +
        'install a capture initiator: an agent host must call `commitlore_prepare_capture` with its session ' +
        'transcript before commit, because ordinary git commits cannot start capture. A policy file that ' +
        'already exists is reported and left unchanged, whatever the flags say. Without an interactive ' +
        'terminal (scripts, CI) init does not enable it and says so; pass --unattended to opt in ' +
        'explicitly.' +
        '\n\nMCP registration writes the repository-scoped ' + MCP_REGISTRATION_FILE + ' only; it does not configure hosts that keep their ' +
        'own MCP settings elsewhere. The file uses `commitlore mcp`, not a machine-local path, and is committed with the repository so it applies to everyone who clones it.' +
        '\n\n`doctor`, `hooks install`, `index --rebuild`, and `commitlore inject install-claude-hook` ' +
        'still exist on their own for anyone who wants one piece rather than all seven.' +
        '\n\nExit codes: 0 every step ran clean, 1 the final doctor check found something init could not ' +
        'fix itself, an agent host still needs configuring for unattended capture, or a policy file exists that the resolver rejects (an actionable warning or failure — ' +
        'read the detail above), 2 hooks install, index rebuild, agent integration, or the policy write ' +
        'could not run at all (SPEC §10). Agent integration writes or refreshes only CommitLore\'s marked section in ' +
        'AGENTS.md, and only when `--agents-md` asks for it: the capture procedure ships in the MCP server\'s instructions, which every wired host receives on initialize, so the file is not how the procedure travels. A repository MCP registration that cannot be written leaves the ' +
        'install degraded rather than broken; doctor reports it when unattended capture needs an initiator.')
        .action(async (options) => {
        const choice = await resolveUnattendedChoice(options);
        const initOptions = options.force === undefined ? {} : { force: options.force };
        initOptions.unattended = choice;
        if (options.agentsMd === true)
            initOptions.agentsGuidance = true;
        if (options.upgrade === true)
            initOptions.upgrade = true;
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