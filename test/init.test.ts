/**
 * `commitlore init` — one command replacing `doctor --fix` + `hooks install`
 * + `index --rebuild`. The behavior that matters most here is not "it runs
 * the three steps" (each step already has its own suite) but the promise
 * `init` adds on top: a step that could not run is reported as such, never
 * folded into a claim of success (#63, #67), and the whole thing is safe to
 * run twice.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { readHookStatus } from '../src/commands/hooks.js';
import { closeIndex, indexInfo, openIndex } from '../src/core/index-db.js';
import { CHAINED_HOOK_NAME, HOOK_NAME } from '../src/hooks/commit-msg.js';
import { claudeSettingsPath, installClaudeHook } from '../src/hooks/claude-settings.js';
import { formatInitReport, runInit, type InitOptions, type InitReport } from '../src/commands/init.js';
import { createTestRepo } from './git-fixtures.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const CLI_JS = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

// `hooks install` (called by the `hooks` step below) records the entry point
// this process was launched from (`process.argv[1]`) as the hook's target
// (`src/commands/hooks.ts#recordBinPath`). In the real CLI that is always a
// built commitlore entry; inside this test process it is vitest's own entry,
// which would make `doctor`'s hook-runtime probe fail for a reason that has
// nothing to do with `init`. Every `runInit` call below runs with argv[1]
// pointed at a real, freshly built `dist/cli.js` instead, matching how
// `test/cli.test.ts` rebuilds it for the same reason.
beforeAll(() => {
  const build = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`tsc build failed (exit ${build.status}):\n${build.stdout}${build.stderr}`);
  }
}, 120_000);

const runInitAsCli = (opts: InitOptions): InitReport => {
  const original = process.argv[1];
  process.argv[1] = CLI_JS;
  try {
    return runInit(opts);
  } finally {
    process.argv[1] = original;
  }
};

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-init-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[]): string => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout;
};

const initRepo = (label: string): string => createTestRepo({ path: tempDir(label) });
const initBare = (label: string): string => createTestRepo({ path: tempDir(label), bare: true });

/**
 * A repo with `origin` wired to a local bare repo and one commit — the shape
 * a real clone has, and the shape `doctor`'s own checks were written to grade
 * `ok`: a remote to fetch/push notes against (refspec, push), and a recorded
 * path (`Record-Id:`) for the PreToolUse hook-runtime probe to have something
 * to inject context for.
 *
 * The Claude Code PreToolUse hook itself is installed here too
 * (`installClaudeHook`, the same helper `doctor.test.ts` uses for its own
 * `ok`-path case) — not because `commitlore init` installs it (it does not;
 * that is `install.sh`'s job, one level up from a single repository), but so
 * a test asserting "every check this repo could possibly satisfy is
 * satisfied" has a repo where that is actually true, distinct from the
 * (realistic, and separately tested below) case where it is not.
 */
const repoWithRemote = (label: string): string => {
  const remote = initBare(`${label}-remote`);
  const repo = initRepo(label);
  git(repo, ['remote', 'add', 'origin', remote]);
  writeFileSync(join(repo, 'probe.ts'), 'export const probe = true;\n');
  git(repo, ['add', 'probe.ts']);
  git(repo, [
    'commit',
    '--quiet',
    '-m',
    'Add init test probe\n\nLimit: init test probe\nRecord-Id: r-inittestpr',
  ]);
  installClaudeHook({ settingsPath: claudeSettingsPath(repo) });
  return repo;
};

const hookPathOf = (repo: string): string =>
  resolve(repo, git(repo, ['rev-parse', '--git-path', `hooks/${HOOK_NAME}`]).trim());

const trailerCount = (repo: string): number => {
  let handle;
  try {
    handle = openIndex({ cwd: repo, readonly: true });
    return indexInfo(handle).trailers;
  } finally {
    if (handle !== undefined) closeIndex(handle);
  }
};

describe('commitlore init — the happy path', () => {
  it('installs the hook and the index, and reports 0/0/0 codes on a repo with a working remote', () => {
    const repo = repoWithRemote('happy');

    const report = runInitAsCli({ cwd: repo });

    expect(report.steps.map((s) => s.step)).toEqual(['hooks', 'index', 'doctor']);
    expect(report.steps.map((s) => s.code)).toEqual([0, 0, 0]);
    expect(report.exitCode).toBe(0);

    expect(readHookStatus(repo).state).toBe('installed');
    expect(existsSync(hookPathOf(repo))).toBe(true);
    expect(trailerCount(repo)).toBeGreaterThanOrEqual(0);
  });

  it('is idempotent: a second run changes nothing and still reports 0/0/0', () => {
    const repo = repoWithRemote('idempotent');

    const first = runInitAsCli({ cwd: repo });
    const hookBytesAfterFirst = readFileSync(hookPathOf(repo), 'utf8');
    const second = runInitAsCli({ cwd: repo });

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(readFileSync(hookPathOf(repo), 'utf8')).toBe(hookBytesAfterFirst);

    const hooksStep = second.steps.find((s) => s.step === 'hooks');
    expect(hooksStep?.lines.join('\n')).toContain('already installed');
    expect(hooksStep?.lines.join('\n')).toContain('unchanged');
  });

  it('formats a human-readable report with a clean summary line when nothing needs attention', () => {
    const repo = repoWithRemote('format-clean');
    const text = formatInitReport(runInitAsCli({ cwd: repo }));

    expect(text).toContain('[1/3] hooks install');
    expect(text).toContain('[2/3] index --rebuild');
    expect(text).toContain('[3/3] doctor --fix');
    expect(text).toContain('init: 3/3 steps completed cleanly');
  });
});

