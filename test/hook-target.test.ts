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

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { classifyBinTarget, hasAllowedBinExtension, readRecordedHookTarget } from '../src/core/hook-target.js';
import { packageVersion } from '../src/core/paths.js';
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

/**
 * #382: the recorded pin is a version as well as a path.
 *
 * `hooks install` records the install it ran from; a later upgrade installs
 * elsewhere and never comes back to rewrite it. The pinned build is the one
 * that validates every commit, so "which version is pinned" is part of what
 * this mirror owes its two readers (`doctor`, `hooks status`) — and an answer
 * it cannot establish is not the same as no problem.
 */
describe('#382 the recorded pin carries a version', () => {
  const scratch: string[] = [];
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });
  const tempDir = (label: string): string => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-pin-${label}-`));
    scratch.push(dir);
    return dir;
  };
  const setConfig = (cwd: string, key: string, value: string): void => {
    const result = execGit(['config', '--local', key, value], { cwd });
    if (result.code !== 0) throw new Error(`git config ${key} failed: ${result.stderr}`);
  };

  /** A package root of its own, the shape a second install leaves on disk. */
  const pinnedInstall = (label: string, version: string | null): string => {
    const root = tempDir(label);
    if (version !== null) {
      writeFileSync(
        join(root, 'package.json'),
        `${JSON.stringify({ name: 'commitlore', version, type: 'module' })}\n`,
      );
    }
    mkdirSync(join(root, 'dist'), { recursive: true });
    const bin = join(root, 'dist', 'commitlore.mjs');
    writeFileSync(bin, 'export {};\n');
    return bin;
  };

  const pinnedProblems = (label: string, version: string | null): readonly string[] => {
    const cwd = createTestRepo({ path: tempDir(`${label}-repo`) });
    const bin = pinnedInstall(label, version);
    setConfig(cwd, 'commitlore.bin', bin);
    setConfig(cwd, 'commitlore.node', process.execPath);
    setConfig(cwd, 'commitlore.root', realpathSync(dirname(dirname(bin))));
    return readRecordedHookTarget(cwd).problems;
  };

  it('reports a pin left behind by an upgrade, naming both versions', () => {
    const problems = pinnedProblems('skew', '0.5.0').join('\n');
    expect(problems).toContain('0.5.0');
    expect(problems).toContain(packageVersion());
  });

  it('reports nothing extra when the pinned install is the running version', () => {
    expect(pinnedProblems('same', packageVersion())).toEqual([]);
  });

  it('reports an undeterminable pin rather than passing it', () => {
    const problems = pinnedProblems('unknown', null).join('\n');
    expect(problems).not.toBe('');
    expect(problems).toContain('version');
  });
});

/**
 * T-1127 (#321): `doctor` reads this module to report what the shell stub will
 * do. On Windows the stub could not run anything at all while this mirror
 * reported no problem, because the two were not looking at the same thing: the
 * stub compares the recorded path against the recorded `commitlore.root`, and
 * this compared it against the root of whichever CLI happened to be running.
 *
 * A mirror that is green while the hook is dead is worse than no mirror, so the
 * two facts it got wrong are asserted here.
 */
describe('T-1127 the mirror checks what the stub checks', () => {
  const scratch: string[] = [];
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });
  const tempDir = (label: string): string => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-t1127-${label}-`));
    scratch.push(dir);
    return dir;
  };
  const setConfig = (cwd: string, key: string, value: string): void => {
    const result = execGit(['config', '--local', key, value], { cwd });
    if (result.code !== 0) throw new Error(`git config ${key} failed: ${result.stderr}`);
  };

  it('reports a recorded bundle that sits outside the recorded root', () => {
    // The stub trusts `commitlore.root`, so a bin outside it is refused there.
    // This mirror trusted its own package root instead, which is a different
    // question and answered "fine" for a hook that would refuse.
    const cwd = createTestRepo({ path: tempDir('repo') });
    const elsewhere = tempDir('elsewhere');
    const bin = join(elsewhere, 'cli.mjs');
    writeFileSync(bin, 'export {};\n');
    setConfig(cwd, 'commitlore.bin', bin);
    setConfig(cwd, 'commitlore.node', process.execPath);
    setConfig(cwd, 'commitlore.root', realpathSync(tempDir('root')));

    expect(readRecordedHookTarget(cwd).problems).toContain(
      'commitlore.bin is outside this package root',
    );
  });

  it('accepts a recorded bundle inside the recorded root', () => {
    const cwd = createTestRepo({ path: tempDir('repo-ok') });
    const root = tempDir('root-ok');
    const bin = join(root, 'cli.mjs');
    writeFileSync(bin, 'export {};\n');
    setConfig(cwd, 'commitlore.bin', bin);
    setConfig(cwd, 'commitlore.node', process.execPath);
    setConfig(cwd, 'commitlore.root', realpathSync(root));

    expect(readRecordedHookTarget(cwd).problems).not.toContain(
      'commitlore.bin is outside this package root',
    );
  });

  it('reports a recorded bundle that is a symlink, which the stub refuses outright', () => {
    const root = tempDir('root-link');
    const cwd = createTestRepo({ path: tempDir('repo-link') });
    const real = join(tempDir('target'), 'cli.mjs');
    writeFileSync(real, 'export {};\n');
    const link = join(root, 'cli.mjs');
    symlinkSync(real, link);
    setConfig(cwd, 'commitlore.bin', link);
    setConfig(cwd, 'commitlore.node', process.execPath);
    setConfig(cwd, 'commitlore.root', realpathSync(root));

    expect(readRecordedHookTarget(cwd).problems).toContain('commitlore.bin is a symlink');
  });
});
