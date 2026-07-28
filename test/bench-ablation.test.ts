/**
 * T-703: the three ablation arms as the harness sees them, and CPAA.
 *
 * `test/inject.test.ts` covers what an ablation *does* to a projection. This
 * file covers the two places a correct projection can still be lost: the runner
 * has to accept the arm and write it onto the row unchanged, and the schema has
 * to accept that row — a results file that fails the gate is a matrix nobody
 * can read, and a row whose `cond` was silently rewritten is worse, because it
 * reads fine.
 *
 * CPAA gets the rest. It is a ratio with a denominator that is legitimately
 * zero in the control arm, so the tests below are mostly about what it does
 * *instead* of dividing.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeCpaa, explainCpaa, summarize } from '../bench/metrics.ts';
import {
  ABLATION_CONDITIONS,
  CONDITIONS,
  PRIMARY_CONDITIONS,
  SUPPORTED_CONDITIONS,
  type RunRecord,
} from '../bench/types.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = join(REPO_ROOT, 'bench', 'runner.ts');
const TASKS = join(REPO_ROOT, 'bench', 'tasks');
const SCHEMA = join(REPO_ROOT, 'bench', 'schema', 'result.schema.json');

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

/**
 * A private copy of `dist/`, snapshotted once before any run (bug-issue-88).
 *
 * `bench/runner.ts` hashes the whole `dist/` tree at startup and again before
 * every arm, and refuses to continue an arm when the two disagree
 * (`bench/hooks-settings.ts` `writeArmSettings`) — a real, useful check: it is
 * what caught `dist/core/guard.js` changing mid-run under the previous
 * measurement (see that file's own comment). But `dist/` is one directory
 * shared by every vitest worker, and four other test files
 * (`cli.test.ts`, `mcp.test.ts`, `action-lint.test.ts`,
 * `action-preserve.test.ts`) each run their own `tsc` build against it in a
 * `beforeAll` — so a run here that reads the live, shared tree can lose a
 * race against a sibling file's rebuild and trip that same check on a
 * digest that was never wrong, only concurrently rewritten. Reproduced
 * directly: invoking `bench/runner.ts` in a loop while another process
 * rebuilds `dist/` fails about 1 run in 5 with exactly this message.
 * Pointing every invocation at a private, unshared copy via
 * `COMMITLORE_BENCH_DIST_DIR` removes the shared mutable state instead of
 * loosening the check that (correctly) depends on it.
 */
let privateDistDir = '';
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-t703-dist-'));
  temporaries.push(dir);
  privateDistDir = join(dir, 'dist');
  cpSync(join(REPO_ROOT, 'dist'), privateDistDir, { recursive: true });
});

/**
 * Runs the real runner against the real tasks with the dry-run driver.
 *
 * Never against `bench/results/`: a test that writes there would land in the
 * directory a measurement is being collected into, and simulated rows in a
 * results file are exactly the confusion `simulated: true` exists to prevent.
 */
const runRunner = (args: readonly string[]): readonly RunRecord[] => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-t703-'));
  temporaries.push(dir);
  const out = join(dir, 'rows.jsonl');
  execFileSync(process.execPath, ['--experimental-strip-types', RUNNER, '--tasks', TASKS, '--out', out, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, COMMITLORE_BENCH_DIST_DIR: privateDistDir },
  });
  return readFileSync(out, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as RunRecord);
};

/** One task, so a five-arm round trip costs five dry runs rather than fifty. */
const ONE_TASK = ['--task', 'reproposal-redis-cache', '--seed', '1', '--driver', 'dry-run'];

// ---------------------------------------------------------------------------
// 1. The runner accepts the arms and records them unchanged
// ---------------------------------------------------------------------------

