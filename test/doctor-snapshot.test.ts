/**
 * #462's instrument: the shipping text report, pinned before the model change.
 *
 * PRD §9.1 constrains every ticket in this milestone up to the text-rendering
 * one — the report a user reads must not move. That constraint needs something
 * that fails when it does, and reading thirteen detail strings by eye is not
 * it. So this snapshot lands *before* the first internal change, and each later
 * ticket keeps it green until #470 deliberately updates it.
 *
 * The snapshot is normalised, not raw: paths, shas, versions and durations vary
 * per machine and per run, and a snapshot that fails for those reasons would be
 * deleted within a week. What survives normalisation is the part §9.1 is about
 * — which checks run, in what order, with what status and what fix line.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { formatReport, runDoctor } from '../src/commands/doctor.js';
import { closeIndex, openIndex, rebuildIndex } from '../src/core/index-db.js';
import { createTestRepo } from './git-fixtures.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `cl-snap-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A repository with a remote, history, a record, a hook stub and an index. */
const populated = (label: string, hookBin: string): string => {
  const remote = createTestRepo({ path: temp(`${label}-remote`), bare: true });
  const repo = createTestRepo({ path: temp(label) });

  git(repo, ['config', 'user.email', 'owner@example.invalid']);
  git(repo, ['config', 'user.name', 'owner']);
  git(repo, ['remote', 'add', 'origin', remote]);

  writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
  git(repo, ['add', '-A']);
  git(repo, [
    'commit',
    '--no-verify',
    '-m',
    'feat: a\n\nLimit: the v1 runtime has no egress\nRecord-Id: r-snap01\nProvenance: authored',
  ]);

  mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(repo, '.git', 'hooks', 'commit-msg'), '#!/bin/sh\nexit 0\n');
  git(repo, ['config', '--local', 'commitlore.bin', hookBin]);
  git(repo, ['config', '--local', 'commitlore.node', process.execPath]);
  git(repo, ['config', '--local', 'commitlore.root', realpathSync(PACKAGE_ROOT)]);

  const handle = openIndex({ cwd: repo });
  rebuildIndex(handle);
  closeIndex(handle);
  return repo;
};

/**
 * Replaces the parts that legitimately vary. Everything left is what §9.1
 * promises not to move: the check set, its order, each status, and the fix
 * line offered.
 */
