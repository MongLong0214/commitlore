/**
 * #951: a budgeted scan that stopped must be able to carry on.
 *
 * Before this, a truncated scan persisted one number — how many commits it left
 * unread — and a number cannot be resumed from. Measured on a 1544-commit
 * repository with an injected clock: the first budgeted call read 448 commits
 * and seven further budgeted calls read none, so the index stayed 29% built
 * until somebody ran `commitlore init`.
 *
 * Every budget here is read against an injected clock. `r-522idx1` says why: a
 * real-millisecond budget has already passed vacuously in CI, where the scan
 * finished inside it and nothing was truncated, so the assertion proved nothing.
 * The clock below advances a fixed amount per reading, which makes "expired
 * partway through" a property of the test rather than of the machine.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  closeIndex,
  ensureIndex,
  indexDbPath,
  indexUnread,
  indexUnreadBySource,
  openIndex,
  type IndexHandle,
  type ScanBudget,
} from '../src/core/index-db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC_REPO = join(HERE, '..', 'scripts', 'make-synthetic-repo.mjs');

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const syntheticRepo = (commits: number): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-resume-'));
  temporaries.push(dir);
  execFileSync(
    process.execPath,
    [
      SYNTHETIC_REPO,
      '--out',
      dir,
      '--commits',
      String(commits),
      '--trailer-ratio',
      '0.2',
      '--prose-ratio',
      '0.05',
      '--quiet',
    ],
    { encoding: 'utf8' },
  );
  return dir;
};

/**
 * Commits on top of an already-indexed history, each carrying a record.
 *
 * The incremental range is what these exercise, and it only exists once a
 * baseline does — a repository built cold has no `last_indexed_sha..HEAD`.
 */
const appendCommits = (dir: string, count: number): void => {
  for (let i = 0; i < count; i += 1) {
    writeFileSync(join(dir, `appended-${i}.txt`), `appended ${i}\n`);
    execFileSync('git', ['add', `appended-${i}.txt`], { cwd: dir });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=CommitLore Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-q',
        '-m',
        `appended ${i}\n\nA constraint the diff cannot show.\n\nRecord-Id: r-app${i.toString(36)}\nBlast: local\n`,
      ],
      { cwd: dir },
    );
  }
};

/**
 * What a concurrent rebuild does to the queue: every entry moves up one
 * position, and a commit nobody has read takes position 0.
 *
 * Done through a second connection, the way another process would. The sentinel
 * sha is not a real object — it never has to be read for the assertion to hold,
 * only to survive.
 */
const shiftQueue = (dir: string): void => {
  const handle = openIndex({ cwd: dir });
  try {
    const rows = handle.db
      .prepare('SELECT ord, sha FROM scan_pending WHERE source = ? ORDER BY ord')
      .all('commit')
      .map((row) => ({ ord: Number(row.ord), sha: String(row.sha) }));
    handle.db.exec(`DELETE FROM scan_pending WHERE source = 'commit'`);
    const insert = handle.db.prepare(
      'INSERT INTO scan_pending (source, ord, sha) VALUES (?, ?, ?)',
    );
    insert.run('commit', 0, 'f'.repeat(40));
    for (const row of rows) insert.run('commit', row.ord + 1, row.sha);
  } finally {
    closeIndex(handle);
  }
};

/** Removes the index without removing the repository. */
const cold = (dir: string): void => {
  rmSync(join(dir, '.git', 'commitlore'), { recursive: true, force: true });
  mkdirSync(join(dir, '.git', 'commitlore'), { recursive: true });
};

/**
 * A clock that expires after `readings` readings.
 *
 * The deadline is a fixed number and the clock steps past it on a counted
 * reading, so where a scan stops is decided by how many times it looks at the
 * clock — which is the batch structure — and never by how fast the machine is.
 */
const expiringAfter = (readings: number): ScanBudget => {
  let seen = 0;
  return { deadline: 1_000, now: () => (++seen <= readings ? 0 : 2_000) };
};

const withIndex = <T>(dir: string, fn: (handle: IndexHandle) => T): T => {
  const handle = openIndex({ cwd: dir });
  try {
    return fn(handle);
  } finally {
    closeIndex(handle);
  }
};

