/**
 * `commitlore doctor` — is this repository able to carry and share records?
 *
 * The mirror in `refs/notes/commitlore` (ADR-0004) only reaches a teammate if
 * their clone is configured to fetch it, which git does not do by default. A
 * clone that skips that step reads an empty mirror and reports "no record" for
 * commits that have one — a silent wrong answer, the most expensive kind here.
 * doctor exists to turn that into a visible, fixable finding.
 *
 * Two boundaries are deliberate:
 *
 * - `--fix` only writes reversible local config (`remote.<name>.fetch`).
 *   Pushing notes is a network write to a shared ref, so doctor prints the
 *   command and lets a human run it.
 * - The commit-msg hook is *reported*, never installed. `commitlore hooks
 *   install` (T-202) owns that file; doctor only reads it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir as tmpdirPath } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execGit, hasShallowHistory } from '../core/git.js';
import { describeRecordedHookTarget, hasAllowedBinExtension, readRecordedHookTarget, } from '../core/hook-target.js';
import { PACKAGE_ROOT, installedPath } from '../core/paths.js';
import { closeIndex, indexInfo, openIndex } from '../core/index-db.js';
import { NOTES_REF, NOTES_REFSPEC, coversNotes, listRemotes, fetchRefspecs, } from '../core/notes.js';
import { parseCommitMessage } from '../core/trailers.js';
import { runQuery } from '../core/query.js';
import { claudeSettingsPath, readClaudeHookStatus } from '../hooks/claude-settings.js';
import { HOOK_MARKER, commitMsgStub } from '../hooks/commit-msg.js';
/** Probe message for the git capability check — one trailer of each shape. */
const PROBE_MESSAGE = 'commitlore doctor probe\n\nLimit: probe\nBlast: local\n';
const EXACT_NOTES_REFSPEC = `+${NOTES_REF}:${NOTES_REF}`;
const EXACT_NOTES_REFSPEC_PATTERN = `^\\${EXACT_NOTES_REFSPEC}$`;
const gitOptions = (opts) => (opts.cwd === undefined ? {} : { cwd: opts.cwd });
const check = (id, title, status, detail, fix = null, fixed = false) => ({ id, title, status, detail, fix, fixed });
const checkRefspec = (opts) => {
    const title = 'notes fetch refspec';
    const remotes = listRemotes(opts);
    if (remotes.length === 0) {
        return check('notes-refspec', title, 'warn', 'no remote is configured, so records cannot be shared with anyone', 'add a remote, then rerun: commitlore doctor --fix');
    }
    let missing = remotes.filter((remote) => !fetchRefspecs(remote, opts).some(coversNotes));
    let fixed = false;
    if (opts.fix === true) {
        for (const remote of remotes) {
            const key = `remote.${remote}.fetch`;
            const configured = fetchRefspecs(remote, opts);
            if (configured.includes(EXACT_NOTES_REFSPEC)) {
                const replaced = execGit(['config', '--replace-all', key, NOTES_REFSPEC, EXACT_NOTES_REFSPEC_PATTERN], gitOptions(opts));
                fixed = replaced.code === 0 || fixed;
            }
            else if (!configured.some(coversNotes)) {
                const added = execGit(['config', '--add', key, NOTES_REFSPEC], gitOptions(opts));
                fixed = added.code === 0 || fixed;
            }
        }
        missing = remotes.filter((remote) => !fetchRefspecs(remote, opts).some(coversNotes));
    }
    if (missing.length > 0) {
        return check('notes-refspec', title, 'warn', `${missing.join(', ')} does not fetch ${NOTES_REF}, so records pushed by others stay invisible here`, missing.map((remote) => `git config --add remote.${remote}.fetch '${NOTES_REFSPEC}'`).join('\n'));
    }
    const failed = remotes
        .map((remote) => ({ remote, result: execGit(['fetch', '--dry-run', remote], gitOptions(opts)) }))
        .filter(({ result }) => result.code !== 0);
    if (failed.length > 0) {
        return check('notes-refspec', title, 'warn', `could not verify (${failed
            .map(({ remote, result }) => `${remote}: ${result.stderr.trim().split('\n')[0] ?? 'git fetch failed'}`)
            .join('; ')})`, failed.map(({ remote }) => `git fetch ${remote}`).join('\n'), fixed);
    }
    return check('notes-refspec', title, 'ok', `git fetch succeeds for ${remotes.join(', ')} and covers ${NOTES_REF}`, null, fixed);
};
/**
 * Pushing is never automatic: `git push` writes to a ref other people read,
 * which is not something a diagnostic command gets to decide.
 */
