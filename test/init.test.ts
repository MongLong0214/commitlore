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

  writeFileSync(
    injectCommand,
    `#!/bin/sh\nexec "${process.execPath}" "${CLI_JS}" "$@"\n`,
    { mode: 0o755 },
  );
  chmodSync(injectCommand, 0o755);
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

const withCliEnvironment = <T>(run: () => T): T => {
  const originalArgv = process.argv[1];
  const originalPath = process.env['PATH'];
  process.argv[1] = CLI_JS;
  process.env['PATH'] = `${injectBin}:/usr/bin:/bin`;
  try {
    return run();
  } finally {
    process.argv[1] = originalArgv;
    if (originalPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = originalPath;
  }
};

const runInitAsCli = (opts: InitOptions): InitReport => withCliEnvironment(() => runInit(opts));

const runDoctorAsCli = (opts: { cwd: string }) => withCliEnvironment(() => runDoctor(opts));

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
      'release',
      'hooks',
      'trust',
      'index',
      'claude-hook',
      'mcp-registration',
      'policy',
      'doctor',
    ]);
    expect(report.steps.map((s) => s.code)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(report.exitCode).toBe(0);

    expect(readHookStatus(repo).state).toBe('installed');
    expect(existsSync(hookPathOf(repo))).toBe(true);
    expect(trailerCount(repo)).toBeGreaterThanOrEqual(0);
  });

  it('is idempotent: a second run changes nothing and still reports 0/0/0', () => {
    const repo = repoWithRemote('idempotent');

    const first = runInitAsCli({ cwd: repo, mcpScope: 'project' });
    const hookBytesAfterFirst = readFileSync(hookPathOf(repo), 'utf8');
    const mcpBytesAfterFirst = readFileSync(join(repo, '.mcp.json'), 'utf8');
    const second = runInitAsCli({ cwd: repo, mcpScope: 'project' });

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
    expect(text).toContain('✓ MCP server');
    expect(text).toContain('✓ Final check');
    expect(text).toContain('init: ready');
  });
});

describe('commitlore init — MCP registration at scope project', () => {
  const initiatorStatus = (repo: string): string | undefined =>
    runDoctorAsCli({ cwd: repo }).checks.find((check) => check.id === 'unattended-initiator')?.status;

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

    const report = runInitAsCli({ cwd: repo, mcpScope: 'project' });
    const registration = report.steps.find((step) => step.step === 'mcp-registration');
    const config = JSON.parse(readFileSync(join(repo, '.mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, { command?: unknown; args?: unknown }>;
    };

    expect(registration?.code).toBe(0);
    expect(registration?.lines.join('\n')).toContain('registered the capture server for this repository');
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

    const report = runInitAsCli({ cwd: repo, mcpScope: 'project' });
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

    const report = runInitAsCli({ cwd: repo, mcpScope: 'project' });

    expect(readFileSync(join(repo, '.mcp.json'), 'utf8')).toBe(original);
    const registration = report.steps.find((step) => step.step === 'mcp-registration');
    expect(registration?.code).toBe(0);
    expect(registration?.lines.join('\n')).toContain('already registers commitlore');
    expect(registration?.lines.join('\n')).toContain('left unchanged');
  });

  /**
   * This expectation deliberately flipped. A failed registration used to be
   * code 0, so `init` printed a checkmark and finished with `init: ready` over
   * a repository where nothing can start a capture. Capture is the product; a
   * setup command that could not wire it is not ready, whatever else worked.
   *
   * It is still not fatal — hooks, index and delivery all installed — so this
   * is 1, the code that already means "ran, and something needs you", never 2.
   */
  it('does not call the install ready when the capture server could not be registered', () => {
    const repo = repoWithRemote('mcp-registration-failure');
    mkdirSync(join(repo, '.mcp.json'));

    const report = runInitAsCli({ cwd: repo, mcpScope: 'project' });
    const registration = report.steps.find((step) => step.step === 'mcp-registration');
    const lines = registration?.lines.join('\n') ?? '';

    expect(registration?.code).toBe(1);
    expect(lines).toContain('could not register the capture server in this repository');
    expect(lines).toContain('nothing here can start a capture');
    // And what to do about it, because the repair is one file the operator owns.
    expect(lines).toContain('"mcpServers"');
    expect(lines).toContain('commitlore doctor');

    // The rest of the install still ran.
    expect(report.steps.find((step) => step.step === 'hooks')?.code).toBe(0);
    expect(report.steps.find((step) => step.step === 'index')?.code).toBe(0);

    expect(report.exitCode).toBe(1);
    const rendered = formatInitReport(report);
    expect(rendered).not.toContain('init: ready');
    expect(rendered).toContain('MCP server');
  });
});

