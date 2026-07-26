/**
 * Where this installation's files are, resolved the same way from every layout.
 *
 * Four call sites used to compute their own path back to the package root with
 * a hardcoded number of `..` segments: `../package.json` from `cli.ts`,
 * `../../package.json` from `mcp/server.ts`, `../../spec/...` from `schema.ts`
 * and `harvest.ts`. That works only while every module sits at the depth its
 * author assumed, which stops being true the moment the code is bundled: a
 * bundle is one file, so one `import.meta.url` has to satisfy both a depth of
 * one and a depth of two, and it cannot (ADR-0011, #38).
 *
 * Walking up until `package.json` appears removes the assumption entirely. It
 * is correct from `dist/core/schema.js`, from a bundled `dist/cli.js`, and from
 * `src/core/schema.ts` under vitest, without any of them knowing where they
 * are.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Walks up from `startDir` until a directory containing `package.json` appears.
 *
 * Throws rather than returning null: every caller needs a real path, and a
 * silent fallback to the process working directory would read whatever
 * repository the user happened to be standing in — which is how a tool ends up
 * validating one project against another project's schema.
 */
export const findPackageRoot = (startDir) => {
    const { root } = parse(startDir);
    let dir = startDir;
    for (;;) {
        if (existsSync(join(dir, 'package.json')))
            return dir;
        if (dir === root) {
            throw new Error(`could not find package.json above ${startDir} — this installation is incomplete`);
        }
        dir = dirname(dir);
    }
};
/** The root of this installation, resolved once from this module's location. */
export const PACKAGE_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
/** A file shipped with the installation, addressed from its root. */
export const installedPath = (...segments) => join(PACKAGE_ROOT, ...segments);
/**
 * The declared version, read from the installation's own `package.json`.
 *
 * Read lazily and cached: `--version` is one command, and every other command
 * paying a file read at import time is a cost with no reader.
 */
let cachedVersion = null;
export const packageVersion = () => {
    if (cachedVersion !== null)
        return cachedVersion;
    const raw = readFileSync(installedPath('package.json'), 'utf8');
    const parsed = JSON.parse(raw);
    cachedVersion = typeof parsed.version === 'string' ? parsed.version : '0.0.0-unknown';
    return cachedVersion;
};
//# sourceMappingURL=paths.js.map