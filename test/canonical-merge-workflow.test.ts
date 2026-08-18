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
  it('checks the bundle against a merge it recomputes, rather than trusting it', () => {
    // The rebuild job executes a contributor's `package.json` and every
    // lifecycle script `npm ci` pulls in. Anything that runs there can add a
    // commit touching `src/`, `scripts/` or `.github/` before the bundle is
    // written, and the publishing job would force-push it under the App's
    // identity for a reviewer to read as a rebuild.
    //
    // So the second job recomputes the merge from `main` and the pull request
    // ref -- neither writable from the first job -- and allows a difference
    // only inside `dist/` and the manifest.
    const publishJob = code().slice(code().indexOf('  publish:'));
    expect(publishJob).toContain('git merge-tree --write-tree');
    expect(publishJob).toMatch(/git diff --name-only "\$expected" "\$tip"/);
    expect(publishJob).toContain("':(exclude)dist'");
    expect(publishJob).toContain("':(exclude)installer/canonical-artifact.json'");
    // Both parents pinned: a bundle whose branch is not a merge of exactly
    // those two commits is a different history wearing the same branch name.
    expect(publishJob).toMatch(/git rev-list --parents -n1 "\$tip"/);
  });

  it('refuses a pull request that moved while the rebuild ran, not only a moved main', () => {
    // A force-push between the first job's fetch and the push would leave the
    // canonical pull request carrying a head nobody reviewed while #N displays
    // something else.
    const publishJob = code().slice(code().indexOf('  publish:'));
    expect(publishJob).toMatch(/pulls\/\$\{PR\}" --jq \.head\.sha/);
    expect(publishJob).toContain('while this rebuilt -- rerun it');
    expect(publishJob).toContain('commits/main');
  });

  it('reads the pushed ref back by sha instead of trusting the push exit code', () => {
    // `git push` exiting zero says the push was accepted, not that the branch
    // is still what this run put there.
    const publishJob = code().slice(code().indexOf('  publish:'));
    expect(publishJob).toMatch(/git\/ref\/heads\/\$branch" --jq \.object\.sha/);
    expect(publishJob).toContain('not the $expected this pushed');
  });

  it('opens the canonical pull request with no closing keyword in its body', () => {
    // T-1502's acceptance is that the source pull request ends up *merged*.
    // A closing keyword produces the opposite: GitHub records a pull request
    // closed by keyword as closed, with `mergedAt` null, and there is no API
    // to convert that afterwards. Reachability is what closes it as merged,
    // and reachability needs no keyword.
    //
    // Measured on #752 during the 1.1.3 release: one integration pull request
    // body said "GitHub closes #752, #755, #756 ... as merged". The keyword
    // bound to #752 alone, so that one was recorded closed while the five with
    // no keyword were recorded merged -- the sentence describing the outcome
    // is what denied it. This workflow would have reproduced that every run.
    const body = code();
    const printf = /--body "\$\(printf '([\s\S]*?)'\s/.exec(body);
    expect(printf, 'the gh pr create body is not a printf literal any more').not.toBeNull();

    const rendered = (printf as RegExpExecArray)[1].replace(/\\n/g, '\n').replace(/%s/g, '123');
    const keyword = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d+/i.exec(rendered);
    expect(
      keyword,
      `the generated body carries a closing keyword (${keyword?.[0]}); it would close the source pull request as closed rather than merged`,
    ).toBeNull();
  });

  it('mints the App token in a job that never ran contributor code', () => {
    // Step order inside one job is not a boundary. `$GITHUB_ENV` and
    // `$GITHUB_PATH` written during `npm ci` persist into every later step of
    // the same job, so a dependency lifecycle script can set `NODE_OPTIONS` or
    // put its own `git` on `PATH` and be running inside the step that holds the
    // App key -- whichever file that step chose to execute. Extracting the
    // credential script from `main` fixed *what* ran, not *how it was launched*.
    const body = code();
    const rebuildJob = body.slice(body.indexOf('  canonicalise:'), body.indexOf('  publish:'));
    const publishJob = body.slice(body.indexOf('  publish:'));

    expect(rebuildJob, 'the rebuild job can reach the App key').not.toContain('COMMITLORE_BOT_KEY');
    expect(rebuildJob).not.toContain('app-installation-token.mjs');
    expect(publishJob, 'the publishing job runs npm').not.toMatch(/\bnpm (ci|run)\b/);
    expect(publishJob).toContain('app-installation-token.mjs');
  });

  it('hands the tree over as bytes rather than by rerunning the build', () => {
    // A bundle moves the commits the first job produced. Rebuilding in the
    // second job would put contributor code back on the runner that holds the
    // credential, which is the boundary this exists to keep.
    const body = code();
    expect(body).toContain('git bundle create');
    expect(body).toMatch(/needs:\s*canonicalise/);
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

  it('runs the credential script from main, never from the merged tree', () => {
    // The sharpest hole the first version had. `scripts/` is source, so a
    // source-only pull request may change `app-installation-token.mjs` — and
    // the step that runs it has `COMMITLORE_BOT_KEY` in its environment.
    // Running the merged copy would hand the App private key to whatever the
    // pull request made that file into, without needing a `postinstall` at all.
    const body = code();
    expect(body).toMatch(/git show "\$\{\{ steps\.take\.outputs\.base \}\}:scripts\/app-installation-token\.mjs"/);
    // And not from the workspace.
    expect(body).not.toMatch(/node scripts\/app-installation-token\.mjs/);
  });

  it('reads main\'s sha before the rebuild, and carries it across the job boundary', () => {
    // The rebuild executes contributor code in this workspace, so a value read
    // from `.git` afterwards is a value that code had the chance to choose.
    expect(lineOf('base=$(git rev-parse origin/main)')).toBeLessThan(lineOf('build:canonical'));
    // And the second job takes it from the artifact rather than re-deriving it
    // in a workspace the first job could have edited.
    expect(code()).toContain('cat /tmp/canonical/canonical.base');
  });

  it('does not persist the Actions credential over the App token', () => {
    expect(code()).toContain('persist-credentials: false');
  });

  it('refuses when main moved while the rebuild ran', () => {
    // The concurrency group orders jobs, not merges: a rebuild is of `main` as
    // it stood when the job started, and nothing stops another pull request
    // landing in between. Without this the job would open a pull request whose
    // bundle is of a tree that is no longer anybody's.
    // Anchored on the publishing job's own step. Both jobs check that main
    // stood still, so a substring that matches either one asserts nothing about
    // the order of the second -- and renaming the publishing step is exactly
    // when this assertion needs to notice.
    const body = code();
    expect(body).toContain('Refuse if either side moved while the rebuild ran');
    expect(lineOf('Refuse if either side moved while the rebuild ran')).toBeLessThan(
      lineOf('app-installation-token.mjs'),
    );
    expect(lineOf('The bundle differs from an honest merge only where a rebuild may')).toBeLessThan(
      lineOf('app-installation-token.mjs'),
    );
  });

  it('replaces its branch rather than updating it', () => {
    // `.gitattributes` marks `dist/**` as `-merge`, so an update would conflict
    // on the one file this job exists to produce. A rerun force-pushes.
    expect(code()).toMatch(/git push --quiet --force/);
  });

  it('merges the pull request head in, so a merge commit closes it', () => {
    // T-1502 asks that "a source-only pull request merges". This job does not
    // merge it -- it opens a second pull request -- so the wording is satisfied
    // by what lands rather than by what is clicked: the branch merges the
    // contributor's head with `--no-ff`, so that commit is an ancestor here.
    // A merge commit lands it on `main` and GitHub closes their pull request as
    // merged. A squash lands new bytes and leaves it open with nothing to point
    // at, which is why the instruction is in the body the bot writes.
    const body = code();
    expect(body).toMatch(/git merge --no-ff/);
    expect(body).toMatch(/merge commit, not a squash/);
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