/**
 * The host-owned scopes (`user`, `local`) are written by the host's own CLI,
 * so every case here puts a stub named `claude` in front of the PATH and reads
 * back what it was actually asked. Two properties need that:
 *
 *  - the argv is a contract with a program this repository does not own, and a
 *    test that mocked the function instead would keep passing after the flags
 *    drifted;
 *  - `claude mcp add` exits **1** both when the name already exists and when it
 *    genuinely refuses, so the code that separates them has to be exercised
 *    against a program that reproduces both.
 *
 * `withCliEnvironment` already narrows PATH to the injected CLI plus
 * `/usr/bin:/bin`, so a real Claude Code install on the machine running these
 * tests is out of reach — nothing here can register a server on a developer's
 * own account.
 */
describe('commitlore init — MCP registration at the host-owned scopes', () => {
  const hostCliStub = (label: string, body: string): { bin: string; log: string } => {
    const bin = tempDir(label);
    const log = join(bin, 'argv.log');
    const stub = join(bin, 'claude');
    writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n${body}\n`, {
      mode: 0o755,
    });
    chmodSync(stub, 0o755);
    return { bin, log };
  };

  const withHostCli = <T>(bin: string, run: () => T): T => {
    const originalArgv = process.argv[1];
    const originalPath = process.env['PATH'];
    process.argv[1] = CLI_JS;
    process.env['PATH'] = `${bin}:${injectBin}:/usr/bin:/bin`;
    try {
      return run();
    } finally {
      process.argv[1] = originalArgv;
      if (originalPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = originalPath;
    }
  };

  const mcpStep = (report: InitReport) => report.steps.find((step) => step.step === 'mcp-registration');

  it('asks the host to register, with the argv the host documents', () => {
    const repo = repoWithRemote('mcp-user-ok');
    const { bin, log } = hostCliStub('host-ok', 'exit 0');

    const report = withHostCli(bin, () => runInit({ cwd: repo, mcpScope: 'user' }));
    const step = mcpStep(report);

    expect(readFileSync(log, 'utf8').trim()).toBe(
      'mcp add --scope user commitlore -- commitlore mcp',
    );
    expect(step?.code).toBe(0);
    expect(step?.lines.join('\n')).toContain('registered the capture server at scope "user"');
    expect(step?.lines.join('\n')).toContain('every repository you open');
    // The scope's whole point: nothing was written into the repository.
    expect(existsSync(join(repo, '.mcp.json'))).toBe(false);
    expect(report.exitCode).toBe(0);
  });

  it('passes the local scope through rather than silently promoting it to user', () => {
    const repo = repoWithRemote('mcp-local-ok');
    const { bin, log } = hostCliStub('host-local', 'exit 0');

    const report = withHostCli(bin, () => runInit({ cwd: repo, mcpScope: 'local' }));

    expect(readFileSync(log, 'utf8').trim()).toBe(
      'mcp add --scope local commitlore -- commitlore mcp',
    );
    expect(mcpStep(report)?.lines.join('\n')).toContain('for you only');
    expect(existsSync(join(repo, '.mcp.json'))).toBe(false);
  });

  /**
   * Idempotence, and the reason this path cannot read the host's message: the
   * stub refuses the add exactly as the real CLI does — exit 1, prose about the
   * name existing — and answers `mcp get`. A re-run of `init` is a success.
   */
  it('treats a name the host already knows as registered, not as a failure', () => {
    const repo = repoWithRemote('mcp-user-existing');
    const { bin, log } = hostCliStub(
      'host-existing',
      [
        'case "$1 $2" in',
        '  "mcp get") exit 0 ;;',
        'esac',
        'echo "MCP server commitlore already exists in user config" >&2',
        'exit 1',
      ].join('\n'),
    );

    const report = withHostCli(bin, () => runInit({ cwd: repo, mcpScope: 'user' }));
    const step = mcpStep(report);

    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      'mcp add --scope user commitlore -- commitlore mcp',
      'mcp get commitlore',
    ]);
    expect(step?.code).toBe(0);
    expect(step?.lines.join('\n')).toContain('the host already has an MCP server under this name');
    // It must not claim the scope it could not observe.
    expect(step?.lines.join('\n')).not.toContain('every repository you open');
    expect(report.exitCode).toBe(0);
  });

  /**
   * The control for the case above. Same exit code from `add`; what differs is
   * that nothing answers to the name afterwards. A reader of only the first
   * exit code cannot tell these two apart, which is why the second question is
   * asked at all.
   */
  it('reports a genuine refusal in the host’s own words, and does not call the install ready', () => {
    const repo = repoWithRemote('mcp-user-refused');
    const { bin } = hostCliStub('host-refused', 'echo "config file is read-only" >&2\nexit 1');

    const report = withHostCli(bin, () => runInit({ cwd: repo, mcpScope: 'user' }));
    const step = mcpStep(report);
    const lines = step?.lines.join('\n') ?? '';

    expect(step?.code).toBe(1);
    expect(lines).toContain('config file is read-only');
    expect(lines).toContain('claude mcp add --scope user commitlore -- commitlore mcp');
    expect(report.exitCode).toBe(1);
    expect(formatInitReport(report)).not.toContain('init: ready');
  });

  /**
   * A machine with no Claude Code is not a broken installation: the plugin path
   * and the Codex path both carry the server themselves. Reporting this at 1
   * would tell every Codex-only user that their install failed.
   */
  it('does not fail the install when the host CLI is absent', () => {
    const repo = repoWithRemote('mcp-user-no-host');

    // No stub: withCliEnvironment's PATH carries the injected commitlore and
    // the system directories, and no `claude`.
    const report = runInitAsCli({ cwd: repo, mcpScope: 'user' });
    const step = mcpStep(report);
    const lines = step?.lines.join('\n') ?? '';

    expect(step?.code).toBe(0);
    expect(lines).toContain('is not on PATH');
    expect(lines).toContain('claude mcp add --scope user commitlore -- commitlore mcp');
    expect(existsSync(join(repo, '.mcp.json'))).toBe(false);
    expect(report.exitCode).toBe(0);
  });

  it('writes nothing at all for scope none, and says which scopes exist', () => {
    const repo = repoWithRemote('mcp-none');
    const { bin, log } = hostCliStub('host-none', 'exit 0');

    const report = withHostCli(bin, () => runInit({ cwd: repo, mcpScope: 'none' }));
    const step = mcpStep(report);

    expect(existsSync(log)).toBe(false);
    expect(existsSync(join(repo, '.mcp.json'))).toBe(false);
    expect(step?.code).toBe(0);
    expect(step?.lines.join('\n')).toContain('no MCP registration written');
    expect(report.exitCode).toBe(0);
  });

  /**
   * `runInit` is the programmatic entry point, and two of the four scopes write
   * outside the repository it was handed. A caller that did not ask must not
   * get that — including this suite, which would otherwise register a server on
   * whichever machine runs it.
   */
  it('registers nothing when the caller named no scope', () => {
    const repo = repoWithRemote('mcp-default-inert');
    const { bin, log } = hostCliStub('host-default', 'exit 0');

    const report = withHostCli(bin, () => runInit({ cwd: repo }));

    expect(existsSync(log)).toBe(false);
    expect(existsSync(join(repo, '.mcp.json'))).toBe(false);
    expect(mcpStep(report)?.code).toBe(0);
  });

  /**
   * Spawned rather than called, because the scope is validated in the command
   * action and the exit code is the contract (SPEC §10: 2 is usage). Falling
   * back to the default on a misspelling would install something the operator
   * did not choose while telling them nothing.
   */
  it('refuses an unknown scope at the usage exit code, before installing anything', () => {
    const repo = repoWithRemote('mcp-bad-scope');

    const run = spawnSync(process.execPath, [CLI_JS, 'init', '--mcp-scope', 'globally'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${injectBin}:/usr/bin:/bin` },
    });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('--mcp-scope "globally" is not one of user, project, local, none');
    expect(existsSync(join(repo, '.mcp.json'))).toBe(false);
    expect(existsSync(hookPathOf(repo))).toBe(false);
  });
});

