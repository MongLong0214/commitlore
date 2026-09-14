/**
 * #1015: `stale` names the declarations it could not fold.
 *
 * `foldLifecycle` reads one `Record-Id` per record, and a record here is a
 * *block*. A block carrying several therefore leaves the rest with no lifecycle
 * state: they cannot be reported superseded, expired or for review. On the
 * reporting repository that is **32 declarations** across seven blocks, and the
 * header said `of 32 record(s)` with nothing about them.
 *
 * The fold is not wrong. `Record-Id` is single-valued (`core/types.ts`), so a
 * block declaring several is malformed, `validate` reports it as `cardinality`,
 * and there is no defined answer for the fold to give. What was wrong is that
 * nothing said so — the same silence `unresolvedRefs` exists to break for a
 * window the scan could not cover.
 *
 * ## Where those blocks come from, which is not a writer bug here
 *
 * The affected commits have `committer: GitHub <noreply@github.com>`: the squash
 * button on github.com composes the message itself and drops the blank lines
 * that separated the blocks. Measured, `commitlore squash-preserve
 * --message-file` writes correctly separated blocks both for a plain range and
 * for one whose commits already carry several. The shape arrives from outside.
 *
 * ## Why this counts rather than splits
 *
 * Splitting a block at each `Record-Id` would invent a record boundary SPEC does
 * not define, and would make `stale` report records `validate` calls invalid —
 * two commands disagreeing about what exists, which is the disagreement #1012
 * just removed.
 */

import { describe, expect, it } from 'vitest';

import { buildReport, formatReport } from '../src/commands/stale.js';
import type { Trailer } from '../src/core/types.js';

const record = (sha: string, trailers: Trailer[], source: 'commit' | 'notes' = 'commit') => ({
  sha,
  committedAt: '2026-01-01T00:00:00Z',
  source,
  trailers,
});

const scanOf = (records: ReturnType<typeof record>[]) => ({
  records,
  commits: records.length,
  truncated: false,
  notes: 'present' as const,
});

const AT = new Date('2026-06-01T00:00:00Z');

describe('#1015 stale names declarations it could not fold', () => {
  it('reports the ids the fold did not take, and keeps the first', () => {
    const report = buildReport(
      scanOf([
        record('a'.repeat(40), [
          { key: 'Record-Id', value: 'r-keptaaaaaa1' },
          { key: 'Blast', value: 'local' },
          { key: 'Record-Id', value: 'r-unreadbbbb2' },
          { key: 'Record-Id', value: 'r-unreadcccc3' },
        ]),
      ]),
      AT,
    );

    expect(report.unfoldedDeclarations).toHaveLength(1);
    const row = report.unfoldedDeclarations[0];
    expect(row?.declared).toBe(3);
    // The first is the one `trailerValue` keeps, so it is not unread. If that
    // ever changes this has to change with it, or the report names the wrong
    // ids — worse than naming none.
    expect(row?.unread).toEqual(['r-unreadbbbb2', 'r-unreadcccc3']);
  }, 300_000);

  it('says nothing about a repository whose blocks declare one id each', () => {
    // The control, and the reason this is not a row that fires on every healthy
    // repository: a check the reader learns to skip is worth nothing.
    const report = buildReport(
      scanOf([
        record('b'.repeat(40), [
          { key: 'Record-Id', value: 'r-onlyoneaaa1' },
          { key: 'Blast', value: 'local' },
        ]),
        record('c'.repeat(40), [{ key: 'Record-Id', value: 'r-onlyonebbb2' }]),
        record('d'.repeat(40), []),
      ]),
      AT,
    );

    expect(report.unfoldedDeclarations).toEqual([]);
    expect(formatReport(report)).not.toContain('declarations not folded');
  }, 300_000);

  it('renders the count and points at validate', () => {
    const report = buildReport(
      scanOf([
        record('e'.repeat(40), [
          { key: 'Record-Id', value: 'r-firstoneaa1' },
          { key: 'Record-Id', value: 'r-secondonea2' },
        ]),
        record('f'.repeat(40), [
          { key: 'Record-Id', value: 'r-thirdoneaa3' },
          { key: 'Record-Id', value: 'r-fourthonea4' },
          { key: 'Record-Id', value: 'r-fifthoneaa5' },
        ]),
      ]),
      AT,
    );

    const text = formatReport(report);
    expect(text).toContain('declarations not folded');
    // 1 + 2 unread, counted rather than inferred from a difference of two
    // differently scoped numbers — which is how the first estimate of this was
    // wrong.
    expect(text).toContain('3 declaration(s) have no lifecycle');
    expect(text).toContain('commitlore validate');
    expect(text).toContain('r-secondonea2');
  }, 300_000);

  it('does not turn an unfolded declaration into a stale record', () => {
    // The fold's answer is unchanged: this reports what was skipped, it does not
    // start folding it. A report that quietly gained states would be the
    // boundary-inventing fix this deliberately refuses.
    const report = buildReport(
      scanOf([
        record('0'.repeat(40), [
          { key: 'Record-Id', value: 'r-onlyfoldaa1' },
          { key: 'Record-Id', value: 'r-neverfolda2' },
        ]),
      ]),
      AT,
    );

    expect(report.totalRecords).toBe(1);
    expect(report.records).toEqual([]);
  }, 300_000);

  it('marks a note-sourced block as a note', () => {
    // A note mirrors a commit's records, so the same ids can be reported from
    // both sources. Labelling the source is what lets a reader tell one repair
    // from two.
    const report = buildReport(
      scanOf([
        record(
          '1'.repeat(40),
          [
            { key: 'Record-Id', value: 'r-mirroredaa1' },
            { key: 'Record-Id', value: 'r-mirroredbb2' },
          ],
          'notes',
        ),
      ]),
      AT,
    );

    expect(report.unfoldedDeclarations[0]?.source).toBe('notes');
    expect(formatReport(report)).toContain('(note)');
  }, 300_000);
});

