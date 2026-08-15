/**
 * #631: an answer that could not read everything must say so in its own shape.
 *
 * The consumer routes stop scanning after `CONSUMER_SCAN_BUDGET_MS`, which is
 * deliberate — a 21k-commit repository costs a pause rather than four minutes.
 * The truncation is already announced in `diagnostics`, but the two fields a
 * client is told to check, `history` and `notes`, both report healthy, and
 * correctly so: the sources are fine, it is the index that is short.
 *
 * Measured through the built MCP server as a separate process, the CLI answered
 * with 9 records where `commitlore_query` answered with 2, and nothing in the
 * shorter answer distinguished it from a complete one. That is what this pins:
 * a client following the documented protocol exactly must not read a partial
 * answer as a whole one.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runQuery } from '../src/core/query.js';

import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): void => {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
};

const repoWithOneRecord = (): string => {
  const dir = createTestRepo({ path: mkdtempSync(join(tmpdir(), 'cl-partial-')) });
  scratch.push(dir);
  writeFileSync(join(dir, 'a.txt'), 'a\n', 'utf8');
  git(dir, ['add', 'a.txt']);
  git(dir, [
    'commit',
    '--quiet',
    '--no-verify',
    '-m',
    ['Seed', '', 'Limit: one writer', 'Blast: local', 'Undo: easy', 'Certainty: firm', 'Provenance: authored', 'Record-Id: r-part01'].join('\n'),
  ]);
  return dir;
};

describe('#631 an answer states whether it read everything', () => {
  it('reports complete coverage when nothing was left unread', () => {
    const answer = runQuery({ cwd: repoWithOneRecord(), kind: 'limits' });

    expect(answer.unreadCommits, 'a one-commit repository fits any budget').toBe(0);
    expect(answer.coverage, 'and an answer that read everything says so').toBe('complete');
  });

  // The field has to be on the answer itself. `diagnostics` already carries the
  // sentence, and carrying it there alone is what let a partial answer read as
  // a whole one.
  it('reports partial coverage whenever commits were left unread', () => {
    // Drive the real budget rather than hand-building a result: a rule stated
    // twice is a rule that can agree with itself while the product disagrees.
    const truncated = runQuery({ cwd: repoWithOneRecord(), kind: 'limits', scanBudgetMs: 0 });

    expect(truncated.unreadCommits, 'a zero budget reads nothing').toBeGreaterThan(0);
    expect(
      truncated.coverage,
      'unread commits mean the answer is missing records, whatever the sources say',
    ).toBe('partial');
  });

  it('does not confuse coverage with whether git could read the history', () => {
    const answer = runQuery({ cwd: repoWithOneRecord(), kind: 'limits' });

    // `history` answers a different question — whether git could read the
    // repository at all — and stays `ready` for a truncated answer, which is
    // exactly why it cannot carry this.
    expect(answer.history).toBe('ready');
    expect(answer.coverage).toBe('complete');
  });
});
