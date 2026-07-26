/**
 * Exercises the built artifact (`dist/cli.js`, the package's `bin` target)
 * rather than the sources, so shebang, ESM resolution, and the
 * `spec/schema/` lookup from `dist/` are all covered as shipped.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadFixtures } from './fixtures.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const SCHEMA_MODULE = fileURLToPath(new URL('../dist/core/schema.js', import.meta.url));

const runCli = (args: string[], stdin = '') =>
  spawnSync(process.execPath, [CLI, ...args], {
    shell: false,
    encoding: 'utf8',
    cwd: PACKAGE_ROOT,
    input: stdin,
  });

beforeAll(() => {
  const build = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], {
    shell: false,
    encoding: 'utf8',
    cwd: PACKAGE_ROOT,
  });
  if (build.status !== 0) {
    throw new Error(`tsc build failed (exit ${build.status}):\n${build.stdout}${build.stderr}`);
  }
}, 120_000);

describe('commitlore CLI', () => {
  it('starts with a node shebang', () => {
    expect(readFileSync(CLI, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  // The point of these two is that the CLI advertises exactly what it can do.
  // A command listed before it exists sends users down a dead end; a command
  // that works but is unlisted is undiscoverable. Move a name from UNLANDED to
  // LANDED in the same change that wires it into src/cli.ts.
  const LANDED = [
    'parse', 'validate', 'hooks', 'index', 'context', 'limits',
    'ruled-out', 'warnings', 'stale', 'doctor', 'harvest',
    'harvest-verify', 'squash-preserve', 'guard', 'mcp', 'inject',
  ];
  const UNLANDED = ['backfill'];

  it('names itself commitlore and lists every landed command', () => {
    const result = runCli(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('commitlore');
    for (const command of LANDED) {
      expect(result.stdout, `${command} should be listed`).toContain(`  ${command} `);
    }
  });

  it('does not advertise commands that have not landed', () => {
    const result = runCli(['--help']);
    for (const command of UNLANDED) {
      expect(result.stdout, `${command} is not implemented yet`).not.toContain(`  ${command} `);
    }
  });

  it('rejects a command that does not exist', () => {
    const result = runCli(['definitely-not-a-command']);
    expect(result.status).not.toBe(0);
  });

  it('parses a message from stdin into a canonical block', () => {
    const result = runCli(['parse'], 'Subject\n\nBlast: local\nLimit: only 3 workers\n');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('Limit: only 3 workers\nBlast: local\n');
  });

  it('parses a message from --message-file', () => {
    const fixture = loadFixtures('valid').find((entry) => entry.name === '02-full-vocabulary');
    expect(fixture).toBeDefined();
    const result = runCli(['parse', '--message-file', fixture?.txtPath ?? '']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(fixture?.expected.canonical);
  });

  it('emits the parsed trailers as JSON under --json', () => {
    const result = runCli(['parse', '--json'], 'Subject\n\nUndo: costly\n');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ trailers: [{ key: 'Undo', value: 'costly' }] });
  });

  it('succeeds with no output on a message that has no trailers (SPEC §2.1 B7)', () => {
    const fixture = loadFixtures('boundary').find(
      (entry) => entry.name === 'b7-no-trailer-paragraph',
    );
    const result = runCli(['parse', '--message-file', fixture?.txtPath ?? '']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('fails with a message, not a stack trace, on an unreadable file', () => {
    const result = runCli(['parse', '--message-file', 'no/such/message.txt']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('commitlore:');
    expect(result.stderr).not.toContain('at Object.');
  });

  it('resolves spec/schema/record.schema.json from the built dist/ layout', () => {
    const probe = [
      `const { validateRecord } = await import(${JSON.stringify(SCHEMA_MODULE)});`,
      "process.stdout.write(JSON.stringify(validateRecord([{ key: 'Blast', value: 'wide' }])));",
    ].join('');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      shell: false,
      encoding: 'utf8',
      // Run from outside the package so nothing resolves by chance via cwd.
      cwd: '/',
    });
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual([
      { key: 'Blast', value: 'wide', rule: 'enum', got: 'wide', want: 'local|module|system' },
    ]);
  });
});
