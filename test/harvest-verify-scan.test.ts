/**
 * bug-issue-1168: the quote matcher no longer builds one array element per
 * character, so a session transcript large enough to matter can be verified at
 * all. The old indexes threw `RangeError: Invalid array length` at 112,813,858
 * elements — V8 refuses a `FixedArray` past 2^27 and `Array.push` asks for the
 * next capacity step — which the verifier caught, bound to an empty
 * verification, and reported to the caller as a missing receipt.
 *
 * What the rewrite must not do is move the matching boundary by a character.
 * The oracle below therefore restates the rule the module documents — "runs of
 * whitespace collapse to one space; leading and trailing whitespace goes;
 * nothing else" — and the cases compare the shipped verifier against it rather
 * than against itself. The cheapest way to break this module is to let a quote
 * match something it does not equal, which is precisely the fabrication it
 * exists to catch: a `.` matching any character would do it, so the escaping
 * cases are the ones to read first.
 *
 * The ceiling itself is not asserted here. Reaching it needs ~113 million
 * characters and about a gigabyte of heap, which is not a unit test; it was
 * reproduced by hand against the 118,728,820-byte transcript from the report,
 * before and after. What CI holds is the boundary and a multi-megabyte source
 * the old implementation would have indexed character by character.
 */

import { describe, expect, it } from 'vitest';

import { verifyDraft, type Sources } from '../src/core/harvest-verify.js';
import type { DraftEvidence, DraftRecord } from '../src/core/harvest.js';

const cite = (
  key: string,
  quote: string,
  source: DraftEvidence['source'] = 'transcript',
): DraftEvidence => ({ key, source, quote, locator: 'L1-L1' });

const limitCiting = (quote: string): DraftRecord => ({
  trailers: [{ key: 'Limit', value: 'the vendor caps us at three workers' }],
  evidence: [cite('Limit', quote)],
});

const ruledOutCiting = (quote: string): DraftRecord => ({
  trailers: [{ key: 'Ruled-out', value: 'a background worker | it needs a second deploy target' }],
  evidence: [cite('Ruled-out', quote)],
});

const sourcesOf = (transcript: string): Sources => ({ transcript, diff: '' });

const accepts = (transcript: string, quote: string): boolean =>
  verifyDraft([limitCiting(quote)], sourcesOf(transcript)).accepted.length === 1;

// ---------------------------------------------------------------------------
// The rule, as the module states it
// ---------------------------------------------------------------------------

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Whether the collapsed source contains the collapsed quote. */
const oracleContains = (raw: string, quote: string): boolean => {
  const needle = collapse(quote);
  return needle !== '' && collapse(raw).includes(needle);
};

describe('quote matching is unchanged by the memory rewrite (bug-issue-1168)', () => {
  const cases: [name: string, raw: string, quote: string][] = [
    ['exact', 'the vendor caps us at three workers', 'the vendor caps us at three workers'],
    ['newline inside the run', 'the vendor caps us\nat three workers', 'the vendor caps us at three workers'],
    ['tab and spaces inside the run', 'the vendor\t  caps us', 'the vendor caps us'],
    ['CRLF inside the run', 'the vendor\r\ncaps us', 'the vendor caps us'],
    ['leading and trailing whitespace', '\n\n  the vendor caps us  \n', 'the vendor caps us'],
    ['quote carrying its own whitespace run', 'the vendor caps us', 'the   vendor\n caps us'],
    ['a space inside a token is a different quote', 'thevendor caps', 'the vendor caps'],
    ['one letter of case is a different quote', 'The vendor caps us', 'the vendor caps us'],
    ['missing word', 'the vendor caps us at three workers', 'the vendor caps at three workers'],
    ['quote longer than the source', 'the vendor', 'the vendor caps us'],
    ['empty source', '', 'the vendor'],
    ['whitespace-only source', '   \n\t  ', 'the vendor'],
    ['empty quote', 'the vendor', ''],
    ['whitespace-only quote', 'the vendor', '   \n '],
    ['single character', 'a', 'a'],
    ['source is one long whitespace run around a word', '\n\n\t  cap  \t\n\n', 'cap'],
  ];

  for (const [name, raw, quote] of cases) {
    it(`agrees with the rule: ${name}`, () => {
      expect(accepts(raw, quote)).toBe(oracleContains(raw, quote));
    });
  }

  /**
   * The pattern the matcher builds from a quote has to treat every character as
   * a literal. An unescaped metacharacter would accept a sentence the source
   * never contained, which is the one failure this module exists to prevent —
   * so each case below is a near-miss that must be refused.
   */
  const metacharacters: [quote: string, nearMiss: string][] = [
    ['the cap is 5 MB.', 'the cap is 5 MBX'],
    ['cost*', 'costX'],
    ['retry+', 'retryX'],
    ['maybe?', 'maybeX'],
    ['^start', 'Xstart'],
    ['end$', 'endX'],
    ['(a)', 'XaX'],
    ['[x]', 'XxX'],
    ['{2}', 'X2X'],
    ['a|b', 'aXb'],
    ['back\\slash', 'backXslash'],
    ['dot.dot', 'dotXdot'],
  ];

  for (const [quote, nearMiss] of metacharacters) {
    it(`treats ${JSON.stringify(quote)} as literal text`, () => {
      // Present verbatim: accepted.
      expect(accepts(`prose ${quote} prose`, quote)).toBe(true);
      // One character different: refused, and the rule agrees.
      expect(accepts(`prose ${nearMiss} prose`, quote)).toBe(false);
      expect(oracleContains(`prose ${nearMiss} prose`, quote)).toBe(false);
    });
  }

  /** Deterministic so a failure names an input that can be re-run. */
  const random = (seed: number): (() => number) => {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  };

  it('agrees with the rule on 400 generated source/quote pairs', () => {
    const next = random(20261018);
    const alphabet = ['a', 'b', 'cap', 'vendor', ' ', '  ', '\n', '\t', '.', '*', '(', ')', '\\'];
    const disagreements: { raw: string; quote: string }[] = [];

    for (let round = 0; round < 400; round += 1) {
      let raw = '';
      for (let token = 0; token < 12; token += 1) {
        raw += alphabet[Math.floor(next() * alphabet.length)] ?? 'a';
      }
      // Half the quotes are drawn from the source and half are mutated, so both
      // answers are exercised rather than only the accepting one.
      const from = Math.floor(next() * raw.length);
      const slice = raw.slice(from, from + 1 + Math.floor(next() * 10));
      const quote = next() < 0.5 ? slice : `${slice}X`;
      if (accepts(raw, quote) !== oracleContains(raw, quote)) disagreements.push({ raw, quote });
    }

    expect(disagreements).toEqual([]);
  });
});

