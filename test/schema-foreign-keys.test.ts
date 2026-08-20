/**
 * `Co-Authored-By:` is the casing Claude Code writes, and it was refused as
 * `unknown-key` — so the host with the most complete integration here produced
 * commits this repository's own hook blocked.
 *
 * `types.ts` already documented that all three casings reach a commit message
 * for the identical trailer and matched them case-insensitively. `schema.ts`
 * held one spelling in a case-sensitive Set. The name was written in two places
 * and only one of them was the one that decided.
 */

import { describe, expect, it } from 'vitest';

import { validateRecord } from '../src/core/schema.ts';

const violations = (key: string): readonly { rule: string }[] =>
  validateRecord([
    { key: 'Limit', value: 'a limit' },
    { key, value: 'Someone <a@b.c>' },
  ] as never);

describe('trailers CommitLore does not own are matched case-insensitively', () => {
  it.each([
    'Co-authored-by',
    'Co-Authored-By',
    'Co-authored-By',
    'CO-AUTHORED-BY',
    'Signed-off-by',
    'SIGNED-OFF-BY',
  ])('%s is accepted', (key) => {
    expect(violations(key).map((v) => v.rule), `${key} was refused`).not.toContain('unknown-key');
  });

  it('a key that merely resembles the vocabulary is still refused', () => {
    // The exemption is for standardised trailers, not a general escape hatch.
    expect(violations('Constraint').map((v) => v.rule)).toContain('unknown-key');
  });
});
