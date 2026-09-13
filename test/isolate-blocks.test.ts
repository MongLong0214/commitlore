/**
 * `isolateBlocks` must answer exactly as one process per paragraph does.
 *
 * It probes many candidate paragraphs in one `git interpret-trailers`
 * invocation. git accepts several files per invocation and emits nothing
 * between them, so a marker is what attributes the output — and the first
 * design put that marker *inside* the paragraph, which was wrong twice. Both
 * ways are fixtures below, because a corpus that cannot fail is not a proof:
 *
 *   - git does not require every line of a block to be a trailer. A group
 *     holding a recognized trailer is accepted once a quarter of its lines are
 *     trailers, so one appended line can carry a paragraph over the threshold.
 *     `Record-Id:` and `Signed-off-by:` above seven prose lines parse to
 *     nothing; appending a marker — 2/9 to 3/10 — made git emit a record block
 *     that does not exist.
 *   - a scissors line makes git discard everything after it, an appended
 *     marker included, while still emitting the trailers above it. That
 *     paragraph's records then landed in the next paragraph's group: `alpha`
 *     attributed to the commit that wrote `beta`.
 *
 * The oracle is `git interpret-trailers` on one paragraph at a time — the
 * process this replaced — and never a table of expected values written by
 * hand. A table copied from the implementation agrees with its bugs.
 */

import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { isolateBlocks } from '../src/core/trailers.js';
import type { Trailer } from '../src/core/types.js';

/** What one process per paragraph answers. The thing the batch must equal. */
const probedAlone = (paragraph: string): Trailer[] =>
  execFileSync(
    'git',
    ['-c', 'trailer.separators=:', 'interpret-trailers', '--parse', '--no-divider'],
    { input: `x\n\n${paragraph}`, encoding: 'utf8', maxBuffer: 1 << 26 },
  )
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const at = line.indexOf(': ');
      return at === -1
        ? { key: line.replace(/:$/, ''), value: '' }
        : { key: line.slice(0, at), value: line.slice(at + 2) };
    });

const SCISSORS = '# ------------------------ >8 ------------------------';

/**
 * Shapes chosen to break the batch, not to be representative.
 *
 * The first two are the ones a review found in the design this replaced; the
 * rest sit around git's threshold or carry bytes that have broken framing
 * elsewhere in this codebase.
 */
const HAZARDS: readonly string[] = [
  'Record-Id: r-ratio00\nSigned-off-by: A <a@b>\nprose 1\nprose 2\nprose 3\nprose 4\nprose 5\nprose 6\nprose 7',
  `Limit: alpha\nRecord-Id: r-alpha00\n${SCISSORS}\nignored`,
  'Limit: beta\nRecord-Id: r-beta000',
  'Record-Id: r-q1\nprose\nprose\nprose',
  'Record-Id: r-q2\nSigned-off-by: A <a@b>\nprose\nprose\nprose\nprose\nprose\nprose',
  'Signed-off-by: A <a@b>\nprose about record-id\nprose\nprose',
  'Record-Id: r-q3\nWarn: a value that folds\n  onto a second line about record-id',
  'Record-Id: r-q4\r\nBlast: module',
  `Record-Id: r-q5\nWarn: ${'x'.repeat(4000)}`,
  '  Record-Id: r-q6',
  'Record-Id:',
  'record-id: r-q7',
  'Record-Id: r-q8\nRecord-Id: r-q9',
  'Record-Id: r-q10\nWarn: unicode — é ü 日本語 about record-id',
  'Record-Id: r-q11\nWarn: ends with a backslash \\',
  'X-Clprobe-0123456789abcdef: 0\nRecord-Id: r-q12',
];

/**
 * A hazard reaches the probe the way a real one does: as an earlier paragraph
 * of a message whose last paragraph is something else. Probing it directly
 * would test a path no caller takes.
 */
const asEarlierParagraph = (hazard: string): string =>
  `subject\n\n${hazard}\n\nRecord-Id: r-tail00\n`;

/**
 * The form the probe actually sees. `splitParagraphs` folds CRLF before any
 * paragraph reaches git, so a fixture written with CRLF is looked up — and
 * probed alone — under the same normalisation the real path applies, or the
 * test asks about a string no caller ever holds.
 */
const asProbed = (hazard: string): string => hazard.replace(/\r\n/g, '\n');

describe('isolateBlocks answers as one process per paragraph would', () => {
  it('agrees with the per-paragraph parse on every hazard shape', () => {
    const isolated = isolateBlocks(HAZARDS.map(asEarlierParagraph));

    // The premise. A batch that answered nothing would agree with everything
    // by falling back, and this test would pass having proved nothing.
    const answered = HAZARDS.filter((h) => isolated.get(asProbed(h)) !== undefined);
    expect(answered).toHaveLength(HAZARDS.length);

    for (const hazard of HAZARDS) {
      expect(isolated.get(asProbed(hazard)), hazard.slice(0, 60)).toEqual(probedAlone(asProbed(hazard)));
    }
  }, 120_000);

  it('invents no record for a paragraph git rejects', () => {
    // The 25% case, stated as the thing that must not happen rather than as an
    // equality: the batched answer for this paragraph is empty, full stop.
    const ratio = HAZARDS[0] ?? '';
    expect(probedAlone(asProbed(ratio))).toEqual([]);
    expect(isolateBlocks([asEarlierParagraph(ratio)]).get(asProbed(ratio))).toEqual([]);
  }, 120_000);

  it('keeps the records of one paragraph out of the answer for another', () => {
    // The scissors case, which only shows itself beside a neighbour: alpha's
    // records must be alpha's, and beta's answer must not contain them.
    const alpha = HAZARDS[1] ?? '';
    const beta = HAZARDS[2] ?? '';
    const isolated = isolateBlocks([alpha, beta].map(asEarlierParagraph));

    expect(isolated.get(asProbed(alpha))).toEqual(probedAlone(asProbed(alpha)));
    expect(isolated.get(asProbed(beta))).toEqual(probedAlone(asProbed(beta)));
    expect(JSON.stringify(isolated.get(asProbed(beta)))).not.toContain('alpha');
  }, 120_000);

  it('answers nothing rather than wrongly when it cannot attribute the output', () => {
    // Nothing here can produce a marker, so there is no batch to attribute and
    // the caller must be told so — `undefined`, which means "fall back", not
    // `[]`, which would mean "git rejected it".
    expect(isolateBlocks([]).get('anything')).toBeUndefined();
    expect(isolateBlocks(['subject\n\nbody with no mention\n\nBlast: local\n']).get('body with no mention')).toBeUndefined();
  }, 120_000);
});
