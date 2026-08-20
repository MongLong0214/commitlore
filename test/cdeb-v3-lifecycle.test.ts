import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import { assertTransition, canTransition, STUDY_STATES } from '../bench/cdeb/lifecycle.js';
import { appendTransition, currentState, readTransitions } from '../bench/cdeb/ledger.js';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = resolve(HERE, '..');
const CDEB_ROOT = join(ROOT, 'bench', 'cdeb');
const STUDY_ROOT = join(CDEB_ROOT, 'studies', 'cdeb-fresh-v3');

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sha = 'a'.repeat(64);
const oid = 'b'.repeat(40);

const transition = (from = 'DRAFT', to = 'LITERATURE_LOCKED') => ({
  from,
  to,
  timestamp: '2026-08-21T00:00:00Z',
  actor_role: 'OWNER',
  input_digest: sha,
  output_digest: sha,
  checks: ['verified'],
  deviations: [],
});

const gold = () => ({
  schema_version: 3,
  study_id: 'cdeb-fresh-v3',
  task_id: 'gitseed-architecture-001',
  repository_id: 'gitseed',
  record_id: 'r-abcd',
  snapshot_sha: oid,
  decision_kind: 'ruled-out',
  decision: 'The queue remains in-process.',
  rejected_approach: 'Use a remote queue.',
  reason: 'The deployment topology does not provide one.',
  scope: ['src/queue.ts'],
  lifecycle: 'active',
  source_anchors: [{ kind: 'adr', ref: 'ADR-1', quote_hash: sha }],
  expected_record_ids: ['r-abcd'],
  expected_shipping_grade: 'directive',
  violation_contract: 'A remote queue is a violation.',
  compliance_contract: 'The in-process queue is compliant.',
  annotator_a_id: 'gold-a-session',
  annotator_b_id: 'gold-b-session',
  adjudicated_resolution: 'resolved',
  source_packet_sha256: sha,
  owner_approved: true,
});

const runRow = () => ({
  study_id: 'cdeb-fresh-v3',
  run_id: 'run-001',
  task_id: 'gitseed-architecture-001',
  repository_id: 'gitseed',
  arm: 'delivery-on',
  repeat: 1,
  block_id: 'opaque-001',
  status: 'completed',
  release_tag: 'v1.2.0',
  model_id: 'model-1',
  base_tree_oid: oid,
  final_tree_oid: oid,
  functional_pass: true,
  revived: false,
  decision_safe_success: true,
  functionally_viable_revival: false,
  opportunity: { read: 3, mutation: 1 },
  exposure_outcome: 'delivered',
  delivery: {
    expected_record_ids: ['r-abcd'],
    delivered_record_ids: ['r-abcd'],
    before_first_mutation: true,
    critical_ruling_visible: true,
    grade: 'directive',
    coverage: 'complete',
    stale_as_current: [],
  },
  explicit_uptake_observed: false,
  usage: { input: 0, output: 0, cache_creation: 0, cache_read: 0 },
  turns: 0,
  tool_calls: 0,
  files_read: 0,
  wall_ms: 0,
  row_sha256: sha,
});

const patchAudit = () => ({
  run_id: 'run-001',
  reviewer_role: 'PATCH-A',
  reviewer_family: 'independent-family',
  re_explanation_required: true,
  confidence: 'high',
  reason_code: 'rejected-approach-repeated',
  adjudicated: false,
});

const tempStudy = (id = 'cdeb-test'): string => {
  const directory = mkdtempSync(join(tmpdir(), 'cdeb-v3-lifecycle-'));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'study.json'), `${JSON.stringify({ study_id: id })}\n`);
  return directory;
};

