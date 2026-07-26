/**
 * SPEC §6 validation: invalid fixtures produce the expected violation record,
 * valid and boundary fixtures produce none.
 */

import { describe, expect, it } from 'vitest';

import { validateRecord } from '../src/core/schema.js';
import { parseCommitMessage } from '../src/core/trailers.js';
import { loadCanonicalFixtures, loadFixtures } from './fixtures.js';

const invalidFixtures = loadFixtures('invalid');
const cleanFixtures = loadCanonicalFixtures();

/**
 * `dangling-ref` asks whether a referenced Record-Id exists elsewhere in
 * history. `validateRecord` sees one record, so it cannot and must not answer
 * that — the stale engine (T-205) does.
 */
const isCrossRecord = (fixture: { expected: { violations?: { rule: string }[] } }): boolean =>
  (fixture.expected.violations ?? []).some((violation) => violation.rule === 'dangling-ref');

const singleRecordInvalid = invalidFixtures.filter((fixture) => !isCrossRecord(fixture));
const crossRecordInvalid = invalidFixtures.filter(isCrossRecord);

describe('validateRecord', () => {
  it('finds both single-record and cross-record invalid fixtures on disk', () => {
    expect(singleRecordInvalid.length).toBeGreaterThan(0);
    expect(crossRecordInvalid.length).toBeGreaterThan(0);
  });

  it.each(cleanFixtures)('$id is well-formed', (fixture) => {
    expect(validateRecord(parseCommitMessage(fixture.message))).toEqual([]);
  });

  it.each(singleRecordInvalid)('$id reports exactly the expected violations', (fixture) => {
    const violations = validateRecord(parseCommitMessage(fixture.message));
    expect(violations.map((violation) => violation.rule)).toEqual(
      (fixture.expected.violations ?? []).map((violation) => violation.rule),
    );
    expect(violations).toEqual(fixture.expected.violations);
  });

  it.each(crossRecordInvalid)('$id is clean at single-record scope (T-205 owns it)', (fixture) => {
    expect(validateRecord(parseCommitMessage(fixture.message))).toEqual([]);
  });

  it('accepts an empty record', () => {
    expect(validateRecord([])).toEqual([]);
  });

  it('rejects each enum key with a value outside its set (SPEC §3.3)', () => {
    expect(validateRecord([{ key: 'Undo', value: 'clean' }])).toEqual([
      { key: 'Undo', value: 'clean', rule: 'enum', got: 'clean', want: 'easy|costly|permanent' },
    ]);
    expect(validateRecord([{ key: 'Certainty', value: 'high' }])).toEqual([
      {
        key: 'Certainty',
        value: 'high',
        rule: 'enum',
        got: 'high',
        want: 'firm|tentative|guess',
      },
    ]);
  });

  it('rejects a malformed Record-Id but accepts a well-formed one', () => {
    expect(validateRecord([{ key: 'Record-Id', value: 'nope' }])).toEqual([
      {
        key: 'Record-Id',
        value: 'nope',
        rule: 'format',
        got: 'nope',
        want: 'r-[a-z0-9]{6,}',
      },
    ]);
    expect(validateRecord([{ key: 'Record-Id', value: 'r-9d4f20' }])).toEqual([]);
  });

  it('rejects an impossible calendar date but accepts a free-text condition', () => {
    expect(validateRecord([{ key: 'Expires', value: '2026-13-45' }])).toEqual([
      {
        key: 'Expires',
        value: '2026-13-45',
        rule: 'format',
        got: '2026-13-45',
        want: 'YYYY-MM-DD or a free-text condition',
      },
    ]);
    expect(validateRecord([{ key: 'Expires', value: 'when the importer is retired' }])).toEqual([]);
  });

  it('accepts every X- extension key without interpreting it (SPEC §3.2)', () => {
    expect(validateRecord([{ key: 'X-Anything', value: 'whatever | it: wants' }])).toEqual([]);
  });

  it('reports every occurrence of a single-valued key after the first', () => {
    const violations = validateRecord([
      { key: 'Blast', value: 'local' },
      { key: 'Blast', value: 'module' },
      { key: 'Blast', value: 'system' },
    ]);
    expect(violations).toEqual([
      { key: 'Blast', value: 'module', rule: 'cardinality', got: '2', want: 'at most 1' },
      { key: 'Blast', value: 'system', rule: 'cardinality', got: '3', want: 'at most 1' },
    ]);
  });

  it('allows repeated occurrences of a repeatable key', () => {
    expect(
      validateRecord([
        { key: 'Limit', value: 'one' },
        { key: 'Limit', value: 'two' },
      ]),
    ).toEqual([]);
  });

  it('reports several independent violations in trailer order', () => {
    const violations = validateRecord([
      { key: 'Constraint', value: 'unknown key' },
      { key: 'Blast', value: 'wide' },
      { key: 'Ruled-out', value: 'no pipe' },
    ]);
    expect(violations.map((violation) => violation.rule)).toEqual([
      'unknown-key',
      'enum',
      'format',
    ]);
  });

  it('never emits a rule outside the five in SPEC §6', () => {
    const allowed = new Set(['unknown-key', 'enum', 'format', 'cardinality', 'dangling-ref']);
    const violations = [
      ...invalidFixtures.flatMap((fixture) => validateRecord(parseCommitMessage(fixture.message))),
      ...validateRecord([
        { key: 'Nope', value: 'x' },
        { key: 'Undo', value: 'clean' },
        { key: 'Undo', value: 'easy' },
      ]),
    ];
    expect(violations.length).toBeGreaterThan(0);
    for (const violation of violations) expect(allowed.has(violation.rule)).toBe(true);
  });

  it('does not leak AJV wording into a violation', () => {
    const violations = validateRecord([{ key: 'Blast', value: 'wide' }]);
    const rendered = JSON.stringify(violations);
    expect(rendered).not.toMatch(/must be equal to one of|instancePath|schemaPath|allowedValues/);
  });
  /**
   * The schema counts single-valued keys with `contains`/`maxContains`, and a
   * `contains` probe fails against every item that is not the key being
   * counted. Those per-item failures land on `/trailers/N/key`, the same path a
   * genuinely unknown key lands on. Reading the path alone reported that every
   * unrelated trailer was an undefined key — dogfooding hit this with a commit
   * carrying two `Provenance:` lines and was told `Verified:` does not exist.
   */
  describe('a cardinality violation does not invent unknown keys', () => {
    const twoProvenance = [
      { key: 'Verified', value: 'a' },
      { key: 'Provenance', value: 'authored' },
      { key: 'Verified', value: 'b' },
      { key: 'Provenance', value: 'authored' },
    ];

    it('reports the duplicate and nothing else', () => {
      const violations = validateRecord(twoProvenance);
      expect(violations.map((v) => v.rule)).toEqual(['cardinality']);
      expect(violations[0]?.key).toBe('Provenance');
    });

    it('never calls a key from SPEC §3 unknown', () => {
      const violations = validateRecord(twoProvenance);
      expect(violations.filter((v) => v.rule === 'unknown-key')).toEqual([]);
    });

    it('still rejects a key the protocol does not define', () => {
      const violations = validateRecord([
        { key: 'Bogus', value: 'x' },
        { key: 'Provenance', value: 'authored' },
        { key: 'Provenance', value: 'authored' },
      ]);
      expect(violations.map((v) => v.rule).sort()).toEqual(['cardinality', 'unknown-key']);
      expect(violations.find((v) => v.rule === 'unknown-key')?.key).toBe('Bogus');
    });

    it('accepts an X- extension alongside a duplicate', () => {
      const violations = validateRecord([
        { key: 'X-Team', value: 'platform' },
        { key: 'Undo', value: 'easy' },
        { key: 'Undo', value: 'easy' },
      ]);
      expect(violations.map((v) => v.rule)).toEqual(['cardinality']);
    });

    it('reports every duplicated key once, not once per other trailer', () => {
      const violations = validateRecord([
        { key: 'Verified', value: 'a' },
        { key: 'Unverified', value: 'b' },
        { key: 'Evidence', value: 'docs/x.md' },
        { key: 'Blast', value: 'local' },
        { key: 'Blast', value: 'local' },
        { key: 'Undo', value: 'easy' },
        { key: 'Undo', value: 'easy' },
      ]);
      expect(violations.map((v) => v.key).sort()).toEqual(['Blast', 'Undo']);
    });
  });
});
