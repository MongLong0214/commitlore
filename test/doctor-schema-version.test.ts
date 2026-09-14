/**
 * `doctor` reports the schema version the index is stamped with.
 *
 * `indexInfo` has always returned `schemaVersion` and the `index-health` row did
 * not read it. So the row describing what the index believes about itself
 * omitted the one field deciding whether this build may believe any of it: the
 * trailer count, the commit count and the HEAD comparison all describe a
 * database that a mismatched build discards unread.
 *
 * It matters beyond tidiness because `openIndex` and `queryTrailers` carry no
 * version gate — a database stamped with another version stays directly
 * queryable through them. The query and validation routes do check before
 * serving, so a mismatch is normally repaired rather than read; what was missing
 * was any report that one exists.
 *
 * The stamp is forged here rather than produced by an old build, because the
 * check is about what the row says and not about how the file came to say it.
 * Forging is also the only way to get a v4 index from a v5 binary: every write
 * path stamps the current version.
 *
 * Measured against a build with the `schemaMismatch` branch removed:
 *
 *   branch removed   2 of 3 fail — the row reports `ok`, and the third case gets
 *                    "behind HEAD" where the mismatch should have won
 *   as shipped       3 of 3 pass
 *
 * The first case passes either way by design: it asserts the evidence fields,
 * which the same commit added separately from the branch. Two of three
 * discriminating is the whole of what this file claims.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../src/core/index-db.js';

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

const indexedRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-schemarow-'));
  temporaries.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main']);
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, [
    ...IDENTITY,
    'commit',
    '-q',
    '--no-verify',
    '-m',
    'change\n\nA constraint the diff cannot show.\n\nRecord-Id: r-schemarow001\nBlast: local\n',
  ]);
  const built = spawnSync(process.execPath, [CLI, 'index', '--rebuild'], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (built.status !== 0) throw new Error(`the fixture could not build its index: ${built.stderr}`);
  return dir;
};

interface Row {
  status?: string;
  detail?: string;
  fix?: string | null;
  evidence?: Record<string, string>;
}

const indexHealthRow = (dir: string): Row => {
  const result = spawnSync(process.execPath, [CLI, 'doctor', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  const start = result.stdout.indexOf('{');
  if (start === -1) throw new Error(`doctor produced nothing: ${result.stderr.slice(0, 400)}`);
  const report = JSON.parse(result.stdout.slice(start, result.stdout.lastIndexOf('}') + 1)) as {
    checks: (Row & { id?: string })[];
  };
  const row = report.checks.find((entry) => entry.id === 'index-health');
  if (row === undefined) throw new Error('doctor has no index-health row');
  return row;
};

/**
 * A stamp no build writes, so the row has a mismatch to find.
 *
 * Through a raw connection so the forgery does not depend on how any production
 * code path treats the stamp. `openIndex` would also work — `createSchema`
 * stamps through `initMeta` (`src/core/index-db.ts:1540`), which writes only
 * when the key is absent, so an existing forged value survives an open; that was
 * measured rather than assumed, because the first explanation written here
 * claimed the opposite. What actually made the row report `ok` was a `dist/`
 * bundle predating the fix: this spawns the built CLI, so a suite run that does
 * not build first tests the previous release ([[a-stale-bundle-reports-the-last-build]]).
 */
const forgeStamp = (dir: string, version: string): void => {
  const dbPath = join(dir, '.git', 'commitlore', 'index.db');
  const raw = spawnSync(
    process.execPath,
    [
      '-e',
      `const {DatabaseSync}=require('node:sqlite');` +
        `const d=new DatabaseSync(${JSON.stringify(dbPath)});` +
        `d.prepare("UPDATE meta SET v = ? WHERE k = 'schema_version'").run(process.argv[1]);`,
      version,
    ],
    { encoding: 'utf8' },
  );
  if (raw.status !== 0) throw new Error(`could not forge the stamp: ${raw.stderr.slice(0, 300)}`);
};

describe('the index-health row reads the schema stamp', () => {
  it('carries the stamped and expected versions on a healthy index', () => {
    // The control: without it, the warning below could come from a fixture that
    // was broken in some other way.
    const dir = indexedRepo();
    const row = indexHealthRow(dir);
    expect(row.status).toBe('ok');
    expect(row.evidence?.['schema_version']).toBe(String(SCHEMA_VERSION));
    expect(row.evidence?.['expects_schema']).toBe(String(SCHEMA_VERSION));
  }, 300_000);

  it('warns when the stamp is not the version this build reads', () => {
    const dir = indexedRepo();
    const older = String(SCHEMA_VERSION - 1);
    forgeStamp(dir, older);

    const row = indexHealthRow(dir);
    expect(row.status, `the row did not warn: ${JSON.stringify(row.detail)}`).toBe('warn');
    expect(row.detail).toContain(`stamped schema v${older}`);
    expect(row.detail).toContain(`reads v${String(SCHEMA_VERSION)}`);
    // And it names the repair, rather than leaving the reader to infer it.
    expect(row.fix).toContain('index --rebuild');
    expect(row.evidence?.['schema_version']).toBe(older);
    expect(row.evidence?.['expects_schema']).toBe(String(SCHEMA_VERSION));
  }, 300_000);

  it('reports the mismatch ahead of the HEAD comparison', () => {
    // Order matters: a version this build cannot read makes every other number
    // in the row describe a database it is about to discard. A row that reported
    // "behind HEAD" instead would send the reader after the wrong thing.
    const dir = indexedRepo();
    forgeStamp(dir, String(SCHEMA_VERSION - 1));

    // Move HEAD too, so both conditions hold and only the precedence decides.
    writeFileSync(join(dir, 'b.ts'), 'export const b = 2;\n');
    git(dir, ['add', '-A']);
    git(dir, [
      ...IDENTITY,
      'commit',
      '-q',
      '--no-verify',
      '-m',
      'second\n\nA constraint the diff cannot show.\n\nRecord-Id: r-schemarow002\nBlast: local\n',
    ]);

    const row = indexHealthRow(dir);
    expect(row.detail).toContain('stamped schema');
    expect(row.detail, 'the schema mismatch must win over "behind HEAD"').not.toContain('behind HEAD');
  }, 300_000);
});
