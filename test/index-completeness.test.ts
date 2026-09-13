/**
 * #968: a rebuild must not replace a more complete index with a shorter scan.
 *
 * `rebuildIndex` scans outside its transaction and replaces every table inside
 * it, with no comparison against what is installed. So a scan that started
 * earlier and read less can land on top of one that read more. That was a claim
 * from inspection until it was run: holding a budgeted rebuild inside its scan
 * while another committed a whole one turned a complete index — 10,290 trailer
 * rows, nothing outstanding — into 591 rows with 1,491 commits owed.
 *
 * Recoverable, because `scan_pending` names exactly what is left and later
 * drains converge on it. Also a 6%-complete index answering every query in the
 * meantime, which on the edit-hook path is many of them.
 *
 * The ordering is forced rather than raced for, the same way
 * `index-concurrency-ordering.test.ts` does it: the budget's clock is read
 * inside the scan, so a child that blocks on a counted reading is holding the
 * window the other process needs. The release is a file; no sleep stands in for
 * "the other side committed".
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  closeIndex,
  ensureIndex,
  indexUnread,
  openIndex,
  updateIndex,
  type IndexHandle,
} from '../src/core/index-db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..');
const SYNTHETIC_REPO = join(PACKAGE_ROOT, 'scripts', 'make-synthetic-repo.mjs');

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const scratch = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-complete-${label}-`));
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
      '0.2',
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

const trailerCount = (handle: IndexHandle): number =>
  Number((handle.db.prepare('SELECT count(*) AS n FROM trailers').get() as { n: number }).n);

/**
 * A budgeted rebuild that stops inside its scan, having read a short prefix.
 *
 * It blocks synchronously: the clock callback is synchronous, and an async wait
 * would return a reading and let the scan carry on, which is the one thing the
 * barrier must not do.
 */
const REBUILD_WORKER = `
import { existsSync, writeFileSync } from 'node:fs';
import { openIndex, closeIndex, updateIndex } from ${JSON.stringify(join(PACKAGE_ROOT, 'dist', 'core', 'index-db.js'))};

const [dir, ready, release] = process.argv.slice(2);
const pause = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

let readings = 0;
const now = () => {
  readings += 1;
  if (readings === 3) {
    writeFileSync(ready, 'held');
    while (!existsSync(release)) pause(10);
  }
  return readings <= 3 ? 0 : 9_000;
};

const handle = openIndex({ cwd: dir });
try {
  const stats = updateIndex(handle, { force: true, budget: { deadline: 4_000, now } });
  process.stdout.write(JSON.stringify({ scanned: stats.commitsScanned, rebuilt: stats.rebuilt }));
} finally {
  closeIndex(handle);
}
`;

/** Resolves when the path appears, or throws — never resolves on a timer. */
const awaitFile = async (path: string, whatFor: string): Promise<void> => {
  const deadline = Date.now() + 120_000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${whatFor}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('#968 completeness does not decrease under a concurrent rebuild', () => {
  it('keeps the more complete index when a shorter scan arrives late', async () => {
    const dir = syntheticRepo(400);
    cold(dir);

    const signals = scratch('signals');
    const ready = join(signals, 'held');
    const release = join(signals, 'go');
    const workerPath = join(signals, 'rebuild.mjs');
    writeFileSync(workerPath, REBUILD_WORKER);

    const child = spawn(process.execPath, [workerPath, dir, ready, release], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    const finished = new Promise<number>((resolve) =>
      child.on('close', (code) => resolve(code ?? -1)),
    );

    let whole = 0;
    try {
      await awaitFile(ready, 'the held rebuild to reach its barrier');

      // The other process finishes a whole rebuild while the first is held.
      const handle = openIndex({ cwd: dir });
      try {
        updateIndex(handle, { force: true });
        whole = trailerCount(handle);
      } finally {
        closeIndex(handle);
      }

      // The premise, checked rather than assumed: without a complete index
      // installed there is nothing for the held rebuild to make worse.
      expect(whole, 'the complete rebuild must have indexed something').toBeGreaterThan(0);
      expect(withIndex(dir, indexUnread), 'and must owe nothing').toBe(0);

      writeFileSync(release, 'go');
      expect(await finished, `child failed: ${stderr}`).toBe(0);
      expect(stdout.length, 'the child must have run its rebuild').toBeGreaterThan(0);
    } finally {
      child.kill();
    }

    expect(withIndex(dir, trailerCount)).toBe(whole);
    expect(withIndex(dir, indexUnread)).toBe(0);
  }, 300_000);

  it('still lets an unbudgeted rebuild replace whatever is installed', () => {
    const dir = syntheticRepo(200);
    cold(dir);
    closeIndex(ensureIndex({ cwd: dir }).handle);
    const whole = withIndex(dir, trailerCount);
    expect(whole).toBeGreaterThan(0);

    // The deferral is scoped to budgeted rebuilds deliberately. Without a
    // budget the caller is `index` or `init` — somebody asked — and the reason
    // may be corruption or a schema this build cannot read, so it must replace
    // what is installed however complete that looks from the outside.
    const handle = openIndex({ cwd: dir });
    try {
      const stats = updateIndex(handle, { force: true });
      expect(stats.rebuilt).toBe(true);
      expect(stats.rebuildReason).toBe('rebuild requested');
      expect(trailerCount(handle)).toBe(whole);
    } finally {
      closeIndex(handle);
    }
  }, 300_000);
});
