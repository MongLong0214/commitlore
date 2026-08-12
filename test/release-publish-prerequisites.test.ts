/**
 * Release publication is deliberately tested outside Actions. A tag can be
 * syntactically valid while naming a dev-only commit, and a local test run can
 * be green while the CI record for that exact commit is absent or failed. Both
 * are facts GitHub's YAML cannot safely infer with an `if:` expression.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REQUIRED_CHECKS } from '../scripts/check-exact-head-ci.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const RELEASE_TARGET = join(REPO_ROOT, 'scripts', 'check-release-target.mjs');
const EXACT_HEAD_CI = join(REPO_ROOT, 'scripts', 'check-exact-head-ci.mjs');
const RELEASE_WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'release.yml');

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-release-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[]): string => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout;
};

const commit = (repo: string, path: string, contents: string, message: string): string => {
  writeFileSync(join(repo, path), contents);
  git(repo, ['add', path]);
  git(repo, ['-c', 'user.name=Release gate', '-c', 'user.email=release-gate@example.invalid', 'commit', '--quiet', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
};

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const run = (script: string, args: string[], cwd = REPO_ROOT): RunResult => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', shell: false });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

let repo: string;
let remote: string;
let mainSha: string;
let sideSha: string;

beforeAll(() => {
  repo = tempDir('source');
  remote = tempDir('remote.git');
  git(REPO_ROOT, ['init', '--quiet', '--initial-branch=main', repo]);
  mainSha = commit(repo, 'main.txt', 'on main\n', 'main commit');

  git(repo, ['checkout', '--quiet', '-b', 'dev']);
  sideSha = commit(repo, 'dev.txt', 'dev only\n', 'dev commit');
  git(repo, ['tag', 'v9.9.9']);

  git(repo, ['checkout', '--quiet', 'main']);
  git(repo, ['init', '--quiet', '--bare', remote]);
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '--quiet', '--all', 'origin']);
  git(repo, ['push', '--quiet', '--tags', 'origin']);
});

describe('the tagged commit is in main history', () => {
  it('accepts a commit that is on the target branch', () => {
    const result = run(RELEASE_TARGET, [mainSha, 'main'], repo);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('release target accepted');
  });

  it('refuses a commit that is only on a side branch', () => {
    const result = run(RELEASE_TARGET, [sideSha, 'main'], repo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not contained in target branch');
  });

  it('refuses a tag that points only at dev', () => {
    const result = run(RELEASE_TARGET, ['v9.9.9', 'main'], repo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not contained in target branch');
  });

  it('refuses a shallow clone rather than guessing from its truncated history', () => {
    const shallow = join(tempDir('shallow-parent'), 'clone');
    git(REPO_ROOT, ['clone', '--quiet', '--depth', '1', '--branch', 'main', `file://${remote}`, shallow]);

    const result = run(RELEASE_TARGET, ['HEAD', 'main'], shallow);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('shallow repository');
  });
});

const RELEASE_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

interface CheckRun {
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  app: { slug: string } | null;
}

const successfulPayload = (): { check_runs: CheckRun[] } => ({
  check_runs: REQUIRED_CHECKS.map((name) => ({
    name,
    head_sha: RELEASE_SHA,
    status: 'completed',
    conclusion: 'success',
    app: { slug: 'github-actions' },
  })),
});

const runPayload = (payload: unknown): RunResult => {
  const path = join(tempDir('payload'), 'check-runs.json');
  writeFileSync(path, JSON.stringify(payload));
  return run(EXACT_HEAD_CI, ['MongLong0214', 'commitlore', RELEASE_SHA, '--from-file', path]);
};

const rejectedPayload = (payload: unknown, detail: string): void => {
  const result = runPayload(payload);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(detail);
};

describe('the required CI checks passed at the exact tagged SHA', () => {
  it('accepts only a complete set of successful required checks', () => {
    const result = runPayload(successfulPayload());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('exact-head CI accepted');
  });

  it('refuses a required check that failed', () => {
    const payload = successfulPayload();
    payload.check_runs[0]!.conclusion = 'failure';
    rejectedPayload(payload, 'conclusion "failure"');
  });

  it('refuses a required check that was cancelled', () => {
    const payload = successfulPayload();
    payload.check_runs[0]!.conclusion = 'cancelled';
    rejectedPayload(payload, 'conclusion "cancelled"');
  });

  it('refuses a required check that timed out', () => {
    const payload = successfulPayload();
    payload.check_runs[0]!.conclusion = 'timed_out';
    rejectedPayload(payload, 'conclusion "timed_out"');
  });

  it('refuses a required check that was skipped', () => {
    const payload = successfulPayload();
    payload.check_runs[0]!.conclusion = 'skipped';
    rejectedPayload(payload, 'conclusion "skipped"');
  });

  it('refuses a required check that is still in progress', () => {
    const payload = successfulPayload();
    payload.check_runs[0]!.status = 'in_progress';
    payload.check_runs[0]!.conclusion = null;
    rejectedPayload(payload, 'status "in_progress"');
  });

  it('refuses a payload that omits one required check entirely', () => {
    const payload = successfulPayload();
    payload.check_runs = payload.check_runs.slice(1);
    rejectedPayload(payload, 'required check is absent');
  });

  it('refuses an empty payload', () => {
    rejectedPayload({ check_runs: [] }, 'required check is absent');
  });

  it('refuses successes reported for a different SHA', () => {
    const payload = successfulPayload();
    for (const check of payload.check_runs) check.head_sha = OTHER_SHA;
    rejectedPayload(payload, 'head SHA');
  });

  // A check run's name says nothing about who created it. Any GitHub App
  // installed on the repository can post one under a required check's name and
  // conclude it `success`; matching on the name alone took that for CI (#571).
  it('refuses a required check reported by an app other than Actions', () => {
    const payload = successfulPayload();
    payload.check_runs[0]!.app = { slug: 'some-other-app' };
    rejectedPayload(payload, 'reported by app "some-other-app"');
  });

  it('refuses a required check with no app attributed at all', () => {
    const payload = successfulPayload();
    payload.check_runs[0]!.app = null;
    rejectedPayload(payload, 'reported by app "none"');
  });

  // The impersonation must not be able to stand in for the real run: with the
  // genuine check absent, a look-alike leaves the required check unsatisfied.
  it('does not let a look-alike check substitute for the genuine one', () => {
    const payload = successfulPayload();
    payload.check_runs[0]!.app = { slug: 'some-other-app' };
    const result = runPayload(payload);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('required check is absent');
  });

  // ...and must not be able to hide behind it either: a genuine success plus a
  // forged duplicate is still a refusal, so an attacker cannot add noise to a
  // passing set and have it pass anyway.
  it('refuses a forged duplicate alongside a genuine success', () => {
    const payload = successfulPayload();
    payload.check_runs.push({
      ...payload.check_runs[0]!,
      app: { slug: 'some-other-app' },
      conclusion: 'success',
    });
    rejectedPayload(payload, 'reported by app "some-other-app"');
  });
});

describe('publication has no path around a failed prerequisite', () => {
  const publish = () => {
    const workflow = load(readFileSync(RELEASE_WORKFLOW, 'utf8')) as {
      jobs: Record<string, { needs?: string[]; if?: string }>;
    };
    return workflow.jobs.publish;
  };

  it('needs all four release prerequisites', () => {
    expect(publish().needs).toEqual([
      'version-consistency',
      'install-gate',
      'release-target',
      'exact-head-ci',
    ]);
  });

  it('has no if condition that bypasses any of the four prerequisite failures', () => {
    const job = publish();
    // An omitted need is itself a bypass: GitHub cannot withhold publication
    // for a job it was never asked to wait for. Assert the complete dependency
    // set here as well as the absence of an `always()`-style escape hatch.
    expect(job.needs).toEqual([
      'version-consistency',
      'install-gate',
      'release-target',
      'exact-head-ci',
    ]);
    expect(job.if).toBeUndefined();
  });
});
