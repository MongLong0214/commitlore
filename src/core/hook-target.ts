import { realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

import { execGit } from './git.js';
import { PACKAGE_ROOT } from './paths.js';

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

const isInsidePackage = (path: string): boolean => {
  const fromRoot = relative(realpathSync(PACKAGE_ROOT), realpathSync(path));
  return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
};

const matchesRunningBinary = (path: string): boolean => {
  try {
    return realpathSync(path) === realpathSync(process.execPath);
  } catch {
    return false;
  }
};

/**
 * What the recorded (or `COMMITLORE_BIN`-overridden) path resolves to, if
 * anything: `script` runs through a separate interpreter and sits somewhere
 * under the install root (a directory); `binary` (#39) is a compiled
 * single-executable build with neither extension nor an interpreter of its
 * own — it *is* the interpreter, so its "root" is the one file, not a
 * directory it happens to sit under.
 *
 * A binary is recognized by name (`commitlore`, the name `scripts/build-binary.mjs`
 * gives its output), not merely by having no extension — "any extensionless
 * file" would allow-list every other executable on the machine the moment it
 * lost the `.js`/`.mjs` check.
 */
export type BinKind = 'script' | 'binary';

export const classifyBinTarget = (path: string): BinKind | null => {
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'script';
  return basename(path) === 'commitlore' ? 'binary' : null;
};

/**
 * The shell stub's `case "$recorded" in` patterns — `*.mjs`/`*.js` for a
 * script, a basename of `commitlore` for a compiled binary — restated so
 * TypeScript callers — `readRecordedHookTarget` below and `doctor`'s
 * `COMMITLORE_BIN` report — agree with the stub about what it will run
 * instead of guessing at it independently.
 */
export const hasAllowedBinExtension = (path: string): boolean => classifyBinTarget(path) !== null;

export const readRecordedHookTarget = (cwd: string): RecordedHookTarget => {
  const bin = configValue(cwd, 'commitlore.bin');
  const node = configValue(cwd, 'commitlore.node');
  const problems: string[] = [];

  if (bin === '') problems.push('commitlore.bin is not recorded');
  else {
    const binPath = resolve(cwd, bin);
    const kind = classifyBinTarget(bin);
    if (kind === null) {
      problems.push('commitlore.bin is not a .js, .mjs, or compiled commitlore binary');
    }
    if (!isFile(binPath)) problems.push('commitlore.bin does not exist');
    else if (kind === 'script' && !isInsidePackage(binPath)) {
      problems.push('commitlore.bin is outside this package root');
    } else if (kind === 'binary' && !isExecutableFile(binPath)) {
      problems.push('commitlore.bin is not an executable file');
    } else if (kind === 'binary' && !matchesRunningBinary(binPath)) {
      // A binary has no install root to be contained by — it *is* the trusted
      // artifact, so containment collapses to "is this the one currently
      // running", the same question `commitlore.node` asks below for the
      // script case. Same message as the script branch: both report the same
      // fact, that the recorded path is not the trusted install.
      problems.push('commitlore.bin is outside this package root');
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
