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
const failure = (reason, detail) => ({ kind: 'failure', reason, detail });
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
        return;
    let exitedResolve;
    const exited = new Promise((resolve) => {
        exitedResolve = resolve;
    });
    child.once('exit', () => exitedResolve?.());
    const signal = (value) => {
        if (process.platform !== 'win32' && child.pid !== undefined) {
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
};
const commandPath = (command) => {
    const candidates = isAbsolute(command) || command.includes('/')
        ? [command]
        : (process.env['PATH'] ?? '').split(delimiter).filter(Boolean).map((directory) => join(directory, command));
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
                if (child !== undefined)
                    await stopProbeChild(child);
                resolve(problem);
            })();
        };
        try {
            const childEnv = { ...process.env };
            delete childEnv['COMMITLORE_MCP_PROBE'];
            child = spawn(resolved, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: false,
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
                        finish({ kind: 'capture-initiator', detail: 'MCP server advertises CommitLore read and capture tools' });
                    }
                    else {
                        finish({ kind: 'read-delivery', detail: 'MCP server advertises CommitLore read tools but not the complete capture tool set' });
                    }
                    return;
                }
            }
        });
        // A command that is not an MCP server can close before this write. Keep
        // the stream error handled: EPIPE is an unhealthy registration, not an
        // inspector crash (the deterministic close-stdin case covers this race).
        child.stdin.on('error', () => finish(failure('command-closed-input', 'command closed its input before MCP verification')));
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'commitlore-probe', version: '1' } } })}\n`);
    });
};
/**
 * Doctor's report API is synchronous. Run this same async probe in its own
 * Node process rather than maintaining a second, subtly different protocol.
 */
export const probeMcpSync = (command, args) => {
    const result = spawnSync(process.execPath, [installedPath('dist', 'core', 'mcp-probe.js'), command, JSON.stringify(args)], {
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
const probeEntrypoint = installedPath('dist', 'core', 'mcp-probe.js');
if (process.env['COMMITLORE_MCP_PROBE'] === '1' && process.argv[1] === probeEntrypoint) {
    const [command, rawArgs] = process.argv.slice(2);
    let args;
    try {
        const parsed = JSON.parse(rawArgs ?? 'null');
        if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string'))
            args = parsed;
    }
    catch {
        // The result below is a protocol response, not an uncaught helper error.
    }
    void (async () => {
        const result = command === undefined || args === undefined
            ? failure('probe-unavailable', 'could not read MCP verification arguments')
            : await probeMcp(command, args);
        // `spawnSync` waits for this helper, not for its stdout alone. Exit after
        // flushing the verdict so a server's residual handles cannot turn a
        // successful answer into the wrapper's timeout error.
        process.stdout.write(JSON.stringify(result), () => process.exit(0));
    })();
}
//# sourceMappingURL=mcp-probe.js.map