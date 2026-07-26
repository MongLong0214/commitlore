/**
 * `commitlore hooks install | uninstall | status` (PRD-F2 requirement 3).
 *
 * Installing a hook means writing into somebody's repository, so this command
 * only ever destroys something it can name:
 *
 * - A hook that is not ours is moved aside, not overwritten, and the stub calls
 *   it first — installing commitlore never silently disables another check.
 * - Installing twice writes the same bytes; the stub carries a fixed marker, so
 *   "ours" is a fact about the file, not a guess.
 * - `uninstall` restores exactly what was moved aside, and refuses to touch a
 *   hook it did not install.
 *
 * The hooks directory comes from `git rev-parse --git-path hooks`, never from a
 * hardcoded `.git/hooks`: with a linked worktree `.git` is a file, and
 * `core.hooksPath` can move the directory out of the repository entirely.
 */

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Command } from 'commander';

import { execGit } from '../core/git.js';
import {
  CHAINED_HOOK_NAME,
  HOOK_MARKER,
  HOOK_MODE,
  HOOK_NAME,
  commitMsgStub,
} from '../hooks/commit-msg.js';

/**
 * `installed` — our stub, current. `outdated` — our stub from an older build.
 * `foreign` — a hook somebody else installed.
 */
export type HookState = 'absent' | 'installed' | 'outdated' | 'foreign';

export interface HookStatus {
  hooksDir: string;
  hookPath: string;
  state: HookState;
  chainedPath: string;
  /** A foreign hook preserved by a previous install. */
  chained: boolean;
  /** git skips a non-executable hook, so a preserved hook without the bit never runs. */
  chainedExecutable: boolean;
}

export interface HookResult {
  code: 0 | 2;
  stdout: string;
  stderr: string;
  status?: HookStatus;
}

