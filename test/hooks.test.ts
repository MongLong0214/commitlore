/**
 * T-202: `commitlore hooks` against real repositories.
 *
 * The hook is exercised as git exercises it — a compiled binary invoked by a
 * shell stub that git runs — because everything that can break here (the
 * execute bit, the shebang, `$1`, the exit code, the chained hook's status)
 * only exists outside the TypeScript process.
 *
 * Every repository is a fresh `os.tmpdir()` directory. The suite also asserts
 * that this project's own `.git/hooks` is untouched: a hook installer whose
 * tests install hooks into the developer's checkout is the exact failure this
 * command must never have.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installHook, readHookStatus, uninstallHook } from '../src/commands/hooks.js';
import { runInit } from '../src/commands/init.js';
import { packageVersion } from '../src/core/paths.js';
import { captureHookFailOpen } from '../src/hooks/capture-fail-open.js';
import { CHAINED_HOOK_NAME, HOOK_MARKER, HOOK_NAME, captureHookStub, commitMsgStub } from '../src/hooks/commit-msg.js';
import { POST_COMMIT_HOOK_NAME } from '../src/hooks/post-commit.js';
import {
  PREPARE_COMMIT_MSG_HOOK_NAME,
  prepareCommitMsgStub,
} from '../src/hooks/prepare-commit-msg.js';
import { createTestRepo } from './git-fixtures.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const OWN_HOOKS_DIR = (() => {
  const result = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) throw new Error(`could not resolve hooks path: ${result.stderr}`);
  return resolve(PACKAGE_ROOT, result.stdout.trim());
})();

const NODE_BIN_DIR = dirname(process.execPath);

/**
 * PATH is rebuilt, never inherited.
 *
 * `npm test` puts `node_modules/.bin` in front, and this repository can have a
 * `commitlore` linked there — it dogfoods its own hook. An inherited PATH would
 * silently satisfy the stub's `command -v` branch, and the local-resolution
 * test below would pass without ever reaching the code it is named after.
 */
const withoutCommitlore = (entries: string[]): string[] =>
  entries.filter((entry) => entry.length > 0 && !existsSync(join(entry, 'commitlore')));

/** No `commitlore` resolvable at all — not even beside node. */
const PATH_WITHOUT_COMMITLORE = withoutCommitlore([
  NODE_BIN_DIR,
  ...(process.env.PATH ?? '').split(':'),
]).join(':');

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  // node stays reachable for the stub's shebang; commitlore does not.
  PATH: [NODE_BIN_DIR, ...withoutCommitlore((process.env.PATH ?? '').split(':'))].join(':'),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'CommitLore Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'CommitLore Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

const temporaryDirectories: string[] = [];

const makeTemporary = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  expect(dir.startsWith(tmpdir())).toBe(true);
  temporaryDirectories.push(dir);
  return dir;
};

/**
 * A standalone build of the CLI's commands, outside the package tree.
 *
 * It deliberately does not go through `src/cli.ts` (owned elsewhere) and does
 * not write into the package's own `dist/`, which another suite builds
 * concurrently. `node_modules` and `spec` are linked in because the compiled
 * modules resolve dependencies by walking up from their own location, and
 * `core/schema.ts` loads `../../spec/schema/record.schema.json`.
 */
let binPath = '';

/**
 * A second copy of the same harness build with no extension and the basename
 * `commitlore` -- the name the installer's own wrapper carries.
 *
 * It used to stand in for the compiled build ADR-0026 removed. What it proves now
 * is the refusal: an extensionless entry point is not exec'd on the strength of its
 * name, by the stub or by `COMMITLORE_BIN`, and resolution falls through to the
 * routes that name an interpreter.
 */
let binaryLikePath = '';

beforeAll(() => {
  const harness = makeTemporary('commitlore-hookbin-');
  const build = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json', '--outDir', join(harness, 'dist')], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    shell: false,
  });
  if (build.status !== 0) {
    throw new Error(`tsc build failed (exit ${build.status}):\n${build.stdout}${build.stderr}`);
  }

  symlinkSync(join(PACKAGE_ROOT, 'node_modules'), join(harness, 'node_modules'), 'dir');
  symlinkSync(join(PACKAGE_ROOT, 'spec'), join(harness, 'spec'), 'dir');
  // `version` as well as `type`: this manifest is the root the harness build
  // resolves `packageVersion()` from, and #382's check reads the same field off
  // whatever install `commitlore.bin` points into. A manifest without one is a
  // shape no installation has — a clone, a tarball and install.sh all carry the
  // declared version — and leaving it out would make every repository this
  // suite installs into an unresolvable pin rather than a healthy one.
  writeFileSync(
    join(harness, 'package.json'),
    `${JSON.stringify({ type: 'module', version: packageVersion() })}\n`,
  );

  binPath = join(harness, 'commitlore.mjs');
  writeFileSync(
    binPath,
    [
      '#!/usr/bin/env node',
      "import { Command } from 'commander';",
      "import { register as registerValidate } from './dist/commands/validate.js';",
      "import { register as registerHooks } from './dist/commands/hooks.js';",
      "import { register as registerPrepareCommitMsg } from './dist/hooks/prepare-commit-msg.js';",
      '',
      'const program = new Command();',
      "program.name('commitlore');",
      'registerValidate(program);',
      'registerHooks(program);',
      'registerPrepareCommitMsg(program);',
      'program.parse(process.argv);',
      '',
    ].join('\n'),
  );
  chmodSync(binPath, 0o755);

  binaryLikePath = join(harness, 'commitlore');
  writeFileSync(binaryLikePath, readFileSync(binPath, 'utf8'));
  chmodSync(binaryLikePath, 0o755);
}, 180_000);

/**
 * Separates the per-file entries below. It was a literal, unescaped NUL byte
 * until #389 - the byte itself sitting in the source, not the two-character
 * escape it reads as. That one byte made git classify this 1,200-line file as
 * binary, so every diff of it read `Binary files ... differ` on GitHub and
 * locally, and `grep` skipped the file instead of searching it. The file covers
 * the commit-msg hook, so that cost was paid on every review of the enforcement
 * point.
 *
 * The NUL was not the stronger choice it looks like. Entries are built with
 * `readFileSync(path, 'utf8')`, which decodes a 0x00 byte in a hook to U+0000 in
 * the string - so a NUL separator was exactly as forgeable as this text one, and
 * more so for the only hooks that plausibly carry NULs at all, compiled ones.
 *
 * What makes either spelling safe is that the joined string is never parsed. It
 * is compared for equality against a snapshot of the same directory taken
 * earlier in the same process, so an ambiguous separator cannot mis-split
 * anything; it could only hide a change by letting two different directory
 * states serialise to identical bytes. That needs a hook body carrying this
 * sentinel on a line of its own, placed so the whole concatenation is reproduced
 * byte for byte. Nothing that writes into this directory - git's shipped
 * `.sample` hooks and the stubs this command installs - contains it.
 */
const OWN_HOOKS_SNAPSHOT_SEPARATOR = '\n@@COMMITLORE-SNAPSHOT@@\n';

/**
 * Names, modes and bytes of this repository's own hooks directory. Compared
 * before and after the suite: the repository may legitimately have commitlore's
 * hook installed (it dogfoods its own protocol), so the guard is that nothing
 * here *changes*, not that nothing is here.
 */
const snapshotOwnHooks = (): string =>
  readdirSync(OWN_HOOKS_DIR)
    .sort()
    .map((name) => {
      const path = join(OWN_HOOKS_DIR, name);
      return `${name} ${(statSync(path).mode & 0o777).toString(8)} ${readFileSync(path, 'utf8')}`;
    })
    .join(OWN_HOOKS_SNAPSHOT_SEPARATOR);

const ownHooksBefore = snapshotOwnHooks();

afterAll(() => {
  for (const dir of temporaryDirectories) rmSync(dir, { recursive: true, force: true });
});

