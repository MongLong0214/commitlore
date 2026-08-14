
import { existsSync, readFileSync, statSync } from 'node:fs';
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
/**
 * Marks the error above as "a file this installation ships is not there", so a
 * caller can tell a broken installation from bad input without matching on
 * message text. A flag rather than an Error subclass, per the repository's
 * convention that errors are plain.
 */
const MISSING_INSTALLED_FILE = 'commitloreMissingInstalledFile';

export const isMissingInstalledFile = (error: unknown): boolean =>
  error instanceof Error && (error as unknown as Record<string, unknown>)[MISSING_INSTALLED_FILE] === true;

export const readInstalledFile = (...segments: readonly string[]): string => {
  const path = installedPath(...segments);
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    // A raw ENOENT here reaches the user through the commit-msg hook, where the
    // two things on screen become a path they did not choose and a usage line
    // for a command they did not type — so the available reading is "my
    // trailers are wrong", and the next hour goes into editing a message that
    // was already correct (#533). The file is missing, not the message.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const missing = new Error(
      `this installation is missing ${path} — the commit message was not examined. ` +
        'Reinstall CommitLore to restore it: ' +
        'curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/main/install.sh | sh',
    );
    Object.defineProperty(missing, MISSING_INSTALLED_FILE, { value: true });
    missing.cause = error;
    throw missing;
  }
};

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

/**
 * The three installation assets a capture session reads before it can make a
 * useful promise: its own manifest, the vocabulary contract, and the record
 * schema.  Keep this beside `readInstalledFile` so every runtime resolves the
 * same package root rather than teaching the MCP server a second layout.
 */
export interface CaptureAssetPreflight {
  readonly ready: boolean;
  /** Relative asset names only — never leak a deleted installation's old path. */
  readonly problems: readonly string[];
}

const unreadable = (asset: string): string => `cannot read ${asset}`;

const CAPTURE_ASSETS: readonly (readonly string[])[] = [
  ['package.json'],
  ['spec', 'SPEC.md'],
  ['spec', 'schema', 'record.schema.json'],
];

/**
 * The request-time half of capture preflight. Metadata is enough to discover
 * a runtime whose installation disappeared after startup; the full preflight
 * below remains responsible for validating contents and producing a repair.
 */
export const captureAssetsPresent = (): boolean =>
  CAPTURE_ASSETS.every((segments) => {
    try {
      return statSync(installedPath(...segments)).isFile();
    } catch {
      return false;
    }
  });

/**
 * Check that capture's shipped inputs are present and parseable before a
 * delivery surface advertises a mutating capture tool.  The actual readers
 * still use `readInstalledFile`; this is their startup readiness check, not a
 * second resolution mechanism or a cache of their contents.
 */
export const preflightCaptureAssets = (): CaptureAssetPreflight => {
  const problems: string[] = [];

  let manifestRaw: string | undefined;
  try {
    manifestRaw = readInstalledFile('package.json');
  } catch {
    problems.push(unreadable('package.json'));
  }
  if (manifestRaw !== undefined) {
    try {
      const manifest = JSON.parse(manifestRaw) as { name?: unknown; version?: unknown };
      if (typeof manifest.name !== 'string' || manifest.name === '') {
        problems.push('package.json has no package name');
      }
      if (typeof manifest.version !== 'string' || manifest.version === '') {
        problems.push('package.json has no package version');
      }
    } catch {
      problems.push('package.json is not valid JSON');
    }
  }

  try {
    readInstalledFile('spec', 'SPEC.md');
  } catch {
    problems.push(unreadable('spec/SPEC.md'));
  }

  let schemaRaw: string | undefined;
  try {
    schemaRaw = readInstalledFile('spec', 'schema', 'record.schema.json');
  } catch {
    problems.push(unreadable('spec/schema/record.schema.json'));
  }
  if (schemaRaw !== undefined) {
    try {
      JSON.parse(schemaRaw);
    } catch {
      problems.push('spec/schema/record.schema.json is not valid JSON');
    }
  }

  return { ready: problems.length === 0, problems };
};
