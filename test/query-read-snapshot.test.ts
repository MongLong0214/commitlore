/**
 * One query reads one version of the index.
 *
 * `runQuery` reads twice — `foldStates` to fold lifecycle states, then
 * `collectRows` to gather what it will display — and its own doc comment
 * requires the two to agree:
 *
 *   > a stream where the two disagreed would report records whose supersessions
 *   > had not been read
 *
 * They were separate reads on a live database. A rebuild publishes by replacing
 * every table in one transaction, so a rebuild landing between them gave the
 * query two different versions and an answer neither one supports. Reproduced
 * on a single open handle, with no unusual scheduling: two `queryTrailers`
 * calls with an unbudgeted rebuild in between returned different record sets.
 *
 * A deferred `BEGIN` is the fix and `BEGIN IMMEDIATE` is not: it takes no write
 * lock, and in WAL mode it pins a read snapshot at the first read. Writers keep
 * writing; this reader keeps seeing the version it started with.
 *
 * The rebuild here runs in a **second process**, because the property is about
 * two connections. A same-process rebuild would share the connection and prove
 * nothing about isolation.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  closeIndex,
  openIndex,
  queryTrailers,
  withReadSnapshot,
  type IndexHandle,
} from '../src/core/index-db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'commitlore.mjs');

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = [
  '-c',
  'user.name=CommitLore Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

const git = (dir: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });

const fixtureRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-snapshot-'));
  temporaries.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main']);
  for (let i = 0; i < 4; i += 1) {
    writeFileSync(join(dir, `f-${String(i)}.ts`), `revision ${String(i)}\n`);
    git(dir, ['add', '-A']);
    git(dir, [
      ...IDENTITY,
      'commit',
      '-q',
      '--no-verify',
      '-m',
      `change ${String(i)}\n\nA constraint the diff cannot show.\n\n` +
        `Record-Id: r-snapshot${String(i)}0\nWarn: the first version\nBlast: local\n`,
    ]);
  }
  execFileSync(process.execPath, [CLI, 'index', '--rebuild'], { cwd: dir, stdio: 'ignore' });
  return dir;
};

/** Another writer commits and republishes the whole index, in its own process. */
const anotherWriterRebuilds = (dir: string, tag: string): void => {
  git(dir, [
    ...IDENTITY,
    'commit',
    '-q',
    '--no-verify',
    '--allow-empty',
    '-m',
    `change ${tag}\n\nA constraint the diff cannot show.\n\n` +
      `Record-Id: r-snapshot${tag}\nWarn: a later version\nBlast: local\n`,
  ]);
  execFileSync(process.execPath, [CLI, 'index', '--rebuild'], { cwd: dir, stdio: 'ignore' });
};

const recordIds = (handle: IndexHandle): string[] =>
  queryTrailers(handle, { key: 'Record-Id' })
    .map((row) => row.value)
    .sort();

describe('a query reads one version of the index', () => {
  it('sees the same rows on both reads while another process republishes', () => {
    const dir = fixtureRepo();
    const handle = openIndex({ cwd: dir });
    try {
      const { first, second } = withReadSnapshot(handle, () => {
        const before = recordIds(handle);
        anotherWriterRebuilds(dir, 'aa');
        return { first: before, second: recordIds(handle) };
      });

      // The fixture must actually have records, or "they agree" is two empty
      // lists agreeing.
      expect(first.length, 'the fixture indexed nothing').toBeGreaterThan(0);
      expect(second).toEqual(first);
      expect(first).not.toContain('r-snapshotaa');
    } finally {
      closeIndex(handle);
    }
  }, 300_000);

  it('picks up the new version on the next query, so the snapshot is not a cache', () => {
    // The other half, and the one that stops the fix from being "never see new
    // data". Isolation lasts for one query; the next one starts its own.
    //
    // Not a control for the snapshot: it passes with the snapshot removed too,
    // because reads without one see the newest data by definition. It guards
    // the opposite failure — a snapshot that outlived its query would turn the
    // index into a stale cache — and it is here as that guard, not as evidence
    // for this change. The first case is the one that goes red without it.
    const dir = fixtureRepo();
    const handle = openIndex({ cwd: dir });
    try {
      withReadSnapshot(handle, () => recordIds(handle));
      anotherWriterRebuilds(dir, 'bb');
      const after = withReadSnapshot(handle, () => recordIds(handle));
      expect(after, 'a later query must see what the rebuild published').toContain('r-snapshotbb');
    } finally {
      closeIndex(handle);
    }
  }, 300_000);

  it('refuses to open a snapshot inside an open transaction', () => {
    // Returning quietly without one would leave the caller believing it had
    // isolation it does not have — the failure mode this whole file is about,
    // arriving through the guard meant to prevent it.
    const dir = fixtureRepo();
    const handle = openIndex({ cwd: dir });
    try {
      expect(() =>
        withReadSnapshot(handle, () => {
          withReadSnapshot(handle, () => recordIds(handle));
        }),
      ).toThrow(/cannot be opened inside an open transaction/);
    } finally {
      closeIndex(handle);
    }
  }, 300_000);
});
