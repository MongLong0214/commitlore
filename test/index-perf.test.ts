/**
 * T-203 performance shape, measured rather than asserted.
 *
 * PRD-F2 AC 2 wants p50 < 100ms for a path-scoped query on a 100k-commit
 * repository. That repository takes minutes to build, so it is opt-in
 * (`COMMITLORE_PERF_LARGE=1`) and the default run uses a 2k-commit repository
 * instead.
 *
 * There is deliberately no tight threshold here. A wall-clock budget on
 * somebody else's CI runner fails for reasons that have nothing to do with
 * this code, and a test that fails for unrelated reasons stops being read. The
 * numbers are printed; the only failure is pathological (a single query over
 * five seconds), which means an index was not used at all.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  closeIndex,
  openIndex,
  queryTrailers,
  rebuildIndex,
  scanTrailers,
  updateIndex,
  type IndexHandle,
  type TrailerQuery,
} from '../src/core/index-db.js';

const GENERATOR = fileURLToPath(new URL('../scripts/make-synthetic-repo.mjs', import.meta.url));

/** A single query taking longer than this means no index was consulted. */
const PATHOLOGICAL_MS = 5000;

const LARGE = process.env['COMMITLORE_PERF_LARGE'] === '1';
const COMMITS = Number(process.env['COMMITLORE_PERF_COMMITS'] ?? (LARGE ? 100000 : 2000));

const temporaries: string[] = [];

afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

interface Synthetic {
  dir: string;
  commits: number;
  trailerCommits: number;
  elapsedMs: number;
}

const makeSyntheticRepo = (commits: number): Synthetic => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-perf-'));
  temporaries.push(dir);

  const result = spawnSync(
    process.execPath,
    [GENERATOR, '--out', dir, '--commits', String(commits), '--force'],
    { encoding: 'utf8', shell: false },
  );
  if (result.status !== 0) {
    throw new Error(`make-synthetic-repo failed (${result.status}):\n${result.stderr}`);
  }

  const summary = JSON.parse(result.stdout) as {
    commits: number;
    trailerCommits: number;
    elapsedMs: number;
  };
  return { dir, ...summary };
};

const median = (samples: number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted[middle] ?? Number.NaN;
};

const timeQuery = (run: () => unknown, iterations: number): { p50: number; max: number } => {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const started = process.hrtime.bigint();
    run();
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  return { p50: median(samples), max: Math.max(...samples) };
};

const PROBES: { label: string; query: TrailerQuery }[] = [
  { label: 'path-scoped (module)', query: { path: 'src/mod-003' } },
  { label: 'path-scoped + key', query: { keys: ['Limit'], path: 'src/mod-005' } },
  { label: 'key only, limit 20', query: { keys: ['Warn'], limit: 20 } },
  { label: 'substring (fts5)', query: { text: 'rate limited' } },
  { label: 'substring (2 chars, no fts5)', query: { text: 'ca' } },
  { label: 'whole index', query: {} },
];

const report = (lines: string[]): void => {
  process.stdout.write(`\n${lines.join('\n')}\n\n`);
};

const measure = (handle: IndexHandle, repo: Synthetic, iterations: number): void => {
  const lines = [`  synthetic repo: ${repo.commits} commits, ${repo.trailerCommits} carry a record`];

  for (const probe of PROBES) {
    const timing = timeQuery(() => queryTrailers(handle, probe.query), iterations);
    const rows = queryTrailers(handle, probe.query).length;
    lines.push(
      `  ${probe.label.padEnd(30)} p50 ${timing.p50.toFixed(2).padStart(8)}ms  ` +
        `max ${timing.max.toFixed(2).padStart(8)}ms  (${rows} rows)`,
    );
    expect(
      timing.max,
      `${probe.label} took ${timing.max.toFixed(0)}ms — the index is not being used`,
    ).toBeLessThan(PATHOLOGICAL_MS);
  }

  report(lines);
};

describe('index-db performance', () => {
  it(
    'indexes a synthetic repository and answers scoped queries',
    () => {
      const repo = makeSyntheticRepo(COMMITS);
      const handle = openIndex({ cwd: repo.dir });

      try {
        const started = process.hrtime.bigint();
        const stats = rebuildIndex(handle);
        const rebuildMs = Number(process.hrtime.bigint() - started) / 1e6;

        expect(stats.commitsScanned).toBe(repo.commits);
        expect(stats.trailersIndexed).toBeGreaterThan(0);

        /* The prose commits carry a B3 paragraph. None of them may be indexed. */
        expect(new Set(queryTrailers(handle, {}).map((row) => row.sha)).size).toBe(
          repo.trailerCommits,
        );

        report([
          `  generate   ${repo.elapsedMs}ms for ${repo.commits} commits`,
          `  rebuild    ${rebuildMs.toFixed(0)}ms — ${stats.trailersIndexed} trailers, ` +
            `${stats.pathsIndexed} paths, fts5=${stats.fts}`,
        ]);

        measure(handle, repo, 21);

        const incrementalStart = process.hrtime.bigint();
        const incremental = updateIndex(handle);
        const incrementalMs = Number(process.hrtime.bigint() - incrementalStart) / 1e6;
        expect(incremental.rebuilt).toBe(false);
        report([`  no-op update ${incrementalMs.toFixed(1)}ms`]);
      } finally {
        closeIndex(handle);
      }
    },
    LARGE ? 1_800_000 : 300_000,
  );

  it(
    'costs more without an index, and returns the same rows',
    () => {
      const repo = makeSyntheticRepo(Math.min(COMMITS, 2000));
      const handle = openIndex({ cwd: repo.dir });

      try {
        rebuildIndex(handle);
        const query: TrailerQuery = { path: 'src/mod-003', keys: ['Limit'] };

        const indexed = timeQuery(() => queryTrailers(handle, query), 11);
        const scanned = timeQuery(() => scanTrailers(query, { cwd: repo.dir }), 3);

        expect(queryTrailers(handle, query)).toEqual(scanTrailers(query, { cwd: repo.dir }));

        report([
          `  ${repo.commits} commits, identical results both ways`,
          `  index      p50 ${indexed.p50.toFixed(2)}ms`,
          `  --no-index p50 ${scanned.p50.toFixed(0)}ms  (${(scanned.p50 / Math.max(indexed.p50, 0.001)).toFixed(0)}x slower)`,
        ]);
      } finally {
        closeIndex(handle);
      }
    },
    300_000,
  );

  it.skipIf(!LARGE)(
    'meets the PRD-F2 target of p50 < 100ms on a 100k-commit repository',
    () => {
      const repo = makeSyntheticRepo(100000);
      const handle = openIndex({ cwd: repo.dir });

      try {
        rebuildIndex(handle);
        const timing = timeQuery(() => queryTrailers(handle, { path: 'src/mod-042' }), 51);
        report([`  100k commits · path-scoped p50 ${timing.p50.toFixed(2)}ms`]);
        expect(timing.p50).toBeLessThan(100);
      } finally {
        closeIndex(handle);
      }
    },
    3_600_000,
  );
});
