/**
 * SPEC §2 conformance: every fixture parses to its expected trailer list,
 * serializes to its expected canonical block byte for byte, and round-trips.
 */

import { describe, expect, it } from 'vitest';

import {
  labelRecordBlocks,
  parseCommitMessage,
  parseRecordBlocks,
  serializeTrailers,
  splitRuledOut,
} from '../src/core/trailers.js';
import { loadAllFixtures, loadCanonicalFixtures, loadFixtures } from './fixtures.js';

const allFixtures = loadAllFixtures();
const canonicalFixtures = loadCanonicalFixtures();
const boundaryFixtures = loadFixtures('boundary');
const boundaryByName = (name: string) => {
  const fixture = boundaryFixtures.find((candidate) => candidate.name === name);
  if (fixture === undefined) throw new Error(`missing boundary fixture: ${name}`);
  return fixture;
};

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

describe('parseRecordBlocks (SPEC §2.4, bug-issue-60)', () => {
  it.each(allFixtures)(
    '$id: a single-record message parses byte-identically to parseCommitMessage',
    (fixture) => {
      const blocks = parseRecordBlocks(fixture.message);
      const flat = parseCommitMessage(fixture.message);
      expect(blocks).toEqual(flat.length === 0 ? [] : [flat]);
    },
  );

  it('B2 still holds: an earlier Key: value paragraph with no Record-Id stays prose', () => {
    const fixture = boundaryByName('b2-two-trailer-paragraphs');
    const blocks = parseRecordBlocks(fixture.message);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.map((trailer) => trailer.key)).toEqual(['Limit', 'Certainty']);
  });

  it('parses a GitHub-style squash message (subject, then concatenated commit messages)', () => {
    // What GitHub's squash button writes when it pastes full commit messages
    // rather than only subjects: each original commit's own subject line sits
    // between the trailer blocks, so a contiguous walk from the tail would
    // stop at the first one.
    const message = [
      'Add the worker pool (#7)',
      '',
      '* add the worker pool',
      '',
      'Limit: the vendor caps us at 3 concurrent workers',
      'Certainty: firm',
      'Record-Id: r-ghtest1',
      '',
      '* retry on 429',
      '',
      'Warn: do not raise the retry ceiling without re-reading the vendor quota',
      'Record-Id: r-ghtest2',
      '',
    ].join('\n');

    const blocks = parseRecordBlocks(message);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.find((t) => t.key === 'Record-Id')?.value)).toEqual([
      'r-ghtest1',
      'r-ghtest2',
    ]);
    expect(blocks[0]?.map((t) => t.key)).toEqual(['Limit', 'Certainty', 'Record-Id']);
    // The message's own last paragraph is still what `parseCommitMessage`
    // recognizes today — nothing about that changed.
    expect(blocks[1]).toEqual(parseCommitMessage(message));
  });

  it('recognizes contiguous blocks with no prose between them (squash-preserve\'s own shape)', () => {
    const message = [
      'squash: bring in the branch',
      '',
      'Limit: the vendor caps us at 3 concurrent workers',
      'Record-Id: r-block1',
      '',
      'Warn: do not raise the retry ceiling',
      'Record-Id: r-block2',
      '',
    ].join('\n');

    const blocks = parseRecordBlocks(message);
    expect(blocks.map((block) => block.map((t) => `${t.key}=${t.value}`))).toEqual([
      ['Limit=the vendor caps us at 3 concurrent workers', 'Record-Id=r-block1'],
      ['Warn=do not raise the retry ceiling', 'Record-Id=r-block2'],
    ]);
  });

  it('does not recover an earlier block that has no Record-Id', () => {
    const message = [
      'subject',
      '',
      'Verified: drained under SIGTERM in a local run',
      '',
      'Warn: needs a second look',
      'Record-Id: r-onlyone',
      '',
    ].join('\n');

    const blocks = parseRecordBlocks(message);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.map((t) => t.key)).toEqual(['Warn', 'Record-Id']);
  });

  it('returns [] for a message with no trailer paragraph at all', () => {
    expect(parseRecordBlocks('just a subject\n\nand some body prose\n')).toEqual([]);
  });

  it('returns [] for an empty message', () => {
    expect(parseRecordBlocks('')).toEqual([]);
  });
});

