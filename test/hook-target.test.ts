/**
 * Unit coverage for `core/hook-target.ts`'s pure classification and
 * containment logic — the TypeScript mirror `doctor` reads to report what the
 * shell stub (`src/hooks/commit-msg.ts`) will actually do, restated here
 * without a real subprocess so the two extension/name branches (`script`,
 * `binary`, #39) and the containment rules around them are checked directly.
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
    ['/usr/local/bin/commitlore', 'binary'],
    ['commitlore', 'binary'],
    ['./dist/commitlore', 'binary'],
  ] as const)('classifies %s as %s', (path, kind) => {
    expect(classifyBinTarget(path)).toBe(kind);
  });

  it.each([
    // Not merely "no extension" — a name check. Otherwise every other
    // executable on the machine would allow-list itself the moment it lost
    // the `.js`/`.mjs` check.
    '/path/to/not-commitlore',
    '/path/to/commitlore-old',
    '/path/to/commitlorevariant',
    // Windows SEA output (`commitlore.exe`) is not built or tested by this
    // project yet (ADR-0015) — recognizing the name here without a build or a
    // CI job behind it would be an unverifiable claim.
    '/path/to/commitlore.exe',
    '',
  ])('does not classify %s as a script or a binary', (path) => {
    expect(classifyBinTarget(path)).toBeNull();
  });

  it('agrees with hasAllowedBinExtension', () => {
    expect(hasAllowedBinExtension('/x/cli.mjs')).toBe(true);
    expect(hasAllowedBinExtension('/x/commitlore')).toBe(true);
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

  it('reports a healthy binary install with no problems', () => {
    const cwd = repo();
    // A symlink named `commitlore` resolving to the running interpreter: not
    // a real compiled binary, but `readRecordedHookTarget` only ever compares
    // resolved paths, so a symlink whose target realpath matches
    // `process.execPath` is indistinguishable from "this is what is running"
    // for this check — the same fact `scripts/build-binary.mjs`'s output
    // would report about itself.
    const dir = tempDir('binary-match');
    const binaryPath = join(dir, 'commitlore');
    symlinkSync(process.execPath, binaryPath);
    setConfig(cwd, 'commitlore.bin', binaryPath);
    setConfig(cwd, 'commitlore.node', process.execPath);
    setConfig(cwd, 'commitlore.root', realpathSync(binaryPath));

    const target = readRecordedHookTarget(cwd);
    expect(target.problems).toEqual([]);
  });

  it('reports a problem when the recorded binary is not the running one', () => {
    const cwd = repo();
    const dir = tempDir('binary-mismatch');
    const binaryPath = join(dir, 'commitlore');
    writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n');
    chmodSync(binaryPath, 0o755);
    setConfig(cwd, 'commitlore.bin', binaryPath);
    setConfig(cwd, 'commitlore.node', process.execPath);
    setConfig(cwd, 'commitlore.root', realpathSync(binaryPath));

    const target = readRecordedHookTarget(cwd);
    expect(target.problems).toContain('commitlore.bin is outside this package root');
  });

  it('reports a problem when a binary-named commitlore.bin is not executable', () => {
    const cwd = repo();
    const dir = tempDir('binary-not-exec');
    const binaryPath = join(dir, 'commitlore');
    writeFileSync(binaryPath, 'not executable\n');
    setConfig(cwd, 'commitlore.bin', binaryPath);
    setConfig(cwd, 'commitlore.node', process.execPath);
    setConfig(cwd, 'commitlore.root', realpathSync(binaryPath));

    const target = readRecordedHookTarget(cwd);
    expect(target.problems).toContain('commitlore.bin is not an executable file');
  });

  it('reports a problem for a recorded path that is neither a script nor a recognized binary', () => {
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
      'commitlore.bin is not a .js, .mjs, or compiled commitlore binary',
    );
  });
});
