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

  it('publishes no computed break-even value', () => {
    expect(output()).toContain('No computed break-even value is published.');
    expect(output()).not.toMatch(/\b\d+(?:\.\d+)?%/);
  });
});
