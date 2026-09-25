/**
 * Doctor check effects are injected so their branch logic can run without a
 * fixture repository. Every case below uses a cwd that does not exist and a
 * complete synthetic context; none initialises or writes a Git repository.
 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { checkHook } from '../src/commands/doctor/checks/capture-commit-msg-hook.js';
import { checkHookRuntime } from '../src/commands/doctor/checks/capture-hook-runtime.js';
import { checkPendingBacklog } from '../src/commands/doctor/checks/capture-pending-backlog.js';
import { checkInjectRuntime } from '../src/commands/doctor/checks/delivery-inject-runtime.js';
import { checkInjectVersion } from '../src/commands/doctor/checks/delivery-inject-version.js';
import { checkMcpLifecycle } from '../src/commands/doctor/checks/delivery-mcp-lifecycle.js';
import { checkHistoryDepth } from '../src/commands/doctor/checks/history-history-depth.js';
import { checkSquashConservation } from '../src/commands/doctor/checks/history-squash-conservation.js';
import { checkIndex } from '../src/commands/doctor/checks/index-index-health.js';
import { checkRuntime } from '../src/commands/doctor/checks/runtime-cli-runtime.js';
import { checkInstallationIntegrity } from '../src/commands/doctor/checks/runtime-installation-integrity.js';
import { checkGit } from '../src/commands/doctor/checks/runtime-git-trailers.js';
import { checkPush } from '../src/commands/doctor/checks/transport-notes-push.js';
import { checkRefspec } from '../src/commands/doctor/checks/transport-notes-refspec.js';
import { check, type DoctorCheck, type DoctorContext } from '../src/commands/doctor/model.js';
import type { ExecGitOptions, GitResult } from '../src/core/git.js';

const noRepository = join(tmpdir(), `commitlore-doctor-effects-no-repository-${process.pid}`);

const gitResult = (overrides: Partial<GitResult> = {}): GitResult => ({
  code: 1,
  stdout: '',
  stderr: 'synthetic git failure',
  ...overrides,
});

const childResult = (overrides: Record<string, unknown> = {}) => ({
  pid: 0,
  output: [null, '', ''],
  stdout: '',
  stderr: '',
  status: 0,
  signal: null,
  ...overrides,
});

const context = (overrides: Partial<DoctorContext> = {}): DoctorContext => {
  const git = vi.fn(() => gitResult());
  const spawn = vi.fn(() => childResult());
  const openIndex = vi.fn(() => {
    throw new Error('synthetic missing index');
  });

  return {
    opts: { cwd: noRepository },
    now: () => 0n,
    memo: new Map(),
    git: git as DoctorContext['git'],
    spawn: spawn as DoctorContext['spawn'],
    env: {},
    openIndex: openIndex as DoctorContext['openIndex'],
    ...overrides,
  };
};

const ok = (id: string): DoctorCheck =>
  check(id, 'capture', id, 'ok', 'synthetic dependency is healthy', null, false, false, {
    evidence: { source: 'synthetic' },
  });

describe('doctor check effects', () => {
  it('uses synthetic effects rather than a repository on disk', () => {
    expect(existsSync(noRepository)).toBe(false);
  });

  it('runs cli-runtime’s failure branch through the injected spawner', () => {
    const spawn = vi.fn(() => childResult({ status: 1, stderr: 'synthetic executable failure' }));
    const row = checkRuntime(context({ spawn: spawn as DoctorContext['spawn'] }));

    expect(row.status).toBe('fail');
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('runs installation-integrity against the running installation', () => {
    // This check reads PACKAGE_ROOT through readInstalledFile; there is no
    // injected filesystem to point at a missing tree. The missing-file fail
    // is asserted by spawning a copied install in doctor.test.ts.
    expect(checkInstallationIntegrity(context()).status).toBe('ok');
  });

  it('runs notes-refspec without a fixture repository', () => {
    expect(checkRefspec(context()).status).toBe('warn');
  });

  it('runs notes-push’s no-local-mirror branch through injected Git', () => {
    const git = vi.fn(() => gitResult());
    const row = checkPush(context({ git: git as DoctorContext['git'] }));

    expect(row.status).toBe('ok');
    expect(git).toHaveBeenCalledOnce();
  });

  /**
   * #1136. The call that reaches a remote gets a limit, cannot prompt, and
   * refuses interactive SSH, unless the user chose an SSH command of their own.
   * That command may carry the key or routing the remote needs, and
   * GIT_SSH_COMMAND would override it, core.sshCommand included.
   */
  describe('a call that reaches a remote (#1136)', () => {
    const remoteCall = (env: NodeJS.ProcessEnv, sshCommand?: string): ExecGitOptions | undefined => {
      const calls: Array<{ args: string[]; options?: ExecGitOptions }> = [];
      const git = vi.fn((args: string[], options?: ExecGitOptions) => {
        calls.push({ args, options });
        if (args[0] === 'rev-parse') return gitResult({ code: 0, stdout: `${'a'.repeat(40)}\n` });
        if (args.join(' ') === 'config --get core.sshCommand' && sshCommand !== undefined) {
          return gitResult({ code: 0, stdout: `${sshCommand}\n` });
        }
        return gitResult();
      });
      checkPush(context({ git: git as DoctorContext['git'], env }));
      return calls.find(({ args }) => args[0] === 'ls-remote')?.options;
    };

    it('is bounded and non-interactive', () => {
      const options = remoteCall({ PATH: '/usr/bin' });

      expect(options?.timeout).toBe(15_000);
      expect(options?.env).toEqual({
        PATH: '/usr/bin',
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
      });
    });

    it('keeps an SSH command the user set, in the environment or in git config', () => {
      expect(remoteCall({ GIT_SSH_COMMAND: 'ssh -i deploy-key' })?.env?.['GIT_SSH_COMMAND']).toBe('ssh -i deploy-key');
      expect(remoteCall({ GIT_SSH: '/usr/local/bin/ssh-wrapper' })?.env).not.toHaveProperty('GIT_SSH_COMMAND');
      expect(remoteCall({}, 'ssh -i deploy-key')?.env).not.toHaveProperty('GIT_SSH_COMMAND');
    });

    it('takes a longer limit from COMMITLORE_DOCTOR_REMOTE_TIMEOUT_MS', () => {
      expect(remoteCall({ COMMITLORE_DOCTOR_REMOTE_TIMEOUT_MS: '60000' })?.timeout).toBe(60_000);
      expect(remoteCall({ COMMITLORE_DOCTOR_REMOTE_TIMEOUT_MS: 'soon' })?.timeout).toBe(15_000);
    });

    it('names the limit when the call ran out of time', () => {
      const git = vi.fn((args: string[]) =>
        args[0] === 'rev-parse'
          ? gitResult({ code: 0, stdout: `${'a'.repeat(40)}\n` })
          : gitResult({ code: -1, stderr: 'spawnSync git ETIMEDOUT', timedOut: true }));
      const row = checkPush(context({ git: git as DoctorContext['git'] }));

      expect(row.status).toBe('warn');
      expect(row.detail).toBe('could not verify (origin: no answer within 15s)');
    });
  });

  it('runs commit-msg-hook’s non-repository branch through injected Git', () => {
    const git = vi.fn(() => gitResult());
    const row = checkHook(context({ git: git as DoctorContext['git'] }), ok('hook-runtime'));

    expect(row.status).toBe('warn');
    expect(git).toHaveBeenCalledOnce();
  });

  it('runs hook-runtime’s non-repository branch through injected Git', () => {
    const git = vi.fn(() => gitResult());
    const row = checkHookRuntime(context({ git: git as DoctorContext['git'] }));

    expect(row.status).toBe('warn');
    expect(git).toHaveBeenCalledOnce();
  });

  // The absent-settings branch splits on whether the Claude Code plugin covers
  // this repository (#781), which it reads from the context's `HOME`. Injected
  // here rather than set on `process.env`: an earlier draft of this test read
  // the ambient one, passed on a machine with the plugin installed, and failed
  // under the empty `HOME` that CI actually has.
  const homeContext = (home: string): DoctorContext => context({ env: { HOME: home } });

  it('warns on absent settings when no plugin covers the repository', () => {
    const home = mkdtempSync(join(tmpdir(), 'doctor-effects-nohome-'));
    expect(checkInjectRuntime(homeContext(home)).status).toBe('warn');
  });

  it('skips on absent settings when the plugin is installed and enabled', () => {
    const home = mkdtempSync(join(tmpdir(), 'doctor-effects-plugin-'));
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'commitlore@commitlore': [{ scope: 'user' }] } }),
    );
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'commitlore@commitlore': true } }),
    );
    expect(checkInjectRuntime(homeContext(home)).status).toBe('skipped');
  });

  it('runs inject-version’s no-hook branch without a repository', () => {
    expect(checkInjectVersion(context(), new Map([['inject-runtime', ok('inject-runtime')]])).status).toBe('skipped');
  });

  it('runs mcp-lifecycle’s empty-history branch without a repository', () => {
    expect(checkMcpLifecycle(context()).status).toBe('ok');
  });

  it('runs pending-backlog’s empty branch without a repository', () => {
    expect(checkPendingBacklog(context()).status).toBe('ok');
  });

  it('runs git-trailers through the injected Git version runner', () => {
    const git = vi.fn(() => gitResult({ code: 0, stdout: 'git version synthetic\n', stderr: '' }));
    const row = checkGit(context({ git: git as DoctorContext['git'] }));

    expect(row.status).toBe('ok');
    expect(git).toHaveBeenCalledWith(['--version'], { cwd: noRepository });
  });

  it('runs history-depth without a repository', () => {
    expect(checkHistoryDepth(context()).status).toBe('ok');
  });

  it('runs index-health’s missing-index branch through the injected opener', () => {
    const openIndex = vi.fn(() => {
      throw new Error('synthetic missing index');
    });
    const row = checkIndex(context({ openIndex: openIndex as DoctorContext['openIndex'] }));

    expect(row.status).toBe('warn');
    expect(openIndex).toHaveBeenCalledWith({ cwd: noRepository, readonly: true });
  });

  it('runs squash-conservation’s unborn-HEAD branch through injected Git', () => {
    const git = vi.fn(() => gitResult());
    const row = checkSquashConservation(context({ git: git as DoctorContext['git'] }));

    expect(row.status).toBe('skipped');
    expect(git).toHaveBeenCalledOnce();
  });
});
