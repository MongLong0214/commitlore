/**
 * The external-corpus harness, against a repository small enough to check by
 * hand. Registered method: `bench/EXTERNAL-CORPUS.md`.
 *
 * The fixture exercises the three things that decide whether an external figure
 * means anything: that a revert becomes a record without a person writing one,
 * that a change which came back is refused, and that a record living only in
 * `refs/notes/commitlore` is invisible to `git log --format=%B` and visible to
 * the arm §6.2 adds for exactly that reason.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  RETURN_THRESHOLD,
  alternativeOf,
  blockFor,
  reasonOf,
  recordIdFor,
  selectReverts,
  writeNotes,
} from '../bench/external/backfill.ts';
import { PINNED_CORPORA } from '../bench/external/corpus.ts';
import { coverageForPath } from '../bench/external/coverage.ts';
import { buildCensus } from '../bench/deterministic/census.ts';
import { measureDecisionDelivery } from '../bench/deterministic/recovery.ts';
import type { DecisionDeliveryRow, RowBase } from '../bench/deterministic/types.ts';
import { createTestRepo } from './git-fixtures.ts';

const BASE: RowBase = {
  schema_version: 1,
  harness_commit: '0'.repeat(40),
  harness_digest: '1'.repeat(40),
  dist_digest: 'a'.repeat(64),
  measured_at: '2026-08-01T00:00:00.000Z',
  machine: {
    platform: 'test',
    release: 'test',
    arch: 'test',
    cpu: 'test',
    logical_cpus: 1,
    memory_bytes: 1,
    node: 'v22.0.0',
    git: 'git version 2.0.0',
  },
};

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' });

/** Long enough that every line clears the 8-character floor the filter sets. */
const lines = (marker: string, count = 8): string =>
  `${Array.from({ length: count }, (_, index) => `const ${marker}_${index} = ${index};`).join('\n')}\n`;

interface Fixture {
  readonly dir: string;
  readonly repo: string;
  /** The revert whose change stayed gone. */
  readonly kept: string;
  /** The revert whose change came back verbatim. */
  readonly returned: string;
}

/**
 * Both reverts undo a *modification* rather than an addition, so the path they
 * touch is still tracked at HEAD. A revert of an addition deletes the file, and
 * a deleted file is not a path any agent can be about to edit, so no evaluation
 * path would exist and every row would score against an empty denominator.
 */
const createFixture = (): Fixture => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-external-'));
  const repo = createTestRepo({ path: join(dir, 'repo') });
  const write = (name: string, marker: string): void => {
    writeFileSync(join(repo, name), lines(marker));
  };
  const append = (name: string, marker: string): void => {
    writeFileSync(join(repo, name), `${lines(name.replace('.ts', ''))}${lines(marker)}`);
  };
  const commit = (message: string): void => {
    git(repo, ['add', '--all']);
    git(repo, ['commit', '--quiet', '--no-verify', '-m', message]);
  };
  const head = (): string => git(repo, ['rev-parse', 'HEAD']).trim();

  write('base.ts', 'base');
  commit('Add the base module');

  write('keep.ts', 'keep');
  commit('Add the keep module');
  append('keep.ts', 'cache');
  commit('Add a caching layer | with a pipe in the subject');
  git(repo, ['revert', '--no-edit', head()]);
  const kept = head();

  write('back.ts', 'back');
  commit('Add the back module');
  append('back.ts', 'feature');
  commit('Add the thing that comes back');
  git(repo, ['revert', '--no-edit', head()]);
  const returned = head();
  // Reintroduced verbatim: the return check has to refuse this one.
  append('back.ts', 'feature');
  commit('Put it back after all');

  return { dir, repo, kept, returned };
};

