import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  DECISION_ANCHOR_FIELDS,
  assertNoDecisionAnchorExposure,
  canonicalDecisionAnchorJson,
  computeDecisionAnchor,
  decisionTextSha256,
  normalizeDecisionText,
  type DecisionAnchorInput,
} from '../bench/cdeb/freeze/decision-anchor.js';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const SCHEMA_PATH = resolve(
  HERE,
  '..',
  'bench/cdeb/studies/cdeb-fresh-v4/feasibility/decision-anchor.schema.json',
);

const base = (): DecisionAnchorInput => ({
  repository_id: 'gitseed',
  snapshot_sha: '222378defcb5d2d519184b6f23146abac631faba',
  source_commit_sha: 'b909d2c4023d4c1ca9ebe142f61a3d19c666ccaa',
  storage_kind: 'commit-trailer',
  storage_locator: 'refs/heads/cdeb-snapshot',
  decision_ordinal: 0,
  normalized_decision_sha256: decisionTextSha256('the seeder must not write outside the target directory'),
  normalized_reason_sha256: decisionTextSha256('a relative path from user input escaped the root in testing'),
  path_scope: ['src/seed.ts', 'src/paths.ts'],
  lifecycle: 'active',
});

const anchorWith = (overrides: Partial<Record<keyof DecisionAnchorInput, unknown>>): string =>
  computeDecisionAnchor({ ...base(), ...overrides });

describe('CDEB v4 decision audit anchor', () => {
  it('is deterministic for the same source and stable across key order', () => {
    const input = base();
    const first = computeDecisionAnchor(input);
    expect(computeDecisionAnchor({ ...input })).toBe(first);
    // A different insertion order is the same decision.
    const reordered = Object.fromEntries(
      Object.entries(input).reverse(),
    ) as unknown as DecisionAnchorInput;
    expect(computeDecisionAnchor(reordered)).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any load-bearing field changes, and for every field', () => {
    const original = computeDecisionAnchor(base());
    const mutations: Record<keyof DecisionAnchorInput, unknown> = {
      repository_id: 'agent-operator-score',
      snapshot_sha: 'a'.repeat(40),
      source_commit_sha: 'b'.repeat(40),
      storage_kind: 'git-note',
      storage_locator: 'refs/notes/commitlore',
      decision_ordinal: 1,
      normalized_decision_sha256: decisionTextSha256('the seeder may write outside the target directory'),
      normalized_reason_sha256: decisionTextSha256('a different reason entirely'),
      path_scope: ['src/seed.ts'],
      lifecycle: 'superseded',
    };
    // Every declared field is exercised: a field added to the type without a
    // mutation here fails this test rather than going unchecked.
    expect(Object.keys(mutations).sort()).toEqual([...DECISION_ANCHOR_FIELDS].sort());
    for (const [field, value] of Object.entries(mutations)) {
      expect(anchorWith({ [field]: value })).not.toBe(original);
    }
  });

  it('treats path scope as a set: reordering is the same scope, membership is not', () => {
    const original = computeDecisionAnchor(base());
    expect(anchorWith({ path_scope: ['src/paths.ts', 'src/seed.ts'] })).toBe(original);
    expect(anchorWith({ path_scope: ['src/paths.ts', 'src/seed.ts', 'src/cli.ts'] })).not.toBe(original);
    expect(anchorWith({ path_scope: ['src/paths.ts'] })).not.toBe(original);
  });

  it('normalizes whitespace in decision text but nothing else', () => {
    expect(normalizeDecisionText('  a  decision\n\tstated  ')).toBe('a decision stated');
    expect(decisionTextSha256('a decision\nstated')).toBe(decisionTextSha256('a decision stated'));
    expect(decisionTextSha256('A decision stated')).not.toBe(decisionTextSha256('a decision stated'));
    expect(decisionTextSha256('a decision stated.')).not.toBe(decisionTextSha256('a decision stated'));
    expect(decisionTextSha256('stated a decision')).not.toBe(decisionTextSha256('a decision stated'));
  });

  it('refuses malformed, incomplete and over-complete input rather than hashing it', () => {
    expect(() => computeDecisionAnchor({ ...base(), record_id: 'r-something' })).toThrow(/unknown field\(s\) record_id/);
    const { lifecycle: _lifecycle, ...withoutLifecycle } = base();
    expect(() => computeDecisionAnchor(withoutLifecycle)).toThrow(/missing field lifecycle/);
    expect(() => computeDecisionAnchor({ ...base(), snapshot_sha: 'not-an-oid' })).toThrow(/snapshot_sha must be a 40-character git object id/);
    expect(() => computeDecisionAnchor({ ...base(), decision_ordinal: -1 })).toThrow(/non-negative integer/);
    expect(() => computeDecisionAnchor({ ...base(), decision_ordinal: 1.5 })).toThrow(/non-negative integer/);
    expect(() => computeDecisionAnchor({ ...base(), path_scope: [] })).toThrow(/non-empty array/);
    expect(() => computeDecisionAnchor({ ...base(), path_scope: ['a', 'a'] })).toThrow(/must not repeat a path/);
    expect(() => computeDecisionAnchor({ ...base(), lifecycle: 'retired' })).toThrow(/lifecycle must be one of/);
    expect(() => computeDecisionAnchor({ ...base(), storage_kind: 'database' })).toThrow(/storage_kind must be one of/);
    expect(() => computeDecisionAnchor('a string')).toThrow(/input must be an object/);
  });

  it('carries no product identity: a Record-Id is not an input and cannot become one', () => {
    expect([...DECISION_ANCHOR_FIELDS]).not.toContain('record_id');
    expect(canonicalDecisionAnchorJson(base())).not.toMatch(/record[_-]?id/i);
  });

  it('keeps the published schema and the validator describing the same fields', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
      required: string[];
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual([...DECISION_ANCHOR_FIELDS].sort());
    expect(Object.keys(schema.properties).sort()).toEqual([...DECISION_ANCHOR_FIELDS].sort());
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(schema);
    expect(validate(base())).toBe(true);
    expect(validate({ ...base(), record_id: 'r-x' })).toBe(false);
  });

  it('refuses an anchor that reached an agent-facing payload', () => {
    const anchor = computeDecisionAnchor(base());
    const clean = 'Refactor the seeder so relative paths resolve under the target directory.';
    expect(() => assertNoDecisionAnchorExposure(clean, [anchor], 'task prompt')).not.toThrow();
    expect(() => assertNoDecisionAnchorExposure(`${clean}\n<!-- ${anchor} -->`, [anchor], 'task prompt'))
      .toThrow(/decision anchor exposure: anchor [0-9a-f]{12} appears in task prompt/);
    // A caller that passes something other than an anchor gets a refusal, not a
    // scan that quietly finds nothing.
    expect(() => assertNoDecisionAnchorExposure(clean, ['r-seedpath'], 'task prompt'))
      .toThrow(/not an anchor/);
  });

  it('binds the whole canonical form: the hash is over the serialization it publishes', () => {
    const json = canonicalDecisionAnchorJson(base());
    expect(createHash('sha256').update(json, 'utf8').digest('hex')).toBe(computeDecisionAnchor(base()));
    expect(json.startsWith('{"decision_ordinal":')).toBe(true);
    expect(json).not.toContain(' ');
  });
});
