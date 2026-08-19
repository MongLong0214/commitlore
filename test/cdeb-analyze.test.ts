/**
 * CDEB-08 controls.  These are deliberately generated fixtures rather than a
 * procedure for someone to perform after a study: the analyzer has to keep
 * proving its arithmetic every time the suite runs.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_REPLICATES,
  MIN_FINITE_TOKEN_REPLICATES,
  analysisSourceDigest,
  analyzeStudy,
  renderReport,
} from '../bench/cdeb/analyze.ts';

const scratch: string[] = [];

afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

const temporaryStudy = (label: string): string => {
  const directory = mkdtempSync(join(tmpdir(), `cdeb-analyze-${label}-`));
  scratch.push(directory);
  return directory;
};

const HEX64 = 'a'.repeat(64);
const OID = 'b'.repeat(40);
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

type Scenario = 'null' | 'positive';

interface StudyOptions {
  readonly scenario: Scenario;
  readonly unavailable?: { readonly repository: number; readonly task: number; readonly arm: 'on' | 'off'; readonly repeat: number };
  /** Four task cells × three repeats gives the point-estimate minimum of 12. */
  readonly sparseOffSafe?: boolean;
}

const frozenRowFiles = (): string[] =>
  Array.from({ length: 180 }, (_unused, index) => `rows/block-${String(index).padStart(3, '0')}.json`);

/**
 * Categories are assigned by a task's position in the whole corpus, not by
 * `repository * 6 + task`. With four repositories carrying eight, eight, seven
 * and seven, that arithmetic no longer names a unique task, and the quota it
 * feeds is checked against the corpus rather than against any repository.
 */
const categoryFor = (index: number): string => {
  if (index < 12) return 'rejected-architecture';
  if (index < 20) return 'rejected-workaround';
  if (index < 25) return 'compatibility-constraint';
  if (index < 28) return 'security-operational';
  return 'superseded-lifecycle';
};

const freezeFor = (rowFiles: readonly string[]): Record<string, unknown> => ({
  schema_version: 1,
  benchmark: 'cdeb-v1',
  protocol_version: '1.3.0',
  study_id: 'cdeb-control-01',
  sealed_task_bundle_sha256: HEX64,
  repository_bundles: Array.from({ length: 4 }, (_unused, index) => ({
    repository_id: `repo-${String(index)}`,
    bundle_sha256: HEX64,
    snapshot_commit: OID,
    snapshot_tree_oid: OID,
  })),
  agent_runtime_image_digest: `sha256:${HEX64}`,
  requested_model: 'pinned-model',
  observed_model_id: 'observed-pinned-model',
  agent_cli_version: '1.0.0',
  product_commit: OID,
  dist_digest: HEX64,
  evaluator_image_digests: [`sha256:${HEX64}`],
  analysis_source_digest: analysisSourceDigest(),
  bootstrap_seed: 'cdeb-control-seed',
  calibrated_overhead: 1.45,
  claim_thresholds: {
    safe_success_lift_pp: 10,
    token_volume_reduction: 0.15,
    revival_reduction: 0.3,
    min_off_revivals: 10,
    min_safe_successes_per_arm: 10,
    min_finite_replicates: 9900,
  },
  expected_logical_runs: 180,
  analysis_inputs: { row_files: rowFiles },
});

