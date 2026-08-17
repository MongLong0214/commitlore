/** R0-04 (#595) — host health is a protocol result, never a text match. */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveCommand } from '../src/commands/installer-hosts.js';


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'dist', 'commitlore.mjs');
const scratch: string[] = [];
const temporary = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'commitlore-install595-'));
  scratch.push(path);
  return path;
};

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  summary: { schema: string; runtimeIdentity: { version: string; entrypoint: string; packageRoot: string; indexSchemaVersion: number }; ok: boolean; hosts: Array<{ host: string; outcome: string; healthy: boolean }> };
}

const wrapper = (root: string, name = 'commitlore', mode = 0o755): string => {
  const isWindows = process.platform === 'win32';
  const path = join(root, 'bin', `${name}${isWindows ? '.cmd' : ''}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, isWindows
    ? `@echo off\r\n"${process.execPath}" "${ENTRY}" %*\r\n`
    : `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(ENTRY)} "$@"\n`);
  if (!isWindows) chmodSync(path, mode);
  return path;
};

const withoutPath = (): NodeJS.ProcessEnv => Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
);

const isolatedPath = (): string => process.platform === 'win32'
  ? [join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32'), dirname(process.execPath)].join(delimiter)
  : '/usr/bin:/bin';

const run = (home: string, ownWrapper: string, env: Record<string, string> = {}): Run => {
  const result = spawnSync(process.execPath, [ENTRY, 'installer-hosts', '--wrapper', ownWrapper, '--data-root', join(home, 'data'), '--home', home, '--json'], {
    encoding: 'utf8',
    // Isolate host detection from the developer machine. Individual tests add
    // the host CLI they intend to exercise.
    env: { ...withoutPath(), PATH: isolatedPath(), ...env },
  });
  return { status: result.status, summary: JSON.parse(result.stdout) as Run['summary'] };
};

const cursorConfig = (home: string, entry: unknown): string => {
  const path = join(home, '.cursor', 'mcp.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ mcpServers: { commitlore: entry } }));
  return path;
};

describe('installer-hosts accepts only live CommitLore registrations', () => {
  it.each([
    ['a command that does not exist', (root: string) => ({ command: join(root, 'missing'), args: ['mcp'] })],
    ['a command that is a directory', (root: string) => ({ command: root, args: ['mcp'] })],
  ])('exits non-zero for %s', (_label, entry) => {
    const root = temporary();
    const home = join(root, 'home');
    const ours = wrapper(root);
    cursorConfig(home, entry(root));
    expect(run(home, ours).status).toBe(1);
  });

  it('exits non-zero when our wrapper has wrong args', () => {
    const root = temporary();
    const home = join(root, 'home');
    const ours = wrapper(root);
    cursorConfig(home, { command: ours, args: ['doctor'] });
    expect(run(home, ours).status).toBe(1);
  });

  it('exits non-zero for an unparseable requested host config', () => {
    const root = temporary();
    const home = join(root, 'home');
    const ours = wrapper(root);
    const config = join(home, '.cursor', 'mcp.json');
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, '{"mcpServers":');
    expect(run(home, ours).status).toBe(1);
  });

  it('exits non-zero when the requested host CLI fails', () => {
    const root = temporary();
    const home = join(root, 'home');
    const ours = wrapper(root);
    const bin = join(root, 'host-bin');
    mkdirSync(bin);
    const codex = join(bin, 'codex');
    writeFileSync(codex, process.platform === 'win32' ? 'not executable\r\n' : '#!/bin/sh\nexit 1\n');
    if (process.platform !== 'win32') chmodSync(codex, 0o755);
    expect(run(home, ours, { PATH: `${bin}${delimiter}${isolatedPath()}` }).status).toBe(1);
  });

  it('leaves the original file intact when interrupted before atomic rename', () => {
    const root = temporary();
    const home = join(root, 'home');
    const ours = wrapper(root);
    const config = join(home, '.cursor', 'mcp.json');
    mkdirSync(dirname(config), { recursive: true });
    const original = JSON.stringify({ mcpServers: { another: { command: 'other', args: [] } } });
    writeFileSync(config, original);
    expect(run(home, ours, { COMMITLORE_INSTALLER_TEST_INTERRUPT_WRITE: '1' }).status).toBe(1);
    expect(readFileSync(config, 'utf8')).toBe(original);
  });

  it('exits zero and reports a healthy registration we own', () => {
    const root = temporary();
    const home = join(root, 'home');
    const ours = wrapper(root);
    cursorConfig(home, { command: ours, args: ['mcp'] });
    const result = run(home, ours);
    expect(result.status).toBe(0);
    // Not a literal — that turns every release into a failing test (#680) — and
    // not `toBe(declaredVersion())` either, which reads the same file the code
    // reads and can only agree with itself.
    //
    // The failure this must catch is the identity not finding a manifest at all,
    // which surfaces as the `0.0.0-unknown` fallback rather than as a mismatch.
    expect(result.summary.runtimeIdentity).toMatchObject({ indexSchemaVersion: 4 });
    expect((result.summary.runtimeIdentity as { version: string }).version, 'a runtime that found no manifest reports this').not.toBe(
      '0.0.0-unknown',
    );
    expect((result.summary.runtimeIdentity as { version: string }).version, 'and what it did find is a version').toMatch(
      /^\d+\.\d+\.\d+/,
    );
    expect(result.summary.hosts).toContainEqual(expect.objectContaining({ host: 'cursor', outcome: 'owned', healthy: true }));
  });

  it('exits zero and preserves a healthy custom registration distinctly', () => {
    const root = temporary();
    const home = join(root, 'home');
    const ours = wrapper(root, 'commitlore-ours');
    const custom = wrapper(root, 'operator-wrapper');
    const config = cursorConfig(home, { command: custom, args: ['mcp'] });
    const before = readFileSync(config, 'utf8');
    const result = run(home, ours);
    expect(result.status).toBe(0);
    expect(result.summary.hosts).toContainEqual(expect.objectContaining({ host: 'cursor', outcome: 'custom-preserved', healthy: true }));
    expect(readFileSync(config, 'utf8')).toBe(before);
  });
});

describe('#716 executable search fixtures', () => {
  it.runIf(process.platform !== 'win32')('skips a non-executable command shadow earlier on PATH', () => {
    // Given
    const shadowRoot = temporary();
    const executableRoot = temporary();
    const shadow = wrapper(shadowRoot, 'claude', 0o644);
    const executable = wrapper(executableRoot, 'claude', 0o755);
    const previousPath = process.env['PATH'];
    process.env['PATH'] = `${dirname(shadow)}${delimiter}${dirname(executable)}`;

    // When
    const resolved = (() => {
      try {
        return resolveCommand('claude');
      } finally {
        if (previousPath === undefined) delete process.env['PATH'];
        else process.env['PATH'] = previousPath;
      }
    })();

    // Then
    expect(resolved).toEqual({ path: executable, usesCommandInterpreter: false });
  });
});

describe('platform installer delegation', () => {
  it('makes both platform wrappers forward the same command summary and exit status', () => {
    const shell = readFileSync(join(ROOT, 'install.sh'), 'utf8');
    const powershell = readFileSync(join(ROOT, 'install.ps1'), 'utf8');
    for (const installer of [shell, powershell]) {
      expect(installer).toContain('installer-hosts --wrapper');
      expect(installer).toContain('--data-root');
      expect(installer).toContain('--home');
      expect(installer).toContain('--json');
    }
    expect(shell).toContain('exit "$host_status"');
    expect(powershell).toContain('exit $hostExit');
  });
});

/**
 * The probe writes `initialize` to the child's stdin. A command that is not an
 * MCP server usually proves it by exiting immediately, and then that write
 * lands on a closed pipe. Node delivers EPIPE as an `error` event on the
 * stream; unhandled, it took the whole inspector down, so the installer exited
 * non-zero having reported nothing about any host — strictly worse than the
 * `unhealthy` it was one step from giving.
 *
 * Whether the write or the child's exit wins is a race. It survived on a quiet
 * machine and died under CI load, where it was first seen.
 */
describe('a registration that exits immediately is unhealthy, not a crash', () => {
  const probeAgainst = (command: string, args: string[]) => {
    const home = temporary();
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(
      join(home, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { commitlore: { command, args } } }),
    );
    return spawnSync(
      process.execPath,
      [ENTRY, 'installer-hosts', '--wrapper', join(home, 'wrapper'), '--data-root', home, '--home', home, '--json'],
      { encoding: 'utf8', env: { ...withoutPath(), PATH: isolatedPath(), HOME: home } },
    );
  };

  it('reports a command that exits at once rather than dying on EPIPE', () => {
    const run = probeAgainst(process.execPath, ['-e', 'process.exit(1)']);

    // The inspector must survive and answer. A crash shows up as an empty
    // stdout with a stack on stderr, which is exactly what CI saw.
    expect(run.stderr).not.toContain('EPIPE');
    expect(run.stderr).not.toContain("Unhandled 'error' event");
    expect(run.stdout.trim(), `stderr: ${run.stderr}`).not.toBe('');

    const summary = JSON.parse(run.stdout) as { hosts?: { host: string; healthy?: boolean; detail?: string }[] };
    const cursor = (summary.hosts ?? []).find((entry) => entry.host === 'cursor');
    expect(cursor, JSON.stringify(summary)).toBeDefined();
    expect(cursor?.healthy).toBe(false);
    expect(run.status).not.toBe(0);
  });

  it('does the same for a command that exits successfully but says nothing', () => {
    const run = probeAgainst(process.execPath, ['-e', '']);
    expect(run.stderr).not.toContain('EPIPE');
    expect(run.stdout.trim(), `stderr: ${run.stderr}`).not.toBe('');
    const summary = JSON.parse(run.stdout) as { hosts?: { host: string; healthy?: boolean }[] };
    expect((summary.hosts ?? []).find((entry) => entry.host === 'cursor')?.healthy).toBe(false);
  });

  /**
   * The two cases above depend on the child losing a race, so on a quiet
   * machine they can pass with the handler removed. This one does not: the
   * command closes its own stdin and then stays alive, so the probe's write
   * always lands on a closed pipe while the child is still running. Removing
   * the error handler fails here every time.
   */
  it('survives a command that closes its input and keeps running', () => {
    const home = temporary();
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(
      join(home, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { commitlore: { command: process.execPath, args: ['-e', 'process.stdin.destroy(); setTimeout(() => {}, 2_000);'] } } }),
    );

    const run = spawnSync(
      process.execPath,
      [ENTRY, 'installer-hosts', '--wrapper', join(home, 'wrapper'), '--data-root', home, '--home', home, '--json'],
      { encoding: 'utf8', env: { ...withoutPath(), PATH: isolatedPath(), HOME: home } },
    );

    expect(run.stderr).not.toContain('EPIPE');
    expect(run.stderr).not.toContain("Unhandled 'error' event");
    expect(run.stdout.trim(), `stderr: ${run.stderr}`).not.toBe('');
    const summary = JSON.parse(run.stdout) as { hosts?: { host: string; healthy?: boolean }[] };
    expect((summary.hosts ?? []).find((entry) => entry.host === 'cursor')?.healthy).toBe(false);
  });
});
