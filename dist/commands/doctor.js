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
import { installedPath, packageVersion } from '../core/paths.js';
import { closeIndex, indexInfo, openIndex } from '../core/index-db.js';
import { NOTES_REF, NOTES_REFSPEC, coversNotes, forcesNotes, listRemotes, fetchRefspecs, } from '../core/notes.js';
import { runQuery } from '../core/query.js';
import { collectRange } from '../core/squash.js';
import { parseCommitMessage } from '../core/trailers.js';
import { CLAUDE_HOOK_COMMAND, CLAUDE_HOOK_MARKER, claudeSettingsPath, readClaudeHookStatus, } from '../hooks/claude-settings.js';
import { HOOK_MARKER, commitMsgStub } from '../hooks/commit-msg.js';
import { unfinishedRuns } from '../mcp/lifecycle.js';
import { runPendingList } from './pending.js';
/** Probe message for the git capability check — one trailer of each shape. */
const PROBE_MESSAGE = 'commitlore doctor probe\n\nLimit: probe\nBlast: local\n';
const EXACT_NOTES_REFSPEC = `+${NOTES_REF}:${NOTES_REF}`;
const EXACT_NOTES_REFSPEC_PATTERN = `^\\${EXACT_NOTES_REFSPEC}$`;
/**
 * `git config --replace-all` takes a **regular expression** for the value it
 * replaces, so a refspec passed through raw is not a literal: `refs/notes/*`
 * reads as "`refs/notes` then zero or more `/`", which does not match the
 * asterisk actually in the value. A pattern that matches nothing does not fail
 * — `--replace-all` appends instead, leaving the entry it was meant to remove
 * in place beside a new one.
 */
const escapeConfigValuePattern = (value) => value.replace(/[\\.*+?[\]^$(){}|]/g, (character) => `\\${character}`);
const gitOptions = (opts) => (opts.cwd === undefined ? {} : { cwd: opts.cwd });
/** The bound keeps a broken child process from making a JSON report unbounded. */
const boundedExcerpt = (output) => {
    const [firstLine = ''] = (output ?? '').split(/\r?\n/, 1);
    return {
        firstLine: firstLine.slice(0, 200),
        truncated: firstLine.length > 200 ? 'true' : 'false',
    };
};
const streamEvidence = (stream, output) => {
    const excerpt = boundedExcerpt(output);
    return {
        [`${stream}_first_line`]: excerpt.firstLine,
        [`${stream}_truncated`]: excerpt.truncated,
    };
};
/** Reports keep paths useful in bug reports without carrying a user's home directory. */
const homeRelativePath = (value) => {
    const home = process.env['HOME'];
    if (home === undefined || home === '')
        return value;
    const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return value.replace(new RegExp(`${escapedHome}(?=$|/)`, 'g'), '~');
};
const normaliseEvidence = (evidence) => Object.fromEntries(Object.entries(evidence).map(([key, value]) => [key, homeRelativePath(value)]));
const evidenceKey = (value) => value
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'remote';
/**
 * `severity` as a total function of `status` — the only place it is decided.
 *
 * `skipped` maps to `info`, not `warning`: a check that could not run has
 * reported nothing, and giving it a warning's weight is how a report starts
 * ranking its own blind spots above its findings.
 */
