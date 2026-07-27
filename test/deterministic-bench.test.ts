import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertSingleProvenance,
  percentile,
  renderDeterministicReport,
  SCOPE_SENTENCE,
} from '../bench/deterministic/report.ts';
import { measureSurvival } from '../bench/deterministic/survival.ts';
import type { InjectionDetectionRow } from '../bench/deterministic/types.ts';

const row = (overrides: Partial<InjectionDetectionRow> = {}): InjectionDetectionRow => ({
  schema_version: 1,
  harness_commit: '1111111111111111111111111111111111111111',
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

describe('deterministic benchmark reporting', () => {
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

  it('states that the measurements do not establish agent benefit', () => {
    expect(renderDeterministicReport([row()])).toContain(SCOPE_SENTENCE);
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
});