describe('rejection context still reads one line either side (bug-issue-1168)', () => {
  /**
   * `Ruled-out` is the only key whose verdict depends on *where* the quote
   * landed, so it is how the line arithmetic is observed from outside the
   * module.
   */
  const grounded = (transcript: string, quote: string): boolean =>
    verifyDraft([ruledOutCiting(quote)], sourcesOf(transcript)).accepted.length === 1;

  it('finds a marker on the line before, and on the line after', () => {
    const before = ['user: we decided against it.', 'assistant: a background worker.', 'user: ok.'];
    const after = ['user: ok.', 'assistant: a background worker.', 'user: we decided against it.'];
    expect(grounded(before.join('\n'), 'assistant: a background worker.')).toBe(true);
    expect(grounded(after.join('\n'), 'assistant: a background worker.')).toBe(true);
  });

  it('does not reach two lines', () => {
    const transcript = [
      'user: we decided against it.',
      'user: unrelated.',
      'assistant: a background worker.',
      'user: unrelated.',
    ].join('\n');
    expect(grounded(transcript, 'assistant: a background worker.')).toBe(false);
  });

  it('holds at the first line, with no line before it', () => {
    const transcript = ['assistant: a background worker.', 'user: we decided against it.'].join('\n');
    expect(grounded(transcript, 'assistant: a background worker.')).toBe(true);
  });

  it('holds at the last line, with and without a trailing newline', () => {
    const lines = ['user: we decided against it.', 'assistant: a background worker.'];
    expect(grounded(lines.join('\n'), 'assistant: a background worker.')).toBe(true);
    expect(grounded(`${lines.join('\n')}\n`, 'assistant: a background worker.')).toBe(true);
  });

  it('reads the whole of a quote that spans a newline', () => {
    // The quote collapses across the break, so the window has to cover both
    // lines the match sits on plus one either side.
    const transcript = [
      'user: nothing here.',
      'assistant: a background',
      'worker was proposed.',
      'user: we decided against it.',
      'user: nothing here either.',
    ].join('\n');
    expect(grounded(transcript, 'assistant: a background worker was proposed.')).toBe(true);
  });

  it('counts overlapping occurrences, as the old search did', () => {
    // The quote spans a line break, so it matches *every* adjacent pair of
    // lines, not every other pair. The old search advanced one character per
    // step (`indexOf(quote, at + 1)`); advancing by the length of the match
    // instead would skip half the pairs and reach line 36 within the cap, so
    // this case is what tells the two apart. The marker is deliberately out of
    // reach of the first thirty-two overlapping windows.
    const lines = Array.from({ length: 70 }, () => 'aa');
    lines[36] = 'aa we decided against it.';
    expect(grounded(lines.join('\n'), 'aa aa')).toBe(false);

    // Control: the same marker inside the first window is found, so the refusal
    // above is the cap and the step, not a quote that never matched.
    const near = Array.from({ length: 70 }, () => 'aa');
    near[2] = 'aa we decided against it.';
    expect(grounded(near.join('\n'), 'aa aa')).toBe(true);
  });

  it('stops at the thirty-second occurrence, as it did before', () => {
    // 40 lines carrying the quote; the only marker sits past the cap, so the
    // record must be refused — the cap is a documented bound, not a bug, and a
    // rewrite that silently lifted it would change which drafts pass.
    const quote = 'assistant: a background worker.';
    const lines = Array.from({ length: 40 }, () => quote);
    lines.push('user: we decided against it.');
    expect(grounded(lines.join('\n'), quote)).toBe(false);

    // Control: the same marker inside the cap is found.
    const near = [quote, 'user: we decided against it.', ...Array.from({ length: 40 }, () => quote)];
    expect(grounded(near.join('\n'), quote)).toBe(true);
  });
});

describe('a multi-megabyte source is verified without indexing it (bug-issue-1168)', () => {
  it('finds a quote at the end of an 8 MB transcript', () => {
    const filler = `${'the queue drains on shutdown and the vendor caps us at three workers. '.repeat(
      120_000,
    )}\n`;
    const quote = 'the retry ceiling stays where it is';
    const transcript = `${filler}assistant: ${quote}, so nothing changes.\n`;
    expect(transcript.length).toBeGreaterThan(8_000_000);

    const result = verifyDraft([limitCiting(quote)], sourcesOf(transcript));
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });
});
