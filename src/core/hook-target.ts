import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { execGit } from './git.js';
import { PACKAGE_ROOT, findPackageRoot, packageVersion } from './paths.js';

export interface RecordedHookTarget {
  readonly bin: string;
  readonly node: string;
  readonly problems: readonly string[];
}

const configValue = (cwd: string, key: string): string =>
  execGit(['config', '--local', '--get', key], { cwd }).stdout.trim();

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const isExecutableFile = (path: string): boolean => {
  try {
    const stat = statSync(path);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
};

/**
 * The root the stub actually trusts, which is the one `hooks install` recorded
 * — not the root of whichever CLI happens to be running this check.
 *
 * They are usually the same and were assumed to be, which is how this mirror
 * came to report no problem for a hook that would refuse: on a machine with two
 * installs, or with a `commitlore.root` edited after install, the stub compares
 * against one root and `doctor` was comparing against another. `PACKAGE_ROOT`
 * remains the fallback for a repository recorded before the root was written.
 */
const trustedRoot = (cwd: string): string => configValue(cwd, 'commitlore.root') || PACKAGE_ROOT;

const isInsidePackage = (root: string, path: string): boolean => {
  try {
    const fromRoot = relative(realpathSync(root), realpathSync(path));
    return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
  } catch {
    // An unresolvable root cannot vouch for anything, and the stub's `cd` into
    // it fails the same way — so both refuse rather than both guessing.
    return false;
  }
};

const isSymlink = (path: string): boolean => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * What the recorded (or `COMMITLORE_BIN`-overridden) path resolves to, if
 * anything: a `script` runs through a separate interpreter and sits somewhere
 * under the install root (a directory).
 *
 * There is one kind because there is one shipped artifact. ADR-0026 removed the
 * compiled single-executable build, and with it the arm that classified an
 * extensionless file named `commitlore` as something to exec directly. An
 * extensionless name is now refused rather than trusted: the installer's own
 * wrapper carries that name, and a wrapper is a shell script that execs node
 * rather than an interpreter in its own right, so the path worth recording is the
 * bundle it runs.
 */
export type BinKind = 'script';

export const classifyBinTarget = (path: string): BinKind | null =>
  path.endsWith('.js') || path.endsWith('.mjs') ? 'script' : null;

/**
 * The shell stub's `case "$recorded" in` pattern — `*.mjs`/`*.js` — restated so
 * TypeScript callers — `readRecordedHookTarget` below and `doctor`'s
 * `COMMITLORE_BIN` report — agree with the stub about what it will run
 * instead of guessing at it independently.
 */
export const hasAllowedBinExtension = (path: string): boolean => classifyBinTarget(path) !== null;

/**
 * Which release the recorded path belongs to, or `null` when that cannot be
 * established.
 *
 * Read from the `package.json` above the recorded file rather than by running
 * it with `--version`. Those are the same number — `packageVersion()` reads the
 * `package.json` above its own module — but one of them is a file read and the
 * other is a subprocess. `hooks status` currently spawns nothing at all, and
 * the recorded path is by design a value a `.git/config` edit can change
 * (ADR-0011's threat model); a diagnostic that executes it to find out what it
 * is would hand that edit a run on every `status` and every `doctor`, which is
 * a larger door than the question is worth.
 *
 * The walk starts at the recorded file's directory, so it lands on the same
 * root that file would compute for itself when it runs — a bundle in
 * `<install>/dist/` resolves to `<install>`, exactly as `PACKAGE_ROOT` does
 * inside it.
 */
const recordedVersion = (binPath: string): string | null => {
  try {
    const manifest = readFileSync(join(findPackageRoot(dirname(binPath)), 'package.json'), 'utf8');
    const parsed = JSON.parse(manifest) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : null;
  } catch {
    // No manifest above it, unreadable, or not JSON. All three mean the same
    // thing to the caller: this pin's version is unknown.
    return null;
  }
};

/**
 * The version skew #382 reported, stated as problems rather than repaired.
 *
 * `hooks install` writes `commitlore.bin`/`commitlore.root` into one
 * repository's config, and an upgrade installs a new release somewhere else
 * without visiting the repositories that pinned the old one. The hook is the
 * enforcement point, so the pinned build is what validates every commit —
 * two releases of `validate` changes can be inert while `commitlore --version`
 * reports the newest one. `doctor` already printed the stale path inside its
 * own `ok` line; this is that same value compared instead of merely echoed.
 *
 * An undeterminable version is reported too. The pin still decides what runs,
 * and "I could not find out" is not the same answer as "it matches" — a false
 * green here costs a repository every fix shipped since the pin was written.
 */
const versionProblems = (binPath: string): string[] => {
  const running = packageVersion();
  const pinned = recordedVersion(binPath);

  if (pinned === null) {
    return [
      `commitlore.bin does not declare a version, so it cannot be compared with this CLI (${running}) — ` +
        'the hook may be validating commits with a different build',
    ];
  }
  if (pinned === running) return [];
  return [
    `commitlore.bin is version ${pinned}, but this CLI is ${running} — the hook validates ` +
      `every commit with ${pinned}, so anything fixed since then does not apply here`,
  ];
};

export const readRecordedHookTarget = (cwd: string): RecordedHookTarget => {
  const bin = configValue(cwd, 'commitlore.bin');
  const node = configValue(cwd, 'commitlore.node');
  const problems: string[] = [];

  if (bin === '') problems.push('commitlore.bin is not recorded');
  else {
    const binPath = resolve(cwd, bin);
    const kind = classifyBinTarget(bin);
    if (kind === null) {
      problems.push('commitlore.bin is not a .js or .mjs file');
    }
    if (!isFile(binPath)) problems.push('commitlore.bin does not exist');
    else if (kind === 'script') {
      // #71's containment, unchanged by the removal of the compiled arm: the
      // recorded path has to sit under the install root that recorded it.
      if (!isInsidePackage(trustedRoot(cwd), binPath)) {
        problems.push('commitlore.bin is outside this package root');
      }
      // The stub refuses a symlinked target outright, because a link planted
      // inside the root can point anywhere. Reporting it here is what makes
      // `doctor` explain a hook that declines rather than contradict it.
      if (isSymlink(binPath)) problems.push('commitlore.bin is a symlink');
      // Last, because the ones above say the hook will not run this file at
      // all, and which release it belongs to is only interesting once it will.
      problems.push(...versionProblems(binPath));
    }
  }

  if (node === '') problems.push('commitlore.node is not recorded');
  else {
    const nodePath = resolve(cwd, node);
    if (!isExecutableFile(nodePath)) problems.push('commitlore.node is not an executable file');
    else if (realpathSync(nodePath) !== realpathSync(process.execPath)) {
      problems.push('commitlore.node differs from this CLI interpreter');
    }
  }

  return { bin, node, problems };
};

export const describeRecordedHookTarget = (target: RecordedHookTarget): readonly string[] => [
  `commitlore.bin: ${target.bin || '(unset)'}`,
  `commitlore.node: ${target.node || '(unset)'}`,
];