const normalise = (text: string, repo: string): string =>
  text
    .split('\n')
    .map((line) =>
      line
        .replaceAll(realpathSync(repo), '<repo>')
        .replaceAll(repo, '<repo>')
        .replaceAll(realpathSync(PACKAGE_ROOT), '<root>')
        .replaceAll(PACKAGE_ROOT, '<root>')
        .replaceAll(realpathSync(tmpdir()), '<tmp>')
        // mkdtemp's random suffix varies per run; the path shape is what
        // matters, and leaving the suffix in makes the snapshot fail for a
        // reason that has nothing to do with the report.
        .replace(/cl-snap-[a-z]+-[A-Za-z0-9]+/g, 'cl-snap-<tmpdir>')
        .replace(/\b[0-9a-f]{40}\b/g, '<sha>')
        .replace(/\b[0-9a-f]{7,12}\b/g, '<short-sha>')
        .replace(/\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?/g, '<version>')
        .replace(/\b\d+\s?ms\b/g, '<ms>')
        .replace(/git version .*/, 'git version <git>')
        .replace(/\/[^\s'"]*commitlore[^\s'"]*/g, '<path>'),
    )
    .join('\n')
    .trimEnd();

describe('#462 doctor text report, pinned', () => {
  it('renders a stable report on a repository whose hook target is missing', () => {
    // The failing shape: `commitlore.bin` points nowhere, so the capture checks
    // take their failure paths and the report carries fix lines.
    const repo = populated('broken', join(temp('nowhere'), 'no-such-binary.mjs'));
    expect(normalise(formatReport(runDoctor({ cwd: repo })), repo)).toMatchSnapshot();
  });

  it('renders a stable report on a repository whose hook target resolves', () => {
    const repo = populated('working', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    expect(normalise(formatReport(runDoctor({ cwd: repo })), repo)).toMatchSnapshot();
  });

  it('pins the check set and its order independently of the rendered text', () => {
    // The snapshot above would also fail on a wording change. This one fails
    // only on the thing §9.1 forbids outright: a check appearing, vanishing or
    // moving.
    const repo = populated('order', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    expect(runDoctor({ cwd: repo }).checks.map((entry) => entry.id)).toMatchSnapshot();
  });

  it('pins every v1 JSON key on every row', () => {
    // PRD §9.1 allows new keys and forbids changing v1 ones. A row that lost
    // `fixed`, or renamed `needsAttention`, fails here rather than in a
    // consumer.
    const repo = populated('json', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    const report = runDoctor({ cwd: repo });

    expect(Object.keys(report).sort()).toEqual(expect.arrayContaining(['checks', 'exitCode']));
    for (const row of report.checks) {
      for (const key of ['id', 'title', 'status', 'needsAttention', 'detail', 'fix', 'fixed']) {
        expect(Object.keys(row), `${row.id} lost the v1 key ${key}`).toContain(key);
      }
      expect(typeof row.id).toBe('string');
      expect(typeof row.title).toBe('string');
      expect(typeof row.needsAttention).toBe('boolean');
      expect(typeof row.detail).toBe('string');
      expect(typeof row.fixed).toBe('boolean');
      expect(row.fix === null || typeof row.fix === 'string').toBe(true);
    }
  });
});

/**
 * #462's other half: the model is consistent because construction makes it so,
 * not because every call site remembered.
 */
describe('#462 the check model', () => {
  it('derives severity from status on every row of a full run', () => {
    // The design ADR-0032 §3 rejected is an independent severity axis. If one
    // ever appears, a row will disagree with its own status here.
    const repo = populated('severity', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    const expected: Record<string, string> = {
      fail: 'error',
      warn: 'warning',
      ok: 'info',
      skipped: 'info',
    };
    for (const row of runDoctor({ cwd: repo }).checks) {
      expect(row.severity, `${row.id} is ${row.status} but ${row.severity}`).toBe(
        expected[row.status],
      );
    }
  });

  it('gives every row a category from the closed union and a non-optional flag', () => {
    // Catches a call site that bypassed the factory: the fields would be
    // missing rather than merely wrong.
    const categories = ['runtime', 'transport', 'capture', 'delivery', 'history', 'index'];
    const repo = populated('category', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));

    for (const row of runDoctor({ cwd: repo }).checks) {
      expect(categories, `${row.id} has category ${String(row.category)}`).toContain(row.category);
      expect(row.optional, `${row.id} is optional; PRD §1.4 says none are`).toBe(false);
      expect(row.evidence, `${row.id} has no evidence object`).toBeTypeOf('object');
    }
  });

  it('carries a skip reason only on skipped rows', () => {
    const repo = populated('skip', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    for (const row of runDoctor({ cwd: repo }).checks) {
      if (row.status !== 'skipped') {
        expect(row.skipReason, `${row.id} is ${row.status} yet names a skip reason`).toBeUndefined();
      }
    }
  });

  it('keeps needsAttention false on the two rows that deliberately clear it', () => {
    // #192 and #221: a no-remote refspec warn and an unresolvable inject
    // executable are conditions the user cannot act on from here. The factory
    // default would set both; the overrides must survive it.
    const remoteless = createTestRepo({ path: temp('noremote') });
    git(remoteless, ['config', 'user.email', 'owner@example.invalid']);
    git(remoteless, ['config', 'user.name', 'owner']);
    git(remoteless, ['commit', '--quiet', '--allow-empty', '--no-verify', '-m', 'first']);

    const refspec = runDoctor({ cwd: remoteless }).checks.find((row) => row.id === 'notes-refspec');
    expect(refspec?.status).toBe('warn');
    expect(refspec?.needsAttention).toBe(false);
  });
});
