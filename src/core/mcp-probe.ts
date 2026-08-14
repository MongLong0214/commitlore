/**
 * A small, shared CommitLore MCP identity probe.
 *
 * A registration proves only that a host has a command to try.  This probe
 * establishes the stronger fact that the command answers as CommitLore: it
 * completes initialize with a name and version, then reports whether the
 * advertised tools form the read-delivery or capture-initiation surface.
 */

import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

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
  kind: 'failure';
  reason: McpProbeFailureKind;
  detail: string;
  cleanup?: McpProbeCleanup;
}

export interface McpProbeSuccess {
  /** The server identifies as CommitLore; kind records its advertised tool set. */
  kind: 'read-delivery' | 'capture-initiator';
  detail: string;
  cleanup: McpProbeCleanup;
}

export type McpProbeResult = McpProbeFailure | McpProbeSuccess;
export type McpProbeCleanup = 'not-needed' | 'reclaimed' | 'could-not-reclaim';

const failure = (
  reason: McpProbeFailureKind,
  detail: string,
  cleanup?: McpProbeCleanup,
): McpProbeFailure => ({ kind: 'failure', reason, detail, ...(cleanup === undefined ? {} : { cleanup }) });

export const MCP_READ_TOOLS = ['commitlore_query', 'commitlore_before_change'] as const;
export const MCP_CAPTURE_TOOLS = [
  'commitlore_prepare_capture',
  'commitlore_verify_capture',
  'commitlore_stage_capture',
] as const;

export const isMcpProbeFailure = (result: McpProbeResult): result is McpProbeFailure => result.kind === 'failure';

const CLEANUP_GRACE_MS = 250;

/**
 * How long a registered server gets to answer `initialize` (#640).
 *
 * The old value was five seconds and it was too tight to be a verdict. On a
 * Windows runner a *passing* probe consumed 4478ms of it, because the chain is
 * doctor -> this sidecar's node -> cmd.exe -> the server's own node: three
 * process starts before a byte moves. The same registration on a slower
 * machine reported `initialize-timed-out`, and doctor called it unhealthy.
 *
 * Fifteen seconds is not a guess at how slow a machine can be; it is a budget
 * chosen so the measured worst *passing* case has room to be three times
 * slower before a working registration is called broken. A genuinely dead
 * command still fails long before it, through `command-exited` or
 * `command-could-not-start`, which do not wait for this at all.
 */
const DEFAULT_INITIALIZE_TIMEOUT_MS = 15_000;

/**
 * Tests that assert the timeout path would otherwise wait the full budget
 * twice, and a fixture that never answers is exactly what they need. The
 * sidecar inherits the environment, so an override reaches the probe wherever
 * it actually runs.
 */
