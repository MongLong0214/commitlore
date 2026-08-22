import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assertMeasuredRunAuthorized, resolveActiveStudyRoot } from '../bench/cdeb/active-study.js';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = resolve(HERE, '..');
const CDEB_ROOT = join(ROOT, 'bench', 'cdeb');
const V4 = join(CDEB_ROOT, 'studies', 'cdeb-fresh-v4');

const OWNER_DECISION =
  'The estimand concerns delivery of a prior repository decision, not delivery of a product Record-Id.';

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

/**
 * A copy of the real CDEB root with only the declaration rewritten. Copying the
 * studies means the refusals below are tested against the actual STATUS.json
 * each study ships, not against a fixture that could disagree with it.
 */
const cdebRootWithDeclaration = (declaration: unknown): string => {
  const root = mkdtempSync(join(tmpdir(), 'cdeb-active-'));
  mkdirSync(join(root, 'studies'), { recursive: true });
  for (const study of ['cdeb-fresh-v3', 'cdeb-fresh-v3r1', 'cdeb-fresh-v4']) {
    const source = join(CDEB_ROOT, 'studies', study, 'STATUS.json');
    if (!existsSync(source)) continue;
    mkdirSync(join(root, 'studies', study), { recursive: true });
    cpSync(source, join(root, 'studies', study, 'STATUS.json'));
  }
  writeFileSync(join(root, 'ACTIVE-STUDY.json'), `${JSON.stringify(declaration, null, 2)}\n`);
  return root;
};

const declaration = (overrides: Record<string, unknown> = {}) => ({
  active_study_id: 'cdeb-fresh-v4',
  last_terminal_study_id: 'cdeb-fresh-v3r1',
  status: 'active',
  reason: 'test declaration',
  successor_requires_new_study_id: true,
  ...overrides,
});

describe('CDEB v4 Stage 0 governance', () => {
  it('refuses to make either invalidated predecessor the active study', () => {
    for (const terminal of ['cdeb-fresh-v3', 'cdeb-fresh-v3r1']) {
      const root = cdebRootWithDeclaration(declaration({ active_study_id: terminal }));
      expect(() => resolveActiveStudyRoot(root)).toThrow(
        new RegExp(`Refused terminal study ${terminal} as the active study`),
      );
    }
  });

  it('fails closed when the named study has no readable, matching status', () => {
    const missing = cdebRootWithDeclaration(declaration({ active_study_id: 'cdeb-fresh-v9' }));
    expect(() => resolveActiveStudyRoot(missing)).toThrow(/Cannot read STATUS.json for active study cdeb-fresh-v9/);

    const mismatched = cdebRootWithDeclaration(declaration());
    writeFileSync(
      join(mismatched, 'studies', 'cdeb-fresh-v4', 'STATUS.json'),
      '{"study_id":"cdeb-fresh-v3r1","phase":"stage0-corpus-feasibility"}\n',
    );
    expect(() => resolveActiveStudyRoot(mismatched)).toThrow(/declares cdeb-fresh-v3r1/);
  });

  it('refuses a declaration whose status and id disagree in either direction', () => {
    const noId = cdebRootWithDeclaration(declaration({ active_study_id: null }));
    expect(() => resolveActiveStudyRoot(noId)).toThrow(/Contradictory active-study declaration/);
    const noStatus = cdebRootWithDeclaration(declaration({ status: 'no-active-study' }));
    expect(() => resolveActiveStudyRoot(noStatus)).toThrow(/Contradictory active-study declaration/);
    const unknownStatus = cdebRootWithDeclaration(declaration({ status: 'paused' }));
    expect(() => resolveActiveStudyRoot(unknownStatus)).toThrow(/Invalid active-study declaration/);
  });

  it('has handed the active slot on and cannot take it back', () => {
    // v4 reached HOLD and a successor now holds the slot. What has to stay true
    // is not that v4 is active -- it is that v4 can never be active again while
    // its own status says it ended.
    expect(resolveActiveStudyRoot(CDEB_ROOT)).not.toBe(V4);
    const status = readJson(join(V4, 'STATUS.json'));
    const study = readJson(join(V4, 'study.json'));
    expect(status).toMatchObject({ study_id: 'cdeb-fresh-v4', phase: 'stage0-hold', measured_run_allowed: false, verdict: 'HOLD' });
    expect(study).toMatchObject({ study_id: 'cdeb-fresh-v4', measured_run_allowed: false, record_id_required: false });
    expect(study.predecessor_artifact_reuse).toBe('none');
    expect(() => assertMeasuredRunAuthorized(V4)).toThrow(/measured_run_allowed is not true/);
  });

  it('records the owner estimand decision verbatim in both the machine and prose artifacts', () => {
    const decision = readJson(join(V4, 'owner-estimand-decision.json'));
    const prereg = readFileSync(join(V4, 'STAGE0-PREREGISTRATION.md'), 'utf8');
    expect(decision.decision).toBe(OWNER_DECISION);
    expect(prereg).toContain(OWNER_DECISION);
    const ruledOut = (decision.ruled_out as Array<{ option: string }>).map((entry) => entry.option);
    expect(ruledOut).toEqual(['backfill', 'synthetic IDs', 'resuming v3r1', 'dropping legacy decisions solely for missing identity']);
    expect(String(decision.limit)).toMatch(/every provenance, viability, oracle, and delivery gate/);
  });

  it('registers the GO thresholds and forbids the pool-as-tasks phrasings', () => {
    const prereg = readFileSync(join(V4, 'STAGE0-PREREGISTRATION.md'), 'utf8');
    expect(prereg).toContain('eligible repositories                        >= 3');
    expect(prereg).toContain('qualified candidates per eligible repository >= 12');
    expect(prereg).toContain('total qualified non-pilot candidates         >= 48');
    // The forbidden phrases appear once each, inside the block that forbids them.
    for (const phrase of ['158 tasks secured', '158 eligible tasks', '158 benchmark cases']) {
      expect(prereg.split(phrase).length - 1).toBe(1);
    }
    expect(prereg).toContain('`missing-record-id` is not a code');
  });

  it('creates no measured-run directory under the Stage 0 study', () => {
    for (const forbidden of ['tasks', 'gold', 'oracles', 'pilot', 'rows', 'randomization']) {
      expect(existsSync(join(V4, forbidden))).toBe(false);
    }
    expect(existsSync(join(V4, 'feasibility'))).toBe(true);
  });

  it('leaves both predecessors terminal and holding no measured rows', () => {
    for (const predecessor of ['cdeb-fresh-v3', 'cdeb-fresh-v3r1']) {
      const status = readJson(join(CDEB_ROOT, 'studies', predecessor, 'STATUS.json'));
      expect(status).toMatchObject({ phase: 'invalidated', measured_run_allowed: false });
      expect(existsSync(join(CDEB_ROOT, 'studies', predecessor, 'rows'))).toBe(true);
      const rows = readFileSync(join(CDEB_ROOT, 'studies', predecessor, 'rows', '.gitkeep'), 'utf8');
      expect(rows).toBe('');
    }
  });
});