/**
 * `--agents-md` is opt-in: the capture procedure ships in the MCP server's
 * `instructions`, which every wired host receives on initialize, so the file is
 * not how the procedure travels. These cases describe what the flag does when
 * somebody asks for it; the default is asserted below.
 */
describe('commitlore init --agents-md — repository-owned agent guidance', () => {
  it('creates AGENTS.md with the shared capture procedure when the repository has none', () => {
    const repo = initRepo('agents-created');

    const report = runInitAsCli({ cwd: repo, agentsGuidance: true });
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

  // Both branches of #781. `init` used to write the Claude PreToolUse hook
  // unconditionally, while the plugin registers the same hook, so a user who
  // followed the README to the plugin and then ran `init` had every matched
  // tool call answered twice.
  //
  // `HOME` is injected because the verdict reads it. Left ambient, these two
  // assert whatever the developer happens to have installed -- the suite
  // passed identically under both states before these existed, which is what
  // no coverage looks like from the outside.
  const withHome = (home: string, run: () => void): void => {
    const previous = process.env['HOME'];
    process.env['HOME'] = home;
    try {
      run();
    } finally {
      if (previous === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previous;
    }
  };

  const pluginHome = (label: string, enabled: boolean): string => {
    const home = tempDir(label);
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'commitlore@commitlore': [{ scope: 'user' }] } }),
    );
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'commitlore@commitlore': enabled } }),
    );
    return home;
  };

  it('writes the Claude hook when no plugin covers the repository', () => {
    const repo = initRepo('claude-hook-no-plugin');
    withHome(tempDir('claude-hook-empty-home'), () => {
      runInit({ cwd: repo });
      const settings = JSON.parse(readFileSync(claudeSettingsPath(repo), 'utf8')) as {
        hooks?: { PreToolUse?: unknown[] };
      };
      expect(settings.hooks?.PreToolUse ?? []).toHaveLength(1);
    });
  });

  it('leaves the Claude hook to the plugin when the plugin is installed and enabled', () => {
    const repo = initRepo('claude-hook-plugin');
    withHome(pluginHome('claude-hook-plugin-home', true), () => {
      const report = runInit({ cwd: repo });
      expect(existsSync(claudeSettingsPath(repo))).toBe(false);
      expect(report.steps.find((step) => step.step === 'claude-hook')?.lines.join('\n')).toContain(
        'not written',
      );
    });
  });

  // Installed but switched off is not covered, and the hook has to be written.
  // This is the direction the whole predicate is built around: being wrong
  // toward a duplicate costs a payload somebody reports, being wrong toward
  // silence costs delivery nobody notices is missing.
  it('writes the Claude hook when the plugin is installed but disabled', () => {
    const repo = initRepo('claude-hook-plugin-off');
    withHome(pluginHome('claude-hook-plugin-off-home', false), () => {
      runInit({ cwd: repo });
      expect(existsSync(claudeSettingsPath(repo))).toBe(true);
    });
  });

  it('keeps an existing AGENTS.md intact and appends one marked CommitLore section', () => {
    const repo = initRepo('agents-existing');
    const path = join(repo, 'AGENTS.md');
    const existing = '# Project instructions\n\nKeep every one of these lines.\n';
    writeFileSync(path, existing);

    runInitAsCli({ cwd: repo, agentsGuidance: true });
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

    const report = runInitAsCli({ cwd: repo, agentsGuidance: true });
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

    runInitAsCli({ cwd: repo, agentsGuidance: true });
    const afterFirst = readFileSync(path, 'utf8');
    const second = runInitAsCli({ cwd: repo, agentsGuidance: true });
    const afterSecond = readFileSync(path, 'utf8');

    expect(afterSecond).toBe(afterFirst);
    expect((afterSecond.match(/<!-- commitlore:begin -->/g) ?? [])).toHaveLength(1);
    expect(second.steps.find((step) => step.step === 'claude-hook')?.lines.join('\n')).toContain(
      'unchanged',
    );
  });
});

