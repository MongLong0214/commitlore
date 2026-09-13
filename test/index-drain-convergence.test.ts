/**
 * #958: four real processes drain one index, and the result is one rebuild's.
 *
 * Every claim this project made about two processes indexing at once was argued
 * from the transaction boundary rather than observed. The interleavings were
 * injected inside a single process — the scan reads a clock the test supplies,
 * and the test replaces the queue at a counted reading. That proves the code
 * path handles a queue that moved. It exercises no second OS process, no second
 * SQLite write lock, and no `SQLITE_BUSY`.
 *
 * Two separate things are checked here, because neither implies the other:
 *
 *  1. **Convergence.** Real processes, each with a budget too small to finish,
 *     racing on one repository until nothing is owed. A drain that loses a
 *     range leaves `scan_pending` rows nobody claims, and the loop ends on its
 *     iteration cap rather than on an empty queue.
 *  2. **Row equality.** Converged is not the same as correct: a drain could
 *     retire a queue entry without inserting what it read and still converge,
 *     with the index quietly short. So the rows are compared against one
 *     unbudgeted rebuild of the same repository, both tables, in full.
 *
 * A green run here is evidence about the schedules that occurred, not about
 * every schedule. That is why the trial count is stated rather than implied,
 * and why the invariant test below exists alongside it: a `scan_pending` row is
 * only ever deleted in the transaction that inserts the records read from it,
 * which is a property of the code and holds under every schedule.
 *
 * Flakiness, measured on this machine (12 cpus, macOS, load ~6.8): 10
 * consecutive runs, 0 failures.
 *
 * It found three defects the moment it was first run, none of which any
 * single-process test could have reached:
 *
 *   - `PRAGMA journal_mode = WAL` threw `SQLITE_IOERR` -- "disk I/O error" --
 *     out of `openIndex` when several writers opened a cold index together.
 *     Without the guard that absorbs it: 2 failures in 6 runs.
 *   - `runInTransaction` used a deferred `BEGIN`, which SQLite will not apply
 *     `busy_timeout` to. Not caught by this test once the tolerance below
 *     exists; measured instead, at 8 contended passes out of 45 against 0.
 *   - `updateIndex` threw `SQLITE_BUSY` at a caller rather than reporting a
 *     pass that did nothing. The held-lock case below is what pins that, and it
 *     is deterministic: this test does not reach it once the other two are in,
 *     which is exactly why it is not left to this one.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  closeIndex,
  indexUnread,
  openIndex,
  updateIndex,
  type IndexHandle,
} from '../src/core/index-db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..');
const SYNTHETIC_REPO = join(PACKAGE_ROOT, 'scripts', 'make-synthetic-repo.mjs');

/** Four, because two can pass by never actually overlapping. */
const DRAINERS = 4;
/** Stated rather than implied: see the header. */
const TRIALS = 2;

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const scratch = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-drain-${label}-`));
  temporaries.push(dir);
  return dir;
};

const syntheticRepo = (commits: number): string => {
  const dir = scratch('repo');
  execFileSync(
    process.execPath,
    [
      SYNTHETIC_REPO,
      '--out',
      dir,
      '--commits',
      String(commits),
      '--trailer-ratio',
      '0.3',
      '--prose-ratio',
      '0.05',
      '--quiet',
    ],
    { encoding: 'utf8' },
  );
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

/**
 * Every row of both tables, order-independent.
 *
 * Hashed rather than compared as arrays only so a mismatch prints something a
 * human can read; the query below is the comparison, and it selects every
 * column that carries meaning. A column added later and not listed here would
 * silently stop being compared — which is the shape of a check that reads its
 * own name rather than its subject.
 */
const fingerprint = (handle: IndexHandle): { trailers: string; paths: string; counts: string } => {
  const trailers = handle.db
    .prepare(
      `SELECT commit_sha, source, block, seq, key, value, value_lc, committed_at,
              committed_ts, provenance, signature_status
         FROM trailers
        ORDER BY commit_sha, source, block, seq`,
    )
    .all()
    .map((row) => JSON.stringify(row))
    .join('\n');
  const paths = handle.db
    .prepare('SELECT commit_sha, path FROM commit_paths ORDER BY commit_sha, path')
    .all()
    .map((row) => JSON.stringify(row))
    .join('\n');
  const digest = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);
  return {
    trailers: digest(trailers),
    paths: digest(paths),
    counts: `${String(trailers.split('\n').length)}/${String(paths.split('\n').length)}`,
  };
};

/**
 * One drainer: budgets too small to finish, called until nothing is owed.
 *
 * No `force`: a real consumer never asks for a rebuild, it asks for an index,
 * and `updateIndex` starts the scan itself when there is nothing installed.
 * The iteration cap is the failure signal —
 * a drain that loses a range never empties the queue, and without a cap the
 * test would hang instead of failing.
 */
const DRAIN_WORKER = `
import { openIndex, closeIndex, updateIndex, indexUnread } from ${JSON.stringify(join(PACKAGE_ROOT, 'dist', 'core', 'index-db.js'))};

