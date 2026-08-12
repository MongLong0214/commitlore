/**
 * #424: a session lost all seven commitlore tools mid-conversation, after four
 * of them had returned real data. From inside that session the failure was
 * invisible — `ToolSearch` answers "no matching tools" for a withdrawn
 * capability exactly as for one that never existed — and afterwards nothing on
 * disk could say whether the server had ever been running. `claude mcp list`
 * reported it connected while no process existed; the client was not started
 * with `--debug`, so the server's stderr went to a pipe.
 *
 * This does not fix the registration loss, which lives in the client. It
 * records the half that is reachable from here, so the question "was it
 * running, and did it die?" has an answer next time.
 *
 * The distinction the log exists for is between a session that **closed** and
 * one that was **killed**, so both are driven for real rather than simulated.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { crashedRuns, lifecyclePath, readLifecycle, unfinishedRuns } from '../src/mcp/lifecycle.js';
import { checkMcpLifecycle } from '../src/commands/doctor/checks/delivery-mcp-lifecycle.js';
import type { DoctorContext } from '../src/commands/doctor/model.js';
import { createTestRepo } from './git-fixtures.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(REPO_ROOT, 'dist', 'commitlore.mjs');

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): void => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
};

const repo = (label: string): string => {
  const dir = createTestRepo({
    path: mkdtempSync(join(realpathSync(tmpdir()), `commitlore-${label}-`)),
  });
  scratch.push(dir);
  git(dir, ['config', 'user.email', `${label}@example.invalid`]);
  git(dir, ['config', 'user.name', label]);
  git(dir, ['commit', '--quiet', '--allow-empty', '-m', 'init']);
  return dir;
};

const INIT = `${JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
})}\n`;

type Exit = { code: number | null; signal: NodeJS.Signals | null };

interface RunningServer {
  readonly pid: number;
  readonly done: Promise<Exit>;
  readonly stderr: () => string;
  clean: () => void;
  closeStdin: () => void;
  hangUp: () => void;
  crash: (kind: 'uncaught' | 'rejection') => void;
  signal: () => void;
  kill: () => void;
}

/**
 * The test-only preload gives the parent an IPC trigger after the real built
 * server has completed its JSON-RPC handshake. No application code knows
 * about it: its throws occur outside a request handler, exactly like a timer,
 * callback or promise the server did not await in production.
 */
const lifecyclePreload = (cwd: string): string => {
  const path = join(cwd, 'mcp-lifecycle-trigger.mjs');
  writeFileSync(
    path,
    [
      "process.on('message', (action) => {",
      "  if (action === 'clean') process.exit(0);",
      "  if (action === 'uncaught') setTimeout(() => { throw new Error('lifecycle uncaught crash'); });",
      "  if (action === 'rejection') setTimeout(() => { void Promise.reject(new Error('lifecycle rejected crash')); });",
      '});',
      'process.channel?.unref();',
      '',
    ].join('\n'),
  );
  return path;
};

/** Starts the built server, waits for its real initialize response, and returns its process controls. */
const startServer = (cwd: string): Promise<RunningServer> =>
  new Promise((resolveHandle, rejectHandle) => {
    const child: ChildProcess = spawn(process.execPath, ['--import', lifecyclePreload(cwd), BUNDLE, 'mcp'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    let stderr = '';
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) rejectHandle(new Error('MCP server did not answer initialize in time'));
    }, 30_000);
    const done = new Promise<Exit>((resolveDone) => {
      child.once('exit', (code, signal) => resolveDone({ code, signal }));
    });

    child.on('error', (error) => {
      if (!resolved) rejectHandle(error);
    });
    child.stdin?.on('error', () => {});
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdout?.once('data', () => {
      resolved = true;
      clearTimeout(timeout);
      const control = (action: 'clean' | 'uncaught' | 'rejection'): void => {
        if (!child.send(action)) throw new Error(`could not send ${action} lifecycle trigger`);
      };
      resolveHandle({
        pid: child.pid ?? 0,
        done,
        stderr: () => stderr,
        clean: () => control('clean'),
        closeStdin: () => child.stdin?.end(),
        hangUp: () => {
          // Close the client's read end, then induce a protocol response. The
          // SDK writes it to its actual output stream, which now emits EPIPE.
          child.stdout?.destroy();
          child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
        },
        crash: control,
        signal: () => child.kill('SIGTERM'),
        kill: () => child.kill('SIGKILL'),
      });
    });
    child.stdin?.write(INIT);
  });

const exitFor = (cwd: string, pid: number) => {
  const exits = readLifecycle(cwd).filter((entry) => entry.kind === 'exited' && entry.pid === pid);
  expect(exits).toHaveLength(1);
  return exits[0]!;
};