const checkPush = (opts) => {
    const title = 'notes push';
    const remotes = listRemotes(opts);
    const remote = remotes[0] ?? 'origin';
    const command = `git push ${remote} ${NOTES_REF}`;
    const local = execGit(['rev-parse', '--verify', '--quiet', NOTES_REF], gitOptions(opts));
    if (local.code !== 0) {
        return check('notes-push', title, 'ok', `no local mirror yet — nothing to push (${command}, once there is)`);
    }
    const advertised = execGit(['ls-remote', remote, NOTES_REF], gitOptions(opts));
    if (advertised.code !== 0) {
        return check('notes-push', title, 'warn', `could not verify (${remote}: ${advertised.stderr.trim().split('\n')[0] ?? 'git ls-remote failed'})`, command);
    }
    if (advertised.stdout.split(/\s/)[0] === local.stdout.trim()) {
        return check('notes-push', title, 'ok', `${remote} has the current ${NOTES_REF}`);
    }
    return check('notes-push', title, 'warn', `this clone has local records in ${NOTES_REF}; no command pushes them for you`, command);
};
/**
 * Installation belongs to `commitlore hooks install` (T-202). This reads.
 *
 * The marker is imported from the stub rather than restated, so that doctor
 * can never disagree with the installer about what "installed" means.
 */
const checkHook = (opts, runtime) => {
    const title = 'commit-msg hook';
    const id = 'commit-msg-hook';
    const install = 'commitlore hooks install';
    // --git-path, not a hardcoded .git/: worktrees and submodules keep hooks
    // somewhere else entirely.
    const located = execGit(['rev-parse', '--git-path', 'hooks/commit-msg'], gitOptions(opts));
    if (located.code !== 0) {
        return check(id, title, 'warn', 'not inside a git repository', install);
    }
    const path = resolve(opts.cwd ?? process.cwd(), located.stdout.trim());
    const target = readRecordedHookTarget(opts.cwd ?? process.cwd());
    const override = process.env['COMMITLORE_BIN'];
    const targetDetail = [
        ...describeRecordedHookTarget(target),
        ...(override === undefined || override === '' ? [] : [`COMMITLORE_BIN: ${override}`]),
    ].join('; ');
    if (!existsSync(path)) {
        return check(id, title, 'warn', `no commit-msg hook at ${path}; ${targetDetail}`, install);
    }
    const contents = readFileSync(path, 'utf8');
    if (!contents.includes(HOOK_MARKER)) {
        return check(id, title, 'warn', `a commit-msg hook exists at ${path} but does not invoke commitlore; ${targetDetail}`, install);
    }
    // `hooks status` has always reported this; doctor did not, and doctor is what
    // people run to ask whether their installation is healthy. A stale stub is
    // exactly how a fixed resolution order fails to reach anyone who installed
    // before it landed.
    if (contents !== commitMsgStub()) {
        return check(id, title, 'warn', `installed at ${path}, but the stub is out of date — it predates a change to how the hook finds the CLI; ${targetDetail}`, install);
    }
    const problems = [
        ...target.problems,
        ...(override === undefined || override === ''
            ? []
            : hasAllowedBinExtension(override)
                ? ['COMMITLORE_BIN override is active']
                : [
                    'COMMITLORE_BIN override is active, but is not a .js or .mjs file — the hook ' +
                        'ignores it and falls through to the remaining resolution steps',
                ]),
    ];
    if (runtime.status !== 'ok') {
        return check(id, title, runtime.status, `installed at ${path}; ${targetDetail}; outcome: ${runtime.detail}`, install);
    }
    return problems.length === 0
        ? check(id, title, 'ok', `installed at ${path}; ${targetDetail}`)
        : check(id, title, 'warn', `installed at ${path}; ${targetDetail}; ${problems.join('; ')}`, install);
};
/**
 * Runs the real parse path once. Trailer boundaries are git's to decide
 * (SPEC §2), so a git that cannot do this makes every other answer suspect —
 * the one condition that fails the command.
 *
 * The probe runs in the process's own directory rather than `cwd`: it tests
 * the git binary on `PATH` and this codebase's parse path, neither of which is
 * a property of the repository being inspected.
 */
