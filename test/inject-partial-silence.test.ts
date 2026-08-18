/**
 * An empty answer and an unfinished one are different, and were arriving the
 * same.
 *
 * `buildInjection` returned an empty payload whenever a path had no active
 * records — including when the scan had stopped at its budget before reaching
 * the commits that hold them. The caveat existed, on stderr, where a model
 * reading `additionalContext` never sees it. So a repository with nothing to
 * say and a repository that had not been read yet were indistinguishable to
 * the consumer, which is the one distinction this tool keeps everywhere else
 * (`coverage`, `history: unavailable`, `notes: unfetched`).
 *
 * Found in a freshly materialized worktree: 588 commits unread, zero bytes out,
 * and a benchmark arm that read it as a hook which had never fired.
 *
 * Driven by `scanBudgetMs`, so the partial state is constructed rather than
 * raced for. Reproducing it by clone-and-hope is the very non-determinism the
 * defect is about.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { buildInjection } from '../src/core/inject.js';

const temps: string[] = [];
afterAll(() => {
  for (const path of temps) rmSync(path, { recursive: true, force: true });
});

/** A repository whose records sit far enough back that a zero budget misses them. */
const repository = (commits = 40): string => {
  const dir = mkdtempSync(join(tmpdir(), 'inject-partial-'));
  temps.push(dir);
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '--quiet', '-b', 'main');
  git('config', 'user.email', 'partial@example.invalid');
  git('config', 'user.name', 'partial');
  mkdirSync(join(dir, 'src'), { recursive: true });
  for (let i = 0; i < commits; i += 1) {
    writeFileSync(join(dir, 'src', `f${String(i)}.ts`), `export const a${String(i)} = ${String(i)};\n`);
    git('add', '-A');
    git(
      'commit',
      '--quiet',
      '-m',
      `c${String(i)}\n\nLimit: something about f${String(i)}\nRecord-Id: r-partial${String(i)}\nProvenance: authored\nCommitLore-Version: 2.0.0`,
    );
  }
  return dir;
};

describe('an unfinished scan says so instead of answering with silence', () => {
  it('emits the incomplete notice when the budget left commits unread', () => {
    const injection = buildInjection({ cwd: repository(), path: 'src/f0.ts', at: new Date(), scanBudgetMs: 0 });

    expect(injection.included, 'no record should be claimed').toBe(0);
    expect(injection.text, 'silence is indistinguishable from a repository with no records').not.toBe('');
    expect(injection.text).toMatch(/incomplete: the scan stopped at its time budget/);
    expect(injection.text).toMatch(/commit\(s\) unread/);
  });

  it('stays silent when the history was read whole and holds nothing', () => {
    // The budget is the only thing that should make an empty path speak. A path
    // with no records in a fully-read repository must still cost nothing --
    // this hook fires on every Read.
    const dir = repository(3);
    const injection = buildInjection({ cwd: dir, path: 'src/absent.ts', at: new Date() });

    expect(injection.included).toBe(0);
    expect(injection.text, 'a complete scan with nothing to say must stay quiet').toBe('');
  });

  it('is unchanged when the scan finishes and there is something to say', () => {
    const injection = buildInjection({ cwd: repository(3), path: 'src/f0.ts', at: new Date() });

    expect(injection.included).toBeGreaterThan(0);
    expect(injection.text).not.toMatch(/incomplete: the scan stopped/);
  });
});