const git = (
  cwd: string,
  args: string[],
  input = '',
  extra: NodeJS.ProcessEnv = {},
): ReturnType<typeof spawnSync> =>
  spawnSync('git', args, { cwd, env: { ...GIT_ENV, ...extra }, encoding: 'utf8', shell: false, input });

const gitOrThrow = (cwd: string, args: string[], input = ''): string => {
  const result = git(cwd, args, input);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr)}`);
  }
  return String(result.stdout);
};

const makeRepo = (): string => {
  const dir = makeTemporary('commitlore-hooks-');
  return createTestRepo({ path: dir, env: GIT_ENV });
};

/** Runs the built CLI the way a shell would, but through node explicitly. */
const runCli = (
  cwd: string,
  args: string[],
  extra: NodeJS.ProcessEnv = {},
  input = '',
): { status: number; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    env: { ...GIT_ENV, ...extra },
    encoding: 'utf8',
    shell: false,
    input,
  });
  return {
    status: result.status ?? -1,
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
};

/** Same as `runCli`, but through `binaryLikePath` — see its doc comment. */
const runBinaryCli = (
  cwd: string,
  args: string[],
  extra: NodeJS.ProcessEnv = {},
): { status: number; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [binaryLikePath, ...args], {
    cwd,
    env: { ...GIT_ENV, ...extra },
    encoding: 'utf8',
    shell: false,
  });
  return {
    status: result.status ?? -1,
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
};

const stage = (repo: string, file: string): void => {
  writeFileSync(join(repo, file), `${file}\n`);
  gitOrThrow(repo, ['add', '-A']);
};

/**
 * Commits with hooks enabled, so the installed stub actually runs.
 * `COMMITLORE_BIN` points the stub at the harness build; passing `{}` for
 * `extra` exercises the stub's own resolution chain instead.
 */
const commitThroughHooks = (
  repo: string,
  file: string,
  message: string,
  extra?: NodeJS.ProcessEnv,
): { status: number; output: string } => {
  stage(repo, file);
  const result = git(repo, ['commit', '-F', '-'], message, extra ?? { COMMITLORE_BIN: binPath });
  return {
    status: result.status ?? -1,
    output: `${String(result.stdout)}${String(result.stderr)}`,
  };
};

const squashFeature = (repo: string, messages: readonly string[]): void => {
  stage(repo, 'base.txt');
  gitOrThrow(repo, ['commit', '--no-verify', '-q', '-m', 'Base']);
  gitOrThrow(repo, ['checkout', '-q', '-b', 'feature']);
  for (const [index, message] of messages.entries()) {
    stage(repo, `feature-${index}.txt`);
    gitOrThrow(repo, ['commit', '--no-verify', '-q', '-F', '-'], message);
  }
  gitOrThrow(repo, ['checkout', '-q', 'main']);
  gitOrThrow(repo, ['merge', '--squash', 'feature']);
};

const commitSquashThroughHooks = (repo: string, message: string): { status: number; output: string } => {
  const result = git(repo, ['commit', '-F', '-'], message, { COMMITLORE_BIN: binPath });
  return { status: result.status ?? -1, output: `${String(result.stdout)}${String(result.stderr)}` };
};

const writeScript = (path: string, lines: string[]): void => {
  writeFileSync(path, `${lines.join('\n')}\n`);
  chmodSync(path, 0o755);
};

const hooksDirOf = (repo: string): string => join(repo, '.git', 'hooks');

const foreignHook = (repo: string, witness: string, exitCode = 0): string => {
  const path = join(hooksDirOf(repo), 'commit-msg');
  mkdirSync(hooksDirOf(repo), { recursive: true });
  writeScript(path, ['#!/bin/sh', `echo "foreign saw $1" >> ${JSON.stringify(witness)}`, `exit ${exitCode}`]);
  return path;
};

describe('hooks install', () => {
  it('installs an executable stub into the hooks directory', () => {
    const repo = makeRepo();
    const result = runCli(repo, ['hooks', 'install']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('installed commit-msg hook');

    const hookPath = join(hooksDirOf(repo), 'commit-msg');
    expect(readFileSync(hookPath, 'utf8')).toBe(commitMsgStub());
    expect(existsSync(join(hooksDirOf(repo), CHAINED_HOOK_NAME))).toBe(false);
    expect(readHookStatus(repo).state).toBe('installed');
    // git skips a hook without the execute bit; the stub would never run.
    expect(spawnSync('test', ['-x', hookPath], { shell: false }).status).toBe(0);
  });

  // #629: the hook file reads its target from config, so an upgrade leaves it
  // byte-identical and the old headline said "(unchanged)" — about the file —
  // while `commitlore.bin` moved to a different install underneath it. That is
  // the one line the user reads after being told by `hooks status` to run this,
  // and it said the repair had not happened.
  it('says the recorded CLI moved when a reinstall repoints it', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const stale = join(repo, 'stale-cli.mjs');
    writeFileSync(stale, '// an older install\n');
    gitOrThrow(repo, ['config', '--local', 'commitlore.bin', stale]);

    const result = runCli(repo, ['hooks', 'install']);

    expect(result.status).toBe(0);
    expect(result.stdout, 'the file really is unchanged, and saying so is fine').toContain('file unchanged');
    expect(result.stdout, 'but the repair the user was told to make is the headline').toContain('recorded CLI repointed');
    expect(result.stdout).toContain(stale);
    expect(gitOrThrow(repo, ['config', '--local', '--get', 'commitlore.bin']).trim()).not.toBe(stale);
  });

  it('leaves the recorded CLI unmentioned when nothing moved', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const result = runCli(repo, ['hooks', 'install']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('(unchanged)');
    expect(result.stdout, 'a no-op must not read as a repair').not.toContain('recorded CLI repointed');
  });

  it('is idempotent — a second install leaves byte-identical content', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    const once = readFileSync(join(hooksDirOf(repo), 'commit-msg'), 'utf8');

    const second = runCli(repo, ['hooks', 'install']);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('already installed');

    const twice = readFileSync(join(hooksDirOf(repo), 'commit-msg'), 'utf8');
    expect(twice).toBe(once);
    expect(twice.split(HOOK_MARKER).length - 1).toBe(1);
    // No second stub, no stray temp file from the atomic write.
    expect(
      readdirSync(hooksDirOf(repo)).filter(
        (name) => name.startsWith('commit-msg') && !name.endsWith('.sample'),
      ),
    ).toEqual(['commit-msg']);
  });

  it('rewrites an out-of-date stub of ours without --force', () => {
    const repo = makeRepo();
    expect(installHook({ cwd: repo }).code).toBe(0);
    const hookPath = join(hooksDirOf(repo), 'commit-msg');
    writeScript(hookPath, ['#!/bin/sh', HOOK_MARKER, '# an older build wrote this', 'exit 0']);
    expect(readHookStatus(repo).state).toBe('outdated');

    const result = installHook({ cwd: repo });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('updated commit-msg hook');
    expect(readFileSync(hookPath, 'utf8')).toBe(commitMsgStub());
  });

  it('preserves a foreign hook instead of overwriting it', () => {
    const repo = makeRepo();
    const witness = join(repo, 'witness.log');
    const original = readFileSync(foreignHook(repo, witness), 'utf8');

    const result = runCli(repo, ['hooks', 'install']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('previous hook preserved and chained');

    const chainedPath = join(hooksDirOf(repo), CHAINED_HOOK_NAME);
    expect(readFileSync(chainedPath, 'utf8')).toBe(original);
    expect(readFileSync(join(hooksDirOf(repo), 'commit-msg'), 'utf8')).toBe(commitMsgStub());
  });

  it('refuses to clobber an already preserved hook unless forced', () => {
    const repo = makeRepo();
    const witness = join(repo, 'witness.log');
    foreignHook(repo, witness);
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    // A second, different foreign hook appears on top of our stub.
    writeScript(join(hooksDirOf(repo), 'commit-msg'), ['#!/bin/sh', 'exit 0']);

    const refused = runCli(repo, ['hooks', 'install']);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('--force');
    expect(readFileSync(join(hooksDirOf(repo), CHAINED_HOOK_NAME), 'utf8')).toContain('foreign saw');

    const forced = runCli(repo, ['hooks', 'install', '--force']);
    expect(forced.status).toBe(0);
    expect(readFileSync(join(hooksDirOf(repo), CHAINED_HOOK_NAME), 'utf8')).not.toContain('foreign saw');
  });

  it('fails with exit 2 outside a repository', () => {
    const notARepo = makeTemporary('commitlore-not-a-repo-');
    const result = runCli(notARepo, ['hooks', 'install']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not a git repository');
  });
});

describe('hooks install — repository layouts', () => {
  it('resolves the hooks directory from a subdirectory', () => {
    const repo = makeRepo();
    const sub = join(repo, 'src', 'deep');
    mkdirSync(sub, { recursive: true });

    expect(runCli(sub, ['hooks', 'install']).status).toBe(0);
    expect(existsSync(join(hooksDirOf(repo), 'commit-msg'))).toBe(true);
  });

  it('installs into the main repository when .git is a file (linked worktree)', () => {
    const repo = makeRepo();
    stage(repo, 'a.txt');
    gitOrThrow(repo, ['commit', '-q', '--no-verify', '-m', 'base']);
    const worktree = join(makeTemporary('commitlore-worktree-'), 'linked');
    gitOrThrow(repo, ['worktree', 'add', '-q', worktree, '-b', 'feature']);
    expect(readFileSync(join(worktree, '.git'), 'utf8')).toContain('gitdir:');

    expect(runCli(worktree, ['hooks', 'install']).status).toBe(0);
    expect(realpathSync(readHookStatus(worktree).hooksDir)).toBe(realpathSync(hooksDirOf(repo)));
    expect(existsSync(join(hooksDirOf(repo), 'commit-msg'))).toBe(true);
  });
});

describe('hooks — a real commit', () => {
  it('blocks a commit whose message violates the protocol and passes a clean one', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const blocked = commitThroughHooks(repo, 'a.txt', 'Widen the label\n\nBlast: wide\n');
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toContain('enum Blast');
    expect(blocked.output).toContain('local|module|system');
    expect(git(repo, ['rev-list', '--count', '--all']).stdout).toContain('0');

    const accepted = commitThroughHooks(repo, 'a.txt', 'Narrow the label\n\nBlast: local\n');
    expect(accepted.status).toBe(0);
    expect(gitOrThrow(repo, ['log', '-1', '--format=%B'])).toContain('Blast: local');
  });

  it('runs the preserved hook first and still validates', () => {
    const repo = makeRepo();
    const witness = join(repo, 'witness.log');
    foreignHook(repo, witness);
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const blocked = commitThroughHooks(repo, 'a.txt', 'Bad\n\nUndo: clean\n');
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toContain('enum Undo');
    expect(readFileSync(witness, 'utf8')).toContain('foreign saw');

    const accepted = commitThroughHooks(repo, 'a.txt', 'Good\n\nUndo: costly\n');
    expect(accepted.status).toBe(0);
    // Both hooks ran, both times.
    expect(readFileSync(witness, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('aborts with the preserved hook exit code and never reaches validate', () => {
    const repo = makeRepo();
    const witness = join(repo, 'witness.log');
    foreignHook(repo, witness, 3);
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    // A stand-in for the CLI that records having been called.
    const ranMarker = join(repo, 'validate-ran.log');
    const spy = join(repo, 'spy-bin');
    writeScript(spy, ['#!/bin/sh', `echo "$@" >> ${JSON.stringify(ranMarker)}`, 'exit 0']);

    const messageFile = join(repo, 'message.txt');
    writeFileSync(messageFile, 'Subject\n\nBlast: local\n');

    const result = spawnSync(join(hooksDirOf(repo), 'commit-msg'), [messageFile], {
      cwd: repo,
      env: { ...GIT_ENV, COMMITLORE_BIN: spy },
      encoding: 'utf8',
      shell: false,
    });

    expect(result.status).toBe(3);
    expect(readFileSync(witness, 'utf8')).toContain('foreign saw');
    expect(existsSync(ranMarker)).toBe(false);
  });

  it('resolves a locally installed CLI with no COMMITLORE_BIN and no PATH entry', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    // The installer records where it ran from, and that branch now precedes this
    // one. Clearing it is what makes this fallback reachable at all — which is
    // the point: a guessed installation is the last resort, not the first.
    gitOrThrow(repo, ['config', '--local', '--unset', 'commitlore.bin']);

    // What `npm i -D commitlore` leaves behind. The stub must find it without
    // npx, which would query the registry on every commit.
    const binDir = join(repo, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const witness = join(repo, 'local-bin.log');
    writeScript(join(binDir, 'commitlore'), [
      '#!/bin/sh',
      `echo "$@" >> ${JSON.stringify(witness)}`,
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(binPath)} "$@"`,
    ]);

    // Without this the branch under test is unreachable and the assertion below
    // would pass for the wrong reason.
    const env = { PATH: PATH_WITHOUT_COMMITLORE };
    expect(spawnSync('sh', ['-c', 'command -v commitlore'], { env, shell: false }).status).not.toBe(0);

    const blocked = commitThroughHooks(repo, 'a.txt', 'Bad\n\nBlast: wide\n', env);
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toContain('enum Blast');
    expect(readFileSync(witness, 'utf8')).toContain('validate --message-file');
  });

  it('runs a CLI found on PATH when COMMITLORE_BIN is unset', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    gitOrThrow(repo, ['config', '--local', '--unset', 'commitlore.bin']);

    // A global install: on PATH, and nowhere near the repository.
    const pathDir = makeTemporary('commitlore-path-bin-');
    const witness = join(pathDir, 'path-bin.log');
    writeScript(join(pathDir, 'commitlore'), [
      '#!/bin/sh',
      `echo "$@" >> ${JSON.stringify(witness)}`,
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(binPath)} "$@"`,
    ]);

    const env = { PATH: `${pathDir}:${PATH_WITHOUT_COMMITLORE}` };
    expect(spawnSync('sh', ['-c', 'command -v commitlore'], { env, shell: false }).status).toBe(0);
    expect(existsSync(join(repo, 'node_modules'))).toBe(false);

    const blocked = commitThroughHooks(repo, 'a.txt', 'Bad\n\nCertainty: high\n', env);
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toContain('enum Certainty');
    expect(readFileSync(witness, 'utf8')).toContain('validate --message-file');
  });

  /**
   * A stale sibling used to win over the installer's own record. That shim's
   * first line is `exec node`, and a git hook's PATH does not carry node, so the
   * commit died with 127 — in the one environment this resolution chain exists
   * to survive. A stale guess also validates with a different version than the
   * one that installed the hook.
   */
  it('prefers the recorded installation over a sibling node_modules shim', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const binDir = join(repo, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const witness = join(repo, 'shim-was-used.log');
    writeScript(join(binDir, 'commitlore'), [
      '#!/bin/sh',
      `echo used >> ${JSON.stringify(witness)}`,
      'exec node /nonexistent/cli.js "$@"',
    ]);

    const blocked = commitThroughHooks(repo, 'a.txt', 'Bad\n\nBlast: wide\n', {
      PATH: PATH_WITHOUT_COMMITLORE,
    });
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toContain('enum Blast');
    expect(existsSync(witness)).toBe(false);
  });

  it('prefers the recorded installation over one found on PATH', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const pathDir = makeTemporary('commitlore-path-shadow-');
    const witness = join(pathDir, 'path-was-used.log');
    writeScript(join(pathDir, 'commitlore'), [
      '#!/bin/sh',
      `echo used >> ${JSON.stringify(witness)}`,
      'exec node /nonexistent/cli.js "$@"',
    ]);

    const blocked = commitThroughHooks(repo, 'a.txt', 'Bad\n\nCertainty: high\n', {
      PATH: `${pathDir}:${PATH_WITHOUT_COMMITLORE}`,
    });
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toContain('enum Certainty');
    expect(existsSync(witness)).toBe(false);
  });

  it('does not execute a recorded shell script and falls through to validation', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const witness = join(repo, 'recorded-shell-ran.log');
    const recorded = join(repo, 'recorded-shell');
    writeScript(recorded, [
      '#!/bin/sh',
      `echo used >> ${JSON.stringify(witness)}`,
      'exit 0',
    ]);
    gitOrThrow(repo, ['config', '--local', 'commitlore.bin', recorded]);

    const pathDir = makeTemporary('commitlore-recorded-shell-fallback-');
    writeScript(join(pathDir, 'commitlore'), [
      '#!/bin/sh',
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(binPath)} "$@"`,
    ]);

    const blocked = commitThroughHooks(repo, 'a.txt', 'Bad\n\nConstraint: value\n', {
      PATH: `${pathDir}:${PATH_WITHOUT_COMMITLORE}`,
    });
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toContain('unknown-key');
    expect(existsSync(witness)).toBe(false);
  });

  it('does not execute recorded JavaScript without the recorded interpreter', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const witness = join(repo, 'recorded-javascript-ran.log');
    const recorded = join(repo, 'recorded.mjs');
    writeFileSync(
      recorded,
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(witness)}, 'used');\n`,
    );
    gitOrThrow(repo, ['config', '--local', 'commitlore.bin', recorded]);
    gitOrThrow(repo, ['config', '--local', '--unset', 'commitlore.node']);

    const pathDir = makeTemporary('commitlore-recorded-javascript-fallback-');
    writeScript(join(pathDir, 'commitlore'), [
      '#!/bin/sh',
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(binPath)} "$@"`,
    ]);

    const blocked = commitThroughHooks(repo, 'a.txt', 'Bad\n\nConstraint: value\n', {
      PATH: `${pathDir}:${PATH_WITHOUT_COMMITLORE}`,
    });
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toContain('unknown-key');
    expect(existsSync(witness)).toBe(false);
  });

  it('still lets COMMITLORE_BIN override the recorded installation', () => {
    // The escape hatch has to outrank the record, or a harness cannot point the
    // hook at the build it is testing. Named `.mjs`: COMMITLORE_BIN carries the
    // same extension allowlist as the recorded path (#71), so the override
    // itself has to satisfy it too — the shell only cares about the filename,
    // not that the script's own body happens to be `#!/bin/sh`.
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const dir = makeTemporary('commitlore-override-');
    const witness = join(dir, 'override.log');
    const spy = join(dir, 'commitlore-spy.mjs');
    writeScript(spy, [
      '#!/bin/sh',
      `echo "$@" >> ${JSON.stringify(witness)}`,
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(binPath)} "$@"`,
    ]);

    const blocked = commitThroughHooks(repo, 'a.txt', 'Bad\n\nBlast: wide\n', {
      PATH: PATH_WITHOUT_COMMITLORE,
      COMMITLORE_BIN: spy,
    });
    expect(blocked.status).not.toBe(0);
    expect(readFileSync(witness, 'utf8')).toContain('validate --message-file');
  });

  /**
   * #71: `exec "$COMMITLORE_BIN"` ran anything the environment pointed at — a
   * `.sh` payload included — because the branch carried none of the checks the
   * recorded-path branch already had. An env var is reachable from CI
   * configuration, a sourced profile, or a compromised toolchain, none of
   * which a reviewer reads as executable config.
   */
  it('does not execute a COMMITLORE_BIN that is not a .js or .mjs file', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const dir = makeTemporary('commitlore-bad-ext-');
    const witness = join(dir, 'ran.log');
    const evil = join(dir, 'evil.sh');
    writeScript(evil, ['#!/bin/sh', `echo ran >> ${JSON.stringify(witness)}`, 'exit 0']);

    // The recorded installation is still healthy, so a rejected override falls
    // through to it rather than the commit failing outright — proof that the
    // extension check is what stopped `evil.sh`, not an unrelated failure.
    const blocked = commitThroughHooks(repo, 'a.txt', 'Bad\n\nBlast: wide\n', {
      COMMITLORE_BIN: evil,
    });
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toContain('enum Blast');
    expect(existsSync(witness)).toBe(false);
  });

  /**
   * #71: a `.git/config` edit made after `hooks install` — `git config
   * commitlore.bin /tmp/evil.js` — passed the extension check the recorded
   * path already had, because naming a file `.js` costs an attacker nothing.
   * The recorded install root is what an out-of-tree payload cannot fake.
   */
  it('does not execute a recorded commitlore.bin outside the install root, even with a valid extension', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    const recordedNode = gitOrThrow(repo, ['config', '--local', '--get', 'commitlore.node']).trim();

    const outside = makeTemporary('commitlore-outside-root-');
    const witness = join(outside, 'ran.log');
    const evil = join(outside, 'evil.js');
    writeFileSync(
      evil,
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(witness)}, 'ran');\n`,
    );
    gitOrThrow(repo, ['config', '--local', 'commitlore.bin', evil]);
    // The interpreter is left exactly as `hooks install` recorded it — a real,
    // legitimate node — so the only thing standing between this and execution
    // is the root check.
    expect(gitOrThrow(repo, ['config', '--local', '--get', 'commitlore.node']).trim()).toBe(recordedNode);

    // Nothing else can resolve the CLI: the point is that this fails closed
    // rather than silently falling back to something that happens to work.
    const result = commitThroughHooks(repo, 'a.txt', 'Bad\n\nBlast: local\n', {
      PATH: PATH_WITHOUT_COMMITLORE,
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('cannot find the CLI');
    expect(existsSync(witness)).toBe(false);
  });

  /**
   * #71's second attack, never exercised end to end before this test: a
   * symlink whose own path is literally inside the install root — a
   * directory-prefix check on that path alone would call it "inside" — but
   * that resolves to a target outside it. The stub's `[ ! -L "$recorded" ]`
   * exists precisely to reject the leaf being a symlink before any prefix or
   * equality comparison runs, and `readRecordedHookTarget`'s `doctor` mirror
   * makes the same call by resolving through `realpathSync` before
   * comparing. The symlink has to sit inside this suite's own `PACKAGE_ROOT`
   * (the recorded root every install in this file gets, `paths.ts`'s live
   * package root) to test the "inside" half of that claim at all, so it is
   * removed in a `finally` regardless of outcome.
   */
  it('does not execute a commitlore.bin that is a symlink inside the install root pointing outside it', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const outside = makeTemporary('commitlore-symlink-target-');
    const witness = join(outside, 'ran.log');
    const evil = join(outside, 'evil.js');
    writeFileSync(
      evil,
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(witness)}, 'ran');\n`,
    );

    const symlinkPath = join(PACKAGE_ROOT, `commitlore-hooktest-symlink-${String(process.pid)}.mjs`);
    symlinkSync(evil, symlinkPath);
    try {
      gitOrThrow(repo, ['config', '--local', 'commitlore.bin', symlinkPath]);

      const result = commitThroughHooks(repo, 'a.txt', 'Bad\n\nBlast: local\n', {
        PATH: PATH_WITHOUT_COMMITLORE,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('cannot find the CLI');
      expect(existsSync(witness)).toBe(false);
    } finally {
      rmSync(symlinkPath, { force: true });
    }
  });

  it('still executes a recorded commitlore.bin that stayed inside the install root', () => {
    // The containment check must not turn into a second, redundant reason for
    // the ordinary, untampered installation to stop working.
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const blocked = commitThroughHooks(repo, 'a.txt', 'Bad\n\nBlast: wide\n', {
      PATH: PATH_WITHOUT_COMMITLORE,
    });
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toContain('enum Blast');

    const accepted = commitThroughHooks(repo, 'a.txt', 'Good\n\nBlast: local\n', {
      PATH: PATH_WITHOUT_COMMITLORE,
    });
    expect(accepted.status).toBe(0);
  });

  /**
   * An entry point with no extension whose basename is `commitlore` -- the name
   * the installer's wrapper carries. `classifyBinTarget` no longer keys on it
   * (ADR-0026 removed the compiled build it stood for), so these cases assert that
   * the name buys no trust: nothing is exec'd on the strength of it, and #71's
   * containment still refuses a path outside the install root.
   */
  describe('an extensionless entry point', () => {
    it('records the path but the stub refuses to exec it by name', () => {
      // Recording asks whether the path exists (#296); trusting asks whether it
      // names an interpreter. This file passes the first question and fails the
      // second, which is the whole of the change: with no compiled artifact left,
      // an extensionless `commitlore` is the installer's wrapper -- a shell script
      // that execs node -- and the path worth trusting is the bundle it runs.
      const repo = makeRepo();
      expect(runBinaryCli(repo, ['hooks', 'install']).status).toBe(0);

      expect(gitOrThrow(repo, ['config', '--local', '--get', 'commitlore.bin']).trim()).toBe(
        binaryLikePath,
      );

      // With commitlore off PATH there is nothing left to fall through to, so the
      // hook says so instead of running the recorded file. Before the compiled arm
      // was removed this same setup validated the message.
      const result = commitThroughHooks(repo, 'a.txt', 'Bad\n\nBlast: wide\n', {
        PATH: PATH_WITHOUT_COMMITLORE,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('cannot find the CLI');
    });

    it('does not execute an extensionless commitlore.bin outside the install root', () => {
      // #71's containment, still enforced. This assertion passed before the
      // removal and passes after it: the property is not carried by the arm that
      // went away.
      const repo = makeRepo();
      expect(runBinaryCli(repo, ['hooks', 'install']).status).toBe(0);

      const outside = makeTemporary('commitlore-binary-outside-root-');
      const witness = join(outside, 'ran.log');
      const evil = join(outside, 'commitlore');
      writeScript(evil, ['#!/bin/sh', `echo ran >> ${JSON.stringify(witness)}`, 'exit 0']);
      gitOrThrow(repo, ['config', '--local', 'commitlore.bin', evil]);

      const result = commitThroughHooks(repo, 'a.txt', 'Bad\n\nBlast: local\n', {
        PATH: PATH_WITHOUT_COMMITLORE,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('cannot find the CLI');
      expect(existsSync(witness)).toBe(false);
    });

    it('does not execute an extensionless commitlore.bin that is a symlink inside the install root pointing outside it', () => {
      const repo = makeRepo();
      expect(runBinaryCli(repo, ['hooks', 'install']).status).toBe(0);

      const outside = makeTemporary('commitlore-binary-symlink-target-');
      const witness = join(outside, 'ran.log');
      const evil = join(outside, 'commitlore');
      writeScript(evil, ['#!/bin/sh', `echo ran >> ${JSON.stringify(witness)}`, 'exit 0']);

      const symlinkPath = join(PACKAGE_ROOT, `commitlore-hooktest-binary-symlink-${String(process.pid)}`);
      symlinkSync(evil, symlinkPath);
      try {
        gitOrThrow(repo, ['config', '--local', 'commitlore.bin', symlinkPath]);

        const result = commitThroughHooks(repo, 'a.txt', 'Bad\n\nBlast: local\n', {
          PATH: PATH_WITHOUT_COMMITLORE,
        });
        expect(result.status).not.toBe(0);
        expect(result.output).toContain('cannot find the CLI');
        expect(existsSync(witness)).toBe(false);
      } finally {
        rmSync(symlinkPath, { force: true });
      }
    });

    it('does not honour a COMMITLORE_BIN with no extension, even named commitlore', () => {
      // This assertion is inverted. The override used to be honoured for this name
      // with no containment requirement at all, which was defensible only while an
      // extensionless `commitlore` meant a compiled artifact. It now falls through
      // to the recorded script install, so the commit is still validated -- by the
      // trusted path, and the spy is never run.
      const repo = makeRepo();
      expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

      const dir = makeTemporary('commitlore-binary-override-');
      const witness = join(dir, 'override.log');
      const spy = join(dir, 'commitlore');
      writeScript(spy, [
        '#!/bin/sh',
        `echo "$@" >> ${JSON.stringify(witness)}`,
        `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(binPath)} "$@"`,
      ]);

      const blocked = commitThroughHooks(repo, 'a.txt', 'Bad\n\nBlast: wide\n', {
        COMMITLORE_BIN: spy,
      });
      expect(blocked.status).not.toBe(0);
      expect(blocked.output).toContain('enum Blast');
      expect(existsSync(witness)).toBe(false);
    });

    it('does not execute a COMMITLORE_BIN with no extension that is not named commitlore', () => {
      // Kept as the neighbouring case: the allowlist is now an extension check
      // alone, so this name and the one above are refused for the same reason
      // rather than for two different ones.
      const repo = makeRepo();
      expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

      const dir = makeTemporary('commitlore-binary-bad-name-');
      const witness = join(dir, 'ran.log');
      const evil = join(dir, 'not-commitlore');
      writeScript(evil, ['#!/bin/sh', `echo ran >> ${JSON.stringify(witness)}`, 'exit 0']);

      const blocked = commitThroughHooks(repo, 'a.txt', 'Bad\n\nBlast: wide\n', {
        COMMITLORE_BIN: evil,
      });
      expect(blocked.status).not.toBe(0);
      expect(blocked.output).toContain('enum Blast');
      expect(existsSync(witness)).toBe(false);
    });
  });

  it('fails loudly rather than passing when no CLI can be found', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    const messageFile = join(repo, 'message.txt');
    writeFileSync(messageFile, 'Subject\n\nBlast: local\n');

    const result = spawnSync(join(hooksDirOf(repo), 'commit-msg'), [messageFile], {
      cwd: repo,
      env: { ...GIT_ENV, PATH: '/nonexistent', COMMITLORE_BIN: '' },
      encoding: 'utf8',
      shell: false,
    });
    expect(result.status).toBe(1);
    expect(String(result.stderr)).toContain('commitlore: cannot find the CLI');
  });

  it('skips a preserved hook that git itself would not run', () => {
    const repo = makeRepo();
    const witness = join(repo, 'witness.log');
    foreignHook(repo, witness, 3);
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    // git only runs executable hooks, so an inert one must stay inert.
    chmodSync(join(hooksDirOf(repo), CHAINED_HOOK_NAME), 0o644);

    const accepted = commitThroughHooks(repo, 'a.txt', 'Fine\n\nBlast: local\n');
    expect(accepted.status).toBe(0);
    expect(existsSync(witness)).toBe(false);
  });
});

describe('prepare-commit-msg — local squash preservation', () => {
  it('preserves one squashed record while retaining the user subject and body', () => {
    const repo = makeRepo();
    squashFeature(repo, ['Feature record\n\nLimit: one\nRecord-Id: r-squash01\n']);
    runInit({ cwd: repo });

    const committed = commitSquashThroughHooks(repo, 'Squash feature\n\nUser body stays.\n');

    expect(committed.status).toBe(0);
    expect(gitOrThrow(repo, ['log', '-1', '--format=%B'])).toBe(
      'Squash feature\n\nUser body stays.\n\nLimit: one\nRecord-Id: r-squash01\n\n',
    );
  });

  it('preserves both records from three squashed commits without merging them', () => {
    const repo = makeRepo();
    squashFeature(repo, [
      'First record\n\nLimit: first\nRecord-Id: r-squash02\n',
      'Middle without a record\n',
      'Third record\n\nWarn: third\nRecord-Id: r-squash03\n',
    ]);
    runInit({ cwd: repo });

    expect(commitSquashThroughHooks(repo, 'Squash three\n').status).toBe(0);
    const message = gitOrThrow(repo, ['log', '-1', '--format=%B']);
    expect(message).toContain('Limit: first\nRecord-Id: r-squash02\n');
    expect(message).toContain('Warn: third\nRecord-Id: r-squash03\n');
    expect(message).not.toContain('Middle without a record');
  });

  it('does not append a squash record when the composed message already has one', () => {
    const repo = makeRepo();
    squashFeature(repo, ['Feature record\n\nLimit: inherited\nRecord-Id: r-squash04\n']);
    runInit({ cwd: repo });

    expect(
      commitSquashThroughHooks(repo, 'Squash feature\n\nLimit: authored\nRecord-Id: r-user0001\n').status,
    ).toBe(0);
    const message = gitOrThrow(repo, ['log', '-1', '--format=%B']);
    expect(message).toContain('Record-Id: r-user0001');
    expect(message).not.toContain('Record-Id: r-squash04');
  });

  it('makes init idempotent for the prepare hook', () => {
    const repo = makeRepo();
    const first = runInit({ cwd: repo });
    const hookPath = join(hooksDirOf(repo), PREPARE_COMMIT_MSG_HOOK_NAME);
    const bytes = readFileSync(hookPath, 'utf8');
    const second = runInit({ cwd: repo });

    expect(first.steps.find((step) => step.step === 'hooks')?.code).toBe(0);
    expect(second.steps.find((step) => step.step === 'hooks')?.lines.join('\n')).toContain('already installed');
    expect(readFileSync(hookPath, 'utf8')).toBe(bytes);
    expect(bytes).toBe(prepareCommitMsgStub());
  });

  it('makes init refuse to clobber a foreign prepare hook', () => {
    const repo = makeRepo();
    const hookPath = join(hooksDirOf(repo), PREPARE_COMMIT_MSG_HOOK_NAME);
    mkdirSync(hooksDirOf(repo), { recursive: true });
    writeScript(hookPath, ['#!/bin/sh', 'exit 0']);
    const original = readFileSync(hookPath, 'utf8');

    const report = runInit({ cwd: repo });

    expect(report.steps.find((step) => step.step === 'hooks')?.code).toBe(2);
    expect(report.steps.find((step) => step.step === 'hooks')?.lines.join('\n')).toContain('left in place');
    expect(readFileSync(hookPath, 'utf8')).toBe(original);
  });
});

describe('hooks uninstall', () => {
  it('removes our stub and restores the hook it replaced', () => {
    const repo = makeRepo();
    const witness = join(repo, 'witness.log');
    const original = readFileSync(foreignHook(repo, witness), 'utf8');
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const result = runCli(repo, ['hooks', 'uninstall']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('restored the previous hook');

    const hookPath = join(hooksDirOf(repo), 'commit-msg');
    expect(readFileSync(hookPath, 'utf8')).toBe(original);
    expect(existsSync(join(hooksDirOf(repo), CHAINED_HOOK_NAME))).toBe(false);
    expect(readHookStatus(repo).state).toBe('foreign');

    // The restored hook still runs, and nothing validates any more.
    const accepted = commitThroughHooks(repo, 'a.txt', 'Bad but unguarded\n\nBlast: wide\n');
    expect(accepted.status).toBe(0);
    expect(readFileSync(witness, 'utf8')).toContain('foreign saw');
  });

  it('removes our stub with nothing to restore', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const result = runCli(repo, ['hooks', 'uninstall']);
    expect(result.status).toBe(0);
    expect(existsSync(join(hooksDirOf(repo), 'commit-msg'))).toBe(false);
    expect(readHookStatus(repo).state).toBe('absent');
  });

  it('leaves a hook it did not install alone', () => {
    const repo = makeRepo();
    const witness = join(repo, 'witness.log');
    const original = readFileSync(foreignHook(repo, witness), 'utf8');

    const result = uninstallHook({ cwd: repo });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('was not installed by commitlore');
    expect(readFileSync(join(hooksDirOf(repo), 'commit-msg'), 'utf8')).toBe(original);
  });

  it('is a no-op when nothing is installed', () => {
    const repo = makeRepo();
    const result = runCli(repo, ['hooks', 'uninstall']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no commit-msg hook to remove');
  });

  /**
   * #354. `init` installs three hooks and this is the only command that removes
   * any of them, so whatever it leaves behind has no removal path at all.
   */
  it('leaves no commitlore hook behind after init installed three', () => {
    const repo = makeRepo();
    const installed = [HOOK_NAME, PREPARE_COMMIT_MSG_HOOK_NAME, POST_COMMIT_HOOK_NAME];
    expect(runInit({ cwd: repo }).steps.find((step) => step.step === 'hooks')?.code).toBe(0);
    expect(installed.filter((name) => existsSync(join(hooksDirOf(repo), name)))).toEqual(installed);

    const result = runCli(repo, ['hooks', 'uninstall']);

    expect(result.status).toBe(0);
    expect(installed.filter((name) => existsSync(join(hooksDirOf(repo), name)))).toEqual([]);
  });
});

/**
 * #354. Only `commit-msg` decides whether a record is valid, so it is the only
 * hook with something to refuse. The other two are derived from its text and
 * inherited the refusal with it: a repository whose CLI has moved could not
 * accept a commit, over two hooks that had no verdict to deliver.
 */
describe('hooks that are not the validation gate fail open', () => {
  const unreachableCli = (repo: string): void => {
    // The stub's four resolution routes, closed in order: the env var, the
    // recorded install, PATH (GIT_ENV already strips it), and a node_modules
    // walk that finds nothing above a temporary directory.
    git(repo, ['config', '--local', '--unset-all', 'commitlore.bin']);
    git(repo, ['config', '--local', '--unset-all', 'commitlore.node']);
  };

  it('lets a commit land when the CLI they were installed with is gone', () => {
    const repo = makeRepo();
    expect(runInit({ cwd: repo }).steps.find((step) => step.step === 'hooks')?.code).toBe(0);
    // The gate is removed rather than disabled, so the two capture hooks answer
    // for themselves — this is the state `hooks uninstall` used to leave behind.
    unlinkSync(join(hooksDirOf(repo), HOOK_NAME));
    unreachableCli(repo);

    const committed = commitThroughHooks(repo, 'a.txt', 'Fine\n\nBlast: local\n', { COMMITLORE_BIN: '' });

    expect(committed.status, committed.output).toBe(0);
    expect(gitOrThrow(repo, ['log', '--oneline'])).toContain('Fine');
  });

  it('reports the missing CLI and exits 0 from each of them', () => {
    const repo = makeRepo();
    expect(runInit({ cwd: repo }).steps.find((step) => step.step === 'hooks')?.code).toBe(0);
    const messageFile = join(repo, 'message.txt');
    writeFileSync(messageFile, 'Subject\n\nBlast: local\n');

    for (const name of [PREPARE_COMMIT_MSG_HOOK_NAME, POST_COMMIT_HOOK_NAME]) {
      // `git config` is unreachable too, so the recorded install resolves empty.
      const result = spawnSync(join(hooksDirOf(repo), name), [messageFile], {
        cwd: repo,
        env: { ...GIT_ENV, PATH: '/nonexistent', COMMITLORE_BIN: '' },
        encoding: 'utf8',
        shell: false,
      });
      expect(result.status, `${name}: ${String(result.stderr)}`).toBe(0);
      expect(String(result.stderr)).toContain('commitlore: cannot find the CLI');
    }
  });

  /**
   * #543. The CLI now exits 3/4 when capture breaks. That honesty must not
   * travel through the hook into git: aborting a commit because the recorder
   * failed is worse than the silence being fixed. This is a separate decision
   * from the CLI's, and the test is meant to break loudly if someone "fixes"
   * the wrapper by propagating the new codes.
   */
  it('the TypeScript capture wrappers never assign an exit code', () => {
    const previous = process.exitCode;
    process.exitCode = 0;
    captureHookFailOpen('capture application error', new Error('pipeline broke'));
    expect(process.exitCode).toBe(0);
    process.exitCode = previous;

    const src = (name: string): string =>
      readFileSync(join(PACKAGE_ROOT, 'src', 'hooks', name), 'utf8');
    const failOpen = src('capture-fail-open.ts');
    const failOpenBody = failOpen.slice(failOpen.indexOf('export const captureHookFailOpen'));
    expect(failOpenBody).not.toMatch(/process\.exitCode/);
    expect(failOpenBody).not.toMatch(/process\.exit\(/);

    for (const name of ['prepare-commit-msg.ts', 'post-commit.ts']) {
      const action = src(name).slice(src(name).indexOf('export const register'));
      expect(action, name).toContain('captureHookFailOpen');
      expect(action, name).not.toMatch(/process\.exitCode/);
      expect(action, name).not.toMatch(/process\.exit\(/);
    }
  });

  it('the installed capture stub still ends in exit 0, not the gate\'s exit 1', () => {
    const stub = captureHookStub();
    const last = stub.trim().split('\n').at(-1);
    expect(last).toBe('exit 0');
    expect(stub).toContain('the commit was not blocked');
    expect(commitMsgStub().trim().split('\n').at(-1)).toBe('exit 1');
  });
});

describe('hooks status', () => {
  it('reports each state', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'status']).stdout).toContain('commit-msg: not installed');

    runCli(repo, ['hooks', 'install']);
    const installed = runCli(repo, ['hooks', 'status']);
    expect(installed.status).toBe(0);
    expect(installed.stdout).toContain('commit-msg: installed (commitlore)');
    expect(installed.stdout).toContain(hooksDirOf(repo));

    runCli(repo, ['hooks', 'uninstall']);
    writeScript(join(hooksDirOf(repo), 'commit-msg'), ['#!/bin/sh', 'exit 0']);
    expect(runCli(repo, ['hooks', 'status']).stdout).toContain('not installed by commitlore');
  });

  it('reports the recorded bin and node for a healthy installation', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const status = runCli(repo, ['hooks', 'status']);
    expect(status.stdout).toContain(`commitlore.bin: ${binPath}`);
    expect(status.stdout).toContain(`commitlore.node: ${process.execPath}`);
    expect(status.stdout).not.toContain('recorded target warning');
  });

  it('warns when a byte-current hook records a CLI outside its package root', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    const outside = join(repo, 'outside.mjs');
    writeFileSync(outside, 'process.exit(0);\n');
    gitOrThrow(repo, ['config', '--local', 'commitlore.bin', outside]);

    const status = runCli(repo, ['hooks', 'status']);
    expect(status.stdout).toContain('recorded target warning');
    expect(status.stdout).toContain(`commitlore.bin: ${outside}`);
    expect(status.stdout).toContain(`commitlore.node: ${process.execPath}`);
  });

  it('warns when the recorded CLI does not exist', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    const missing = join(repo, 'missing.mjs');
    gitOrThrow(repo, ['config', '--local', 'commitlore.bin', missing]);

    const status = runCli(repo, ['hooks', 'status']);
    expect(status.stdout).toContain('recorded target warning');
    expect(status.stdout).toContain(`commitlore.bin: ${missing}`);
    expect(status.stdout).toContain('commitlore.bin does not exist');
  });

  it('warns when the recorded interpreter differs from the running CLI interpreter', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    gitOrThrow(repo, ['config', '--local', 'commitlore.node', '/bin/sh']);

    const status = runCli(repo, ['hooks', 'status']);
    expect(status.stdout).toContain('recorded target warning');
    expect(status.stdout).toContain('commitlore.node: /bin/sh');
  });

  it('names the preserved hook', () => {
    const repo = makeRepo();
    foreignHook(repo, join(repo, 'witness.log'));
    runCli(repo, ['hooks', 'install']);
    expect(runCli(repo, ['hooks', 'status']).stdout).toContain(CHAINED_HOOK_NAME);
  });

  /**
   * #382: an upgrade installs a new CLI somewhere else and leaves every
   * repository's `commitlore.bin`/`commitlore.root` pointing at the old one.
   * `hooks status` printed that path and called the installation healthy, so
   * the only way to notice was to read the version number out of the path.
   *
   * The fixture is a second package root, which is what the upgrade leaves on
   * disk: its own `package.json`, its own version, still pinned.
   */
  const otherInstall = (version: string | null): string => {
    const root = makeTemporary('commitlore-otherinstall-');
    if (version !== null) {
      writeFileSync(
        join(root, 'package.json'),
        `${JSON.stringify({ name: 'commitlore', version, type: 'module' }, null, 2)}\n`,
      );
    }
    mkdirSync(join(root, 'dist'), { recursive: true });
    const bin = join(root, 'dist', 'commitlore.mjs');
    writeFileSync(bin, 'export {};\n');
    return bin;
  };

  const pinTo = (repo: string, bin: string): void => {
    gitOrThrow(repo, ['config', '--local', 'commitlore.bin', bin]);
    gitOrThrow(repo, ['config', '--local', 'commitlore.root', realpathSync(dirname(dirname(bin)))]);
  };

  it('warns when the pinned CLI is a different version than the one running', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    pinTo(repo, otherInstall('0.5.0'));

    const status = runCli(repo, ['hooks', 'status']);
    expect(status.stdout).toContain('recorded target warning');
    expect(status.stdout).toContain('0.5.0');
    expect(status.stdout).toContain('hooks install');
  });

  it('does not call the installation healthy when the pinned version cannot be determined', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    pinTo(repo, otherInstall(null));

    const status = runCli(repo, ['hooks', 'status']);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain('recorded target warning');
    expect(status.stdout).toContain('version');
  });
});

describe('validate — exit codes through the built binary', () => {
  it('exits 0 on a clean message from stdin', () => {
    const result = runCli(PACKAGE_ROOT, ['validate'], {}, 'Subject\n\nBlast: local\n');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('shape ok · references not checked (no repository)\n');
  });

  it('exits 1 on a violation and prints it', () => {
    const result = runCli(PACKAGE_ROOT, ['validate'], {}, 'Subject\n\nBlast: wide\n');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      'shape failed · references not checked (no repository)\n' +
        '3: enum Blast — got "wide", want "local|module|system"\n',
    );
    expect(result.stderr).toContain('1 violation');
  });

  it('exits 1 with JSON on stdout only', () => {
    const result = runCli(PACKAGE_ROOT, ['validate', '--json'], {}, 'Subject\n\nBlast: wide\n');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      // The count of messages read. Without it an empty range is
      // indistinguishable from a clean one, so the gate requires it (r-4f8d13).
      examined: 1,
      checks: [
        { class: 'shape', status: 'failed' },
        { class: 'reference', status: 'not-checked', reason: 'no repository' },
      ],
      violations: [
        { line: 3, key: 'Blast', value: 'wide', rule: 'enum', got: 'wide', want: 'local|module|system' },
      ],
      // `validate` also scans for credentials (ADR-0005), so the repair-loop
      // payload carries both lists and a consumer must not assume one key.
      secrets: [],
    });
    expect(result.stderr).toBe('');
  });

  it('exits 2 when input modes are combined', () => {
    const result = runCli(PACKAGE_ROOT, ['validate', '--commit', 'HEAD', '--range', 'a..b']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mutually exclusive');
  });

  it('exits 2 on an unreadable message file', () => {
    const result = runCli(PACKAGE_ROOT, ['validate', '--message-file', 'no/such/file.txt']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('commitlore:');
  });
});

/**
 * Found by installing gradelore through the repo-factory skill: `hooks install`
 * reported success and the very first commit in the new repository failed,
 * because the hook looked only where a package manager would have put the CLI —
 * PATH, then a `node_modules` walk. Since ADR-0011 a clone is a complete
 * installation and is neither, so the installer records where it ran from and
 * the hook reads it back.
 */
describe('finding the CLI that installed it', () => {
  it('records the installing entry point in local git config', () => {
    const repo = makeRepo();
    runCli(repo, ['hooks', 'install']);
    const recorded = gitOrThrow(repo, ['config', '--local', '--get', 'commitlore.bin']).trim();
    expect(recorded).not.toBe('');
    expect(existsSync(recorded)).toBe(true);
  });

  it('commits with no COMMITLORE_BIN, nothing on PATH and no node_modules', () => {
    const repo = makeRepo();
    runCli(repo, ['hooks', 'install']);
    const result = commitThroughHooks(
      repo,
      'a.txt',
      'Subject\n\nBlast: local\nRecord-Id: r-hook01\n',
      { PATH: '/usr/bin:/bin' },
    );
    expect(result.output).not.toMatch(/cannot find the CLI/);
    expect(result.status).toBe(0);
  });

  it('still rejects a bad record when it resolved through the recorded path', () => {
    const repo = makeRepo();
    runCli(repo, ['hooks', 'install']);
    const result = commitThroughHooks(repo, 'b.txt', 'Subject\n\nBlast: wide\n', {
      PATH: '/usr/bin:/bin',
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/enum Blast/);
  });

  it('keeps the stub byte-identical wherever it was installed from', () => {
    // Otherwise `hooks status` calls every hook installed from another checkout
    // `outdated`, which is why the path lives in config and not in the stub.
    const a = makeRepo();
    const b = makeRepo();
    runCli(a, ['hooks', 'install']);
    runCli(b, ['hooks', 'install']);
    expect(readFileSync(join(a, '.git', 'hooks', 'commit-msg'), 'utf8')).toBe(
      readFileSync(join(b, '.git', 'hooks', 'commit-msg'), 'utf8'),
    );
  });
});

describe('test hygiene', () => {
  it('leaves this repository’s own hooks directory byte-for-byte untouched', () => {
    // Not "no hook is installed" — this repository is expected to have one, and
    // a contributor installing it is the point. The guard is that this suite
    // changes nothing: same names, same modes, same bytes.
    expect(snapshotOwnHooks()).toBe(ownHooksBefore);
  });
});

/**
 * T-1127 (#321): the Windows measurement in T-1124 found two defects that are
 * not Windows-specific in kind, only in trigger. Both are reproduced here on a
 * POSIX host so the fix has a fast gate; the platform gate is #320's job on
 * `windows-latest`.
 */
describe('T-1127 the recorded path is compared as a location, not as a string', () => {
  /**
   * Measured on `windows-latest`: `commitlore.root` is written by node as
   * `C:\...` and the stub reads it back under Git for Windows' `sh`, where
   * `pwd -P` answers `/c/...`. The two never match, so the *legitimate* bundle
   * is never executed either.
   *
   * The same class of mismatch is reachable on POSIX without inventing a second
   * path world: record a root that names the same directory in a form
   * `pwd -P` would not produce. A comparison that resolves both sides accepts
   * it; a comparison that compares stored text against resolved text does not.
   */
  it('runs the recorded bundle when the recorded root names the same directory another way', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);

    const root = gitOrThrow(repo, ['config', '--local', '--get', 'commitlore.root']).trim();
    expect(root.length).toBeGreaterThan(0);
    // Same directory, spelled so that `pwd -P` would never emit it.
    gitOrThrow(repo, ['config', '--local', 'commitlore.root', `${root}/./`]);

    const accepted = commitThroughHooks(repo, 'a.txt', 'Good\n\nLimit: a real condition\nRecord-Id: r-t1127a\n', {});
    expect(accepted.output).not.toContain('cannot find the CLI');
    expect(accepted.status).toBe(0);
  });

  it('still refuses a recorded bundle outside the root when the root is spelled that way', () => {
    // The point of the fix is to resolve both sides, not to stop comparing.
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    const root = gitOrThrow(repo, ['config', '--local', '--get', 'commitlore.root']).trim();
    gitOrThrow(repo, ['config', '--local', 'commitlore.root', `${root}/./`]);

    const outside = makeTemporary('commitlore-t1127-outside-');
    const witness = join(outside, 'ran.log');
    const evil = join(outside, 'evil.js');
    writeFileSync(
      evil,
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(witness)}, 'ran');\n`,
    );
    gitOrThrow(repo, ['config', '--local', 'commitlore.bin', evil]);

    commitThroughHooks(repo, 'b.txt', 'Good\n\nLimit: a real condition\nRecord-Id: r-t1127b\n', {});
    expect(existsSync(witness)).toBe(false);
  });
});