describe('CDEB-Fresh v3 lifecycle', () => {
  it('allows each earned forward step and refuses every other direction', () => {
    for (let index = 0; index < STUDY_STATES.length - 1; index += 1) {
      const from = STUDY_STATES[index]!;
      const to = STUDY_STATES[index + 1]!;
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    }

    for (let fromIndex = 0; fromIndex < STUDY_STATES.length; fromIndex += 1) {
      const from = STUDY_STATES[fromIndex]!;
      expect(canTransition(from, from), `${from} -> ${from}`).toBe(false);
      expect(() => assertTransition(from, from)).toThrow(`${from} to ${from}`);
      for (let toIndex = 0; toIndex < fromIndex; toIndex += 1) {
        const to = STUDY_STATES[toIndex]!;
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
        expect(() => assertTransition(from, to)).toThrow(`${from} to ${to}`);
      }
      for (let toIndex = fromIndex + 2; toIndex < STUDY_STATES.length; toIndex += 1) {
        const skipped = STUDY_STATES[toIndex]!;
        expect(canTransition(from, skipped), `${from} -> ${skipped}`).toBe(false);
      }
    }
  });

  it('treats the audited transition ledger as authoritative over STATUS.json', () => {
    // The ledger is authoritative if the two ever disagree: it is the append-only
    // audit trail specified by §4.2, while STATUS.json is its readable projection.
    const status = readJson(join(STUDY_ROOT, 'STATUS.json')) as { phase: string };
    const statusToState: Record<string, string> = { 'literature-lock': 'LITERATURE_LOCKED' };
    expect(currentState(STUDY_ROOT)).toBe(statusToState[status.phase]);
    expect(readTransitions(STUDY_ROOT)).toHaveLength(1);
  });

  it('refuses a schema-invalid append without changing the ledger', () => {
    const study = tempStudy();
    const ledger = join(study, 'transitions.jsonl');
    writeFileSync(ledger, '');
    const before = readFileSync(ledger, 'utf8');
    const invalid = transition();
    invalid.checks = [];

    expect(() => appendTransition(study, invalid)).toThrow(/Invalid transition artifact/);
    expect(readFileSync(ledger, 'utf8')).toBe(before);
  });

  it('appends exactly one valid next transition to an empty ledger', () => {
    const study = tempStudy();
    const ledger = join(study, 'transitions.jsonl');

    expect(currentState(study)).toBe('DRAFT');
    appendTransition(study, transition());
    expect(readFileSync(ledger, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(currentState(study)).toBe('LITERATURE_LOCKED');
  });

  it('refuses a row from another study and names both study ids', () => {
    const study = tempStudy('cdeb-local');
    const foreign = { ...transition(), study_id: 'cdeb-v1-3' };

    expect(() => appendTransition(study, foreign)).toThrow(/cdeb-local.*cdeb-v1-3/);
    expect(readTransitions(study)).toEqual([]);
  });

  it('refuses a foreign-study row while reading a ledger file', () => {
    const study = tempStudy('cdeb-local');
    writeFileSync(join(study, 'transitions.jsonl'), `${JSON.stringify({ ...transition(), study_id: 'cdeb-v1-3' })}\n`);

    expect(() => readTransitions(study)).toThrow(/line 1.*cdeb-local.*cdeb-v1-3/);
  });
});

describe('CDEB-Fresh v3 schemas', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const transitionSchema = ajv.compile(readJson(join(CDEB_ROOT, 'schemas', 'transition.schema.json')));
  const goldSchema = ajv.compile(readJson(join(CDEB_ROOT, 'schemas', 'gold.schema.json')));
  const runRowSchema = ajv.compile(readJson(join(CDEB_ROOT, 'schemas', 'run-row.schema.json')));
  const patchAuditSchema = ajv.compile(readJson(join(CDEB_ROOT, 'schemas', 'patch-audit.schema.json')));

  it('compiles and accepts one valid instance of every new schema', () => {
    expect(transitionSchema(transition())).toBe(true);
    expect(goldSchema(gold())).toBe(true);
    expect(runRowSchema(runRow())).toBe(true);
    expect(patchAuditSchema(patchAudit())).toBe(true);
  });

  it('refuses real malformed transition, gold, run, and patch records', () => {
    const invalidTransition = clone(transition());
    invalidTransition.from = 'NOT_A_STATE';

    const invalidGold = { ...gold(), unexpected: 'not part of the resolved record' };

    const missingDigest = clone(runRow());
    delete (missingDigest as { row_sha256?: string }).row_sha256;
    const unknownArm = clone(runRow());
    unknownArm.arm = 'delivery-maybe';

    const invalidPatchAudit = { ...patchAudit(), unexpected: true };

    expect(transitionSchema(invalidTransition)).toBe(false);
    expect(goldSchema(invalidGold)).toBe(false);
    expect(runRowSchema(missingDigest)).toBe(false);
    expect(runRowSchema(unknownArm)).toBe(false);
    expect(patchAuditSchema(invalidPatchAudit)).toBe(false);
  });

  it('uses closed gold vocabularies where §8 leaves labels open', () => {
    // §8 names the fields but not the labels for decision kind, lifecycle,
    // source-anchor kind, or adjudication. These finite enums are the narrower
    // choice so a later author cannot introduce an unreviewed semantic category.
    const invalidGold = clone(gold());
    invalidGold.adjudicated_resolution = 'probably-resolved';
    expect(goldSchema(invalidGold)).toBe(false);
  });
});
