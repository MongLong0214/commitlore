/**
 * T-1502 (#719): the safety properties of `canonical-merge.yml`, read from the
 * file rather than trusted.
 *
 * Comment lines are stripped before every assertion. The workflow explains
 * itself at length and a property satisfied by its own explanation is not
 * satisfied — that is the shape `test/preserve-workflow-safety.test.ts`
 * established for the same reason (#723).
 *
 * The property that matters most here has no equivalent in that file. This job
 * rebuilds a contributor's change, which means it executes their `package.json`
 * and their build scripts. If the App token were minted before that step, a
 * pull request could read the credential that lets it push to this repository.
 * The order of two steps is the whole guard.
 */

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = join(REPO_ROOT, '.github', 'workflows', 'canonical-merge.yml');

/** The workflow with every comment line removed, so prose cannot satisfy a check. */
const code = (): string =>
  readFileSync(PATH, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

const lineOf = (needle: string): number => {
  const index = code().split('\n').findIndex((l) => l.includes(needle));
  expect(index, `not found in the workflow: ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
};

describe('T-1502 canonical-merge.yml safety', () => {
  it('mints the App token only after the contributor code has already run', () => {
    // The rebuild runs `npm ci` and `build:canonical` on the merged tree, which
    // executes whatever the pull request put in `package.json`. Minting first
    // would put a credential that can push to this repository into that
    // environment.
    expect(lineOf('build:canonical')).toBeLessThan(lineOf('app-installation-token.mjs'));
  });

  it('does not put the App token in the rebuild step', () => {
    const body = code();
    const rebuild = body.slice(body.indexOf('Rebuild the bundle'), body.indexOf('Refuse if main moved'));
    expect(rebuild).not.toContain('COMMITLORE_BOT_KEY');
    expect(rebuild).not.toContain('steps.token.outputs.token');
  });

  it('never echoes the token', () => {
    const body = code();
    expect(body).toContain('::add-mask::');
    // The only permitted use is the masked capture and the push URL.
    for (const line of body.split('\n')) {
      if (!line.includes('steps.token.outputs.token')) continue;
      expect(line).toMatch(/GH_TOKEN:|x-access-token/);
    }
  });

  it('refuses a pull request that is not source-only, before executing it', () => {
    const body = code();
    expect(body).toMatch(/\^\(dist\/\|installer\/canonical-artifact/);
    expect(body).toContain('.github/workflows/');
    expect(lineOf('Refuse anything that is not a source-only')).toBeLessThan(
      lineOf('Rebuild the bundle'),
    );
  });

  it('rebuilds with build:canonical rather than a local build', () => {
    // A local `npm run build` produces bytes from whatever platform the runner
    // is, and the committed bundle is defined by the Docker build.
    expect(code()).toContain('npm run build:canonical');
    expect(code()).toContain('npm run artifact:verify');
  });

  it('checks out main, never the pull request head', () => {
    const body = code();
    expect(body).toMatch(/ref:\s*main/);
    // Fetched into a local ref and merged; never checked out and run directly.
    expect(body).toContain('git fetch --quiet origin "pull/${PR}/head:pr-${PR}"');
    expect(body).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request\.head/);
  });

  it('does not persist the Actions credential over the App token', () => {
    expect(code()).toContain('persist-credentials: false');
  });

  it('refuses when main moved while the rebuild ran', () => {
    // The concurrency group orders jobs, not merges: a rebuild is of `main` as
    // it stood when the job started, and nothing stops another pull request
    // landing in between. Without this the job would open a pull request whose
    // bundle is of a tree that is no longer anybody's.
    const body = code();
    expect(body).toContain('Refuse if main moved');
    expect(lineOf('Refuse if main moved')).toBeLessThan(lineOf('app-installation-token.mjs'));
  });

  it('replaces its branch rather than updating it', () => {
    // `.gitattributes` marks `dist/**` as `-merge`, so an update would conflict
    // on the one file this job exists to produce. A rerun force-pushes.
    expect(code()).toMatch(/git push --quiet --force/);
  });

  it('requests no permission beyond reading', () => {
    expect(code()).toMatch(/permissions:\s*\n\s*contents:\s*read/);
  });

  it('is run by hand, not by a pull request event', () => {
    // An automatic trigger would let a fork's push decide when this
    // repository's App token is in an environment building that fork's code.
    const body = code();
    expect(body).toMatch(/on:\s*\n\s*workflow_dispatch:/);
    expect(body).not.toMatch(/^\s*pull_request(_target)?:/m);
  });
});