describe('T-1127 the node_modules walk terminates on every root shape', () => {
  /**
   * Measured on `windows-latest`, from a probe hook: `$PWD` inside a hook is
   * `C:/Users/...`, and `${dir%/*}` returns its input unchanged once no `/`
   * remains. The walk settles on `C:` and never leaves it, which is why a real
   * commit did not return.
   *
   * The shipped stub text is executed here rather than a paraphrase of it, so
   * this cannot pass against a fix that was only made in a comment.
   */
  const walkOf = (): string => {
    const stub = commitMsgStub();
    const start = stub.indexOf('dir=$PWD');
    const end = stub.indexOf('done', start);
    expect(start, 'the stub no longer contains the walk this test measures').toBeGreaterThan(-1);
    return stub.slice(start, end + 'done'.length);
  };

  it.each([
    ['a drive-letter root', 'C:/Users/runneradmin/AppData/Local/Temp/x/repo'],
    ['a bare drive letter', 'C:'],
    ['a posix root', '/tmp/x/repo'],
    ['a relative path', 'x/repo'],
  ])('terminates from %s', (_label, pwd) => {
    const script = `set -u\nPWD=${JSON.stringify(pwd)}\n${walkOf()}\necho terminated\n`;
    const result = spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8', timeout: 10_000 });
    expect(result.error?.message ?? '', `the walk did not return from ${pwd}`).not.toContain('ETIMEDOUT');
    expect(result.signal, `the walk had to be killed from ${pwd}`).toBeNull();
    expect(result.stdout).toContain('terminated');
  });
});