/**
 * #1015 second half: a note is the only well-formed copy, and was discarded.
 *
 * `collectRecords` drops a note block that duplicates what the commit already
 * declares — correct when the commit's blocks are well formed, because then the
 * commit yields one record per block and the note adds nothing.
 *
 * It was decided by asking whether every trailer in the note block also appears
 * anywhere in the commit's trailers, unioned across blocks. A commit whose
 * blocks were flattened into one carries every identity in that union and still
 * yields a **single** record, so every well-formed block of the note is a subset
 * of it and all of them were dropped. On the reporting repository that hid
 * fifteen records that existed correctly in the mirror and nowhere else:
 * `totalRecords` read 32 where it should read 47.
 *
 * The question is now whether the commit side yields a record for *that
 * identity*, not whether the note's text appears somewhere in the commit. A
 * block that declares no identity keeps the old test, which is the only question
 * available for it.
 */
describe('#1015 a note block survives a flattened commit block', () => {
  const flattened = {
    sha: '2'.repeat(40),
    committedAt: '2026-01-01T00:00:00Z',
    source: 'commit' as const,
    trailers: [
      { key: 'Limit', value: 'the first record' },
      { key: 'Record-Id', value: 'r-flatfirsta1' },
      { key: 'Limit', value: 'the second record' },
      { key: 'Record-Id', value: 'r-flatsecond2' },
    ],
  };

  it('reports only what no source folds', () => {
    // The note carries the second record as its own block, so it folds from
    // there and is not a loss. Judged by the old subset test it would be
    // dropped, and this would report it missing.
    const note = {
      sha: '2'.repeat(40),
      committedAt: '2026-01-01T00:00:00Z',
      source: 'notes' as const,
      trailers: [
        { key: 'Limit', value: 'the second record' },
        { key: 'Record-Id', value: 'r-flatsecond2' },
      ],
    };

    const report = buildReport(scanOf([flattened, note]), AT);
    expect(report.unfoldedDeclarations).toEqual([]);
    // Two records: the commit's first, and the note's second.
    expect(report.totalRecords).toBe(2);
  }, 300_000);

  it('still reports it when no note carries it', () => {
    // The control. Without it, "nothing unfolded" above could mean the check
    // had stopped reporting anything.
    const report = buildReport(scanOf([flattened]), AT);
    expect(report.unfoldedDeclarations).toHaveLength(1);
    expect(report.unfoldedDeclarations[0]?.unread).toEqual(['r-flatsecond2']);
    expect(report.totalRecords).toBe(1);
  }, 300_000);
});
