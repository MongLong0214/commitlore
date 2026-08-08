#!/usr/bin/env node
/**
 * Refuses a release tag whose commit is not part of the target branch.
 *
 * A matching version proves only that a tag and package describe the same
 * bytes. It does not prove those bytes are the promoted mainline: a dev-only
 * commit can report exactly the version a release expects. This gate asks git
 * the stronger question before publication begins.
 *
 * Usage:
 *   node scripts/check-release-target.mjs <tag-or-sha> <target-branch> [--github-output]
 *
 * Exit codes follow SPEC §10:
 *   0  the resolved commit is contained in the target branch
 *   1  the resolved commit is not contained in the target branch
 *   2  git could not resolve an input or inspect the repository
 *   3  the checkout is shallow, so the ancestry answer would be incomplete
 *
 * `--github-output` writes the resolved commit as `sha` to GITHUB_OUTPUT after
 * a passing ancestry check. The following exact-head CI job consumes that
 * value, so it queries the commit behind an annotated tag rather than relying
 * on the tag object SHA supplied by an event implementation.
 */

import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const usage = () => {
  console.error('usage: node scripts/check-release-target.mjs <tag-or-sha> <target-branch> [--github-output]');
  process.exit(2);
};

const args = process.argv.slice(2);
const githubOutput = args.at(-1) === '--github-output';
if (githubOutput) args.pop();
if (args.length !== 2) usage();

const [releaseRef, targetBranch] = args;
if (!releaseRef || !targetBranch) usage();

const git = (args) =>
  spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  });

const resolveCommit = (revision, label) => {
  const result = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`]);
  if (result.status !== 0) {
    console.error(`ERROR: cannot resolve ${label} "${revision}" to a commit.`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(2);
  }
  return result.stdout.trim();
};

// A shallow clone can make `merge-base --is-ancestor` answer from an
// incomplete graph. Equality may happen to be visible, but that is not proof
// of the requested history relation; fail explicitly rather than treating the
// partial answer as a pass.
const shallow = git(['rev-parse', '--is-shallow-repository']);
if (shallow.status !== 0) {
  console.error('ERROR: cannot determine whether this checkout has complete history.');
  if (shallow.stderr) console.error(shallow.stderr.trim());
  process.exit(2);
}
if (shallow.stdout.trim() !== 'false') {
  console.error('ERROR: cannot establish release ancestry from a shallow repository.');
  console.error('  The release checkout must use fetch-depth: 0 before checking main ancestry.');
  process.exit(3);
}

const releaseCommit = resolveCommit(releaseRef, 'release tag or SHA');

// A tag checkout normally has `origin/main`, not a local `main` branch. A
// throwaway/local repository normally has the reverse. Prefer the remote
// tracking ref when both exist: it is the branch the release workflow fetched.
const targetCandidates = targetBranch.startsWith('refs/')
  ? [targetBranch]
  : [`refs/remotes/origin/${targetBranch}`, `refs/heads/${targetBranch}`, targetBranch];

let targetCommit = null;
let targetRef = null;
for (const candidate of targetCandidates) {
  const result = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${candidate}^{commit}`]);
  if (result.status === 0) {
    targetCommit = result.stdout.trim();
    targetRef = candidate;
    break;
  }
}
if (targetCommit === null || targetRef === null) {
  console.error(`ERROR: cannot resolve target branch "${targetBranch}" in this checkout.`);
  console.error('  Fetch the target branch and its full history before asking the ancestry gate.');
  process.exit(2);
}

const ancestry = git(['merge-base', '--is-ancestor', releaseCommit, targetCommit]);
if (ancestry.status === 1) {
  console.error(`ERROR: release commit ${releaseCommit} is not contained in target branch "${targetBranch}" (${targetRef}).`);
  console.error('  Refusing to publish a tag that has not reached the release branch.');
  process.exit(1);
}
if (ancestry.status !== 0) {
  console.error(`ERROR: git could not determine whether ${releaseCommit} is an ancestor of ${targetRef}.`);
  if (ancestry.stderr) console.error(ancestry.stderr.trim());
  process.exit(2);
}

if (githubOutput) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.error('ERROR: --github-output requires the GITHUB_OUTPUT environment variable.');
    process.exit(2);
  }
  try {
    appendFileSync(outputPath, `sha=${releaseCommit}\n`);
  } catch (error) {
    console.error(`ERROR: could not write the resolved release SHA to GITHUB_OUTPUT: ${error.message}`);
    process.exit(2);
  }
}

console.log(`release target accepted: ${releaseRef} resolves to ${releaseCommit} and is contained in target branch "${targetBranch}" (${targetRef})`);
