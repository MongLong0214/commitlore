/**
 * T-602 acceptance criteria, for the parts of a GitHub Action that can be held
 * to one without a GitHub.
 *
 * Everything here runs against throwaway repositories under `os.tmpdir()`,
 * with real git, the real CLI, and a real remote -- a bare repository on disk
 * reached over `file://`. Nothing touches a network and nothing touches the
 * repository the suite runs in.
 *
 * A bare repository rather than a stubbed `git push` on purpose. The two things
 * this action can get wrong at the remote are a rejected push it swallows and a
 * note it overwrites, and neither is observable against a stub that always says
 * yes: the non-fast-forward below is one git genuinely refuses, produced by a
 * second clone publishing between this one's read and its write, and the frozen
 * remote is a `pre-receive` hook git genuinely declines.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestRepo } from './git-fixtures.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const ACTION_DIR = fileURLToPath(new URL('../action/preserve/', import.meta.url));
const PRESERVE = join(ACTION_DIR, 'preserve.mjs');
const ACTION_YML = join(ACTION_DIR, 'action.yml');
const DEMO_WORKFLOW = fileURLToPath(
  new URL('../.github/workflows/demo-preserve.yml', import.meta.url),
);

const NOTES_REF = 'refs/notes/commitlore';
const NOTES_ARG = `--ref=${NOTES_REF}`;

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** `realpathSync` because macOS reports `/var` for a `/private/var` tmpdir. */
const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-preserve-${label}-`));
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

const initBare = (label: string): string => {
  const dir = tempDir(label);
  return createTestRepo({ path: dir, bare: true });
};

const commit = (dir: string, path: string, contents: string, message: string): void => {
  writeFileSync(join(dir, path), contents);
  git(dir, ['add', path]);
  git(dir, ['commit', '--quiet', '-F', '-'], message);
};

const head = (dir: string, rev = 'HEAD'): string => git(dir, ['rev-parse', rev]).trim();

/** The note a run left on `sha`, or null when the object carries none. */
const noteOn = (dir: string, sha: string): string | null => {
  const result = spawnSync('git', ['notes', NOTES_ARG, 'show', sha], {
    cwd: dir,
    encoding: 'utf8',
    shell: false,
  });
  return result.status === 0 ? result.stdout : null;
};

const notedShas = (dir: string): string[] => {
  const result = spawnSync('git', ['notes', NOTES_ARG, 'list'], {
    cwd: dir,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.split(' ')[1] ?? '');
};

const RECORDS = [
  [
    'Cap the widget at 50 rows',
    '',
    'Limit: the widget renders at most 50 rows before the browser stalls',
    'Blast: local',
    'Record-Id: r-000101',
    'CommitLore-Version: 2.0.0',
    '',
  ].join('\n'),
  [
    'Keep the print layout',
    '',
    'Ruled-out: virtualised list | it drops the print layout the finance team uses',
    'Blast: module',
    'Record-Id: r-000102',
    'CommitLore-Version: 2.0.0',
    '',
  ].join('\n'),
  [
    'Warn about the row cap',
    '',
    'Warn: do not raise the row cap without re-running the print check',
    'Blast: local',
    'Record-Id: r-000103',
    'CommitLore-Version: 2.0.0',
    '',
  ].join('\n'),
];

/** No `Key:` line anywhere, so git parses no trailers and nothing is inherited. */
const PLAIN = ['Rename the fixture file', '', 'Nothing worth recording happened here.', ''].join(
  '\n',
);

/** What GitHub writes for a squash: a title with the number, then the subjects. */
const squashMessage = (number: number, subjects: string[]): string =>
  [`Cap and document the widget (#${number})`, '', ...subjects.map((s) => `* ${s}`), ''].join('\n');

interface Scenario {
  repo: string;
  origin: string;
  mergeSha: string;
  headSha: string;
}

/** Grows `branch` off main, then collapses it the way a squash merge does. */
const squashBranch = (
  repo: string,
  branch: string,
  messages: string[],
  number: number,
): { mergeSha: string; headSha: string } => {
  git(repo, ['checkout', '--quiet', '-b', branch, 'main']);
  messages.forEach((message, index) => {
    commit(repo, `${branch}-${index}.ts`, `export const v${index} = ${index};\n`, message);
  });
  const headSha = head(repo);

  git(repo, ['checkout', '--quiet', 'main']);
  // `--squash` stages the branch and leaves the commit to be written, which is
  // exactly the shape GitHub produces: one parent, a message nobody wrote.
  git(repo, ['merge', '--squash', branch]);
  git(
    repo,
    ['commit', '--quiet', '-F', '-'],
    squashMessage(
      number,
      messages.map((message) => message.split('\n')[0] ?? ''),
    ),
  );
  const mergeSha = head(repo);

  git(repo, ['push', '--quiet', 'origin', 'main']);
  return { mergeSha, headSha };
};

const squashScenario = (label: string, messages = RECORDS): Scenario => {
  const origin = initBare(`${label}-origin`);
  const repo = initRepo(label);
  git(repo, ['remote', 'add', 'origin', `file://${origin}`]);
  commit(repo, 'seed.txt', 'seed\n', 'Seed the repository\n');
  git(repo, ['push', '--quiet', 'origin', 'main']);

  const { mergeSha, headSha } = squashBranch(repo, 'feat', messages, 7);
  return { repo, origin, mergeSha, headSha };
};

interface PreserveRun {
  status: number | null;
  stdout: string;
  stderr: string;
  outputs: Record<string, string>;
}

const parseOutputs = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );

