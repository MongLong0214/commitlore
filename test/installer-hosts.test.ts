/** R0-04 (#595) — host health is a protocol result, never a text match. */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

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
  summary: { schema: string; ok: boolean; hosts: Array<{ host: string; outcome: string; healthy: boolean }> };
}

const wrapper = (root: string, name = 'commitlore'): string => {
  const path = join(root, 'bin', name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(ENTRY)} "$@"\n`);
  chmodSync(path, 0o755);
  return path;
};

const run = (home: string, ownWrapper: string, env: Record<string, string> = {}): Run => {
  const result = spawnSync(process.execPath, [ENTRY, 'installer-hosts', '--wrapper', ownWrapper, '--data-root', join(home, 'data'), '--home', home, '--json'], {
    encoding: 'utf8',
    // Isolate host detection from the developer machine. Individual tests add
    // the host CLI they intend to exercise.
    env: { ...process.env, PATH: '/usr/bin:/bin', ...env },
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
    writeFileSync(codex, '#!/bin/sh\nexit 1\n');
    chmodSync(codex, 0o755);
    expect(run(home, ours, { PATH: `${bin}:/usr/bin:/bin` }).status).toBe(1);
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
