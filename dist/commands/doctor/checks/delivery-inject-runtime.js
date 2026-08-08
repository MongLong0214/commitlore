/**
 * The `inject-runtime` doctor check.
 *
 * It owns the configured PreToolUse execution probe and its deterministic
 * result evaluation; version comparison remains a separate sibling check.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { runQuery } from '../../../core/query.js';
import { CLAUDE_HOOK_COMMAND, CLAUDE_HOOK_MARKER, claudeSettingsPath, readClaudeHookStatus } from '../../../hooks/claude-settings.js';
import { check, streamEvidence } from '../model.js';
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
export const checkInjectRuntime = (opts) => {
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
//# sourceMappingURL=delivery-inject-runtime.js.map