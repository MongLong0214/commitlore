/**
 * #307: `context <path>` answered `records: 0` identically for "this path has
 * recorded nothing" and "this path has never existed". For an agent-facing tool
 * the empty answer reads as *nothing was recorded here, proceed*, which is the
 * wrong conclusion when the real cause is a typo or a since-renamed path.
 *
 * The reporter queried a file they believed existed, got zero, and nearly wrote
 * that zero down as an observation about the corpus -- the containing directory
 * had 15 records. `--no-index` agreed, which made the wrong reading more
 * confident rather than less.
 *
 * Working-tree existence is deliberately not the test: a deleted file has
 * legitimate history and legitimate records. The test is whether the walked
 * history mentions the path at all.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runQuery } from '../src/core/query.js';

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

/** A repository where `src/kept.ts` has a record and `src/gone.ts` was deleted. */
const repo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-307-'));
  scratch.push(dir);
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', ...args], { cwd: dir });
  };
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/kept.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src/gone.ts'), 'export const b = 2;\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'seed\n\nLimit: the upstream API is unversioned\nRecord-Id: r-seed307a');
  execFileSync('git', ['rm', '--quiet', 'src/gone.ts'], { cwd: dir });
  git('commit', '--quiet', '-m', 'remove gone\n\nWarn: nothing here reads gone.ts any more\nRecord-Id: r-gone307b');
  return dir;
};

const diagnosticsFor = (cwd: string, path: string, noIndex = true): string[] =>
  runQuery({ cwd, paths: [path], noIndex, explainEmptyResult: true }).diagnostics;

describe('#307 an empty answer says whether the path was ever there', () => {
  it('names a path the walked history never mentions', () => {
    const cwd = repo();
    const diagnostics = diagnosticsFor(cwd, 'totally/made/up.txt');
    expect(diagnostics.join('\n')).toMatch(/never|not.*history|no.*history/i);
    expect(diagnostics.join('\n')).toContain('totally/made/up.txt');
  });

  it('stays silent for a path that exists and simply recorded nothing', () => {
    const cwd = repo();
    writeFileSync(join(cwd, 'src/quiet.ts'), 'export const c = 3;\n');
    execFileSync('git', ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', 'add', 'src/quiet.ts'], { cwd });
    execFileSync(
      'git',
      ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', 'commit', '--quiet', '-m', 'add quiet, no record'],
      { cwd },
    );
    const result = runQuery({ cwd, paths: ['src/quiet.ts'], noIndex: true, explainEmptyResult: true });
    expect(result.records).toHaveLength(0);
    expect(result.diagnostics.join('\n')).not.toMatch(/never|not in .*history/i);
  });

  it('stays silent for a deleted file, which has legitimate history', () => {
    const cwd = repo();
    const result = runQuery({ cwd, paths: ['src/gone.ts'], noIndex: true, explainEmptyResult: true });
    expect(result.diagnostics.join('\n')).not.toMatch(/never|not in .*history/i);
  });

  it('does not fire when the path has records', () => {
    const cwd = repo();
    const result = runQuery({ cwd, paths: ['src/kept.ts'], noIndex: true, explainEmptyResult: true });
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.diagnostics.join('\n')).not.toMatch(/never|not in .*history/i);
  });

  it('points at the nearest ancestor that does carry history', () => {
    const cwd = repo();
    const diagnostics = diagnosticsFor(cwd, 'src/never-existed.ts');
    expect(diagnostics.join('\n')).toContain('src');
  });
  it('is off unless asked for, because the hook path must stay silent', () => {
    // A file being created for the first time has no history. On the PreToolUse
    // path that is the normal case, not a finding, and the hook's contract is
    // silence on both streams when there is nothing to say.
    const cwd = repo();
    const result = runQuery({ cwd, paths: ['totally/made/up.txt'], noIndex: true });
    expect(result.diagnostics).toEqual([]);
  });
});
