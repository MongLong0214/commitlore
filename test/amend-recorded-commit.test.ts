/**
 * #430: a commit carrying a record could never be amended.
 *
 * At `commit-msg` time during an amend, HEAD is still the commit being
 * replaced. The id group holds HEAD's record and the incoming one —
 * byte-identical — and `findIdCollisions` fired on the **count** of
 * commit-sourced records without ever comparing their content.
 *
 * That is stricter than the spec it implements. SPEC §3.2:
 *
 *   A `Record-Id` MUST resolve to exactly one logical record. Re-declaring
 *   that record in later commits is a lifecycle update … A note MUST NOT add
 *   or replace content under an id declared by a commit message; that is an
 *   identity collision, not an update.
 *
 * and §6's own example of the violation: *"A note adds **different content**
 * under a `Record-Id` already declared by a commit."*
 *
 * So a collision is about divergent payloads, and an amend's re-declaration is
 * byte-identical by construction. No hook needs to know it is an amend.
 *
 * The cases below drive real `git commit --amend`, because the failure only
 * exists when git runs the gate against a repository where both commits are
 * momentarily present.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { findIdCollisions } from '../src/core/stale.js';
import { createTestRepo } from './git-fixtures.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(REPO_ROOT, 'dist', 'commitlore.mjs');

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[]): string => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout;
};

/** Runs git and returns the outcome instead of throwing, so a refusal is data. */
const tryGit = (cwd: string, args: string[]): { code: number; stderr: string } => {
  const result = execGit(args, { cwd });
  return { code: result.code, stderr: result.stderr };
};

const RECORD = [
  'Limit: the v1 runtime has no network egress outside the app subnet',
  'Record-Id: r-amend01',
  'Provenance: authored',
].join('\n');

/** A repository with the gate installed and one recorded commit. */
const recordedRepo = (label: string): string => {
  const dir = createTestRepo({ path: temp(label) });
  git(dir, ['config', 'user.email', `${label}@example.invalid`]);
  git(dir, ['config', 'user.name', label]);
  writeFileSync(join(dir, 'src.ts'), 'export const a = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', `feat: add src\n\n${RECORD}\n`]);
  // Spawned, not in-process: `hooks install` records `commitlore.bin` from the
  // entry point it runs as, and inside a vitest worker that is tinypool's.
  execFileSync(process.execPath, [BUNDLE, 'hooks', 'install'], { cwd: dir, stdio: 'ignore' });
  return dir;
};

