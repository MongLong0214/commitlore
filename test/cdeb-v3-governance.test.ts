import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { assertCandidateSelectable, qualificationStatusFor } from '../bench/cdeb/candidate-v3.js';
import { INVALIDATED, STUDY_STATES, canTransition } from '../bench/cdeb/lifecycle.js';
import { appendTransition, currentState } from '../bench/cdeb/ledger.js';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = resolve(HERE, '..');
const CDEB_ROOT = join(ROOT, 'bench', 'cdeb');
const OLD_STUDY = join(CDEB_ROOT, 'studies', 'cdeb-fresh-v3');
const SUCCESSOR = join(CDEB_ROOT, 'studies', 'cdeb-fresh-v3r1');
const digest = 'a'.repeat(64);

const transition = (overrides: Record<string, unknown> = {}) => ({
  from: 'DRAFT',
  to: 'LITERATURE_LOCKED',
  timestamp: '2026-08-21T00:00:00Z',
  actor_role: 'OWNER',
  input_digest: digest,
  output_digest: digest,
  checks: ['source and audit evidence reviewed'],
  deviations: [],
  ...overrides,
});

const tempStudy = (): string => {
  const study = mkdtempSync(join(tmpdir(), 'cdeb-v3-governance-'));
  mkdirSync(join(study, 'literature', 'audits'), { recursive: true });
  writeFileSync(join(study, 'study.json'), '{"study_id":"cdeb-governance"}\n');
  writeFileSync(join(study, 'transitions.jsonl'), '');
  writeFileSync(join(study, 'literature', 'source-lock.json'), '{"sources":[]}\n');
  writeFileSync(join(study, 'literature', 'evidence-matrix.json'), '{"claims":[]}\n');
  return study;
};

const writeReadyLiterature = (study: string): void => {
  writeFileSync(join(study, 'literature', 'source-lock.json'), '{"sources":[{"source_id":"LIT-1"}]}\n');
  writeFileSync(join(study, 'literature', 'evidence-matrix.json'), '{"claims":[{"claim_id":"C-1","status":"resolved"}]}\n');
  writeFileSync(join(study, 'literature', 'audits', 'lit-a.json'), '{}\n');
  writeFileSync(join(study, 'literature', 'audits', 'lit-b.json'), '{}\n');
  writeFileSync(join(study, 'literature', 'audits', 'adjudication.json'), '{}\n');
};

