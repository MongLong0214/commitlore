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
 * - `uninstall` accounts for every hook commitlore writes, not only the one
 *   `install` writes here. `init` also installs `prepare-commit-msg` and
 *   `post-commit`, and this is the only command that removes any of them, so a
 *   hook it walked past would have no removal path at all (#354).
 *
 * The hooks directory comes from `git rev-parse --git-path hooks`, never from a
 * hardcoded `.git/hooks`: with a linked worktree `.git` is a file, and
 * `core.hooksPath` can move the directory out of the repository entirely.
 */

import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import type { Command } from 'commander';

import { execGit } from '../core/git.js';
import {
  type RecordedHookTarget,
  classifyBinTarget,
  describeRecordedHookTarget,
  recordedHookIdentity,
  readRecordedHookTarget,
} from '../core/hook-target.js';
import { PACKAGE_ROOT } from '../core/paths.js';
import {
  CHAINED_HOOK_NAME,
  HOOK_MARKER,
  HOOK_MODE,
  HOOK_NAME,
  commitMsgStub,
} from '../hooks/commit-msg.js';
import {
  POST_COMMIT_CHAINED_HOOK_NAME,
  POST_COMMIT_HOOK_MARKER,
  POST_COMMIT_HOOK_NAME,
} from '../hooks/post-commit.js';
import {
  PRE_PUSH_CHAINED_HOOK_NAME,
  PRE_PUSH_HOOK_MARKER,
  PRE_PUSH_HOOK_NAME,
} from '../hooks/pre-push.js';
import {
  PREPARE_COMMIT_MSG_CHAINED_HOOK_NAME,
  PREPARE_COMMIT_MSG_HOOK_MARKER,
  PREPARE_COMMIT_MSG_HOOK_NAME,
} from '../hooks/prepare-commit-msg.js';

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
  recordedTarget: RecordedHookTarget;
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
    recordedTarget: readRecordedHookTarget(cwd),
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

/**
 * Records the entry point this install ran from, in local git config.
 *
 * The hook's other three lookups — `COMMITLORE_BIN`, `PATH`, a `node_modules`
 * walk — all assume the CLI arrived through a package manager. Since ADR-0011
 * a clone is a complete installation, so the ordinary case is a checkout that
 * satisfies none of them, and the first commit in a fresh repository fails with
 * the hook unable to find the tool that had just written it.
 *
 * Local config rather than the stub's text so that `hooks status` keeps
 * comparing bytes: a hook installed from another path stays `installed`, not
 * `outdated`. Failure here is not fatal — the hook still has three other ways
 * to resolve, and refusing to install because a config write failed would be
 * worse than installing something slightly less able to find itself.
 */
/**
 * The entry point to record, or `null` when none can be established.
 *
 * `resolve(process.argv[1])` alone was the cause of #296. When the CLI is invoked
 * by bare name, `argv[1]` can be the string as typed rather than a path, and
 * `resolve` then produces `<cwd>/commitlore` — a file that has never existed. The
 * hook reads that value, cannot use it, and reports a failure whose prescribed fix
 * re-records the same wrong value, so following the instruction changes nothing.
 *
 * Three steps, in order: an absolute or relative path is resolved and must exist
 * as a file; a bare name is looked up on `PATH` the way a shell would; and if
 * neither yields an existing file, nothing is recorded. Recording nothing is
 * strictly better than recording a fiction, because the stub still has three other
 * ways to resolve, while a stale value stops it at the first.
 *
 * Exported for the test that drives it directly: reproducing the reported
 * `argv[1]` needs a compiled binary, which ADR-0026 removed from the product.
 */
export const resolveEntryForRecord = (entry: string | undefined, cwd: string): string | null => {
  if (entry === undefined || entry === '') return null;

  const existingFile = (candidate: string): string | null => {
    try {
      return statSync(candidate).isFile() ? candidate : null;
    } catch {
      return null;
    }
  };

  if (entry.includes('/')) return existingFile(resolve(cwd, entry));

  // A bare name: resolve it the way the shell that ran it did.
  for (const dir of (process.env['PATH'] ?? '').split(':')) {
    if (dir === '') continue;
    const found = existingFile(resolve(dir, entry));
    if (found !== null) return found;
  }
  return null;
};

const recordBinPath = (cwd: string): void => {
  const resolvedEntry = resolveEntryForRecord(process.argv[1], cwd);
  if (resolvedEntry === null) return;
  execGit(['config', '--local', 'commitlore.bin', resolvedEntry], { cwd });
  // The interpreter as well: the branch that reads these back runs in a hook
  // whose PATH may not carry node, which is the whole reason it exists. For a
  // compiled binary this is the same value as commitlore.bin — it is its own
  // interpreter — which is exactly what the shell stub's binary branch and
  // `readRecordedHookTarget`'s node-comparison both expect.
  execGit(['config', '--local', 'commitlore.node', process.execPath], { cwd });
  // And the install root the stub trusts `commitlore.bin` to sit under (a
  // script). A `.git/config` edit made after this install (ADR-0011's threat
  // model: the same permission that can write this key can write
  // `.git/hooks` directly) can still repoint `commitlore.bin` at another
  // recognized file, but not at one outside here — the stub checks the
  // recorded path against this root, not just its name. `realpathSync` so the
  // recorded value is comparable to the physical path the stub resolves with
  // `cd ... && pwd -P`; best-effort like the rest of this function, so a
  // failure here is swallowed rather than failing the install.
  try {
    // One artifact, one root: the package the recorded script has to sit under.
    // ADR-0026 removed the compiled build, which was the only case whose root was
    // a single file rather than a directory.
    execGit(['config', '--local', 'commitlore.root', realpathSync(PACKAGE_ROOT)], { cwd });
  } catch {
    // No root recorded means the stub's containment check cannot pass, which
    // only narrows resolution to the remaining, still-safe fallback steps.
  }
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
    recordBinPath(cwd);
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

interface CaptureHook {
  readonly name: string;
  readonly marker: string;
  readonly chainedName: string;
}

/**
 * The hooks `init` installs beside the gate.
 *
 * They are listed here rather than read off the hooks directory: removing every
 * file that happens to carry a `# commitlore:` line would let a marker invented
 * elsewhere decide what this command deletes. Each entry names its own marker,
 * so "ours" stays the same kind of fact it is for `commit-msg`.
 */
const CAPTURE_HOOKS: readonly CaptureHook[] = [
  {
    name: PREPARE_COMMIT_MSG_HOOK_NAME,
    marker: PREPARE_COMMIT_MSG_HOOK_MARKER,
    chainedName: PREPARE_COMMIT_MSG_CHAINED_HOOK_NAME,
  },
  {
    name: POST_COMMIT_HOOK_NAME,
    marker: POST_COMMIT_HOOK_MARKER,
    chainedName: POST_COMMIT_CHAINED_HOOK_NAME,
  },
  // #416. Listed here so `hooks uninstall` removes what `init` installed: a
  // hook this command does not know about is one it leaves behind.
  {
    name: PRE_PUSH_HOOK_NAME,
    marker: PRE_PUSH_HOOK_MARKER,
    chainedName: PRE_PUSH_CHAINED_HOOK_NAME,
  },
];

/** Throws on a filesystem failure, which the caller reports against the hook's name. */
const removeCaptureHook = (hooksDir: string, hook: CaptureHook): string[] => {
  const hookPath = join(hooksDir, hook.name);
  const chainedPath = join(hooksDir, hook.chainedName);

  if (!existsSync(hookPath)) return [`no ${hook.name} hook to remove: ${hookPath}`];

  let contents: string;
  try {
    contents = readFileSync(hookPath, 'utf8');
  } catch {
    // Unreadable, so unclassifiable — the same call `readHookState` makes.
    return [`${hookPath} was not installed by commitlore — left in place`];
  }
  if (!contents.includes(hook.marker)) {
    return [`${hookPath} was not installed by commitlore — left in place`];
  }

  unlinkSync(hookPath);
  // These two installers refuse a foreign hook rather than moving it aside, so
  // nothing commitlore wrote puts a file here. The stub still calls one if it
  // exists, so leaving it behind our removed stub would disable a hook that had
  // been running.
  if (!existsSync(chainedPath)) return [`removed ${hook.name} hook: ${hookPath}`];
  renameSync(chainedPath, hookPath);
  return [`removed ${hook.name} hook: ${hookPath}`, `restored the previous hook: ${hookPath}`];
};

export const uninstallHook = (input: HookInput = {}): HookResult => {
  const cwd = input.cwd ?? process.cwd();

  let before: HookStatus;
  try {
    before = readHookStatus(cwd);
  } catch (error) {
    return failure(messageOf(error));
  }

  const lines: string[] = [];

  if (before.state === 'absent') {
    lines.push(`no ${HOOK_NAME} hook to remove: ${before.hookPath}`);
  } else if (before.state === 'foreign') {
    lines.push(
      `${before.hookPath} was not installed by commitlore — left in place`,
      ...describeChained(before),
    );
  } else {
    try {
      unlinkSync(before.hookPath);
      if (before.chained) renameSync(before.chainedPath, before.hookPath);
    } catch (error) {
      return failure(`could not remove the ${HOOK_NAME} hook: ${messageOf(error)}`);
    }
    lines.push(`removed ${HOOK_NAME} hook: ${before.hookPath}`);
    if (before.chained) lines.push(`restored the previous hook: ${before.hookPath}`);
  }

  // A gate that was absent or foreign is not a reason to stop: `init` installs
  // the others independently, and each of them can be in any state.
  for (const hook of CAPTURE_HOOKS) {
    try {
      lines.push(...removeCaptureHook(before.hooksDir, hook));
    } catch (error) {
      return failure(`could not remove the ${hook.name} hook: ${messageOf(error)}`);
    }
  }

  return success(readHookStatus(cwd), lines);
};

export const hookStatus = (input: HookInput = {}): HookResult => {
  const cwd = input.cwd ?? process.cwd();
  let status: HookStatus;
  try {
    status = readHookStatus(cwd);
  } catch (error) {
    return failure(messageOf(error));
  }

  const state = {
    absent: 'not installed',
    installed: 'installed (commitlore)',
    outdated: 'installed (commitlore), stub is out of date — run `commitlore hooks install`',
    foreign: 'present, not installed by commitlore',
  }[status.state];
  const targetWarning =
    status.state === 'installed' && status.recordedTarget.problems.length > 0
      ? ', recorded target warning — run `commitlore hooks install`'
      : '';
  const identity = recordedHookIdentity(status.recordedTarget, cwd);

  return success(status, [
    `hooks dir: ${status.hooksDir}`,
    `${HOOK_NAME}: ${state}${targetWarning}`,
    ...describeRecordedHookTarget(status.recordedTarget),
    ...(identity === null
      ? []
      : [`hook runtime identity: ${JSON.stringify(identity)}`]),
    ...status.recordedTarget.problems.map((problem) => `warning: ${problem}`),
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
    .description(
      `manage commitlore's git hooks: the ${HOOK_NAME} hook that runs commitlore validate, and the two hooks init installs beside it`,
    );

  hooks
    .command('install')
    .description('install the commit-msg hook, preserving and chaining any existing one')
    .option('--force', 'replace an already preserved hook when a foreign hook is in the way')
    .addHelpText('after', '\nExit codes: 0 installed (or already installed), 2 could not run -- no repository, or the hook could not be written (SPEC §10).')
    .action((flags: { force?: boolean }) => {
      emit(installHook(flags.force === undefined ? {} : { force: flags.force }));
    });

  hooks
    .command('uninstall')
    .description(
      'remove every commitlore hook — commit-msg, prepare-commit-msg, post-commit — and restore any they replaced',
    )
    .addHelpText('after', '\nExit codes: 0 removed (or nothing to remove), 2 could not run -- no repository, or the hook could not be removed (SPEC §10).')
    .action(() => {
      emit(uninstallHook());
    });

  hooks
    .command('status')
    .description('report what is installed in the hooks directory')
    .addHelpText('after', '\nExit codes: 0 reported, 2 could not run -- no repository (SPEC §10).')
    .action(() => {
      emit(hookStatus());
    });
};
