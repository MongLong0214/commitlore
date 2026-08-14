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

import {
  CI_EVENT,
  CI_WORKFLOW_NAME,
  CI_WORKFLOW_PATH,
  REQUIRED_CHECKS,
  workflowIntegrityProblems,
} from '../scripts/check-exact-head-ci.mjs';

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

interface WorkflowJob {
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface WorkflowEvidence {
  workflow: { id: number; path: string; name: string };
  workflow_runs: Array<{
    id: number;
    workflow_id: number;
    path: string;
    name: string;
    event: string;
    head_sha: string;
    run_attempt: number;
    status: string;
    conclusion: string | null;
  }>;
  jobs: Record<string, { jobs: WorkflowJob[] }>;
}

const RUN_ID = 607;
const RUN_ATTEMPT = 1;
const runKey = () => `${RUN_ID}:${RUN_ATTEMPT}`;

const successfulPayload = (): WorkflowEvidence => ({
  workflow: { id: 42, path: CI_WORKFLOW_PATH, name: CI_WORKFLOW_NAME },
  workflow_runs: [{
    id: RUN_ID,
    workflow_id: 42,
    path: `${CI_WORKFLOW_PATH}@refs/heads/main`,
    name: CI_WORKFLOW_NAME,
    event: CI_EVENT,
    head_sha: RELEASE_SHA,
    run_attempt: RUN_ATTEMPT,
    status: 'completed',
    conclusion: 'success',
  }],
  jobs: {
    [runKey()]: {
      jobs: REQUIRED_CHECKS.map((name) => ({
        name,
        head_sha: RELEASE_SHA,
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T00:01:00Z',
      })),
    },
  },
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

describe('the required CI workflow ran at the exact tagged SHA', () => {
  const jobs = (payload: WorkflowEvidence) => payload.jobs[runKey()]!.jobs;

  it('accepts a complete successful CI workflow run and its exact job attempt', () => {
    const result = runPayload(successfulPayload());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('exact-head CI accepted');
    expect(result.stdout).toContain(`attempt ${RUN_ATTEMPT}`);
  });

  it('refuses a required job that failed', () => {
    const payload = successfulPayload();
    jobs(payload)[0]!.conclusion = 'failure';
    rejectedPayload(payload, 'conclusion "failure"');
  });

  it('refuses a required job that was cancelled', () => {
    const payload = successfulPayload();
    jobs(payload)[0]!.conclusion = 'cancelled';
    rejectedPayload(payload, 'conclusion "cancelled"');
  });

  it('refuses a required job that timed out', () => {
    const payload = successfulPayload();
    jobs(payload)[0]!.conclusion = 'timed_out';
    rejectedPayload(payload, 'conclusion "timed_out"');
  });

  it.each(['skipped', 'neutral'])('refuses a required job that was %s', (conclusion) => {
    const payload = successfulPayload();
    jobs(payload)[0]!.conclusion = conclusion;
    rejectedPayload(payload, `conclusion "${conclusion}"`);
  });

  it('refuses a required job that is still in progress', () => {
    const payload = successfulPayload();
    jobs(payload)[0]!.status = 'in_progress';
    jobs(payload)[0]!.conclusion = null;
    rejectedPayload(payload, 'status "in_progress"');
  });

  it('refuses a payload that omits one required job entirely', () => {
    const payload = successfulPayload();
    payload.jobs[runKey()]!.jobs = jobs(payload).slice(1);
    rejectedPayload(payload, 'required job is absent');
  });

  it('refuses a workflow evidence payload with no run', () => {
    const payload = successfulPayload();
    payload.workflow_runs = [];
    rejectedPayload(payload, 'required CI workflow run is absent');
  });

  it('refuses a workflow run or job reported for a different SHA', () => {
    const payload = successfulPayload();
    payload.workflow_runs[0]!.head_sha = OTHER_SHA;
    for (const job of jobs(payload)) job.head_sha = OTHER_SHA;
    rejectedPayload(payload, 'head SHA');
  });

  it.each([
    ['workflow ID', (payload: WorkflowEvidence) => { payload.workflow_runs[0]!.workflow_id = 999; }],
    ['path', (payload: WorkflowEvidence) => { payload.workflow_runs[0]!.path = '.github/workflows/other.yml@main'; }],
    ['name', (payload: WorkflowEvidence) => { payload.workflow_runs[0]!.name = 'Other CI'; }],
    ['event', (payload: WorkflowEvidence) => { payload.workflow_runs[0]!.event = 'workflow_dispatch'; }],
    ['run attempt', (payload: WorkflowEvidence) => { payload.workflow_runs[0]!.run_attempt = 0; }],
  ])('binds the verdict to CI workflow %s', (field, mutate) => {
    const payload = successfulPayload();
    mutate(payload);
    rejectedPayload(payload, field);
  });

  it('rejects same-name job successes from a different workflow', () => {
    const payload = successfulPayload();
    payload.workflow_runs[0]!.workflow_id = 999;
    payload.workflow_runs[0]!.path = '.github/workflows/counterfeit.yml@main';
    rejectedPayload(payload, 'workflow ID "999"');
  });

  it('rejects the ten invented github-actions check-run successes from the original attack', () => {
    const result = runPayload({
      check_runs: REQUIRED_CHECKS.map((name) => ({
        name,
        head_sha: RELEASE_SHA,
        status: 'completed',
        conclusion: 'success',
        app: { slug: 'github-actions' },
      })),
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('does not contain a workflow object');
  });

  it('refuses a job without recorded execution timestamps', () => {
    const payload = successfulPayload();
    jobs(payload)[0]!.started_at = null;
    const result = runPayload(payload);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no recorded execution timestamps');
  });

  it('rejects a no-op replacement of the reviewed CI workflow body', () => {
    const source = readFileSync(join(REPO_ROOT, CI_WORKFLOW_PATH), 'utf8');
    const noOp = source.replace('run: npm audit --omit=dev --audit-level=low', 'run: true');

    expect(noOp).not.toBe(source);
    expect(workflowIntegrityProblems(source)).toEqual([]);
    expect(workflowIntegrityProblems(noOp)).toContainEqual(expect.stringContaining('expected reviewed workflow'));
  });
});

/**
 * The gate's list is fixed on purpose — presence cannot define the requirement,
 * or a check that failed to report would define itself away. The cost is that
 * it drifts: this release added `audit`, `install-macos` and two
 * `install-alpine` jobs to CI, and the gate kept qualifying releases on the six
 * it already knew. Four jobs could have failed at a tagged commit with the
 * release gate reporting every required check green.
 *
 * So the list stays fixed and this notices when CI grows past it.
 */
describe('the release gate requires every job CI runs on a push', () => {
  /**
   * The check-run names GitHub will actually produce, expanded from the matrix.
   *
   * The first version of this compared a required entry against the job name
   * with `startsWith(`${job} (`)`, which asks only whether the job has *some*
   * entry. `check (banana)` satisfied the job `check`, and deleting
   * `check (24)` left `check (22.12.0)` satisfying it alone — so three of ten
   * legs could drop out of the release gate with both cases green. A name was
   * standing in for the thing it names, which is the defect these very tests
   * were written to catch one layer down.
   */
  const expectedCheckNames = (): string[] => {
    const workflow = load(readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')) as {
      jobs: Record<string, { strategy?: { matrix?: Record<string, unknown> } }>;
    };
    return Object.entries(workflow.jobs).flatMap(([job, definition]) => {
      const matrix = definition.strategy?.matrix;
      if (matrix === undefined) return [job];
      const axes = Object.entries(matrix).filter(([, values]) => Array.isArray(values));
      if (axes.length === 0) return [job];
      // Every matrix here has a single axis. A second one would change how
      // GitHub composes the name — `job (a, b)` — so refuse rather than guess.
      if (axes.length > 1) {
        throw new Error(`${job} has a multi-axis matrix; this expansion only handles one axis`);
      }
      const [, values] = axes[0] as [string, unknown[]];
      return values.map((value) => `${job} (${String(value)})`);
    });
  };

  it('requires exactly the check runs ci.yml produces, matrix legs included', () => {
    expect([...REQUIRED_CHECKS].sort()).toEqual(expectedCheckNames().sort());
  });

  // The set comparison above subsumes both directions, but each is asserted on
  // its own so a failure says which way it drifted rather than printing two
  // sorted arrays and leaving the reader to diff them.
  it('names every check ci.yml produces', () => {
    const missing = expectedCheckNames().filter((name) => !REQUIRED_CHECKS.includes(name));
    expect(missing).toEqual([]);
  });

  it('names no check ci.yml does not produce', () => {
    const expected = expectedCheckNames();
    const orphaned = REQUIRED_CHECKS.filter((check) => !expected.includes(check));
    expect(orphaned).toEqual([]);
  });

  it('keeps every release-required CI job unconditional and non-empty', () => {
    const workflow = load(readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')) as {
      jobs: Record<string, { if?: unknown; 'continue-on-error'?: unknown; steps?: unknown[] }>;
    };

    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name === 'lint') continue;
      expect(job.if, `${name} may not be skipped`).toBeUndefined();
      expect(job['continue-on-error'], `${name} may not be allowed to fail`).toBeUndefined();
      expect(job.steps, `${name} needs executable work`).toEqual(expect.any(Array));
      expect(job.steps!.length, `${name} may not be empty`).toBeGreaterThan(0);
    }
  });
});

describe('publication has no path around a failed prerequisite', () => {
  const publish = () => {
    const workflow = load(readFileSync(RELEASE_WORKFLOW, 'utf8')) as {
      jobs: Record<string, { needs?: string[]; if?: string }>;
    };
    return workflow.jobs.publish;
  };

  it('needs all five release prerequisites', () => {
    expect(publish().needs).toEqual([
      'version-consistency',
      'install-gate',
      'release-target',
      'exact-head-ci',
      'canonical-artifact',
    ]);
  });

  it('has no if condition that bypasses any of the five prerequisite failures', () => {
    const job = publish();
    // An omitted need is itself a bypass: GitHub cannot withhold publication
    // for a job it was never asked to wait for. Assert the complete dependency
    // set here as well as the absence of an `always()`-style escape hatch.
    expect(job.needs).toEqual([
      'version-consistency',
      'install-gate',
      'release-target',
      'exact-head-ci',
      'canonical-artifact',
    ]);
    expect(job.if).toBeUndefined();
  });
});
