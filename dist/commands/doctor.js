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
 *
 * `checkSquashConservation` (ADR-0014, bug-issue-60 finding 1) is the same
 * shape of problem one route over: nothing runs `squash-preserve`
 * automatically, and a squash that happened without it silently drops
 * records the same way an unfetched mirror silently drops them. It is a
 * `doctor` check rather than a CI step because it runs at the moment the
 * mistake is still local and cheap to fix — see the check's own doc comment
 * for the full "Ruled-out" reasoning.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir as tmpdirPath } from 'node:os';
import { join, resolve } from 'node:path';
import { execGit, hasShallowHistory } from '../core/git.js';
import { classifyBinTarget, describeRecordedHookTarget, readRecordedHookTarget, } from '../core/hook-target.js';
import { installedPath, isSea, packageVersion } from '../core/paths.js';
import { closeIndex, indexInfo, openIndex } from '../core/index-db.js';
import { NOTES_REF, NOTES_REFSPEC, coversNotes, listRemotes, fetchRefspecs, } from '../core/notes.js';
import { runQuery } from '../core/query.js';
import { collectRange } from '../core/squash.js';
import { parseCommitMessage } from '../core/trailers.js';
import { CLAUDE_HOOK_COMMAND, CLAUDE_HOOK_MARKER, claudeSettingsPath, readClaudeHookStatus, } from '../hooks/claude-settings.js';
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
            : classifyBinTarget(override) !== null
                ? ['COMMITLORE_BIN override is active']
                : [
                    'COMMITLORE_BIN override is active, but is not a .js, .mjs, or compiled commitlore ' +
                        'binary — the hook ignores it and falls through to the remaining resolution steps',
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
 * A compiled single-executable build (#39) is neither — it has no `dist/`
 * beside it at all, by design, and the question this check exists to answer
 * ("does the CLI this installation uses actually run") already has its answer
 * the moment this process is that binary and got far enough to ask.
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
    if (isSea()) {
        return check(id, title, 'ok', `running as a compiled binary at ${process.execPath} (commitlore ${packageVersion()})`);
    }
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
    const fix = 'reinstall the commitlore executable that the configured hook runs, then rerun: commitlore doctor';
    const cwd = opts.cwd ?? process.cwd();
    const settings = readClaudeHookStatus(claudeSettingsPath(cwd));
    if (settings.state !== 'installed') {
        const command = settings.commands[0];
        if (settings.state === 'outdated' && command !== undefined) {
            return check(id, title, 'skipped', `not checked: configured command ${JSON.stringify(command)} is not recognised; running it might have side effects`);
        }
        const detail = settings.state === 'absent'
            ? `not installed in ${settings.settingsPath}`
            : `${settings.state} in ${settings.settingsPath}${settings.problem === undefined ? '' : `: ${settings.problem}`}`;
        return check(id, title, 'warn', detail, 'commitlore inject install-claude-hook');
    }
    const command = settings.commands[0];
    if (command !== CLAUDE_HOOK_COMMAND) {
        return check(id, title, 'skipped', 'not checked: the configured command is not recognised');
    }
    const path = runQuery({ cwd, noIndex: true }).records
        .flatMap((record) => record.paths)
        .find((candidate) => candidate !== '' && candidate !== '.');
    if (path === undefined) {
        return check(id, title, 'skipped', 'no recorded path is available for a runtime probe');
    }
    const payload = JSON.stringify({
        session_id: 'commitlore-doctor',
        cwd,
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: resolve(cwd, path) },
    });
    const configured = command.replace(` ${CLAUDE_HOOK_MARKER}`, '');
    const executable = configured.slice(0, configured.indexOf(' '));
    const args = configured.slice(executable.length + 1).split(' ');
    const run = spawnSync(executable, args, {
        shell: false,
        encoding: 'utf8',
        cwd,
        input: payload,
        env: {
            PATH: process.env['PATH'] ?? '/usr/bin:/bin',
            HOME: process.env['HOME'] ?? '',
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
/** Local branches this check will look at, past which a repository is skipped rather than walked exhaustively. */
const MAX_SQUASH_CANDIDATE_BRANCHES = 200;
/**
 * Local branches that look like `git merge --squash` may have collapsed them
 * into HEAD without a trace: not an ancestor of HEAD (a squash never carries
 * the branch's own commits forward), but sharing a common ancestor with it
 * (so it is a real candidate, not just unrelated history). A branch HEAD
 * already contains — the ordinary merge or fast-forward case — is not one:
 * nothing was collapsed, so there is nothing this check can lose track of.
 */
const squashCandidates = (opts, head) => {
    const listed = execGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], gitOptions(opts));
    if (listed.code !== 0)
        return [];
    const branches = listed.stdout
        .split('\n')
        .filter((line) => line !== '')
        .slice(0, MAX_SQUASH_CANDIDATE_BRANCHES);
    const candidates = [];
    for (const branch of branches) {
        const resolved = execGit(['rev-parse', '--verify', '--quiet', branch], gitOptions(opts));
        const sha = resolved.code === 0 ? resolved.stdout.trim() : '';
        if (sha === '' || sha === head)
            continue;
        // Already an ancestor of HEAD (or identical to it): reached by an
        // ordinary merge, rebase, or fast-forward, and nothing was lost.
        if (execGit(['merge-base', '--is-ancestor', sha, head], gitOptions(opts)).code === 0) {
            continue;
        }
        const merged = execGit(['merge-base', sha, head], gitOptions(opts));
        if (merged.code !== 0)
            continue; // no common ancestor — unrelated history
        const base = merged.stdout.trim();
        if (base === '' || base === sha)
            continue;
        candidates.push({ branch, sha, base });
    }
    return candidates;
};
/**
 * Detects records a squash may have collapsed out of reach, and says so
 * (SPEC §2.4, bug-issue-60 finding 1: nothing invokes `squash-preserve`, and
 * for GitHub's server-side squash button nothing local can — the collapse
 * happens on a server this checkout never runs code on). Detection is the
 * honest answer where prevention is impossible.
 *
 * `Ruled-out: a CI step comparing a PR's commits against its post-merge
 * squash commit`. That is the complementary check for the case this one
 * cannot reach — a repository whose feature branch was deleted by the
 * squash before the next local clone or fetch — but it needs the GitHub API
 * to reconstruct a PR's original commits (this tool takes no HTTP dependency
 * anywhere else) and it can only ever run *after* the squash has already
 * happened and been pushed, which is too late to fix locally. `doctor` runs
 * at the moment the mistake is still cheap to fix: right after a local
 * `git merge --squash`, when the feature branch this check looks for is, in
 * the overwhelmingly common case, still sitting right there in
 * `refs/heads`. A CI step remains worth adding separately for the server-side
 * case (documented, not built here — see the module doc comment above).
 *
 * A candidate branch (`squashCandidates`) that declared no `Record-Id` at all
 * cannot be checked this way: without an identity there is nothing to search
 * HEAD's history for by name, and guessing by content would be exactly the
 * kind of heuristic this project has repeatedly found unsafe (SPEC §2.1 B3).
 * That is a real, narrower gap than "detects every lost record" and is
 * reported as such rather than silently passed over.
 */
const checkSquashConservation = (opts) => {
    const title = 'squash conservation';
    const id = 'squash-conservation';
    const cwd = opts.cwd ?? process.cwd();
    const head = execGit(['rev-parse', '--verify', '--quiet', 'HEAD'], gitOptions(opts));
    if (head.code !== 0) {
        return check(id, title, 'skipped', 'no HEAD yet — nothing to compare against');
    }
    const candidates = squashCandidates(opts, head.stdout.trim());
    if (candidates.length === 0) {
        return check(id, title, 'skipped', 'no local branch looks like the source of a squash — nothing to check');
    }
    let known = null;
    const lost = [];
    let uncheckable = 0;
    let checked = 0;
    for (const candidate of candidates) {
        let records;
        try {
            records = collectRange(`${candidate.base}..${candidate.sha}`, { cwd });
        }
        catch {
            continue;
        }
        if (records.length === 0)
            continue;
        checked += 1;
        const ids = new Set(records
            .map((record) => record.recordId)
            .filter((recordId) => recordId !== undefined));
        if (ids.size === 0) {
            uncheckable += 1;
            continue;
        }
        // Computed once, lazily: every candidate needs the same answer for "what
        // does HEAD's history already know", and building it is the expensive
        // part of this check.
        if (known === null) {
            known = new Set(runQuery({ cwd, allHistory: true })
                .records.map((record) => record.recordId)
                .filter((recordId) => recordId !== undefined));
        }
        for (const recordId of ids) {
            if (!known.has(recordId))
                lost.push({ branch: candidate.branch, recordId });
        }
    }
    if (checked === 0) {
        return check(id, title, 'skipped', `${candidates.length} branch(es) looked like a squash source, but recorded nothing checkable`);
    }
    if (lost.length > 0) {
        const named = lost
            .slice(0, 5)
            .map((entry) => `${entry.recordId} (${entry.branch})`)
            .join(', ');
        const more = lost.length > 5 ? `, and ${lost.length - 5} more` : '';
        return check(id, title, 'warn', `${lost.length} record(s) declared on a branch not reachable from HEAD do not appear in HEAD's history: ${named}${more}`, 'commitlore squash-preserve <base>..<branch> --target <the commit that squashed it>, ' +
            'then commit or attach the result');
    }
    const detail = uncheckable > 0
        ? `${checked} squash-shaped branch(es) checked, every declared Record-Id is reachable from HEAD ` +
            `(${uncheckable} branch(es) recorded nothing with an id and could not be checked this way)`
        : `${checked} squash-shaped branch(es) checked, every declared Record-Id is reachable from HEAD`;
    return check(id, title, 'ok', detail);
};
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
        checkSquashConservation(opts),
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