const rowFor = (
  options: StudyOptions,
  freezeSha: string,
  repository: number,
  task: number,
  ordinal: number,
  arm: 'on' | 'off',
  repeat: number,
): Record<string, unknown> => {
  const sparseSafe = options.sparseOffSafe === true && repository < 4 && task === 0;
  const offSafe = options.scenario === 'null'
    ? repeat === 1
    : options.sparseOffSafe === true
      ? sparseSafe
      : repeat === 1;
  const safe = arm === 'on'
    ? (options.scenario === 'positive' || repeat === 1)
    : offSafe;
  const revived = options.scenario === 'null'
    ? repeat === 2
    : arm === 'off' && (options.sparseOffSafe === true ? !offSafe && repeat === 1 : repeat === 2);
  const unavailable = options.unavailable !== undefined &&
    options.unavailable.repository === repository &&
    options.unavailable.task === task &&
    options.unavailable.arm === arm &&
    options.unavailable.repeat === repeat;
  // The first task's unequal ON/OFF TVPDSS makes an average of task ratios
  // disagree with the registered ratio of sums.
  const volume = options.scenario === 'positive'
    ? repository === 0 && task === 0
      ? arm === 'on' ? 200 : 100
      : arm === 'on' ? 10 : 300
    : 100;
  const usage = unavailable
    ? { availability: 'unavailable', reasons: ['terminal_usage_absent'] }
    : {
      availability: 'measured',
      input_tokens: volume,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      total_token_volume: volume,
    };
  return {
    benchmark: 'cdeb-v1',
    protocol_version: '1.3.0',
    study_id: 'cdeb-control-01',
    logical_run_id: `repo-${String(repository)}__task-${String(task)}__${arm}__r${String(repeat)}`,
    repository_id: `repo-${String(repository)}`,
    task_id: `task-${String(task)}`,
    category: categoryFor(ordinal),
    condition: arm === 'on' ? 'commitlore-on' : 'commitlore-off',
    repeat,
    freeze_manifest_sha256: freezeSha,
    sealed_task_bundle_sha256: HEX64,
    repository_bundle_sha256: HEX64,
    repository_snapshot: OID,
    base_tree_oid: OID,
    requested_model: 'pinned-model',
    observed_model_ids: ['observed-pinned-model'],
    agent_cli_version: '1.0.0',
    agent_runtime_image_digest: `sha256:${HEX64}`,
    product_commit: OID,
    dist_digest: HEX64,
    usage,
    stop_reason: 'completed',
    evaluation: {
      evaluator_image_digest: `sha256:${HEX64}`,
      evaluator_attempts: 1,
      functional_pass: safe || revived,
      rejected_decision_revived: revived,
    },
    exposure: {
      hook_opportunities: arm === 'on' ? 1 : 0,
      proxy_executions: arm === 'on' ? 1 : 0,
      product_failures: 0,
      delivered_record_ids: arm === 'on' ? ['r-abc123'] : [],
    },
    decision_safe_success: safe,
    simulated: false,
  };
};

const writeStudy = (options: StudyOptions): string => {
  const directory = temporaryStudy(options.scenario);
  const rowFiles = frozenRowFiles();
  const freeze = freezeFor(rowFiles);
  const freezeText = `${JSON.stringify(freeze, null, 2)}\n`;
  writeFileSync(join(directory, 'public-freeze.json'), freezeText);
  mkdirSync(join(directory, 'rows'));
  const freezeSha = sha256(freezeText);
  let rowIndex = 0;
  // Four repositories carrying thirty tasks (PRD §3.3, amended 2026-08-19).
  // Uneven on purpose: thirty does not divide by four, and the amendment reads
  // "six per repository" as a floor rather than an equal share. A fixture that
  // quietly used twenty-four would stop representing a corpus the gate accepts.
  const TASKS_PER_REPOSITORY = [8, 8, 7, 7];
  let ordinal = 0;
  for (let repository = 0; repository < TASKS_PER_REPOSITORY.length; repository += 1) {
    for (let task = 0; task < (TASKS_PER_REPOSITORY[repository] ?? 0); task += 1) {
      for (const arm of ['on', 'off'] as const) {
        for (let repeat = 1; repeat <= 3; repeat += 1) {
          writeFileSync(
            join(directory, rowFiles[rowIndex] as string),
            `${JSON.stringify(rowFor(options, freezeSha, repository, task, ordinal, arm, repeat))}\n`,
          );
          rowIndex += 1;
        }
      }
      ordinal += 1;
    }
  }
  return directory;
};

