import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const CANONICAL_ARTIFACT_FORMAT = 'commitlore-canonical-artifact-v1';
export const CANONICAL_ARTIFACT_MANIFEST = 'installer/canonical-artifact.json';
/**
 * The builder, pinned by digest rather than by tag.
 *
 * `node:24-bookworm` is mutable: the same source built on two dates can pick up
 * a different base image, Node patch or OS package. Building twice in one job
 * proves the builder is deterministic *now*, and says nothing about a rebuild
 * next month -- which is the claim `installer/canonical-artifact.json` is for.
 *
 * The tag is kept in the digest's own string so a reader can still see which
 * Node line this is. Updating it is a deliberate change, like a dependency bump.
 */
export const CANONICAL_BUILD_IMAGE = 'node:24-bookworm@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584';
export const CANONICAL_BUILD_COMMAND = `docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w ${CANONICAL_BUILD_IMAGE} sh -c "npm ci && npm run build"`;

// The installer starts only this file from dist/. The TypeScript outputs remain
// tracked for now (see docs/CANONICAL-BUILD.md), but are not runtime inputs.
export const RUNTIME_DIST_ASSETS = Object.freeze(['dist/commitlore.mjs']);
export const SOURCE_INPUTS = Object.freeze(['package-lock.json', 'package.json', 'tsconfig.json', 'src']);

const sha256 = (contents) => createHash('sha256').update(contents).digest('hex');

const filesBelow = (root, path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) throw new Error(`required input is absent: ${path}`);
  if (statSync(absolute).isFile()) return [path];

  return readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => filesBelow(root, join(path, entry.name)))
    .sort();
};

export const listedFiles = (root, inputs) => inputs.flatMap((path) => filesBelow(root, path)).sort();

export const digestFileList = (root, inputs) => {
  const files = listedFiles(root, inputs);
  const entries = files.map((path) => ({ path, sha256: sha256(readFileSync(join(root, path))) }));
  const aggregate = createHash('sha256');
  for (const entry of entries) aggregate.update(`${entry.path}\0${entry.sha256}\n`);
  return { sha256: aggregate.digest('hex'), files: entries };
};

export const artifactManifest = (root) => ({
  format: CANONICAL_ARTIFACT_FORMAT,
  builder: {
    platform: 'linux/amd64',
    image: CANONICAL_BUILD_IMAGE,
    command: CANONICAL_BUILD_COMMAND,
  },
  runtimeAssets: [...RUNTIME_DIST_ASSETS],
  source: {
    inputs: [...SOURCE_INPUTS],
    sha256: digestFileList(root, SOURCE_INPUTS).sha256,
  },
  artifact: digestFileList(root, ['dist']),
});

export const manifestPath = (root) => join(root, CANONICAL_ARTIFACT_MANIFEST);

export const repositoryRelative = (root, absolute) => relative(root, absolute).replaceAll('\\', '/');