// Through the environment, not argv. Under \`--eval\` node shifts argv: the
// first user argument lands at argv[1], and reading argv[2] silently yields
// undefined, which \`openIndex\` resolves to process.cwd(). The first version of
// this test did exactly that -- four drainers indexed the package directory
// while the fixture stayed empty, and the comparison failed against a repo
// nobody had touched.
const dir = process.env.COMMITLORE_DRAIN_DIR;
if (dir === undefined) throw new Error('COMMITLORE_DRAIN_DIR is not set');
const handle = openIndex({ cwd: dir });
let passes = 0;
try {
  for (; passes < 400; passes += 1) {
    // A deadline already in the past: every pass does its guaranteed first
    // batch and stops, which is the smallest slice the drain will take and
    // therefore the most interleaving per unit of work.
    updateIndex(handle, { budget: { deadline: 0, now: () => 1 } });
    if (indexUnread(handle) === 0) break;
  }
  process.stdout.write(JSON.stringify({ passes, unread: indexUnread(handle) }));
} catch (error) {
  process.stdout.write(JSON.stringify({ passes, error: String(error) }));
} finally {
  closeIndex(handle);
}
`;

interface DrainResult {
  passes: number;
  unread?: number;
  error?: string;
}

const drain = (dir: string): Promise<DrainResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', DRAIN_WORKER], {
      cwd: PACKAGE_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, COMMITLORE_DRAIN_DIR: dir },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (err += String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (out === '') {
        reject(new Error(`drainer exited ${String(code)} with no result: ${err.slice(0, 800)}`));
        return;
      }
      resolve(JSON.parse(out) as DrainResult);
    });
  });

describe('#958 concurrent drainers in separate processes', () => {
  it('converges on the rows one unbudgeted rebuild produces', async () => {
    const dir = syntheticRepo(300);

    // The oracle: one process, no budget, nothing racing.
    cold(dir);
    withIndex(dir, (handle) => {
      updateIndex(handle, { force: true });
    });
    const expected = withIndex(dir, fingerprint);
    expect(expected.counts, 'the fixture indexed nothing — the comparison would be vacuous').not.toBe(
      '1/1',
    );

    for (let trial = 0; trial < TRIALS; trial += 1) {
      cold(dir);
      const results = await Promise.all(
        Array.from({ length: DRAINERS }, () => drain(dir)),
      );

      for (const [at, result] of results.entries()) {
        expect(result.error, `trial ${String(trial)} drainer ${String(at)} threw`).toBeUndefined();
        expect(
          result.passes,
          `trial ${String(trial)} drainer ${String(at)} hit the iteration cap — the queue never emptied`,
        ).toBeLessThan(400);
      }

      // Nothing owed, and the rows are the ones a single rebuild produces.
      // Convergence alone would pass with a drain that retired queue entries
      // without inserting what it read.
      expect(withIndex(dir, indexUnread), `trial ${String(trial)}: work is still owed`).toBe(0);
      expect(withIndex(dir, fingerprint), `trial ${String(trial)}: rows differ from one rebuild`).toEqual(
        expected,
      );
    }
  }, 600_000);

  /**
   * A held write lock makes a pass a no-op, not a dead process.
   *
   * Deterministic where the four-process test is not: a second connection takes
   * the write lock with its own `BEGIN IMMEDIATE` and keeps it, so the drain
   * meets `SQLITE_BUSY` every time rather than when the schedule happens to
   * produce it. Without this the tolerance is unexercised — with `BEGIN
   * IMMEDIATE` and the journal-mode guard in place, the racing test never
   * reaches it, and an untested absorb is the shape that quietly starts
   * swallowing real failures.
   */
  it('treats a held write lock as a pass that did nothing', () => {
    const dir = syntheticRepo(60);
    cold(dir);

    const handle = openIndex({ cwd: dir });
    const blocker = openIndex({ cwd: dir });
    try {
      blocker.db.exec('BEGIN IMMEDIATE');

      // Never throws, and says why it did nothing.
      const stats = updateIndex(handle, { budget: { deadline: 0, now: () => 1 } });
      expect(stats.rebuildReason).toBe('another process held the index; nothing was read this pass');
      expect(stats.trailersIndexed).toBe(0);

      blocker.db.exec('ROLLBACK');

      // And the passes that follow do the work, so absorbing lost nothing:
      // the queue still names everything the blocked pass did not read.
      // At least once, then until nothing is owed. A blocked pass queues
      // nothing, so `indexUnread` is 0 before the drain starts as well as
      // after it finishes -- a loop that tested it first would run zero times
      // and assert against an index nobody had touched.
      for (let at = 0; at < 40; at += 1) {
        updateIndex(handle, { budget: { deadline: 0, now: () => 1 } });
        if (indexUnread(handle) === 0) break;
      }
      expect(indexUnread(handle), 'the drain did not finish after the lock was released').toBe(0);
      expect(handle.db.prepare('SELECT count(*) AS n FROM trailers').get()).not.toEqual({ n: 0 });
    } finally {
      closeIndex(blocker);
      closeIndex(handle);
    }
  }, 300_000);

  /**
   * The property that makes loss impossible whatever the schedule, asserted
   * against the source rather than against a run.
   *
   * A test that races can only ever report on the schedules it got. This one
   * covers every schedule, and it is the reason a green above is worth
   * something: if the retirement ever moves out of the insert's transaction,
   * the races become meaningful and this fails immediately, in milliseconds,
   * naming the line.
   */
  it('retires a queue entry only in the transaction that inserts what it read', () => {
    const source = readFileSync(join(PACKAGE_ROOT, 'src', 'core', 'index-db.ts'), 'utf8');
    const lines = source.split('\n');

    const retirements = lines
      .map((line, at) => ({ line, at }))
      .filter(({ line }) => /\bdone\.run\(/.test(line));
    expect(retirements.length, 'no queue retirement found — this test lost its subject').toBeGreaterThan(
      0,
    );

    for (const { at } of retirements) {
      // Walk back to the enclosing `runInTransaction`, and require that an
      // `insertRecords` sits between it and the retirement. Scoped by the
      // nearest preceding `runInTransaction(`, which is what "the same
      // transaction" means here.
      let opened = -1;
      for (let back = at; back >= 0 && opened === -1; back -= 1) {
        if (/runInTransaction\(/.test(lines[back] ?? '')) opened = back;
      }
      expect(opened, `line ${String(at + 1)} retires a queue entry outside any transaction`).toBeGreaterThanOrEqual(
        0,
      );
      const between = lines.slice(opened, at).join('\n');
      expect(
        /insertRecords\(/.test(between),
        `line ${String(at + 1)} retires a queue entry in a transaction that inserts nothing`,
      ).toBe(true);
    }
  });
});
