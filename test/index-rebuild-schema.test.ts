/**
 * A rebuild that cannot rebuild past a schema change.
 *
 * `rebuildIndex` clears rows and keeps the tables, and its `DELETE FROM meta`
 * deliberately preserves `schema_version` -- so on a database written by an
 * older schema the state survives its own repair. The first insert then dies on
 * a column the table does not have, and the message names a SQLite constraint
 * rather than the situation.
 *
 * Measured on a real worktree whose index came from v1.0.2: zero
 * `signature_status` columns in `trailers`, and `--rebuild` reporting
 * `NOT NULL constraint failed: trailers.signature_status` -- a constraint on a
 * column that does not exist. Deleting the file made the identical command
 * succeed and restoring it made it fail again (#774).
 *
 * The fixture writes an old-shaped database rather than depending on an
 * artefact left by an older release, so this keeps testing after every such
 * artefact is gone.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { closeIndex, openIndex, rebuildIndex } from '../src/core/index-db.js';

/**
 * Resolved the way `src/core/index-db.ts` resolves it. A static
 * `import ... from 'node:sqlite'` is what the source deliberately avoids, and
 * vite cannot resolve it here either.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => { run: (...args: unknown[]) => unknown; get: (...args: unknown[]) => unknown };
    close: () => void;
  };
};

const temps: string[] = [];
afterAll(() => {
  for (const path of temps) rmSync(path, { recursive: true, force: true });
});

/** A repository with one record, and no index yet. */
const repository = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'rebuild-schema-'));
  temps.push(dir);
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '--quiet', '-b', 'main');
  git('config', 'user.email', 'schema@example.invalid');
  git('config', 'user.name', 'schema');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  git('add', '-A');
  git(
    'commit',
    '--quiet',
    '-m',
    'seed\n\nLimit: something about a\nRecord-Id: r-schemaseed\nProvenance: authored\nCommitLore-Version: 2.0.0',
  );
  return dir;
};

/**
 * An index shaped like an older release's: the same tables minus the column
 * this build writes, and a `schema_version` that says so.
 */
const writeStaleIndex = (repo: string): string => {
  const path = join(repo, '.git', 'commitlore', 'index.db');
  mkdirSync(join(repo, '.git', 'commitlore'), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)');
  // Copied from a real v1.0.2 index rather than approximated: a first attempt
  // omitted `id INTEGER PRIMARY KEY` and failed on `no such column: id`, which
  // is a fixture defect wearing the costume of the bug under test.
  db.exec(
    `CREATE TABLE trailers (
       id           INTEGER PRIMARY KEY,
       commit_sha   TEXT    NOT NULL,
       block        INTEGER NOT NULL DEFAULT 0,
       seq          INTEGER NOT NULL,
       key          TEXT    NOT NULL,
       value        TEXT    NOT NULL,
       value_lc     TEXT    NOT NULL,
       committed_at TEXT    NOT NULL,
       committed_ts INTEGER NOT NULL,
       provenance   TEXT,
       source       TEXT    NOT NULL)`,
  );
  db.exec('CREATE TABLE commit_paths (commit_sha TEXT NOT NULL, path TEXT NOT NULL)');
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('schema_version', '3');
  db.close();
  return path;
};

describe('index --rebuild past a schema change', () => {
  it('recreates the file instead of dying on a column that does not exist', () => {
    const repo = repository();
    const path = writeStaleIndex(repo);

    // The state this reproduces: the old table has no signature_status.
    const before = new DatabaseSync(path, { readOnly: true });
    const columns = before
      .prepare('SELECT count(*) AS n FROM pragma_table_info(?) WHERE name = ?')
      .get('trailers', 'signature_status') as { n: number };
    before.close();
    expect(columns.n, 'the fixture must start without the column').toBe(0);

    const handle = openIndex({ cwd: repo });
    try {
      const stats = rebuildIndex(handle, { reason: 'rebuild requested' });
      expect(stats.rebuilt).toBe(true);
      expect(stats.trailersIndexed, 'the seeded record should be indexed').toBeGreaterThan(0);
    } finally {
      closeIndex(handle);
    }

    const after = new DatabaseSync(path, { readOnly: true });
    const now = after
      .prepare('SELECT count(*) AS n FROM pragma_table_info(?) WHERE name = ?')
      .get('trailers', 'signature_status') as { n: number };
    after.close();
    expect(now.n, 'the rebuilt file must carry the current schema').toBe(1);
  }, 60_000);
});
