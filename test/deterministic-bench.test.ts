import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  floorTokensPerAcceptedRecord,
  tokensForCharacters,
} from '../bench/deterministic/capture.ts';
import {
  ADDRESSABILITY_STATEMENT,
  assertSingleProvenance,
  DENSITY_CITATIONS,
  DENSITY_SCOPE_SENTENCE,
  percentile,
  renderDeterministicReport,
  SCOPE_SENTENCE,
} from '../bench/deterministic/report.ts';
import {
  activePathRecords,
  createNoiseFixture,
  destroyNoiseFixture,
  generateNoiseCorpus,
  NOISE_SIZES,
  TARGET_PATH,
} from '../bench/deterministic/noise.ts';
import { measureDensity } from '../bench/deterministic/density.ts';
import {
  loadGuardCorpus,
  sweepGuardThresholds,
  wilsonPrecisionInterval,
} from '../bench/deterministic/quality.ts';
import {
  assertCleanCheckout,
  git,
  harnessTreeDigest,
  verifyHarnessProvenance,
} from '../bench/deterministic/shared.ts';
import { measureSurvival } from '../bench/deterministic/survival.ts';
import { CHARS_PER_TOKEN } from '../dist/core/inject.js';
import type {
  CaptureCostRow,
  DensityRow,
  GuardQualityRow,
  InjectionDetectionRow,
  NoiseExposureRow,
} from '../bench/deterministic/types.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const DENSITY_RESULTS_DIR = join(REPO_ROOT, 'bench', 'results');

const row = (overrides: Partial<InjectionDetectionRow> = {}): InjectionDetectionRow => ({
  schema_version: 1,
  harness_commit: '1111111111111111111111111111111111111111',
  harness_digest: '3333333333333333333333333333333333333333',
  dist_digest: '2222222222222222222222222222222222222222222222222222222222222222',
  measured_at: '2026-07-27T00:00:00.000Z',
  machine: {
    platform: 'darwin',
    release: '25.3.0',
    arch: 'arm64',
    cpu: 'Test CPU',
    logical_cpus: 12,
    memory_bytes: 51_539_607_552,
    node: 'v24.18.0',
    git: 'git version 2.50.1',
  },
  metric: 'injection_detection',
  corpus: 'spec/fixtures/injection',
  positives: 10,
  negatives: 10,
  true_positives: 9,
  false_negatives: 1,
  false_positives: 2,
  true_negatives: 8,
  true_positive_rate: 0.9,
  false_positive_rate: 0.2,
  ...overrides,
});

const guardRow = (): GuardQualityRow => {
  const curve = sweepGuardThresholds(
    [
      { reproposed: true, score: 0.8 },
      { reproposed: false, score: 0.6 },
      { reproposed: true, score: 0.4 },
      { reproposed: false, score: undefined },
    ],
    0.2,
  );
  const point = curve.find((entry) => entry.threshold === 0.6);
  if (point === undefined) throw new Error('hand-checked curve fixture is missing 0.60');
  return {
    ...row(),
    metric: 'guard_quality',
    corpus: 'bench/results/transcripts-final',
    threshold: 0.6,
    true_positives: point.true_positives,
    false_positives: point.false_positives,
    false_negatives: point.false_negatives,
    true_negatives: point.true_negatives,
    precision: point.precision,
    recall: point.recall,
    firings: point.firings,
    bands: [],
    curve_step: 0.2,
    curve,
    precision_interval: wilsonPrecisionInterval(point.true_positives, point.firings),
  };
};

const captureRow = (overrides: Partial<CaptureCostRow> = {}): CaptureCostRow => ({
  ...row(),
  metric: 'capture_cost',
  fixture: 'test/fixtures/harvest-verify/draft-truthful.json',
  accepted_records: 1,
  rejected_records: 0,
  harvest: {
    output_bytes: 40,
    output_tokens: 10,
    timing: { runs: 20, warmups: 1, p50_ms: 2, p95_ms: 3, min_ms: 1, max_ms: 4 },
  },
  verify: {
    input_bytes: 80,
    input_tokens: 20,
    timing: { runs: 20, warmups: 1, p50_ms: 5, p95_ms: 6, min_ms: 4, max_ms: 7 },
  },
  cache_read: { input_bytes: 40, input_tokens: 10 },
  marginal_tokens_per_accepted_record: 20,
  tokens_including_cache_reads_per_accepted_record: 30,
  ...overrides,
});

