/**
 * #746: after an upgrade the gate said "cannot find the CLI this hook was
 * installed with" while the recorded CLI was present, executable, and working.
 *
 * `hooks install` records `commitlore.bin` through `<data-root>/current` so the
 * hook follows an upgrade, and `commitlore.root` as the physical tree that
 * recorded it so the containment boundary follows nothing — a `current` that
 * someone repoints must not carry the boundary with it. An upgrade moves one
 * and not the other, so the check refuses. **That refusal is the fence working**
 * and these tests do not ask it to stop.
 *
 * What they pin is the sentence. Three outcomes were reported as one:
 *
 *   (1) nothing resolved at all
 *   (2) the recorded pair resolved and containment refused it
 *   (3) the CLI ran and returned a verdict
 *
 * Only (3) is a verdict, and an upgrade produces (2) wearing (1)'s message.
 *
 * The defect lives in shell text that only git runs, so these drive the real
 * hook under the same restricted PATH `doctor` probes with — a login shell has
 * `commitlore` on PATH and takes a fallback route that hides the whole thing.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { captureHookStub, HOOK_MODE } from '../src/hooks/commit-msg.js';
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

const repoWithGate = async (label: string): Promise<string> => {
  const dir = createTestRepo({ path: temp(label) });
  git(dir, ['config', 'user.email', `${label}@example.invalid`]);
  git(dir, ['config', 'user.name', label]);
  // Spawned rather than called in-process: `hooks install` records
  // `commitlore.bin` from the entry point it runs as, and inside a vitest
  // worker that is tinypool's process entry.
  await run(process.execPath, [BUNDLE, 'hooks', 'install'], { cwd: dir });
  return dir;
};

/**
 * The hook as git runs it in the environment that exposes this: PATH without
 * `commitlore`, so the recorded route is the only one that can succeed and its
 * failure is not masked by a fallback.
 */
const runHook = async (
  cwd: string,
  hook: string,
  message: string,
): Promise<{ code: number; stderr: string; stdout: string }> => {
  const messageFile = join(cwd, 'MESSAGE');
  writeFileSync(messageFile, message);
  try {
    const done = await run('sh', [join(cwd, '.git', 'hooks', hook), messageFile], {
      cwd,
      env: { HOME: process.env.HOME ?? '', PATH: '/usr/bin:/bin' },
    });
    return { code: 0, stderr: done.stderr, stdout: done.stdout };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string; stdout?: string };
    return { code: failure.code ?? 1, stderr: failure.stderr ?? '', stdout: failure.stdout ?? '' };
  }
};

const VALID = 'feat: a change\n\nLimit: something true\nRecord-Id: r-cont001\nProvenance: authored\n';

/** What an upgrade produces: the boundary on one tree, the recorded bin on another. */
const upgradeShapedMismatch = (cwd: string): string => {
  const elsewhere = temp('cont-other-install');
  git(cwd, ['config', '--local', 'commitlore.root', elsewhere]);
  return elsewhere;
};

describe('#746 a containment refusal says so, instead of claiming the CLI is missing', () => {
  it('the recorded route works when the boundary matches — the control', async () => {
    const dir = await repoWithGate('cont-control');
    const result = await runHook(dir, 'commit-msg', VALID);

    // The point of the control is not the exit code but *which* outcome it is:
    // the CLI ran and returned a verdict, which is (3). If this ever reports
    // (1) the tests below would pass for the wrong reason.
    expect(
      result.stderr,
      'the control took a fallback route, so the cases below prove nothing',
    ).not.toMatch(/cannot find the CLI/);
    expect(result.code, `the gate rejected a valid record: ${result.stderr}`).toBe(0);
  }, 60_000);

  it('names the refusal and both paths, and never says the CLI is missing', async () => {
    const dir = await repoWithGate('cont-gate');
    const elsewhere = upgradeShapedMismatch(dir);

    const result = await runHook(dir, 'commit-msg', VALID);

    // The regression this file exists for. Before the fix this branch fell
    // through to the PATH and node_modules walks and ended on the absence
    // message, sending an operator after a file that is present and fine.
    expect(
      result.stderr,
      'a containment refusal is still being reported as a missing CLI (#746)',
    ).not.toMatch(/cannot find the CLI/);

    expect(result.stderr).toMatch(/points outside the install this hook trusts/);
    // Both sides of the comparison, because either one alone leaves the
    // operator guessing which of the two moved.
    expect(result.stderr).toContain(realpathSync(REPO_ROOT));
    expect(result.stderr).toContain(realpathSync(elsewhere));
    expect(result.stderr, 'the remedy is not named').toMatch(/hooks install/);
  }, 60_000);

  it('says the recorded install is gone when it cannot be resolved at all', async () => {
    // The second door to the same wrong sentence. When either side of the
    // comparison fails to resolve, the check never runs — and before this it
    // fell through to "cannot find the CLI", which is nearly true and still the
    // wrong instruction. Deleting an old release directory after an upgrade is
    // the ordinary way to arrive here.
    const dir = await repoWithGate('cont-gone');
    const gone = join(temp('cont-gone-parent'), 'deleted-release');
    git(dir, ['config', '--local', 'commitlore.root', gone]);

    const result = await runHook(dir, 'commit-msg', VALID);

    expect(result.stderr).toMatch(/no longer resolves on disk/);
    expect(result.stderr).toContain(gone);
    // Distinct from the outside-the-boundary case: they need the same command
    // but describe different machines, and telling them apart is the point.
    expect(result.stderr).not.toMatch(/points outside the install/);
    expect(result.stderr, 'still the absence message, by a second door').not.toMatch(
      /cannot find the CLI/,
    );
    expect(result.stderr).toMatch(/hooks install/);
  }, 60_000);

  it('still refuses the commit — the fence is not what is being changed', async () => {
    const dir = await repoWithGate('cont-refuses');
    upgradeShapedMismatch(dir);

    const result = await runHook(dir, 'commit-msg', VALID);

    // After an upgrade the recorded path leads to a tree this install never
    // verified. Reporting it accurately is the fix; letting it through would be
    // a different and worse change.
    expect(result.code, 'the gate stopped refusing an unverified tree').not.toBe(0);
  }, 60_000);

  it('a capture hook reports the same cause and still lets the commit through', async () => {
    const dir = await repoWithGate('cont-capture');
    const elsewhere = upgradeShapedMismatch(dir);
    // `hooks install` writes the gate only, so the capture ending is planted
    // directly — it is the same generated text `init` would write.
    const capture = join(dir, '.git', 'hooks', 'post-commit');
    writeFileSync(capture, captureHookStub(), { mode: HOOK_MODE });

    const result = await runHook(dir, 'post-commit', VALID);

    expect(result.stderr).toMatch(/points outside the install this hook trusts/);
    expect(result.stderr).toContain(realpathSync(elsewhere));
    // A capture hook holds no verdict back, so the same cause must not block a
    // commit here. The two endings share the diagnosis and not the policy.
    expect(result.code, 'a capture hook blocked the operation over a moved install').toBe(0);
    expect(result.stderr).toMatch(/init/);
  }, 60_000);
});

