/**
 * Two processes, one forced ordering (#958).
 *
 * Everything this project says about two processes indexing at once has been
 * argued from the transaction boundary and reproduced by injecting an
 * interleaving inside a single process. The existing concurrency suite starts
 * several processes at the same moment and checks the result afterwards, which
 * cannot establish that either one reached the phase that matters before the
 * other finished — its own cold-start assertion only requires that the index is
 * not absent.
 *
 * This forces the ordering instead. The budget's clock is read inside the scan,
 * after the drain has selected its queue rows and before the transaction that
 * retires them, so a child that blocks on a counted reading is holding exactly
 * the window another process can move the queue in. The release is a file the
 * parent creates; no sleep stands in for "the other side got there".
 *
 * The mutation this discriminates is the one a review found by inspection:
 * retiring a queue entry by position alone. A rebuild landing in that window
 * replaces the queue, so the positions the child selected now name work nobody
 * has done — and deleting by position retires it, silently, leaving an index
 * that calls itself complete with records missing.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { closeIndex, ensureIndex, openIndex, updateIndex, type IndexHandle } from '../src/core/index-db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..');
const SYNTHETIC_REPO = join(PACKAGE_ROOT, 'scripts', 'make-synthetic-repo.mjs');

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const scratch = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-ordering-${label}-`));
  temporaries.push(dir);
  return dir;
};

const syntheticRepo = (commits: number): string => {
  const dir = scratch('repo');
  execFileSync(process.execPath, [
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
  ], { encoding: 'utf8' });
  return dir;
};

/**
 * A drainer that stops inside the scan and waits to be let go.
 *
 * It blocks synchronously, because the clock callback is synchronous: an async
 * wait would return a clock reading and let the scan carry on, which is the one
 * thing the barrier must not do. `Atomics.wait` is the only synchronous sleep
 * Node offers.
 */
const WORKER = (): string => `
import { existsSync, writeFileSync } from 'node:fs';
import { ensureIndex, closeIndex, indexUnread } from ${JSON.stringify(join(PACKAGE_ROOT, 'dist', 'core', 'index-db.js'))};

const [dir, holdAt, ready, release] = process.argv.slice(2);
const pause = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

let readings = 0;
const now = () => {
  readings += 1;
  if (readings === Number(holdAt)) {
    writeFileSync(ready, 'held');
    while (!existsSync(release)) pause(10);
  }
  // Generous enough that the guaranteed first batch completes, then spent.
  return readings <= 3 ? 0 : 9_000;
};

const { handle, stats } = ensureIndex({ cwd: dir, budget: { deadline: 4_000, now } });
const left = indexUnread(handle);
closeIndex(handle);
process.stdout.write(JSON.stringify({ scanned: stats.commitsScanned, left, readings }));
`;

const withIndex = <T>(dir: string, fn: (handle: IndexHandle) => T): T => {
  const handle = openIndex({ cwd: dir });
  try {
    return fn(handle);
  } finally {
    closeIndex(handle);
  }
};

interface PendingRow {
  ord: number;
  sha: string;
}

const queueOf = (handle: IndexHandle): PendingRow[] =>
  handle.db
    .prepare(`SELECT ord, sha FROM scan_pending WHERE source = 'commit' ORDER BY ord`)
    .all()
    .map((row) => ({ ord: Number(row.ord), sha: String(row.sha) }));

const cold = (dir: string): void => {
  rmSync(join(dir, '.git', 'commitlore'), { recursive: true, force: true });
  mkdirSync(join(dir, '.git', 'commitlore'), { recursive: true });
};

/** Resolves when the path appears, or rejects — never resolves on a timer. */
const awaitFile = async (path: string, whatFor: string): Promise<void> => {
  const deadline = Date.now() + 120_000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${whatFor}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('#958 a forced ordering between two indexing processes', () => {
  it('retires none of a queue that was replaced while it was reading', async () => {
    const dir = syntheticRepo(400);
    cold(dir);

    // A truncated scan, so there is a queue for the child to select from.
    let seen = 0;
    closeIndex(
      ensureIndex({ cwd: dir, budget: { deadline: 1_000, now: () => (++seen <= 2 ? 0 : 2_000) } })
        .handle,
    );
    const before = withIndex(dir, queueOf);
    expect(before.length, 'the fixture must leave a queue to contend over').toBeGreaterThan(64);

    const signals = scratch('signals');
    const ready = join(signals, 'held');
    const release = join(signals, 'go');
    const workerPath = join(signals, 'worker.mjs');
    writeFileSync(workerPath, WORKER());

    // Reading 1 computes the drain's own ceiling, before it selects anything.
    // Reading 2 is inside the scan: the selection is made, the guaranteed first
    // batch is being read, and no transaction is open. That is the window.
    const child = spawn(process.execPath, [workerPath, dir, '2', ready, release], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    const finished = new Promise<number>((resolve) => child.on('close', (code) => resolve(code ?? -1)));

    let replaced: PendingRow[] = [];
    try {
      await awaitFile(ready, 'the child to reach its barrier');

      // The other process: a rebuild that reads nothing and therefore queues the
      // whole walk. Every position the child selected now names a different
      // commit, and none of that work has been done.
      const handle = openIndex({ cwd: dir });
      try {
        updateIndex(handle, { force: true, budget: { deadline: -1, now: () => 0 } });
      } finally {
        closeIndex(handle);
      }
      replaced = withIndex(dir, queueOf);
      expect(replaced.length, 'the rebuild must have replaced the queue').toBeGreaterThan(
        before.length,
      );

      writeFileSync(release, 'go');
      const code = await finished;
      expect(code, `child failed: ${stderr}`).toBe(0);
      expect(stdout.length, 'the child must have run the drain').toBeGreaterThan(0);
    } finally {
      child.kill();
    }

    // The child read work from the queue it selected, and that queue is gone.
    // Nothing it read names a row in the queue that exists now, so the queue
    // must be exactly what the rebuild installed. Retiring by position alone
    // deletes rows here — the rebuild's own unread prefix — and the index then
    // converges to a state that is missing them.
    expect(withIndex(dir, queueOf)).toEqual(replaced);
  }, 300_000);
});