describe('#430 a commit carrying a record can be amended', () => {
  it('accepts --no-edit, which changes nothing about the record', () => {
    const dir = recordedRepo('amend-noedit');
    const before = git(dir, ['rev-parse', 'HEAD']).trim();

    const result = tryGit(dir, ['commit', '--amend', '--no-edit']);

    // Exit 0 is the whole assertion. The resulting sha is deliberately not
    // compared: an amend within the same second rewrites a commit whose object
    // is byte-identical, so an unchanged sha would be git's timestamp
    // granularity rather than a refusal. The two cases below prove the amend
    // really applies.
    expect(result.code, result.stderr).toBe(0);
    expect(git(dir, ['rev-parse', 'HEAD^{tree}']).trim()).toBe(
      git(dir, ['rev-parse', `${before}^{tree}`]).trim(),
    );
  });

  it('accepts a subject fix that keeps the record identical', () => {
    const dir = recordedRepo('amend-subject');

    const result = tryGit(dir, ['commit', '--amend', '-m', `feat: add src properly\n\n${RECORD}\n`]);

    expect(result.code, result.stderr).toBe(0);
    expect(git(dir, ['log', '-1', '--format=%s']).trim()).toBe('feat: add src properly');
    expect(git(dir, ['log', '-1', '--format=%B'])).toContain('r-amend01');
  });

  it('accepts a forgotten file added to the same commit', () => {
    const dir = recordedRepo('amend-addfile');
    writeFileSync(join(dir, 'forgotten.ts'), 'export const b = 2;\n');
    git(dir, ['add', 'forgotten.ts']);

    const result = tryGit(dir, ['commit', '--amend', '--no-edit']);

    expect(result.code, result.stderr).toBe(0);
    expect(git(dir, ['ls-tree', '--name-only', 'HEAD'])).toContain('forgotten.ts');
  });

  /**
   * The rule this must not weaken. Two commits under one id saying *different*
   * things is what SPEC §3.2 calls an identity collision, and it stays one.
   */
  it('still refuses a second commit that changes the record under the same id', () => {
    const dir = recordedRepo('amend-divergent');
    writeFileSync(join(dir, 'src.ts'), 'export const a = 2;\n');
    git(dir, ['add', '-A']);

    const divergent = [
      'Limit: the v1 runtime has unrestricted network egress',
      'Record-Id: r-amend01',
      'Provenance: authored',
    ].join('\n');
    const result = tryGit(dir, ['commit', '-m', `feat: change the limit\n\n${divergent}\n`]);

    expect(result.code, 'a divergent record under an existing id was accepted').not.toBe(0);
    expect(result.stderr).toMatch(/duplicate-id/);
  });

  /**
   * And the case §3.2 names outright: re-declaring the *same* record on a later
   * commit is "a lifecycle update", not a collision. This is what the count
   * branch was rejecting, and amend was only its most visible victim.
   */
  it('accepts the same record re-declared on a later commit', () => {
    const dir = recordedRepo('amend-redeclare');
    writeFileSync(join(dir, 'src.ts'), 'export const a = 3;\n');
    git(dir, ['add', '-A']);

    const result = tryGit(dir, ['commit', '-m', `feat: touch it again\n\n${RECORD}\n`]);

    expect(result.code, result.stderr).toBe(0);
  });

  /**
   * Two blocks carrying nothing but an id are not one record re-declared — they
   * are an id with no record attached, and calling them identical is true only
   * vacuously. That shape is a copy-paste, and it stays a violation. The
   * relaxation needs a payload to be about.
   */
  it('still refuses a bare Record-Id declared twice with no content', () => {
    const dir = createTestRepo({ path: temp('amend-bare-id') });
    git(dir, ['config', 'user.email', 'bare@example.invalid']);
    git(dir, ['config', 'user.name', 'bare']);
    writeFileSync(join(dir, 'src.ts'), 'export const a = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '--quiet', '-m', 'first\n\nRecord-Id: r-bareid1\n']);
    execFileSync(process.execPath, [BUNDLE, 'hooks', 'install'], { cwd: dir, stdio: 'ignore' });

    writeFileSync(join(dir, 'src.ts'), 'export const a = 2;\n');
    git(dir, ['add', '-A']);
    const result = tryGit(dir, ['commit', '-m', 'second\n\nRecord-Id: r-bareid1\n']);

    expect(result.code, 'a bare id declared twice was accepted').not.toBe(0);
    expect(result.stderr).toMatch(/duplicate-id/);
  });

  /**
   * Once an id has been retired, a further declaration is ambiguous about
   * whether it is in force — a lifecycle question, not a content one — so the
   * count rule stands wherever the id was ever superseded.
   *
   * Asserted on `findIdCollisions` directly rather than through a commit. At
   * `commit-msg` time the incoming record carries no instant yet, so where it
   * sorts relative to the superseding commit is not determined, and
   * `hasDeclaredSuccession` can forgive on that ordering alone. Driving this
   * end to end would be asserting a tie-break rather than the guard.
   */
  it('keeps the count rule for an id that was superseded, even on identical payloads', () => {
    const same = [
      { key: 'Limit', value: 'the v1 runtime has no network egress outside the app subnet' },
    ];
    const collisions = findIdCollisions([
      {
        sha: 'c1',
        source: 'commit',
        committedAt: '2026-01-01T00:10:00Z',
        trailers: [...same, { key: 'Record-Id', value: 'r-amend01' }],
      },
      {
        sha: 'c2',
        source: 'commit',
        committedAt: '2026-01-01T00:20:00Z',
        trailers: [
          { key: 'Supersedes', value: 'r-amend01' },
          { key: 'Record-Id', value: 'r-replacement1' },
        ],
      },
      {
        sha: 'c3',
        source: 'commit',
        committedAt: '2026-01-01T00:30:00Z',
        trailers: [...same, { key: 'Record-Id', value: 'r-amend01' }],
      },
    ]);

    expect(collisions.map((violation) => violation.value)).toEqual(['r-amend01']);
  });
});
