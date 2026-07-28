import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { CLI_ENTRY } from '../hooks-settings.ts';
import { command, timed, timing } from './shared.ts';
import type {
  IndexCostRow,
  QueryCommand,
  QueryLatencyRow,
  QueryMode,
  RowBase,
} from './types.ts';

interface SyntheticSummary {
  readonly commits: number;
  readonly trailerCommits: number;
}

export const SCALE_SIZES = [1_000, 10_000, 100_000, 300_000] as const;

const parseSummary = (stdout: string): SyntheticSummary => {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('synthetic generator returned a non-object');
  }
  const commits = Reflect.get(parsed, 'commits');
  const trailerCommits = Reflect.get(parsed, 'trailerCommits');
  if (typeof commits !== 'number' || typeof trailerCommits !== 'number') {
    throw new Error('synthetic generator omitted commit counts');
  }
  return { commits, trailerCommits };
};

const QUERY_ARGS: Readonly<Record<QueryCommand, readonly string[]>> = {
  context: ['context', '--json', '--limit', '20'],
  limits: ['limits', '--json', '--limit', '20'],
  'ruled-out': ['ruled-out', '--json', '--limit', '20'],
  guard: ['guard', '--proposal', 'quartz telemetry adapter', '--json'],
};

const query = (
  repo: string,
  queryCommand: QueryCommand,
  mode: QueryMode,
): void => {
  const noIndex = mode === 'no-index' ? ['--no-index'] : [];
  command(process.execPath, [CLI_ENTRY, ...QUERY_ARGS[queryCommand], ...noIndex], {
    cwd: repo,
    allowed: [0, 2],
  });
};

export interface ScaleRows {
  readonly latency: readonly QueryLatencyRow[];
  readonly index: readonly IndexCostRow[];
}

export const measureScale = (
  base: RowBase,
  repoRoot: string,
  scratch: string,
  sizes: readonly number[],
  runs: number,
): ScaleRows => {
  const latency: QueryLatencyRow[] = [];
  const index: IndexCostRow[] = [];
  const generator = join(repoRoot, 'scripts', 'make-synthetic-repo.mjs');

  for (const commits of sizes) {
    const repo = join(scratch, `history-${commits}`);
    mkdirSync(repo, { recursive: true });
    const generated = command(
      process.execPath,
      [generator, '--out', repo, '--commits', String(commits)],
      { cwd: repoRoot },
    );
    const summary = parseSummary(generated.stdout);
    if (summary.trailerCommits === 0) {
      throw new Error(`${commits} synthetic commits produced no records; bytes per record is undefined`);
    }

    const buildMs = timed(() => {
      command(process.execPath, [CLI_ENTRY, 'index', '--rebuild', '--json'], { cwd: repo });
    });
    const sizeBytes = statSync(join(repo, '.git', 'commitlore', 'index.db')).size;
    index.push({
      ...base,
      metric: 'index_cost',
      commits: summary.commits,
      records: summary.trailerCommits,
      build_ms: buildMs,
      size_bytes: sizeBytes,
      bytes_per_record: sizeBytes / summary.trailerCommits,
    });

    for (const mode of ['indexed', 'no-index'] as const) {
      for (const queryCommand of ['context', 'limits', 'ruled-out', 'guard'] as const) {
        latency.push({
          ...base,
          metric: 'query_latency',
          commits: summary.commits,
          records: summary.trailerCommits,
          command: queryCommand,
          mode,
          timing: timing(() => query(repo, queryCommand, mode), runs),
        });
      }
    }
  }
  return { latency, index };
};