const densityRow = (overrides: Partial<DensityRow> = {}): DensityRow => ({
  schema_version: 1,
  harness_commit: '1111111111111111111111111111111111111111',
  harness_digest: '3333333333333333333333333333333333333333',
  dist_digest: '2222222222222222222222222222222222222222222222222222222222222222',
  measured_at: '2026-07-27T00:00:00.000Z',
  machine: row().machine,
  metric: 'rationale_density',
  history_ref: 'HEAD',
  commits_examined: 2,
  merge_commits: 0,
  authored_commits: 2,
  record_bearing_commits: 1,
  authored_record_bearing_commits: 1,
  structured_trailers: 4,
  non_empty_body_lines: 5,
  record_bearing_rate: 0.5,
  authored_record_bearing_rate: 0.5,
  trailers_per_commit: 2,
  structured_trailer_line_share: 0.8,
  ...overrides,
});

interface RecordedDensity {
  readonly harness_commit: string;
  readonly harness_digest?: string;
  readonly commits_examined: number;
  readonly record_bearing_commits: number;
  readonly structured_trailers: number;
  readonly non_empty_body_lines: number;
  readonly record_bearing_rate: number;
  readonly trailers_per_commit: number;
  readonly structured_trailer_line_share: number;
}

const densityResultPath = (): string => {
  const densityResults = readdirSync(DENSITY_RESULTS_DIR)
    .filter((name) => /^deterministic-.*\.jsonl$/.test(name))
    .filter((name) => {
      const contents = readFileSync(join(DENSITY_RESULTS_DIR, name), 'utf8').trim();
      if (contents.includes('\n')) return false;
      const parsed: unknown = JSON.parse(contents);
      return typeof parsed === 'object' && parsed !== null && Reflect.get(parsed, 'metric') === 'rationale_density';
    });
  const latest = densityResults.sort().at(-1);
  if (latest === undefined) throw new Error('no density result found');
  return join(DENSITY_RESULTS_DIR, latest);
};

const recordedDensity = (path: string): RecordedDensity => {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error('density result is not an object');
  const text = Reflect.get(parsed, 'harness_commit');
  if (typeof text !== 'string') throw new Error('density result has an invalid harness commit');
  const digest = Reflect.get(parsed, 'harness_digest');
  if (digest !== undefined && typeof digest !== 'string') {
    throw new Error('density result has an invalid harness digest');
  }
  const number = (field: string): number => {
    const value = Reflect.get(parsed, field);
    if (typeof value !== 'number') throw new Error(`density result has invalid ${field}`);
    return value;
  };
  return {
    harness_commit: text,
    ...(digest === undefined ? {} : { harness_digest: digest }),
    commits_examined: number('commits_examined'),
    record_bearing_commits: number('record_bearing_commits'),
    structured_trailers: number('structured_trailers'),
    non_empty_body_lines: number('non_empty_body_lines'),
    record_bearing_rate: number('record_bearing_rate'),
    trailers_per_commit: number('trailers_per_commit'),
    structured_trailer_line_share: number('structured_trailer_line_share'),
  };
};

interface RebasedHarnessRepo {
  readonly dir: string;
  readonly originalCommit: string;
  readonly rebasedCommit: string;
  readonly harnessDigest: string;
}

