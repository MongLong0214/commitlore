/**
 * CDEB §4.9 acceptance: the delivery qualification drives the shipping hook,
 * and answers correctly on repositories whose answer is already known.
 *
 * The case that matters most is the third one. `commitlore context` was the
 * first implementation of this check, and a review rejected it because a record
 * can render there and still never reach an agent — the injection budget, trust
 * grading, the guard and the matcher all sit in between. So one fixture puts a
 * record in the repository and squeezes the budget until the shipping hook
 * cannot carry it: `context` would still show it, and this check must fail.
 * That is the whole difference between the two surfaces, made into a test.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { probeDelivery, qualifyDelivery } from '../bench/cdeb/freeze/delivery-check.ts';
import { execGit } from '../src/core/git.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const AUTHOR = 'owner@example.invalid';
const BUDGET = 800;

let repo: string;

beforeEach(() => {
  repo = createTestRepo({ path: mkdtempSync(join(realpathSync(tmpdir()), 'cdeb-deliv-')) });
  scratch.push(repo);
  execGit(['config', 'user.email', AUTHOR], { cwd: repo });
  execGit(['config', 'user.name', 'owner'], { cwd: repo });
});

/** Commits `file` carrying a record that rules something out. */
const seed = (file: string, recordId: string, reason = 'ops refuses another stateful dependency'): void => {
  writeFileSync(join(repo, file), `export const x = ${String(file.length)};\n`);
  execGit(['add', '-A'], { cwd: repo });
  execGit(
    [
      'commit',
      '--no-verify',
      '-m',
      [
        `feat: touch ${file}`,
        '',
        `Ruled-out: shared Redis cache | ${reason}`,
        `Record-Id: ${recordId}`,
        'Provenance: authored',
      ].join('\n'),
    ],
    { cwd: repo },
  );
};

describe('§4.9 delivery qualification', () => {
  it('qualifies a task whose edited path carries its record', () => {
    seed('pricing.ts', 'r-deliv01');

    const result = qualifyDelivery(repo, ['r-deliv01'], ['pricing.ts'], BUDGET);

    expect(result.qualified, JSON.stringify(result.unmet)).toBe(true);
    expect(result.verified_via).toBe('shipping-inject-hook');
    expect(result.probes[0]?.delivered).toBe(true);
    expect(result.probes[0]?.payload_bytes).toBeGreaterThan(0);
  });

  it('refuses a task whose edited path carries nothing — the pilot failure', () => {
    // Two of four pilot tasks delivered zero records to the ON arm. This is
    // that shape: the record exists in the repository, on another path.
    seed('pricing.ts', 'r-deliv01');
    seed('unrelated.ts', 'r-other02');

    const result = qualifyDelivery(repo, ['r-deliv01'], ['unrelated.ts'], BUDGET);

    expect(result.qualified).toBe(false);
    expect(result.unmet).toEqual(['r-deliv01']);
  });

  it('refuses when the shipping budget cannot carry the record, though it exists', () => {
    // The reason `commitlore context` was the wrong check. The record is in the
    // repository and on the edited path; only the shipping injection budget
    // stands between it and the agent, and the ON arm is the shipping budget.
    seed('pricing.ts', 'r-deliv01', 'x'.repeat(400));

    const generous = probeDelivery(repo, { path: 'pricing.ts', record_id: 'r-deliv01' }, BUDGET);
    const squeezed = probeDelivery(repo, { path: 'pricing.ts', record_id: 'r-deliv01' }, 1);

    expect(generous.delivered).toBe(true);
    expect(squeezed.delivered).toBe(false);
    expect(squeezed.payload_bytes).toBeLessThan(generous.payload_bytes);
  });

  it('requires every expected record, not merely one of them', () => {
    // A task whose second record never arrives has an oracle that can fire on a
    // decision the ON arm never saw.
    seed('pricing.ts', 'r-deliv01');

    const result = qualifyDelivery(repo, ['r-deliv01', 'r-missing99'], ['pricing.ts'], BUDGET);

    expect(result.qualified).toBe(false);
    expect(result.unmet).toEqual(['r-missing99']);
  });

  it('accepts a record carried by any one of the good control paths', () => {
    seed('pricing.ts', 'r-deliv01');
    seed('other.ts', 'r-second02');

    const result = qualifyDelivery(repo, ['r-deliv01'], ['other.ts', 'pricing.ts'], BUDGET);

    expect(result.qualified).toBe(true);
    expect(result.probes.filter((probe) => probe.delivered)).toHaveLength(1);
  });

  it('records the payload digest and exit code rather than throwing on them', () => {
    // The hook is fail-open by design. A task whose record only arrives when
    // the product errors is not qualified either way, so the exit code belongs
    // in the freeze manifest rather than in an exception.
    seed('pricing.ts', 'r-deliv01');
    const probe = probeDelivery(repo, { path: 'pricing.ts', record_id: 'r-deliv01' }, BUDGET);

    expect(probe.payload_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(probe.exit_code).toBe(0);
  });
});
