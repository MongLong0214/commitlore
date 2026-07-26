/**
 * SPEC §2 conformance: every fixture parses to its expected trailer list,
 * serializes to its expected canonical block byte for byte, and round-trips.
 */

import { describe, expect, it } from 'vitest';

import { parseCommitMessage, serializeTrailers } from '../src/core/trailers.js';
import { loadAllFixtures, loadCanonicalFixtures, loadFixtures } from './fixtures.js';

const allFixtures = loadAllFixtures();
const canonicalFixtures = loadCanonicalFixtures();

describe('parseCommitMessage', () => {
  it('discovers every fixture on disk', () => {
    expect(allFixtures.length).toBeGreaterThan(0);
    expect(canonicalFixtures.length).toBeGreaterThan(0);
  });

  it.each(allFixtures)('$id parses to the expected trailers, in order', (fixture) => {
    expect(parseCommitMessage(fixture.message)).toEqual(fixture.expected.trailers);
  });

  it('returns an empty list for an empty message (SPEC §2.1 B7)', () => {
    expect(parseCommitMessage('')).toEqual([]);
  });

  it('preserves a value containing a colon-space', () => {
    expect(parseCommitMessage('Subject\n\nLimit: ratio is 3: 1 at peak\n')).toEqual([
      { key: 'Limit', value: 'ratio is 3: 1 at peak' },
    ]);
  });

  it('keeps an empty trailer value as an empty string', () => {
    expect(parseCommitMessage('Subject\n\nLimit:\n')).toEqual([{ key: 'Limit', value: '' }]);
  });
});

describe('serializeTrailers', () => {
  it.each(canonicalFixtures)('$id serializes byte-for-byte to expected.canonical', (fixture) => {
    const parsed = parseCommitMessage(fixture.message);
    expect(serializeTrailers(parsed)).toBe(fixture.expected.canonical);
  });

  it('emits nothing for a record with no trailers', () => {
    expect(serializeTrailers([])).toBe('');
  });

  it('orders known keys by the SPEC §3 vocabulary, not by input order', () => {
    const block = serializeTrailers([
      { key: 'CommitLore-Version', value: '2.0.0' },
      { key: 'Blast', value: 'local' },
      { key: 'Limit', value: 'one' },
    ]);
    expect(block).toBe('Limit: one\nBlast: local\nCommitLore-Version: 2.0.0\n');
  });

  it('places extension and unrecognized keys after known keys, in input order', () => {
    const block = serializeTrailers([
      { key: 'X-Team', value: 'payments' },
      { key: 'Constraint', value: 'unrecognized' },
      { key: 'X-Priority', value: 'high' },
      { key: 'Undo', value: 'easy' },
    ]);
    expect(block).toBe(
      'Undo: easy\nX-Team: payments\nConstraint: unrecognized\nX-Priority: high\n',
    );
  });

  it('preserves the order of repeated occurrences of one key (SPEC §2.1 B5)', () => {
    const block = serializeTrailers([
      { key: 'Limit', value: 'first' },
      { key: 'Warn', value: 'between' },
      { key: 'Limit', value: 'second' },
    ]);
    expect(block).toBe('Limit: first\nLimit: second\nWarn: between\n');
  });

  it('folds a multi-line value onto two-space continuation lines (SPEC §2.3)', () => {
    expect(serializeTrailers([{ key: 'Warn', value: 'first line\nsecond line' }])).toBe(
      'Warn: first line\n  second line\n',
    );
  });
});

describe('round-trip identity (SPEC §2.3, §9.3)', () => {
  // A canonical block is only recognized as a trailer block when it is the last
  // paragraph of a message, so re-parsing needs a subject in front of it.
  const asMessage = (block: string): string => `Round-trip check\n\n${block}`;
  const multiset = (trailers: { key: string; value: string }[]): string[] =>
    trailers.map((trailer) => JSON.stringify(trailer)).sort();

  it.each(canonicalFixtures)('$id survives parse -> serialize -> parse', (fixture) => {
    const parsed = parseCommitMessage(fixture.message);
    const reparsed = parseCommitMessage(asMessage(serializeTrailers(parsed)));

    // Canonical serialization reorders into vocabulary order (SPEC §2.3), so
    // identity is over the multiset of trailers, exactly as the reference
    // implementation in spec/schema/roundtrip.mjs checks it.
    expect(multiset(reparsed)).toEqual(multiset(parsed));
  });

  it.each(canonicalFixtures)('$id reaches a canonical fixpoint', (fixture) => {
    const once = serializeTrailers(parseCommitMessage(fixture.message));
    const twice = serializeTrailers(parseCommitMessage(asMessage(once)));
    expect(twice).toBe(once);
  });
});

describe('boundary regressions (SPEC §2.1)', () => {
  const boundary = loadFixtures('boundary');
  const byName = (name: string) => {
    const fixture = boundary.find((candidate) => candidate.name === name);
    if (fixture === undefined) throw new Error(`missing boundary fixture: ${name}`);
    return fixture;
  };

  it('B3: a Key: value line inside prose yields zero trailers, not a partial match', () => {
    const fixture = byName('b3-prose-with-colon-line');
    expect(fixture.message).toContain('Note: this touches the shared client wrapper');
    expect(parseCommitMessage(fixture.message)).toEqual([]);
    expect(serializeTrailers(parseCommitMessage(fixture.message))).toBe('');
  });

  it('B2: only the last Key: value paragraph is a trailer block', () => {
    const fixture = byName('b2-two-trailer-paragraphs');
    expect(fixture.message).toContain('Context: previous limit caused throttling');
    const parsed = parseCommitMessage(fixture.message);
    expect(parsed.map((trailer) => trailer.key)).toEqual(['Limit', 'Certainty']);
  });

  it('B4: continuation lines fold into the preceding value, joined by one space', () => {
    const parsed = parseCommitMessage(byName('b4-warn-folding').message);
    expect(parsed[0]?.value).not.toContain('\n');
    expect(parsed[0]?.value).toContain('race condition in the token refresh path');
  });

  it('B7: a message with no trailer paragraph is not an error', () => {
    expect(parseCommitMessage(byName('b7-no-trailer-paragraph').message)).toEqual([]);
  });
});
