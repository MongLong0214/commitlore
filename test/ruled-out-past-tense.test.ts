/**
 * #585. A rejection stated in the past tense — what happened when the
 * alternative was tried — was read as a mention, because the detector only
 * knew refusal language ("does not work", "ruled out"). The capture quoted a
 * measured outcome and was discarded twice; the constraint survived as a Warn.
 *
 * These cases are the proof that recall moved and the evidence bar did not.
 * The accept rows fail if the outcome layer is reverted. The refuse rows pass
 * with or without it.
 */

import { describe, expect, it } from 'vitest';

import { verifyDraft, type Sources } from '../src/core/harvest-verify.js';
import type { DraftEvidence, DraftRecord } from '../src/core/harvest.js';

import {
  RULED_OUT_PAST_TENSE_CASES,
  type RuledOutPhraseCase,
} from './fixtures/harvest-verify/ruled-out-past-tense.js';

const cite = (quote: string): DraftEvidence => ({
  key: 'Ruled-out',
  source: 'transcript',
  quote,
  locator: 'L1-L1',
});

const draftFor = (fixture: RuledOutPhraseCase): DraftRecord => ({
  trailers: [{ key: 'Ruled-out', value: `${fixture.alternative} | ${fixture.reason}` }],
  evidence: [cite(fixture.quote)],
});

const sourcesFor = (transcript: string): Sources => ({ transcript, diff: '' });

describe('Ruled-out past-tense rejection (#585)', () => {
  it.each(RULED_OUT_PAST_TENSE_CASES.filter((fixture) => fixture.expect === 'accept'))(
    'accepts $name',
    (fixture) => {
      const result = verifyDraft([draftFor(fixture)], sourcesFor(fixture.transcript));
      expect(result.rejected, fixture.name).toEqual([]);
      expect(result.accepted, fixture.name).toHaveLength(1);
    },
  );

  it.each(RULED_OUT_PAST_TENSE_CASES.filter((fixture) => fixture.expect === 'refuse'))(
    'refuses $name',
    (fixture) => {
      const result = verifyDraft([draftFor(fixture)], sourcesFor(fixture.transcript));
      expect(result.accepted, fixture.name).toEqual([]);
      expect(result.rejected[0]?.reason, fixture.name).toBe('ruled-out-no-rejection');
    },
  );

  it('the observed sentence is in the fixture set, character for character', () => {
    const observed = RULED_OUT_PAST_TENSE_CASES.find((fixture) => fixture.name.startsWith('observed:'));
    expect(observed?.quote).toContain(
      're-synchronised the in-flight clients and pushed the 429 rate higher than it was without retries at all',
    );
  });
});
