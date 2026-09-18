/**
 * The consideration binding: "this tree was considered", separate from "a
 * capture is staged".
 *
 * The cases below are mostly negative on purpose. A binding is only worth
 * having if it stops applying the moment the thing it describes changes, so
 * what needs proving is not that it covers its own tree — that is one line —
 * but that each of the four ways it can go stale is detected, and detected
 * distinguishably. A single boolean would pass every one of these by accident.
 *
 * The clock is injected everywhere. `CONSIDERATION_EXPIRY_MINUTES` is five, and
 * a test that waited for it would take five minutes and still prove nothing
 * about the boundary.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { POLICY_FILE_NAME } from '../src/core/capture-policy.js';
import {
  CONSIDERATION_EXPIRY_MINUTES,
  clearConsideration,
  considerationPath,
  considerationVerdict,
  currentBinding,
  readConsideration,
  writeConsideration,
} from '../src/core/commit-consideration.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-consider-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A repository with one commit and something staged on top of it. */
const repoWithStagedChange = (label: string): string => {
  const repo = createTestRepo({ path: tempDir(label) });
  writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
  git(repo, ['add', 'a.ts']);
  git(repo, ['commit', '--quiet', '--no-verify', '-m', 'feat: a']);
  writeFileSync(join(repo, 'a.ts'), 'export const a = 2;\n');
  git(repo, ['add', 'a.ts']);
  return repo;
};

const T0 = new Date('2026-01-01T00:00:00.000Z');
const plusMinutes = (from: Date, minutes: number): Date =>
  new Date(from.getTime() + minutes * 60_000);

describe('a consideration covers the tree it was written for', () => {
  it('records the outcome and the count, and reads back covering that tree', () => {
    const repo = repoWithStagedChange('covers');

    const written = writeConsideration({ cwd: repo, outcome: 'empty', records: 0, now: T0 });

    expect(written?.outcome).toBe('empty');
    expect(written?.records).toBe(0);
    expect(written?.head).toMatch(/^[0-9a-f]{40}$/);

    const verdict = considerationVerdict(repo, T0);
    expect(verdict.covered).toBe(true);
  });

  it('`empty` and `recorded` are both complete answers, and are distinguishable', () => {
    const repo = repoWithStagedChange('outcomes');

    writeConsideration({ cwd: repo, outcome: 'recorded', records: 2, now: T0 });
    const stored = readConsideration(repo);

    expect(stored?.outcome).toBe('recorded');
    expect(stored?.records).toBe(2);
    expect(considerationVerdict(repo, T0).covered).toBe(true);
  });

  it('lives under the git directory, so it is never a file anyone can commit', () => {
    const repo = repoWithStagedChange('location');
    writeConsideration({ cwd: repo, outcome: 'empty', records: 0, now: T0 });

    const path = considerationPath(repo);
    expect(path).toContain('.git/');
    expect(git(repo, ['status', '--porcelain'])).not.toContain('considered.json');
  });
});

describe('a consideration stops covering the moment its tree does', () => {
  it('a commit moves HEAD, so no binding outlives the commit it was made for', () => {
    const repo = repoWithStagedChange('head-moved');
    writeConsideration({ cwd: repo, outcome: 'empty', records: 0, now: T0 });
    expect(considerationVerdict(repo, T0).covered).toBe(true);

    git(repo, ['commit', '--quiet', '--no-verify', '-m', 'feat: b']);

    const verdict = considerationVerdict(repo, T0);
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.gap).toBe('head-moved');
  });

  it('staging anything else changes the diff, and the gap says so specifically', () => {
    const repo = repoWithStagedChange('diff-changed');
    writeConsideration({ cwd: repo, outcome: 'empty', records: 0, now: T0 });

    writeFileSync(join(repo, 'b.ts'), 'export const b = 1;\n');
    git(repo, ['add', 'b.ts']);

    const verdict = considerationVerdict(repo, T0);
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.gap).toBe('staged-diff-changed');
  });

  it('un-staging back to the identical content is the same tree, and still covers', () => {
    // The control for the case above: the binding is keyed to what the diff
    // *is*, not to how many times the index was touched. A key that drifted to
    // something mutation-counting would fail here and pass everything else.
    const repo = repoWithStagedChange('same-content');
    writeConsideration({ cwd: repo, outcome: 'empty', records: 0, now: T0 });

    writeFileSync(join(repo, 'b.ts'), 'export const b = 1;\n');
    git(repo, ['add', 'b.ts']);
    git(repo, ['rm', '--cached', '--quiet', 'b.ts']);
    rmSync(join(repo, 'b.ts'));

    expect(considerationVerdict(repo, T0).covered).toBe(true);
  });

  it('changing the policy invalidates it, because the rules it ran under are gone', () => {
    const repo = repoWithStagedChange('policy-changed');
    writeConsideration({ cwd: repo, outcome: 'empty', records: 0, now: T0 });

    writeFileSync(
      join(repo, POLICY_FILE_NAME),
      `${JSON.stringify({ mode: 'suggest', unattended: false }, null, 2)}\n`,
    );

    const verdict = considerationVerdict(repo, T0);
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.gap).toBe('policy-changed');
  });

  it('expires on the injected clock, and the boundary is closed on the inside', () => {
    const repo = repoWithStagedChange('expiry');
    writeConsideration({ cwd: repo, outcome: 'empty', records: 0, now: T0 });

    expect(considerationVerdict(repo, plusMinutes(T0, CONSIDERATION_EXPIRY_MINUTES)).covered).toBe(true);

    const after = considerationVerdict(repo, new Date(T0.getTime() + CONSIDERATION_EXPIRY_MINUTES * 60_000 + 1));
    expect(after.covered).toBe(false);
    expect(after.covered === false && after.gap).toBe('expired');
  });
});

