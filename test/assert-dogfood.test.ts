/**
 * The dogfooding gate's verdict logic.
 *
 * It had no tests, and shipped a flaw the first time it was asked to do
 * something interesting: the baseline subtracted a recorded violation from the
 * list but left `validate`'s own `reference: failed` standing, so the gate
 * stayed red for a case that had already been recorded and explained. The
 * mistake was checking the fix against a stale report rather than the one CI
 * produces.
 *
 * These cases pin the decision, not the report format: what is tolerated, what
 * is not, and — the case that matters most — that `not-checked` is never
 * tolerated no matter what the baseline says. That is what #542 was about.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSERT = join(REPO_ROOT, 'scripts', 'assert-dogfood.mjs');

/** The entry recorded in scripts/dogfood-baseline.json. */
const BASELINED = {
  sha: '03b4bfeed987d16e050504eaef0a1f07cb9db486',
  rule: 'dangling-ref',
  key: 'Follows',
  value: 'r-8c31f7',
};

const UNRECORDED = {
  sha: 'f'.repeat(40),
  rule: 'dangling-ref',
  key: 'Follows',
  value: 'r-nobody',
};

const directories: string[] = [];

afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

interface Report {
  checks: { class: string; status: string; reason?: string }[];
  violations: unknown[];
  secrets?: unknown[];
}

const assertOn = (report: Report): { status: number; stdout: string; stderr: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-dogfood-'));
  directories.push(dir);
  const path = join(dir, 'validate.json');
  writeFileSync(path, JSON.stringify(report));
  try {
    const stdout = execFileSync(process.execPath, [ASSERT, path], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { status: failure.status, stdout: failure.stdout, stderr: failure.stderr };
  }
};

const bothOk = (): Report => ({
  checks: [
    { class: 'shape', status: 'ok' },
    { class: 'reference', status: 'ok' },
  ],
  violations: [],
  secrets: [],
});

describe('the dogfooding gate accepts a clean report', () => {
  it('exits 0 and says both halves ran', () => {
    const result = assertOn(bothOk());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('shape: ok');
    expect(result.stdout).toContain('reference: ok');
  });
});

/**
 * The exact report CI produced on 427d264: one violation, all of it recorded,
 * and `reference` marked failed by that same violation.
 */
describe('the gate tolerates a failed check that the baseline fully explains', () => {
  const carriedOnly = (): Report => ({
    checks: [
      { class: 'shape', status: 'ok' },
      { class: 'reference', status: 'failed' },
    ],
    violations: [BASELINED],
    secrets: [],
  });

  it('exits 0, because nothing unrecorded remains', () => {
    expect(assertOn(carriedOnly()).status).toBe(0);
  });

  it('says how many were carried, so the exception stays visible', () => {
    const { stdout } = assertOn(carriedOnly());
    expect(stdout).toContain('1 carried from scripts/dogfood-baseline.json');
    expect(stdout).toContain('none unrecorded');
  });
});

describe('the gate refuses anything the baseline does not name', () => {
  it('refuses a violation absent from the baseline', () => {
    const result = assertOn({
      checks: [
        { class: 'shape', status: 'ok' },
        { class: 'reference', status: 'failed' },
      ],
      violations: [UNRECORDED],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('outside the recorded baseline');
  });

  it('refuses an unrecorded violation even alongside a carried one', () => {
    const result = assertOn({
      checks: [
        { class: 'shape', status: 'ok' },
        { class: 'reference', status: 'failed' },
      ],
      violations: [BASELINED, UNRECORDED],
    });
    expect(result.status).toBe(1);
  });

  // Without this, a baseline entry would buy silence for a check that never
  // ran — which is the failure the baseline was introduced alongside.
  it('never tolerates a sub-check that did not run, baseline or not', () => {
    const result = assertOn({
      checks: [
        { class: 'shape', status: 'ok' },
        { class: 'reference', status: 'not-checked', reason: 'notes mirror not fetched' },
      ],
      violations: [BASELINED],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('reference is not-checked');
  });

  it('refuses a failed check when nothing was carried to explain it', () => {
    const result = assertOn({
      checks: [
        { class: 'shape', status: 'failed' },
        { class: 'reference', status: 'ok' },
      ],
      violations: [],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('shape is failed');
  });

  it('refuses a report missing a check class entirely', () => {
    const result = assertOn({ checks: [{ class: 'shape', status: 'ok' }], violations: [] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no reference check');
  });

  it('refuses a report carrying secrets', () => {
    const result = assertOn({ ...bothOk(), secrets: ['AKIA...'] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('secret');
  });
});
