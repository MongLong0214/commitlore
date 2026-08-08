import { describe, expect, it } from 'vitest';

import { renderEconomicCase } from '../bench/deterministic/economics.ts';

const output = (): string => renderEconomicCase().join('\n');

describe('economic case renderer', () => {
  it('states the measured capture, hook, and query costs', () => {
    expect(output()).toContain('6,110 bytes / 1,524 tokens / 105.18 ms p50');
    expect(output()).toContain('`harvest-verify` is **132.05 ms p50**');
    expect(output()).toContain('`commit-msg` hook adds **228.48 ms p50**');
    expect(output()).toContain('indexed `context` at 100,000 commits is **496.15 ms p50**');
  });

  it('states that the benefit term is unmeasured', () => {
    expect(output()).toContain('benefit term is unmeasured');
    expect(output()).toContain('has not observed a re-proposal being prevented');
  });

  it('publishes no computed break-even value for its own threshold', () => {
    expect(output()).toContain('No computed break-even value is published for this threshold.');
    expect(output()).not.toMatch(/\b\d+(?:\.\d+)?%/);
  });

  /**
   * Section 11 now carries a break-even and this one still says it publishes
   * none. Both are true only while the difference between their denominators is
   * on the page; a reader who meets the two sentences without it reads a
   * contradiction.
   */
  it('names the ledger break-even as a different figure rather than leaving a contradiction', () => {
    expect(output()).toContain('Section 11 does publish a break-even, and it is not this one');
    expect(output()).toContain('not the value of a prevented re-proposal');
  });
});