const createRebasedHarnessRepo = (): RebasedHarnessRepo => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-harness-rebase-test-'));
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.name', 'CommitLore Bench']);
  git(dir, ['config', 'user.email', 'bench@commitlore.local']);
  mkdirSync(join(dir, 'bench', 'deterministic'), { recursive: true });
  writeFileSync(join(dir, 'bench', 'deterministic.ts'), 'export {};\n');
  writeFileSync(join(dir, 'bench', 'deterministic', 'measure.ts'), 'export const measure = 1;\n');
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'base']);

  git(dir, ['checkout', '--quiet', '-b', 'feature']);
  writeFileSync(join(dir, 'feature.txt'), 'feature\n');
  git(dir, ['add', 'feature.txt']);
  git(dir, ['commit', '--quiet', '-m', 'feature']);
  const originalCommit = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
  const harnessDigest = harnessTreeDigest(dir, originalCommit);

  git(dir, ['checkout', '--quiet', 'main']);
  writeFileSync(join(dir, 'base.txt'), 'rebased base\n');
  git(dir, ['add', 'base.txt']);
  git(dir, ['commit', '--quiet', '-m', 'move base']);
  git(dir, ['checkout', '--quiet', 'feature']);
  git(dir, ['rebase', 'main']);
  const rebasedCommit = git(dir, ['rev-parse', 'HEAD']).stdout.trim();

  return { dir, originalCommit, rebasedCommit, harnessDigest };
};

const pruneRebaseSource = (fixture: RebasedHarnessRepo): void => {
  git(fixture.dir, ['reflog', 'expire', '--expire=now', '--all']);
  git(fixture.dir, ['gc', '--prune=now']);
  expect(
    git(
      fixture.dir,
      ['rev-parse', '--verify', '--quiet', `${fixture.originalCommit}^{commit}`],
      { allowed: [0, 1] },
    ).status,
  ).toBe(1);
};