const initializeTimeoutMs = (): number => {
  const raw = Number(process.env['COMMITLORE_MCP_PROBE_TIMEOUT_MS']);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INITIALIZE_TIMEOUT_MS;
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * The synchronous wrapper cannot return until its helper exits, so a completed
 * protocol exchange must also stop the server that supplied it. On POSIX the
 * server receives its own process group: killing that group also handles a
 * launcher which did not replace itself with the actual server process.
 */
const stopProbeChild = async (child: ChildProcessWithoutNullStreams): Promise<McpProbeCleanup> => {
  if (child.exitCode !== null || child.signalCode !== null) return 'not-needed';

  let exitedResolve: (() => void) | undefined;
  const exited = new Promise<void>((resolve) => {
    exitedResolve = resolve;
  });
  child.once('exit', () => exitedResolve?.());

  if (process.platform === 'win32') {
    if (child.pid === undefined) return 'could-not-reclaim';
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (result.error !== undefined || result.status !== 0) return 'could-not-reclaim';
    await Promise.race([exited, wait(CLEANUP_GRACE_MS)]);
    return 'reclaimed';
  }

  const signal = (value: NodeJS.Signals): void => {
    if (child.pid !== undefined) {
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
  return child.exitCode === null && child.signalCode === null ? 'could-not-reclaim' : 'reclaimed';
};

/**
 * The filesystem identity of one process currently answering an MCP session.
 * `reportedVersion` is intentionally observation only: two different roots
 * may carry exactly the same package version.
 */
export interface LiveMcpRuntime {
  readonly pid: number;
  readonly entrypointRealpath: string;
  readonly packageRoot: string;
  readonly reportedVersion: string | null;
  readonly bundlePresent: boolean;
  readonly specPresent: boolean;
}

/** Process enumeration is an effect seam because `ps` is not universal. */
export interface LiveMcpRuntimeScan {
  readonly available: boolean;
  readonly runtimes: readonly LiveMcpRuntime[];
  readonly detail: string;
}


const packageVersionAt = (root: string): string | null => {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : null;
  } catch {
    return null;
  }
};

const runtimeFromEntrypoint = (pid: number, entrypoint: string): LiveMcpRuntime => {
  let entrypointRealpath = entrypoint;
  try {
    entrypointRealpath = realpathSync(entrypoint);
  } catch {
    // A deleted install can keep serving from its already-open program image.
    // Retain the observed pathname so doctor can still name the stale root.
  }
  const packageRoot = dirname(dirname(entrypointRealpath));
  return {
    pid,
    entrypointRealpath,
    packageRoot,
    reportedVersion: packageVersionAt(packageRoot),
    bundlePresent: existsSync(join(packageRoot, 'dist', 'commitlore.mjs')),
    specPresent: existsSync(join(packageRoot, 'spec', 'SPEC.md')),
  };
};

/**
 * Enumerate processes, not registrations: the former is the server that is
 * actually answering a session. The DoctorContext supplies this as an
 * injectable seam so platform-specific `ps` output never enters a fixture.
 */
export const discoverLiveMcpRuntimes = (): LiveMcpRuntimeScan => {
  if (process.platform === 'win32') {
    return { available: false, runtimes: [], detail: 'process enumeration is unavailable on win32' };
  }
  const result = spawnSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' });
  if (result.error !== undefined || result.status !== 0) {
    return {
      available: false,
      runtimes: [],
      detail: result.error?.message ?? `ps exited with status ${String(result.status)}`,
    };
  }
  const runtimes: LiveMcpRuntime[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+.*?(\/\S*\/dist\/commitlore\.mjs)\s+mcp(?:\s|$)/.exec(line);
    if (match === null) continue;
    const pid = Number(match[1]);
    const entrypoint = match[2];
    if (entrypoint !== undefined && Number.isSafeInteger(pid)) {
      runtimes.push(runtimeFromEntrypoint(pid, entrypoint));
    }
  }
  return { available: true, runtimes, detail: 'ps -axo pid=,args=' };
};

const commandPath = (command: string): string | McpProbeFailure => {
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

const needsWindowsCommandShell = (command: string): boolean =>
  process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);

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
    } catch (error) {
      finish(failure('command-could-not-start', `could not start command: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }

    let buffer = '';
    let initialized = false;
    const timeoutMs = initializeTimeoutMs();
    timer = setTimeout(
      () => finish(failure('initialize-timed-out', `MCP initialize timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
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
          if (!MCP_READ_TOOLS.every((tool) => tools.has(tool))) {
            finish(failure('missing-tools', 'MCP server lacks CommitLore read-delivery tools'));
          } else if (MCP_CAPTURE_TOOLS.every((tool) => tools.has(tool))) {
            finish({ kind: 'capture-initiator', detail: 'MCP server advertises CommitLore read and capture tools', cleanup: 'not-needed' });
          } else {
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
export const probeMcpSync = (command: string, args: string[]): McpProbeResult => {
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
    // The helper owns the protocol timeout and needs room beyond it to reap a
    // stubborn server. This outer bound is only a safety net for a broken
    // helper, not the server-response timeout we report — so it is derived
    // from that budget rather than written next to it, because a constant that
    // silently fell below it would kill the helper before it could answer and
    // report the death as the server's fault.
    timeout: initializeTimeoutMs() + 2_000,
    env: { ...process.env, COMMITLORE_MCP_PROBE: '1' },
  });
  if (result.error !== undefined) {
    return failure('probe-unavailable', `could not run MCP verification: ${result.error.message}`);
  }
  try {
    const parsed = JSON.parse(result.stdout) as McpProbeResult;
    if (
      typeof parsed === 'object'
      && parsed !== null
      && typeof parsed.kind === 'string'
      && typeof parsed.detail === 'string'
      && (
        parsed.kind === 'read-delivery'
        || parsed.kind === 'capture-initiator'
        || (parsed.kind === 'failure' && typeof (parsed as Partial<McpProbeFailure>).reason === 'string')
      )
    ) {
      return parsed;
    }
  } catch {
    // The diagnostic below includes the child status without trusting output.
  }
  return failure('probe-unavailable', `could not read MCP verification result (status ${String(result.status)})`);
};