describe('#506 the built MCP server records exactly how it ended', () => {
  it('records a direct clean exit', async () => {
    const dir = repo('life-clean');
    const server = await startServer(dir);
    server.clean();
    expect(await server.done).toMatchObject({ code: 0, signal: null });

    const entries = readLifecycle(dir);
    expect(entries.filter((entry) => entry.kind === 'started')).toHaveLength(1);
    expect(entries[0]?.pid).toBe(server.pid);
    // The start line carries what a later reader needs: version and the path it
    // was launched from, which is how a stale plugin cache is identified.
    expect(entries[0]?.detail).toMatch(/\d+\.\d+\.\d+/);
    expect(entries[0]?.detail).toContain('commitlore.mjs');
    expect(exitFor(dir, server.pid).detail).toBe('clean');
  }, 60_000);

  it('records a client closing stdin', async () => {
    const dir = repo('life-stdin');
    const server = await startServer(dir);
    server.closeStdin();
    expect(await server.done).toMatchObject({ code: 0, signal: null });

    expect(exitFor(dir, server.pid).detail).toBe('stdin closed');
    expect(unfinishedRuns(dir)).toEqual([]);
  }, 60_000);

  it('records a signal', async () => {
    const dir = repo('life-signal');
    const server = await startServer(dir);
    server.signal();
    expect(await server.done).toMatchObject({ code: 0, signal: null });

    expect(exitFor(dir, server.pid).detail).toBe('SIGTERM');
  }, 60_000);

  it('records a closed client output pipe as a client hangup', async () => {
    const dir = repo('life-hangup');
    const server = await startServer(dir);
    server.hangUp();
    expect(await server.done).toMatchObject({ code: 0, signal: null });

    expect(exitFor(dir, server.pid).detail).toBe('client hung up');
  }, 60_000);

  it('records an uncaught exception as a crash with its cause and diagnostics', async () => {
    const dir = repo('life-uncaught');
    const server = await startServer(dir);
    server.crash('uncaught');
    expect(await server.done).toMatchObject({ code: 1, signal: null });

    expect(exitFor(dir, server.pid).detail).toBe('crashed: lifecycle uncaught crash');
    expect(server.stderr()).toContain('crashed: lifecycle uncaught crash');
    expect(crashedRuns(dir).map((entry) => entry.pid)).toContain(server.pid);
  }, 60_000);

  it('records an unhandled rejection as a crash with its cause', async () => {
    const dir = repo('life-rejection');
    const server = await startServer(dir);
    server.crash('rejection');
    expect(await server.done).toMatchObject({ code: 1, signal: null });

    expect(exitFor(dir, server.pid).detail).toBe('crashed: lifecycle rejected crash');
    expect(server.stderr()).toContain('crashed: lifecycle rejected crash');
  }, 60_000);

  it('reports a recorded crash differently from an ended server', async () => {
    const dir = repo('life-doctor-crash');
    const server = await startServer(dir);
    server.crash('uncaught');
    await server.done;

    const row = checkMcpLifecycle({ opts: { cwd: dir } } as DoctorContext);
    expect(row.status).toBe('warn');
    expect(row.detail).toContain('crashed');
    expect(row.detail).toContain('lifecycle uncaught crash');
    expect(row.evidence?.['crash_count']).toBe('1');
  }, 60_000);

  it('leaves a start with no exit when the server is killed', async () => {
    const dir = repo('life-killed');
    const server = await startServer(dir);
    server.kill();
    await server.done;

    const unfinished = unfinishedRuns(dir);
    expect(unfinished.map((entry) => entry.pid)).toContain(server.pid);
  }, 60_000);

  /**
   * The running server must not look like a casualty. Without this the check
   * would fire on every healthy session, which is the fastest way to make a
   * warning ignored.
   */
  it('does not report a server that is still running', async () => {
    const dir = repo('life-running');
    const server = await startServer(dir);

    expect(unfinishedRuns(dir)).toEqual([]);

    server.kill();
    await server.done;
  }, 60_000);

  it('writes inside .git, where nothing can commit it', () => {
    const dir = repo('life-path');
    const path = lifecyclePath(dir);
    expect(path).not.toBeNull();
    expect(path).toContain(join('.git', 'commitlore'));
    // `toContain` alone passes for a path that merely has those segments
    // somewhere inside it, which is how the linked-worktree case below went
    // unnoticed. The log has to be under this repository's git directory, not
    // merely mention it.
    expect(path!.startsWith(join(dir, '.git'))).toBe(true);
  });

  /**
   * A linked worktree is the case `lifecyclePath` promises to handle and the
   * one it got wrong. `rev-parse --git-path` answers relative to `cwd` in an
   * ordinary clone and absolutely here, and joining an absolute answer onto
   * `cwd` put the log at `<worktree>/Users/.../.git/worktrees/<name>/…` —
   * a directory created inside the working tree on every server start, where a
   * diff can see it and another working directory's diagnostics cannot.
   */
  it('writes to the real git directory from a linked worktree', () => {
    const dir = repo('life-worktree');
    const linked = `${dir}-linked`;
    expect(execGit(['worktree', 'add', '--detach', linked], { cwd: dir }).code).toBe(0);

    const path = lifecyclePath(linked);
    const gitDir = execGit(['rev-parse', '--path-format=absolute', '--git-path', 'commitlore'], {
      cwd: linked,
    });

    expect(path).not.toBeNull();
    expect(path!.startsWith(linked)).toBe(false);
    expect(path).toBe(join(gitDir.stdout.trim(), 'mcp-lifecycle.log'));
  });

  it('is silent outside a repository rather than throwing', () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-life-nogit-'));
    scratch.push(dir);
    expect(lifecyclePath(dir)).toBeNull();
    expect(readLifecycle(dir)).toEqual([]);
    expect(unfinishedRuns(dir)).toEqual([]);
    expect(existsSync(join(dir, '.git'))).toBe(false);
  });

  it('a log it cannot parse reads as empty rather than failing', () => {
    const dir = repo('life-garbage');
    const path = lifecyclePath(dir);
    expect(path).not.toBeNull();
    if (path === null) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not a lifecycle line\n \n');
    expect(readLifecycle(dir)).toEqual([]);
    expect(readFileSync(path, 'utf8')).toContain('not a lifecycle line');
  });
});
