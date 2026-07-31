
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
export const findPackageRoot = (startDir: string): string => {
  const { root } = parse(startDir);
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dir === root) {
      throw new Error(
        `could not find package.json above ${startDir} — this installation is incomplete`,
      );
    }
    dir = dirname(dir);
  }
};

/**
 * The root of this installation, resolved once from this module's location.
 *
 * Imported at module scope by several files (`hook-target.ts`,
 * `commands/hooks.ts`, `commands/doctor.ts`), and an ES module graph evaluates
 * every import before any command runs -- so a throw here fails the whole CLI
 * rather than one command. It throws anyway: every caller needs a real root, and
 * the alternative is reading another project's files.
 */
export const PACKAGE_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/** A file shipped with the installation, addressed from its root. */
export const installedPath = (...segments: readonly string[]): string =>
  join(PACKAGE_ROOT, ...segments);

/**
 * Reads a file this installation ships.
 *
 * Every shipped installation has a real `spec/` and `package.json` on disk: a
 * clone, the bundle inside one, or the pinned checkout an installer makes. The
 * SEA-asset branch this used to carry existed for the compiled build ADR-0026
 * removed.
 */
export const readInstalledFile = (...segments: readonly string[]): string =>
  readFileSync(installedPath(...segments), 'utf8');

/**
 * The declared version, read from the installation's own `package.json`.
 *
 * Read lazily and cached: `--version` is one command, and every other command
 * paying a file read at import time is a cost with no reader.
 */
let cachedVersion: string | null = null;

export const packageVersion = (): string => {
  if (cachedVersion !== null) return cachedVersion;
  const raw = readInstalledFile('package.json');
  const parsed = JSON.parse(raw) as { version?: unknown };
  cachedVersion = typeof parsed.version === 'string' ? parsed.version : '0.0.0-unknown';
  return cachedVersion;
};