describe('runner: ablation conditions', () => {
  it('registers three ablation arms and the guard route alongside the two primary ones', () => {
    expect([...PRIMARY_CONDITIONS]).toEqual(['commitlore-on', 'commitlore-off']);
    expect([...ABLATION_CONDITIONS].sort()).toEqual(['no-grade', 'no-lifecycle', 'no-scope']);
    expect([...SUPPORTED_CONDITIONS].sort()).toEqual([
      'commitlore-guard',
      'commitlore-off',
      'commitlore-on',
      'no-grade',
      'no-lifecycle',
      'no-scope',
    ]);
    // Not an ablation: nothing is removed from it. It sends Ruled-out: through
    // the route SPEC 5 assigns to that key instead of through injection.
    expect([...ABLATION_CONDITIONS]).not.toContain('commitlore-guard');
  });

  it('accepts all six arms and writes each one onto its own row', () => {
    const rows = runRunner([...ONE_TASK, '--cond', SUPPORTED_CONDITIONS.join(',')]);

    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.cond)).toEqual([...SUPPORTED_CONDITIONS]);
    for (const row of rows) {
      expect(row.task).toBe('reproposal-redis-cache');
      expect(row.seed).toBe(1);
      expect(row.simulated).toBe(true);
      expect(row.stopped_by).not.toBe('error');
    }
  });

  /**
   * `both` and `all` were the same list until the ablation arms became
   * supported. Against a live driver the difference is two arms or five, which
   * is a bill — so the alias that names the registered comparison has to keep
   * naming it.
   */
  it('keeps `--cond both` at the two arms of the primary comparison', () => {
    const rows = runRunner([...ONE_TASK, '--cond', 'both']);
    expect(rows.map((row) => row.cond)).toEqual(['commitlore-on', 'commitlore-off']);
  });

  it('expands `--cond all` to every supported arm', () => {
    const rows = runRunner([...ONE_TASK, '--cond', 'all']);
    expect(new Set(rows.map((row) => row.cond))).toEqual(new Set(SUPPORTED_CONDITIONS));
  });

  const rejects = (args: readonly string[], pattern: RegExp): void => {
    let stderr = '';
    expect(() => {
      try {
        runRunner(args);
      } catch (error) {
        stderr = String((error as { stderr?: string }).stderr ?? '');
        throw error;
      }
    }).toThrow();
    expect(stderr).toMatch(pattern);
  };

  it('rejects an arm that is registered but not implemented', () => {
    rejects([...ONE_TASK, '--cond', 'records-uninjected'], /registered but not implemented/);
    expect(CONDITIONS['records-uninjected']?.status).toBe('planned');
  });

  it('rejects a repeated arm, which would double its weight in every rate', () => {
    rejects([...ONE_TASK, '--cond', 'no-scope,no-scope'], /more than once/);
  });

  it('rejects an unknown arm rather than inventing a condition', () => {
    rejects([...ONE_TASK, '--cond', 'no-scoop'], /unknown condition/);
  });
});

// ---------------------------------------------------------------------------
// 2. CPAA's denominator
// ---------------------------------------------------------------------------

describe('runner: accepted_records', () => {
  it('counts the seeded records, and counts zero for the arm that has none', () => {
    const rows = runRunner([...ONE_TASK, '--cond', SUPPORTED_CONDITIONS.join(',')]);
    const acceptedFor = (cond: string): number | undefined =>
      rows.find((row) => row.cond === cond)?.accepted_records;

    // The control strips the trailer block, so its workspace holds no records.
    expect(acceptedFor('commitlore-off')).toBe(0);
    for (const cond of ['commitlore-on', ...ABLATION_CONDITIONS]) {
      expect(acceptedFor(cond), cond).toBeGreaterThan(0);
    }
    // The ablations change what is injected, never what was seeded.
    for (const cond of ABLATION_CONDITIONS) {
      expect(acceptedFor(cond), cond).toBe(acceptedFor('commitlore-on'));
    }
  });
});

// ---------------------------------------------------------------------------
// 3. CPAA
// ---------------------------------------------------------------------------

const row = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  run_id: 'r1',
  harness_commit: '1111111111111111111111111111111111111111',
  dist_digest: '2222222222222222222222222222222222222222222222222222222222222222',
  task: 'reproposal-redis-cache',
  cond: 'commitlore-on',
  seed: 1,
  reproposed: false,
  violations: 0,
  turns: 3,
  tokens: 1000,
  stopped_by: 'completed',
  duration_ms: 10,
  driver: 'claude-headless',
  started_at: '2026-07-26T00:00:00.000Z',
  simulated: false,
  ...overrides,
});

