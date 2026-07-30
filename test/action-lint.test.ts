/**
 * T-601 acceptance criteria, for the parts of a GitHub Action that can be held
 * to one without a GitHub.
 *
 * The action is three pieces, and each is checked where it can be checked:
 *
 *   - `lint.mjs` runs against throwaway repositories under `os.tmpdir()`, with
 *     the real CLI and real git. Nothing here touches a network or the
 *     repository the suite runs in.
 *   - `comment.mjs` runs against a stub of the three GitHub calls it makes, so
 *     the upsert -- the difference between one comment and one comment per
 *     push -- is a decision with a test rather than a line in a YAML string.
 *   - `action.yml` is parsed, not read. An input that is declared and never
 *     used is a promise the action does not keep.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MARKER, buildComment, upsertComment } from '../action/lint/comment.mjs';
import { createTestRepo } from './git-fixtures.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const ACTION_DIR = fileURLToPath(new URL('../action/lint/', import.meta.url));
const LINT = join(ACTION_DIR, 'lint.mjs');
const ACTION_YML = join(ACTION_DIR, 'action.yml');
const DEMO_WORKFLOW = fileURLToPath(new URL('../.github/workflows/demo-lint.yml', import.meta.url));

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** `realpathSync` because macOS reports `/var` for a `/private/var` tmpdir. */
const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-action-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[], input = ''): string => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, input });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout;
};

const initRepo = (label: string): string => {
  const dir = tempDir(label);
  return createTestRepo({ path: dir });
};

const commit = (dir: string, path: string, contents: string, message: string): void => {
  writeFileSync(join(dir, path), contents);
  git(dir, ['add', path]);
  git(dir, ['commit', '--quiet', '-F', '-'], message);
};

const RECORD_ON_MAIN = [
  'Add the widget',
  '',
  'Limit: the widget renders at most 50 rows before the browser stalls',
  'Ruled-out: virtualised list | it drops the print layout the finance team uses',
  'Warn: do not raise the row cap without re-running the print check',
  'Blast: module',
  'Record-Id: r-000001',
  'CommitLore-Version: 2.0.0',
  '',
].join('\n');

const CLEAN_RECORD = [
  'Widen the widget row cap',
  '',
  'Limit: 80 rows is where the print layout starts paginating',
  'Blast: local',
  'Record-Id: r-000002',
  'CommitLore-Version: 2.0.0',
  '',
].join('\n');

/** `Blast` is an enum (SPEC §6); `wide` is not one of its values. */
const BAD_RECORD = [
  'Widen the widget row cap',
  '',
  'Limit: 80 rows is where the print layout starts paginating',
  'Blast: wide',
  'Record-Id: r-000003',
  'CommitLore-Version: 2.0.0',
  '',
].join('\n');

interface LintRun {
  status: number | null;
  stdout: string;
  stderr: string;
  outputs: Record<string, string>;
  body: string;
}

const parseOutputs = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );

const runLint = (repo: string, env: Record<string, string> = {}): LintRun => {
  const runnerTemp = tempDir('runner');
  const outputFile = join(runnerTemp, 'github-output');
  writeFileSync(outputFile, '');

  const result = spawnSync(process.execPath, [LINT], {
    cwd: repo,
    shell: false,
    encoding: 'utf8',
    env: {
      ...process.env,
      COMMITLORE_WORKSPACE: repo,
      COMMITLORE_CLI: CLI,
      COMMITLORE_BASE_REF: 'main',
      GITHUB_OUTPUT: outputFile,
      RUNNER_TEMP: runnerTemp,
      ...env,
    },
  });

  const outputs = parseOutputs(readFileSync(outputFile, 'utf8'));
  const bodyFile = outputs['body-file'];
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    outputs,
    body: bodyFile === undefined ? '' : readFileSync(bodyFile, 'utf8'),
  };
};

let repo = '';
let shallow = '';

beforeAll(() => {
  const build = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], {
    shell: false,
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  if (build.status !== 0) {
    throw new Error(`tsc build failed (exit ${build.status}):\n${build.stdout}${build.stderr}`);
  }

  repo = initRepo('pr');
  commit(repo, 'widget.ts', 'export const widget = 1;\n', RECORD_ON_MAIN);

  git(repo, ['checkout', '--quiet', '-b', 'clean']);
  commit(repo, 'widget.ts', 'export const widget = 2;\n', CLEAN_RECORD);

  git(repo, ['checkout', '--quiet', 'main']);
  git(repo, ['checkout', '--quiet', '-b', 'bad']);
  commit(repo, 'widget.ts', 'export const widget = 3;\n', BAD_RECORD);
  git(repo, ['checkout', '--quiet', 'main']);

  // A depth-1 clone over file:// is the same truncation `actions/checkout`
  // produces at its default depth.
  shallow = tempDir('shallow-parent');
  createTestRepo({
    path: join(shallow, 'checkout'),
    source: `file://${repo}`,
    depth: 1,
    branch: 'main',
  });
}, 180_000);