describe('CDEB-Fresh v3 corrective governance', () => {
  it('makes INVALIDATED terminal and reachable from every non-invalidated state', () => {
    for (const state of STUDY_STATES) {
      if (state === INVALIDATED) continue;
      expect(canTransition(state, INVALIDATED), `${state} -> INVALIDATED`).toBe(true);
    }
    for (const state of STUDY_STATES) {
      expect(canTransition(INVALIDATED, state), `INVALIDATED -> ${state}`).toBe(false);
    }
  });

  it.each([
    ['0 sources', (study: string) => writeFileSync(join(study, 'literature', 'source-lock.json'), '{"sources":[]}\n'), /source-lock sources must be > 0 \(measured 0\)/],
    ['0 claims', (study: string) => writeFileSync(join(study, 'literature', 'evidence-matrix.json'), '{"claims":[]}\n'), /evidence-matrix claims must be > 0 \(measured 0\)/],
    ['missing LIT-A audit', (study: string) => rmSync(join(study, 'literature', 'audits', 'lit-a.json')), /LIT-A artifact must exist \(measured 0\)/],
    ['missing LIT-B audit', (study: string) => rmSync(join(study, 'literature', 'audits', 'lit-b.json')), /LIT-B artifact must exist \(measured 0\)/],
    ['missing adjudication audit', (study: string) => rmSync(join(study, 'literature', 'audits', 'adjudication.json')), /adjudication artifact must exist \(measured 0\)/],
    ['an unresolved claim', (study: string) => writeFileSync(join(study, 'literature', 'evidence-matrix.json'), '{"claims":[{"claim_id":"C-1","status":"unresolved"}]}\n'), /unresolved claims must be 0 \(measured 1\)/],
  ])('refuses LITERATURE_LOCKED with %s', (_label, mutate, refusal) => {
    const study = tempStudy();
    writeReadyLiterature(study);
    mutate(study);

    expect(() => appendTransition(study, transition())).toThrow(refusal);
  });

  it('refuses UNKNOWN and a circular destination check even with real artifact-shaped inputs', () => {
    const unknown = tempStudy();
    writeReadyLiterature(unknown);
    expect(() => appendTransition(unknown, transition({ actor_role: 'UNKNOWN' }))).toThrow(
      /actor_role must be OWNER or FREEZE \(measured 0 authorized roles for UNKNOWN\)/,
    );

    const circular = tempStudy();
    writeReadyLiterature(circular);
    expect(() => appendTransition(circular, transition({ checks: ['LITERATURE_LOCKED is recorded'] }))).toThrow(
      /circular check names destination state LITERATURE_LOCKED \(measured 1\)/,
    );
  });

  it('preserves the false transition bytes and binds them from the deviation ledger', () => {
    const original = readFileSync(join(OLD_STUDY, 'transitions.jsonl')).subarray(
      0,
      readFileSync(join(OLD_STUDY, 'transitions.jsonl')).indexOf(0x0a) + 1,
    );
    const deviation = JSON.parse(readFileSync(join(OLD_STUDY, 'deviations.jsonl'), 'utf8')) as Record<string, unknown>;

    expect(Buffer.from(String(deviation.offending_transition_bytes_utf8), 'utf8')).toEqual(original);
    expect(Buffer.from(String(deviation.offending_transition_bytes_base64), 'base64')).toEqual(original);
    expect(deviation.offending_transition_sha256).toBe(createHash('sha256').update(original).digest('hex'));
    expect(currentState(OLD_STUDY)).toBe(INVALIDATED);
  });

  it('preserves the successor DRAFT origin and its unselected, unseeded, unmeasured corrected census', () => {
    const study = JSON.parse(readFileSync(join(SUCCESSOR, 'study.json'), 'utf8')) as Record<string, unknown>;
    const status = JSON.parse(readFileSync(join(SUCCESSOR, 'STATUS.json'), 'utf8')) as Record<string, unknown>;
    const selection = JSON.parse(readFileSync(join(SUCCESSOR, 'corpus', 'selection.json'), 'utf8')) as Record<string, unknown>;
    const ledger = readFileSync(join(SUCCESSOR, 'transitions.jsonl'), 'utf8').trim();
    const firstTransition = ledger === '' ? undefined : JSON.parse(ledger.split('\n')[0]!) as Record<string, unknown>;

    expect(study.study_id).toBe('cdeb-fresh-v3r1');
    expect(study.predecessor_study_id).toBe('cdeb-fresh-v3');
    expect(typeof study.predecessor_reason).toBe('string');
    expect(study.predecessor_reason).not.toBe('');
    if (firstTransition === undefined) {
      expect(currentState(SUCCESSOR)).toBe('DRAFT');
    } else {
      expect(firstTransition.from).toBe('DRAFT');
    }
    const state = currentState(SUCCESSOR);
    expect(status).toMatchObject({ measured_run_allowed: false });
    expect(status.phase).toBe(state.toLowerCase().replaceAll('_', '-'));
    expect(selection).toMatchObject({ selected: [], seed: null });
    const rows = readFileSync(join(SUCCESSOR, 'corpus', 'candidate-registry.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.schema_version === 3 && row.study_id === 'cdeb-fresh-v3r1' && !('benchmark' in row))).toBe(true);
    expect(rows.every((row) => row.qualification_status === 'pending' || row.qualification_status === 'ineligible')).toBe(true);
    expect(rows.some((row) => row.qualification_status === 'eligible')).toBe(false);
    expect(existsSync(join(SUCCESSOR, 'corpus', 'census-summary.json'))).toBe(true);
    expect(existsSync(join(SUCCESSOR, 'corpus', 'snapshots.json'))).toBe(true);
  });

  it('models a pending field as pending and bars it from selection', () => {
    const schema = JSON.parse(readFileSync(join(CDEB_ROOT, 'schemas', 'candidate-v3.schema.json'), 'utf8'));
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const pending = {
      schema_version: 3,
      study_id: 'cdeb-fresh-v3r1',
      candidate_id: 'candidate-1',
      repository_id: 'gitseed',
      source_snapshot_sha: 'a'.repeat(40),
      source_record_ids: ['r-source01'],
      source_refs: ['a'.repeat(40)],
      qualification_status: qualificationStatusFor(['human_review_required'], []),
      pending_fields: ['human_review_required'],
      ineligibility_codes: [],
    };

    expect(pending.qualification_status).toBe('pending');
    expect(validate(pending), JSON.stringify(validate.errors)).toBe(true);
    expect(() => assertCandidateSelectable(pending)).toThrow(/qualification_status is pending/);
    expect(validate({ ...pending, qualification_status: 'ineligible' })).toBe(false);
  });
});
