import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { digestDistTree } from './hooks-settings.ts';
import { measureCaptureCost } from './deterministic/capture.ts';
import { measureDensity } from './deterministic/density.ts';
import { measureHookOverhead } from './deterministic/hooks.ts';
import { measureTokenLedger } from './deterministic/ledger.ts';
import { measureNoiseExposure } from './deterministic/noise.ts';
import { measureGuardQuality, measureInjectionDetection } from './deterministic/quality.ts';
import { measureDecisionDelivery } from './deterministic/recovery.ts';
import {
  assertSingleProvenance,
  writeDeterministicReport,
} from './deterministic/report.ts';
import { measureScale, SCALE_SIZES } from './deterministic/scale.ts';
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
  'capture_cost',
  'index_cost',
  'noise_exposure',
  'decision_delivery',
  'rationale_density',
  'token_ledger',
]);

const stamp = (instant: string): string =>
  instant.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const assertComplete = (rows: readonly DeterministicRow[]): void => {
  const present = new Set(rows.map((row) => row.metric));
  const missing = [...REQUIRED_METRICS].filter((metric) => !present.has(metric));
  if (missing.length > 0) throw new Error(`deterministic dataset is missing: ${missing.join(', ')}`);
};

const assertNoConcurrentDeterministicBench = (): void => {
  const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  if (ps.error !== undefined) throw ps.error;
  // Match only a node process actually executing the bench, not every process
  // whose command line mentions it. A shell that launched this run carries the
  // path in its own argv, and so does the wrapper any CI or tool harness uses,
  // so a substring test refuses the first honest run and teaches the user to
  // delete the guard.
  const matches = ps.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /\bnode\b[^\n]*\bbench\/deterministic\.ts\b/.test(line))
    .filter((line) => !/\b(?:z|ba|)sh\b\s+-[a-z]*c\b/.test(line))
    .filter((line) => Number(line.split(/\s+/, 1)[0]) !== process.pid)
    .filter((line) => Number(line.split(/\s+/, 1)[0]) !== process.ppid);
  if (matches.length > 0) {
    throw new Error(`deterministic benchmark refused: another bench/deterministic process is running:\n${matches.join('\n')}`);
  }
  process.stdout.write('deterministic bench: checked no concurrent bench/deterministic process\n');
};

const main = (): void => {
  const testMode = process.env['NODE_ENV'] === 'test';
  const densityOnly = process.env['COMMITLORE_DETERMINISTIC_DENSITY_ONLY'] === '1';
  const recoveryOnly = process.env['COMMITLORE_DETERMINISTIC_RECOVERY_ONLY'] === '1';
  const ledgerOnly = process.env['COMMITLORE_DETERMINISTIC_LEDGER_ONLY'] === '1';
  const selected = [densityOnly, recoveryOnly, ledgerOnly].filter(Boolean).length;
  if (selected > 1) {
    throw new Error(
      'COMMITLORE_DETERMINISTIC_DENSITY_ONLY, _RECOVERY_ONLY and _LEDGER_ONLY are mutually exclusive',
    );
  }
  // Every single-metric mode reads this repository's own history rather than a
  // synthetic fixture, so none produces a complete dataset. They part company
  // over the concurrency refusal: r-densitymerge135 exempted density, which is
  // seconds of `git log`, while delivery spends minutes projecting every path
  // through the index and would contend with a wall-clock arm the same record
  // forbids contending with. The ledger reports no timing at all -- it counts
  // characters -- so a neighbouring process cannot move a figure in it, and it
  // is exempted for the reason density is.
  const singleMetric = densityOnly || recoveryOnly || ledgerOnly;
  const testOnlyOverride = [
    'COMMITLORE_DETERMINISTIC_SIZES',
    'COMMITLORE_DETERMINISTIC_RUNS',
    'COMMITLORE_DETERMINISTIC_ALLOW_SHORT',
    'COMMITLORE_DETERMINISTIC_SURVIVAL_RECORDS',
  ].find((name) => process.env[name] !== undefined);
  if (!testMode && testOnlyOverride !== undefined) {
    throw new Error(`${testOnlyOverride} is test-only; production measurements use the fixed protocol`);
  }

  const sizes = parseSizes(process.env['COMMITLORE_DETERMINISTIC_SIZES'] ?? SCALE_SIZES.join(','));
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
  if (!densityOnly && !ledgerOnly) assertNoConcurrentDeterministicBench();
  const measuredAt = new Date().toISOString();
  const harnessCommit = git(REPO_ROOT, ['rev-parse', 'HEAD']).stdout.trim();
  const distDigest = digestDistTree();
  const base = rowBase(REPO_ROOT, harnessCommit, distDigest, measuredAt);
  const scratch = mkdtempSync(join(tmpdir(), 'commitlore-deterministic-'));

  try {
    const rows: readonly DeterministicRow[] = densityOnly
      ? [measureDensity(base, REPO_ROOT)]
      : ledgerOnly
      ? [
          measureTokenLedger(base, REPO_ROOT, 'HEAD', (line) => {
            process.stdout.write(`${line}\n`);
          }),
        ]
      : recoveryOnly
      ? measureDecisionDelivery(base, REPO_ROOT, 'HEAD', (line) => {
          process.stdout.write(`${line}\n`);
        })
      : (() => {
          process.stdout.write(`deterministic bench: query latency and index cost (${sizes.join(', ')} commits)\n`);
          const scale = measureScale(base, REPO_ROOT, scratch, sizes, runs);
          process.stdout.write(`deterministic bench: survival (${survivalRecords} records per operation)\n`);
          const survival = measureSurvival(base, scratch, survivalRecords);
          process.stdout.write('deterministic bench: injection detection and guard quality\n');
          const injection = measureInjectionDetection(base, REPO_ROOT);
          const guard = measureGuardQuality(base, REPO_ROOT);
          process.stdout.write(`deterministic bench: hook overhead (${runs} runs per arm)\n`);
          const hooks = measureHookOverhead(base, scratch, runs);
          process.stdout.write(`deterministic bench: record capture cost (${runs} runs per command)\n`);
          const capture = measureCaptureCost(base, REPO_ROOT, runs);
          process.stdout.write('deterministic bench: irrelevant decision-context exposure\n');
          const exposure = measureNoiseExposure(base);
          process.stdout.write('deterministic bench: active-record delivery before the first edit\n');
          const delivery = measureDecisionDelivery(base, REPO_ROOT, 'HEAD', (line) => {
            process.stdout.write(`${line}\n`);
          });
          process.stdout.write('deterministic bench: rationale density\n');
          const density = measureDensity(base, REPO_ROOT);
          process.stdout.write('deterministic bench: token ledger\n');
          const ledger = measureTokenLedger(base, REPO_ROOT, 'HEAD', (line) => {
            process.stdout.write(`${line}\n`);
          });
          return [
            ...scale.latency,
            ...survival,
            injection,
            guard,
            ...hooks,
            capture,
            ...scale.index,
            ...exposure,
            ...delivery,
            density,
            ledger,
          ];
        })();

    assertSingleProvenance(rows);
    if (!singleMetric) assertComplete(rows);
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
    // A single-metric run is not a deterministic dataset and must not be read as
    // one, so it does not borrow the name. `decision-delivery-*` is what
    // bench/DECISION-DELIVERY.md cites and `token-ledger-*` is what
    // bench/TOKEN-LEDGER.md cites.
    const prefix = recoveryOnly ? 'decision-delivery' : ledgerOnly ? 'token-ledger' : 'deterministic';
    const baseName = `${prefix}-${stamp(measuredAt)}`;
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
