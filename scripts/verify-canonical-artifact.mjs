#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CANONICAL_ARTIFACT_FORMAT,
  CANONICAL_ARTIFACT_MANIFEST,
  CANONICAL_BUILD_COMMAND,
  RUNTIME_DIST_ASSETS,
  SOURCE_INPUTS,
  artifactManifest,
  manifestPath,
} from './canonical-artifact-contract.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));

/**
 * `--contract-only` checks what the manifest *declares* and stops short of what
 * it *records*.
 *
 * The three checksum comparisons below all ask the same question -- does the
 * committed manifest describe the committed bundle -- and on a pull request that
 * changes `src/` and nothing else, the honest answer is no, by construction.
 * CI rebuilds before it verifies, so after `build:canonical` the tree holds a
 * bundle built from the new source while the committed manifest still describes
 * the old one. All three fail together and `git diff` is never reached: that is
 * how #720 failed, and dropping the diff line alone would not have moved it.
 *
 * What this mode still refuses is a manifest whose contract has been edited --
 * the platform, the image, the build command, the runtime asset list, the source
 * input list. Those do not move when source moves, so a pull request has no
 * honest reason to touch them.
 *
 * What it gives up, and this is the whole cost: on that path nothing checks that
 * the committed manifest tells the truth about the committed bundle. A bundle
 * edited by hand passes every check in this mode -- measured on #763, where
 * `artifact:verify` passed and only the rebuild-and-diff caught it. That
 * property now lives on the push and tag paths, and on `canonical-merge.yml`,
 * which regenerates the manifest rather than trusting one.
 */
const contractOnly = process.argv.includes('--contract-only');
const errors = [];
const fail = (message) => errors.push(message);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

let recorded;
const path = manifestPath(root);
if (!existsSync(path)) {
  fail(`${CANONICAL_ARTIFACT_MANIFEST} is missing`);
} else {
  try {
    recorded = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${CANONICAL_ARTIFACT_MANIFEST} is not valid JSON: ${error.message}`);
  }
}

const actual = artifactManifest(root);
if (recorded !== undefined) {
  if (recorded.format !== CANONICAL_ARTIFACT_FORMAT) fail(`manifest format is ${JSON.stringify(recorded.format)}`);
  if (recorded.builder?.platform !== 'linux/amd64') fail('manifest does not declare linux/amd64');
  if (recorded.builder?.image !== 'node:24-bookworm') fail('manifest does not declare node:24-bookworm');
  if (recorded.builder?.command !== CANONICAL_BUILD_COMMAND) fail('manifest does not record the canonical build command');
  if (!same(recorded.runtimeAssets, RUNTIME_DIST_ASSETS)) {
    fail(`runtime asset list must be exactly ${RUNTIME_DIST_ASSETS.join(', ')}`);
  }
  if (!same(recorded.source?.inputs, SOURCE_INPUTS)) fail('manifest source inputs differ from the reviewed source list');
  if (!contractOnly) {
    if (recorded.source?.sha256 !== actual.source.sha256) fail('source checksum does not match this checkout');
    if (!same(recorded.artifact?.files, actual.artifact.files)) fail('dist file list or a dist file checksum does not match the canonical manifest');
    if (recorded.artifact?.sha256 !== actual.artifact.sha256) fail('dist aggregate checksum does not match the canonical manifest');
  }
}

if (errors.length > 0) {
  console.error('ERROR: canonical artifact verification failed:');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('Run the canonical build exactly:');
  console.error(`  ${CANONICAL_BUILD_COMMAND}`);
  console.error('Then update the committed manifest with:');
  console.error('  npm run artifact:manifest');
  process.exit(1);
}

const releaseCommit = process.env.RELEASE_COMMIT;
if (releaseCommit !== undefined && contractOnly) {
  // A release is the one place the recorded checksums have to be the reason the
  // release is allowed. Letting the two combine would make the weaker mode
  // reachable from the path that most needs the stronger one.
  console.error('ERROR: --contract-only cannot be combined with RELEASE_COMMIT');
  process.exit(2);
}
if (releaseCommit !== undefined) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (head !== releaseCommit) {
    console.error(`ERROR: release source SHA ${head} does not match qualified SHA ${releaseCommit}`);
    process.exit(1);
  }
  if (process.env.GITHUB_OUTPUT !== undefined) {
    const bundle = actual.artifact.files.find((entry) => entry.path === 'dist/commitlore.mjs');
    if (bundle === undefined) throw new Error('dist/commitlore.mjs is absent from the artifact digest');
    writeFileSync(process.env.GITHUB_OUTPUT, `source_sha=${head}\nartifact_sha256=${bundle.sha256}\n`, { flag: 'a' });
  }
  console.log(`canonical artifact provenance: source ${head}, artifact ${actual.artifact.sha256}`);
} else {
  // Named differently on purpose. A reader scanning a log for "canonical
  // artifact verified" must not find it on a run that never compared the
  // recorded checksums.
  console.log(
    contractOnly
      ? `canonical artifact contract intact (checksums not compared): ${actual.artifact.sha256}`
      : `canonical artifact verified: ${actual.artifact.sha256}`,
  );
}