describe('revert backfill', () => {
  let fixture: Fixture;
  beforeAll(() => {
    fixture = createFixture();
  });
  afterAll(() => {
    rmSync(fixture.dir, { recursive: true, force: true });
  });

  it('accepts a revert whose change stayed gone and refuses one that came back', () => {
    const funnel = selectReverts(fixture.repo, 'HEAD');
    expect(funnel.candidates).toBe(2);
    expect(funnel.returned).toBe(1);
    expect(funnel.accepted.map((record) => record.revertSha)).toEqual([fixture.kept]);
  });

  it('reads the alternative out of the reverted subject and never invents a reason', () => {
    const [record] = selectReverts(fixture.repo, 'HEAD').accepted;
    expect(record).toBeDefined();
    // The subject carried a pipe; `Ruled-out:` splits on the first one.
    expect(record?.alternative).toBe('Add a caching layer / with a pipe in the subject');
    expect(record?.reason).toBe('no reason recorded in the revert message');
    expect(record?.reasonAbsent).toBe(true);
  });

  it('derives a record id from the revert sha alone', () => {
    expect(recordIdFor(fixture.kept)).toBe(recordIdFor(fixture.kept));
    expect(recordIdFor(fixture.kept)).toMatch(/^r-[a-z0-9]{6,}$/);
    expect(recordIdFor(fixture.kept)).not.toBe(recordIdFor(fixture.returned));
  });

  it('emits a block Git itself parses as a record', () => {
    const block = blockFor({ alternative: 'a', reason: 'b', recordId: 'r-abc123' });
    const parsed = execFileSync(
      'git',
      ['-c', 'trailer.separators=:', 'interpret-trailers', '--parse', '--no-divider'],
      { cwd: fixture.repo, encoding: 'utf8', input: `subject\n\n${block}` },
    );
    expect(parsed).toContain('Ruled-out: a | b');
    expect(parsed).toContain('Record-Id: r-abc123');
    expect(parsed).toContain('Provenance: reconstructed');
  });

  it('keeps the registered return threshold at the value the method fixed', () => {
    expect(RETURN_THRESHOLD).toBe(0.5);
  });
});

describe('backfilled records reach the answer key and the routes', () => {
  let fixture: Fixture;
  let rows: readonly DecisionDeliveryRow[];
  beforeAll(() => {
    fixture = createFixture();
    writeNotes(fixture.repo, [...selectReverts(fixture.repo, 'HEAD').accepted]);
    rows = measureDecisionDelivery(BASE, fixture.repo, 'HEAD', () => {}, {
      includeNotes: true,
      routes: [
        'git-log-path',
        'git-log-path-notes',
        'git-log-path-notes-budgeted',
        'commitlore',
      ],
    });
  });
  afterAll(() => {
    rmSync(fixture.dir, { recursive: true, force: true });
  });

  it('folds a notes-only record only when the answer key is asked to', () => {
    expect(buildCensus(fixture.repo, 'HEAD').records.size).toBe(0);
    expect(buildCensus(fixture.repo, 'HEAD', { includeNotes: true }).records.size).toBe(1);
  });

  it('delivers nothing on the plain Git arm, because the record is not in a message', () => {
    const row = rows.find((entry) => entry.route === 'git-log-path' && entry.population === 'authored');
    expect(row?.path_active_total).toBeGreaterThan(0);
    expect(row?.recovered).toBe(0);
  });

  it('delivers the record on the arm that reads the notes mirror', () => {
    const row = rows.find(
      (entry) => entry.route === 'git-log-path-notes' && entry.population === 'authored',
    );
    expect(row?.recovered).toBe(row?.path_active_total);
  });

  it('delivers the record through the shipped projection', () => {
    const row = rows.find((entry) => entry.route === 'commitlore' && entry.population === 'authored');
    expect(row?.recovered).toBe(row?.path_active_total);
    expect(row?.stale_delivered).toBe(0);
  });

  it('scores only the routes it was asked for', () => {
    expect(new Set(rows.map((entry) => entry.route)).size).toBe(4);
  });
});

describe('budgeted log coverage', () => {
  let fixture: Fixture;
  beforeAll(() => {
    fixture = createFixture();
  });
  afterAll(() => {
    rmSync(fixture.dir, { recursive: true, force: true });
  });

  it('counts every commit when the whole log fits the budget', () => {
    const coverage = coverageForPath(fixture.repo, 'HEAD', 'base.ts', false, 800);
    expect(coverage?.commitsDelivered).toBe(coverage?.commitsTotal);
  });

  it('drops the oldest commits when the budget cannot hold them', () => {
    const coverage = coverageForPath(fixture.repo, 'HEAD', 'back.ts', false, 1);
    expect(coverage?.commitsTotal).toBeGreaterThan(1);
    expect(coverage?.commitsDelivered).toBeLessThan(coverage?.commitsTotal ?? 0);
  });

  it('returns nothing for a path with no history', () => {
    expect(coverageForPath(fixture.repo, 'HEAD', 'never-existed.ts', false, 800)).toBeNull();
  });
});

describe('the pinned corpus', () => {
  it('names a full object id for every repository, so a result cannot drift', () => {
    for (const corpus of PINNED_CORPORA) {
      expect(corpus.ref).toMatch(/^[0-9a-f]{40}$/);
      expect(corpus.upstream).toMatch(/^https:\/\//);
      expect(corpus.licence).not.toBe('');
    }
  });

  it('carries exactly one calibration corpus, at the commit that produced the published rows', () => {
    const calibration = PINNED_CORPORA.filter((corpus) => corpus.calibration);
    expect(calibration).toHaveLength(1);
    expect(calibration[0]?.ref).toBe('b3f569210554aab815a48c21ddef90dce029ba98');
  });
});
