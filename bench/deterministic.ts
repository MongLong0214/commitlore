import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { digestDistTree } from './hooks-settings.ts';
import { measureHookOverhead } from './deterministic/hooks.ts';
import { measureGuardQuality, measureInjectionDetection } from './deterministic/quality.ts';
import {
  assertSingleProvenance,
  writeDeterministicReport,
} from './deterministic/report.ts';
import { measureScale } from './deterministic/scale.ts';
import {
  assertCleanCheckout,
  git,
  parsePositiveInteger,
  parseSizes,
  rowBase,
} from './deterministic/shared.ts';
import { measureSurvival } from './deterministic/survival.ts';
import type { DeterministicRow } from './deterministic/types.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const REQUIRED_METRICS: ReadonlySet<DeterministicRow['metric']> = new Set([
  'query_latency',
  'record_survival',
  'injection_detection',
  'guard_quality',
  'hook_overhead',
  'index_cost',
]);

const stamp = (instant: string): string =>
  instant.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const assertComplete = (rows: readonly DeterministicRow[]): void => {
  const present = new Set(rows.map((row) => row.metric));
  const missing = [...REQUIRED_METRICS].filter((metric) => !present.has(metric));
  if (missing.length > 0) throw new Error(`deterministic dataset is missing: ${missing.join(', ')}`);
};

const main = (): void => {
  const testMode = process.env['NODE_ENV'] === 'test';
  const testOnlyOverride = [
    'COMMITLORE_DETERMINISTIC_SIZES',
    'COMMITLORE_DETERMINISTIC_RUNS',
    'COMMITLORE_DETERMINISTIC_ALLOW_SHORT',
    'COMMITLORE_DETERMINISTIC_SURVIVAL_RECORDS',
  ].find((name) => process.env[name] !== undefined);
  if (!testMode && testOnlyOverride !== undefined) {
    throw new Error(`${testOnlyOverride} is test-only; production measurements use the fixed protocol`);
  }

  const sizes = parseSizes(process.env['COMMITLORE_DETERMINISTIC_SIZES'] ?? '1000,10000,100000');
  const runs = parsePositiveInteger(
    'COMMITLORE_DETERMINISTIC_RUNS',
    process.env['COMMITLORE_DETERMINISTIC_RUNS'] ?? '20',
  );
  if (runs < 20 && (!testMode || process.env['COMMITLORE_DETERMINISTIC_ALLOW_SHORT'] !== '1')) {
    throw new Error('COMMITLORE_DETERMINISTIC_RUNS must be at least 20');
  }
  const survivalRecords = parsePositiveInteger(
    'COMMITLORE_DETERMINISTIC_SURVIVAL_RECORDS',
    process.env['COMMITLORE_DETERMINISTIC_SURVIVAL_RECORDS'] ?? '20',
  );
  const outputDir = resolve(
    REPO_ROOT,
    process.env['COMMITLORE_DETERMINISTIC_OUTPUT_DIR'] ?? join('bench', 'results'),
  );
  assertCleanCheckout(REPO_ROOT);
  const measuredAt = new Date().toISOString();
  const harnessCommit = git(REPO_ROOT, ['rev-parse', 'HEAD']).stdout.trim();
  const distDigest = digestDistTree();
  const base = rowBase(REPO_ROOT, harnessCommit, distDigest, measuredAt);
  const scratch = mkdtempSync(join(tmpdir(), 'commitlore-deterministic-'));

  try {
    process.stdout.write(`deterministic bench: query latency and index cost (${sizes.join(', ')} commits)\n`);
    const scale = measureScale(base, REPO_ROOT, scratch, sizes, runs);
    process.stdout.write(`deterministic bench: survival (${survivalRecords} records per operation)\n`);
    const survival = measureSurvival(base, scratch, survivalRecords);
    process.stdout.write('deterministic bench: injection detection and guard quality\n');
    const injection = measureInjectionDetection(base, REPO_ROOT);
    const guard = measureGuardQuality(base, REPO_ROOT);
    process.stdout.write(`deterministic bench: hook overhead (${runs} runs per arm)\n`);
    const hooks = measureHookOverhead(base, scratch, runs);
    const rows: readonly DeterministicRow[] = [
      ...scale.latency,
      ...survival,
      injection,
      guard,
      ...hooks,
      ...scale.index,
    ];

    assertSingleProvenance(rows);
    assertComplete(rows);
    const currentCommit = git(REPO_ROOT, ['rev-parse', 'HEAD']).stdout.trim();
    const currentDigest = digestDistTree();
    if (currentCommit !== harnessCommit || currentDigest !== distDigest) {
      throw new Error(
        `product changed during measurement: commit ${harnessCommit} -> ${currentCommit}, ` +
          `dist ${distDigest} -> ${currentDigest}`,
      );
    }
    assertCleanCheckout(REPO_ROOT);

    mkdirSync(outputDir, { recursive: true });
    const baseName = `deterministic-${stamp(measuredAt)}`;
    const jsonlPath = join(outputDir, `${baseName}.jsonl`);
    const reportPath = join(outputDir, `${baseName}.md`);
    writeFileSync(jsonlPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    writeDeterministicReport(reportPath, rows);
    process.stdout.write(`deterministic bench: wrote ${jsonlPath}\n`);
    process.stdout.write(`deterministic bench: wrote ${reportPath}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

main();