const checkGit = (opts) => {
    const title = 'git interpret-trailers';
    const id = 'git-trailers';
    const version = execGit(['--version'], gitOptions(opts)).stdout.trim();
    const upgrade = 'install a git that supports interpret-trailers --parse (git >= 2.9)';
    let trailers;
    try {
        trailers = parseCommitMessage(PROBE_MESSAGE);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return check(id, title, 'fail', `${version || 'git'} could not parse a probe: ${reason}`, upgrade);
    }
    const parsed = trailers.map((trailer) => `${trailer.key}: ${trailer.value}`).join(', ');
    if (parsed !== 'Limit: probe, Blast: local') {
        return check(id, title, 'fail', `${version} parsed the probe as [${parsed}]`, upgrade);
    }
    return check(id, title, 'ok', `${version} parses trailers as the spec expects`);
};
/**
 * Whether the CLI this installation actually uses runs.
 *
 * **Which artifact is the installation is the whole question.** A git clone —
 * the documented distribution (ADR-0011) — ships `dist/commitlore.mjs`, a bundle
 * that needs no `node_modules`. A development checkout also has `dist/cli.js`,
 * the `tsc` output, which imports its dependencies and cannot run without them.
 *
 * The first version of this check probed `dist/cli.js` unconditionally. On a
 * fresh clone that is a file that exists and cannot run, so the check invented a
 * failure in the one installation it was written to protect, and turned CI red
 * for three commits. A health check that reports the supported path as broken is
 * worse than no health check.
 *
 * `--version` is the cheapest thing the CLI can be asked to do that still forces
 * the runtime to resolve, the bundle to load, and its imports to resolve.
 */
const checkRuntime = (opts) => {
    const title = 'cli runtime';
    const id = 'cli-runtime';
    // The bundle first: it is what a clone has and what the plugin invokes. The
    // tsc output is the fallback for a checkout that has not been bundled.
    const candidates = ['dist/commitlore.mjs', 'dist/cli.js'].map((rel) => installedPath(rel));
    const entry = candidates.find((path) => existsSync(path));
    if (entry === undefined) {
        return check(id, title, 'fail', `no built CLI at ${candidates.join(' or ')} — this checkout has not been built`, 'npm install && npm run build');
    }
    const run = spawnSync(process.execPath, [entry, '--version'], {
        shell: false,
        encoding: 'utf8',
        ...gitOptions(opts),
    });
    if (run.error !== undefined) {
        return check(id, title, 'fail', `could not run ${entry}: ${run.error.message}`, null);
    }
    if (run.status !== 0) {
        const detail = `${run.stderr ?? ''}`.trim().split('\n')[0] ?? `exit ${String(run.status)}`;
        return check(id, title, 'fail', `${entry} exits ${String(run.status)}: ${detail}`, 'npm install');
    }
    return check(id, title, 'ok', `${entry} runs (${run.stdout.trim()})`);
};
/**
 * Whether the installed hook actually runs, in the environment git gives it.
 *
 * Not a config read but an execution, against a probe message and a PATH that
 * carries no node. That is the environment the hook really gets — git does not
 * hand a hook the interactive shell's PATH — and it is the only way to catch the
 * failure this project has now shipped three times: a resolution branch ending
 * in a bare `node`.
 *
 * A config-only version of this check was written first and reported `ok` for a
 * hook that failed the moment it ran, because it inspected `commitlore.node`
 * while the hook was resolving through `node_modules/.bin` — a branch that had
 * no interpreter of its own. Checking the inputs to a decision is not checking
 * the decision.
 *
 * The probe message is valid, so a healthy hook exits 0. A hook that cannot find
 * a runtime exits non-zero having parsed nothing, which is indistinguishable
 * from "your message was fine" to everyone except this check.
 */
