/**
 * Exercises the built artifact (`dist/cli.js`, the package's `bin` target)
 * rather than the sources, so shebang, ESM resolution, and the
 * `spec/schema/` lookup from `dist/` are all covered as shipped.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadFixtures } from './fixtures.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
let CLI = '';
let SCHEMA_MODULE = '';
let harness = '';

const runCli = (args: string[], stdin = '') =>
  spawnSync(process.execPath, [CLI, ...args], {
    shell: false,
    encoding: 'utf8',
    cwd: PACKAGE_ROOT,
    input: stdin,
  });

beforeAll(() => {
  harness = mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-cli-dist-'));
  CLI = join(harness, 'dist', 'cli.js');
  SCHEMA_MODULE = join(harness, 'dist', 'core', 'schema.js');
  symlinkSync(join(PACKAGE_ROOT, 'node_modules'), join(harness, 'node_modules'), 'dir');
  symlinkSync(join(PACKAGE_ROOT, 'spec'), join(harness, 'spec'), 'dir');
  symlinkSync(join(PACKAGE_ROOT, 'package.json'), join(harness, 'package.json'));

  const build = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json', '--outDir', join(harness, 'dist')], {
    shell: false,
    encoding: 'utf8',
    cwd: PACKAGE_ROOT,
  });
  if (build.status !== 0) {
    throw new Error(`tsc build failed (exit ${build.status}):\n${build.stdout}${build.stderr}`);
  }
}, 120_000);

afterAll(() => {
  if (harness !== '') rmSync(harness, { recursive: true, force: true });
});

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
    'ruled-out', 'warnings', 'stale', 'doctor', 'init', 'harvest',
    'harvest-verify', 'squash-preserve', 'guard', 'mcp', 'inject', 'backfill',
    'auto',
  ];
  const UNLANDED: string[] = [];

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

  it('says that query commands follow renames only for one path', () => {
    const result = runCli(['context', '--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/renames follow only when\s+one path is\s+given/);
  });

  // 0 clean, 1 the check found something, 2 the invocation was wrong. Hooks and
  // CI branch on these, and commander's own parse failures default to 1 --
  // which would make a typo'd flag indistinguishable from a real finding.
  it.each([
    { args: ['--help'], code: 0, what: 'help' },
    { args: ['--version'], code: 0, what: 'version' },
    { args: ['validate', '--help'], code: 0, what: 'subcommand help' },
    { args: ['definitely-not-a-command'], code: 2, what: 'unknown command' },
    { args: ['validate', '--definitely-not-a-flag'], code: 2, what: 'unknown flag' },
    { args: ['context', '--definitely-not-a-flag'], code: 2, what: 'unknown flag on another subcommand' },
  ])('exits $code on $what', ({ args, code }) => {
    expect(runCli(args).status).toBe(code);
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
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('commitlore:');
    expect(result.stderr).not.toContain('at Object.');
  });

  // bug-issue-89: `parse` used to show only the message's own last paragraph
  // (git interpret-trailers's B1 behavior) even after #86 taught `context` and
  // `validate` to recognize every block a message carries (SPEC §2.4). These
  // reproduce the exact shape GitHub's squash button produces.
  describe('parse and multi-record messages (bug-issue-89)', () => {
    const ghSquashMessage =
      'Feat (#1)\n\n* change 1\n\nLimit: only a test 1\nRecord-Id: r-ghtest1\n\n' +
      '* change 2\n\nLimit: only a test 2\nRecord-Id: r-ghtest2\n';

    it('reports every record block, not only the message\'s own last paragraph', () => {
      const result = runCli(['parse'], ghSquashMessage);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('r-ghtest1');
      expect(result.stdout).toContain('r-ghtest2');
    });

    it('marks exactly one block own — the message\'s own last paragraph — and the rest earlier', () => {
      const result = runCli(['parse', '--json'], ghSquashMessage);
      const parsed = JSON.parse(result.stdout) as {
        blocks: { own: boolean; trailers: { key: string; value: string }[] }[];
      };
      expect(parsed.blocks.map((block) => block.own)).toEqual([false, true]);
      expect(parsed.blocks[1]?.trailers.find((t) => t.key === 'Record-Id')?.value).toBe(
        'r-ghtest2',
      );
    });

    it('--json keeps `trailers` as the message\'s own block, unchanged in meaning', () => {
      const result = runCli(['parse', '--json'], ghSquashMessage);
      const parsed = JSON.parse(result.stdout) as { trailers: { key: string; value: string }[] };
      expect(parsed.trailers.find((t) => t.key === 'Record-Id')?.value).toBe('r-ghtest2');
    });

    it('a single-record message is completely unaffected (byte-identical text output)', () => {
      const before = runCli(['parse'], 'Subject\n\nBlast: local\nLimit: only 3 workers\n');
      expect(before.stdout).toBe('Limit: only 3 workers\nBlast: local\n');
      expect(before.stderr).toBe('');
    });

    it('a single-record message is completely unaffected (byte-identical --json output)', () => {
      const result = runCli(['parse', '--json'], 'Subject\n\nUndo: costly\n');
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ trailers: [{ key: 'Undo', value: 'costly' }] });
    });

    it('flags two blocks that declare the same Record-Id, on stdout and stderr', () => {
      const dup =
        'Feat (#2)\n\n* change 1\n\nLimit: only a test 1\nRecord-Id: r-dupdup\n\n' +
        '* change 2\n\nLimit: only a test 2\nRecord-Id: r-dupdup\n';
      const result = runCli(['parse'], dup);
      expect(result.status).toBe(0);
      expect(result.stderr).toContain('r-dupdup');
      expect(result.stderr).toContain('more than one record block');
      expect(result.stdout).toContain('collision');
    });

    it('flags the same collision in --json, per block', () => {
      const dup =
        'Feat (#2)\n\n* change 1\n\nLimit: only a test 1\nRecord-Id: r-dupdup\n\n' +
        '* change 2\n\nLimit: only a test 2\nRecord-Id: r-dupdup\n';
      const result = runCli(['parse', '--json'], dup);
      const parsed = JSON.parse(result.stdout) as { blocks: { identityCollision: boolean }[] };
      expect(parsed.blocks.every((block) => block.identityCollision)).toBe(true);
    });

    it('does not flag a collision when two blocks declare different Record-Ids', () => {
      const result = runCli(['parse'], ghSquashMessage);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain('collision');
    });
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
