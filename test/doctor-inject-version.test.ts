/**
 * #433: the build the agent's hook runs and the build the user runs are
 * separate installations, and nothing keeps them in step. A plugin cache found
 * in the field held **0.4.0** while the CLI beside it was 0.6.0 — four releases
 * apart, with no signal that anything was behind.
 *
 * The agent runs the hook, not the CLI. So everything fixed in between was
 * invisible to every edit in that repository, including two security fixes.
 *
 * `doctor` already spawns the configured hook executable to check it answers.
 * Asking it for its version costs one more process and no network, and is the
 * only signal available locally.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { runDoctor } from '../src/commands/doctor.js';
import { execGit } from '../src/core/git.js';
import { packageVersion } from '../src/core/paths.js';
import { CLAUDE_HOOK_COMMAND, claudeSettingsPath } from '../src/hooks/claude-settings.js';
import { createTestRepo } from './git-fixtures.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(REPO_ROOT, 'dist', 'commitlore.mjs');

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[]): void => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
};

/**
 * A stand-in for the hook executable that reports whatever version it is told
 * to. The check asks the *configured* command for its version, so what matters
 * is the answer, not which real build produced it.
 */
const fakeCommitlore = (label: string, version: string): string => {
  const dir = temp(label);
  const path = join(dir, 'commitlore');
  writeFileSync(
    path,
    ['#!/bin/sh', `if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi`, 'exit 0', ''].join(
      '\n',
    ),
  );
  chmodSync(path, 0o755);
  return dir;
};

/** A repository with the Claude hook installed and a chosen `commitlore` on PATH. */
const repoWithHook = (label: string, binDir: string): string => {
  const dir = createTestRepo({ path: temp(label) });
  git(dir, ['config', 'user.email', `${label}@example.invalid`]);
  git(dir, ['config', 'user.name', label]);
  writeFileSync(join(dir, 'src.ts'), 'export const a = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'init']);

  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(
    claudeSettingsPath(dir),
    `${JSON.stringify(
      { hooks: { PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: CLAUDE_HOOK_COMMAND }] }] } },
      null,
      2,
    )}\n`,
  );
  process.env['PATH'] = `${binDir}:${process.env['PATH'] ?? ''}`;
  return dir;
};

const versionCheck = (cwd: string) =>
  runDoctor({ cwd }).checks.find((entry) => entry.id === 'inject-version');

describe('#433 doctor reports when the hook runs a different build than the CLI', () => {
  const originalPath = process.env['PATH'];
  afterAll(() => {
    process.env['PATH'] = originalPath;
  });

  it('warns when the hook is behind, and names both versions', () => {
    const dir = repoWithHook('inject-version-stale', fakeCommitlore('bin-stale', '0.4.0'));
    const found = versionCheck(dir);

    expect(found?.status, found?.detail).toBe('warn');
    expect(found?.detail).toContain('0.4.0');
    expect(found?.detail).toContain(packageVersion());
    expect(found?.fix).toMatch(/marketplace update/);
  });

  it('is ok when they match', () => {
    const dir = repoWithHook('inject-version-match', fakeCommitlore('bin-match', packageVersion()));
    const found = versionCheck(dir);

    expect(found?.status, found?.detail).toBe('ok');
    expect(found?.needsAttention).toBe(false);
  });

  it('warns when the hook is ahead too — either direction is a mismatch', () => {
    const dir = repoWithHook('inject-version-ahead', fakeCommitlore('bin-ahead', '99.0.0'));
    expect(versionCheck(dir)?.status).toBe('warn');
  });

  /**
   * `checkInjectRuntime` owns "the hook does not run at all" and reports it
   * with a remedy. Saying it twice would be noise, so this check stands down.
   */
  it('says nothing when there is no hook to compare against', () => {
    const dir = createTestRepo({ path: temp('inject-version-nohook') });
    git(dir, ['config', 'user.email', 'x@example.invalid']);
    git(dir, ['config', 'user.name', 'x']);
    writeFileSync(join(dir, 'src.ts'), 'export const a = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '--quiet', '-m', 'init']);

    const found = versionCheck(dir);
    expect(found?.status).toBe('skipped');
    expect(found?.needsAttention).toBe(false);
  });

  /**
   * Exit 0 is not the same as an answer. A wrapper that ignores its arguments
   * and prints a hook payload for any argv exits 0 too — `test/init.test.ts`
   * ships exactly that stub — and reading its output as a version reports a
   * mismatch against something that was never a version. That is how this was
   * found: the check warned on a healthy install.
   */
  it('does not call it a mismatch when the answer is not a version', () => {
    const dir = temp('bin-garbage');
    const path = join(dir, 'commitlore');
    writeFileSync(
      path,
      ['#!/bin/sh', 'printf \'{"hookSpecificOutput":{"additionalContext":"context"}}\\n\'', ''].join(
        '\n',
      ),
    );
    chmodSync(path, 0o755);

    const repo = repoWithHook('inject-version-garbage', dir);
    const found = versionCheck(repo);

    expect(found?.status, found?.detail).toBe('skipped');
    expect(found?.needsAttention).toBe(false);
    expect(found?.detail).toMatch(/not a version/);
  });

  it('the real bundle reports the version this CLI was built from', () => {
    // Guards the assumption the check rests on: `--version` is answerable and
    // matches `packageVersion()`. If that ever stops holding, every case above
    // would pass while the check compared nothing.
    const reported = execFileSync(process.execPath, [BUNDLE, '--version'], {
      encoding: 'utf8',
    }).trim();
    expect(reported).toBe(packageVersion());
  });
});
