/**
 * T-1501 (#719): the guard that stops the canonical rebuild from answering
 * itself, driven against real commits rather than reasoned about.
 *
 * The subject it exists for **does not occur in this repository's history**.
 * Every pull request currently carries its own `dist/` — that is #719's
 * complaint — so a commit touching only the bundle and its manifest is
 * something this feature will create and nothing has yet. A guard whose only
 * subject is its own future output has no observation behind it, and the first
 * time it is wrong is a loop on `main`.
 *
 * So the shape is built here. Each case makes a real repository, produces the
 * commit, and runs the same script the workflow runs — not a copy of its logic,
 * which is the defect #691 removed 845 lines to end.
 *
 * One case is a regression rather than a hypothesis. The first draft of this
 * guard was an inline `case` in the workflow reading `git show --name-only`,
 * and against `bd297e1` — a merge in this repository that resolved `dist/` —
 * it reported artifacts only and would have skipped. `git show` on a merge
 * prints the *combined* diff, which lists only paths differing from every
 * parent. Against its first parent that commit changed thirty files.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(REPO_ROOT, 'scripts', 'canonical-rebuild-guard.mjs');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', shell: false });

/** A repository with one ordinary source commit already on `main`. */
const repo = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-${label}-`));
  scratch.push(dir);
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'guard@example.invalid']);
  git(dir, ['config', 'user.name', 'guard']);
  write(dir, 'src/cli.ts', 'export const a = 1;\n');
  write(dir, 'dist/commitlore.mjs', 'bundle v1\n');
  write(dir, 'installer/canonical-artifact.json', '{"sha256":"v1"}\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'base']);
  return dir;
};

const write = (dir: string, path: string, body: string): void => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
};

const guard = (dir: string, ref = 'HEAD'): string =>
  execFileSync(process.execPath, [GUARD, ref, '--cwd', dir], {
    cwd: dir,
    encoding: 'utf8',
    shell: false,
  }).trim();

describe('#719 the rebuild guard, against commits it actually has to read', () => {
  it('skips a squash-merged rebuild — the shape this feature creates', () => {
    const dir = repo('guard-rebuild');
    // Exactly what `canonical-rebuild.yml` opens, merged the way this
    // repository merges: squashed onto main as a single-parent commit.
    git(dir, ['checkout', '--quiet', '-b', 'canonical-rebuild/abc1234']);
    write(dir, 'dist/commitlore.mjs', 'bundle v2\n');
    write(dir, 'installer/canonical-artifact.json', '{"sha256":"v2"}\n');
    git(dir, ['add', 'dist/', 'installer/canonical-artifact.json']);
    git(dir, ['commit', '--quiet', '-m', 'Rebuild the canonical bundle for abc1234']);
    git(dir, ['checkout', '--quiet', 'main']);
    git(dir, ['merge', '--squash', 'canonical-rebuild/abc1234']);
    git(dir, ['commit', '--quiet', '-m', 'Rebuild the canonical bundle for abc1234 (#999)']);

    expect(guard(dir)).toBe('skip=1');
  });

  it('does not skip a source change that carries its bundle — today\'s ordinary commit', () => {
    const dir = repo('guard-source');
    write(dir, 'src/cli.ts', 'export const a = 2;\n');
    write(dir, 'dist/commitlore.mjs', 'bundle v2\n');
    write(dir, 'installer/canonical-artifact.json', '{"sha256":"v2"}\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '--quiet', '-m', 'a source change with its rebuild']);

    expect(guard(dir)).toBe('skip=0');
  });

  it('does not skip a source-only change — the case the feature exists for', () => {
    const dir = repo('guard-srconly');
    write(dir, 'src/cli.ts', 'export const a = 3;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '--quiet', '-m', 'source only, bundle now behind']);

    expect(guard(dir)).toBe('skip=0');
  });

  it('does not skip a merge that only resolved the bundle — bd297e1\'s shape', () => {
    // The regression. `git show` without `--first-parent` prints a merge's
    // combined diff, which lists only paths differing from every parent — so a
    // merge whose conflict resolution touched `dist/` reads as artifacts-only.
    // Reading that as a rebuild is the direction that loops.
    const dir = repo('guard-merge');
    git(dir, ['checkout', '--quiet', '-b', 'feature']);
    write(dir, 'src/cli.ts', 'export const a = 4;\n');
    write(dir, 'dist/commitlore.mjs', 'bundle feature\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '--quiet', '-m', 'feature work']);

    git(dir, ['checkout', '--quiet', 'main']);
    write(dir, 'dist/commitlore.mjs', 'bundle main\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '--quiet', '-m', 'main moved']);

    // Merge with a conflict in dist/, resolved to one side.
    try {
      git(dir, ['merge', '--no-commit', '--no-ff', 'feature']);
    } catch {
      // expected: the bundle conflicts
    }
    write(dir, 'dist/commitlore.mjs', 'bundle merged\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '--quiet', '--no-edit', '-m', 'Merge feature']);

    expect(guard(dir)).toBe('skip=0');
  });

  it('does not skip a commit with no paths at all', () => {
    // No paths is no evidence, not proof of a rebuild. Reading it as a skip
    // would pass over a push that needs one, and the failure would be a `main`
    // whose bundle never catches up, reported as "nothing to do".
    const dir = repo('guard-empty');
    git(dir, ['commit', '--quiet', '--allow-empty', '-m', 'an empty commit']);

    expect(guard(dir)).toBe('skip=0');
  });
});