describe('lint.mjs against a pull request range', () => {
  it('reports the violation a bad trailer makes, without failing itself', () => {
    const run = runLint(repo, { COMMITLORE_HEAD_REF: 'bad' });

    // Exit 0 with a non-zero count: the comment step runs after this one, and
    // the pull request that fails the lint is the one that needs the comment.
    expect(run.status, run.stderr).toBe(0);
    expect(run.outputs['violations']).toBe('1');
    expect(run.outputs['secrets']).toBe('0');
    expect(run.body).toContain('#### Violations (1)');
    expect(run.body).toContain('enum');
    expect(run.body).toContain('Blast');
  });

  it('reports a clean range as clean', () => {
    const run = runLint(repo, { COMMITLORE_HEAD_REF: 'clean' });

    expect(run.status, run.stderr).toBe(0);
    expect(run.outputs['violations']).toBe('0');
    expect(run.outputs['secrets']).toBe('0');
    expect(run.body).toContain('clean');
    expect(run.body).not.toContain('#### Violations');
  });

  it('summarises the active constraints for the paths the range touches', () => {
    const run = runLint(repo, { COMMITLORE_HEAD_REF: 'clean' });

    expect(run.outputs['changed-paths']).toBe('1');
    expect(Number(run.outputs['records'])).toBeGreaterThan(0);
    expect(run.body).toContain('the widget renders at most 50 rows');
    expect(run.body).toContain('virtualised list');
    expect(run.body).toContain('do not raise the row cap');
  });

  it('refuses a shallow clone instead of linting less history', () => {
    const run = runLint(join(shallow, 'checkout'), { COMMITLORE_HEAD_REF: '' });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('shallow');
    expect(run.stderr).toContain('fetch-depth: 0');
    // Nothing was posted, and nothing reported a count.
    expect(run.body).toBe('');
    expect(run.outputs['violations']).toBeUndefined();
  });

  it('refuses a base ref that is not in the checkout', () => {
    const run = runLint(repo, { COMMITLORE_BASE_REF: 'no-such-branch' });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('no-such-branch');
    expect(run.outputs['violations']).toBeUndefined();
  });
});

interface StubComment {
  id: number;
  body: string;
  user?: { type: string };
  html_url?: string;
}

/** The three calls `upsertComment` is allowed to make, and a log of them. */
const stubApi = (comments: StubComment[]) => {
  const calls: string[] = [];
  return {
    calls,
    comments,
    list: async () => {
      calls.push('list');
      return comments;
    },
    create: async (body: string) => {
      calls.push('create');
      const created = { id: 900, body, html_url: 'https://example.invalid/c/900' };
      comments.push(created);
      return created;
    },
    update: async (id: number, body: string) => {
      calls.push(`update:${id}`);
      const existing = comments.find((comment) => comment.id === id);
      if (existing) existing.body = body;
      return { id, html_url: `https://example.invalid/c/${id}` };
    },
  };
};