describe('commitlore init leaves AGENTS.md alone by default', () => {
  it('creates no AGENTS.md in a repository that has none', () => {
    const repo = initRepo('agents-default-absent');

    const report = runInitAsCli({ cwd: repo });

    expect(existsSync(join(repo, 'AGENTS.md'))).toBe(false);
    expect(report.steps.find((step) => step.step === 'claude-hook')?.lines.join('\n')).toContain(
      'AGENTS.md left alone',
    );
  });

  it('does not touch an AGENTS.md the repository already had', () => {
    const repo = initRepo('agents-default-existing');
    const before = '# Project instructions\n\nKeep every line.\n';
    writeFileSync(join(repo, 'AGENTS.md'), before);

    runInitAsCli({ cwd: repo });

    expect(readFileSync(join(repo, 'AGENTS.md'), 'utf8')).toBe(before);
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
    expect(report.steps).toHaveLength(8);
    for (const step of report.steps) {
      expect(step.lines.length).toBeGreaterThan(0);
    }
  });
});

describe('commitlore init — the capture policy step', () => {
  const policyPathOf = (repo: string): string => join(repo, POLICY_FILE_NAME);

  it('authorises unattended capture where no policy file exists and registers its initiator', () => {
    const repo = repoWithRemote('policy-enable');

    const report = runInitAsCli({ cwd: repo, unattended: 'enable', mcpScope: 'project' });

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
    expect(text).toContain('MCP server — registered for this repository');
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
