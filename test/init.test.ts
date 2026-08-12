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
import { runDoctor } from '../src/commands/doctor.js';
import { closeIndex, indexInfo, openIndex } from '../src/core/index-db.js';
import { CHAINED_HOOK_NAME, HOOK_NAME } from '../src/hooks/commit-msg.js';
import { claudeSettingsPath, installClaudeHook } from '../src/hooks/claude-settings.js';
import { formatInitReport, runInit, type InitOptions, type InitReport } from '../src/commands/init.js';
import { POLICY_FILE_NAME, resolvePolicy } from '../src/core/capture-policy.js';
import { createTestRepo } from './git-fixtures.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
let CLI_JS = '';

// `hooks install` (called by the `hooks` step below) records the entry point
// this process was launched from (`process.argv[1]`) as the hook's target
// (`src/commands/hooks.ts#recordBinPath`). In the real CLI that is always a
// built commitlore entry; inside this test process it is vitest's own entry,
// which would make `doctor`'s hook-runtime probe fail for a reason that has
// nothing to do with `init`. Every `runInit` call below runs with argv[1]
// pointed at a real, freshly built `dist/cli.js` in this suite's private
// harness instead, matching how `test/cli.test.ts` rebuilds it for the same
// reason.
beforeAll(() => {
  // `runInit` remains imported from source, so its hook installer records the
  // source package root. Keep this unique build below that root: the artifact
  // is private, while the recorded CLI still has the same installation root
  // the hook's containment check expects.
  const harness = mkdtempSync(join(PACKAGE_ROOT, '.commitlore-init-dist-'));
  scratch.push(harness);
  CLI_JS = join(harness, 'dist', 'cli.js');

  const build = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json', '--outDir', join(harness, 'dist')], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`tsc build failed (exit ${build.status}):\n${build.stdout}${build.stderr}`);
  }
}, 120_000);

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-init-${label}-`));
  scratch.push(dir);
  return dir;
};

const injectBin = tempDir('inject-bin');
const injectCommand = join(injectBin, 'commitlore');
writeFileSync(
  injectCommand,
  '#!/bin/sh\nprintf \'{"hookSpecificOutput":{"additionalContext":"context"}}\\n\'\n',
  { mode: 0o755 },
);
chmodSync(injectCommand, 0o755);

const runInitAsCli = (opts: InitOptions): InitReport => {
  const originalArgv = process.argv[1];
  const originalPath = process.env['PATH'];
  process.argv[1] = CLI_JS;
  process.env['PATH'] = `${injectBin}:/usr/bin:/bin`;
  try {
    return runInit(opts);
  } finally {
    process.argv[1] = originalArgv;
    if (originalPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = originalPath;
  }
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
  it('installs every onboarding component and reports clean codes on a repo with a working remote', () => {
    const repo = repoWithRemote('happy');

    const report = runInitAsCli({ cwd: repo });

    expect(report.steps.map((s) => s.step)).toEqual([
      'hooks',
      'trust',
      'index',
      'claude-hook',
      'mcp-registration',
      'policy',
      'doctor',
    ]);
    expect(report.steps.map((s) => s.code)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(report.exitCode).toBe(0);

    expect(readHookStatus(repo).state).toBe('installed');
    expect(existsSync(hookPathOf(repo))).toBe(true);
    expect(trailerCount(repo)).toBeGreaterThanOrEqual(0);
  });

  it('is idempotent: a second run changes nothing and still reports 0/0/0', () => {
    const repo = repoWithRemote('idempotent');

    const first = runInitAsCli({ cwd: repo });
    const hookBytesAfterFirst = readFileSync(hookPathOf(repo), 'utf8');
    const mcpBytesAfterFirst = readFileSync(join(repo, '.mcp.json'), 'utf8');
    const second = runInitAsCli({ cwd: repo });

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(readFileSync(hookPathOf(repo), 'utf8')).toBe(hookBytesAfterFirst);
    expect(readFileSync(join(repo, '.mcp.json'), 'utf8')).toBe(mcpBytesAfterFirst);

    const hooksStep = second.steps.find((s) => s.step === 'hooks');
    expect(hooksStep?.lines.join('\n')).toContain('already installed');
    expect(hooksStep?.lines.join('\n')).toContain('unchanged');
    const mcpStep = second.steps.find((s) => s.step === 'mcp-registration');
    expect(mcpStep?.lines.join('\n')).toContain('already registers commitlore');
    expect(mcpStep?.lines.join('\n')).toContain('left unchanged');
  });

  it('formats a human-readable report with a clean summary line when nothing needs attention', () => {
    const repo = repoWithRemote('format-clean');
    const text = formatInitReport(runInitAsCli({ cwd: repo }));

    // Result-oriented output: each step has a success indicator, no internal command names.
    expect(text).toContain('✓ Hooks');
    expect(text).toContain('✓ Index');
    expect(text).toContain('✓ Agent integration');
    expect(text).toContain('✓ MCP registration');
    expect(text).toContain('✓ Final check');
    expect(text).toContain('init: ready');
  });
});

describe('commitlore init — repository MCP registration', () => {
  const initiatorStatus = (repo: string): string | undefined =>
    runDoctor({ cwd: repo }).checks.find((check) => check.id === 'unattended-initiator')?.status;

  const enableUnattended = (repo: string): void => {
    writeFileSync(
      join(repo, POLICY_FILE_NAME),
      `${JSON.stringify({ mode: 'auto', unattended: true }, null, 2)}\n`,
    );
  };

  it('creates a portable registration and clears doctor’s unattended-initiator warning', () => {
    const repo = repoWithRemote('mcp-created');
    enableUnattended(repo);

    expect(existsSync(join(repo, '.mcp.json'))).toBe(false);
    expect(initiatorStatus(repo)).toBe('warn');

    const report = runInitAsCli({ cwd: repo });
    const registration = report.steps.find((step) => step.step === 'mcp-registration');
    const config = JSON.parse(readFileSync(join(repo, '.mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, { command?: unknown; args?: unknown }>;
    };

    expect(registration?.code).toBe(0);
    expect(registration?.lines.join('\n')).toContain('registered the capture server for repository-scoped hosts');
    expect(registration?.lines.join('\n')).toContain('applies to everyone who clones');
    expect(registration?.lines.join('\n')).toContain('hosts that keep MCP configuration outside the repository are unchanged');
    expect(config.mcpServers?.commitlore).toEqual({ command: 'commitlore', args: ['mcp'] });
    expect(initiatorStatus(repo)).toBe('ok');
    expect(report.exitCode).toBe(0);
  });

  it('merges into an existing .mcp.json without changing other servers or fields', () => {
    const repo = repoWithRemote('mcp-merge');
    const otherServer = [
      '    "other-server": {',
      '      "command": "other-mcp",',
      '      "args": ["serve", "--safe"],',
      '      "env": { "PRESERVE": "every-byte" }',
      '    }',
    ].join('\n');
    const unrelated = '  "host-owned": { "keep": [1, 2, 3] }';
    const original = ['{', '  "mcpServers": {', otherServer, '  },', unrelated, '}', ''].join('\n');
    writeFileSync(join(repo, '.mcp.json'), original);

    const report = runInitAsCli({ cwd: repo });
    const after = readFileSync(join(repo, '.mcp.json'), 'utf8');
    const parsed = JSON.parse(after) as {
      mcpServers: Record<string, unknown>;
      'host-owned': unknown;
    };

    expect(report.steps.find((step) => step.step === 'mcp-registration')?.code).toBe(0);
    expect(after).toContain(otherServer);
    expect(after).toContain(unrelated);
    expect(parsed.mcpServers['other-server']).toEqual({
      command: 'other-mcp',
      args: ['serve', '--safe'],
      env: { PRESERVE: 'every-byte' },
    });
    expect(parsed['host-owned']).toEqual({ keep: [1, 2, 3] });
    expect(parsed.mcpServers.commitlore).toEqual({ command: 'commitlore', args: ['mcp'] });
  });

  it('leaves an existing commitlore entry byte-for-byte unchanged', () => {
    const repo = repoWithRemote('mcp-existing');
    const original =
      '{"mcpServers":{"commitlore":{"command":"deliberate-wrapper","args":["custom-mcp"],"env":{"MODE":"operator-choice"}}},"host-owned":true}\n';
    writeFileSync(join(repo, '.mcp.json'), original);

    const report = runInitAsCli({ cwd: repo });

    expect(readFileSync(join(repo, '.mcp.json'), 'utf8')).toBe(original);
    const registration = report.steps.find((step) => step.step === 'mcp-registration');
    expect(registration?.code).toBe(0);
    expect(registration?.lines.join('\n')).toContain('already registers commitlore');
    expect(registration?.lines.join('\n')).toContain('left unchanged');
  });

  it('reports a registration failure but does not make the install fail', () => {
    const repo = repoWithRemote('mcp-registration-failure');
    mkdirSync(join(repo, '.mcp.json'));

    const report = runInitAsCli({ cwd: repo });
    const registration = report.steps.find((step) => step.step === 'mcp-registration');

    expect(registration?.code).toBe(0);
    expect(registration?.lines.join('\n')).toContain('could not register the capture server');
    expect(registration?.lines.join('\n')).toContain('repository still installs');
    expect(report.steps.find((step) => step.step === 'hooks')?.code).toBe(0);
    expect(report.steps.find((step) => step.step === 'index')?.code).toBe(0);
    expect(report.exitCode).toBe(0);
    expect(formatInitReport(report)).toContain('MCP registration — not registered for repository-scoped hosts');
  });
});

describe('commitlore init — repository-owned agent guidance', () => {
  it('creates AGENTS.md with the shared capture procedure when the repository has none', () => {
    const repo = initRepo('agents-created');

    const report = runInitAsCli({ cwd: repo });
    const guidance = readFileSync(join(repo, 'AGENTS.md'), 'utf8');

    expect(guidance).toContain('<!-- commitlore:begin -->');
    expect(guidance).toContain('commitlore_prepare_capture');
    expect(guidance).toContain('commitlore_verify_capture');
    expect(guidance).toContain('commitlore_stage_capture');
    expect(guidance).toContain('Drop the trailer; never invent a citation.');
    expect(report.steps.find((step) => step.step === 'claude-hook')?.lines.join('\n')).toContain(
      'created AGENTS.md',
    );
  });

  it('keeps an existing AGENTS.md intact and appends one marked CommitLore section', () => {
    const repo = initRepo('agents-existing');
    const path = join(repo, 'AGENTS.md');
    const existing = '# Project instructions\n\nKeep every one of these lines.\n';
    writeFileSync(path, existing);

    runInitAsCli({ cwd: repo });
    const guidance = readFileSync(path, 'utf8');

    expect(guidance.startsWith(existing)).toBe(true);
    expect(guidance).toContain('Keep every one of these lines.');
    expect(guidance).toContain('<!-- commitlore:begin -->');
    expect(guidance).toContain('<!-- commitlore:end -->');
  });

  it('replaces only an older marked section when refreshing repository guidance', () => {
    const repo = initRepo('agents-updated');
    const path = join(repo, 'AGENTS.md');
    writeFileSync(
      path,
      '# Project instructions\n<!-- commitlore:begin -->\nold capture guidance\n<!-- commitlore:end -->\nKeep this line too.\n',
    );

    const report = runInitAsCli({ cwd: repo });
    const guidance = readFileSync(path, 'utf8');

    expect(guidance).toContain('# Project instructions');
    expect(guidance).toContain('Keep this line too.');
    expect(guidance).not.toContain('old capture guidance');
    expect(guidance).toContain('commitlore_prepare_capture');
    expect(report.steps.find((step) => step.step === 'claude-hook')?.lines.join('\n')).toContain(
      'updated the marked',
    );
  });

  it('is byte-idempotent: it replaces neither user instructions nor adds a second section', () => {
    const repo = initRepo('agents-idempotent');
    const path = join(repo, 'AGENTS.md');
    writeFileSync(path, '# Local instructions\n');

    runInitAsCli({ cwd: repo });
    const afterFirst = readFileSync(path, 'utf8');
    const second = runInitAsCli({ cwd: repo });
    const afterSecond = readFileSync(path, 'utf8');

    expect(afterSecond).toBe(afterFirst);
    expect((afterSecond.match(/<!-- commitlore:begin -->/g) ?? [])).toHaveLength(1);
    expect(second.steps.find((step) => step.step === 'claude-hook')?.lines.join('\n')).toContain(
      'unchanged',
    );
  });
});

describe('commitlore init — a step that cannot fully succeed is reported, not hidden', () => {
  it('a fresh repo with no remote keeps its warnings and skips visible, but exits cleanly', () => {
    const repo = initRepo('no-remote');
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'first']);

    const report = runInitAsCli({ cwd: repo });

    const doctorStep = report.steps.find((s) => s.step === 'doctor');
    expect(doctorStep?.code).toBe(0);
    expect(doctorStep?.lines.join('\n')).toContain('no remote is configured');
    expect(doctorStep?.lines.join('\n')).toContain('skipped squash conservation');
    expect(report.exitCode).toBe(0);

    expect(readHookStatus(repo).state).toBe('installed');

    const text = formatInitReport(report);
    expect(text).toContain('init: ready');
    expect(text).not.toContain('attention');
  });

  it('a configured but unreachable remote remains an actionable doctor warning', () => {
    const remote = initBare('remote-unreachable');
    const repo = initRepo('remote-unreachable');
    git(repo, ['remote', 'add', 'origin', remote]);
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'first']);
    rmSync(remote, { recursive: true, force: true });

    const report = runInitAsCli({ cwd: repo });

    const doctorStep = report.steps.find((s) => s.step === 'doctor');
    expect(doctorStep?.code).toBe(1);
    expect(doctorStep?.lines.join('\n')).toContain('could not verify');
    expect(report.exitCode).toBe(1);

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
    expect(report.steps).toHaveLength(7);
    for (const step of report.steps) {
      expect(step.lines.length).toBeGreaterThan(0);
    }
  });
});

describe('commitlore init — the capture policy step', () => {
  const policyPathOf = (repo: string): string => join(repo, POLICY_FILE_NAME);

  it('authorises unattended capture where no policy file exists and registers its initiator', () => {
    const repo = repoWithRemote('policy-enable');

    const report = runInitAsCli({ cwd: repo, unattended: 'enable' });

    const policyStep = report.steps.find((s) => s.step === 'policy');
    expect(policyStep?.code).toBe(0);
    expect(policyStep?.lines.join('\n')).toContain('unattended capture policy enabled');
    expect(policyStep?.lines.join('\n')).toContain('ordinary git commits cannot start it');
    expect(policyStep?.lines.join('\n')).toContain('applies to everyone who clones');

    // The file it wrote is one the resolver accepts, mode beside the setting.
    const resolution = resolvePolicy(repo);
    expect(resolution.error).toBeNull();
    expect(resolution.policy.unattended).toBe(true);
    expect(resolution.policy.mode).toBe('auto');

    const text = formatInitReport(report);
    expect(text).toContain('unattended policy enabled — agent host must initiate capture');
    expect(text).toContain('MCP registration — registered for repository-scoped hosts');
    expect(text).toContain('init: ready');
    expect(report.exitCode).toBe(0);
  });

  it('records a decline without writing a file', () => {
    const repo = repoWithRemote('policy-decline');

    const report = runInitAsCli({ cwd: repo, unattended: 'decline' });

    const policyStep = report.steps.find((s) => s.step === 'policy');
    expect(policyStep?.code).toBe(0);
    expect(policyStep?.lines.join('\n')).toContain('declined at the prompt');
    expect(existsSync(policyPathOf(repo))).toBe(false);
  });

  it('enables nothing where nobody answered, and states that', () => {
    const repo = repoWithRemote('policy-no-answer');

    const report = runInitAsCli({ cwd: repo });

    const policyStep = report.steps.find((s) => s.step === 'policy');
    expect(policyStep?.code).toBe(0);
    expect(policyStep?.lines.join('\n')).toContain('no interactive terminal');
    expect(policyStep?.lines.join('\n')).toContain('commitlore auto on');
    expect(existsSync(policyPathOf(repo))).toBe(false);
  });

  it('leaves an existing policy file unchanged, whatever the flags say', () => {
    const repo = repoWithRemote('policy-existing');
    const policyPath = policyPathOf(repo);
    const original = `{ "mode": "suggest" }\n`;
    writeFileSync(policyPath, original);

    const report = runInitAsCli({ cwd: repo, unattended: 'enable' });

    expect(readFileSync(policyPath, 'utf8')).toBe(original);
    const policyStep = report.steps.find((s) => s.step === 'policy');
    expect(policyStep?.code).toBe(0);
    expect(policyStep?.lines.join('\n')).toContain('left unchanged');
    expect(formatInitReport(report)).toContain('unchanged — unattended capture off');
  });

  it('names a rejected policy file and leaves it untouched', () => {
    const repo = repoWithRemote('policy-rejected');
    const policyPath = policyPathOf(repo);
    const original = `{ "unattended": "yes" }\n`;
    writeFileSync(policyPath, original);

    const report = runInitAsCli({ cwd: repo, unattended: 'enable' });

    expect(readFileSync(policyPath, 'utf8')).toBe(original);
    const policyStep = report.steps.find((s) => s.step === 'policy');
    expect(policyStep?.code).toBe(1);
    expect(policyStep?.lines.join('\n')).toContain('rejected');
    expect(report.exitCode).toBe(1);
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
