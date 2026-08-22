/** CDEB-Fresh v5 Stage 0 governance: a HOLD is as terminal as an invalidation. */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  TERMINAL_STUDY_PHASES,
  assertMeasuredRunAuthorized,
  resolveActiveStudyRoot,
} from '../bench/cdeb/active-study.js';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = resolve(HERE, '..');
const CDEB_ROOT = join(ROOT, 'bench', 'cdeb');
const V5 = join(CDEB_ROOT, 'studies', 'cdeb-fresh-v5');

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

const cdebRootNaming = (studyId: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'cdeb-v5-active-'));
  mkdirSync(join(root, 'studies'), { recursive: true });
  for (const study of ['cdeb-fresh-v3', 'cdeb-fresh-v3r1', 'cdeb-fresh-v4', 'cdeb-fresh-v5']) {
    const source = join(CDEB_ROOT, 'studies', study, 'STATUS.json');
    if (!existsSync(source)) continue;
    mkdirSync(join(root, 'studies', study), { recursive: true });
    cpSync(source, join(root, 'studies', study, 'STATUS.json'));
  }
  writeFileSync(
    join(root, 'ACTIVE-STUDY.json'),
    `${JSON.stringify({
      active_study_id: studyId,
      last_terminal_study_id: 'cdeb-fresh-v4',
      status: 'active',
      reason: 'test declaration',
      successor_requires_new_study_id: true,
    }, null, 2)}\n`,
  );
  return root;
};

describe('CDEB v5 Stage 0 governance', () => {
  it('refuses every ended predecessor as the active study, HOLD included', () => {
    // v4 reached a verdict rather than being invalidated. Running anything
    // against it would attribute the result to a study that already ended, so
    // the two endings are treated the same.
    expect([...TERMINAL_STUDY_PHASES]).toEqual(['invalidated', 'stage0-hold']);
    for (const ended of ['cdeb-fresh-v3', 'cdeb-fresh-v3r1', 'cdeb-fresh-v4']) {
      expect(() => resolveActiveStudyRoot(cdebRootNaming(ended))).toThrow(
        new RegExp(`Refused terminal study ${ended} as the active study`),
      );
    }
  });

  it('seals v4 at HOLD with its results intact', () => {
    const status = readJson(join(CDEB_ROOT, 'studies', 'cdeb-fresh-v4', 'STATUS.json'));
    expect(status).toMatchObject({
      study_id: 'cdeb-fresh-v4',
      phase: 'stage0-hold',
      measured_run_allowed: false,
      successor_required: true,
      verdict: 'HOLD',
    });
    // The verdict and its evidence stay readable; sealing is not deletion.
    const summary = readJson(join(CDEB_ROOT, 'studies', 'cdeb-fresh-v4', 'feasibility', 'qualification-summary.json'));
    expect((summary.verdict as Record<string, unknown>).verdict).toBe('HOLD');
    expect(summary.measured_product_effect_rows).toBe(0);
    expect(existsSync(join(CDEB_ROOT, 'studies', 'cdeb-fresh-v4', 'feasibility', 'RESULT.md'))).toBe(true);
    expect(existsSync(join(CDEB_ROOT, 'studies', 'cdeb-fresh-v4', 'feasibility', 'adversarial-review.md'))).toBe(true);
  });

  it('resolves v5 as active with the measured run still shut', () => {
    expect(resolveActiveStudyRoot(CDEB_ROOT)).toBe(V5);
    const study = readJson(join(V5, 'study.json'));
    const status = readJson(join(V5, 'STATUS.json'));
    expect(status).toMatchObject({ study_id: 'cdeb-fresh-v5', measured_run_allowed: false });
    expect(study).toMatchObject({
      study_id: 'cdeb-fresh-v5',
      measured_run_allowed: false,
      record_id_required: false,
      independent_corroboration_required: false,
      owner_testimony: 'disabled',
    });
    expect(() => assertMeasuredRunAuthorized(V5)).toThrow(/measured_run_allowed is not true/);
  });

  it('registers A0 as primary admission and keeps corroboration out of it', () => {
    const policy = readJson(join(V5, 'authority-policy.json'));
    const tiers = policy.tiers as Record<string, Record<string, unknown>>;
    expect(tiers.A0.role).toBe('primary admission');
    expect(tiers.A0.not_required).toEqual([
      'a duplicate prose source',
      'a valid Record-Id',
      'independent corroboration',
    ]);
    expect(tiers.A1.role).toBe('evidence-strength metadata only');
    expect(tiers.A2.role).toBe('disabled for v5');
    expect(tiers.A2.collected).toBe(0);
    const anti = policy.anti_circularity as Record<string, unknown>;
    expect(anti.forbidden_outcomes).toEqual([
      'whether the agent mentioned a Record-Id',
      "whether the agent repeated the record's wording",
      'whether the agent stated the reason',
    ]);
  });

  it('registers the owner thresholds and forbids the v4 gate returning under a new name', () => {
    const prereg = readFileSync(join(V5, 'STAGE0-PREREGISTRATION.md'), 'utf8');
    expect(prereg).toContain('eligible repository   final A0-qualified >= 8');
    expect(prereg).toContain('eligible repositories        >= 3');
    expect(prereg).toContain('total final A0-qualified     >= 36');
    expect(prereg).toContain('`missing-record-id` and `insufficient-provenance` are **not** codes here');
    expect(prereg).toContain('36 is a feasibility floor, not a sample size');
    // The record being in Git is the treatment, not a leak — stating the
    // opposite would rebuild v4's gate inside G8.
    expect(prereg).toContain('The record existing in Git is not\nleakage — it is the treatment content.');
    const policy = readJson(join(V5, 'authority-policy.json'));
    expect(String(policy.forbidden_reintroduction)).toMatch(/documented outside its record/);
  });

  it('creates no measured-run directory under the Stage 0 study', () => {
    for (const forbidden of ['tasks', 'gold', 'oracles', 'pilot', 'rows', 'randomization']) {
      expect(existsSync(join(V5, forbidden))).toBe(false);
    }
  });
});
