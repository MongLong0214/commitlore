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
/**
 * Walks up from `startDir` until a directory containing `package.json` appears.
 *
 * Throws rather than returning null: every caller needs a real path, and a
 * silent fallback to the process working directory would read whatever
 * repository the user happened to be standing in — which is how a tool ends up
 * validating one project against another project's schema.
 */
export declare const findPackageRoot: (startDir: string) => string;
/** The root of this installation, resolved once from this module's location. */
export declare const PACKAGE_ROOT: string;
/** A file shipped with the installation, addressed from its root. */
export declare const installedPath: (...segments: readonly string[]) => string;
export declare const packageVersion: () => string;