describe('deterministic benchmark reporting', () => {
  it('uses the product token constant for capture measurements', () => {
    expect(tokensForCharacters(CHARS_PER_TOKEN + 1)).toBe(2);
  });

  it('divides the deterministic floor by the stated accepted-record denominator', () => {
    expect(
      floorTokensPerAcceptedRecord({ harvest_tokens: 20, verify_tokens: 10, accepted_records: 2 }),
    ).toBe(15);
  });

  it('charges a rejected draft to the record that was eventually accepted', () => {
    const firstPass = floorTokensPerAcceptedRecord({
      harvest_tokens: 20,
      verify_tokens: 10,
      accepted_records: 1,
    });
    const rewritten = floorTokensPerAcceptedRecord({
      harvest_tokens: 20,
      verify_tokens: 20,
      accepted_records: 1,
    });

    expect(rewritten).toBeGreaterThan(firstPass);
  });

  it('states that model generation is not measured in the capture report', () => {
    expect(renderDeterministicReport([captureRow()])).toContain(
      'Model generation tokens are not measured',
    );
  });

  it('computes nearest-rank p50 and p95 when samples are unsorted', () => {
    const samples = [20, 1, 15, 9, 3, 11, 8, 19, 7, 12, 6, 13, 18, 17, 16, 14, 10, 5, 4, 2];

    expect(percentile(samples, 0.5)).toBe(10);
    expect(percentile(samples, 0.95)).toBe(19);
  });

  it('rejects rows from different commits or dist trees', () => {
    expect(() =>
      assertSingleProvenance([
        row(),
        row({ harness_commit: 'other', dist_digest: 'different' }),
      ]),
    ).toThrow(/mixed.*harness_commit.*dist_digest/i);
  });

  it('rejects rows from different runs or machines of the same binary', () => {
    expect(() =>
      assertSingleProvenance([
        row(),
        row({
          measured_at: '2026-07-28T00:00:00.000Z',
          machine: { ...row().machine, cpu: 'Other CPU' },
        }),
      ]),
    ).toThrow(/mixed.*measured_at.*machine/i);
  });

  it('states that the measurements do not establish agent benefit', () => {
    expect(renderDeterministicReport([row()])).toContain(SCOPE_SENTENCE);
  });

  it('keeps guard firing counts monotonic as the threshold rises', () => {
    const curve = sweepGuardThresholds(
      [
        { reproposed: true, score: 0.8 },
        { reproposed: false, score: 0.6 },
        { reproposed: true, score: 0.4 },
        { reproposed: false, score: undefined },
      ],
      0.2,
    );

    for (let index = 1; index < curve.length; index += 1) {
      expect(curve[index - 1]?.firings).toBeGreaterThanOrEqual(curve[index]?.firings ?? 0);
    }
  });

  it('rejects threshold steps that would make an unboundedly large report', () => {
    expect(() =>
      sweepGuardThresholds(
        [{ reproposed: true, score: 0.8 }],
        0.001,
      ),
    ).toThrow(/step must be between 0.01 and 1/i);
  });

  it('includes the 1.00 endpoint when the threshold step does not divide the range', () => {
    const curve = sweepGuardThresholds([{ reproposed: true, score: 0.8 }], 0.3);

    expect(curve.map((entry) => entry.threshold)).toEqual([0, 0.3, 0.6, 0.9, 1]);
  });

  it('computes guard precision, recall, and F1 from a hand-checked fixture', () => {
    const curve = sweepGuardThresholds(
      [
        { reproposed: true, score: 0.8 },
        { reproposed: false, score: 0.6 },
        { reproposed: true, score: 0.4 },
        { reproposed: false, score: undefined },
      ],
      0.2,
    );
    const point = curve.find((entry) => entry.threshold === 0.6);

    expect(point).toMatchObject({
      true_positives: 1,
      false_positives: 1,
      false_negatives: 1,
      true_negatives: 1,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
      firings: 2,
      correct_silences: 1,
    });
  });

  it('computes the 95% Wilson interval for the archived 3-of-8 precision', () => {
    const interval = wilsonPrecisionInterval(3, 8);

    expect(interval.level).toBe(0.95);
    expect(interval.lower).toBeCloseTo(0.1368, 4);
    expect(interval.upper).toBeCloseTo(0.6943, 4);
  });

  it('computes hand-checked Wilson edge intervals', () => {
    expect(wilsonPrecisionInterval(0, 10)).toMatchObject({
      level: 0.95,
      lower: 0,
      upper: expect.closeTo(0.2775, 4),
    });
    expect(wilsonPrecisionInterval(10, 10)).toMatchObject({
      level: 0.95,
      lower: expect.closeTo(0.7225, 4),
      upper: expect.closeTo(1, 10),
    });
  });

  it('loads all 417 decisions in the enlarged guard corpus', () => {
    const corpus = loadGuardCorpus(REPO_ROOT);

    expect(corpus).toHaveLength(417);
    expect(new Set(corpus.map((decision) => decision.artifact))).toHaveLength(417);
    expect(corpus.filter((decision) => decision.disagreement !== undefined)).toHaveLength(4);
  });

  it('takes guard labels from fixture data rather than scorer or archived detector output', () => {
    const corpus = loadGuardCorpus(REPO_ROOT);
    const relabelled = corpus.find((decision) =>
      decision.artifact.endsWith(
        '__reproposal-prisma-orm__commitlore-on__seed2.json',
      ),
    );
    if (relabelled === undefined) throw new Error('missing relabelled Prisma decision');
    const archived: unknown = JSON.parse(
      readFileSync(join(REPO_ROOT, relabelled.artifact), 'utf8'),
    );
    const fixture: unknown = JSON.parse(
      readFileSync(join(REPO_ROOT, 'bench', 'fixtures', 'guard-quality.json'), 'utf8'),
    );

    expect(Reflect.get(archived as object, 'reproposed')).toBe(true);
    expect(relabelled.reproposed).toBe(false);
    expect(relabelled.disagreement).toMatch(/decision-level adjudication/i);
    expect(
      (Reflect.get(fixture as object, 'cases') as object[]).every(
        (candidate) => !Reflect.has(candidate, 'score') && !Reflect.has(candidate, 'matches'),
      ),
    ).toBe(true);
  });

  it('renders the guard corpus-size limit with the threshold curve', () => {
    const report = renderDeterministicReport([guardRow()]);

    expect(report).toContain('4 labelled decisions');
    expect(report).toContain('| threshold | precision | recall | F1 | firings | correct silences |');
  });

  it('counts records and structured trailers from a hand-checked Git history', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'commitlore-density-test-'));

    try {
      git(scratch, ['init', '--quiet']);
      git(scratch, ['config', 'user.name', 'CommitLore Bench']);
      git(scratch, ['config', 'user.email', 'bench@commitlore.local']);
      git(scratch, ['commit', '--allow-empty', '--quiet', '-m', 'subject only']);
      git(scratch, ['commit', '--allow-empty', '--allow-empty-message', '--quiet', '-m', '']);
      git(scratch, [
        'commit', '--allow-empty', '--quiet', '-m',
        'carry two records\n\nLimit: first constraint\nRecord-Id: r-density01\n\nbody prose\n\nWarn: second warning\nRecord-Id: r-density02',
      ]);

      const measured = measureDensity(row(), scratch);

      expect(measured).toMatchObject({
        commits_examined: 3,
        record_bearing_commits: 1,
        structured_trailers: 4,
        non_empty_body_lines: 5,
        trailers_per_commit: 4 / 3,
        structured_trailer_line_share: 0.8,
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('renders the addressability statement and literature citations', () => {
    const markdown = renderDeterministicReport([row(), densityRow()]);

    expect(markdown).toContain(ADDRESSABILITY_STATEMENT);
    expect(renderDeterministicReport([densityRow()])).toContain(DENSITY_SCOPE_SENTENCE);
    for (const citation of DENSITY_CITATIONS) expect(markdown).toContain(citation);
  });

  it('verifies a resolvable result by commit and recomputes its recorded history', () => {
    const recorded = recordedDensity(densityResultPath());
    const verification = verifyHarnessProvenance(REPO_ROOT, recorded);
    const measured = measureDensity(row(), REPO_ROOT, verification.historyRef);

    expect(verification.verifiedBy).toBe('commit');
    expect(verification.message).toContain(recorded.harness_commit);

    expect({
      commits_examined: measured.commits_examined,
      record_bearing_commits: measured.record_bearing_commits,
      structured_trailers: measured.structured_trailers,
      non_empty_body_lines: measured.non_empty_body_lines,
      record_bearing_rate: measured.record_bearing_rate,
      trailers_per_commit: measured.trailers_per_commit,
      structured_trailer_line_share: measured.structured_trailer_line_share,
    }).toEqual({
      commits_examined: recorded.commits_examined,
      record_bearing_commits: recorded.record_bearing_commits,
      structured_trailers: recorded.structured_trailers,
      non_empty_body_lines: recorded.non_empty_body_lines,
      record_bearing_rate: recorded.record_bearing_rate,
      trailers_per_commit: recorded.trailers_per_commit,
      structured_trailer_line_share: recorded.structured_trailer_line_share,
    });
  });

  it('verifies an orphaned result by digest and states the narrower guarantee', () => {
    const fixture = createRebasedHarnessRepo();

    try {
      pruneRebaseSource(fixture);
      const verification = verifyHarnessProvenance(fixture.dir, {
        harness_commit: fixture.originalCommit,
        harness_digest: fixture.harnessDigest,
      });

      expect(verification).toMatchObject({
        historyRef: 'HEAD',
        verifiedBy: 'digest',
      });
      expect(verification.message).toMatch(
        /verified by harness digest.*proves the harness code is identical, not that the recorded commit existed/i,
      );
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it('fails when the result commit is orphaned and the harness digest changed', () => {
    const fixture = createRebasedHarnessRepo();

    try {
      writeFileSync(
        join(fixture.dir, 'bench', 'deterministic', 'measure.ts'),
        'export const measure = 2;\n',
      );
      git(fixture.dir, ['add', 'bench/deterministic/measure.ts']);
      git(fixture.dir, ['commit', '--quiet', '-m', 'change harness']);
      pruneRebaseSource(fixture);

      expect(() =>
        verifyHarnessProvenance(fixture.dir, {
          harness_commit: fixture.originalCommit,
          harness_digest: fixture.harnessDigest,
        }),
      ).toThrow(/commit .* unresolvable.*digest does not match HEAD.*cannot be re-derived/i);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it('keeps the harness digest across a rebase that changes no harness file', () => {
    const fixture = createRebasedHarnessRepo();

    try {
      expect(fixture.rebasedCommit).not.toBe(fixture.originalCommit);
      expect(harnessTreeDigest(fixture.dir, fixture.rebasedCommit)).toBe(fixture.harnessDigest);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it('refuses uncommitted benchmark inputs', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'commitlore-clean-test-'));

    try {
      git(scratch, ['init', '--quiet']);
      git(scratch, ['config', 'user.name', 'CommitLore Bench']);
      git(scratch, ['config', 'user.email', 'bench@commitlore.local']);
      writeFileSync(join(scratch, 'input.txt'), 'committed\n');
      git(scratch, ['add', 'input.txt']);
      git(scratch, ['commit', '--quiet', '-m', 'seed']);
      expect(() => assertCleanCheckout(scratch)).not.toThrow();

      writeFileSync(join(scratch, 'input.txt'), 'dirty\n');
      expect(() => assertCleanCheckout(scratch)).toThrow(/clean checkout:[\s\S]*input\.txt/i);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('does not allow short production measurements', () => {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', join(REPO_ROOT, 'bench', 'deterministic.ts')],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          COMMITLORE_DETERMINISTIC_ALLOW_SHORT: '1',
          COMMITLORE_DETERMINISTIC_RUNS: '1',
          COMMITLORE_DETERMINISTIC_SIZES: '1',
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/test-only.*fixed protocol/i);
  });

  it('runs rebase-onto when the cloned source HEAD is the feature branch', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'commitlore-survival-test-'));

    try {
      const measured = measureSurvival(row(), scratch, 2);
      const onto = measured.find((entry) => entry.operation === 'rebase-onto');

      expect(onto?.survived).toBe(2);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('generates the same distractor corpus for a fixed seed', () => {
    expect(generateNoiseCorpus(100, 142)).toEqual(generateNoiseCorpus(100, 142));
    expect(generateNoiseCorpus(100, 142)).not.toEqual(generateNoiseCorpus(100, 143));
  });

  it('exposes exactly the two active records at every distractor corpus size', () => {
    for (const size of NOISE_SIZES) {
      const fixture = createNoiseFixture(size);
      try {
        expect(activePathRecords(fixture)).toBe(2);
      } finally {
        destroyNoiseFixture(fixture);
      }
    }
  });

  it('keeps each active record commit in the target path history', () => {
    const fixture = createNoiseFixture(0);
    try {
      const messages = git(fixture.dir, ['log', '--format=%B', '--', TARGET_PATH]).stdout;

      expect(messages).toContain('Record-Id: r-expose001');
      expect(messages).toContain('Record-Id: r-expose002');
    } finally {
      destroyNoiseFixture(fixture);
    }
  });

  it('withholds a superseded record from the active pair', () => {
    const fixture = createNoiseFixture(10, 142, true);
    try {
      expect(activePathRecords(fixture)).toBe(1);
    } finally {
      destroyNoiseFixture(fixture);
    }
  });

  it('states that the exposure section is not a cost or accuracy measurement', () => {
    const exposure: NoiseExposureRow = {
      ...row(),
      metric: 'noise_exposure',
      distractors: 10,
      corpus_records: 12,
      route: 'inject-everything',
      visible_records: 12,
      visible_tokens: 120,
      relevant_records: 2,
      relevant_total: 2,
      timing: { runs: 20, warmups: 1, p50_ms: 1, p95_ms: 2, min_ms: 1, max_ms: 2 },
    };

    expect(renderDeterministicReport([exposure])).toContain(
      'This section measures exposure only, not token cost, billed cost, or accuracy.',
    );
  });

  it('renders absolute relevant counts alongside density percentages', () => {
    const exposure: NoiseExposureRow = {
      ...row(),
      metric: 'noise_exposure',
      distractors: 10_000,
      corpus_records: 10_002,
      route: 'inject-everything',
      visible_records: 10_002,
      visible_tokens: 100_020,
      relevant_records: 2,
      relevant_total: 2,
      timing: { runs: 20, warmups: 1, p50_ms: 1, p95_ms: 2, min_ms: 1, max_ms: 2 },
    };

    expect(renderDeterministicReport([exposure])).toContain('2 of 10002 (0.0%)');
  });
});
