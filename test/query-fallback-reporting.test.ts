/**
 * When a query falls back to the scan mid-answer, it must say so — and must
 * report the scan's coverage, not the index's.
 *
 * `openSource` already handled the *first* bad read correctly: it switches to a
 * full scan for the rest of the query, because corruption is a reason to stop
 * trusting a derived cache rather than an outage (ADR-0003). What it did not do
 * was change what it said about itself. `fromIndex`, `corpusPasses` and
 * `unreadCommits` were fixed at the index's values, so after the switch all
 * three went on describing a source that had produced none of the rows.
 *
 * The dangerous one is `unreadCommits`. It read the index's queue, and
 * `runQuery` turns it into `coverage`. A fallback scan that truncates on its
 * budget while the index queue happens to be empty therefore answered
 * `coverage: "complete"` while missing records — the same shape as an index
 * that claims to be current and is not, arriving by a different route.
 *
 * The diagnostic was lost too, for a smaller reason with the same effect:
 * `runQuery` copied `source.diagnostics` before fetching anything, and the
 * fallback appends its explanation during the fetch. So the one line that said
 * "this answer did not come from the index" was written to an array nobody
 * read.
 *
 * Found in review of 1.3.6, not by a test, which is why there is one now.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { closeIndex, ensureIndex, openIndex } from '../src/core/index-db.js';
import { runQuery } from '../src/core/query.js';

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = [
  '-c',
  'user.name=CommitLore Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

const git = (dir: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });

/** A repository whose records the index can serve, so the fallback is a change. */
const fixtureRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-fallback-'));
  temporaries.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main']);
  for (let i = 0; i < 8; i += 1) {
    writeFileSync(join(dir, `f-${String(i)}.ts`), `revision ${String(i)}\n`);
    git(dir, ['add', '-A']);
    git(dir, [
      ...IDENTITY,
      'commit',
      '-q',
      '--no-verify',
      '-m',
      `change ${String(i)}\n\nA constraint the diff cannot show.\n\n` +
        `Record-Id: r-fallback${String(i)}0\nWarn: number ${String(i)}\nBlast: local\n`,
    ]);
  }
  return dir;
};

/**
 * Breaks the index's read path without breaking `openIndex`.
 *
 * The defect is specifically in what happens *after* opening succeeds — a
 * failure at open is caught by the outer handler and was never in question.
 *
 * A *column* is renamed rather than the table, and that choice is the test.
 * `healthProblem` checks that each table exists and that the schema version
 * matches; it does not inspect columns. So dropping the table is repaired by
 * `ensureIndex` before the query ever runs — the first version of this did
 * that and got an empty answer from a freshly rebuilt index, proving nothing.
 * Renaming a column every query orders by leaves a database that opens, passes
 * the health check, and raises on the first `queryTrailers`.
 */
const breakTheReadPath = (dir: string): void => {
  const handle = openIndex({ cwd: dir });
  try {
    handle.db.exec('ALTER TABLE trailers RENAME COLUMN committed_ts TO committed_ts_gone');
  } finally {
    closeIndex(handle);
  }
};

describe('a query that falls back mid-answer reports the source that answered', () => {
  it('says so in its diagnostics, and does not claim to be from the index', () => {
    const dir = fixtureRepo();
    closeIndex(ensureIndex({ cwd: dir }).handle);

    // The index answers this one.
    const indexed = runQuery({ cwd: dir });
    expect(indexed.records.length, 'the fixture must produce records').toBeGreaterThan(0);
    expect(indexed.corpusPasses).toBe(0);

    breakTheReadPath(dir);
    const fell = runQuery({ cwd: dir });

    // The rows are still right — that half always worked.
    expect(fell.records.map((record) => record.recordId).sort()).toEqual(
      indexed.records.map((record) => record.recordId).sort(),
    );

    // And now it admits where they came from. The diagnostic is appended
    // during the fetch, so a copy taken before it loses exactly this line.
    expect(
      fell.diagnostics.some((line) => line.includes('answering with a full scan')),
      `diagnostics were ${JSON.stringify(fell.diagnostics)}`,
    ).toBe(true);

    // A scan pass happened. Reported as 0 before this, because the field was a
    // literal belonging to the index.
    expect(fell.corpusPasses).toBeGreaterThan(0);
  }, 300_000);

  it('reports the fallback scan\'s coverage, not the index\'s empty queue', () => {
    const dir = fixtureRepo();
    closeIndex(ensureIndex({ cwd: dir }).handle);
    breakTheReadPath(dir);

    // A budget the scan cannot finish in, with an injected clock so the bound
    // is not a real-millisecond race. The index queue is empty — the rebuild
    // above completed — so `unreadCommits` read from the index is 0, and that
    // is what produced `coverage: "complete"` on a truncated answer.
    //
    // The clock rises on every reading rather than jumping after a fixed count.
    // A step-shaped one is consumed by whichever phase reads first, and the
    // scan then computes its deadline from the value after the step and never
    // exceeds it — the first version of this measured nothing for that reason.
    let readings = 0;
    const answer = runQuery({
      cwd: dir,
      scanBudgetMs: 1,
      scanNow: () => {
        readings += 1;
        return readings * 1_000_000;
      },
    });

    expect(readings, 'the injected clock must have been read').toBeGreaterThan(0);
    expect(
      { unread: answer.unreadCommits > 0, coverage: answer.coverage },
      'a truncated scan must not be reported as complete',
    ).toEqual({ unread: true, coverage: 'partial' });
  }, 300_000);
});
