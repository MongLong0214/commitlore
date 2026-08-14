/**
 * A small, shared CommitLore MCP identity probe.
 *
 * A registration proves only that a host has a command to try.  This probe
 * establishes the stronger fact that the command answers as CommitLore: it
 * completes initialize with a name and version, then exposes the minimum
 * capture tool surface.
 */

import { accessSync, constants, statSync } from 'node:fs';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { delimiter, isAbsolute, join } from 'node:path';

import { installedPath } from './paths.js';

export type McpProbeFailureKind =
  | 'command-not-found'
  | 'command-is-directory'
  | 'command-not-executable'
  | 'command-could-not-start'
  | 'command-exited'
  | 'command-closed-input'
  | 'initialize-timed-out'
  | 'foreign-server'
  | 'missing-tools'
  | 'probe-unavailable';

export interface McpProbeFailure {
  kind: McpProbeFailureKind;
  detail: string;
}

export type McpProbeResult = McpProbeFailure | null;

const failure = (kind: McpProbeFailureKind, detail: string): McpProbeFailure => ({ kind, detail });

const CLEANUP_GRACE_MS = 250;

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * The synchronous wrapper cannot return until its helper exits, so a completed
 * protocol exchange must also stop the server that supplied it. On POSIX the
 * server receives its own process group: killing that group also handles a
 * launcher which did not replace itself with the actual server process.
 */
const stopProbeChild = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;

  let exitedResolve: (() => void) | undefined;
  const exited = new Promise<void>((resolve) => {
    exitedResolve = resolve;
  });
  child.once('exit', () => exitedResolve?.());

  const signal = (value: NodeJS.Signals): void => {
    if (process.platform !== 'win32' && child.pid !== undefined) {
      try {
        process.kill(-child.pid, value);
        return;
      } catch {
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

const commandPath = (command: string): string | McpProbeFailure => {
  const candidates = isAbsolute(command) || command.includes('/')
    ? [command]
    : (process.env['PATH'] ?? '').split(delimiter).filter(Boolean).map((directory) => join(directory, command));
  let nonExecutable: McpProbeFailure | undefined;
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) return failure('command-is-directory', 'command is a directory');
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        nonExecutable ??= failure('command-not-executable', 'command is not executable');
      }
    }
  }
  return nonExecutable ?? failure('command-not-found', 'command does not exist');
};

/** Speak enough MCP to distinguish a launchable command from usable CommitLore. */
export const probeMcp = async (command: string, args: string[]): Promise<McpProbeResult> => {
  const resolved = commandPath(command);
  if (typeof resolved !== 'string') return resolved;

  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcessWithoutNullStreams | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (problem: McpProbeResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      void (async () => {
        if (child !== undefined) await stopProbeChild(child);
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
    } catch (error) {
      finish(failure('command-could-not-start', `could not start command: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }

    let buffer = '';
    let initialized = false;
    timer = setTimeout(() => finish(failure('initialize-timed-out', 'MCP initialize timed out')), 5_000);
    child.once('error', (error) => finish(failure('command-could-not-start', `could not start command: ${error.message}`)));
    child.once('exit', (code) => {
      if (!settled) finish(failure('command-exited', `command exited before MCP verification (status ${String(code)})`));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        let message: { id?: number; result?: { serverInfo?: { name?: unknown; version?: unknown }; tools?: Array<{ name?: unknown }> } };
        try { message = JSON.parse(line) as typeof message; } catch { continue; }
        if (!initialized && message.id === 1) {
          const info = message.result?.serverInfo;
          if (info?.name !== 'commitlore' || typeof info.version !== 'string' || info.version === '') {
            finish(failure('foreign-server', 'MCP initialize did not identify CommitLore with a version'));
            return;
          }
          initialized = true;
          child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
        } else if (initialized && message.id === 2) {
          const tools = new Set((message.result?.tools ?? []).map((tool) => tool.name));
          finish(
            tools.has('commitlore_query') && tools.has('commitlore_before_change')
              ? null
              : failure('missing-tools', 'MCP server lacks CommitLore minimum tools'),
          );
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
export const probeMcpSync = (command: string, args: string[]): McpProbeResult => {
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
    const parsed = JSON.parse(result.stdout) as McpProbeResult;
    if (parsed === null || (typeof parsed === 'object' && parsed !== null && typeof parsed.kind === 'string' && typeof parsed.detail === 'string')) {
      return parsed;
    }
  } catch {
    // The diagnostic below includes the child status without trusting output.
  }
  return failure('probe-unavailable', `could not read MCP verification result (status ${String(result.status)})`);
};

const probeEntrypoint = installedPath('dist', 'core', 'mcp-probe.js');
if (process.env['COMMITLORE_MCP_PROBE'] === '1' && process.argv[1] === probeEntrypoint) {
  const [command, rawArgs] = process.argv.slice(2);
  let args: string[] | undefined;
  try {
    const parsed = JSON.parse(rawArgs ?? 'null');
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) args = parsed;
  } catch {
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
