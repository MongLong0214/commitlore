import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

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

export const readRecordedHookTarget = (cwd: string): RecordedHookTarget => {
  const bin = configValue(cwd, 'commitlore.bin');
  const node = configValue(cwd, 'commitlore.node');
  const problems: string[] = [];

  if (bin === '') problems.push('commitlore.bin is not recorded');
  else {
    const binPath = resolve(cwd, bin);
    if (!bin.endsWith('.js') && !bin.endsWith('.mjs')) {
      problems.push('commitlore.bin is not a .js or .mjs file');
    }
    if (!isFile(binPath)) problems.push('commitlore.bin does not exist');
    else if (!isInsidePackage(binPath)) problems.push('commitlore.bin is outside this package root');
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