describe('labelRecordBlocks (bug-issue-89)', () => {
  it.each(allFixtures)(
    '$id: a single-record message labels its one block own, with no collision',
    (fixture) => {
      const labeled = labelRecordBlocks(fixture.message);
      const flat = parseCommitMessage(fixture.message);
      if (flat.length === 0) {
        expect(labeled).toEqual([]);
      } else {
        expect(labeled).toEqual([{ own: true, identityCollision: false, trailers: flat }]);
      }
    },
  );

  it('labels every earlier block false and only the message\'s own last paragraph true', () => {
    const message = [
      'Add the worker pool (#7)',
      '',
      '* add the worker pool',
      '',
      'Limit: the vendor caps us at 3 concurrent workers',
      'Certainty: firm',
      'Record-Id: r-ghtest1',
      '',
      '* retry on 429',
      '',
      'Warn: do not raise the retry ceiling without re-reading the vendor quota',
      'Record-Id: r-ghtest2',
      '',
    ].join('\n');

    const labeled = labelRecordBlocks(message);
    expect(labeled.map((block) => block.own)).toEqual([false, true]);
    expect(labeled.map((block) => block.identityCollision)).toEqual([false, false]);
    expect(labeled.map((block) => block.trailers)).toEqual(parseRecordBlocks(message));
  });

  it('flags every block that shares a Record-Id with another block in the same message', () => {
    const message = [
      'squash: bring in the branch',
      '',
      'Limit: the vendor caps us at 3 concurrent workers',
      'Record-Id: r-dupdup',
      '',
      'Warn: do not raise the retry ceiling',
      'Record-Id: r-dupdup',
      '',
    ].join('\n');

    const labeled = labelRecordBlocks(message);
    expect(labeled).toHaveLength(2);
    expect(labeled.every((block) => block.identityCollision)).toBe(true);
    expect(labeled.map((block) => block.own)).toEqual([false, true]);
  });

  it('does not flag two distinct Record-Ids as colliding with each other', () => {
    const message = [
      'squash: bring in the branch',
      '',
      'Limit: the vendor caps us at 3 concurrent workers',
      'Record-Id: r-block1',
      '',
      'Warn: do not raise the retry ceiling',
      'Record-Id: r-block2',
      '',
    ].join('\n');

    const labeled = labelRecordBlocks(message);
    expect(labeled.map((block) => block.identityCollision)).toEqual([false, false]);
  });

  it('does not flag a collision when only one of three blocks repeats an id', () => {
    const message = [
      'squash: bring in the branch',
      '',
      'Limit: first decision',
      'Record-Id: r-alone',
      '',
      'Warn: second decision, later updated',
      'Record-Id: r-shared',
      '',
      'Undo: easy',
      'Record-Id: r-shared',
      '',
    ].join('\n');

    const labeled = labelRecordBlocks(message);
    expect(labeled.map((block) => block.identityCollision)).toEqual([false, true, true]);
  });

  it('returns [] for a message with no trailer paragraph at all', () => {
    expect(labelRecordBlocks('just a subject\n\nand some body prose\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// `Ruled-out: alternative | reason` (SPEC §3.1, issue #372)
// ---------------------------------------------------------------------------

/**
 * The separator decision, pinned against this repository's own records.
 *
 * `Ruled-out:` has one delimiter and no escape, so a value carrying a second
 * `|` is ambiguous: the machine has to pick a side and the author's intent is
 * not recoverable from the text. Which side to pick was settled by counting.
 * Of the 620 distinct `Ruled-out:` values in this history, three carry more
 * than one pipe, and two of those three carry it in the *reason* — a `||` in
 * shell prose, an `.mjs|.js` alternation. Splitting on the last pipe would
 * destroy both to rescue the third. The first pipe stays the separator, and
 * the ambiguity is reported instead of resolved by guesswork.
 */
describe('splitRuledOut (SPEC §3.1)', () => {
  it('separates on the first pipe and trims both halves', () => {
    expect(splitRuledOut('shared Redis cache | ops refuses another stateful dependency')).toEqual({
      alternative: 'shared Redis cache',
      reason: 'ops refuses another stateful dependency',
      malformed: false,
      ambiguous: false,
      unterminatedCodeSpan: false,
    });
  });

  it('reports a value with no separator as malformed, keeping the whole value', () => {
    expect(splitRuledOut('pointless without a pipe separator')).toEqual({
      alternative: 'pointless without a pipe separator',
      reason: '',
      malformed: true,
      ambiguous: false,
      unterminatedCodeSpan: false,
    });
  });

  it('keeps a reason that quotes an alternation whole (616005d)', () => {
    const parsed = splitRuledOut(
      'Keeping the extensionless payload for attack 2 | the stub execs a recorded ' +
        'value only inside the .mjs|.js arm',
    );
    expect(parsed.alternative).toBe('Keeping the extensionless payload for attack 2');
    expect(parsed.reason).toBe(
      'the stub execs a recorded value only inside the .mjs|.js arm',
    );
    expect(parsed.ambiguous).toBe(true);
    expect(parsed.unterminatedCodeSpan).toBe(false);
  });

  it('keeps a reason that quotes a shell or (aa68a9a)', () => {
    const parsed = splitRuledOut(
      'set +e at the top of each step | it also disables the abort for genuinely ' +
        'unexpected failures; the || form is scoped to the one command',
    );
    expect(parsed.alternative).toBe('set +e at the top of each step');
    expect(parsed.reason).toContain('the || form is scoped');
    expect(parsed.ambiguous).toBe(true);
  });

  it('reports an alternative that contains the pipe as ambiguous (7bf6ced)', () => {
    // This one the first-pipe rule gets wrong, and cannot know it does: the
    // author meant `irm | iex` as one alternative. Nothing in the value says
    // so, which is why it is reported rather than repaired.
    const parsed = splitRuledOut(
      'Passing the version through $args so irm | iex could take one | iex gives a ' +
        'piped script no arguments',
    );
    expect(parsed.alternative).toBe('Passing the version through $args so irm');
    expect(parsed.ambiguous).toBe(true);
    expect(parsed.unterminatedCodeSpan).toBe(false);
  });

  it('reports an alternative whose code span the separator cut open (issue #372)', () => {
    // An odd number of backticks before the first pipe is not a guess about
    // intent: a span opened in the alternative closes after the separator, so
    // the separator was taken out of quoted text. The alternative the guard
    // route matches on is a fragment ending mid-span.
    const parsed = splitRuledOut(
      'shelling out to `grep | head` for counts | it silently returns head exit status',
    );
    expect(parsed.alternative).toBe('shelling out to `grep');
    expect(parsed.ambiguous).toBe(true);
    expect(parsed.unterminatedCodeSpan).toBe(true);
  });

  it('accepts balanced code spans on either side of the separator', () => {
    const parsed = splitRuledOut('use `grep` or `rg` | `rg` is not installed everywhere');
    expect(parsed.alternative).toBe('use `grep` or `rg`');
    expect(parsed.unterminatedCodeSpan).toBe(false);
    expect(parsed.ambiguous).toBe(false);
  });

  it('does not treat a backslash as an escape', () => {
    // `\|` is not an escape and never was. The record that tries it splits at
    // that pipe and keeps the backslash, which is worth pinning so nobody
    // reads the parser as supporting one.
    const parsed = splitRuledOut('shelling out to grep \\| head for counts | it hides the status');
    expect(parsed.alternative).toBe('shelling out to grep \\');
    expect(parsed.ambiguous).toBe(true);
  });
});