const runPreserve = (
  scenario: Pick<Scenario, 'repo' | 'mergeSha' | 'headSha'>,
  env: Record<string, string> = {},
): PreserveRun => {
  const runnerTemp = tempDir('runner');
  const outputFile = join(runnerTemp, 'github-output');
  writeFileSync(outputFile, '');

  const result = spawnSync(process.execPath, [PRESERVE], {
    cwd: scenario.repo,
    shell: false,
    encoding: 'utf8',
    env: {
      ...process.env,
      COMMITLORE_WORKSPACE: scenario.repo,
      COMMITLORE_CLI: CLI,
      COMMITLORE_BASE_REF: 'main',
      COMMITLORE_HEAD_REF: scenario.headSha,
      COMMITLORE_MERGE_SHA: scenario.mergeSha,
      GITHUB_OUTPUT: outputFile,
      RUNNER_TEMP: runnerTemp,
      ...env,
    },
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    outputs: parseOutputs(readFileSync(outputFile, 'utf8')),
  };
};

beforeAll(() => {
  const build = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], {
    shell: false,
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  if (build.status !== 0) {
    throw new Error(`tsc build failed (exit ${build.status}):\n${build.stdout}${build.stderr}`);
  }
}, 180_000);

describe('a squash merge', () => {
  it('carries the branch records onto the merge commit and publishes them', () => {
    const scenario = squashScenario('inherit');
    const run = runPreserve(scenario);

    expect(run.status, run.stderr).toBe(0);
    expect(run.outputs['merge-type']).toBe('squash');
    expect(run.outputs['action']).toBe('inherited');
    expect(run.outputs['records']).toBe('3');
    expect(run.outputs['conflicts']).toBe('0');
    expect(run.outputs['pushed']).toBe('true');

    const note = noteOn(scenario.repo, scenario.mergeSha);
    expect(note).not.toBeNull();
    expect(note).toContain('the widget renders at most 50 rows');
    expect(note).toContain('virtualised list');
    expect(note).toContain('do not raise the row cap');
    // The merge record says *that* it was inherited; the mirror says from what,
    // once per source record (T-302 `INHERITED_FROM_KEY`).
    expect(note).toContain('Provenance: inherited ');
    expect(note?.match(/^X-Inherited-From: /gm)).toHaveLength(3);
    // `Blast` collapses toward the value that asks for more scrutiny, not the
    // last one written.
    expect(note).toContain('Blast: module');

    // The record reached the remote, which is the only place it survives the
    // runner being deleted.
    expect(noteOn(scenario.origin, scenario.mergeSha)).toBe(note);
  });

  it('runs a second time without duplicating or replacing the record', () => {
    const scenario = squashScenario('idempotent');

    const first = runPreserve(scenario);
    expect(first.status, first.stderr).toBe(0);
    expect(first.outputs['action']).toBe('inherited');
    const note = noteOn(scenario.repo, scenario.mergeSha);
    const notesRefBefore = head(scenario.repo, NOTES_REF);

    const second = runPreserve(scenario);

    expect(second.status, second.stderr).toBe(0);
    expect(second.outputs['action']).toBe('already-inherited');
    expect(second.outputs['pushed']).toBe('false');
    expect(second.stdout).toContain('already carries a record');

    // Same content, same note object, and one note -- not two, and not a
    // rewrite that would have moved the notes ref.
    expect(noteOn(scenario.repo, scenario.mergeSha)).toBe(note);
    expect(head(scenario.repo, NOTES_REF)).toBe(notesRefBefore);
    expect(notedShas(scenario.repo)).toEqual([scenario.mergeSha]);
    expect(notedShas(scenario.origin)).toEqual([scenario.mergeSha]);
  });

  it('attaches without publishing when push is false', () => {
    const scenario = squashScenario('no-push');
    const run = runPreserve(scenario, { COMMITLORE_PUSH: 'false' });

    expect(run.status, run.stderr).toBe(0);
    expect(run.outputs['action']).toBe('inherited');
    expect(run.outputs['pushed']).toBe('false');
    expect(run.stdout).toContain('not published');

    expect(noteOn(scenario.repo, scenario.mergeSha)).not.toBeNull();
    expect(notedShas(scenario.origin)).toEqual([]);
  });

  it('reports a branch that recorded nothing instead of failing over it', () => {
    const scenario = squashScenario('no-records', [PLAIN]);
    const run = runPreserve(scenario);

    expect(run.status, run.stderr).toBe(0);
    expect(run.outputs['merge-type']).toBe('squash');
    expect(run.outputs['action']).toBe('nothing-to-preserve');
    expect(run.outputs['records']).toBe('0');
    expect(run.outputs['pushed']).toBe('false');
    expect(run.stdout).toContain('nothing to inherit');

    expect(noteOn(scenario.repo, scenario.mergeSha)).toBeNull();
    expect(notedShas(scenario.origin)).toEqual([]);
  });
});

describe('a merge that was not a squash', () => {
  it('does nothing for a merge commit, because the branch is still reachable', () => {
    const origin = initBare('merge-commit-origin');
    const repo = initRepo('merge-commit');
    git(repo, ['remote', 'add', 'origin', `file://${origin}`]);
    commit(repo, 'seed.txt', 'seed\n', 'Seed the repository\n');
    git(repo, ['push', '--quiet', 'origin', 'main']);

    git(repo, ['checkout', '--quiet', '-b', 'feat', 'main']);
    RECORDS.forEach((message, index) => {
      commit(repo, `feat-${index}.ts`, `export const v${index} = ${index};\n`, message);
    });
    const headSha = head(repo);

    git(repo, ['checkout', '--quiet', 'main']);
    git(repo, ['merge', '--quiet', '--no-ff', '-m', 'Merge pull request #8 from feat', 'feat']);
    const mergeSha = head(repo);
    git(repo, ['push', '--quiet', 'origin', 'main']);

    const run = runPreserve({ repo, mergeSha, headSha });

    expect(run.status, run.stderr).toBe(0);
    expect(run.outputs['merge-type']).toBe('merge-commit');
    expect(run.outputs['action']).toBe('skipped');
    expect(run.outputs['records']).toBe('0');
    expect(run.stdout).toContain('2 parents');

    expect(noteOn(repo, mergeSha)).toBeNull();
    expect(notedShas(origin)).toEqual([]);
  });

  it('does nothing for a rebase, because the trailers came with the messages', () => {
    const origin = initBare('rebase-origin');
    const repo = initRepo('rebase');
    git(repo, ['remote', 'add', 'origin', `file://${origin}`]);
    commit(repo, 'seed.txt', 'seed\n', 'Seed the repository\n');
    git(repo, ['push', '--quiet', 'origin', 'main']);

    git(repo, ['checkout', '--quiet', '-b', 'feat', 'main']);
    RECORDS.forEach((message, index) => {
      commit(repo, `feat-${index}.ts`, `export const v${index} = ${index};\n`, message);
    });
    const headSha = head(repo);
    const branchCommits = git(repo, ['rev-list', '--reverse', 'main..feat']).trim().split('\n');

    // What a rebase merge leaves on the base branch: the same messages on new
    // shas, with the branch's own commits no longer reachable from it. The base
    // has to have moved for that to be true -- replaying a branch onto the
    // commit it was already based on reproduces its shas exactly, which is a
    // fast-forward and not the case under test.
    git(repo, ['checkout', '--quiet', 'main']);
    commit(repo, 'other.ts', 'export const other = 1;\n', 'Land something else first\n');
    git(repo, ['cherry-pick', '--quiet', ...branchCommits]);
    const mergeSha = head(repo);
    git(repo, ['push', '--quiet', 'origin', 'main']);

    const run = runPreserve({ repo, mergeSha, headSha });

    expect(run.status, run.stderr).toBe(0);
    expect(run.outputs['merge-type']).toBe('rebase');
    expect(run.outputs['action']).toBe('skipped');
    expect(run.stdout).toContain('verbatim');

    expect(noteOn(repo, mergeSha)).toBeNull();
    expect(notedShas(origin)).toEqual([]);
  });
});

describe('publishing the mirror', () => {
  it('re-reads and retries when another merge published first', () => {
    const origin = initBare('race-origin');
    const repo = initRepo('race');
    git(repo, ['remote', 'add', 'origin', `file://${origin}`]);
    commit(repo, 'seed.txt', 'seed\n', 'Seed the repository\n');
    const seedSha = head(repo);
    git(repo, ['push', '--quiet', 'origin', 'main']);

    const first = squashBranch(repo, 'feat-one', RECORDS.slice(0, 2), 9);
    const second = squashBranch(repo, 'feat-two', RECORDS.slice(2), 10);

    const start = runPreserve({ repo, ...first });
    expect(start.status, start.stderr).toBe(0);
    expect(start.outputs['pushed']).toBe('true');

    // A second clone publishes its own note between this repository's read and
    // its next write. That is the non-fast-forward, produced the way the real
    // one is rather than described by a stub.
    const other = initRepo('race-other');
    git(other, ['remote', 'add', 'origin', `file://${origin}`]);
    git(other, ['fetch', '--quiet', '--no-tags', 'origin', '+refs/heads/*:refs/remotes/origin/*']);
    git(other, ['fetch', '--quiet', '--no-tags', 'origin', `+${NOTES_REF}:${NOTES_REF}`]);
    git(other, ['notes', NOTES_ARG, 'add', '-m', 'Limit: the seed file is a fixture', seedSha]);
    git(other, ['push', '--quiet', 'origin', `${NOTES_REF}:${NOTES_REF}`]);

    const run = runPreserve({ repo, ...second });

    expect(run.status, run.stderr).toBe(0);
    expect(run.outputs['action']).toBe('inherited');
    expect(run.outputs['pushed']).toBe('true');
    // The retry is reported. A push that was rejected and then succeeded is
    // still a thing that happened.
    expect(run.stdout).toContain('push rejected');

    // Both merges and the other clone's note are on the remote: the retry
    // rebuilt on top of what it found rather than replacing it.
    expect(notedShas(origin).sort()).toEqual(
      [first.mergeSha, second.mergeSha, seedSha].sort(),
    );
    expect(noteOn(origin, seedSha)).toContain('the seed file is a fixture');
  });

  it('fails loudly when the push is refused, rather than reporting success', () => {
    const scenario = squashScenario('frozen');

    // A remote that declines every push. `[remote rejected]` is not a race --
    // the next attempt gets the same answer -- so this must not be retried and
    // must not be swallowed.
    // These repositories are initialised from an empty template, so the hooks
    // directory git would normally fill with samples is not there.
    const hooks = join(scenario.origin, 'hooks');
    mkdirSync(hooks, { recursive: true });
    const hook = join(hooks, 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\necho "notes are frozen on this remote" >&2\nexit 1\n');
    chmodSync(hook, 0o755);

    const run = runPreserve(scenario);

    expect(run.status).toBe(1);
    expect(run.outputs['action']).toBe('push-failed');
    expect(run.outputs['pushed']).toBe('false');
    expect(run.outputs['records']).toBe('3');
    expect(run.stderr).toContain('could not publish');
    expect(run.stderr).toContain('notes are frozen on this remote');
    expect(run.stdout).toContain('::error');

    // The record exists on the runner and nowhere else, which is precisely why
    // this is a failure and not a warning.
    expect(noteOn(scenario.repo, scenario.mergeSha)).not.toBeNull();
    expect(notedShas(scenario.origin)).toEqual([]);
  });
});

describe('a checkout that cannot answer the question', () => {
  it('refuses a shallow clone instead of inheriting part of a branch', () => {
    const scenario = squashScenario('shallow-source');
    const parent = tempDir('shallow');
    createTestRepo({
      path: join(parent, 'checkout'),
      source: `file://${scenario.repo}`,
      depth: 1,
      branch: 'main',
    });

    const run = runPreserve({
      repo: join(parent, 'checkout'),
      mergeSha: scenario.mergeSha,
      headSha: scenario.headSha,
    });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('shallow');
    expect(run.stderr).toContain('fetch-depth: 0');
    expect(run.outputs['action']).toBeUndefined();
  });

  it('refuses a head ref that the merge left unreachable, and says how to fetch it', () => {
    const scenario = squashScenario('missing-head');
    const run = runPreserve(scenario, { COMMITLORE_HEAD_REF: '0'.repeat(40) });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('refs/pull/');
    expect(noteOn(scenario.repo, scenario.mergeSha)).toBeNull();
  });

  it('refuses an empty merge sha, which is what an unmerged pull request has', () => {
    const scenario = squashScenario('unmerged');
    const run = runPreserve(scenario, { COMMITLORE_MERGE_SHA: '' });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('merged == true');
    expect(noteOn(scenario.repo, scenario.mergeSha)).toBeNull();
  });
});

interface ActionStep {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  shell?: string;
  if?: string;
  with?: Record<string, string>;
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
    for (const input of ['base-ref', 'head-ref', 'merge-sha', 'github-token', 'cli-path', 'push']) {
      expect(Object.keys(action.inputs), `${input} should be declared`).toContain(input);
    }
  });

  it('uses every input it declares', () => {
    for (const input of Object.keys(action.inputs)) {
      expect(text, `${input} is declared but never used`).toContain(`inputs.${input}`);
    }
  });

  it('wires every output to the step that produces it', () => {
    for (const [name, spec] of Object.entries(action.outputs)) {
      expect(spec.value, `${name} should read steps.preserve.outputs`).toContain(
        `steps.preserve.outputs.${name}`,
      );
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

  it('defaults its refs to the fields the merged pull request actually carries', () => {
    expect(action.inputs['merge-sha']?.default).toContain(
      'github.event.pull_request.merge_commit_sha',
    );
    expect(action.inputs['head-ref']?.default).toContain('github.event.pull_request.head.sha');
    expect(action.inputs['base-ref']?.default).toContain('github.event.pull_request.base.ref');
  });

  it('asks the caller for a full clone, the notes ref, and no more permission than it needs', () => {
    expect(text).toContain('fetch-depth: 0');
    expect(text).toContain(NOTES_REF);
    expect(text).toContain('refs/pull/');
    expect(text).toContain('contents: write');
    // The lint action needs this one; inheritance posts nothing.
    expect(text).not.toContain('pull-requests: write');
  });

  // A workflow file that does not parse is a workflow GitHub never runs, and
  // the dogfooding would be a file in the repository rather than a check.
  it('is dogfooded by a workflow that parses and does not touch CI', () => {
    const demoText = readFileSync(DEMO_WORKFLOW, 'utf8');
    const demo = load(demoText) as {
      on: { pull_request: { types: string[] } };
      permissions: Record<string, string>;
      jobs: Record<string, { if?: string; steps: ActionStep[] }>;
    };

    expect(demo.on.pull_request.types).toEqual(['closed']);
    expect(demo.permissions).toEqual({ contents: 'write' });
    expect(Object.keys(demo.jobs)).toHaveLength(1);

    const job = Object.values(demo.jobs)[0];
    expect(job?.if).toContain('github.event.pull_request.merged == true');
    expect(job?.steps.some((step) => step.uses === './action/preserve')).toBe(true);
    // Checking out the default ref for a closed pull request resolves nothing:
    // `refs/pull/<n>/merge` is gone by then.
    expect(demoText).toContain('ref: ${{ github.event.pull_request.base.ref }}');
    expect(demoText).toContain('fetch-depth: 0');
    expect(demoText).toContain('refs/pull/');
  });
});

describe('no host but the git remote', () => {
  const sources: [string, string][] = [
    ['action/preserve/action.yml', readFileSync(ACTION_YML, 'utf8')],
    ['action/preserve/preserve.mjs', readFileSync(PRESERVE, 'utf8')],
    ['.github/workflows/demo-preserve.yml', readFileSync(DEMO_WORKFLOW, 'utf8')],
  ];

  // PRD F6 AC 2. This action does not even reach the GitHub API -- the merge is
  // classified from git objects -- so an HTTP client here would have no
  // legitimate caller at all.
  const CLIENTS = ['fetch(', 'axios', 'node-fetch', 'XMLHttpRequest', 'node:https', 'node:http'];

  it.each(sources)('%s calls no HTTP client of its own', (_path, contents) => {
    for (const client of CLIENTS) {
      expect(contents.includes(client), `found ${client}`).toBe(false);
    }
  });

  it('makes no GitHub API call', () => {
    const [, actionText] = sources[0] as [string, string];
    expect(actionText).not.toContain('actions/github-script');
    expect(actionText).not.toContain('github.rest.');
  });

  it('spawns git and the CLI without a shell', () => {
    const [, runner] = sources[1] as [string, string];
    expect(runner).toContain('shell: false');
    expect(runner).not.toMatch(/shell:\s*true/);
  });

  // A token on argv is a token every other process on the runner can read.
  it('keeps the fallback credential out of the command line', () => {
    const [, runner] = sources[1] as [string, string];
    expect(runner).toContain('GIT_CONFIG_KEY_0');
    expect(runner).not.toMatch(/'-c',\s*`?http\./);
  });
});
