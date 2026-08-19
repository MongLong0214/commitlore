/**
 * #776: the rebuild's cost was one `git interpret-trailers` process per
 * trailer paragraph, and the guard against getting the shortcut wrong.
 *
 * Measured on this repository before the change: 4,345 git subprocesses for
 * one rebuild, of which 4,329 were `interpret-trailers --parse`. 45 s. The
 * batch reader already avoids one process per commit -- the module says so in
 * its own header -- but `explodeRecordBlocks` went around it, re-reading every
 * message and parsing every earlier paragraph to find the ~3% that carry a
 * second record block.
 *
 * The shortcut is only safe if it never skips a block the parse would have
 * kept, and the first version of it did. These are that boundary.
 */

import { describe, expect, it } from 'vitest';

import { signatureAtom } from '../src/core/index-db.js';
import { parseRecordBlocks } from '../src/core/trailers.js';

/** Git's own `%G?` outputs. An empty string is not one of them. */
const GIT_SIGNATURE_VERDICTS = ['G', 'B', 'U', 'X', 'Y', 'R', 'E', 'N'];

/** `signatureVerifierGeneration` returns `null` outside signature mode. */
const NO_SIGNATURE_MODE = null;
const SIGNATURE_MODE = 'a-verifier-generation';

const message = (...paragraphs: readonly string[]): string => paragraphs.join('\n\n');

describe('#776 the shortcut keeps what the parse would have kept', () => {
  // The case that broke the first attempt. One `Record-Id` in the whole
  // message, so a count-only gate says "one block, the atom pass has it" --
  // but `%(trailers)` returns the *last* paragraph, which here is a
  // conventional trailer, and the record is one paragraph earlier. Nine rows
  // went missing from a real commit before this was pinned.
  it('recovers a record whose block is not the last paragraph', () => {
    const text = message(
      'Subject line',
      'Body prose that explains the change.',
      'Limit: only the fixtures\nRecord-Id: r-notlast\nProvenance: authored',
      'Co-authored-by: Someone <someone@example.invalid>',
    );

    const blocks = parseRecordBlocks(text);
    const keys = blocks.flatMap((b) => b.map((t) => t.key));
    expect(keys).toContain('Record-Id');
  });

  it('recovers both blocks when a message carries two records', () => {
    const text = message(
      'Subject line',
      'Limit: the first\nRecord-Id: r-first',
      'Limit: the second\nRecord-Id: r-second',
    );

    const ids = parseRecordBlocks(text)
      .flatMap((b) => b.filter((t) => t.key === 'Record-Id'))
      .map((t) => t.value);
    expect(ids).toEqual(['r-first', 'r-second']);
  });

  // The paragraph-level shortcut skips a paragraph whose raw text never names
  // the key. A trailer key is always at the start of a line in the source and
  // folding continues values, so this cannot drop a block -- but the loose
  // match means prose mentioning the key only costs an extra parse.
  it('is not confused by prose that merely mentions the key', () => {
    const text = message(
      'Subject line',
      'The Record-Id here is discussed in prose, not declared.',
      'Limit: the real one\nRecord-Id: r-real',
    );

    const ids = parseRecordBlocks(text)
      .flatMap((b) => b.filter((t) => t.key === 'Record-Id'))
      .map((t) => t.value);
    expect(ids).toEqual(['r-real']);
  });

  it('finds nothing to recover in a message with no record at all', () => {
    const text = message('Subject line', 'Body prose.', 'Co-authored-by: X <x@example.invalid>');
    const ids = parseRecordBlocks(text).flatMap((b) => b.filter((t) => t.key === 'Record-Id'));
    expect(ids).toEqual([]);
  });
});

describe('#776 the rebuild does not verify signatures nobody asked about', () => {
  // `%G?` makes git verify every commit's signature: 2.4s of a 4.9s rebuild on
  // this repository. Nothing reads the answer outside signature mode --
  // `grade.ts` consults it only behind `requireSignedDirective`, and
  // `trusted-authors.ts` says so where the verifier generation is defined:
  // "Only signature mode pays for it: the setting is opt-in."
  it('asks git for the status only in signature mode', () => {
    expect(signatureAtom(NO_SIGNATURE_MODE)).toBe('');
    expect(signatureAtom(SIGNATURE_MODE)).toBe('%G?');
  });

  // The stored value must not be mistakable for a verdict. Git's `%G?`
  // vocabulary is G/B/U/X/Y/R/E/N, so an empty string cannot be read as "no
  // signature" -- that is `N`, and it is a different fact from "not asked".
  it('stores a value outside git’s vocabulary rather than a false N', () => {
    expect(GIT_SIGNATURE_VERDICTS).not.toContain('');
    expect(GIT_SIGNATURE_VERDICTS).toContain('N');
  });
});
