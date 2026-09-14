/**
 * A notes pass filters by the HEAD it started with, even if HEAD moves under it.
 *
 * `annotatedNotes` filters the mirror by what HEAD reaches, so the scope is an
 * input to the rows a pass produces. 1.3.5 pinned *which mirror* a pass reads
 * and left this half open, recording it as a `Limit:`:
 *
 *   > the reachability filter still reads HEAD at listing time, so a HEAD that
 *   > moves mid-pass can still change which notes are in scope; only the mirror
 *   > is pinned here
 *
 * and, separately:
 *
 *   > the HEAD-moves-mid-pass case is named as a limit and not tested; no test
 *   > moves HEAD between the listing and a later batch
 *
 * 1.3.7 resolved HEAD once and used that value for both the filter and the
 * stamp — for a different reason, a fast-forward losing a note permanently. This
 * asserts the consequence that was never checked: within one pass, the scope is
 * fixed at the start, so a HEAD that moves cannot change which notes that pass
 * indexes or which scope it records beside them.
 *
 * The ordering is forced rather than raced for, the same way
 * `notes-pinned-mirror.test.ts` forces it for the mirror: the budget's clock is
 * read inside the pass, and the test moves HEAD at a counted reading. No sleep
 * stands in for "the other side moved".
 *
 * What this does **not** claim: that a pass which started before a move produces
 * rows describing the repository afterwards. It cannot, and should not — the
 * next call sees the new HEAD and refreshes. What matters is that one pass is
 * internally consistent, so the rows and the stamp beside them always describe
 * the same scope.
 *
 * ## Why there is no negative control, and what that means
 *
 * Putting the second `HEAD` read back — `reachableFromHead(cwd)` in place of the
 * resolved value — does not make this fail, and the reason is the finding
 * rather than a weakness in the fixture. The listing is the **first** thing the
 * pass does, before any batch and therefore before the budget clock is read at
 * all. There is no point inside a pass at which the scope could be re-read, so
 * the window the `Limit:` described no longer exists to be reached.
 *
 * That is worth writing down rather than leaving as a passing test: the limit
 * was recorded in 1.3.5, closed as a side effect in 1.3.7, and nobody had
 * checked which. This file is the check, and it holds the property so a future
 * pass that re-derives the scope mid-way is caught.
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

/** Enough notes that the pass takes more than one batch and reads its clock. */
const NOTES = 12;

const commit = (dir: string, name: string): string => {
  writeFileSync(join(dir, `${name}.ts`), `${name}\n`);
  git(dir, ['add', '-A']);
  git(dir, [...IDENTITY, 'commit', '-q', '--no-verify', '-m', `${name}\n\nno record in the message\n`]);
  return git(dir, ['rev-parse', 'HEAD']).trim();
};

const noteOn = (dir: string, sha: string, id: string): void => {
  git(dir, [
    ...IDENTITY,
    'notes',
    '--ref=refs/notes/commitlore',
    'add',
    '-f',
    '-m',
    `note\n\nRecord-Id: ${id}\nWarn: scoped by reachability\nBlast: local\n`,
    sha,
  ]);
};

/**
 * A history where a later commit carries a note the earlier scope excludes.
 *
 * `ancestor` reaches the first `NOTES` notes. `descendant` additionally reaches
 * `r-afterthemove`, which is the record that must not appear in a pass that
 * began at `ancestor`.
 */
const fixtureRepo = (): { dir: string; ancestor: string; descendant: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-midpass-'));
  temporaries.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main']);

  const reachable: string[] = [];
  for (let i = 0; i < NOTES; i += 1) reachable.push(commit(dir, `early-${String(i)}`));
  const ancestor = reachable[reachable.length - 1] as string;
  for (const [index, sha] of reachable.entries()) {
    noteOn(dir, sha, `r-early${String(index).padStart(6, '0')}`);
  }

  const descendant = commit(dir, 'later');
  noteOn(dir, descendant, 'r-afterthemove');

  git(dir, ['reset', '-q', '--hard', ancestor]);
  return { dir, ancestor, descendant };
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

const noteIds = (handle: IndexHandle): string[] =>
  handle.db
    .prepare(`SELECT value FROM trailers WHERE source = 'notes' AND key = 'Record-Id' ORDER BY value`)
    .all()
    .map((row) => String((row as { value: unknown }).value));

const stampedHead = (handle: IndexHandle): string | null => {
  const row = handle.db.prepare(`SELECT v FROM meta WHERE k = 'notes_head_sha'`).get() as
    | { v: string | null }
    | undefined;
  return row?.v ?? null;
};

describe('a notes pass keeps the scope it started with', () => {
  it('indexes the scope it began at, and stamps that scope, when HEAD moves mid-pass', () => {
    const { dir, ancestor, descendant } = fixtureRepo();
    cold(dir);

    // The clock is read inside the pass. Moving HEAD at a counted reading puts
    // the move after the listing has been taken and before every body has been
    // read — the window the `Limit:` named.
    let readings = 0;
    let moved = false;
    const budget = {
      deadline: 1_000_000,
      now: () => {
        readings += 1;
        if (readings === 3 && !moved) {
          moved = true;
          git(dir, ['reset', '-q', '--hard', descendant]);
        }
        return 0;
      },
    };

    closeIndex(ensureIndex({ cwd: dir, budget }).handle);
    expect(moved, 'the fixture must have moved HEAD inside the pass').toBe(true);
    expect(git(dir, ['rev-parse', 'HEAD']).trim(), 'HEAD must have actually moved').toBe(descendant);

    const indexed = withIndex(dir, noteIds);
    const stamp = withIndex(dir, stampedHead);

    // The rows and the stamp describe one scope. A pass that filtered by the
    // old HEAD and stamped the new one — or the reverse — is the defect.
    if (stamp === ancestor) {
      expect(
        indexed,
        'a pass stamped at the ancestor must not carry a record only the descendant reaches',
      ).not.toContain('r-afterthemove');
    } else if (stamp === descendant) {
      expect(
        indexed,
        'a pass stamped at the descendant must carry what the descendant reaches',
      ).toContain('r-afterthemove');
    } else {
      // A truncated pass stamps nothing and records what it still owes; that is
      // a valid outcome and not a scope mismatch.
      expect(stamp, `the stamp is neither endpoint: ${String(stamp)}`).toBeNull();
    }

    // And whichever scope it chose, it indexed something: an empty pass would
    // satisfy every branch above without proving anything.
    expect(indexed.length, 'the pass indexed no notes at all').toBeGreaterThan(0);
  }, 300_000);

  it('converges on the new scope once the pass that started before it has finished', () => {
    // The other half, and the reason the first is not an argument for staleness:
    // pinning the scope applies to one pass, not to the index.
    const { dir, descendant } = fixtureRepo();
    cold(dir);
    closeIndex(ensureIndex({ cwd: dir }).handle);
    expect(withIndex(dir, noteIds)).not.toContain('r-afterthemove');

    git(dir, ['reset', '-q', '--hard', descendant]);
    closeIndex(ensureIndex({ cwd: dir }).handle);

    const after = withIndex(dir, noteIds);
    expect(after, 'the next pass must see what the new HEAD reaches').toContain('r-afterthemove');
    expect(withIndex(dir, stampedHead)).toBe(descendant);
  }, 300_000);
});
