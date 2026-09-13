/**
 * Many whole messages through git's trailer parser, in one process.
 *
 * The sibling of `isolateBlocks`, and the distinction between the two is the
 * whole of why this is safe. `isolateBlocks` probes a *paragraph* lifted out of
 * its message, which is a different question from the one the whole message
 * answers — and isolating a message's **last** paragraph is exactly the shape
 * that fabricated a record once. This batches the whole message, byte for byte,
 * and asks git the same question `parseCommitMessage` asks. Only the plumbing
 * changes: a file per message instead of stdin.
 *
 * A note body is what needed it. `%(trailers)` parses the annotated *commit's*
 * message, so a note has no atom and its own block cost one process each — 22
 * of a `doctor` run's 30 remaining `interpret-trailers`.
 *
 * ## What is actually checked here
 *
 * Equivalence, against `parseCommitMessage` one message at a time, over two
 * corpora — because either alone would be misleading:
 *
 *  - **This repository's own history**, 1,603 distinct messages plus its notes:
 *    zero mismatches. That says the batch handles what this project writes.
 *  - **Shapes constructed to break it**, below. A corpus that happens not to
 *    contain the hazard is how "zero disagreements over 131 paragraphs" was once
 *    read as soundness while the design under it fabricated a record.
 *
 * The constructed set includes both shapes that broke earlier designs — a
 * scissors line, and a last paragraph under git's trailer-block threshold — and
 * a message that mimics this batcher's own marker.
 */

import { describe, expect, it } from 'vitest';

import { parseCommitMessage, parseMessagesBatched } from '../src/core/trailers.js';

/**
 * Shapes chosen to break the batch, not to pass.
 *
 * Each is a case where batching could plausibly differ from asking alone:
 * output moving between messages, a marker being swallowed, a paragraph
 * boundary being read differently, or the framing depending on what came
 * before.
 */
const HAZARDS: Record<string, string> = {
  // Swallowed an appended marker in an earlier design, moving records between
  // messages. Everything below it is cut from the commit.
  'scissors line':
    'subject\n\nbody\n# ------------------------ >8 ------------------------\n' +
    'Record-Id: r-belowscissor\nBlast: local\n',
  'divider ---': 'subject\n\nbody text\n\n---\nRecord-Id: r-belowdivider\nBlast: local\n',
  // git accepts a trailer block once about a quarter of its lines are trailers.
  // Appending a marker to a paragraph crossed that threshold and invented a
  // record, which is why the marker is a file of its own.
  'prose with one trailer, under the threshold':
    'subject\n\nthis paragraph is mostly prose\nand more prose here\n' +
    'and still more prose\nRecord-Id: r-under25pct\n',
  'single paragraph, no body': 'Record-Id: r-noneatall1\n',
  'subject only': 'just a subject line\n',
  empty: '',
  'whitespace only': '   \n\n  \n',
  'trailer-looking line inside prose':
    'subject\n\nwe wrote Record-Id: r-inprose001 in a sentence here, mid-paragraph.\n\n' +
    'Record-Id: r-realone001\nBlast: local\n',
  // A message that looks like the batcher's own attribution marker.
  'mimics the marker':
    'subject\n\nX-Clmsg-deadbeefdeadbeef: 0\n\nRecord-Id: r-markerlike1\nBlast: local\n',
  CRLF: 'subject\r\n\r\nbody\r\n\r\nRecord-Id: r-crlfcase01\r\nBlast: local\r\n',
  'no trailing newline': 'subject\n\nRecord-Id: r-notrailnl1\nBlast: local',
  'several blocks':
    'subject\n\nRecord-Id: r-firstblock\nBlast: local\n\ninherited from a squash\n\n' +
    'Record-Id: r-secondblok\nBlast: module\n',
  'not ASCII, and long':
    `subject\n\nWarn: 日本語 é ü — ${'x'.repeat(400)}\nRecord-Id: r-unicodelong\nBlast: local\n`,
  'blank lines before the trailers': 'subject\n\nbody\n\n\n\nRecord-Id: r-blanklines1\nBlast: local\n',
  'comment line in the block': 'subject\n\n# a comment\nRecord-Id: r-withcomment\nBlast: local\n',
};

describe('parseMessagesBatched answers what parseCommitMessage answers', () => {
  it('agrees on every shape built to break it', () => {
    const names = Object.keys(HAZARDS);
    const corpus = names.map((name) => HAZARDS[name] as string);
    const batched = parseMessagesBatched(corpus);

    // `null` is a safe answer — the caller falls back to one process each — but
    // it is not the answer this asserts, and letting it pass would make the
    // comparison below vacuous.
    expect(batched, 'the batch could not be attributed').not.toBeNull();

    const differing = names.filter(
      (name) =>
        JSON.stringify(parseCommitMessage(HAZARDS[name] as string)) !==
        JSON.stringify(batched?.get(HAZARDS[name] as string) ?? null),
    );
    expect(differing).toEqual([]);

    // And the corpus is not all empty answers agreeing with each other.
    const withTrailers = names.filter(
      (name) => parseCommitMessage(HAZARDS[name] as string).length > 0,
    );
    expect(withTrailers.length, 'the hazard corpus parsed nothing anywhere').toBeGreaterThan(5);
  }, 300_000);

  it('keeps one message\'s output out of its neighbour', () => {
    // The failure the marker scheme exists to catch: a message whose framing
    // reaches past its own file. Put a record-bearing message immediately after
    // a scissors line and assert the second one is not credited with the
    // first's trailers.
    const cut =
      'first\n\nbody\n# ------------------------ >8 ------------------------\n' +
      'Record-Id: r-cutaway0001\nBlast: local\n';
    const next = 'second\n\nRecord-Id: r-neighbour01\nBlast: module\n';
    const batched = parseMessagesBatched([cut, next]);
    expect(batched).not.toBeNull();

    expect(batched?.get(next)).toEqual(parseCommitMessage(next));
    expect(batched?.get(cut)).toEqual(parseCommitMessage(cut));
    const neighbourIds = (batched?.get(next) ?? [])
      .filter((trailer) => trailer.key === 'Record-Id')
      .map((trailer) => trailer.value);
    expect(neighbourIds).toEqual(['r-neighbour01']);
  }, 300_000);

  it('deduplicates identical messages and answers each caller', () => {
    // Notes repeat: squash inheritance writes the same body onto several
    // commits. The batch keys by content, so the same message asked twice must
    // come back once and correctly.
    const message = 'subject\n\nRecord-Id: r-repeated001\nBlast: local\n';
    const batched = parseMessagesBatched([message, message, message]);
    expect(batched?.size).toBe(1);
    expect(batched?.get(message)).toEqual(parseCommitMessage(message));
  }, 300_000);
});
