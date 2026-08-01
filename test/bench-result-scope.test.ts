import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const RESULTS_DIR = path.join(REPO_ROOT, 'bench', 'results');
const tempDirs: string[] = [];

const runGate = (...args: string[]) => {
  const result = spawnSync(process.execPath, ['bench/verify.mjs', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

/**
 * Scratch files live outside bench/results/ on purpose. Every file in there is
 * a committed measurement, and a test that writes one — even briefly — can
 * leave it behind when it fails. Named files go through the same classifier as
 * the directory scan, so nothing is lost by keeping them elsewhere.
 */
const scratch = (name: string, rows: readonly unknown[]): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitlore-bench-scope-'));
  tempDirs.push(dir);
  const target = path.join(dir, name);
  fs.writeFileSync(target, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''));
  return target;
};

/** A row the current schema accepts in full, with provenance. */
const runRecord = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  run_id: 'scope-test',
  harness_commit: '1111111111111111111111111111111111111111',
  dist_digest: '2'.repeat(64),
  task: 'reproposal-redis-cache',
  cond: 'commitlore-on',
  seed: 1,
  reproposed: false,
  violations: 0,
  turns: 3,
  tokens: 1000,
  stopped_by: 'completed',
  duration_ms: 1200,
  driver: 'dry-run',
  started_at: '2026-08-01T00:00:00.000Z',
  simulated: true,
  ...overrides,
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the result-schema gate covers bench/results/ by default', () => {
  it('accounts for every .jsonl on disk, and passes', () => {
    // The property #392 is about: scope is default-in, so a results file cannot
    // be outside the gate by omission. This fails the moment anyone replaces
    // the directory scan with a list, a prefix filter or a "files that pass
    // today" set — every one of those leaves a file on disk unmentioned.
    const onDisk = fs
      .readdirSync(RESULTS_DIR)
      .filter((name) => name.endsWith('.jsonl'))
      .sort();
    expect(onDisk.length).toBeGreaterThan(0);

    const gate = runGate();
    expect(gate.status, gate.stderr).toBe(0);

    for (const name of onDisk) {
      const mentions = gate.stdout.split('\n').filter((line) => line.includes(`/${name} `));
      expect(mentions, `${name} was neither checked nor skipped`).toHaveLength(1);
      expect(mentions[0]).toMatch(/^(ok|skip) /);
    }
  });

  it('refuses to report success over a file with nothing in it', () => {
    // A gate that checked zero rows and reported green is the failure this
    // issue is about, wearing a tick.
    const gate = runGate(scratch('no-rows.jsonl', []));
    expect(gate.status).toBe(1);
    expect(gate.stderr).toContain('contains no rows');
  });
});

describe('the gate bites', () => {
  it('fails a row carrying a field the schema does not declare', () => {
    // The exact drift shape from #390: a field reaches the runner's rows before
    // it reaches the schema.
    const file = scratch('drift.jsonl', [runRecord({ invented_field: 1 })]);
    const gate = runGate(file);
    expect(gate.status).toBe(1);
    expect(gate.stderr).toContain('must NOT have additional properties');
  });

  it('fails a row whose declared field has the wrong type', () => {
    const file = scratch('typed.jsonl', [runRecord({ turns: 'three' })]);
    const gate = runGate(file);
    expect(gate.status).toBe(1);
  });
});

describe('the pre-provenance exemption is bounded by the rows, not by filename', () => {
  const withoutProvenance = () => {
    const { harness_commit: _c, dist_digest: _d, ...rest } = runRecord();
    return rest;
  };

  it('accepts a row recorded before 1073fa4 made the provenance fields required', () => {
    const file = scratch('legacy.jsonl', [
      { ...withoutProvenance(), started_at: '2026-07-26T08:55:15.468Z' },
    ]);
    const gate = runGate(file);
    expect(gate.status, gate.stderr).toBe(0);
    expect(gate.stdout).toContain('recorded before 1073fa4');
  });

  it('rejects the same row once it claims a start after that commit', () => {
    // What stops the exemption from rotting into a permanent hole: a new run's
    // started_at comes from the clock, so it can never land before the cutoff.
    const file = scratch('current.jsonl', [
      { ...withoutProvenance(), started_at: '2026-08-01T00:00:00.000Z' },
    ]);
    const gate = runGate(file);
    expect(gate.status).toBe(1);
    expect(gate.stderr).toContain("must have required property 'harness_commit'");
  });

  it('still applies every other constraint to an exempt row', () => {
    // The exemption drops two `required` entries, not the schema.
    const file = scratch('legacy-invalid.jsonl', [
      { ...withoutProvenance(), started_at: '2026-07-26T08:55:15.468Z', invented_field: 1 },
    ]);
    const gate = runGate(file);
    expect(gate.status).toBe(1);
    expect(gate.stderr).toContain('must NOT have additional properties');
  });

  it('gives no exemption to a row whose started_at cannot be read', () => {
    const file = scratch('undated.jsonl', [{ ...withoutProvenance(), started_at: 'whenever' }]);
    const gate = runGate(file);
    expect(gate.status).toBe(1);
  });
});

describe('metric rows are a different family, and the split is not silent', () => {
  const metricRow = (overrides: Record<string, unknown> = {}) => ({
    schema_version: 1,
    harness_commit: '1111111111111111111111111111111111111111',
    harness_digest: '3'.repeat(40),
    dist_digest: '2'.repeat(64),
    measured_at: '2026-07-29T01:13:43.000Z',
    metric: 'record_density',
    ...overrides,
  });

  it('skips a file whose every row carries schema_version, and says so', () => {
    const file = scratch('metrics.jsonl', [metricRow(), metricRow()]);
    const gate = runGate(file);
    expect(gate.status, gate.stderr).toBe(0);
    expect(gate.stdout).toContain('metric row(s) (schema_version present)');
  });

  it('fails a file that mixes the two families rather than classifying it', () => {
    // The only route by which a run-record file could leave this gate is
    // someone adding schema_version to its rows. Partway through, that is a
    // corrupt file and is failed; all the way through, the schema itself
    // rejects the field the moment the file is named directly.
    const file = scratch('mixed.jsonl', [runRecord(), metricRow()]);
    const gate = runGate(file);
    expect(gate.status).toBe(1);
    expect(gate.stderr).toContain('one file, one row family');
  });

  it('rejects schema_version on a run record when the file is checked directly', () => {
    const file = scratch('tagged.jsonl', [runRecord({ schema_version: 1 }), runRecord()]);
    const gate = runGate(file);
    expect(gate.status).toBe(1);
  });
});