const checkHookRuntime = (opts) => {
    const title = 'hook runtime';
    const id = 'hook-runtime';
    const fix = 'commitlore hooks install';
    const cwd = opts.cwd ?? process.cwd();
    const located = execGit(['rev-parse', '--git-path', 'hooks/commit-msg'], gitOptions(opts));
    if (located.code !== 0)
        return check(id, title, 'warn', 'not inside a git repository', fix);
    const hook = resolve(cwd, located.stdout.trim());
    // The hook's absence is `checkHook`'s finding; saying it twice teaches the
    // reader to skim both.
    if (!existsSync(hook))
        return check(id, title, 'ok', 'no hook installed — nothing to run');
    const probe = join(tmpdirPath(), `commitlore-doctor-${String(process.pid)}.txt`);
    try {
        writeFileSync(probe, PROBE_MESSAGE);
        const run = spawnSync('/bin/sh', [hook, probe], {
            shell: false,
            encoding: 'utf8',
            cwd,
            // No node, and no PATH entry that could supply one. `git` must stay
            // reachable: the hook reads its own config through it.
            env: { PATH: '/usr/bin:/bin', HOME: process.env['HOME'] ?? '' },
        });
        if (run.error !== undefined) {
            return check(id, title, 'fail', `could not run the hook: ${run.error.message}`, fix);
        }
        if (run.status !== 0) {
            const said = `${run.stderr ?? ''}`.trim().split('\n')[0] ?? '';
            return check(id, title, 'fail', `the hook fails when git's PATH carries no node: ${said || `exit ${String(run.status)}`}`, fix);
        }
        return check(id, title, 'ok', 'the hook runs and validates without node on PATH');
    }
    catch (error) {
        return check(id, title, 'warn', `could not probe the hook: ${error instanceof Error ? error.message : String(error)}`, fix);
    }
    finally {
        rmSync(probe, { force: true });
    }
};
const checkInjectRuntime = (opts) => {
    const title = 'PreToolUse hook runtime';
    const id = 'inject-runtime';
    const fix = 'commitlore inject install-claude-hook';
    const cwd = opts.cwd ?? process.cwd();
    const settings = readClaudeHookStatus(claudeSettingsPath(cwd));
    if (settings.state !== 'installed') {
        const detail = settings.state === 'absent'
            ? `not installed in ${settings.settingsPath}`
            : `${settings.state} in ${settings.settingsPath}${settings.problem === undefined ? '' : `: ${settings.problem}`}`;
        return check(id, title, 'warn', detail, fix);
    }
    const path = runQuery({ cwd, noIndex: true }).records
        .flatMap((record) => record.paths)
        .find((candidate) => candidate !== '' && candidate !== '.');
    if (path === undefined) {
        return check(id, title, 'skipped', 'no recorded path is available for a runtime probe');
    }
    const configuredRoot = process.env['CLAUDE_PLUGIN_ROOT'];
    const pluginRoot = configuredRoot === undefined || configuredRoot === ''
        ? PACKAGE_ROOT
        : resolve(process.cwd(), configuredRoot);
    const payload = JSON.stringify({
        session_id: 'commitlore-doctor',
        cwd,
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: resolve(cwd, path) },
    });
    const run = spawnSync('/bin/bash', [installedPath('scripts/commitlore-run.sh'), 'inject', '--hook-input'], {
        shell: false,
        encoding: 'utf8',
        cwd,
        input: payload,
        env: {
            PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
            HOME: process.env['HOME'] ?? '',
            CLAUDE_PLUGIN_ROOT: pluginRoot,
        },
    });
    if (run.error !== undefined) {
        return check(id, title, 'fail', `could not run the PreToolUse hook: ${run.error.message}`, fix);
    }
    if (run.status !== 0) {
        const said = `${run.stderr ?? ''}`.trim().split('\n')[0] ?? '';
        return check(id, title, 'fail', `the PreToolUse hook exits ${String(run.status)}: ${said || 'no diagnosis'}`, fix);
    }
    if (`${run.stdout ?? ''}`.trim() === '') {
        const said = `${run.stderr ?? ''}`.trim().split('\n')[0] ?? '';
        return check(id, title, 'fail', `the PreToolUse hook returned no context for a known-good payload${said === '' ? '' : `: ${said}`}`, fix);
    }
    return check(id, title, 'ok', `the PreToolUse hook returned context for ${path}`);
};
const checkIndex = (opts) => {
    const cwd = opts.cwd ?? process.cwd();
    let handle;
    try {
        handle = openIndex({ cwd, readonly: true });
    }
    catch {
        return check('index-health', 'index health', 'warn', 'no index yet — queries fall back to scanning the history', 'commitlore index --rebuild');
    }
    try {
        const info = indexInfo(handle);
        const head = execGit(['rev-parse', 'HEAD'], gitOptions(opts));
        const behind = head.code === 0 && info.lastIndexedSha !== head.stdout.trim();
        const fts = info.fts ? 'FTS5' : 'no FTS5 (value search falls back to LIKE)';
        return behind
            ? check('index-health', 'index health', 'warn', `${info.trailers} trailers over ${info.commits} commits, behind HEAD — ${fts}`, 'commitlore index')
            : check('index-health', 'index health', 'ok', `${info.trailers} trailers over ${info.commits} commits, current with HEAD — ${fts}`);
    }
    catch (error) {
        return check('index-health', 'index health', 'warn', `index unreadable (${error instanceof Error ? error.message : String(error)}) — queries still work without it`, 'commitlore index --rebuild');
    }
    finally {
        try {
            closeIndex(handle);
        }
        catch {
            // A close failure on a read-only handle changes nothing the caller can act on.
        }
    }
};
const checkHistoryDepth = (opts) => hasShallowHistory(opts.cwd ?? process.cwd())
    ? check('history-depth', 'history depth', 'warn', 'this clone has shallow history, so queries may be missing records that exist upstream', 'git fetch --unshallow')
    : check('history-depth', 'history depth', 'ok', 'full history is available');