describe('a consideration that cannot be trusted is not one', () => {
  it('absent reads as absent, not as covered', () => {
    const repo = repoWithStagedChange('absent');
    const verdict = considerationVerdict(repo, T0);
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.gap).toBe('none');
  });

  it('corrupt bytes are treated as absent rather than parsed optimistically', () => {
    const repo = repoWithStagedChange('corrupt');
    writeConsideration({ cwd: repo, outcome: 'empty', records: 0, now: T0 });
    writeFileSync(considerationPath(repo) as string, '{ this is not json');

    const verdict = considerationVerdict(repo, T0);
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.gap).toBe('unreadable');
  });

  it('a version this build does not know is refused, not read field by field', () => {
    const repo = repoWithStagedChange('version');
    writeConsideration({ cwd: repo, outcome: 'empty', records: 0, now: T0 });
    const path = considerationPath(repo) as string;
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...stored, version: 99 }));

    expect(considerationVerdict(repo, T0).covered).toBe(false);
  });

  it('clearing it leaves nothing to honour, and clearing twice is not an error', () => {
    const repo = repoWithStagedChange('clear');
    writeConsideration({ cwd: repo, outcome: 'empty', records: 0, now: T0 });

    clearConsideration(repo);
    expect(considerationVerdict(repo, T0).covered).toBe(false);
    expect(() => {
      clearConsideration(repo);
    }).not.toThrow();
  });
});

describe('the shapes a repository can be in', () => {
  it('an unborn branch binds with a null head rather than failing', () => {
    const repo = tempDir('unborn');
    git(repo, ['init', '--quiet', '--initial-branch=main', '.']);
    git(repo, ['config', 'user.email', 't@e.invalid']);
    git(repo, ['config', 'user.name', 't']);
    writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
    git(repo, ['add', 'a.ts']);

    const binding = currentBinding(repo);
    expect(binding.head).toBeNull();

    const written = writeConsideration({ cwd: repo, outcome: 'empty', records: 0, now: T0 });
    expect(written?.head).toBeNull();
    expect(considerationVerdict(repo, T0).covered).toBe(true);

    // And the first commit still moves it, the way every later commit does.
    git(repo, ['commit', '--quiet', '--no-verify', '-m', 'feat: first']);
    const verdict = considerationVerdict(repo, T0);
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.gap).toBe('head-moved');
  });

  it('a linked worktree keeps its own, and does not read the main checkout’s', () => {
    const repo = repoWithStagedChange('worktree-main');
    const linked = join(tempDir('worktree-linked'), 'wt');
    git(repo, ['worktree', 'add', '--quiet', '-b', 'side', linked]);

    writeConsideration({ cwd: repo, outcome: 'recorded', records: 3, now: T0 });

    expect(considerationPath(linked)).not.toBe(considerationPath(repo));
    expect(readConsideration(linked)).toBeNull();
    expect(readConsideration(repo)?.records).toBe(3);

    git(repo, ['worktree', 'remove', '--force', linked]);
  });

  it('outside a repository there is nothing to bind to', () => {
    const plain = tempDir('not-a-repo');
    expect(considerationPath(plain)).toBeNull();
    expect(writeConsideration({ cwd: plain, outcome: 'empty', records: 0, now: T0 })).toBeNull();
    expect(readConsideration(plain)).toBeNull();
  });
});