describe('CDEB-08 analyzer controls', () => {
  it('refuses a row file on disk that the freeze does not name', () => {
    const directory = writeStudy({ scenario: 'positive' });
    writeFileSync(join(directory, 'rows', 'unfrozen-row.json'), '{}\n');

    expect(() => analyzeStudy(directory)).toThrow(/present on disk but absent from freeze/);
  });

  it('null control yields no registered claim', () => {
    const analysis = analyzeStudy(writeStudy({ scenario: 'null' }));

    expect(analysis.metrics.safe_success.lift).toBe(0);
    expect(analysis.metrics.token.reduction).toBe(0);
    expect(analysis.metrics.revival.absolute_difference).toBe(0);
    expect(analysis.gates.performance.status).toBe('FAIL');
    expect(analysis.gates.token_efficiency.status).toBe('FAIL');
    expect(analysis.gates.mechanism.status).toBe('FAIL');
    expect(analysis.gates.core_behavior_headline).toBe('FAIL');
    expect(analysis.gates.combined_headline).toBe('FAIL');
  });

  it('positive control recovers its known effects with ratio-of-sums TVPDSS', () => {
    const analysis = analyzeStudy(writeStudy({ scenario: 'positive' }));
    const expectedReduction = 1 - (1470 / 90) / (26400 / 30);
    const meanOfTaskRatios = ((1 - 200 / 300) + 29 * (1 - 10 / 900)) / 30;

    expect(analysis.metrics.safe_success.lift).toBeCloseTo(2 / 3, 12);
    expect(analysis.metrics.token.reduction).toBeCloseTo(expectedReduction, 12);
    expect(analysis.metrics.token.reduction).not.toBeCloseTo(meanOfTaskRatios, 6);
    expect(analysis.metrics.revival.absolute_difference).toBeCloseTo(-1 / 3, 12);
    expect(analysis.gates.performance.status).toBe('PASS');
    expect(analysis.gates.token_efficiency.status).toBe('PASS');
    expect(analysis.gates.mechanism.status).toBe('PASS');
    expect(analysis.gates.core_behavior_headline).toBe('PASS');
    expect(analysis.gates.combined_headline).toBe('PASS');
  });

  it('reports a finite-replicate tail p rather than zero at 10,000 draws', () => {
    const directory = writeStudy({ scenario: 'positive' });
    const analysis = analyzeStudy(directory);
    const report = readFileSync(join(directory, 'RESULT.md'), 'utf8');

    expect(analysis.bootstrap.safe_success_lift.replicates).toBe(BOOTSTRAP_REPLICATES);
    expect(analysis.bootstrap.safe_success_lift.tail_p).toBeGreaterThan(0);
    expect(report).toMatch(/tail p 0\.0001/);
    expect(report).not.toContain('tail p 0.0000');
  });

  it('uses the absolute revival difference in the report and mechanism gate', () => {
    const directory = writeStudy({ scenario: 'positive' });
    const analysis = analyzeStudy(directory);
    const report = readFileSync(join(directory, 'RESULT.md'), 'utf8');

    expect(analysis.bootstrap.revival_absolute_difference.interval_95?.upper).toBeLessThan(0);
    expect(report).toContain('Absolute difference (ON - OFF) -33.3pp');
    expect(report).not.toContain('Absolute difference (ON - OFF) -100.0%');
  });

  it('makes token efficiency not measurable below the finite-replicate rule', () => {
    const analysis = analyzeStudy(writeStudy({ scenario: 'positive', sparseOffSafe: true }));

    expect(analysis.metrics.safe_success.off).toBe(12);
    expect(analysis.bootstrap.token_volume_reduction.finite_tvpdss_replicates).toBeLessThan(MIN_FINITE_TOKEN_REPLICATES);
    expect(analysis.gates.token_efficiency.status).toBe('NOT MEASURABLE');
  });

  it('keeps behavior gates independent when one run has unavailable usage', () => {
    const directory = writeStudy({
      scenario: 'positive',
      unavailable: { repository: 0, task: 0, arm: 'on', repeat: 1 },
    });
    const analysis = analyzeStudy(directory);
    const report = readFileSync(join(directory, 'RESULT.md'), 'utf8');

    expect(analysis.metrics.token.availability).toBe('unavailable');
    expect(analysis.gates.token_efficiency.status).toBe('NOT MEASURABLE');
    expect(analysis.gates.performance.status).toBe('PASS');
    expect(analysis.gates.mechanism.status).toBe('PASS');
    expect(analysis.gates.core_behavior_headline).toBe('PASS');
    expect(analysis.gates.combined_headline).toBe('FAIL');
    expect(report).toContain('Token aggregate unavailable for 1 assigned run(s)');
    expect(report).toContain('Token efficiency: NOT MEASURABLE.');
  });

  it('regenerates the report from computed analysis, overwriting any manual figure', () => {
    const directory = writeStudy({ scenario: 'positive' });
    const analysis = analyzeStudy(directory);
    const expected = readFileSync(join(directory, 'RESULT.md'), 'utf8');

    writeFileSync(join(directory, 'RESULT.md'), 'A manual number 999999 must not survive regeneration.\n');
    const regenerated = analyzeStudy(directory);

    expect(readFileSync(join(directory, 'RESULT.md'), 'utf8')).toBe(expected);
    expect(expected).toBe(renderReport(regenerated, { calibrated_overhead: 1.45 }));
    expect(analysis).toEqual(regenerated);
  });
});