export const runDoctor = (opts = {}) => {
    const hookRuntime = checkHookRuntime(opts);
    const checks = [
        checkRuntime(opts),
        checkRefspec(opts),
        checkPush(opts),
        checkHook(opts, hookRuntime),
        hookRuntime,
        checkInjectRuntime(opts),
        checkGit(opts),
        checkHistoryDepth(opts),
        checkIndex(opts),
    ];
    return {
        checks,
        exitCode: checks.some((entry) => entry.status === 'fail') ? 1 : 0,
    };
};
const STATUS_WIDTH = 8;
export const formatReport = (report) => {
    const lines = report.checks.flatMap((entry) => {
        const head = `${entry.status.padEnd(STATUS_WIDTH)}${entry.title} — ${entry.detail}`;
        const fixed = entry.fixed ? [`${' '.repeat(STATUS_WIDTH)}fixed by --fix`] : [];
        const fix = entry.fix === null
            ? []
            : entry.fix.split('\n').map((line) => `${' '.repeat(STATUS_WIDTH)}fix: ${line}`);
        return [head, ...fixed, ...fix];
    });
    return `${lines.join('\n')}\n`;
};
export const register = (program) => {
    program
        .command('doctor')
        .description('check that this repository can carry and share CommitLore records')
        .option('--fix', 'apply the reversible local config fixes (notes fetch refspec)')
        .option('--json', 'emit the report as JSON')
        .addHelpText('after', '\nExit codes: 0 every check passed or warned, 1 a check failed (SPEC §10).')
        .action((options) => {
        const report = runDoctor({ fix: options.fix === true });
        process.stdout.write(options.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
        process.exitCode = report.exitCode;
    });
};
//# sourceMappingURL=doctor.js.map