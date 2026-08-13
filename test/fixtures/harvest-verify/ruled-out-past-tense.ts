/**
 * Fixture set for #585. Each case is a realistic transcript phrasing, not an
 * invented marker string: the detector failed on a sentence someone actually
 * said, and these are the shapes of that sentence.
 *
 * `expect: 'accept'` cases are past-tense rejections that the marker table
 * alone misses. `expect: 'refuse'` cases name or propose the alternative
 * without turning it down — the evidence bar that must not move.
 */

export interface RuledOutPhraseCase {
  name: string;
  transcript: string;
  quote: string;
  alternative: string;
  reason: string;
  expect: 'accept' | 'refuse';
}

const OBSERVED_OUTCOME =
  're-synchronised the in-flight clients and pushed the 429 rate higher than it was without retries at all';

export const RULED_OUT_PAST_TENSE_CASES: readonly RuledOutPhraseCase[] = [
  {
    name: 'observed: tried it, 429 rate higher than without retries',
    transcript: [
      'assistant: Exponential backoff had been tried.',
      `assistant: It ${OBSERVED_OUTCOME}.`,
    ].join('\n'),
    quote: `It ${OBSERVED_OUTCOME}.`,
    alternative: 'exponential backoff',
    reason: 're-synced in-flight clients and raised the 429 rate',
    expect: 'accept',
  },
  {
    name: 'we tried X and it made Y worse',
    transcript: 'assistant: We tried exponential backoff and it made the 429 rate worse.',
    quote: 'We tried exponential backoff and it made the 429 rate worse.',
    alternative: 'exponential backoff',
    reason: 'made the 429 rate worse',
    expect: 'accept',
  },
  {
    name: 'made things worse',
    transcript: 'assistant: We tried a shared Redis cache and it made things worse.',
    quote: 'We tried a shared Redis cache and it made things worse.',
    alternative: 'shared Redis cache',
    reason: 'made things worse',
    expect: 'accept',
  },
  {
    name: 'X was rolled back because',
    transcript: 'assistant: Exponential backoff was rolled back because the 429s climbed.',
    quote: 'Exponential backoff was rolled back because the 429s climbed.',
    alternative: 'exponential backoff',
    reason: 'the 429s climbed',
    expect: 'accept',
  },
  {
    name: 'switching to X regressed',
    transcript: 'assistant: Switching to exponential backoff regressed the 429 rate.',
    quote: 'Switching to exponential backoff regressed the 429 rate.',
    alternative: 'exponential backoff',
    reason: 'regressed the 429 rate',
    expect: 'accept',
  },
  {
    name: 'X caused a negative outcome',
    transcript: 'assistant: Exponential backoff caused the 429 rate to spike.',
    quote: 'Exponential backoff caused the 429 rate to spike.',
    alternative: 'exponential backoff',
    reason: 'caused the 429 rate to spike',
    expect: 'accept',
  },
  {
    name: 'when we used X, higher than the baseline',
    transcript:
      'assistant: When we used exponential backoff, the 429 rate was higher than it was without retries.',
    quote: 'When we used exponential backoff, the 429 rate was higher than it was without retries.',
    alternative: 'exponential backoff',
    reason: '429 rate higher than without retries',
    expect: 'accept',
  },
  {
    name: 'when we used X, slower than the alternative',
    transcript:
      'assistant: When we used a background worker, the export was slower than the in-process page.',
    quote: 'When we used a background worker, the export was slower than the in-process page.',
    alternative: 'background worker',
    reason: 'slower than the in-process page',
    expect: 'accept',
  },
  {
    name: 'X did not work',
    transcript: 'assistant: Exponential backoff did not work.',
    quote: 'Exponential backoff did not work.',
    alternative: 'exponential backoff',
    reason: 'did not work',
    expect: 'accept',
  },
  {
    name: "X didn't help",
    transcript: "assistant: Exponential backoff didn't help.",
    quote: "Exponential backoff didn't help.",
    alternative: 'exponential backoff',
    reason: 'did not help',
    expect: 'accept',
  },
  {
    name: 'proposal: we should try X',
    transcript: 'assistant: We should try exponential backoff.',
    quote: 'We should try exponential backoff.',
    alternative: 'exponential backoff',
    reason: 'worth a look',
    expect: 'refuse',
  },
  {
    name: 'question: what about X?',
    transcript: 'assistant: What about exponential backoff?',
    quote: 'What about exponential backoff?',
    alternative: 'exponential backoff',
    reason: 'someone asked',
    expect: 'refuse',
  },
  {
    name: 'mention: X is an option',
    transcript: 'assistant: Exponential backoff is an option here.',
    quote: 'Exponential backoff is an option here.',
    alternative: 'exponential backoff',
    reason: 'it is an option',
    expect: 'refuse',
  },
  {
    name: 'proposal that names a threshold, not a regression',
    transcript:
      'assistant: The 429 rate is already higher than 10 per minute, so we should try exponential backoff.',
    quote:
      'The 429 rate is already higher than 10 per minute, so we should try exponential backoff.',
    alternative: 'exponential backoff',
    reason: 'rate is already high',
    expect: 'refuse',
  },
  {
    name: 'investigation: what caused the spike, X is an option',
    transcript: 'assistant: What caused the 429 spike? Exponential backoff is an option.',
    quote: 'What caused the 429 spike? Exponential backoff is an option.',
    alternative: 'exponential backoff',
    reason: 'someone asked what caused the spike',
    expect: 'refuse',
  },
];
