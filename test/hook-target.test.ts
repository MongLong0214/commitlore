/**
 * Unit coverage for `core/hook-target.ts`'s pure classification and
 * containment logic — the TypeScript mirror `doctor` reads to report what the
 * shell stub (`src/hooks/commit-msg.ts`) will actually do, restated here
 * without a real subprocess so the one recognized branch (`script`) and the
 * containment rules around it are checked directly. ADR-0026 removed the compiled
 * build, so an extensionless name is refused rather than classified.
 * `test/hooks.test.ts` covers the same rules end to end, through a real
 * `/bin/sh` execution of the shipped stub.
 */

import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { classifyBinTarget, hasAllowedBinExtension, readRecordedHookTarget } from '../src/core/hook-target.js';
import { createTestRepo } from './git-fixtures.js';

describe('classifyBinTarget', () => {
  it.each([
    ['/path/to/cli.js', 'script'],
    ['/path/to/cli.mjs', 'script'],
    ['cli.js', 'script'],
  ] as const)('classifies %s as %s', (path, kind) => {
    expect(classifyBinTarget(path)).toBe(kind);
  });

  it.each([
    // The installer's wrapper carries this name, and a wrapper is a shell script
    // that execs node rather than an interpreter of its own -- so the path worth
    // recording is the bundle it runs. Refusing the name also closes what the
    // compiled arm had to guard by hand: any extensionless executable that
    // happened to be called `commitlore`.
    '/usr/local/bin/commitlore',
    'commitlore',
    './dist/commitlore',
    '/path/to/not-commitlore',
    '/path/to/commitlore-old',
    '/path/to/commitlorevariant',
    '/path/to/commitlore.exe',
    '',
  ])('does not classify %s as anything runnable', (path) => {
    expect(classifyBinTarget(path)).toBeNull();
  });

  it('agrees with hasAllowedBinExtension', () => {
    expect(hasAllowedBinExtension('/x/cli.mjs')).toBe(true);
    expect(hasAllowedBinExtension('/x/commitlore')).toBe(false);
    expect(hasAllowedBinExtension('/x/evil.sh')).toBe(false);
  });
});

describe('readRecordedHookTarget', () => {
  const scratch: string[] = [];
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  const tempDir = (label: string): string => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-hook-target-${label}-`));
    scratch.push(dir);
    return dir;
  };

  const repo = (): string => createTestRepo({ path: tempDir('repo') });

  const setConfig = (cwd: string, key: string, value: string): void => {
    const result = execGit(['config', '--local', key, value], { cwd });
    if (result.code !== 0) throw new Error(`git config ${key} failed: ${result.stderr}`);
  };

  it('refuses an extensionless commitlore, whatever it resolves to', () => {
    // Three cases used to be three outcomes: the running binary was accepted, a
    // different one was contained out, a non-executable one was reported. With no
    // compiled artifact to be, all three are the same refusal -- and the refusal
    // is the stricter answer, since the wrapper on PATH carries exactly this name.
    const cwd = repo();
    const dir = tempDir('extensionless');
    const wrapperLike = join(dir, 'commitlore');
    symlinkSync(process.execPath, wrapperLike);
    setConfig(cwd, 'commitlore.bin', wrapperLike);
    setConfig(cwd, 'commitlore.node', process.execPath);
    setConfig(cwd, 'commitlore.root', realpathSync(wrapperLike));

    expect(readRecordedHookTarget(cwd).problems).toContain(
      'commitlore.bin is not a .js or .mjs file',
    );
  });

  it('reports a problem for a recorded path that is not a script', () => {
    const cwd = repo();
    const dir = tempDir('unrecognized');
    const evil = join(dir, 'not-commitlore');
    writeFileSync(evil, '#!/bin/sh\nexit 0\n');
    chmodSync(evil, 0o755);
    setConfig(cwd, 'commitlore.bin', evil);
    setConfig(cwd, 'commitlore.node', process.execPath);
    setConfig(cwd, 'commitlore.root', realpathSync(dir));

    const target = readRecordedHookTarget(cwd);
    expect(target.problems).toContain(
      'commitlore.bin is not a .js or .mjs file',
    );
  });
});
