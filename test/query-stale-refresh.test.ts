/**
 * A refresh that could not run must not be answered as a current index.
 *
 * 1.3.6 briefly absorbed SQLite contention inside `updateIndex` and reported
 * "a pass that did nothing". The argument was reasonable — the work is durable
 * and resumable, so a busy database is a scheduling outcome. Review found what
 * it cost: when a **notes refresh** lost its write lock, the absorb returned
 * normally with the old rows in place, and `openSource` then served that index
 * as `coverage: "complete"` with no diagnostic, where it had previously fallen
 * back to a full scan.
 *
 * It was fixed by deleting the absorb. That left the guard against its return
 * being "nobody re-adds it", and the commit said so:
 *
 *   > the stale-read blocker is reproduced in review and is not covered by a
 *   > test here — what is pinned is that contention throws, not that a failed
 *   > refresh is visible to `openSource`
 *
 * This is that test. It asserts what the **caller** concludes, which is the only
 * place the defect was ever visible. Measured against a build with the absorb
 * restored:
 *
 *   absorb restored   coverage "complete", 0 note records, no diagnostic
 *   as shipped        coverage "complete", 12 note records, "answering with a full scan"
 *
 * ## Two details the fixture depends on, both found by getting them wrong
 *
 * **Where the lock is taken.** Not before the query: `openIndex` creates its
 * schema under `BEGIN IMMEDIATE`, so a pre-held lock makes the *open* throw and
 * `openSource`'s outer handler falls back for a reason that has nothing to do
 * with the refresh. And not at the budget clock's first reading either —
 * `openSource` calls the clock while building `ensureIndex`'s arguments, which
 * is still before the open. The second reading is inside `updateIndex`, past
 * the open, which is the window review described as an injected write-lock
 * failure.
 *
 * **How many notes.** With one note the notes pass takes a single batch and the
 * guaranteed-first-batch rule skips the clock entirely, so there is no window
 * at all. Twelve notes make the pass do real work.
 *
 * Why the queue counts cannot catch this on their own: `openSource` computes
 * completeness from `indexUnread` plus the scan cost, and a refresh that
 * *failed* owes nothing — it never got far enough to queue anything. A failed
 * refresh and a finished one are indistinguishable by the numbers the coverage
 * field is built from. The exception is the only thing that separates them.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { closeIndex, ensureIndex, openIndex, type IndexHandle } from '../src/core/index-db.js';
import { runQuery } from '../src/core/query.js';

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

/** Enough notes that the notes pass reads its budget clock at all. */
const NOTES = 12;

/**
 * A repository indexed complete, then given notes the index has not seen.
 *
 * The notes go on *after* the index is built: the refresh they make necessary
 * is the work this test then prevents.
 */
const repoNeedingANotesRefresh = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-stalerefresh-'));
  temporaries.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main']);
  for (let i = 0; i < 40; i += 1) {
    writeFileSync(join(dir, `f-${String(i)}.ts`), `revision ${String(i)}\n`);
    git(dir, ['add', '-A']);
    git(dir, [
      ...IDENTITY,
      'commit',
      '-q',
      '--no-verify',
      '-m',
      `change ${String(i)}\n\nA constraint the diff cannot show.\n\n` +
        `Record-Id: r-msg${String(i).padStart(8, '0')}\nWarn: from the message\nBlast: local\n`,
    ]);
  }
  rmSync(join(dir, '.git', 'commitlore'), { recursive: true, force: true });
  mkdirSync(join(dir, '.git', 'commitlore'), { recursive: true });
  closeIndex(ensureIndex({ cwd: dir }).handle);

  for (const sha of git(dir, ['rev-list', `-${String(NOTES)}`, 'HEAD'])
    .split('\n')
    .filter((line) => line !== '')) {
    git(dir, [
      ...IDENTITY,
      'notes',
      '--ref=refs/notes/commitlore',
      'add',
      '-f',
      '-m',
      `note\n\nRecord-Id: r-nt${sha.slice(0, 10)}\nWarn: this record lives only in the mirror\nBlast: local\n`,
      sha,
    ]);
  }
  return dir;
};

const noteRecordCount = (result: { records: { recordId?: string }[] }): number =>
  result.records.filter((record) => (record.recordId ?? '').startsWith('r-nt')).length;

describe('a failed refresh is never reported as a current index', () => {
  it('picks up notes added after the index was built', () => {
    // The control. Without it, "the records are missing" below could mean the
    // fixture never produced any.
    const dir = repoNeedingANotesRefresh();
    const answer = runQuery({ cwd: dir });
    expect(noteRecordCount(answer)).toBe(NOTES);
    expect(answer.coverage).toBe('complete');
  }, 300_000);

  it('does not answer complete from an index whose refresh could not run', () => {
    const dir = repoNeedingANotesRefresh();

    let readings = 0;
    let blocker: IndexHandle | null = null;
    try {
      const answer = runQuery({
        cwd: dir,
        scanBudgetMs: 1_000_000,
        scanNow: () => {
          readings += 1;
          // The second reading: past `openSource`'s own call and past the open,
          // inside the update that would refresh the notes. See the header.
          if (readings === 2) {
            blocker = openIndex({ cwd: dir });
            blocker.db.exec('BEGIN IMMEDIATE');
          }
          return 0;
        },
      });

      expect(readings, 'the injected clock was never read, so no lock was taken').toBeGreaterThan(1);

      // Either it answered from git — which is what the fallback is for and
      // what happens today — or it admitted it was incomplete. What it must
      // never do is report a complete answer that is missing the records.
      const found = noteRecordCount(answer);
      expect(
        { found, coverage: answer.coverage },
        'an index whose refresh could not run answered "complete" while missing ' +
          `${String(NOTES - found)} of ${String(NOTES)} note records ` +
          `(diagnostics: ${JSON.stringify(answer.diagnostics)})`,
      ).not.toEqual({ found: 0, coverage: 'complete' });
    } finally {
      if (blocker !== null) {
        try {
          (blocker as IndexHandle).db.exec('ROLLBACK');
        } catch {
          /* already gone; what the query concluded is what matters */
        }
        closeIndex(blocker);
      }
    }
  }, 300_000);
});
