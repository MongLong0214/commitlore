/**
 * #428: the stub's `COMMITLORE_BIN` branch `exec`s the file itself, so the
 * target has to be executable in its own right. `dist/cli.js` carries a
 * `#!/usr/bin/env node` shebang and mode `-rw-------` — it is not.
 *
 * A failed `exec` terminates the shell non-zero, so the hook blocked the git
 * operation it sits next to: a commit for `commit-msg`, a push for `pre-push`.
 * That contradicts the branch's own documented behaviour, which is that a value
 * which does not resolve falls through to the remaining resolution steps.
 *
 * The tests drive real `git commit` invocations. The defect is in shell text
 * that only git runs, and it is invisible from the TypeScript that generates it.
 */

import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { commitMsgStub } from '../src/hooks/commit-msg.js';
import { createTestRepo } from './git-fixtures.js';

const run = promisify(execFile);

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

const git = (cwd: string, args: string[]): string => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout;
};

/** A repository with the gate installed, so the stub is the one under test. */
const repoWithGate = async (label: string): Promise<string> => {
  const dir = createTestRepo({ path: temp(label) });
  git(dir, ['config', 'user.email', `${label}@example.invalid`]);
  git(dir, ['config', 'user.name', label]);
  // Spawned, not called in-process: `hooks install` records `commitlore.bin`
  // from the entry point it runs as, and inside a vitest worker that is
  // tinypool's process entry.
  await run(process.execPath, [BUNDLE, 'hooks', 'install'], { cwd: dir });
  return dir;
};

const commitWith = async (
  cwd: string,
  binValue: string | undefined,
  body: string,
): Promise<{ code: number; stderr: string }> => {
  writeFileSync(join(cwd, 'src.ts'), `export const a = ${Math.floor(body.length)};\n`);
  git(cwd, ['add', '-A']);
  const env = { ...process.env };
  if (binValue === undefined) delete env.COMMITLORE_BIN;
  else env.COMMITLORE_BIN = binValue;
  try {
    await run('git', ['commit', '--quiet', '-m', body], { cwd, env });
    return { code: 0, stderr: '' };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    return { code: failure.code ?? 1, stderr: failure.stderr ?? '' };
  }
};

const VALID = 'feat: a change\n\nLimit: something true\nRecord-Id: r-bin001\nProvenance: authored\n';
const INVALID = 'feat: a change\n\nBlast: wide\nRecord-Id: r-bin002\nProvenance: authored\n';

describe('#428 a COMMITLORE_BIN that cannot be executed falls through instead of blocking', () => {
  it('the gate still works with no COMMITLORE_BIN at all — the control', async () => {
    const dir = await repoWithGate('bin-control');
    expect((await commitWith(dir, undefined, VALID)).code).toBe(0);
    const rejected = await commitWith(dir, undefined, INVALID);
    expect(rejected.code, 'the gate did not reject an invalid record').not.toBe(0);
    expect(rejected.stderr).toMatch(/enum Blast/);
  }, 60_000);

  it('a non-executable .js does not block the commit', async () => {
    const dir = await repoWithGate('bin-nonexec');
    // A copy of the real bundle with the execute bit cleared: the exact shape
    // `dist/cli.js` has in a fresh checkout.
    const target = join(temp('bin-nonexec-target'), 'commitlore.mjs');
    copyFileSync(BUNDLE, target);
    chmodSync(target, 0o644);

    const result = await commitWith(dir, target, VALID);
    expect(result.code, `the hook blocked the commit: ${result.stderr}`).toBe(0);
  }, 60_000);

  /**
   * Falling through must reach the recorded path, not silence. An invalid
   * record still has to be rejected — otherwise this fix would have turned the
   * gate off for anyone with the variable set.
   */
  it('falling through still reaches a working gate', async () => {
    const dir = await repoWithGate('bin-fallthrough');
    const target = join(temp('bin-fallthrough-target'), 'commitlore.mjs');
    copyFileSync(BUNDLE, target);
    chmodSync(target, 0o644);

    const rejected = await commitWith(dir, target, INVALID);
    expect(rejected.code, 'an invalid record was accepted').not.toBe(0);
    expect(rejected.stderr).toMatch(/enum Blast/);
  }, 60_000);

  /**
   * Fall-through is the right answer only if the branch is still *reachable*.
   * The behavioural cases above cannot tell "fell through correctly" apart from
   * "the branch is now dead", and a guard written wrongly would produce both.
   *
   * Asserted against the generated stub rather than a process, because an
   * executable copy of the bundle cannot be made in a test: it resolves its own
   * package root and reads `spec/schema/record.schema.json` beneath it, so a
   * copy outside a complete installation fails for an unrelated reason.
   */
  it('the guarded exec is still there, and every one of them is guarded', () => {
    const lines = commitMsgStub().split('\n').map((line) => line.trim());

    const execs = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.startsWith('exec "$COMMITLORE_BIN"'));

    // Reachable: the branch was not accidentally deleted along with the hazard.
    expect(execs, 'the COMMITLORE_BIN branch is gone entirely').toHaveLength(1);

    // Guarded: stated as "every one", not "the one", so adding a second
    // unguarded exec later fails here rather than shipping.
    for (const { index } of execs) {
      expect(lines[index - 1], 'an exec of COMMITLORE_BIN is not preceded by its -x check').toBe(
        'if [ -x "$COMMITLORE_BIN" ]; then',
      );
    }
  });
});
