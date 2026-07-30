#!/usr/bin/env node
/**
 * Builds the compiled single-executable form of the CLI (#39, ADR-0015).
 *
 * `dist/commitlore.mjs` (the committed bundle, ADR-0011) already has every
 * dependency inlined — `node:sqlite` (ADR-0012) removed the one thing that
 * could not travel that way, a native `.node` addon. Node's own
 * `--experimental-sea-config` feature turns a bundle like that into a real
 * executable: it reads `main` as ordinary Node source, snapshots it into a
 * blob, and `postject` (a build-time tool Node's own docs use for this exact
 * purpose, not a runtime dependency of the CLI) injects the blob into a copy
 * of the `node` binary that built it.
 *
 * Three things a plain reuse of `dist/commitlore.mjs` cannot do, verified
 * against this Node line (not merely read from a doc) and handled here:
 *
 *   - **The SEA main script must be CommonJS.** Node's own doc is explicit —
 *     "the single executable application feature currently only supports
 *     running a single embedded script using the CommonJS module system" —
 *     and this was checked empirically before trusting it: an ESM main
 *     (`mainFormat: "module"`, which the schema does not even recognize on
 *     this Node line) fails at blob-generation time with "Cannot use import
 *     statement outside a module", and the same file run directly as the
 *     `main` of a CJS-format SEA fails identically at *runtime*. This script
 *     therefore builds a second, CommonJS-format bundle from the same
 *     `src/cli.ts` entry, purely as a build intermediate — it is written to a
 *     temporary directory, never committed, and `dist/commitlore.mjs` stays
 *     exactly what it already was.
 *   - Node's own docs: inside an SEA, `import.meta.url`/`__dirname` resolve to
 *     the *executable's* own path, not a real directory containing `spec/` or
 *     `package.json`. `core/paths.ts` embeds those as SEA `assets` instead of
 *     reading them off a disk that will not have them — the `assets` map below
 *     must stay in sync with every `readInstalledFile(...)` call site.
 *   - `execArgv: ["--no-warnings"]` is the SEA-level equivalent of the
 *     `--no-warnings` the committed bin's shebang line already carries
 *     (ADR-0012): `node:sqlite` is still experimental on the Node 22 floor
 *     (ADR-0010), and a stray warning on stdout would corrupt the MCP
 *     server's newline-delimited JSON-RPC the same way it would from the
 *     script path.
 *
 * The output (`dist/commitlore`, or `dist/commitlore.exe` on Windows — not
 * built or tested by this script; see ADR-0015) is never committed: unlike
 * `dist/commitlore.mjs` it is large, platform- and architecture-specific, and
 * not meaningfully diffable, which is exactly what ADR-0011's "committed dist/
 * matches src/, byte for byte" CI check assumes it never has to compare. It is
 * a reproducible build artifact instead — CI builds and smoke-tests it on
 * every push (never commits it), and a release can attach it the same way #39
 * always intended for a platform binary.
 *
 * Usage: node scripts/build-binary.mjs
 * Requires `npm run build` to have already produced dist/commitlore.mjs (this
 * script does not rebuild it, so a stale bundle would silently ship stale
 * behavior — same discipline CI's dist/-matches-src/ check already enforces
 * for the script distribution).
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_DIR = join(REPO_ROOT, 'dist');
const BUNDLE = join(DIST_DIR, 'commitlore.mjs');
const OUTPUT = join(DIST_DIR, process.platform === 'win32' ? 'commitlore.exe' : 'commitlore');
const CLI_ENTRY = join(REPO_ROOT, 'src', 'cli.ts');

// nodejs.org/api/single-executable-applications.html — fixed by Node, not
// chosen by this project, and it must match exactly or postject refuses to
// inject the blob.
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

if (!existsSync(BUNDLE)) {
  console.error(`ERROR: ${BUNDLE} does not exist — run \`npm run build\` first`);
  process.exit(1);
}

/**
 * Every file `core/paths.ts#readInstalledFile` reads through `sea.getAsset`
 * at runtime, keyed by the same relative path joined with `/`. Keep this in
 * sync with `schema.ts#SCHEMA_ASSET`, `harvest.ts#SPEC_ASSET`, and
 * `paths.ts#packageVersion`'s `package.json` read — a key missing here is an
 * asset that exists on every other installation and throws on this one.
 */
const ASSETS = {
  'package.json': join(REPO_ROOT, 'package.json'),
  'spec/schema/record.schema.json': join(REPO_ROOT, 'spec', 'schema', 'record.schema.json'),
  'spec/SPEC.md': join(REPO_ROOT, 'spec', 'SPEC.md'),
};

for (const [key, path] of Object.entries(ASSETS)) {
  if (!existsSync(path)) {
    console.error(`ERROR: asset "${key}" does not exist at ${path}`);
    process.exit(1);
  }
}

const run = (cmd, args) => {
  console.log(`+ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit' });
};

const work = mkdtempSync(join(tmpdir(), 'commitlore-sea-'));
try {
  const cjsBundle = join(work, 'commitlore.cjs');
  const configPath = join(work, 'sea-config.json');
  const blobPath = join(work, 'sea-prep.blob');

  console.log(`bundling ${CLI_ENTRY} as CommonJS for the SEA main script`);
  run(join(REPO_ROOT, 'node_modules', '.bin', 'esbuild'), [
    CLI_ENTRY,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node22',
    `--outfile=${cjsBundle}`,
  ]);

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        main: cjsBundle,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: true,
        execArgv: ['--no-warnings'],
        assets: ASSETS,
      },
      null,
      2,
    ),
  );

  console.log(`building ${OUTPUT} from ${cjsBundle}`);
  run(process.execPath, ['--experimental-sea-config', configPath]);

  rmSync(OUTPUT, { force: true });
  copyFileSync(process.execPath, OUTPUT);
  chmodSync(OUTPUT, 0o755);

  // A copy of `node` carries `node`'s own code signature, which no longer
  // matches once postject rewrites the binary's bytes below — macOS refuses
  // to run a binary whose signature does not match its contents. Removed here,
  // reapplied (ad hoc — this build has no distribution certificate) after
  // injection.
  if (process.platform === 'darwin') {
    run('codesign', ['--remove-signature', OUTPUT]);
  }

  const postjectArgs = [OUTPUT, 'NODE_SEA_BLOB', blobPath, '--sentinel-fuse', SENTINEL_FUSE];
  // macOS Mach-O binaries need the blob in a named segment; ELF and PE do not.
  if (process.platform === 'darwin') {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  }
  run(join(REPO_ROOT, 'node_modules', '.bin', 'postject'), postjectArgs);

  if (process.platform === 'darwin') {
    run('codesign', ['--sign', '-', OUTPUT]);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const { size } = statSync(OUTPUT);
console.log(`built ${OUTPUT} (${(size / 1024 / 1024).toFixed(1)} MiB)`);