describe('the pull request comment', () => {
  it('rewrites the comment a previous run left rather than adding one', async () => {
    const api = stubApi([
      { id: 1, body: 'a human said something' },
      { id: 2, body: `${MARKER}\n### CommitLore — record lint\n\nold body` },
      { id: 3, body: 'another human' },
    ]);

    const result = await upsertComment({ api, body: `${MARKER}\nnew body` });

    expect(result.action).toBe('updated');
    expect(result.id).toBe(2);
    expect(api.calls).toEqual(['list', 'update:2']);
    expect(api.comments).toHaveLength(3);
    expect(api.comments[1]?.body).toContain('new body');
  });

  it('rewrites its own comment, not a person who pasted the marker', async () => {
    const api = stubApi([
      { id: 1, body: `${MARKER}\nquoted in a review`, user: { type: 'User' } },
      { id: 2, body: `${MARKER}\nold body`, user: { type: 'Bot' } },
    ]);

    const result = await upsertComment({ api, body: `${MARKER}\nnew body` });

    expect(result.id).toBe(2);
    expect(api.comments[0]?.body).toContain('quoted in a review');
  });

  it('creates one when the pull request has none', async () => {
    const api = stubApi([{ id: 1, body: 'a human said something' }]);

    const result = await upsertComment({ api, body: `${MARKER}\nfirst body` });

    expect(result.action).toBe('created');
    expect(api.calls).toEqual(['list', 'create']);
    expect(api.comments).toHaveLength(2);
  });

  it('refuses a body that carries no marker, because no run could find it again', async () => {
    const api = stubApi([]);

    await expect(upsertComment({ api, body: 'no marker here' })).rejects.toThrow(/marker/);
    expect(api.calls).toEqual([]);
  });

  it('reports a read-only token instead of failing the run', async () => {
    const forbidden = Object.assign(new Error('Resource not accessible by integration'), {
      status: 403,
    });
    const api = {
      list: async () => [],
      create: async () => {
        throw forbidden;
      },
      update: async () => {
        throw forbidden;
      },
    };

    const result = await upsertComment({ api, body: `${MARKER}\nbody` });

    expect(result.action).toBe('skipped');
    expect(result.reason).toContain('fork');
  });

  it('lets an error that is not a permission problem fail the step', async () => {
    const api = {
      list: async () => {
        throw Object.assign(new Error('boom'), { status: 500 });
      },
      create: async () => ({ id: 1 }),
      update: async () => ({ id: 1 }),
    };

    await expect(upsertComment({ api, body: `${MARKER}\nbody` })).rejects.toThrow('boom');
  });

  it('truncates a body that outgrows the limit, and says that it did', () => {
    const records = Array.from({ length: 200 }, (_, index) => ({
      recordId: `r-${String(index).padStart(6, '0')}`,
      sha: `${index}`.repeat(8).slice(0, 40),
      lifecycle: 'active',
      flags: [],
      trailers: [{ key: 'Limit', value: `constraint number ${index} `.repeat(4) }],
    }));

    const maxChars = 4000;
    const { body, truncated, omitted } = buildComment({
      baseRef: 'origin/main',
      headRef: 'deadbeef',
      commits: 1,
      violations: [],
      secrets: [],
      changedPaths: ['widget.ts'],
      context: { counts: { records: 200, limits: 200, ruledOut: 0, warnings: 0 }, records },
      maxChars,
    });

    expect(truncated).toBe(true);
    expect(omitted).toBeGreaterThan(0);
    expect(body.length).toBeLessThanOrEqual(maxChars);
    expect(body).toContain('Truncated');
    expect(body).toContain('omitted');
    // The verdict and the marker survive truncation -- they are what the next
    // run finds the comment by, and what a reader came for.
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('**Trailers:**');
  });

  it('keeps a short body whole', () => {
    const { body, truncated } = buildComment({
      baseRef: 'origin/main',
      headRef: 'deadbeef',
      commits: 2,
      violations: [],
      secrets: [],
      changedPaths: ['widget.ts'],
      context: { counts: { records: 0, limits: 0, ruledOut: 0, warnings: 0 }, records: [] },
    });

    expect(truncated).toBe(false);
    expect(body).toContain(MARKER);
    expect(body).not.toContain('Truncated');
  });
});

interface ActionStep {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  shell?: string;
  if?: string;
}

interface ActionYml {
  name: string;
  description: string;
  inputs: Record<string, { description: string; default?: string; required?: boolean }>;
  outputs: Record<string, { description: string; value: string }>;
  runs: { using: string; steps: ActionStep[] };
}

