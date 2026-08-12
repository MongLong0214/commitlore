/**
 * Walks up from `startDir` until a directory containing `package.json` appears.
 *
 * Throws rather than returning null: every caller needs a real path, and a
 * silent fallback to the process working directory would read whatever
 * repository the user happened to be standing in — which is how a tool ends up
 * validating one project against another project's schema.
 */
export declare const findPackageRoot: (startDir: string) => string;
/**
 * The root of this installation, resolved once from this module's location.
 *
 * Imported at module scope by several files (`hook-target.ts`,
 * `commands/hooks.ts`, `commands/doctor.ts`), and an ES module graph evaluates
 * every import before any command runs -- so a throw here fails the whole CLI
 * rather than one command. It throws anyway: every caller needs a real root, and
 * the alternative is reading another project's files.
 */
export declare const PACKAGE_ROOT: string;
/** A file shipped with the installation, addressed from its root. */
export declare const installedPath: (...segments: readonly string[]) => string;
export declare const isMissingInstalledFile: (error: unknown) => boolean;
export declare const readInstalledFile: (...segments: readonly string[]) => string;
export declare const packageVersion: () => string;
