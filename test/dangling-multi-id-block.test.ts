/**
 * #1012: a block declaring several ids declares all of them.
 *
 * `findDanglingRefs` built its set of declared ids with `trailerValue`, which
 * returns one value per key per record. A record here is a *block*, and a block
 * can carry more than one `Record-Id`: squash inheritance writes each preserved
 * record's trailers and git folds the lot into a single trailer block. One
 * commit in the reporting repository carried **sixteen** declarations in one
 * block, of which fifteen were invisible — and a `Follows:` pointing at one of
 * those, in the same commit and the same block, was reported as `dangling-ref`,
 * whose `want` is "an existing Record-Id in history".
 *
 * ## What made it certain
 *
 * The second commit in that report carried three ids and two `Follows:` lines.
 * The one pointing at the **first** id resolved; the one pointing at the second
 * did not. Same message, same block, same scan — the only thing separating them
 * was position, which is the signature of reading one value where there are
 * several.
 *
 * ## The diagnosis in the issue was a different one, and it was wrong
 *
 * It read the report's own layout — `Follows: <id>  want <text>` — as a single
 * trailer value, and concluded `stale` was re-parsing a fenced code block that
 * quoted an earlier run. Checked against the index, every stored `Follows` value
 * was a clean id, and git's trailer atom yielded nothing from the quoted block;
 * both suspected ids were declared and reachable, exactly as the issue said.
 * The symptom was real and the mechanism was not, so this test pins the
 * mechanism rather than the fenced-block shape.
 *
 * `declaredAnywhere` in `commands/stale.ts` — the fallback for a truncated
 * window — already collected every trailer. The complete-scan path is the one
 * that was wrong, which is why the bug survived: the repair for a partial scan
 * was correct and nobody asked the same question of the whole one.
 */

import { describe, expect, it } from 'vitest';

import { findDanglingRefs } from '../src/core/stale.js';
import type { Trailer } from '../src/core/types.js';

const record = (sha: string, trailers: Trailer[]) => ({
  sha,
  committedAt: '2026-01-01T00:00:00Z',
  source: 'commit' as const,
  trailers,
});

describe('#1012 every Record-Id in a block is a declaration', () => {
  it('resolves a reference to an id that is not the first in its block', () => {
    const one = record('a'.repeat(40), [
      { key: 'Record-Id', value: 'r-firstidaaaa' },
      { key: 'Blast', value: 'local' },
      { key: 'Record-Id', value: 'r-secondidbbb' },
      { key: 'Follows', value: 'r-secondidbbb' },
    ]);

    expect(findDanglingRefs([one])).toEqual([]);
  }, 300_000);

  it('resolves the first and the later ids alike', () => {
    // The asymmetry that identified the defect: position was the only thing
    // separating a reference that resolved from one that did not.
    const one = record('b'.repeat(40), [
      { key: 'Record-Id', value: 'r-aaaaaaaaaaa1' },
      { key: 'Record-Id', value: 'r-bbbbbbbbbbb2' },
      { key: 'Record-Id', value: 'r-ccccccccccc3' },
      { key: 'Follows', value: 'r-aaaaaaaaaaa1' },
      { key: 'Follows', value: 'r-bbbbbbbbbbb2' },
      { key: 'Follows', value: 'r-ccccccccccc3' },
    ]);

    expect(findDanglingRefs([one])).toEqual([]);
  }, 300_000);

  it('resolves a reference made from another commit', () => {
    // The declaration and the reference in one block is the reported shape, but
    // the fix is about the declared set and must hold across the stream too.
    const declares = record('c'.repeat(40), [
      { key: 'Record-Id', value: 'r-leadingid001' },
      { key: 'Record-Id', value: 'r-buriedid0002' },
    ]);
    const refers = record('d'.repeat(40), [
      { key: 'Record-Id', value: 'r-refererid003' },
      { key: 'Follows', value: 'r-buriedid0002' },
    ]);

    expect(findDanglingRefs([declares, refers])).toEqual([]);
  }, 300_000);

  it('still reports a reference to an id nothing declares', () => {
    // The control. Without it, "no violations" above could mean the check had
    // stopped reporting anything at all — which is the way a fix like this
    // fails, by widening the declared set until nothing can be missing.
    const one = record('e'.repeat(40), [
      { key: 'Record-Id', value: 'r-declared0001' },
      { key: 'Record-Id', value: 'r-declared0002' },
      { key: 'Follows', value: 'r-nobodyhas001' },
    ]);

    const violations = findDanglingRefs([one]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.got).toBe('r-nobodyhas001');
    expect(violations[0]?.rule).toBe('dangling-ref');
  }, 300_000);

  it('leaves a malformed reference to the format rule', () => {
    // Unchanged, and asserted because the issue proposed tightening here: a
    // value that is not a Record-Id is a `format` violation `validateRecord`
    // already reports, and reporting it twice under two rules makes the repair
    // loop chase one line with two fixes.
    const one = record('f'.repeat(40), [
      { key: 'Record-Id', value: 'r-declared0003' },
      { key: 'Follows', value: 'r-someid  and some prose after it' },
    ]);

    expect(findDanglingRefs([one])).toEqual([]);
  }, 300_000);
});
