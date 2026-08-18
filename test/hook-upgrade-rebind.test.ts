/**
 * #749: after an upgrade, a repository wired before it went on refusing commits
 * under the PATH git actually gives a hook.
 *
 * What held the security property was never the exit code. The `exec` lives in
 * the matching arm only, so a path the containment check refuses is already not
 * executed by the time anything decides what to print — `test/hooks.test.ts`
 * asserts that directly, with a witness file that must not appear. The refusal
 * at the end is the ending for "no CLI could be resolved anywhere", and reusing
 * it for "`current` moved and `root` did not" charged every already-wired
 * repository for an ordinary upgrade.
 *
 * An upgrade is distinguishable by shape. `hooks install` writes `bin` as the
 * literal `<data-root>/current/dist/commitlore.mjs` and `root` as the physical
 * `v<x>` it resolved to; an upgrade moves the installer-owned symlink to a
 * sibling, leaving the recorded string untouched. #71 is the opposite: the
 * string itself is replaced, and a `.git/config` editor can write neither the
 * installer's symlink nor a directory beside its versioned trees.
 *
 * These build that layout rather than describing it, because the property is in
 * shell text that only git runs.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { createTestRepo } from './git-fixtures.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(REPO_ROOT, 'dist', 'commitlore.mjs');
const VALID = 'feat: a change\n\nLimit: something true\nRecord-Id: r-reb001\nProvenance: authored\n';

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-${label}-`));
  scratch.push(dir);
  return dir;
};

/** A `<data-root>` shaped the way `install.sh` shapes one. */
const dataRoot = (versions: string[]): string => {
  const root = temp('rebind-data');
  for (const v of versions) {
    mkdirSync(join(root, v, 'dist'), { recursive: true });
    copyFileSync(BUNDLE, join(root, v, 'dist', 'commitlore.mjs'));
    writeFileSync(
      join(root, v, 'package.json'),
      `${JSON.stringify({ name: 'commitlore', version: v.slice(1), type: 'module' })}\n`,
    );
    symlinkSync(join(REPO_ROOT, 'spec'), join(root, v, 'spec'), 'dir');
  }
  symlinkSync(join(root, versions[0]!), join(root, 'current'), 'dir');
  return root;
};

const wired = (label: string, root: string, pinned: string): string => {
  const dir = createTestRepo({ path: temp(label) });
  execGit(['config', 'user.email', `${label}@example.invalid`], { cwd: dir });
  execGit(['config', 'user.name', label], { cwd: dir });
  execFileSync(process.execPath, [BUNDLE, 'hooks', 'install'], { cwd: dir, shell: false });
  // Rewritten to the installed layout: the source checkout this suite runs from
  // is not one, and the property under test is about that layout.
  execGit(['config', '--local', 'commitlore.bin', join(root, 'current', 'dist', 'commitlore.mjs')], { cwd: dir });
  execGit(['config', '--local', 'commitlore.root', join(root, pinned)], { cwd: dir });
  return dir;
};

const runHook = (cwd: string): { code: number; stderr: string } => {
  const messageFile = join(cwd, 'MESSAGE');
  writeFileSync(messageFile, VALID);
  try {
    execFileSync('sh', [join(cwd, '.git', 'hooks', 'commit-msg'), messageFile], {
      cwd,
      shell: false,
      encoding: 'utf8',
      env: { HOME: process.env.HOME ?? '', PATH: '/usr/bin:/bin' },
    });
    return { code: 0, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { code: failure.status ?? 1, stderr: failure.stderr ?? '' };
  }
};

describe('#749 an upgrade stops charging repositories wired before it', () => {
  it('runs when current and the recorded root are the same tree — the control', () => {
    const root = dataRoot(['v1.0.0']);
    const result = runHook(wired('reb-control', root, 'v1.0.0'));
    expect(result.stderr, `the control could not run at all: ${result.stderr}`).not.toMatch(
      /cannot find the CLI|points outside/,
    );
  }, 60_000);

  it('runs after current moved to a sibling, with the root left behind', () => {
    // The whole point. Before this, the recorded pair stopped matching and the
    // commit was refused under a restricted PATH until somebody re-ran
    // `hooks install` in that repository.
    const root = dataRoot(['v1.0.0', 'v1.1.0']);
    const dir = wired('reb-upgrade', root, 'v1.0.0');
    rmSync(join(root, 'current'));
    symlinkSync(join(root, 'v1.1.0'), join(root, 'current'), 'dir');

    const result = runHook(dir);
    expect(result.stderr).not.toMatch(/points outside the install/);
    expect(result.stderr).not.toMatch(/cannot find the CLI/);
  }, 60_000);

  it('still refuses a recorded path outside the install, and does not run it', () => {
    // #71, unchanged. The rebind is bound to the string `hooks install` writes
    // and to the installer's layout; a planted path is neither.
    const root = dataRoot(['v1.0.0']);
    const dir = wired('reb-attack', root, 'v1.0.0');
    const outside = temp('reb-outside');
    const witness = join(outside, 'ran.log');
    const evil = join(outside, 'evil.js');
    writeFileSync(evil, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(witness)}, 'ran');\n`);
    execGit(['config', '--local', 'commitlore.bin', evil], { cwd: dir });

    const result = runHook(dir);
    expect(result.stderr).toMatch(/points outside the install/);
    expect(existsSync(witness), 'the planted file was executed').toBe(false);
  }, 60_000);

  it('refuses a planted directory that imitates the layout', () => {
    // The rejected weaker rule, kept as a test so it cannot be reintroduced:
    // "follow `current` wherever bin points" is satisfied by a `current`
    // somebody else created. The recorded root has to be a sibling of what the
    // installer's `current` resolves to.
    const root = dataRoot(['v1.0.0']);
    const dir = wired('reb-imitate', root, 'v1.0.0');
    const fake = temp('reb-fake');
    mkdirSync(join(fake, 'v9.9.9', 'dist'), { recursive: true });
    copyFileSync(BUNDLE, join(fake, 'v9.9.9', 'dist', 'commitlore.mjs'));
    symlinkSync(join(fake, 'v9.9.9'), join(fake, 'current'), 'dir');
    execGit(['config', '--local', 'commitlore.bin', join(fake, 'current', 'dist', 'commitlore.mjs')], { cwd: dir });

    expect(runHook(dir).stderr).toMatch(/points outside the install/);
  }, 60_000);
});
