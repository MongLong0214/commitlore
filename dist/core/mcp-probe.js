/**
 * A small, shared CommitLore MCP identity probe.
 *
 * A registration proves only that a host has a command to try.  This probe
 * establishes the stronger fact that the command answers as CommitLore: it
 * completes initialize with a name and version, then reports whether the
 * advertised tools form the read-delivery or capture-initiation surface.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { delimiter, isAbsolute, join } from 'node:path';
import { installedPath } from './paths.js';
const failure = (reason, detail, cleanup) => ({ kind: 'failure', reason, detail, ...(cleanup === undefined ? {} : { cleanup }) });
export const MCP_READ_TOOLS = ['commitlore_query', 'commitlore_before_change'];
export const MCP_CAPTURE_TOOLS = [
    'commitlore_prepare_capture',
    'commitlore_verify_capture',
    'commitlore_stage_capture',
];
export const isMcpProbeFailure = (result) => result.kind === 'failure';
const CLEANUP_GRACE_MS = 250;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
/**
 * The synchronous wrapper cannot return until its helper exits, so a completed
 * protocol exchange must also stop the server that supplied it. On POSIX the
 * server receives its own process group: killing that group also handles a
 * launcher which did not replace itself with the actual server process.
 */
const stopProbeChild = async (child) => {
    if (child.exitCode !== null || child.signalCode !== null)
        return 'not-needed';
    let exitedResolve;
    const exited = new Promise((resolve) => {
        exitedResolve = resolve;
    });
    child.once('exit', () => exitedResolve?.());
    if (process.platform === 'win32') {
        child.kill('SIGTERM');
        await Promise.race([exited, wait(CLEANUP_GRACE_MS)]);
        return 'reclaimed';
    }
    const signal = (value) => {
        if (child.pid !== undefined) {
            try {
                process.kill(-child.pid, value);
                return;
            }
            catch {
                // A very short-lived child can leave its process group before this
                // signal. Its direct process handle is still the portable fallback.
            }
        }
        child.kill(value);
    };
    signal('SIGTERM');
    await Promise.race([exited, wait(CLEANUP_GRACE_MS)]);
    if (child.exitCode === null && child.signalCode === null) {
        signal('SIGKILL');
        await Promise.race([exited, wait(CLEANUP_GRACE_MS)]);
    }
    return child.exitCode === null && child.signalCode === null ? 'could-not-reclaim' : 'reclaimed';
};
const commandPath = (command) => {
    const bare = !isAbsolute(command) && !command.includes('/');
    const pathCandidates = bare
        ? (process.env['PATH'] ?? '').split(delimiter).filter(Boolean).map((directory) => join(directory, command))
        : [command];
    const hasExtension = command.lastIndexOf('.') > command.lastIndexOf('/');
    const extensions = process.platform === 'win32' && bare && !hasExtension
        ? (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
        : [];
    const candidates = pathCandidates.flatMap((candidate) => [
        candidate,
        ...extensions.map((extension) => candidate + extension),
    ]);
    let nonExecutable;
    for (const candidate of candidates) {
        try {
            if (statSync(candidate).isDirectory())
                return failure('command-is-directory', 'command is a directory');
            accessSync(candidate, constants.X_OK);
            return candidate;
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                nonExecutable ??= failure('command-not-executable', 'command is not executable');
            }
        }
    }
    return nonExecutable ?? failure('command-not-found', 'command does not exist');
};
const needsWindowsCommandShell = (command) => process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
/** Speak enough MCP to distinguish a launchable command from usable CommitLore. */
export const probeMcp = async (command, args) => {
    const resolved = commandPath(command);
    if (typeof resolved !== 'string')
        return resolved;
    return new Promise((resolve) => {
        let settled = false;
        let child;
        let timer;
        const finish = (problem) => {
            if (settled)
                return;
            settled = true;
            if (timer !== undefined)
                clearTimeout(timer);
            void (async () => {
                const cleanup = child === undefined ? 'not-needed' : await stopProbeChild(child);
                if (cleanup === 'could-not-reclaim') {
                    resolve(failure('probe-unavailable', 'MCP verification completed but could not reclaim its child process tree', cleanup));
                    return;
                }
                resolve({ ...problem, cleanup });
            })();
        };
        try {
            const childEnv = { ...process.env };
            delete childEnv['COMMITLORE_MCP_PROBE'];
            child = spawn(resolved, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: needsWindowsCommandShell(resolved),
                env: childEnv,
                detached: process.platform !== 'win32',
            });
        }
        catch (error) {
            finish(failure('command-could-not-start', `could not start command: ${error instanceof Error ? error.message : String(error)}`));
            return;
        }
        let buffer = '';
        let initialized = false;
        timer = setTimeout(() => finish(failure('initialize-timed-out', 'MCP initialize timed out')), 5_000);
        child.once('error', (error) => finish(failure('command-could-not-start', `could not start command: ${error.message}`)));
        child.once('exit', (code) => {
            if (!settled)
                finish(failure('command-exited', `command exited before MCP verification (status ${String(code)})`));
        });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                let message;
                try {
                    message = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (!initialized && message.id === 1) {
                    const info = message.result?.serverInfo;
                    if (info?.name !== 'commitlore' || typeof info.version !== 'string' || info.version === '') {
                        finish(failure('foreign-server', 'MCP initialize did not identify CommitLore with a version'));
                        return;
                    }
                    initialized = true;
                    child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
                }
                else if (initialized && message.id === 2) {
                    const tools = new Set((message.result?.tools ?? []).map((tool) => tool.name));
                    if (!MCP_READ_TOOLS.every((tool) => tools.has(tool))) {
                        finish(failure('missing-tools', 'MCP server lacks CommitLore read-delivery tools'));
                    }
                    else if (MCP_CAPTURE_TOOLS.every((tool) => tools.has(tool))) {
                        finish({ kind: 'capture-initiator', detail: 'MCP server advertises CommitLore read and capture tools', cleanup: 'not-needed' });
                    }
                    else {
                        finish({ kind: 'read-delivery', detail: 'MCP server advertises CommitLore read tools but not the complete capture tool set', cleanup: 'not-needed' });
                    }
                    return;
                }
            }
        });
        // A command that is not an MCP server can close before this write. Keep
        // the stream error handled: EPIPE is an unhealthy registration, not an
        // inspector crash (the deterministic close-stdin case covers this race).
        child.stdin.on('error', () => finish(failure('command-closed-input', 'command closed its input before MCP verification')));
        // Let a launcher complete its own descriptor setup before the first
        // protocol write. This preserves the probe's distinct closed-input result
        // when the wrapper is the full CLI bundle rather than the former sidecar.
        setTimeout(() => {
            child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'commitlore-probe', version: '1' } } })}\n`);
        }, 200);
    });
};
/**
 * Doctor's report API is synchronous. Run this same async probe through the
 * installation's declared runtime bundle rather than maintaining a second,
 * subtly different protocol entry point.
 */
export const probeMcpSync = (command, args) => {
    const result = spawnSync(process.execPath, [
        installedPath('dist', 'commitlore.mjs'),
        'internal',
        'mcp-probe',
        '--command',
        command,
        '--args-json',
        JSON.stringify(args),
    ], {
        encoding: 'utf8',
        // The helper owns the five-second protocol timeout and needs a little
        // room to reap a stubborn server. This outer bound is only a safety net
        // for a broken helper, not the server-response timeout we report.
        timeout: 7_000,
        env: { ...process.env, COMMITLORE_MCP_PROBE: '1' },
    });
    if (result.error !== undefined) {
        return failure('probe-unavailable', `could not run MCP verification: ${result.error.message}`);
    }
    try {
        const parsed = JSON.parse(result.stdout);
        if (typeof parsed === 'object'
            && parsed !== null
            && typeof parsed.kind === 'string'
            && typeof parsed.detail === 'string'
            && (parsed.kind === 'read-delivery'
                || parsed.kind === 'capture-initiator'
                || (parsed.kind === 'failure' && typeof parsed.reason === 'string'))) {
            return parsed;
        }
    }
    catch {
        // The diagnostic below includes the child status without trusting output.
    }
    return failure('probe-unavailable', `could not read MCP verification result (status ${String(result.status)})`);
};
//# sourceMappingURL=mcp-probe.js.map