describe('CPAA', () => {
  it('is the summed cost over the summed accepted records', () => {
    const result = computeCpaa([
      row({ harvest_tokens: 900, verify_tokens: 100, accepted_records: 2 }),
      row({ harvest_tokens: 500, verify_tokens: 0, accepted_records: 3 }),
    ]);

    expect(result.cpaa).toBe((900 + 100 + 500 + 0) / 5);
    expect(result.undefined_because).toBeNull();
    expect(result.rows_instrumented).toBe(2);
    expect(result.harvest_tokens).toBe(1400);
    expect(result.verify_tokens).toBe(100);
    expect(result.accepted_records).toBe(5);
  });

  /**
   * The case the control arm produces on every run. `Infinity` would survive
   * `JSON.stringify` as `null` and read downstream as a missing value, and
   * `NaN` would poison any mean it reached; both would be a number where there
   * is no number.
   */
  it('is undefined rather than NaN or Infinity when nothing was accepted', () => {
    const result = computeCpaa([
      row({ cond: 'commitlore-off', harvest_tokens: 4000, verify_tokens: 0, accepted_records: 0 }),
      row({ cond: 'commitlore-off', harvest_tokens: 3000, verify_tokens: 0, accepted_records: 0 }),
    ]);

    expect(result.cpaa).toBeNull();
    expect(Number.isNaN(result.cpaa as unknown as number)).toBe(false);
    expect(result.undefined_because).toBe('no-accepted-records');
    expect(result.rows_instrumented).toBe(2);
    expect(result.harvest_tokens).toBe(7000);
    expect(explainCpaa(result)).toContain('0 records accepted');
    expect(explainCpaa(result)).toContain('not 0, not infinite');
    expect(JSON.parse(JSON.stringify(result)).cpaa).toBeNull();
  });

  it('says so when nothing recorded a cost, which is not the same as accepting nothing', () => {
    const result = computeCpaa([row(), row({ accepted_records: 7 })]);

    expect(result.cpaa).toBeNull();
    expect(result.undefined_because).toBe('not-instrumented');
    expect(result.rows_instrumented).toBe(0);
    expect(explainCpaa(result)).toContain('not instrumented');
    // The two undefined states are never printed as the same sentence.
    expect(explainCpaa(result)).not.toContain('0 records accepted');
  });

  /**
   * A row with a denominator and no numerator would add accepted records at a
   * cost of nothing and drag the ratio down — the same shape of error as
   * leaving a crashed run in a re-proposal denominator, and pointing the same
   * way: it makes CommitLore look cheaper than anything measured it to be.
   */
  it('drops a partly instrumented row instead of costing its records at zero', () => {
    const result = computeCpaa([
      row({ harvest_tokens: 1000, verify_tokens: 0, accepted_records: 1 }),
      row({ accepted_records: 99 }),
      row({ harvest_tokens: 50 }),
    ]);

    expect(result.cpaa).toBe(1000);
    expect(result.rows_instrumented).toBe(1);
    expect(result.rows_partial).toBe(2);
    expect(result.accepted_records).toBe(1);
    expect(explainCpaa(result)).toContain('1 row(s)');
  });

  it('ignores a negative or non-finite instrument rather than trusting it', () => {
    const result = computeCpaa([
      row({ harvest_tokens: -5, verify_tokens: 0, accepted_records: 1 }),
      row({ harvest_tokens: Number.NaN, verify_tokens: 0, accepted_records: 1 }),
    ]);

    expect(result.cpaa).toBeNull();
    expect(result.undefined_because).toBe('not-instrumented');
    expect(result.rows_partial).toBe(2);
  });

  it('is reported per arm and over the analysis set', () => {
    const summary = summarize(
      [
        row({ cond: 'commitlore-on', harvest_tokens: 600, verify_tokens: 0, accepted_records: 2 }),
        row({ cond: 'commitlore-off', harvest_tokens: 0, verify_tokens: 0, accepted_records: 0 }),
      ],
      ['inline'],
    );

    const on = summary.analysis.find((entry) => entry.cond === 'commitlore-on');
    const off = summary.analysis.find((entry) => entry.cond === 'commitlore-off');

    expect(on?.cpaa.cpaa).toBe(300);
    expect(off?.cpaa.cpaa).toBeNull();
    expect(off?.cpaa.undefined_because).toBe('no-accepted-records');
    expect(summary.cpaa.cpaa).toBe(300);
  });

  it('never divides an empty set', () => {
    const result = computeCpaa([]);
    expect(result.cpaa).toBeNull();
    expect(result.undefined_because).toBe('not-instrumented');
  });
});

// ---------------------------------------------------------------------------
// 4. The schema
// ---------------------------------------------------------------------------

describe('result.schema.json', () => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA, 'utf8')));

  it('accepts a row from every supported arm', () => {
    for (const cond of SUPPORTED_CONDITIONS) {
      expect(validate(row({ cond })), `${cond}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });

  it('accepts the CPAA instruments, together or absent', () => {
    expect(validate(row({ harvest_tokens: 1200, verify_tokens: 0, accepted_records: 3 }))).toBe(true);
    expect(validate(row({ accepted_records: 0 }))).toBe(true);
    expect(validate(row())).toBe(true);
  });

  it('rejects a negative cost or a negative record count', () => {
    expect(validate(row({ harvest_tokens: -1 }))).toBe(false);
    expect(validate(row({ accepted_records: -1 }))).toBe(false);
    expect(validate(row({ verify_tokens: 1.5 }))).toBe(false);
  });

  /**
   * `cond` is deliberately an open string: `bench/types.ts` is the register, and
   * closing the enum here would reject a row from an arm that is registered but
   * newer than this file. The runner rejects an unknown arm at parse time,
   * which is where a typo can still be fixed for free — this only has to not
   * reject a real one.
   */
  it('does not close the condition enum, and lists the real arms so a reader knows them', () => {
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as {
      properties: { cond: { enum?: unknown; examples?: string[] } };
    };

    expect(schema.properties.cond.enum).toBeUndefined();
    expect(schema.properties.cond.examples).toEqual([...SUPPORTED_CONDITIONS]);
  });

  it('still rejects a row that is missing a required field', () => {
    const { reproposed: _dropped, ...incomplete } = row({ cond: 'no-scope' });
    expect(validate(incomplete)).toBe(false);
  });
});