export interface HookInput {
  cwd?: string;
  force?: boolean;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const firstLine = (text: string): string => (text.trim().split('\n')[0] ?? '').trim();

const failure = (message: string): HookResult => ({
  code: 2,
  stdout: '',
  stderr: `commitlore: ${message}\n`,
});

const success = (status: HookStatus, lines: string[]): HookResult => ({
  code: 0,
  stdout: `${lines.join('\n')}\n`,
  stderr: '',
  status,
});

/**
 * The output is relative to the current directory when git prints it, so it is
 * resolved against the same directory the command ran in.
 */
const resolveHooksDir = (cwd: string): string => {
  const result = execGit(['rev-parse', '--git-path', 'hooks'], { cwd });
  if (result.code !== 0) {
    throw new Error(`not a git repository (${firstLine(result.stderr)})`);
  }
  return resolve(cwd, result.stdout.trim());
};

const isExecutable = (path: string): boolean => {
  try {
    return (statSync(path).mode & 0o111) !== 0;
  } catch {
    return false;
  }
};

const readHookState = (hookPath: string): HookState => {
  if (!existsSync(hookPath)) return 'absent';

  let contents: string;
  try {
    contents = readFileSync(hookPath, 'utf8');
  } catch {
    // Unreadable, so unclassifiable — treat it as somebody else's and keep hands off.
    return 'foreign';
  }

  if (!contents.includes(HOOK_MARKER)) return 'foreign';
  return contents === commitMsgStub() ? 'installed' : 'outdated';
};

export const readHookStatus = (cwd = process.cwd()): HookStatus => {
  const hooksDir = resolveHooksDir(cwd);
  const hookPath = join(hooksDir, HOOK_NAME);
  const chainedPath = join(hooksDir, CHAINED_HOOK_NAME);

  return {
    hooksDir,
    hookPath,
    state: readHookState(hookPath),
    chainedPath,
    chained: existsSync(chainedPath),
    chainedExecutable: isExecutable(chainedPath),
  };
};

/**
 * Written through a temporary file: a hook that git reads while it is half
 * written is a broken repository, and `writeFileSync`'s mode is masked by
 * umask, so the execute bit is set explicitly before the rename.
 */
const writeStub = (hookPath: string): void => {
  const temporary = `${hookPath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, commitMsgStub(), { mode: HOOK_MODE });
  chmodSync(temporary, HOOK_MODE);
  renameSync(temporary, hookPath);
};

const describeChained = (status: HookStatus): string[] => {
  if (!status.chained) return [];
  const note = status.chainedExecutable
    ? 'runs before commitlore'
    : 'not executable — git would not have run it either, so the stub skips it';
  return [`preserved hook: ${status.chainedPath} (${note})`];
};

export const installHook = (input: HookInput = {}): HookResult => {
  const cwd = input.cwd ?? process.cwd();

  let before: HookStatus;
  try {
    mkdirSync(resolveHooksDir(cwd), { recursive: true });
    before = readHookStatus(cwd);
  } catch (error) {
    return failure(messageOf(error));
  }

  try {
    if (before.state === 'foreign') {
      if (before.chained && input.force !== true) {
        return failure(
          `${before.hookPath} is not a commitlore hook and ${before.chainedPath} already exists — ` +
            'move one aside, or pass --force to replace the preserved hook',
        );
      }
      renameSync(before.hookPath, before.chainedPath);
    }
    writeStub(before.hookPath);
  } catch (error) {
    return failure(`could not install the ${HOOK_NAME} hook: ${messageOf(error)}`);
  }

  const after = readHookStatus(cwd);
  const headline = {
    absent: `installed ${HOOK_NAME} hook: ${after.hookPath}`,
    foreign: `installed ${HOOK_NAME} hook: ${after.hookPath} (previous hook preserved and chained)`,
    outdated: `updated ${HOOK_NAME} hook: ${after.hookPath}`,
    installed: `${HOOK_NAME} hook already installed: ${after.hookPath} (unchanged)`,
  }[before.state];

  return success(after, [headline, ...describeChained(after)]);
};

export const uninstallHook = (input: HookInput = {}): HookResult => {
  const cwd = input.cwd ?? process.cwd();

  let before: HookStatus;
  try {
    before = readHookStatus(cwd);
  } catch (error) {
    return failure(messageOf(error));
  }

  if (before.state === 'absent') {
    return success(before, [`no ${HOOK_NAME} hook to remove: ${before.hookPath}`]);
  }
  if (before.state === 'foreign') {
    return success(before, [
      `${before.hookPath} was not installed by commitlore — left in place`,
      ...describeChained(before),
    ]);
  }

  try {
    unlinkSync(before.hookPath);
    if (before.chained) renameSync(before.chainedPath, before.hookPath);
  } catch (error) {
    return failure(`could not remove the ${HOOK_NAME} hook: ${messageOf(error)}`);
  }

  const restored = before.chained ? [`restored the previous hook: ${before.hookPath}`] : [];
  return success(readHookStatus(cwd), [`removed ${HOOK_NAME} hook: ${before.hookPath}`, ...restored]);
};

export const hookStatus = (input: HookInput = {}): HookResult => {
  let status: HookStatus;
  try {
    status = readHookStatus(input.cwd ?? process.cwd());
  } catch (error) {
    return failure(messageOf(error));
  }

  const state = {
    absent: 'not installed',
    installed: 'installed (commitlore)',
    outdated: 'installed (commitlore), stub is out of date — run `commitlore hooks install`',
    foreign: 'present, not installed by commitlore',
  }[status.state];

  return success(status, [
    `hooks dir: ${status.hooksDir}`,
    `${HOOK_NAME}: ${state}`,
    ...describeChained(status),
  ]);
};

const emit = (result: HookResult): void => {
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  if (result.code !== 0) process.exitCode = result.code;
};

export const register = (program: Command): void => {
  const hooks = program
    .command('hooks')
    .description(`manage the git ${HOOK_NAME} hook that runs commitlore validate`);

  hooks
    .command('install')
    .description('install the commit-msg hook, preserving and chaining any existing one')
    .option('--force', 'replace an already preserved hook when a foreign hook is in the way')
    .action((flags: { force?: boolean }) => {
      emit(installHook(flags.force === undefined ? {} : { force: flags.force }));
    });

  hooks
    .command('uninstall')
    .description('remove the commit-msg hook and restore the one it replaced')
    .action(() => {
      emit(uninstallHook());
    });

  hooks
    .command('status')
    .description('report what is installed in the hooks directory')
    .action(() => {
      emit(hookStatus());
    });
};
