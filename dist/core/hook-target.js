import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { execGit } from './git.js';
import { PACKAGE_ROOT } from './paths.js';
const configValue = (cwd, key) => execGit(['config', '--local', '--get', key], { cwd }).stdout.trim();
const isFile = (path) => {
    try {
        return statSync(path).isFile();
    }
    catch {
        return false;
    }
};
const isExecutableFile = (path) => {
    try {
        const stat = statSync(path);
        return stat.isFile() && (stat.mode & 0o111) !== 0;
    }
    catch {
        return false;
    }
};
const isInsidePackage = (path) => {
    const fromRoot = relative(realpathSync(PACKAGE_ROOT), realpathSync(path));
    return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
};
/**
 * The shell stub's `case "$recorded" in *.mjs|*.js)` pattern, restated so
 * TypeScript callers — `readRecordedHookTarget` below and `doctor`'s
 * COMMITLORE_BIN report — agree with the stub about what it will run instead
 * of guessing at it independently.
 */
export const hasAllowedBinExtension = (path) => path.endsWith('.js') || path.endsWith('.mjs');
export const readRecordedHookTarget = (cwd) => {
    const bin = configValue(cwd, 'commitlore.bin');
    const node = configValue(cwd, 'commitlore.node');
    const problems = [];
    if (bin === '')
        problems.push('commitlore.bin is not recorded');
    else {
        const binPath = resolve(cwd, bin);
        if (!hasAllowedBinExtension(bin)) {
            problems.push('commitlore.bin is not a .js or .mjs file');
        }
        if (!isFile(binPath))
            problems.push('commitlore.bin does not exist');
        else if (!isInsidePackage(binPath))
            problems.push('commitlore.bin is outside this package root');
    }
    if (node === '')
        problems.push('commitlore.node is not recorded');
    else {
        const nodePath = resolve(cwd, node);
        if (!isExecutableFile(nodePath))
            problems.push('commitlore.node is not an executable file');
        else if (realpathSync(nodePath) !== realpathSync(process.execPath)) {
            problems.push('commitlore.node differs from this CLI interpreter');
        }
    }
    return { bin, node, problems };
};
export const describeRecordedHookTarget = (target) => [
    `commitlore.bin: ${target.bin || '(unset)'}`,
    `commitlore.node: ${target.node || '(unset)'}`,
];
//# sourceMappingURL=hook-target.js.map