const severityOf = (status) => status === 'fail' ? 'error' : status === 'warn' ? 'warning' : 'info';
function check(id, category, title, status, detail, fix = null, fixed = false, needsAttention = status === 'warn' || status === 'fail', extra = {}) {
    const evidence = extra.evidence ?? {};
    if (Object.keys(evidence).length === 0) {
        throw new Error(`doctor check ${id} has no evidence`);
    }
    return {
        id,
        title,
        status,
        needsAttention,
        detail,
        fix,
        fixed,
        category,
        severity: severityOf(status),
        evidence: normaliseEvidence(evidence),
        optional: extra.optional ?? false,
        ...(extra.skipReason === undefined ? {} : { skipReason: extra.skipReason }),
    };
}
const blocked = (dependency, row) => {
    if (dependency.status === 'ok') {
        throw new Error(`doctor check ${row.id} cannot repeat an ok finding`);
    }
    return { ...row, blockedBy: dependency.id };
};
const checkRefspec = (opts) => {
    const title = 'notes fetch refspec';
    const remotes = listRemotes(opts);
    const remoteEvidence = { remotes: remotes.join(', ') || 'none' };
    if (remotes.length === 0) {
        return check('notes-refspec', 'transport', title, 'warn', 'no remote is configured, so records cannot be shared with anyone', 'add a remote, then rerun: commitlore doctor --fix', false, false, { evidence: remoteEvidence });
    }
    let missing = remotes.filter((remote) => !fetchRefspecs(remote, opts).some(coversNotes));
    let forced = remotes.filter((remote) => fetchRefspecs(remote, opts).some(forcesNotes));
    let fixed = false;
    if (opts.fix === true) {
        for (const remote of remotes) {
            const key = `remote.${remote}.fetch`;
            const configured = fetchRefspecs(remote, opts);
            if (configured.includes(EXACT_NOTES_REFSPEC)) {
                const replaced = execGit(['config', '--replace-all', key, NOTES_REFSPEC, EXACT_NOTES_REFSPEC_PATTERN], gitOptions(opts));
                fixed = replaced.code === 0 || fixed;
            }
            else if (configured.some(forcesNotes)) {
                // #417: a forced refspec overwrites the local mirror on every fetch.
                // Each forced entry is replaced individually rather than the whole key
                // rewritten, so a remote's other refspecs survive untouched.
                for (const entry of configured.filter(forcesNotes)) {
                    const replaced = execGit(['config', '--replace-all', key, NOTES_REFSPEC, `^${escapeConfigValuePattern(entry)}$`], gitOptions(opts));
                    fixed = replaced.code === 0 || fixed;
                }
            }
            else if (!configured.some(coversNotes)) {
                const added = execGit(['config', '--add', key, NOTES_REFSPEC], gitOptions(opts));
                fixed = added.code === 0 || fixed;
            }
        }
        missing = remotes.filter((remote) => !fetchRefspecs(remote, opts).some(coversNotes));
        forced = remotes.filter((remote) => fetchRefspecs(remote, opts).some(forcesNotes));
    }
    if (forced.length > 0) {
        return check('notes-refspec', 'transport', title, 'warn', `${forced.join(', ')} fetches ${NOTES_REF} with a forced refspec, so an ordinary git fetch ` +
            'overwrites this clone\'s mirror — a record written here and not yet pushed is destroyed silently', forced
            .map((remote) => `git config --replace-all remote.${remote}.fetch '${NOTES_REFSPEC}' '^\\+refs/notes/'`)
            .join('\n'), fixed, undefined, { evidence: { ...remoteEvidence, forced: forced.join(', ') } });
    }
    if (missing.length > 0) {
        return check('notes-refspec', 'transport', title, 'warn', `${missing.join(', ')} does not fetch ${NOTES_REF}, so records pushed by others stay invisible here`, missing.map((remote) => `git config --add remote.${remote}.fetch '${NOTES_REFSPEC}'`).join('\n'), false, undefined, { evidence: { ...remoteEvidence, missing: missing.join(', ') } });
    }
    const failed = remotes
        .map((remote) => ({ remote, result: execGit(['fetch', '--dry-run', remote], gitOptions(opts)) }))
        .filter(({ result }) => result.code !== 0);
    if (failed.length > 0) {
        return check('notes-refspec', 'transport', title, 'warn', `could not verify (${failed
            .map(({ remote, result }) => `${remote}: ${result.stderr.trim().split('\n')[0] ?? 'git fetch failed'}`)
            .join('; ')})`, failed.map(({ remote }) => `git fetch ${remote}`).join('\n'), fixed, undefined, {
            evidence: {
                ...remoteEvidence,
                ...Object.fromEntries(failed.map(({ remote, result }) => [
                    `fetch_exit_code_${evidenceKey(remote)}`,
                    String(result.code),
                ])),
            },
        });
    }
    // A refspec written by `--fix` has not been fetched through yet, and this
    // check is the last thing the operator reads before believing the mirror is
    // sorted. Without the second sentence `ok` plus `fixed by --fix` reads as
    // "repaired", while every query still answers from a mirror that was never
    // retrieved -- the configuration is right and the records are still missing.
    return check('notes-refspec', 'transport', title, 'ok', fixed
        ? `${NOTES_REF} is now covered for ${remotes.join(', ')} — nothing has been fetched through it yet`
        : `git fetch succeeds for ${remotes.join(', ')} and covers ${NOTES_REF}`, fixed ? `git fetch ${remotes[0] ?? 'origin'}` : null, fixed, undefined, { evidence: remoteEvidence });
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
    const localEvidence = {
        remote,
        local_sha: local.code === 0 ? local.stdout.trim() || 'unknown' : 'none',
    };
    if (local.code !== 0) {
        return check('notes-push', 'transport', title, 'ok', `no local mirror yet — nothing to push (${command}, once there is)`, null, false, undefined, { evidence: { ...localEvidence, remote_sha: 'not_queried' } });
    }
    const advertised = execGit(['ls-remote', remote, NOTES_REF], gitOptions(opts));
    if (advertised.code !== 0) {
        return check('notes-push', 'transport', title, 'warn', `could not verify (${remote}: ${advertised.stderr.trim().split('\n')[0] ?? 'git ls-remote failed'})`, command, false, undefined, {
            evidence: {
                ...localEvidence,
                ls_remote_exit_code: String(advertised.code),
                ...streamEvidence('ls_remote_stderr', advertised.stderr),
            },
        });
    }
    const remoteSha = advertised.stdout.split(/\s/)[0] ?? '';
    if (remoteSha === local.stdout.trim()) {
        return check('notes-push', 'transport', title, 'ok', `${remote} has the current ${NOTES_REF}`, null, false, undefined, { evidence: { ...localEvidence, remote_sha: remoteSha || 'none' } });
    }
    return check('notes-push', 'transport', title, 'warn', `this clone has local records in ${NOTES_REF}; no command pushes them for you`, command, false, undefined, { evidence: { ...localEvidence, remote_sha: remoteSha || 'none' } });
};
/**
 * Installation belongs to `commitlore hooks install` (T-202). This reads.
 *
 * The marker is imported from the stub rather than restated, so that doctor
 * can never disagree with the installer about what "installed" means.
 */