/**
 * The other half of #746, and the precondition for documenting the remedy at
 * all: `hooks install` is what re-points a repository after an upgrade, and it
 * reported that it had done nothing.
 *
 * `recordBinPath` writes `commitlore.bin` **and** `commitlore.root`. After an
 * upgrade only the second moves — `bin` points through `<data-root>/current`, so
 * its string is identical either side — and the change summary compared `bin`
 * alone. So the one repair this command exists to perform printed `unchanged`.
 *
 * #629 is the same defect one level up: reporting on the hook *file*, which is
 * byte-identical across upgrades, said the repair had not happened. Its fix
 * added the recorded target; this adds the recorded root.
 */
describe('#746 hooks install reports the root it moved, not only the bin it did not', () => {
  it('names the moved root when the recorded bin string is unchanged', async () => {
    const dir = await repoWithGate('cont-report');
    const elsewhere = upgradeShapedMismatch(dir);
    const binBefore = git(dir, ['config', '--local', '--get', 'commitlore.bin']).trim();

    const again = await run(process.execPath, [BUNDLE, 'hooks', 'install'], { cwd: dir });
    const said = `${again.stdout}${again.stderr}`;

    // The precondition that makes this the upgrade shape rather than some other
    // repair: `bin` did not move, so anything comparing only `bin` sees nothing.
    expect(
      git(dir, ['config', '--local', '--get', 'commitlore.bin']).trim(),
      'the bin string moved, so this is not the case the test is about',
    ).toBe(binBefore);

    expect(said, 'the repair reported nothing while it rewrote the root').toMatch(
      /recorded install root moved/,
    );
    expect(said).toContain(elsewhere);
    expect(said).toContain(realpathSync(REPO_ROOT));
  }, 60_000);

  it('does not call a first write a move', async () => {
    // The line added for the upgrade case runs on every install, and on a first
    // one there is no previous value — `moved: (none recorded) -> x` describes a
    // transition that did not happen. `r-repointsays629` already rejected
    // reporting the target on every install for this reason: "on a first install
    // there is nothing to compare against".
    //
    // It is the third member of the #629 family in this area — reporting only
    // the file, then only the bin, then a move that was a first write — which is
    // why it gets a test rather than a careful reading.
    const dir = createTestRepo({ path: temp('cont-first') });
    git(dir, ['config', 'user.email', 'first@example.invalid']);
    git(dir, ['config', 'user.name', 'first']);

    const first = await run(process.execPath, [BUNDLE, 'hooks', 'install'], { cwd: dir });
    const said = `${first.stdout}${first.stderr}`;

    expect(said, 'a first write was reported as a move').not.toMatch(/moved: \(none recorded\)/);
    expect(said, 'a first write was reported as a repoint').not.toMatch(/repointed: \(none recorded\)/);
    // The values are still worth stating on a first install; only the verb was
    // wrong. Silence here would lose which CLI and which root got wired.
    expect(said).toMatch(/recorded CLI recorded:|recorded CLI:/);
    expect(said).toMatch(/recorded install root recorded:|recorded install root:/);
  }, 60_000);

  it('the repair actually clears the refusal it was prescribed for', async () => {
    const dir = await repoWithGate('cont-repair');
    upgradeShapedMismatch(dir);
    expect((await runHook(dir, 'commit-msg', VALID)).stderr).toMatch(/outside the install/);

    await run(process.execPath, [BUNDLE, 'hooks', 'install'], { cwd: dir });

    // Naming the remedy is worth nothing if the remedy does not work, and this
    // is the assertion that keeps the message honest rather than merely nicer.
    const after = await runHook(dir, 'commit-msg', VALID);
    expect(after.stderr).not.toMatch(/outside the install/);
    expect(after.code, `the prescribed fix did not restore the hook: ${after.stderr}`).toBe(0);
  }, 60_000);
});
