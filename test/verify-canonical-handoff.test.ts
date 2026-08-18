/**
 * T-1502 (#719): the publishing job's check on what the rebuild handed it,
 * exercised against real repositories rather than by reading the workflow.
 *
 * The first version of this check lived inline in `canonical-merge.yml` and
 * required the branch tip to have two parents. A real tip has one — the rebuild
 * commits on top of the merge whenever `dist/` actually changes, which #762's
 * `6a88f2f4` did. The workflow-text assertions passed anyway, because a grep
 * over YAML cannot run it. Every case below is a mutation applied to a real
 * commit graph, and each one has to be refused for its own reason.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'verify-canonical-handoff.mjs');

const temps: string[] = [];
afterAll(() => {
  for (const path of temps) rmSync(path, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const run = (cwd: string, base: string, source: string, tip: string) => {
  try {
    const stdout = execFileSync(
      process.execPath,
      [SCRIPT, '--base', base, '--source', source, '--tip', tip, '--cwd', cwd],
      { encoding: 'utf8' },
    );
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
};

const write = (cwd: string, path: string, body: string): void => {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), body);
};

const commit = (cwd: string, message: string): string => {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '--quiet', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
};

/**
 * A repository shaped like a real run: `main` with a committed bundle, a
 * source-only branch off it, a `--no-ff` merge, and a rebuild commit on top.
 */
const scenario = (label: string) => {
  const cwd = mkdtempSync(join(tmpdir(), `commitlore-handoff-${label}-`));
  temps.push(cwd);
  git(cwd, ['init', '--quiet', '--initial-branch=main']);
  git(cwd, ['config', 'user.email', `${label}@example.invalid`]);
  git(cwd, ['config', 'user.name', label]);

  write(cwd, 'src/a.ts', 'export const a = 1;\n');
  write(cwd, 'dist/bundle.mjs', 'built from 1\n');
  write(cwd, 'installer/canonical-artifact.json', '{"source":1}\n');
  const base = commit(cwd, 'main');

  git(cwd, ['checkout', '--quiet', '-b', 'source']);
  write(cwd, 'src/a.ts', 'export const a = 2;\n');
  const source = commit(cwd, 'source only');

  git(cwd, ['checkout', '--quiet', 'main']);
  git(cwd, ['checkout', '--quiet', '-b', 'canonical']);
  git(cwd, ['merge', '--quiet', '--no-ff', '--no-edit', 'source']);
  const merge = git(cwd, ['rev-parse', 'HEAD']);

  write(cwd, 'dist/bundle.mjs', 'built from 2\n');
  write(cwd, 'installer/canonical-artifact.json', '{"source":2}\n');
  const tip = commit(cwd, 'Rebuild the canonical bundle');

  return { cwd, base, source, merge, tip };
};

describe('the publishing job refuses a handoff that is not that merge', () => {
  it('accepts a merge with a rebuild commit on top — the shape a real run produces', () => {
    // #762 landed exactly this: tip 6a88f2f4 with one parent, whose parent is
    // the two-parent merge acfed4a5. The inline check this replaced demanded
    // two parents on the tip and would have failed every run that rebuilt.
    const { cwd, base, source, tip } = scenario('accept-rebuild');
    const result = run(cwd, base, source, tip);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('canonical handoff verified');
  });

  it('accepts a bare merge when the merged source already produced the bundle', () => {
    const { cwd, base, source, merge } = scenario('accept-bare');
    const result = run(cwd, base, source, merge);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('already produced the committed bundle');
  });

  it('refuses a rebuild commit that also touched a workflow', () => {
    const { cwd, base, source, tip } = scenario('stray-workflow');
    // Amended into the rebuild commit, not stacked on it. A second commit on
    // top is a different violation, and it would mask this one.
    write(cwd, '.github/workflows/x.yml', 'name: x\n');
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '--quiet', '--amend', '--no-edit']);
    const tampered = git(cwd, ['rev-parse', 'HEAD']);
    expect(tampered).not.toBe(tip);
    const result = run(cwd, base, source, tampered);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('.github/workflows/x.yml');
  });

  it('refuses a rebuild commit that also touched source', () => {
    const { cwd, base, source } = scenario('stray-source');
    write(cwd, 'src/a.ts', 'export const a = 99;\n');
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '--quiet', '--amend', '--no-edit']);
    const tampered = git(cwd, ['rev-parse', 'HEAD']);
    const result = run(cwd, base, source, tampered);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('src/a.ts');
  });

  it('refuses a merge whose second parent is a different commit', () => {
    // The recorded source head is what a reviewer read. A bundle built from
    // another branch has the right shape and the wrong content.
    const { cwd, base, source } = scenario('wrong-parent');
    git(cwd, ['checkout', '--quiet', '-b', 'other', base]);
    write(cwd, 'src/a.ts', 'export const a = 3;\n');
    const other = commit(cwd, 'a different source');
    git(cwd, ['checkout', '--quiet', '-b', 'canonical-other', base]);
    git(cwd, ['merge', '--quiet', '--no-ff', '--no-edit', other]);
    const tip = git(cwd, ['rev-parse', 'HEAD']);
    const result = run(cwd, base, source, tip);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/the merge joins/);
  });

  it('refuses a merge that carries an edit a real merge would not produce', () => {
    // Right parents, wrong tree: an amended merge commit is the shape a
    // lifecycle script can build without touching either branch.
    const { cwd, base, source, merge } = scenario('smuggled-tree');
    git(cwd, ['checkout', '--quiet', merge]);
    write(cwd, 'src/smuggled.ts', 'export const smuggled = true;\n');
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '--quiet', '--amend', '--no-edit']);
    const tip = git(cwd, ['rev-parse', 'HEAD']);
    const result = run(cwd, base, source, tip);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("the merge's tree is");
  });

  it('refuses a source branch that carries the artifact itself', () => {
    const { cwd, base } = scenario('source-carries-dist');
    git(cwd, ['checkout', '--quiet', '-b', 'source-dist', base]);
    write(cwd, 'src/a.ts', 'export const a = 4;\n');
    write(cwd, 'dist/bundle.mjs', 'hand written\n');
    const source = commit(cwd, 'source plus dist');
    git(cwd, ['checkout', '--quiet', '-b', 'canonical-dist', base]);
    git(cwd, ['merge', '--quiet', '--no-ff', '--no-edit', source]);
    const tip = git(cwd, ['rev-parse', 'HEAD']);
    const result = run(cwd, base, source, tip);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('may not');
  });

  it('refuses a chain of two commits on the merge', () => {
    // One artifact commit is a rebuild. Two means the second had no rebuild
    // left to record, and is carrying something else.
    const { cwd, base, source } = scenario('two-on-top');
    write(cwd, 'dist/bundle.mjs', 'built again\n');
    const tip = commit(cwd, 'and again');
    const result = run(cwd, base, source, tip);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/not a merge commit/);
  });
});