const checkHook = (ctx) => {
    const { opts } = ctx;
    const title = 'commit-msg hook';
    const id = 'commit-msg-hook';
    const category = 'capture';
    const install = 'commitlore hooks install';
    // --git-path, not a hardcoded .git/: worktrees and submodules keep hooks
    // somewhere else entirely.
    const located = execGit(['rev-parse', '--git-path', 'hooks/commit-msg'], gitOptions(opts));
    if (located.code !== 0) {
        return check(id, category, title, 'warn', 'not inside a git repository', install, false, undefined, { evidence: { hook_path: 'unavailable', bin: 'not_recorded', node: 'not_recorded' } });
    }
    const path = resolve(opts.cwd ?? process.cwd(), located.stdout.trim());
    const target = readRecordedHookTarget(opts.cwd ?? process.cwd());
    const override = process.env['COMMITLORE_BIN'];
    const hookEvidence = {
        hook_path: path,
        bin: target.bin || '(unset)',
        node: target.node || '(unset)',
        ...(override === undefined || override === '' ? {} : { commitlore_bin_override: override }),
    };
    const targetDetail = [
        ...describeRecordedHookTarget(target),
        ...(override === undefined || override === '' ? [] : [`COMMITLORE_BIN: ${override}`]),
    ].join('; ');
    if (!existsSync(path)) {
        return check(id, category, title, 'warn', `no commit-msg hook at ${path}; ${targetDetail}`, install, false, undefined, { evidence: hookEvidence });
    }
    const contents = readFileSync(path, 'utf8');
    if (!contents.includes(HOOK_MARKER)) {
        return check(id, category, title, 'warn', `a commit-msg hook exists at ${path} but does not invoke commitlore; ${targetDetail}`, install, false, undefined, { evidence: hookEvidence });
    }
    // `hooks status` has always reported this; doctor did not, and doctor is what
    // people run to ask whether their installation is healthy. A stale stub is
    // exactly how a fixed resolution order fails to reach anyone who installed
    // before it landed.
    if (contents !== commitMsgStub()) {
        return check(id, category, title, 'warn', `installed at ${path}, but the stub is out of date — it predates a change to how the hook finds the CLI; ${targetDetail}`, install, false, undefined, { evidence: hookEvidence });
    }
    const problems = [
        ...target.problems,
        ...(override === undefined || override === ''
            ? []
            : classifyBinTarget(override) !== null
                ? ['COMMITLORE_BIN override is active']
                : [
                    'COMMITLORE_BIN override is active, but is not a .js or .mjs file — the hook ' +
                        'ignores it and falls through to the remaining resolution steps',
                ]),
    ];
    const runtime = hookRuntimeOf(ctx);
    if (runtime.status !== 'ok') {
        const inherited = `installed at ${path}; ${targetDetail}; outcome: ${runtime.detail}`;
        // A skipped runtime would make this row a skip too, and a skip has to name
        // a reason. Inheriting the runtime's is the only answer that stays true —
        // this row did not look for the same reason that one did not. The branch is
        // unreachable today because `hook-runtime` has no skip site, and it is
        // written out rather than cast away so that adding one cannot silently
        // produce a reasonless skip here.
        if (runtime.status === 'skipped') {
            return blocked(runtime, check(id, category, title, 'skipped', inherited, install, false, false, {
                evidence: { ...hookEvidence, runtime_status: runtime.status },
                skipReason: runtime.skipReason ?? 'nothing_applicable',
            }));
        }
        return blocked(runtime, check(id, category, title, runtime.status, inherited, install, false, undefined, { evidence: { ...hookEvidence, runtime_status: runtime.status } }));
    }
    return problems.length === 0
        ? check(id, category, title, 'ok', `installed at ${path}; ${targetDetail}`, null, false, undefined, { evidence: hookEvidence })
        : check(id, category, title, 'warn', `installed at ${path}; ${targetDetail}; ${problems.join('; ')}`, install, false, undefined, { evidence: hookEvidence });
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
    const category = 'runtime';
    const version = execGit(['--version'], gitOptions(opts)).stdout.trim();
    const upgrade = 'install a git that supports interpret-trailers --parse (git >= 2.9)';
    let trailers;
    try {
        trailers = parseCommitMessage(PROBE_MESSAGE);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return check(id, category, title, 'fail', `${version || 'git'} could not parse a probe: ${reason}`, upgrade, false, undefined, { evidence: { git_version: version || 'unavailable', parsed: 'unavailable' } });
    }
    const parsed = trailers.map((trailer) => `${trailer.key}: ${trailer.value}`).join(', ');
    if (parsed !== 'Limit: probe, Blast: local') {
        return check(id, category, title, 'fail', `${version} parsed the probe as [${parsed}]`, upgrade, false, undefined, { evidence: { git_version: version || 'unavailable', parsed } });
    }
    return check(id, category, title, 'ok', `${version} parses trailers as the spec expects`, null, false, undefined, { evidence: { git_version: version || 'unavailable', parsed } });
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
    const category = 'runtime';
    // The bundle first: it is what a clone has and what the plugin invokes. The
    // tsc output is the fallback for a checkout that has not been bundled.
    const candidates = ['dist/commitlore.mjs', 'dist/cli.js'].map((rel) => installedPath(rel));
    const entry = candidates.find((path) => existsSync(path));
    if (entry === undefined) {
        return check(id, category, title, 'fail', `no built CLI at ${candidates.join(' or ')} — this checkout has not been built`, 'npm install && npm run build', false, undefined, {
            evidence: {
                entry: candidates.join(' or '),
                exit_code: 'not_run',
                ...streamEvidence('stderr', ''),
            },
        });
    }
    const run = spawnSync(process.execPath, [entry, '--version'], {
        shell: false,
        encoding: 'utf8',
        ...gitOptions(opts),
    });
    if (run.error !== undefined) {
        return check(id, category, title, 'fail', `could not run ${entry}: ${run.error.message}`, null, false, undefined, {
            evidence: {
                entry,
                exit_code: String(run.status ?? 'unavailable'),
                error: run.error.message,
                ...streamEvidence('stderr', run.stderr),
            },
        });
    }
    if (run.status !== 0) {
        const detail = `${run.stderr ?? ''}`.trim().split('\n')[0] ?? `exit ${String(run.status)}`;
        return check(id, category, title, 'fail', `${entry} exits ${String(run.status)}: ${detail}`, 'npm install', false, undefined, {
            evidence: {
                entry,
                exit_code: String(run.status),
                ...streamEvidence('stderr', run.stderr),
            },
        });
    }
    return check(id, category, title, 'ok', `${entry} runs (${run.stdout.trim()})`, null, false, undefined, {
        evidence: {
            entry,
            version: boundedExcerpt(run.stdout).firstLine,
            ...streamEvidence('stdout', run.stdout),
        },
    });
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
    const category = 'capture';
    const fix = 'commitlore hooks install';
    const cwd = opts.cwd ?? process.cwd();
    const located = execGit(['rev-parse', '--git-path', 'hooks/commit-msg'], gitOptions(opts));
    if (located.code !== 0) {
        return check(id, category, title, 'warn', 'not inside a git repository', fix, false, undefined, {
            evidence: {
                hook_path: 'unavailable',
                exit_code: String(located.code),
                ...streamEvidence('stderr', located.stderr),
            },
        });
    }
    const hook = resolve(cwd, located.stdout.trim());
    // The hook's absence is `checkHook`'s finding; saying it twice teaches the
    // reader to skim both.
    if (!existsSync(hook)) {
        return check(id, category, title, 'ok', 'no hook installed — nothing to run', null, false, undefined, { evidence: { hook_path: hook } });
    }
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
            return check(id, category, title, 'fail', `could not run the hook: ${run.error.message}`, fix, false, undefined, {
                evidence: {
                    hook_path: hook,
                    exit_code: String(run.status ?? 'unavailable'),
                    error: run.error.message,
                    ...streamEvidence('stderr', run.stderr),
                },
            });
        }
        if (run.status !== 0) {
            const said = `${run.stderr ?? ''}`.trim().split('\n')[0] ?? '';
            const nodeMissing = run.status === 127 ||
                /\bnode\b.*not found|ENOENT|command not found.*\bnode\b/i.test(said);
            const nodeThrew = /^\s*at\s|\.js:\d+/.test(said);
            let detail;
            if (nodeMissing) {
                detail = `the hook cannot find a node interpreter on git's PATH: ${said || `exit ${String(run.status)}`}`;
            }
            else if (nodeThrew) {
                detail = `the hook's node process ran but threw (exit ${String(run.status)}): ${said}`;
            }
            else {
                detail = `the hook exited ${String(run.status)} under the restricted PATH — cause unclear: ${said || 'no output'}`;
            }
            return check(id, category, title, 'fail', detail, fix, false, undefined, {
                evidence: {
                    hook_path: hook,
                    exit_code: String(run.status),
                    ...streamEvidence('stderr', run.stderr),
                },
            });
        }
        return check(id, category, title, 'ok', 'the hook runs and validates without node on PATH', null, false, undefined, { evidence: { hook_path: hook, exit_code: '0' } });
    }
    catch (error) {
        return check(id, category, title, 'warn', `could not probe the hook: ${error instanceof Error ? error.message : String(error)}`, fix, false, undefined, {
            evidence: {
                hook_path: hook,
                exit_code: 'unavailable',
                error: error instanceof Error ? error.message : String(error),
                ...streamEvidence('stderr', ''),
            },
        });
    }
    finally {
        rmSync(probe, { force: true });
    }
};
/**
 * Turns a completed (or attempted) probe run into this check's verdict.
 *
 * Split out from `checkInjectRuntime` so the *decision* — not the race that
 * can accompany it — is what a test exercises directly with a synthetic
 * `spawnSync` result.
 *
 * `spawnSync`'s `input` option writes the probe payload to the child's stdin
 * after the child is already running. A child that never reads stdin (every
 * fixture here, and plenty of real hooks) routinely exits and closes that
 * pipe before Node finishes the write, which fails with EPIPE — on a shared,
 * contended runner far more often than on a quiet laptop, which is why this
 * was invisible locally and ~15-25% flaky in CI (reproduced against the
 * actual CI Node 22 and 24 images). Node still reports the real
 * `status`/`stdout`/`stderr` of a process that ran to completion on the same
 * result object that carries that `error` — the write failing is not the
 * same thing as the hook failing to run. Treating `run.error !== undefined`
 * as "could not run" discarded that real status and reported a working hook
 * as broken (and, for the two doctor.test.ts fixtures that *are* meant to
 * fail, reported the wrong reason).
 *
 * `run.status` is `null` only when no process was ever created (an ENOENT
 * from an unresolvable executable, a permissions failure, ...), which is the
 * one condition this function still treats as "could not run".
 *
 * Exported so a test can hand it a synthetic `SpawnSyncReturns` (a real
 * status alongside a real EPIPE error) and assert on the decision
 * deterministically, without depending on the race actually firing.
 */
