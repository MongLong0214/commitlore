/**
 * #898: `stale` reported a `Follows:` as dangling when its target was declared
 * in the same squashed commit.
 *
 * The rule was fine. The stream was not. `collectRecords` extracted a commit's
 * trailers with `parseCommitMessage` — git's view, the last paragraph only — so
 * a message carrying several record blocks reached the fold as one record
 * holding the final block, and every id above it was invisible. `validate` and
 * the index have always read every block through `parseRecordBlocks`, which is
 * why `validate -c HEAD` reported "references ok" about the very commit `stale`
 * called dangling.
 *
 * This is the collector half. The fold's rule is asserted in test/stale.test.ts.
 *
 * The repository that hit it merges through a helper that deliberately
 * preserves each source record as its own block, so any branch where one record
 * follows another and is then squashed produces a same-commit `Follows:`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { buildReport, collectRecords } from '../src/commands/stale.js';

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A repo whose second commit carries two record blocks, the squash shape. */
const squashedChain = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'stale-multiblock-'));
  scratch.push(dir);
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'test@example.invalid']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);

  writeFileSync(join(dir, 'f.txt'), 'a\n');
  git(dir, ['add', 'f.txt']);
  git(dir, ['commit', '--quiet', '-m', 'seed\n\nRecord-Id: r-seed898000\nBlast: local\n']);

  writeFileSync(join(dir, 'f.txt'), 'a\nb\n');
  git(dir, ['add', 'f.txt']);
  git(dir, [
    'commit',
    '--quiet',
    '-m',
    [
      'feat: a squash of two commits',
      '',
      'Limit: the earlier decision',
      'Record-Id: r-earlier89801',
      'Blast: module',
      '',
      'Limit: the later refinement',
      'Record-Id: r-later8980001',
      'Follows: r-earlier89801',
      'Blast: module',
      '',
    ].join('\n'),
  ]);
  return dir;
};

describe('#898 the stale scan reads every record block in a message', () => {
  it('collects one record per block, not one per commit', () => {
    const scan = collectRecords({ cwd: squashedChain(), allHistory: true });
    const ids = scan.records
      .map((record) => record.trailers.find((trailer) => trailer.key === 'Record-Id')?.value)
      .filter((id): id is string => id !== undefined)
      .sort();

    // Reading only the last paragraph would find r-later8980001 and r-seed898000
    // and miss the block above it entirely.
    expect(ids).toEqual(['r-earlier89801', 'r-later8980001', 'r-seed898000']);
  });

  it('counts commits, not records, so a multi-block message is one commit', () => {
    const scan = collectRecords({ cwd: squashedChain(), allHistory: true });

    // Counting records here would overstate the history and, on a real
    // repository, trip the truncation flag well short of the scan limit.
    expect(scan.records.length).toBe(3);
    expect(scan.commits).toBe(2);
    expect(scan.truncated).toBe(false);
  });

  it('does not report a same-commit Follows: as dangling', () => {
    const dir = squashedChain();
    const report = buildReport(collectRecords({ cwd: dir, allHistory: true }), new Date());

    expect(report.danglingRefs).toEqual([]);
  });

  it('still reports a Follows: that no block declares', () => {
    const dir = squashedChain();
    writeFileSync(join(dir, 'f.txt'), 'a\nb\nc\n');
    git(dir, ['add', 'f.txt']);
    git(dir, [
      'commit',
      '--quiet',
      '-m',
      'later\n\nLimit: points at nothing\nRecord-Id: r-real8980002\nFollows: r-doesnotexist9\nBlast: local\n',
    ]);

    const report = buildReport(collectRecords({ cwd: dir, allHistory: true }), new Date());

    expect(report.danglingRefs).toHaveLength(1);
    expect(report.danglingRefs[0]?.value).toBe('r-doesnotexist9');
  });
});