/** Every row that decides an answer, canonically ordered. */
const rowsOf = (handle: IndexHandle): { trailers: string[]; paths: string[] } => ({
  trailers: handle.db
    .prepare(
      `SELECT commit_sha, source, block, seq, key, value FROM trailers
         ORDER BY commit_sha, source, block, seq`,
    )
    .all()
    .map((row) => Object.values(row).join('\u0001')),
  paths: handle.db
    .prepare('SELECT commit_sha, path FROM commit_paths ORDER BY commit_sha, path')
    .all()
    .map((row) => `${String(row.commit_sha)}\u0001${String(row.path)}`),
});

describe('#951 a budgeted scan resumes where it stopped', () => {
  it('advances on every budgeted call until nothing is outstanding', () => {
    const dir = syntheticRepo(400);
    cold(dir);

    const first = ensureIndex({ cwd: dir, budget: expiringAfter(2) });
    const outstanding = [indexUnread(first.handle)];
    closeIndex(first.handle);

    // The premise. Without a truncated first scan the rest of this test is
    // asserting nothing, so it is checked rather than assumed.
    expect(outstanding[0]).toBeGreaterThan(0);

    for (let call = 0; call < 12 && outstanding[outstanding.length - 1] > 0; call += 1) {
      const { handle, stats } = ensureIndex({ cwd: dir, budget: expiringAfter(3) });
      // A budgeted caller may never start a full rebuild: that is the unbounded
      // wait the budget exists to refuse. Resuming is not a rebuild.
      expect(stats.rebuilt).toBe(false);
      outstanding.push(indexUnread(handle));
      closeIndex(handle);
    }

    // Strictly decreasing until it reaches zero. A run that merely ended at
    // zero could have got there by one call doing everything, which is the
    // shape that passed before the fix as well.
    for (let i = 1; i < outstanding.length; i += 1) {
      expect(outstanding[i]).toBeLessThan(outstanding[i - 1]);
    }
    expect(outstanding[outstanding.length - 1]).toBe(0);
  }, 300_000);

  it('finishes with exactly the rows one unbudgeted rebuild would hold', () => {
    const dir = syntheticRepo(400);

    cold(dir);
    // The first call truncates; the rest each carry one slice. Three readings is
    // the floor for a slice that completes a batch: one goes to computing the
    // drain's own ceiling, and the batch loop checks twice before the expensive
    // half. At two readings the batch is started and then dropped, so the index
    // never advances -- which is a property of the clock in this test, not of
    // the code, and is why the two budgets are written separately here.
    closeIndex(ensureIndex({ cwd: dir, budget: expiringAfter(2) }).handle);
    for (let call = 0; call < 40; call += 1) {
      const { handle } = ensureIndex({ cwd: dir, budget: expiringAfter(3) });
      const left = indexUnread(handle);
      closeIndex(handle);
      if (left === 0) break;
    }
    const resumed = withIndex(dir, rowsOf);

    cold(dir);
    closeIndex(ensureIndex({ cwd: dir }).handle);
    const whole = withIndex(dir, rowsOf);

    // The deciding artifact. "unread reached 0" only says the bookkeeping
    // drained; if a resumed pass dropped records the index would call itself
    // complete and be wrong, which is worse than staying partial -- a partial
    // index at least says so.
    expect(resumed.trailers).toEqual(whole.trailers);
    expect(resumed.paths).toEqual(whole.paths);
    expect(resumed.trailers.length).toBeGreaterThan(0);
  }, 300_000);

  it('keeps the answer labelled partial for as long as work is outstanding', () => {
    const dir = syntheticRepo(400);
    cold(dir);

    const { handle } = ensureIndex({ cwd: dir, budget: expiringAfter(2) });
    const split = indexUnreadBySource(handle);
    closeIndex(handle);

    expect(split.commits + split.notes).toBeGreaterThan(0);
    // Split by source, not one conflated total: draining the commits must not
    // be able to report the notes complete, which the single `unread_commits`
    // number could.
    expect(split.commits).toBeGreaterThan(0);
  }, 300_000);

  it('does not remove outstanding work it did not read', () => {
    const dir = syntheticRepo(400);
    cold(dir);

    const first = ensureIndex({ cwd: dir, budget: expiringAfter(2) });
    const before = indexUnread(first.handle);
    closeIndex(first.handle);
    expect(before).toBeGreaterThan(0);

    // A budget already spent on entry. The drain still reads its one guaranteed
    // batch -- otherwise it could never start -- and must retire exactly that
    // batch and nothing else. Removing a row the drain did not read loses that
    // commit silently and for good, which is the one failure this table exists
    // to make impossible, so the assertion is the equality and not an
    // inequality: "fewer outstanding" is satisfied by losing them too.
    const { handle, stats } = ensureIndex({
      cwd: dir,
      budget: { deadline: -1, now: () => 0 },
    });
    expect(stats.rebuilt).toBe(false);
    expect(stats.commitsScanned).toBeGreaterThan(0);
    expect(indexUnread(handle)).toBe(before - stats.commitsScanned);
    closeIndex(handle);
  }, 300_000);

  it('queues what a budgeted incremental could not reach, and converges', () => {
    const dir = syntheticRepo(200);

    // A whole index first, so the backlog under test is only the new commits.
    closeIndex(ensureIndex({ cwd: dir }).handle);
    withIndex(dir, (handle) => expect(indexUnread(handle)).toBe(0));

    const before = withIndex(dir, (handle) => rowsOf(handle).trailers.length);
    // More than the drain's guaranteed batch, so the first budgeted call cannot
    // finish the range and the queue is actually exercised.
    appendCommits(dir, 300);

    // Holding `last_indexed_sha` back and inserting nothing looked like the safe
    // way to bound this, and was not: every later call re-read the same prefix,
    // reported the remainder unread, and left `indexUnread` at zero -- every new
    // commit missing from the index with nothing recorded as owed.
    const first = ensureIndex({ cwd: dir, budget: expiringAfter(2) });
    const owed = indexUnread(first.handle);
    closeIndex(first.handle);
    expect(owed).toBeGreaterThan(0);

    for (let call = 0; call < 20; call += 1) {
      const { handle, stats } = ensureIndex({ cwd: dir, budget: expiringAfter(4) });
      expect(stats.rebuilt).toBe(false);
      const left = indexUnread(handle);
      closeIndex(handle);
      if (left === 0) break;
    }

    withIndex(dir, (handle) => {
      expect(indexUnread(handle)).toBe(0);
      expect(rowsOf(handle).trailers.length).toBeGreaterThan(before);
    });

    // And the converged index holds what a rebuild would.
    const resumed = withIndex(dir, rowsOf);
    cold(dir);
    closeIndex(ensureIndex({ cwd: dir }).handle);
    expect(resumed.trailers).toEqual(withIndex(dir, rowsOf).trailers);
  }, 300_000);

  it('retires a queued entry by identity, not by position', () => {
    const dir = syntheticRepo(400);
    cold(dir);

    const first = ensureIndex({ cwd: dir, budget: expiringAfter(2) });
    const queued = indexUnread(first.handle);
    closeIndex(first.handle);
    expect(queued).toBeGreaterThan(1);

    // A drainer selects its rows and then reads git holding no transaction. In
    // that window another process can replace the queue -- a rebuild does
    // exactly that. The clock is the interleaving point: it is read inside the
    // scan, after the selection and before the transaction that retires it, so
    // the shift below lands in precisely the window that matters and lands
    // there every run rather than when the scheduler happens to allow it.
    let readings = 0;
    const budget: ScanBudget = {
      deadline: 4_000,
      now: () => {
        readings += 1;
        // Reading 1 is the drain computing its own ceiling, which happens before
        // it selects anything. Reading 2 is the first one inside the scan, so the
        // selection is already made and the transaction has not opened: exactly
        // the window a concurrent rebuild occupies.
        if (readings === 2) shiftQueue(dir);
        return readings <= 3 ? 0 : 9_000;
      },
    };

    const { handle } = ensureIndex({ cwd: dir, budget });
    const left = indexUnread(handle);
    const sentinelStillQueued = Number(
      (
        handle.db
          .prepare(`SELECT count(*) AS n FROM scan_pending WHERE sha = ?`)
          .get('f'.repeat(40)) as { n: number }
      ).n,
    );
    closeIndex(handle);

    // Deleting on position alone retires whatever now sits at that position --
    // work nobody has done. The sentinel occupies position 0 after the shift and
    // has never been read, so it must still be owed.
    expect(sentinelStillQueued).toBe(1);
    expect(left).toBeGreaterThan(0);
  }, 300_000);

  it('does not certify a mirror the queued notes were not listed from', () => {
    const dir = syntheticRepo(40);
    closeIndex(ensureIndex({ cwd: dir }).handle);

    // The queue holds annotated commits and says nothing about which mirror
    // listed them. Reading them against a mirror that has since moved and then
    // stamping that mirror as indexed certifies a version never read.
    withIndex(dir, (handle) => {
      handle.db.exec('DELETE FROM scan_pending');
      handle.db
        .prepare('INSERT INTO scan_pending (source, ord, sha) VALUES (?, ?, ?)')
        .run('notes', 0, 'd'.repeat(40));
      handle.db
        .prepare(
          'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
        )
        .run('notes_pending_ref', 'e'.repeat(40));
      handle.db
        .prepare(
          'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
        )
        .run('notes_ref_sha', null);
    });

    // This repository has no notes mirror at all, so the recorded originating
    // ref cannot match: the stale queue must be dropped rather than drained and
    // stamped.
    const { handle } = ensureIndex({ cwd: dir, budget: expiringAfter(20) });
    const after = indexUnreadBySource(handle);
    const stamped = handle.db.prepare(`SELECT v FROM meta WHERE k = 'notes_ref_sha'`).get() as
      | { v: string | null }
      | undefined;
    closeIndex(handle);

    expect(after.notes).toBe(0);
    expect(stamped?.v ?? null).toBe(null);
  }, 300_000);

  it('advances even when one batch costs more than the slice it is given', () => {
    const dir = syntheticRepo(400);
    cold(dir);

    const first = ensureIndex({ cwd: dir, budget: expiringAfter(2) });
    const before = indexUnread(first.handle);
    closeIndex(first.handle);
    expect(before).toBeGreaterThan(0);

    // The drain runs under a slice of the caller's ceiling, so a batch that
    // costs more than the slice is cancelled — and cancelled again on the next
    // call, and the next. Measured with a clock stepping 400ms per reading
    // against a 750ms slice: eight calls, nothing read, the backlog exactly
    // where it started. A queue that only drains under calls large enough to
    // finish a batch is not resumable; it is the old defect with a table under
    // it. The floor is one batch, which is the unit this scan already overshoots
    // by.
    const stepping = (): ScanBudget => {
      let t = 0;
      return {
        deadline: 3_000,
        now: () => {
          t += 400;
          return t;
        },
      };
    };

    const after = (() => {
      const { handle } = ensureIndex({ cwd: dir, budget: stepping() });
      const left = indexUnread(handle);
      closeIndex(handle);
      return left;
    })();

    expect(after).toBeLessThan(before);
  }, 300_000);

  it('leaves an unbudgeted caller free to finish it in one rebuild', () => {
    const dir = syntheticRepo(400);
    cold(dir);

    const first = ensureIndex({ cwd: dir, budget: expiringAfter(2) });
    expect(indexUnread(first.handle)).toBeGreaterThan(0);
    closeIndex(first.handle);

    // `index` and `init` pass no budget. Outstanding work is a rebuild they
    // still owe, and taking it must stay their job -- resuming is the bounded
    // repair, not a replacement for the whole one.
    const { handle, stats } = ensureIndex({ cwd: dir });
    expect(stats.rebuilt).toBe(true);
    expect(indexUnread(handle)).toBe(0);
    closeIndex(handle);

    expect(indexDbPath(dir)).toContain('index.db');
  }, 300_000);
});