/**
 * T-1127 (#321) condition 6: a repository wedged by the old stub cannot commit
 * at all, so "the next release fixes it" is not a recovery path for anyone
 * already affected. What actually repairs such a repository is established here
 * rather than asserted in a release note.
 */
describe('T-1127 an already-installed repository has a recovery path', () => {
  it('reports the old stub as outdated and repairs it with hooks install', () => {
    const repo = makeRepo();
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    const hookPath = join(repo, '.git', 'hooks', 'commit-msg');

    // The shape of the problem: installing a corrected CLI does not reach into
    // repositories that already have a stub on disk. Standing in for one here.
    const current = readFileSync(hookPath, 'utf8');
    writeFileSync(hookPath, current.replace('parent=${dir%/*}', 'dir=${dir%/*} # old'), {
      mode: 0o755,
    });
    expect(readFileSync(hookPath, 'utf8')).not.toBe(commitMsgStub());
    expect(readHookStatus(repo).state).toBe('outdated');

    // `hooks install` is not a commit, so it still runs in a repository whose
    // commits are blocked -- which is what makes it a usable recovery path.
    expect(runCli(repo, ['hooks', 'install']).status).toBe(0);
    expect(readFileSync(hookPath, 'utf8')).toBe(commitMsgStub());
    expect(readHookStatus(repo).state).toBe('installed');

    const after = commitThroughHooks(repo, 'r.txt', 'Good\n\nLimit: a real condition\nRecord-Id: r-t1127r\n', {});
    expect(after.status).toBe(0);
  });
});
