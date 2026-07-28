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
 *
 * A fourth layout (#39) breaks the assumption a different way: a Node SEA
 * binary has no directory tree beside it at all. Node's own docs say what
 * `import.meta.url`/`__dirname` become inside one — the executable's own path
 * and its containing directory — which is not where `spec/` or `package.json`
 * live, so walking up from there would either throw or, worse, find an
 * unrelated `package.json` that happens to sit above wherever the binary was
 * installed. `PACKAGE_ROOT` stays a real, non-throwing directory in every case
 * so importing this module never crashes a binary at startup, but nothing
 * shipped reads a file through it while running as one — `readInstalledFile`
 * below routes to the assets `scripts/build-binary.mjs` embeds in the blob
 * instead.
 */
import type * as NodeSea from 'node:sea';
/**
 * `createRequire` rather than a static `import … from 'node:sea'`, purely for
 * a test-environment reason: Vite/vitest's SSR module graph (as pinned here)
 * externalizes a `node:`-prefixed specifier by checking it against
 * `node:module`'s `builtinModules` list, which does not carry `node:sea` yet,
 * and mis-resolves the import as a package named `sea` instead — failing
 * every test file that transitively imports this module, which under
 * `commands/hooks.ts` and `commands/doctor.ts` is most of them.
 * `createRequire` resolves through real Node module resolution instead,
 * which knows `node:sea` fine — this sidesteps the bundler's older check
 * rather than arguing with it. `import type` above costs nothing at
 * runtime — TypeScript erases it — and keeps the real function signatures
 * for the cast below.
 */
declare const isSea: typeof NodeSea.isSea;
/** Re-exported so other modules never need their own `node:sea` workaround. */
export { isSea };
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
 * Under a compiled binary this is only ever the directory the executable
 * happens to sit in — not a package root in any meaningful sense — because
 * `PACKAGE_ROOT` is imported at module scope by several files (`hook-target.ts`,
 * `commands/hooks.ts`, `commands/doctor.ts`) and an ES module graph evaluates
 * every import before any command runs. Throwing here would crash `commitlore
 * --version` in the one environment #39 exists to support.
 */
export declare const PACKAGE_ROOT: string;
/** A file shipped with the installation, addressed from its root. */
export declare const installedPath: (...segments: readonly string[]) => string;
/**
 * Reads a file this installation ships, whichever installation this is.
 *
 * A checkout (or its bundle) has a real `spec/` and `package.json` on disk,
 * addressed through `installedPath`. A compiled single-executable build has
 * neither — `scripts/build-binary.mjs` embeds the same files as SEA assets,
 * keyed by the same relative path joined with `/`, and `sea.getAsset` reads
 * them back out of the binary instead of the filesystem.
 */
export declare const readInstalledFile: (...segments: readonly string[]) => string;
export declare const packageVersion: () => string;
