/**
 * #406: v0.6.0 kept `SCHEMA_VERSION = 2` when #335 added the `isCommitLoreKey`
 * classifier gate. An index built by v0.5.0 was therefore accepted as current,
 * and since the only other rebuild trigger is `lastIndexedSha !== head`, the
 * commits were never re-read. Ordinary conventional-commit trailers that v0.5.0
 * had ingested kept being served as active records — under exactly the rule
 * #335 was closed to enforce. `doctor` compared the cache against HEAD and
 * never against the classifier, so the one check a user would run said `ok`.
 *
 * The mechanism that fixes it already existed: a schema-version mismatch
 * deletes and rebuilds the index (ADR-0003). What was missing is that the
 * version tracked the table's *shape* and not what its rows *mean*, so a
 * classifier change moved nothing.
 *
 * This test cannot run v0.5.0, so it reconstructs what v0.5.0 left behind: a
 * row the current classifier would reject, in an index stamped with the older
 * version, on a HEAD the index claims to be current with. That is the exact
 * state the issue reproduces, and the assertion is that it does not survive.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import {
  SCHEMA_VERSION,
  closeIndex,
  ensureIndex,
  indexInfo,
  openIndex,
} from '../src/core/index-db.js';
import { runQuery } from '../src/core/query.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): string => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout;
};

/** The trailer the issue uses: valid conventional-commit noise, not a record. */
const NOISE_KEY = 'release';
const NOISE_VALUE = 'fixture release note';

const repoWithNoiseTrailer = (label: string): string => {
  const dir = createTestRepo({
    path: mkdtempSync(join(realpathSync(tmpdir()), `commitlore-${label}-`)),
  });
  scratch.push(dir);
  git(dir, ['config', 'user.email', 'fixture@example.invalid']);
  git(dir, ['config', 'user.name', 'fixture']);

  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', `feat: fixture\n\n${NOISE_KEY}: ${NOISE_VALUE}`]);
  return dir;
};

describe('#406 a classifier change invalidates an index built before it', () => {
  it('the current classifier does not treat the noise trailer as a record', () => {
    // The control. Without this the test below could pass because the fixture
    // never produced a record at all.
    const dir = repoWithNoiseTrailer('classifier-control');
    const result = runQuery({ cwd: dir, paths: ['a.txt'], noIndex: true });
    expect(result.records).toEqual([]);
  });

  it('discards an index stamped with an older schema version', () => {
    const dir = repoWithNoiseTrailer('classifier-stale');
    ensureIndex(dir);

    const head = git(dir, ['rev-parse', 'HEAD']).trim();

    // Reconstruct the v0.5.0 cache: the noise trailer stored as a record, the
    // index marked current with HEAD, and stamped with the previous schema
    // version. Written directly because no released build is available to a
    // unit test.
    const handle = openIndex({ cwd: dir, readonly: false });
    handle.db.exec('DELETE FROM trailers');
    handle.db
      .prepare(
        'INSERT INTO trailers' +
          ' (commit_sha, seq, block, key, value, value_lc, committed_at, committed_ts, source)' +
          " VALUES (?, 0, 0, ?, ?, ?, ?, ?, 'commit')",
      )
      .run(
        head,
        NOISE_KEY,
        NOISE_VALUE,
        NOISE_VALUE.toLowerCase(),
        new Date().toISOString(),
        Math.floor(Date.now() / 1000),
      );
    // v0.5.0 indexed the commit, so its path row exists too. Without it the
    // path-scoped fetch finds nothing and the test would pass for the wrong
    // reason.
    handle.db.prepare('INSERT INTO commit_paths (commit_sha, path) VALUES (?, ?)').run(
      head,
      'a.txt',
    );
    handle.db
      .prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('last_indexed_sha', ?)")
      .run(head);
    handle.db
      .prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('schema_version', '2')")
      .run();
    closeIndex(handle);

    // The state the issue reports: a stale row that HEAD-comparison cannot see.
    const stale = openIndex({ cwd: dir, readonly: true });
    expect(indexInfo(stale).schemaVersion).toBe('2');
    expect(indexInfo(stale).trailers).toBe(1);
    closeIndex(stale);

    // Reading through the ordinary route must not serve it.
    const result = runQuery({ cwd: dir, paths: ['a.txt'] });
    expect(
      result.records,
      'a record cached under the previous classifier was served as current',
    ).toEqual([]);

    // And the index must have been *rebuilt*, not bypassed. This is the half of
    // #406 about `doctor`: it reported the stale cache `ok` because it compares
    // the cache against HEAD and never against the classifier. A read that
    // quietly fell back to a git scan would leave the bad file on disk and
    // `doctor` would still be describing it.
    expect(result.fromIndex, 'the answer came from a scan, leaving the stale file in place').toBe(
      true,
    );
    const healed = openIndex({ cwd: dir, readonly: true });
    expect(indexInfo(healed).schemaVersion).toBe(String(SCHEMA_VERSION));
    expect(indexInfo(healed).trailers).toBe(0);
    closeIndex(healed);
  });

  /**
   * The rule this fix depends on, stated so a later change cannot quietly
   * reintroduce the bug: the version has to move when the meaning of a row
   * changes, not only when a column does.
   */
  it('the schema version has moved past the one #335 shipped under', () => {
    expect(SCHEMA_VERSION).toBeGreaterThan(2);
  });
});
