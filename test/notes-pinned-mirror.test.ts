/**
 * #957: one pass reads one mirror.
 *
 * `indexNotes` used to touch the mutable `refs/notes/commitlore` three times —
 * `revParseRef` to record it, `git notes list` to enumerate it, and
 * `git log --notes=<ref>` to read the bodies — and then stamped the index with
 * the first of those readings. A mirror that moved between them produced rows
 * from one version stamped with another.
 *
 * It self-corrected on the next call, because the stamp no longer matched the
 * live ref, except where the ref returned to the stamped value first. Between
 * the two, a query answered from a mirror state that never existed.
 *
 * The listing is now `git ls-tree` against a resolved tree and the bodies come
 * from the blob ids that listing named, so the snapshot is chosen once by the
 * caller and everything downstream reads it. The count did not move: one
 * listing process for one listing process, and the commit fields a note row
 * needs come from the path pass that already visits exactly those commits.
 *
 * The ordering here is forced rather than raced for, the same way the other
 * cross-process tests do it — the mirror is rewritten between the listing and
 * the body read, at a point the test controls.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { closeIndex, ensureIndex, openIndex, type IndexHandle } from '../src/core/index-db.js';

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

/** Rewrites every note in the mirror, which is what another writer does. */
const rewriteNotes = (dir: string, warn: string, tag: string): void => {
  for (const sha of git(dir, ['rev-list', 'HEAD']).split('\n').filter((s) => s !== '')) {
    git(dir, [
      ...IDENTITY,
      'notes',
      '--ref=refs/notes/commitlore',
      'add',
      '-f',
      '-m',
      `note\n\nRecord-Id: r-${tag}${sha.slice(0, 5)}\nWarn: ${warn}\nBlast: local\n`,
      sha,
    ]);
  }
};

const repoWithNotes = (commits = 6): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-pinned-'));
  temporaries.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main']);
  for (let i = 0; i < commits; i += 1) {
    writeFileSync(join(dir, `f-${String(i)}.ts`), `revision ${String(i)}\n`);
    git(dir, ['add', '-A']);
    git(dir, [...IDENTITY, 'commit', '-q', '--no-verify', '-m', `change ${String(i)}\n\nno record\n`]);
  }
  rewriteNotes(dir, 'the first version of this note', 'v1');
  return dir;
};

const cold = (dir: string): void => {
  rmSync(join(dir, '.git', 'commitlore'), { recursive: true, force: true });
  mkdirSync(join(dir, '.git', 'commitlore'), { recursive: true });
};

const withIndex = <T>(dir: string, fn: (handle: IndexHandle) => T): T => {
  const handle = openIndex({ cwd: dir });
  try {
    return fn(handle);
  } finally {
    closeIndex(handle);
  }
};

const noteValues = (handle: IndexHandle): string[] =>
  handle.db
    .prepare(`SELECT value FROM trailers WHERE source = 'notes' AND key = 'Warn' ORDER BY value`)
    .all()
    .map((row) => String(row.value));

/**
 * The `Warn:` values a given notes tree actually holds.
 *
 * The oracle for "the rows came from the mirror the stamp names": read that
 * tree directly rather than trusting either half of what the index did.
 */
const warnsInTree = (dir: string, refSha: string): string[] => {
  const blobs = git(dir, ['ls-tree', '-r', '--full-tree', refSha])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split(/\s+/)[2] ?? '')
    .filter((blob) => blob !== '');
  const warns: string[] = [];
  for (const blob of blobs) {
    for (const line of git(dir, ['cat-file', 'blob', blob]).split('\n')) {
      if (line.startsWith('Warn: ')) warns.push(line.slice('Warn: '.length));
    }
  }
  return warns;
};

const stampedRef = (handle: IndexHandle): string | null => {
  const row = handle.db.prepare(`SELECT v FROM meta WHERE k = 'notes_ref_sha'`).get() as
    | { v: string | null }
    | undefined;
  return row?.v ?? null;
};

describe('#957 a pass reads the mirror it was given', () => {
  it('indexes one version of the mirror, and stamps the version it indexed', () => {
    const dir = repoWithNotes();
    cold(dir);
    const v1 = git(dir, ['rev-parse', 'refs/notes/commitlore']).trim();

    closeIndex(ensureIndex({ cwd: dir }).handle);

    const rows = withIndex(dir, noteValues);
    expect(rows.length, 'the fixture must have indexed its notes').toBeGreaterThan(0);

    // Every row is from one version, and the stamp names that version.
    expect(new Set(rows)).toEqual(new Set(['the first version of this note']));
    expect(withIndex(dir, stampedRef)).toBe(v1);
  }, 300_000);

  it('indexes the mirror it stamped, even when the mirror moves mid-pass', () => {
    // Enough notes for more than one batch, because the window this closes is
    // *inside* a pass: between the listing and a later batch's bodies. A mirror
    // that moves before the pass starts is seen whole by both and proves
    // nothing — an earlier version of this test did that and passed against the
    // defect.
    const dir = repoWithNotes(100);
    cold(dir);

    // The budget's clock is read at the top of each batch, which is the one
    // point inside the pass a test can reach. The commit scan here is cheap
    // (no records), so a later reading lands in the notes phase — after the
    // listing has been taken, before every body has been read.
    let readings = 0;
    let moved = false;
    const budget = {
      deadline: 1_000_000,
      now: () => {
        readings += 1;
        if (readings === 6 && !moved) {
          moved = true;
          rewriteNotes(dir, 'the second version of this note', 'v2');
        }
        return 0;
      },
    };

    closeIndex(ensureIndex({ cwd: dir, budget }).handle);
    expect(moved, 'the fixture must have moved the mirror inside the pass').toBe(true);

    // Whichever mirror the pass chose, the rows must be that mirror's. Reading
    // bodies through the live ref puts the newer text on rows the listing took
    // from the older tree: a stamp naming one version over rows from another.
    const stamp = withIndex(dir, stampedRef);
    expect(stamp, 'a completed notes pass must stamp the mirror it read').not.toBe(null);
    expect(new Set(withIndex(dir, noteValues))).toEqual(new Set(warnsInTree(dir, String(stamp))));
  }, 300_000);

  it('reads a note whose body is not ASCII, by byte length', () => {
    const dir = repoWithNotes();
    cold(dir);

    // `cat-file --batch` frames each object with a byte count. Indexing a
    // decoded string by that count is wrong the moment a note holds a
    // multi-byte character, and wrong silently — every object after it is
    // framed from the wrong offset.
    const head = git(dir, ['rev-parse', 'HEAD']).trim();
    git(dir, [
      ...IDENTITY,
      'notes',
      '--ref=refs/notes/commitlore',
      'add',
      '-f',
      '-m',
      'note\n\nRecord-Id: r-unicode1\nWarn: 日本語 é ü — a note that is not ASCII\nBlast: local\n',
      head,
    ]);

    closeIndex(ensureIndex({ cwd: dir }).handle);

    const rows = withIndex(dir, noteValues);
    expect(rows).toContain('日本語 é ü — a note that is not ASCII');
    // And the notes after it in the same batch are still framed correctly.
    expect(rows.filter((value) => value === 'the first version of this note').length).toBeGreaterThan(0);
  }, 300_000);
});