describe('commitlore init — a step that cannot fully succeed is reported, not hidden', () => {
  it('a repo with no remote configured comes back as needing attention, not as a clean pass', () => {
    // No `git remote add`, unlike repoWithRemote — this is exactly the case
    // the task's own verification calls out: init must not claim success
    // over a warning it cannot fix itself.
    const repo = initRepo('no-remote');
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'first']);

    const report = runInitAsCli({ cwd: repo });

    const doctorStep = report.steps.find((s) => s.step === 'doctor');
    expect(doctorStep?.code).toBe(1);
    expect(doctorStep?.lines.join('\n')).toContain('no remote is configured');
    expect(report.exitCode).toBe(1);

    // The hook and the index still got installed — one check being unfixable
    // does not stop the other two steps from doing their job.
    expect(readHookStatus(repo).state).toBe('installed');

    const text = formatInitReport(report);
    expect(text).not.toContain('completed cleanly');
    expect(text).toContain('need(s) attention');
  });

  it('a hooks-install failure is reported as a failed step, and the other two steps still run', () => {
    const repo = repoWithRemote('hooks-fail');
    const hookPath = hookPathOf(repo);
    const chainedPath = join(dirname(hookPath), CHAINED_HOOK_NAME);
    mkdirSync(dirname(hookPath), { recursive: true });
    // A foreign hook, with a preserved hook already sitting in the chained
    // slot: `installHook` refuses this without --force (it will not decide
    // which of two non-commitlore hooks to discard), which is exactly the
    // "genuinely fails" case init must surface rather than swallow.
    writeFileSync(hookPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    chmodSync(hookPath, 0o755);
    writeFileSync(chainedPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    chmodSync(chainedPath, 0o755);

    const report = runInitAsCli({ cwd: repo });

    const hooksStep = report.steps.find((s) => s.step === 'hooks');
    expect(hooksStep?.code).toBe(2);
    expect(hooksStep?.lines.join('\n')).toMatch(/force/);
    expect(report.exitCode).toBe(2);

    // index --rebuild is independent of the hook and still ran.
    const indexStep = report.steps.find((s) => s.step === 'index');
    expect(indexStep?.code).toBe(0);

    const text = formatInitReport(report);
    expect(text).toContain('could not run');
    expect(text).toContain('hooks install');
  });

  it('--force forwards to hooks install and resolves the foreign+chained conflict', () => {
    const repo = repoWithRemote('hooks-force');
    const hookPath = hookPathOf(repo);
    const chainedPath = join(dirname(hookPath), CHAINED_HOOK_NAME);
    mkdirSync(dirname(hookPath), { recursive: true });
    writeFileSync(hookPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    chmodSync(hookPath, 0o755);
    writeFileSync(chainedPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    chmodSync(chainedPath, 0o755);

    const report = runInitAsCli({ cwd: repo, force: true });

    const hooksStep = report.steps.find((s) => s.step === 'hooks');
    expect(hooksStep?.code).toBe(0);
    expect(readHookStatus(repo).state).toBe('installed');
  });

  it('a repository with no HEAD yet still runs every step without crashing', () => {
    const repo = initRepo('no-head');

    const report = runInitAsCli({ cwd: repo });

    // Nothing here is a thrown exception: every step reports its own outcome.
    expect(report.steps).toHaveLength(3);
    for (const step of report.steps) {
      expect(step.lines.length).toBeGreaterThan(0);
    }
  });
});

describe('commitlore init — machine-readable output', () => {
  it('carries the same step codes and exit code in --json as the report object', () => {
    const repo = repoWithRemote('json-shape');
    const report = runInitAsCli({ cwd: repo });
    const roundTripped: unknown = JSON.parse(JSON.stringify(report));

    expect(roundTripped).toMatchObject({
      exitCode: report.exitCode,
      steps: report.steps.map((s) => ({ step: s.step, code: s.code })),
    });
  });
});
