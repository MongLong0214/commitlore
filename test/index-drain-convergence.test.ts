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
 * Flakiness, measured on this machine (12 cpus, macOS, load ~12): 12
 * consecutive runs, 0 failures.
 *
 * It found three defects the moment it was first run, none of which any
 * single-process test could have reached — and the third of them turned out to
 * be a defect of the fix rather than of the code:
 *
 *   - `PRAGMA journal_mode = WAL` threw `SQLITE_IOERR` -- "disk I/O error" --
 *     out of `openIndex` when several writers opened a cold index together.
 *     Without the guard that absorbs it: 3 failures in 8 runs. The guard tests
 *     SQLite's own result code, never the message text: a review reproduced the
 *     false positive, where `GIT_CONFIG_KEY_0=sqlite_busy` puts that string into
 *     a git failure's message and a substring test reads it as contention.
 *   - `runInTransaction` used a deferred `BEGIN`, which SQLite will not apply
 *     `busy_timeout` to. Not caught by this test; measured instead, at 8
 *     contended passes out of 45 against 0.
 *   - `updateIndex` throws contention at its caller, and **must**. The first fix
 *     absorbed it and reported a pass that did nothing. Review found two
 *     blockers in that and reproduced both: a notes refresh that lost its write
 *     lock then returned normally with the old rows in place, so `openSource`
 *     served a stale index as `coverage: "complete"` where it had previously
 *     fallen back to a scan -- 1,073 records became one obsolete note, with no
 *     diagnostic. Withdrawn. A loop that drains is a loop that retries, which is
 *     what the worker below does and what this whole file is evidence about.
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
let contended = 0;
try {
  for (; passes < 400; passes += 1) {
    // A deadline already in the past: every pass does its guaranteed first
    // batch and stops, which is the smallest slice the drain will take and
    // therefore the most interleaving per unit of work.
    try {
      updateIndex(handle, { budget: { deadline: 0, now: () => 1 } });
    } catch (error) {
      // Contention reaches the caller, by design: \`updateIndex\` must keep
      // throwing so \`openSource\` can fall back to a scan rather than serve a
      // stale index as complete. A loop that drains is therefore a loop that
      // retries -- the queue is durable, so the pass simply did not happen.
      if (!/database is locked/.test(String(error))) throw error;
      contended += 1;
      continue;
    }
    if (indexUnread(handle) === 0) break;
  }
  process.stdout.write(JSON.stringify({ passes, contended, unread: indexUnread(handle) }));
} catch (error) {
  process.stdout.write(JSON.stringify({ passes, contended, error: String(error) }));
} finally {
  closeIndex(handle);
}
`;

interface DrainResult {
  passes: number;
  /** Passes that met another writer and retried. Reported, not hidden. */
  contended: number;
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
   * A held write lock is still an exception, and that is the contract.
   *
   * An earlier version of this change absorbed SQLite contention inside
   * `updateIndex` and reported a pass that did nothing. Review reproduced two
   * defects in it and both were release blockers: a notes refresh that lost its
   * write lock returned normally with the old rows in place, so `openSource`
   * served a stale index as `coverage: "complete"` where it had previously
   * fallen back to a full scan — 1,073 records became one obsolete note, with
   * no diagnostic. It was withdrawn.
   *
   * What is pinned here instead is the behaviour that was always the contract:
   * the throw reaches the caller, and the query path turns it into a scan
   * rather than into a wrong answer. `openSource` is where that happens, and
   * `r-busy420` is the record that says the fallback is not dead code.
   */
  it('raises contention at its caller rather than reporting a pass that did nothing', () => {
    const dir = syntheticRepo(60);
    cold(dir);

    const handle = openIndex({ cwd: dir });
    const blocker = openIndex({ cwd: dir });
    try {
      blocker.db.exec('BEGIN IMMEDIATE');
      expect(() => updateIndex(handle, { budget: { deadline: 0, now: () => 1 } })).toThrow(
        /database is locked/,
      );
      blocker.db.exec('ROLLBACK');

      // And the work is still owed, not silently skipped: the passes that
      // follow finish it.
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
