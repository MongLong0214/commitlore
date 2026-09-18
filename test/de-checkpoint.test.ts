/**
 * The first-solve checkpoint round trip — #1034 §3-§4, revision
 * `native-efficacy-r6.1`.
 *
 * These are the regressions the issue names, against real temporary
 * repositories rather than fixtures, because every property here is about what
 * git actually does:
 *
 *   - "first solve edits a file AND creates a native note/commit; repair sees
 *      both with original staging semantics";
 *   - "another test restores syntax-broken code successfully before
 *      checking/repairing it";
 *   - "full binary/symlink/new-file snapshot";
 *   - "source/notes identity mismatch";
 *   - collection through an isolated index, so a snapshot cannot stage or
 *     unstage anything the actor did.
 *
 * The one that matters most is the first. "Do NOT reset to the old handoff
 * notes while preserving newer code" is the whole reason a checkpoint is more
 * than a patch: restore the code without the note and the repair reads a memory
 * that never existed at that point.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { checkpointStatusOf, restoreCheckpoint, takeCheckpoint } from '../bench/de/checkpoint.ts';
import { createTestRepo } from './git-fixtures.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const workspace = (name: string): { repo: string; out: string; restore: string } => {
  const root = mkdtempSync(join(tmpdir(), `de-checkpoint-${name}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const out = join(root, 'out');
  mkdirSync(out, { recursive: true });
  createTestRepo({ path: repo });
  return { repo, out, restore: join(root, 'restored') };
};

const run = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A handoff commit, so every case starts from a real HEAD. */
const seed = (repo: string): void => {
  writeFileSync(join(repo, 'app.ts'), 'export const value = 1;\n');
  run(repo, ['add', 'app.ts']);
  run(repo, ['commit', '-m', 'handoff: the staged application change']);
};

describe('#1034 §3 the checkpoint carries Git memory, not code alone', () => {
  it('restores the first solve commit, its note and its staging split together', () => {
    const { repo, out, restore } = workspace('memory');
    seed(repo);

    // The first solve commits, writes a native note on that commit, stages one
    // edit and leaves another unstaged.
    writeFileSync(join(repo, 'app.ts'), 'export const value = 2;\n');
    run(repo, ['commit', '-am', 'solve: raise the value']);
    const solveCommit = run(repo, ['rev-parse', 'HEAD']).trim();
    run(repo, ['notes', '--ref', 'commitlore', 'add', '-m', 'Limit: the vendor caps this at 2', solveCommit]);
    writeFileSync(join(repo, 'staged.ts'), 'export const staged = true;\n');
    run(repo, ['add', 'staged.ts']);
    writeFileSync(join(repo, 'app.ts'), 'export const value = 3;\n');

    const checkpoint = takeCheckpoint({ cwd: repo, stage: 'first_solve', outDir: out });
    const result = restoreCheckpoint(checkpoint, restore);

    // The commit the solve made, not the handoff.
    expect(result.head).toBe(solveCommit);
    expect(run(restore, ['log', '--format=%s', '-1']).trim()).toBe('solve: raise the value');

    // The note it wrote, reachable in the restored repository.
    expect(result.notes.map((note) => note.ref)).toContain('refs/notes/commitlore');
    expect(run(restore, ['notes', '--ref', 'commitlore', 'show', solveCommit])).toContain(
      'Limit: the vendor caps this at 2',
    );

    // Original staging semantics: one path staged, one modified but not staged.
    expect(run(restore, ['diff', '--cached', '--name-only']).trim()).toBe('staged.ts');
    expect(run(restore, ['diff', '--name-only']).trim()).toBe('app.ts');
    expect(readFileSync(join(restore, 'app.ts'), 'utf8')).toBe('export const value = 3;\n');
    expect(result.identity_matches).toBe(true);
  });

  it('does not restore the handoff notes over newer code', () => {
    // "Do NOT reset to the old handoff notes while preserving newer code." The
    // handoff note and the solve note are different strings on different
    // commits; a checkpoint that fetched only the branch would bring the first
    // and lose the second.
    const { repo, out, restore } = workspace('notes-stage');
    seed(repo);
    const handoff = run(repo, ['rev-parse', 'HEAD']).trim();
    run(repo, ['notes', '--ref', 'commitlore', 'add', '-m', 'Limit: written at handoff', handoff]);

    writeFileSync(join(repo, 'app.ts'), 'export const value = 2;\n');
    run(repo, ['commit', '-am', 'solve: change it']);
    const solve = run(repo, ['rev-parse', 'HEAD']).trim();
    run(repo, ['notes', '--ref', 'commitlore', 'add', '-m', 'Limit: written during solve', solve]);

    const result = restoreCheckpoint(takeCheckpoint({ cwd: repo, stage: 'first_solve', outDir: out }), restore);

    expect(result.head).toBe(solve);
    expect(run(restore, ['notes', '--ref', 'commitlore', 'show', solve])).toContain('written during solve');
    expect(run(restore, ['notes', '--ref', 'commitlore', 'show', handoff])).toContain('written at handoff');
  });
});