export const evaluateInjectRun = (run, ctx) => {
    const { id, category, title, executable, path, fix, unavailableFix } = ctx;
    const executionEvidence = { executable, path };
    if (run.status === null || run.status === undefined) {
        if (run.error !== undefined && 'code' in run.error && run.error.code === 'ENOENT') {
            return check(id, category, title, 'fail', `configured PreToolUse hook executable ${JSON.stringify(executable)} is not resolvable from PATH`, unavailableFix, false, undefined, {
                evidence: {
                    ...executionEvidence,
                    exit_code: 'unavailable',
                    ...streamEvidence('stderr', run.stderr),
                },
            });
        }
        return check(id, category, title, 'fail', `could not run the PreToolUse hook: ${run.error?.message ?? 'no diagnosis'}`, fix, false, undefined, {
            evidence: {
                ...executionEvidence,
                exit_code: 'unavailable',
                error: run.error?.message ?? 'no diagnosis',
                ...streamEvidence('stderr', run.stderr),
            },
        });
    }
    if (run.status !== 0) {
        const said = `${run.stderr ?? ''}`.trim().split('\n')[0] ?? '';
        return check(id, category, title, 'fail', `the PreToolUse hook exits ${String(run.status)}: ${said || 'no diagnosis'}`, fix, false, undefined, {
            evidence: {
                ...executionEvidence,
                exit_code: String(run.status),
                ...streamEvidence('stderr', run.stderr),
            },
        });
    }
    if (`${run.stdout ?? ''}`.trim() === '') {
        const said = `${run.stderr ?? ''}`.trim().split('\n')[0] ?? '';
        return check(id, category, title, 'fail', `the PreToolUse hook returned no context for a known-good payload${said === '' ? '' : `: ${said}`}`, fix, false, undefined, {
            evidence: {
                ...executionEvidence,
                exit_code: '0',
                ...streamEvidence('stdout', run.stdout),
                ...streamEvidence('stderr', run.stderr),
            },
        });
    }
    return check(id, category, title, 'ok', `the PreToolUse hook returned context for ${path}`, null, false, undefined, {
        evidence: {
            ...executionEvidence,
            exit_code: '0',
            ...streamEvidence('stdout', run.stdout),
        },
    });
};
const checkInjectRuntime = (opts) => {
    const title = 'PreToolUse hook runtime';
    const id = 'inject-runtime';
    const category = 'delivery';
    const fix = 'reinstall the commitlore executable that the configured hook runs, then rerun: commitlore doctor';
    const unavailableFix = 'install the configured hook executable where the hook can resolve it (or add its install directory to PATH), then rerun: commitlore doctor';
    const cwd = opts.cwd ?? process.cwd();
    const settings = readClaudeHookStatus(claudeSettingsPath(cwd));
    if (settings.state !== 'installed') {
        const command = settings.commands[0];
        if (settings.state === 'outdated' && command !== undefined) {
            return check(id, category, title, 'skipped', `not checked: configured command ${JSON.stringify(command)} is not recognised; running it might have side effects`, null, false, false, {
                evidence: {
                    settings_path: settings.settingsPath,
                    settings_state: settings.state,
                    configured_command: command,
                    executable: 'not_run',
                    exit_code: 'not_run',
                    ...streamEvidence('stderr', ''),
                },
                skipReason: 'command_unrecognized',
            });
        }
        const detail = settings.state === 'absent'
            ? `not installed in ${settings.settingsPath}`
            : `${settings.state} in ${settings.settingsPath}${settings.problem === undefined ? '' : `: ${settings.problem}`}`;
        return check(id, category, title, 'warn', detail, 'commitlore inject install-claude-hook', false, undefined, {
            evidence: {
                settings_path: settings.settingsPath,
                settings_state: settings.state,
                executable: 'not_run',
                exit_code: 'not_run',
                ...streamEvidence('stderr', ''),
                ...(settings.problem === undefined ? {} : { problem: settings.problem }),
            },
        });
    }
    const command = settings.commands[0];
    if (command !== CLAUDE_HOOK_COMMAND) {
        return check(id, category, title, 'skipped', 'not checked: the configured command is not recognised', null, false, false, {
            evidence: {
                settings_path: settings.settingsPath,
                settings_state: settings.state,
                configured_command: command ?? 'none',
                executable: 'not_run',
                exit_code: 'not_run',
                ...streamEvidence('stderr', ''),
            },
            skipReason: 'command_unrecognized',
        });
    }
    const path = runQuery({ cwd, noIndex: true }).records
        .flatMap((record) => record.paths)
        .find((candidate) => candidate !== '' && candidate !== '.');
    if (path === undefined) {
        return check(id, category, title, 'skipped', 'no recorded path is available for a runtime probe', null, false, false, {
            evidence: {
                settings_path: settings.settingsPath,
                settings_state: settings.state,
                executable: 'not_run',
                probe_path: 'unavailable',
                exit_code: 'not_run',
                ...streamEvidence('stderr', ''),
            },
            skipReason: 'probe_path_unavailable',
        });
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
    const result = evaluateInjectRun(run, { id, category, title, executable, path, fix, unavailableFix });
    // An unresolvable executable is an incomplete environment — the hook will
    // not fire until the user installs it — but it does not make records
    // incorrect or prevent the tool from working. Analogous to "no remote" in
    // checkRefspec: a setup that has not reached that integration yet, not a
    // misconfiguration. `evaluateInjectRun` reports `fail` (which standalone
    // `doctor` surfaces for actionability), but `needsAttention` is cleared so
    // `init`'s final doctor step does not treat a missing system binary as a
    // blocking finding that the user must fix before the repository is usable
    // (#192, #221).
    if (result.status === 'fail' && run.status === null && run.error !== undefined &&
        'code' in run.error && run.error.code === 'ENOENT') {
        return { ...result, needsAttention: false };
    }
    return result;
};
/**
 * Whether the build the agent's hook runs is the build you are running (#433).
 *
 * These are separate installations and nothing keeps them in step. A plugin
 * cache found in the field held **0.4.0** while the CLI beside it was 0.6.0 —
 * four releases apart, with no signal to the user that anything was behind.
 * Everything fixed in between, including two security fixes, was invisible to
 * every agent edit in that repository, because the agent runs the hook and not
 * the CLI.
 *
 * Local and offline, like every other check here: the configured executable is
 * asked for its own version. `checkInjectRuntime` already spawns exactly this
 * command, so the cost is one more process and no new failure mode.
 *
 * A `warn`, not a `fail`. An older hook still delivers records; it delivers
 * them under older rules, which is worth saying and is not worth refusing to
 * run over.
 */
const SEMVER_ISH = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/;
const checkInjectVersion = (opts, dependencies) => {
    const title = 'PreToolUse hook version';
    const id = 'inject-version';
    const category = 'delivery';
    const cwd = opts.cwd ?? process.cwd();
    const mine = packageVersion();
    const settings = readClaudeHookStatus(claudeSettingsPath(cwd));
    if (settings.state !== 'installed') {
        return check(id, category, title, 'skipped', `no installed hook to compare against ${mine}`, null, false, false, {
            evidence: { executable: 'not_run', theirs: 'not_run', mine },
            skipReason: 'hook_not_installed',
        });
    }
    const command = settings.commands[0];
    if (command !== CLAUDE_HOOK_COMMAND) {
        return check(id, category, title, 'skipped', 'not checked: the configured command is not recognised', null, false, false, {
            evidence: {
                executable: 'not_run',
                theirs: 'not_run',
                mine,
                configured_command: command ?? 'none',
            },
            skipReason: 'command_unrecognized',
        });
    }
    const configured = command.replace(` ${CLAUDE_HOOK_MARKER}`, '');
    const executable = configured.slice(0, configured.indexOf(' '));
    const run = spawnSync(executable, ['--version'], {
        shell: false,
        encoding: 'utf8',
        cwd,
        env: {
            PATH: process.env['PATH'] ?? '/usr/bin:/bin',
            HOME: process.env['HOME'] ?? '',
        },
    });
    const reported = typeof run.stdout === 'string' ? run.stdout : '';
    const versionEvidence = {
        executable,
        theirs: boundedExcerpt(reported).firstLine || 'unavailable',
        mine,
        exit_code: String(run.status ?? 'unavailable'),
        ...streamEvidence('stdout', reported),
    };
    if (run.status !== 0 || typeof run.stdout !== 'string') {
        // `checkInjectRuntime` owns "the hook does not run at all" and reports it
        // with the remedy. Saying it twice would be noise.
        const skipped = check(id, category, title, 'skipped', `${executable} did not report a version`, null, false, false, { evidence: versionEvidence, skipReason: 'version_unreadable' });
        const runtime = dependencies.get('inject-runtime');
        return runtime === undefined || runtime.status === 'ok' ? skipped : blocked(runtime, skipped);
    }
    const theirs = run.stdout.trim();
    // Exit 0 is not the same as an answer. A wrapper that ignores its arguments
    // and prints a hook payload for any argv exits 0 too, and reading that as a
    // version reports a mismatch against something that was never a version.
    // Two builds cannot be compared unless both sides actually said one.
    if (!SEMVER_ISH.test(theirs)) {
        return check(id, category, title, 'skipped', `${executable} answered --version with something that is not a version`, null, false, false, { evidence: versionEvidence, skipReason: 'version_unreadable' });
    }
    if (theirs === mine) {
        return check(id, category, title, 'ok', `the hook runs ${theirs}, the same build as this CLI`, null, false, undefined, { evidence: versionEvidence });
    }
    return check(id, category, title, 'warn', `the agent's hook runs ${theirs} but this CLI is ${mine} — every edit is graded by ${theirs}'s rules, not this one's`, 'update the installation the hook resolves to (for the plugin: /plugin marketplace update commitlore), then rerun: commitlore doctor', false, undefined, { evidence: versionEvidence });
};
/**
 * MCP servers that started here and never recorded an exit (#424).
 *
 * A session lost all seven commitlore tools mid-conversation while
 * `claude mcp list` still reported the server connected and no process was
 * running. Nothing on disk could say whether it had ever come up, because the
 * client was not started with `--debug` and the server's stderr went to a pipe.
 *
 * `mcp/lifecycle.ts` now leaves a start and an exit line. A start with neither
 * an exit beside it nor a live process is a server that was killed rather than
 * one that closed its session — which is the observation nobody could make.
 *
 * A `warn`, and only about the past: it says what happened, not that anything
 * is wrong now. Nothing here can restore a lost registration.
 */
const checkMcpLifecycle = (opts) => {
    const title = 'MCP server sessions';
    const id = 'mcp-lifecycle';
    const category = 'delivery';
    const cwd = opts.cwd ?? process.cwd();
    const unfinished = unfinishedRuns(cwd);
    if (unfinished.length === 0) {
        return check(id, category, title, 'ok', 'every recorded MCP session ended cleanly, or is still running', null, false, undefined, { evidence: { unfinished_count: '0', last_pid: 'none', last_at: 'none' } });
    }
    const last = unfinished[unfinished.length - 1];
    return check(id, category, title, 'warn', `${unfinished.length} MCP server session(s) started here and never recorded an exit — ` +
        `most recently pid ${String(last?.pid ?? 0)} at ${last?.at ?? 'unknown'}. ` +
        'A killed server loses its tool registration in the client, which reports the same as a tool that never existed (#424)', 'restart the client session; if this repeats, capture it with a client started under --debug', false, undefined, {
        evidence: {
            unfinished_count: String(unfinished.length),
            last_pid: String(last?.pid ?? 0),
            last_at: last?.at ?? 'unknown',
        },
    });
};
/**
 * #458: captures that were prepared and then never reached a commit.
 *
 * Found in the field, not in a fixture. A repository with 815 commits, hooks
 * installed and an index current with HEAD held **zero** CommitLore records —
 * and `doctor` reported all ten of its checks `ok`. Four captures sat in
 * `.git/commitlore/pending/`, one of them staged with a passing validation and
 * a record ready to attach, all four eight days old.
 *
 * The chain: `capture-stage` stamps `expires_at = staged_at + 5 minutes`; the
 * commit did not happen inside that window; `prepare-commit-msg` skipped the
 * record because it had expired; `pending-gc` protects the staged phase and so
 * never collected the file. Every step behaved as designed, and the net effect
 * was that the product silently stopped producing records.
 *
 * `pending ls` already prints `stale` and `never-collected` on exactly these
 * rows. The information existed; the command people actually run did not carry
 * it. That is #402 and #400's category — the first screen reporting ready while
 * the thing it reports on has stopped working — and it is why this check exists
 * rather than a longer TTL. The expiry is doing its job: a staged record binds
 * to the tree it was prepared for, and attaching it to a different one is worse
 * than dropping it. The defect is the silence.
 */
const checkPendingBacklog = (opts) => {
    const title = 'pending captures';
    const id = 'pending-backlog';
    const category = 'capture';
    const cwd = opts.cwd ?? process.cwd();
    let listing;
    try {
        listing = runPendingList({ cwd });
    }
    catch {
        return check(id, category, title, 'ok', 'no pending directory — nothing has been captured here yet', null, false, undefined, { evidence: { stranded: '0', staged_expired: '0', oldest: 'none' } });
    }
    if (listing.unreadable.length > 0) {
        return check(id, category, title, 'warn', `${listing.unreadable.length} pending file(s) cannot be read as a transaction`, 'commitlore pending ls', false, undefined, {
            evidence: {
                stranded: '0',
                staged_expired: '0',
                oldest: 'none',
                unreadable: String(listing.unreadable.length),
            },
        });
    }
    // A stale transaction can no longer apply: its base_head is not HEAD, so the
    // commit it was prepared for either never happened or happened without it.
    const stranded = listing.transactions.filter((transaction) => transaction.stale);
    if (stranded.length === 0) {
        const held = listing.transactions.length;
        return check(id, category, title, 'ok', held === 0 ? 'no captures are waiting' : `${String(held)} capture(s) waiting, all still able to apply`, null, false, undefined, {
            evidence: {
                stranded: '0',
                staged_expired: '0',
                oldest: 'none',
                waiting: String(held),
            },
        });
    }
    const lost = stranded.filter((transaction) => transaction.phase === 'staged');
    const oldest = stranded
        .map((transaction) => transaction.created_at)
        .sort()[0];
    // A staged transaction that went stale is a record that was drafted,
    // verified, staged, and then dropped. That is a failed capture, not a
    // pending one, and it is the case worth interrupting someone for.
    const detail = lost.length > 0
        ? `${String(lost.length)} staged capture(s) expired before reaching a commit and were dropped` +
            (stranded.length > lost.length
                ? `, alongside ${String(stranded.length - lost.length)} earlier draft(s) that never staged`
                : '')
        : `${String(stranded.length)} capture(s) can no longer apply — their base commit is no longer HEAD`;
    return check(id, category, title, 'warn', `${detail}; oldest from ${oldest ?? 'an unknown time'}. ` +
        'A staged record binds to the tree it was prepared for and is skipped once that tree moves, ' +
        'so these decisions were never written to the history (#458)', 'commitlore pending ls', false, undefined, {
        evidence: {
            stranded: String(stranded.length),
            staged_expired: String(lost.length),
            oldest: oldest ?? 'unknown',
        },
    });
};
const checkIndex = (opts) => {
    const cwd = opts.cwd ?? process.cwd();
    let handle;
    try {
        handle = openIndex({ cwd, readonly: true });
    }
    catch {
        return check('index-health', 'index', 'index health', 'warn', 'no index yet — queries fall back to scanning the history', 'commitlore index --rebuild', false, undefined, {
            evidence: {
                trailers: '0',
                commits: '0',
                last_indexed_sha: 'none',
                head_sha: 'not_queried',
                fts: 'unavailable',
            },
        });
    }
    try {
        const info = indexInfo(handle);
        const head = execGit(['rev-parse', 'HEAD'], gitOptions(opts));
        const behind = head.code === 0 && info.lastIndexedSha !== head.stdout.trim();
        const fts = info.fts ? 'FTS5' : 'no FTS5 (value search falls back to LIKE)';
        const indexEvidence = {
            trailers: String(info.trailers),
            commits: String(info.commits),
            last_indexed_sha: info.lastIndexedSha || 'none',
            head_sha: head.code === 0 ? head.stdout.trim() || 'none' : 'unavailable',
            fts: info.fts ? 'true' : 'false',
        };
        return behind
            ? check('index-health', 'index', 'index health', 'warn', `${info.trailers} trailers over ${info.commits} commits, behind HEAD — ${fts}`, 'commitlore index', false, undefined, { evidence: indexEvidence })
            : check('index-health', 'index', 'index health', 'ok', `${info.trailers} trailers over ${info.commits} commits, current with HEAD — ${fts}`, null, false, undefined, { evidence: indexEvidence });
    }
    catch (error) {
        return check('index-health', 'index', 'index health', 'warn', `index unreadable (${error instanceof Error ? error.message : String(error)}) — queries still work without it`, 'commitlore index --rebuild', false, undefined, {
            evidence: {
                trailers: 'unavailable',
                commits: 'unavailable',
                last_indexed_sha: 'unavailable',
                head_sha: 'unavailable',
                fts: 'unavailable',
            },
        });
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
    ? check('history-depth', 'history', 'history depth', 'warn', 'this clone has shallow history, so queries may be missing records that exist upstream', 'git fetch --unshallow', false, undefined, { evidence: { shallow: 'true' } })
    : check('history-depth', 'history', 'history depth', 'ok', 'full history is available', null, false, undefined, { evidence: { shallow: 'false' } });
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
    const category = 'history';
    const cwd = opts.cwd ?? process.cwd();
    const head = execGit(['rev-parse', '--verify', '--quiet', 'HEAD'], gitOptions(opts));
    if (head.code !== 0) {
        return check(id, category, title, 'skipped', 'no HEAD yet — nothing to compare against', null, false, false, {
            evidence: { candidates: '0', checked: '0', uncheckable: '0', lost_count: '0' },
            skipReason: 'unborn_head',
        });
    }
    const candidates = squashCandidates(opts, head.stdout.trim());
    if (candidates.length === 0) {
        return check(id, category, title, 'skipped', 'no local branch looks like the source of a squash — nothing to check', null, false, false, {
            evidence: { candidates: '0', checked: '0', uncheckable: '0', lost_count: '0' },
            skipReason: 'nothing_applicable',
        });
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
        return check(id, category, title, 'skipped', `${candidates.length} branch(es) looked like a squash source, but recorded nothing checkable`, null, false, false, {
            evidence: {
                candidates: String(candidates.length),
                checked: '0',
                uncheckable: String(uncheckable),
                lost_count: '0',
            },
            skipReason: 'nothing_applicable',
        });
    }
    if (lost.length > 0) {
        const named = lost
            .slice(0, 5)
            .map((entry) => `${entry.recordId} (${entry.branch})`)
            .join(', ');
        const more = lost.length > 5 ? `, and ${lost.length - 5} more` : '';
        return check(id, category, title, 'warn', `${lost.length} record(s) declared on a branch not reachable from HEAD do not appear in HEAD's history: ${named}${more}`, 'commitlore squash-preserve <base>..<branch> --target <the commit that squashed it>, ' +
            'then commit or attach the result', false, undefined, {
            evidence: {
                candidates: String(candidates.length),
                checked: String(checked),
                uncheckable: String(uncheckable),
                lost_count: String(lost.length),
            },
        });
    }
    const detail = uncheckable > 0
        ? `${checked} squash-shaped branch(es) checked, every declared Record-Id is reachable from HEAD ` +
            `(${uncheckable} branch(es) recorded nothing with an id and could not be checked this way)`
        : `${checked} squash-shaped branch(es) checked, every declared Record-Id is reachable from HEAD`;
    return check(id, category, title, 'ok', detail, null, false, undefined, {
        evidence: {
            candidates: String(candidates.length),
            checked: String(checked),
            uncheckable: String(uncheckable),
            lost_count: '0',
        },
    });
};
/** Runs `hook-runtime` at most once per report, whichever row asks first. */
const hookRuntimeOf = (ctx) => {
    const cached = ctx.memo.get('hook-runtime');
    if (cached !== undefined)
        return cached;
    const computed = checkHookRuntime(ctx.opts);
    ctx.memo.set('hook-runtime', computed);
    return computed;
};
/**
 * The registry. **Order is the report's order**, frozen to the array
 * `runDoctor` shipped with, because PRD §9.1 holds the text byte-identical
 * until the rendering ticket.
 *
 * `commit-msg-hook → hook-runtime` stays in the runner's memo because the
 * frozen presentation order puts the consumer first. Declaring it backwards
 * would make the registry claim an ordering guarantee it cannot keep.
 */
export const CHECK_REGISTRY = [
    { id: 'cli-runtime', title: 'cli runtime', category: 'runtime', dependencies: [], optional: false, run: (ctx) => checkRuntime(ctx.opts) },
    { id: 'notes-refspec', title: 'notes fetch refspec', category: 'transport', dependencies: [], optional: false, run: (ctx) => checkRefspec(ctx.opts) },
    { id: 'notes-push', title: 'notes push', category: 'transport', dependencies: [], optional: false, run: (ctx) => checkPush(ctx.opts) },
    { id: 'commit-msg-hook', title: 'commit-msg hook', category: 'capture', dependencies: [], optional: false, run: (ctx) => checkHook(ctx) },
    { id: 'hook-runtime', title: 'hook runtime', category: 'capture', dependencies: [], optional: false, run: hookRuntimeOf },
    { id: 'inject-runtime', title: 'PreToolUse hook runtime', category: 'delivery', dependencies: [], optional: false, run: (ctx) => checkInjectRuntime(ctx.opts) },
    { id: 'inject-version', title: 'PreToolUse hook version', category: 'delivery', dependencies: ['inject-runtime'], optional: false, run: (ctx, dependencies) => checkInjectVersion(ctx.opts, dependencies) },
    { id: 'mcp-lifecycle', title: 'MCP server sessions', category: 'delivery', dependencies: [], optional: false, run: (ctx) => checkMcpLifecycle(ctx.opts) },
    { id: 'pending-backlog', title: 'pending captures', category: 'capture', dependencies: [], optional: false, run: (ctx) => checkPendingBacklog(ctx.opts) },
    { id: 'git-trailers', title: 'git interpret-trailers', category: 'runtime', dependencies: [], optional: false, run: (ctx) => checkGit(ctx.opts) },
    { id: 'history-depth', title: 'history depth', category: 'history', dependencies: [], optional: false, run: (ctx) => checkHistoryDepth(ctx.opts) },
    { id: 'index-health', title: 'index health', category: 'index', dependencies: [], optional: false, run: (ctx) => checkIndex(ctx.opts) },
    { id: 'squash-conservation', title: 'squash conservation', category: 'history', dependencies: [], optional: false, run: (ctx) => checkSquashConservation(ctx.opts) },
];
/**
 * A check that threw becomes a row rather than a stack trace.
 *
 * The user who most needs a diagnosis is the one whose repository is in a
 * state some check did not anticipate. Losing the other twelve answers to that
 * is the worst possible trade, so the throw is contained and reported as what
 * it is: this check could not complete.
 */
const containedRun = (definition, ctx, dependencies) => {
    try {
        return definition.run(ctx, dependencies);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return check(definition.id, definition.category, definition.title, 'fail', 'this check could not complete, so its subsystem is unreported', null, false, true, { evidence: { error: message.split('\n')[0] ?? 'unknown error' } });
    }
};
const statusRank = (status) => status === 'fail' ? 3 : status === 'warn' ? 2 : status === 'skipped' ? 1 : 0;
const collapseBlockedBy = (checks) => {
    const byId = new Map(checks.map((row) => [row.id, row]));
    return checks.map((row) => {
        if (row.blockedBy === undefined)
            return row;
        const visited = new Set([row.id]);
        let root = byId.get(row.blockedBy);
        while (root !== undefined && root.blockedBy !== undefined) {
            if (visited.has(root.id)) {
                throw new Error(`doctor check ${row.id} has a cyclic blockedBy chain`);
            }
            visited.add(root.id);
            root = byId.get(root.blockedBy);
        }
        if (root === undefined) {
            throw new Error(`doctor check ${row.id} names an unknown blocker`);
        }
        if (root.status === 'ok') {
            throw new Error(`doctor check ${row.id} names an ok blocker`);
        }
        if (statusRank(row.status) > statusRank(root.status)) {
            throw new Error(`doctor check ${row.id} is more severe than its blocker`);
        }
        return root.id === row.blockedBy ? row : { ...row, blockedBy: root.id };
    });
};
export const runDoctor = (opts = {}) => {
    const ctx = { opts, now: process.hrtime.bigint, memo: new Map() };
    const completed = new Map();
    const checks = CHECK_REGISTRY.map((definition) => {
        const dependencies = new Map();
        for (const dependency of definition.dependencies) {
            const row = completed.get(dependency);
            if (row === undefined) {
                throw new Error(`doctor check ${definition.id} depends on ${dependency}, which has not run`);
            }
            dependencies.set(dependency, row);
        }
        const started = ctx.now();
        const row = containedRun(definition, ctx, dependencies);
        const elapsed = Number((ctx.now() - started) / 1000000n);
        const timed = { ...row, durationMs: elapsed < 0 ? 0 : elapsed };
        completed.set(definition.id, timed);
        return timed;
    });
    const collapsed = collapseBlockedBy(checks);
    return {
        checks: collapsed,
        exitCode: collapsed.some((entry) => entry.status === 'fail') ? 1 : 0,
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