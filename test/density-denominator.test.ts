/**
 * Issue #183: rationale_density must name its denominator.
 *
 * The density row must:
 * 1. Report BOTH populations: all commits and authored (non-merge) commits.
 * 2. Name the denominator in the rendered row itself.
 * 3. The Linux OOM-Killer comparison must name its denominator.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { measureDensity } from '../bench/deterministic/density.ts';
import { renderDeterministicReport } from '../bench/deterministic/report.ts';
import { git } from '../bench/deterministic/shared.ts';
import type { DensityRow } from '../bench/deterministic/types.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..');

const baseRow = (): Omit<DensityRow, 'metric' | 'history_ref' | 'commits_examined' | 'record_bearing_commits' | 'structured_trailers' | 'non_empty_body_lines' | 'record_bearing_rate' | 'trailers_per_commit' | 'structured_trailer_line_share' | 'merge_commits' | 'authored_commits' | 'authored_record_bearing_commits' | 'authored_record_bearing_rate'> => ({
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
});

describe('density denominator (#183)', () => {
  it('measureDensity returns both all-commits and authored-only populations', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'commitlore-density-denom-'));

    try {
      git(scratch, ['init', '--quiet', '--initial-branch=main']);
      git(scratch, ['config', 'user.name', 'Test']);
      git(scratch, ['config', 'user.email', 'test@test.local']);

      // Two authored commits, one with a record
      git(scratch, ['commit', '--allow-empty', '--quiet', '-m', 'feat: first\n\nLimit: no caching\nRecord-Id: r-denom01']);
      git(scratch, ['commit', '--allow-empty', '--quiet', '-m', 'feat: second']);

      // Create a branch and merge with --no-ff to get a merge commit
      git(scratch, ['checkout', '--quiet', '-b', 'feature']);
      git(scratch, ['commit', '--allow-empty', '--quiet', '-m', 'feat: on branch\n\nWarn: careful\nRecord-Id: r-denom02']);
      git(scratch, ['checkout', '--quiet', 'main']);
      git(scratch, ['merge', '--no-ff', '--quiet', 'feature']);

      // Now we have: 3 authored commits + 1 merge commit = 4 total
      // 2 of 3 authored commits carry records
      const measured = measureDensity(baseRow() as any, scratch);

      // The row MUST contain both populations
      expect(measured).toHaveProperty('merge_commits');
      expect(measured).toHaveProperty('authored_commits');
      expect(measured).toHaveProperty('authored_record_bearing_commits');
      expect(measured).toHaveProperty('authored_record_bearing_rate');

      expect(measured.commits_examined).toBe(4);
      expect(measured.merge_commits).toBe(1);
      expect(measured.authored_commits).toBe(3);
      expect(measured.authored_record_bearing_commits).toBe(2);
      // authored rate: 2/3
      expect(measured.authored_record_bearing_rate).toBeCloseTo(2 / 3, 10);
      // all-commits rate: 2/4
      expect(measured.record_bearing_rate).toBeCloseTo(2 / 4, 10);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rendered density row names the denominator "all commits" in the table', () => {
    const densityRow: DensityRow = {
      ...baseRow() as any,
      metric: 'rationale_density',
      history_ref: 'HEAD',
      commits_examined: 263,
      record_bearing_commits: 203,
      structured_trailers: 800,
      non_empty_body_lines: 1000,
      record_bearing_rate: 203 / 263,
      trailers_per_commit: 800 / 263,
      structured_trailer_line_share: 800 / 1000,
      merge_commits: 60,
      authored_commits: 203,
      authored_record_bearing_commits: 180,
      authored_record_bearing_rate: 180 / 203,
    };

    const markdown = renderDeterministicReport([densityRow]);

    // The table row must name BOTH denominators
    expect(markdown).toMatch(/all.*commits/i);
    expect(markdown).toMatch(/authored.*commits|non-merge.*commits/i);
    // Must show both rates
    expect(markdown).toContain('77.2%');  // 203/263
    expect(markdown).toMatch(/88\.\d%/);  // 180/203 ≈ 88.7%
  });

  it('Linux OOM-Killer comparison names the denominator', () => {
    const densityRow: DensityRow = {
      ...baseRow() as any,
      metric: 'rationale_density',
      history_ref: 'HEAD',
      commits_examined: 263,
      record_bearing_commits: 203,
      structured_trailers: 800,
      non_empty_body_lines: 1000,
      record_bearing_rate: 203 / 263,
      trailers_per_commit: 800 / 263,
      structured_trailer_line_share: 800 / 1000,
      merge_commits: 60,
      authored_commits: 203,
      authored_record_bearing_commits: 180,
      authored_record_bearing_rate: 180 / 203,
    };

    const markdown = renderDeterministicReport([densityRow]);

    // The Linux comparison paragraph must name a denominator —
    // it must not just say "77.2% record-bearing rate" without naming what population
    expect(markdown).toMatch(/all commits.*record-bearing rate|record-bearing rate.*all commits/i);
  });

  // --- MUTATION ORACLES ---

  it('ORACLE: fails if authored_record_bearing_rate is removed from the row', () => {
    // Verifies the test has teeth: if the authored population is dropped,
    // the rendered markdown would lack the authored rate
    const densityRow: DensityRow = {
      ...baseRow() as any,
      metric: 'rationale_density',
      history_ref: 'HEAD',
      commits_examined: 100,
      record_bearing_commits: 60,
      structured_trailers: 200,
      non_empty_body_lines: 300,
      record_bearing_rate: 0.6,
      trailers_per_commit: 2,
      structured_trailer_line_share: 200 / 300,
      merge_commits: 20,
      authored_commits: 80,
      authored_record_bearing_commits: 55,
      authored_record_bearing_rate: 55 / 80,
    };

    const markdown = renderDeterministicReport([densityRow]);

    // If authored population were removed, this would fail:
    // The authored rate 55/80 = 68.8% must appear
    expect(markdown).toMatch(/68\.\d%/);
    // "authored" label must appear
    expect(markdown).toMatch(/authored.*non-merge/i);
  });

  it('ORACLE: fails if denominator label is removed from the table', () => {
    // If the "population" column naming "all commits" were removed,
    // this test would catch it
    const densityRow: DensityRow = {
      ...baseRow() as any,
      metric: 'rationale_density',
      history_ref: 'HEAD',
      commits_examined: 100,
      record_bearing_commits: 60,
      structured_trailers: 200,
      non_empty_body_lines: 300,
      record_bearing_rate: 0.6,
      trailers_per_commit: 2,
      structured_trailer_line_share: 200 / 300,
      merge_commits: 20,
      authored_commits: 80,
      authored_record_bearing_commits: 55,
      authored_record_bearing_rate: 55 / 80,
    };

    const markdown = renderDeterministicReport([densityRow]);

    // The table must have a "population" header naming what each row counts
    expect(markdown).toContain('| population |');
    // Each row must be labelled
    expect(markdown).toContain('| all commits |');
    expect(markdown).toMatch(/\| authored \(non-merge\) commits \|/);
  });

  it('ORACLE: existing fields remain unchanged (must NOT fail)', () => {
    // Validates backward compatibility: the old fields still work correctly
    const scratch = mkdtempSync(join(tmpdir(), 'commitlore-density-compat-'));

    try {
      git(scratch, ['init', '--quiet']);
      git(scratch, ['config', 'user.name', 'Test']);
      git(scratch, ['config', 'user.email', 'test@test.local']);
      git(scratch, ['commit', '--allow-empty', '--quiet', '-m', 'subject only']);
      git(scratch, ['commit', '--allow-empty', '--quiet', '-m', 'carry record\n\nLimit: constraint\nRecord-Id: r-compat01']);

      const measured = measureDensity(baseRow() as any, scratch);

      // Old fields still work — no merge commits in this simple repo
      expect(measured.commits_examined).toBe(2);
      expect(measured.record_bearing_commits).toBe(1);
      expect(measured.record_bearing_rate).toBe(0.5);
      expect(measured.merge_commits).toBe(0);
      expect(measured.authored_commits).toBe(2);
      // With no merges, authored rate equals all-commits rate
      expect(measured.authored_record_bearing_rate).toBe(measured.record_bearing_rate);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