describe('action.yml', () => {
  const text = readFileSync(ACTION_YML, 'utf8');
  const action = load(text) as ActionYml;

  it('is a composite action with a description', () => {
    expect(action.runs.using).toBe('composite');
    expect(action.name).toContain('CommitLore');
    expect(action.description.length).toBeGreaterThan(0);
  });

  it('declares the inputs the ticket names', () => {
    for (const input of ['base-ref', 'comment', 'fail-on-violation', 'github-token']) {
      expect(Object.keys(action.inputs), `${input} should be declared`).toContain(input);
    }
  });

  it('uses every input it declares', () => {
    for (const input of Object.keys(action.inputs)) {
      expect(text, `${input} is declared but never used`).toContain(`inputs.${input}`);
    }
  });

  it('describes every input and output', () => {
    for (const [name, spec] of Object.entries({ ...action.inputs, ...action.outputs })) {
      expect(spec.description?.length ?? 0, `${name} needs a description`).toBeGreaterThan(0);
    }
  });

  it('gives every run step a shell', () => {
    for (const step of action.runs.steps) {
      if (step.run !== undefined) expect(step.shell, `${step.id ?? step.name}`).toBe('bash');
    }
  });

  it('makes the check fail on the lint outputs, not on the comment', () => {
    const failing = action.runs.steps.find((step) => step.run?.includes('exit 1'));
    expect(failing?.if).toContain("inputs.fail-on-violation == 'true'");
    expect(failing?.if).toContain('steps.lint.outputs.violations');
    expect(failing?.if).toContain('steps.lint.outputs.secrets');
  });

  it('asks the caller for a full clone and the notes ref', () => {
    expect(text).toContain('fetch-depth: 0');
    expect(text).toContain('refs/notes/commitlore');
    expect(text).toContain('pull-requests: write');
  });

  // A workflow file that does not parse is a workflow GitHub never runs, and
  // the dogfooding would be a file in the repository rather than a check.
  it('is dogfooded by a workflow that parses and does not touch CI', () => {
    const text = readFileSync(DEMO_WORKFLOW, 'utf8');
    const demo = load(text) as {
      on: unknown;
      permissions: Record<string, string>;
      jobs: Record<string, { steps: ActionStep[]; if?: string }>;
    };

    expect(demo.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(Object.keys(demo.jobs)).toHaveLength(2);

    // The PR lint job still uses the action and only runs for pull requests.
    const lintJob = demo.jobs['lint'];
    expect(lintJob).toBeDefined();
    expect(lintJob!.if).toContain('pull_request');
    const lintSteps = lintJob!.steps ?? [];
    expect(lintSteps.some((step) => step.uses === './action/lint')).toBe(true);

    expect(text).toContain('fetch-depth: 0');
  });

  // #186: a push to dev must lint the full promotion range (origin/main..HEAD),
  // not only the PR's own commits. This is what catches duplicate Record-Ids
  // that span two PRs — the narrow PR range hides them.
  it('lints the full promotion range on push to dev (#186)', () => {
    const text = readFileSync(DEMO_WORKFLOW, 'utf8');
    const demo = load(text) as {
      on: { pull_request: unknown; push?: { branches?: string[] } };
      jobs: Record<string, { steps: ActionStep[]; if?: string }>;
    };

    // The push trigger must include dev.
    expect(demo.on.push).toBeDefined();
    expect(demo.on.push!.branches).toContain('dev');

    // The promotion-range-lint job runs only on push.
    const rangeJob = demo.jobs['promotion-range-lint'];
    expect(rangeJob).toBeDefined();
    expect(rangeJob!.if).toContain('push');

    // It validates origin/main..HEAD — the full range a promotion PR would see.
    const validateStep = rangeJob!.steps.find(
      (step) => step.run && step.run.includes('origin/main..HEAD'),
    );
    expect(validateStep, 'must have a step that validates origin/main..HEAD').toBeDefined();
    expect(validateStep!.run).toContain('validate');
  });
});

describe('no host but GitHub', () => {
  const sources: [string, string][] = [
    ['action/lint/action.yml', readFileSync(ACTION_YML, 'utf8')],
    ['action/lint/lint.mjs', readFileSync(LINT, 'utf8')],
    ['action/lint/comment.mjs', readFileSync(join(ACTION_DIR, 'comment.mjs'), 'utf8')],
    ['.github/workflows/demo-lint.yml', readFileSync(DEMO_WORKFLOW, 'utf8')],
  ];

  // PRD F6 AC 2. The GitHub API is reached through actions/github-script, which
  // is handed a client; an HTTP call written here would be a second, unreviewed
  // way out of the runner.
  const CLIENTS = ['fetch(', 'axios', 'node-fetch', 'XMLHttpRequest', 'node:https', 'node:http'];

  it.each(sources)('%s calls no HTTP client of its own', (_path, contents) => {
    for (const client of CLIENTS) {
      expect(contents.includes(client), `found ${client}`).toBe(false);
    }
  });

  it('reaches the GitHub API only through actions/github-script', () => {
    const [, actionText] = sources[0] as [string, string];
    expect(actionText).toContain('uses: actions/github-script@v7');
    expect(actionText.match(/github\.rest\./g)?.length).toBeGreaterThan(0);
  });

  it('spawns git and the CLI without a shell', () => {
    const [, lintText] = sources[1] as [string, string];
    expect(lintText).toContain('shell: false');
    expect(lintText).not.toMatch(/shell:\s*true/);
  });
});
