/**
 * #930: `coverage: "complete"` says the scan was not truncated. It reads as
 * "this answer is whole", and nothing in the envelope ever described the other
 * half of completeness -- *where the walk started*.
 *
 * The commit source only ever reads `rev-list HEAD` (index-db.ts says so, and
 * that scoping is deliberate: an unreachable note's `Supersedes:` must not
 * silence a live record). So an answer is complete with respect to a vantage
 * the caller never sees. A checkout behind its own already-fetched upstream
 * returns zero records with `coverage: "complete"`, `history: "ready"` and
 * `notes: "present"` -- byte-identical to a repository where nobody ever wrote
 * one, which `core/query.ts` calls the most dangerous sentence this tool can
 * produce and already built two typed fields to prevent.
 *
 * The discrimination is the whole design, so it is what these cases pin. Two
 * cheaper-looking signals were measured and rejected for firing on healthy
 * checkouts -- `rev-list --branches --remotes --not HEAD` counts 202 on this
 * repository at the tip of main -- and a signal that fires everywhere is the
 * one operators learn to skip.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runQuery } from '../src/core/query.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', ...args], {
    cwd,
    encoding: 'utf8',
  });

/**
 * A clone whose `main` tracks `origin/main`, with a record on each of two
 * commits. The later one is the record a stale vantage cannot reach.
 */
const cloneWithTwoRecords = (label: string): { work: string; base: string; tip: string } => {
  const root = mkdtempSync(join(tmpdir(), `commitlore-930-${label}-`));
  scratch.push(root);
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  // `createTestRepo` rather than a raw `git init`/`clone`: it pins
  // `--initial-branch=main`, and the first version of this fixture inherited the
  // runner's `init.defaultBranch` instead. Every case passed locally and all
  // four failed in CI with `fatal: branch 'main' does not exist`.
  createTestRepo({ path: remote, bare: true });
  createTestRepo({ path: work, source: remote });

  mkdirSync(join(work, 'src'), { recursive: true });
  writeFileSync(join(work, 'src/a.ts'), 'export const v = 1;\n');
  git(work, 'add', 'src/a.ts');
  git(work, 'commit', '--quiet', '-m', 'seed\n\nLimit: the seed record\nRecord-Id: r-vseed930');
  git(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
  const base = git(work, 'rev-parse', 'HEAD').trim();

  writeFileSync(join(work, 'src/a.ts'), 'export const v = 2;\n');
  git(work, 'add', 'src/a.ts');
  git(work, 'commit', '--quiet', '-m', 'later\n\nLimit: THE LATER RECORD\nRecord-Id: r-vlater930');
  git(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
  const tip = git(work, 'rev-parse', 'HEAD').trim();

  git(work, 'branch', '--quiet', '--set-upstream-to=origin/main', 'main');
  return { work, base, tip };
};

const ask = (cwd: string) => runQuery({ cwd, path: 'src/a.ts' });

describe('#930 the answer states the vantage it was read from', () => {
  it('is silent at the tip: nothing is behind, so nothing is claimed', () => {
    const { work } = cloneWithTwoRecords('tip');

    const result = ask(work);

    expect(result.records).toHaveLength(2);
    expect(result.vantage.behind).toBe(0);
    expect(result.vantage.ref).toBe('main');
    expect(result.vantage.upstream).toBe('origin/main');
    // The caveat must not fire here, or it fires on every healthy repository.
    expect(result.diagnostics.join(' ')).not.toContain('behind');
  });

  /*
   * The case the issue was filed for. Every other availability field reads
   * healthy while a record that exists in this very object store is missing.
   */
  it('reports behind when the checkout is behind its own fetched upstream', () => {
    const { work, base } = cloneWithTwoRecords('behind');
    git(work, 'reset', '--quiet', '--hard', base);

    const result = ask(work);

    expect(result.records).toHaveLength(1);
    // The fields that used to be the whole story, all still green.
    expect(result.coverage).toBe('complete');
    expect(result.history).toBe('ready');
    expect(result.unreadCommits).toBe(0);
    // The one that is not.
    expect(result.vantage.behind).toBe(1);
    expect(result.vantage.upstream).toBe('origin/main');
    expect(result.diagnostics.join(' ')).toContain('behind');
    // A caller reading only prose must still be told the empty-answer reading
    // is unsafe, which is why this is a diagnostic and not only a field.
    expect(result.diagnostics.join(' ')).toContain('not');
  });

  /*
   * A review worktree, which `git worktree add <path> <ref>` produces. The
   * narrower scope is the point of being there, so the vantage is stated and
   * not complained about -- a warning here would fire on every blind review.
   */
  it('states a detached head without warning about it', () => {
    const { work, base } = cloneWithTwoRecords('detached');
    git(work, 'checkout', '--quiet', '--detach', base);

    const result = ask(work);

    expect(result.records).toHaveLength(1);
    expect(result.vantage.ref).toBeNull();
    expect(result.vantage.head).toBe(base);
    // No upstream to be behind: unknown, and unknown is not zero.
    expect(result.vantage.upstream).toBeNull();
    expect(result.vantage.behind).toBeNull();
    expect(result.diagnostics.join(' ')).not.toContain('behind');
  });

  /*
   * An unmerged local branch holds records HEAD cannot reach, and that is
   * ordinary. `main` is not missing anything its own line ever had, so the
   * answer must stay silent -- this is the case that kills a "does any
   * unreachable commit exist" signal.
   */
  it('stays silent when another local branch is ahead but HEAD is current', () => {
    const { work, base, tip } = cloneWithTwoRecords('branch');
    git(work, 'reset', '--quiet', '--hard', base);
    git(work, 'push', '--quiet', '--force', 'origin', 'HEAD:refs/heads/main');
    git(work, 'fetch', '--quiet', 'origin');
    git(work, 'branch', '--quiet', '--force', 'feature', tip);

    const result = ask(work);

    expect(result.records).toHaveLength(1);
    expect(result.vantage.behind).toBe(0);
    expect(result.diagnostics.join(' ')).not.toContain('behind');
  });

  it('reports no upstream as unknown rather than as zero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'commitlore-930-solo-'));
    scratch.push(dir);
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/a.ts'), 'export const v = 1;\n');
    git(dir, 'add', 'src/a.ts');
    git(dir, 'commit', '--quiet', '-m', 'seed\n\nLimit: alone\nRecord-Id: r-vsolo930');

    const result = ask(dir);

    expect(result.records).toHaveLength(1);
    expect(result.vantage.upstream).toBeNull();
    // Zero here would be this defect rebuilt: an unknown presented as all-clear.
    expect(result.vantage.behind).toBeNull();
    expect(result.vantage.ref).toBe(git(dir, 'symbolic-ref', '--short', 'HEAD').trim());
  });
});