describe('#1034 §4 a broken build is restored, not repaired', () => {
  it('restores syntactically broken source exactly', () => {
    // "A successful candidate build is NOT a prerequisite for Git restoration:
    // broken source is exactly what feedback/repair may need to fix."
    const { repo, out, restore } = workspace('broken');
    seed(repo);
    const broken = 'export const value = (((;\n';
    writeFileSync(join(repo, 'app.ts'), broken);

    const result = restoreCheckpoint(takeCheckpoint({ cwd: repo, stage: 'first_solve', outDir: out }), restore);

    expect(readFileSync(join(restore, 'app.ts'), 'utf8')).toBe(broken);
    expect(result.identity_matches).toBe(true);
  });
});

describe('#1034 §4 the full snapshot: binary, symlink, new files, modes', () => {
  it('round-trips a binary change, an executable bit, a symlink and an untracked file', () => {
    const { repo, out, restore } = workspace('surfaces');
    seed(repo);

    const binary = Buffer.from([0, 1, 2, 250, 251, 252, 0, 13, 10]);
    writeFileSync(join(repo, 'blob.bin'), binary);
    writeFileSync(join(repo, 'run.sh'), '#!/bin/sh\necho hi\n');
    chmodSync(join(repo, 'run.sh'), 0o755);
    run(repo, ['add', 'blob.bin', 'run.sh']);
    run(repo, ['commit', '-m', 'solve: add assets']);

    // A staged binary edit, so the patch has to carry bytes git can re-apply.
    writeFileSync(join(repo, 'blob.bin'), Buffer.from([9, 8, 7, 255, 0, 1]));
    run(repo, ['add', 'blob.bin']);
    // Untracked payload: a plain file, an executable one and a symlink.
    writeFileSync(join(repo, 'notes.txt'), 'scratch\n');
    writeFileSync(join(repo, 'tool.sh'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(repo, 'tool.sh'), 0o755);
    symlinkSync('app.ts', join(repo, 'link.ts'));

    const checkpoint = takeCheckpoint({ cwd: repo, stage: 'first_solve', outDir: out });
    const result = restoreCheckpoint(checkpoint, restore);

    expect(readFileSync(join(restore, 'blob.bin'))).toEqual(Buffer.from([9, 8, 7, 255, 0, 1]));
    expect((statSync(join(restore, 'run.sh')).mode & 0o111) !== 0).toBe(true);
    expect(readFileSync(join(restore, 'notes.txt'), 'utf8')).toBe('scratch\n');
    expect((statSync(join(restore, 'tool.sh')).mode & 0o111) !== 0).toBe(true);
    expect(readlinkSync(join(restore, 'link.ts'))).toBe('app.ts');
    expect(result.identity_matches).toBe(true);
  });

  it('records a symlink pointing outside the workspace as a limitation and does not follow it', () => {
    // "Never follow symlinks outside the workspace."
    const { repo, out } = workspace('escape');
    seed(repo);
    symlinkSync('/etc/hosts', join(repo, 'escape.txt'));

    const checkpoint = takeCheckpoint({ cwd: repo, stage: 'first_solve', outDir: out });

    expect(checkpoint.new_files.map((file) => file.path)).not.toContain('escape.txt');
    expect(checkpoint.limitations).toContainEqual({ kind: 'symlink_escape', detail: 'escape.txt -> /etc/hosts' });
    expect(checkpointStatusOf(checkpoint)).toBe('incomplete');
  });
});

describe('#1034 §4 collection uses an isolated index', () => {
  it('leaves the actor staged and unstaged state exactly as it was', () => {
    // A snapshot taken mid-episode must not stage or unstage anything. Before
    // and after are compared as git sees them, not as the filesystem does.
    const { repo, out } = workspace('isolated');
    seed(repo);
    writeFileSync(join(repo, 'staged.ts'), 'export const staged = true;\n');
    run(repo, ['add', 'staged.ts']);
    writeFileSync(join(repo, 'app.ts'), 'export const value = 9;\n');
    writeFileSync(join(repo, 'untracked.ts'), 'export const loose = true;\n');

    const before = run(repo, ['status', '--porcelain=v1', '-z']);
    takeCheckpoint({ cwd: repo, stage: 'first_solve', outDir: out });

    expect(run(repo, ['status', '--porcelain=v1', '-z'])).toBe(before);
    expect(run(repo, ['diff', '--cached', '--name-only']).trim()).toBe('staged.ts');
  });
});

describe('#1034 §3 source and notes identity are recorded together', () => {
  it('reports a mismatch when the restored tree is not the one collected', () => {
    // "Record first-solve source and Git/notes identity together so a patch
    // cannot be paired with another stage's memory." A checkpoint whose tree
    // identity was taken from a different moment must not restore silently.
    const { repo, out, restore } = workspace('mismatch');
    seed(repo);
    writeFileSync(join(repo, 'app.ts'), 'export const value = 2;\n');

    const checkpoint = takeCheckpoint({ cwd: repo, stage: 'first_solve', outDir: out });
    const otherStage = { ...checkpoint, worktree_tree: '0'.repeat(40) };
    const result = restoreCheckpoint(otherStage, restore);

    expect(result.identity_matches).toBe(false);
    // The content still arrives -- the point is that the mismatch is visible
    // rather than that the restore refuses. #1042 rule 3 is what turns an
    // unusable checkpoint into `unavailable`.
    expect(readFileSync(join(restore, 'app.ts'), 'utf8')).toBe('export const value = 2;\n');
  });
});

describe('#1034 §4 empty deltas are no-ops', () => {
  it('restores a clean tree with no staged or unstaged change', () => {
    // `git apply` exits non-zero on an empty patch, so the clean case is the one
    // a naive implementation throws on.
    const { repo, out, restore } = workspace('clean');
    seed(repo);

    const checkpoint = takeCheckpoint({ cwd: repo, stage: 'first_solve', outDir: out });

    expect(checkpoint.staged_patch).toBe('');
    expect(checkpoint.unstaged_patch).toBe('');
    expect(checkpointStatusOf(checkpoint)).toBe('complete');

    const result = restoreCheckpoint(checkpoint, restore);
    expect(result.identity_matches).toBe(true);
    expect(run(restore, ['status', '--porcelain=v1']).trim()).toBe('');
  });
});

describe('#1034 §4 harness artifacts are excluded by exact path only', () => {
  it('drops a named harness file and keeps everything else', () => {
    // "Exclude only explicitly owned harness artifacts, not broad source
    // directories." The exclusion is an exact path, so a directory of source
    // cannot be removed by one entry.
    const { repo, out } = workspace('exclude');
    seed(repo);
    writeFileSync(join(repo, 'harness-log.json'), '{}\n');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'kept.ts'), 'export const kept = true;\n');

    const checkpoint = takeCheckpoint({
      cwd: repo,
      stage: 'first_solve',
      outDir: out,
      exclude: ['harness-log.json'],
    });

    const paths = checkpoint.new_files.map((file) => file.path);
    expect(paths).not.toContain('harness-log.json');
    expect(paths).toContain(join('src', 'kept.ts'));
  });
});
