/**
 * T-301 acceptance criterion for `commitlore doctor`: it reports every check
 * with a status and a way to fix it, `--fix` touches nothing but reversible
 * local config, and it never installs a hook or pushes to a remote.
 */

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

import { afterAll, describe, expect, it } from 'vitest';

import {
  type CheckStatus,
  type DoctorReport,
  formatReport,
  runDoctor,
} from '../src/commands/doctor.js';
import { execGit } from '../src/core/git.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
import { NOTES_REF, NOTES_REFSPEC, writeRecord } from '../src/core/notes.js';
import { closeIndex, openIndex, rebuildIndex } from '../src/core/index-db.js';
// The real stub T-202 installs — doctor must recognize that exact file, so the
// fixture is the installer's own output rather than a lookalike.
import { HOOK_MARKER, commitMsgStub } from '../src/hooks/commit-msg.js';
import {
  claudeSettingsPath,
  installClaudeHook,
} from '../src/hooks/claude-settings.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-${label}-`));
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

const initRepo = (label: string): string => {
  const dir = tempDir(label);
  return createTestRepo({ path: dir });
};

const initBare = (label: string): string => {
  const dir = tempDir(label);
  return createTestRepo({ path: dir, bare: true });
};

/** A repo with `origin` wired to a local bare repo, and one commit. */
const repoWithRemote = (label: string): { repo: string; remote: string; sha: string } => {
  const remote = initBare(`${label}-remote`);
  const repo = initRepo(label);
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'first']);
  return { repo, remote, sha: git(repo, ['rev-parse', 'HEAD']).trim() };
};

const statusOf = (report: DoctorReport, id: string): CheckStatus | undefined =>
  report.checks.find((entry) => entry.id === id)?.status;

const hookPath = (repo: string): string => join(repo, '.git', 'hooks', 'commit-msg');

/** Writes a script, creating its directory: an empty init template leaves no `hooks/`. */
const writeScript = (path: string, contents: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
};

const recordHookTarget = (
  repo: string,
  bin = resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'),
  node = process.execPath,
): void => {
  git(repo, ['config', '--local', 'commitlore.bin', bin]);
  git(repo, ['config', '--local', 'commitlore.node', node]);
};

describe('doctor: notes fetch refspec', () => {
  it('warns when the remote does not fetch the mirror, and says what fixes it', () => {
    const { repo } = repoWithRemote('doctor-refspec-missing');

    const report = runDoctor({ cwd: repo });
    const check = report.checks.find((entry) => entry.id === 'notes-refspec');

    expect(check?.status).toBe('warn');
    expect(check?.fixed).toBe(false);
    expect(check?.fix).toContain(NOTES_REFSPEC);
    expect(check?.detail).toContain(NOTES_REF);
  });

  it('adds the refspec under --fix and reports ok afterwards', () => {
    const { repo } = repoWithRemote('doctor-refspec-fix');

    const fixed = runDoctor({ cwd: repo, fix: true });
    expect(statusOf(fixed, 'notes-refspec')).toBe('ok');
    expect(fixed.checks.find((entry) => entry.id === 'notes-refspec')?.fixed).toBe(true);

    expect(git(repo, ['config', '--get-all', 'remote.origin.fetch'])).toContain(NOTES_REFSPEC);
    expect(statusOf(runDoctor({ cwd: repo }), 'notes-refspec')).toBe('ok');
  });

  it('is idempotent: a second --fix adds no duplicate refspec', () => {
    const { repo } = repoWithRemote('doctor-refspec-idempotent');

    runDoctor({ cwd: repo, fix: true });
    const second = runDoctor({ cwd: repo, fix: true });

    expect(statusOf(second, 'notes-refspec')).toBe('ok');
    expect(second.checks.find((entry) => entry.id === 'notes-refspec')?.fixed).toBe(false);

    const configured = git(repo, ['config', '--get-all', 'remote.origin.fetch'])
      .split('\n')
      .filter((line) => line === NOTES_REFSPEC);
    expect(configured).toHaveLength(1);
  });

  it('accepts a wildcard refspec that already covers the mirror', () => {
    const { repo } = repoWithRemote('doctor-refspec-wildcard');
    git(repo, ['config', '--add', 'remote.origin.fetch', '+refs/notes/*:refs/notes/*']);

    const report = runDoctor({ cwd: repo });

    expect(statusOf(report, 'notes-refspec')).toBe('ok');
    // No redundant line was added.
    expect(git(repo, ['config', '--get-all', 'remote.origin.fetch'])).not.toContain(NOTES_REFSPEC);
  });

  it('warns when there is no remote at all', () => {
    const repo = initRepo('doctor-no-remote');

    const check = runDoctor({ cwd: repo, fix: true }).checks.find(
      (entry) => entry.id === 'notes-refspec',
    );

    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('no remote');
  });
});

describe('doctor: notes push', () => {
  it('reports ok when there is no local mirror to push', () => {
    const { repo } = repoWithRemote('doctor-push-empty');

    const check = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'notes-push');

    expect(check?.status).toBe('ok');
    expect(check?.detail).toContain(`git push origin ${NOTES_REF}`);
  });

  it('warns with the push command once the clone holds records, and pushes nothing itself', () => {
    const { repo, remote, sha } = repoWithRemote('doctor-push-pending');
    writeRecord(sha, [{ key: 'Blast', value: 'local' }], { cwd: repo });

    const check = runDoctor({ cwd: repo, fix: true }).checks.find(
      (entry) => entry.id === 'notes-push',
    );

    expect(check?.status).toBe('warn');
    expect(check?.fix).toBe(`git push origin ${NOTES_REF}`);
    // --fix is local-only: the shared ref is untouched.
    expect(git(remote, ['for-each-ref', '--format=%(refname)', 'refs/notes/'])).toBe('');
  });
});

describe('doctor: commit-msg hook', () => {
  it('warns when no hook is installed and does not install one', () => {
    const { repo } = repoWithRemote('doctor-hook-absent');

    const check = runDoctor({ cwd: repo, fix: true }).checks.find(
      (entry) => entry.id === 'commit-msg-hook',
    );

    expect(check?.status).toBe('warn');
    expect(check?.fix).toContain('hooks install');
    // Installation belongs to T-202. doctor only ever read the path.
    expect(existsSync(hookPath(repo))).toBe(false);
  });

  it('reports ok for a hook carrying our marker, and leaves it byte-identical', () => {
    const { repo } = repoWithRemote('doctor-hook-present');
    const contents = commitMsgStub();
    writeScript(hookPath(repo), contents);
    recordHookTarget(repo);

    const check = runDoctor({ cwd: repo, fix: true }).checks.find(
      (entry) => entry.id === 'commit-msg-hook',
    );

    expect(check?.status).toBe('ok');
    expect(check?.fix).toBeNull();
    expect(check?.detail).toContain(resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    expect(check?.detail).toContain(process.execPath);
    expect(readFileSync(hookPath(repo), 'utf8')).toBe(contents);
  });

  it("warns when a foreign hook occupies the path, without touching it", () => {
    const { repo } = repoWithRemote('doctor-hook-foreign');
    const contents = '#!/bin/sh\nexec some-other-linter "$1"\n';
    writeScript(hookPath(repo), contents);

    const check = runDoctor({ cwd: repo, fix: true }).checks.find(
      (entry) => entry.id === 'commit-msg-hook',
    );

    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('does not invoke commitlore');
    expect(readFileSync(hookPath(repo), 'utf8')).toBe(contents);
  });

  it('finds the hook through --git-path rather than a hardcoded .git/', () => {
    const { repo } = repoWithRemote('doctor-hook-worktree');
    const hooks = tempDir('doctor-hook-worktree-hooks');
    git(repo, ['config', 'core.hooksPath', hooks]);
    writeScript(join(hooks, 'commit-msg'), commitMsgStub());
    recordHookTarget(repo);

    const check = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'commit-msg-hook');

    expect(check?.status).toBe('ok');
    expect(check?.detail).toContain(hooks);
  });
});

/**
 * The environment a git hook actually gets, which is not the one you tested in.
 *
 * This project has shipped a bare `node` in a hook resolution branch three
 * times. Each one was invisible to every check that read configuration, and each
 * surfaced as a commit that silently skipped validation.
 */
describe('doctor: a stale stub', () => {
  it('warns when the installed stub is not the current one', () => {
    const { repo } = repoWithRemote('doctor-hook-stale');
    // A stub from before the resolution order changed: our marker, older body.
    writeScript(hookPath(repo), `#!/bin/sh\n${HOOK_MARKER}\nexec commitlore validate "$1"\n`);

    const check = runDoctor({ cwd: repo }).checks.find((e) => e.id === 'commit-msg-hook');
    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('out of date');
    expect(check?.fix).toContain('hooks install');
  });

  it('reports ok for the current stub', () => {
    const { repo } = repoWithRemote('doctor-hook-current');
    writeScript(hookPath(repo), commitMsgStub());
    recordHookTarget(repo);

    const check = runDoctor({ cwd: repo }).checks.find((e) => e.id === 'commit-msg-hook');
    expect(check?.status).toBe('ok');
    expect(check?.detail).toContain('commitlore.bin:');
    expect(check?.detail).toContain('commitlore.node:');
  });

  it('warns for a byte-current hook whose recorded CLI is outside the package root', () => {
    const { repo } = repoWithRemote('doctor-hook-external-target');
    writeScript(hookPath(repo), commitMsgStub());
    const outside = join(tempDir('doctor-external-target'), 'commitlore.mjs');
    writeFileSync(outside, 'process.exit(0);\n');
    recordHookTarget(repo, outside);

    const check = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'commit-msg-hook');
    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain(outside);
    expect(check?.detail).toContain(process.execPath);
    expect(check?.fix).toContain('hooks install');
  });

  it('surfaces an active COMMITLORE_BIN override and where it points', () => {
    const { repo } = repoWithRemote('doctor-hook-env-override');
    writeScript(hookPath(repo), commitMsgStub());
    recordHookTarget(repo);
    const override = join(repo, 'override-bin');
    const previous = process.env['COMMITLORE_BIN'];
    process.env['COMMITLORE_BIN'] = override;
    try {
      const check = runDoctor({ cwd: repo }).checks.find(
        (entry) => entry.id === 'commit-msg-hook',
      );
      expect(check?.status).toBe('warn');
      expect(check?.detail).toContain(`COMMITLORE_BIN: ${override}`);
    } finally {
      if (previous === undefined) delete process.env['COMMITLORE_BIN'];
      else process.env['COMMITLORE_BIN'] = previous;
    }
  });
});

describe('doctor: hook runtime', () => {
  const installedHook = (repo: string): void => {
    writeScript(hookPath(repo), commitMsgStub());
    git(repo, ['config', '--local', 'commitlore.bin', resolve(PACKAGE_ROOT, 'dist/cli.js')]);
    git(repo, ['config', '--local', 'commitlore.node', process.execPath]);
  };

  const runtimeCheck = (repo: string) =>
    runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'hook-runtime');

  it('reports ok when the hook validates with no node on PATH', () => {
    const repo = initRepo('doctor-runtime-ok');
    installedHook(repo);
    expect(runtimeCheck(repo)?.status).toBe('ok');
  });

  it('says there is nothing to run when no hook is installed', () => {
    // Not a second complaint about the missing hook: `commit-msg-hook` owns that.
    expect(runtimeCheck(initRepo('doctor-runtime-none'))?.status).toBe('ok');
  });

  it('fails when the recorded interpreter is gone', () => {
    const repo = initRepo('doctor-runtime-no-node');
    installedHook(repo);
    git(repo, ['config', '--local', 'commitlore.node', '/nonexistent/node']);

    const check = runtimeCheck(repo);
    expect(check?.status).toBe('fail');
    expect(check?.fix).toContain('hooks install');
  });

  it('fails when the hook has no recorded path at all', () => {
    const repo = initRepo('doctor-runtime-unrecorded');
    writeScript(hookPath(repo), commitMsgStub());
    expect(runtimeCheck(repo)?.status).toBe('fail');
  });

  /**
   * The regression that motivated reordering the stub: a stale
   * `node_modules/.bin/commitlore` beside the repository used to win over the
   * recorded path, and that shim's own first line is `exec node`.
   */
  it('is not fooled by a sibling shim that assumes node on PATH', () => {
    const repo = initRepo('doctor-runtime-shim');
    installedHook(repo);
    const bin = join(repo, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    writeScript(join(bin, 'commitlore'), '#!/bin/sh\nexec node /nonexistent/cli.js "$@"\n');

    expect(runtimeCheck(repo)?.status).toBe('ok');
  });
});

describe('doctor: PreToolUse hook runtime', () => {
  const recordedRepo = (label: string): string => {
    const repo = initRepo(label);
    writeFileSync(join(repo, 'probe.ts'), 'export const probe = true;\n');
    git(repo, ['add', 'probe.ts']);
    git(repo, [
      'commit',
      '--quiet',
      '-m',
      'Add doctor injection probe\n\nLimit: doctor injection probe\nRecord-Id: r-doctorprobe',
    ]);
    return repo;
  };

  const runtimeCheck = (repo: string) =>
    runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'inject-runtime');

  it('reports an unwired repository instead of calling it healthy', () => {
    const check = runtimeCheck(recordedRepo('doctor-inject-unwired'));

    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('not installed');
    expect(check?.fix).toContain('install-claude-hook');
  });

  it('runs a known-good payload and reports non-empty context', () => {
    const repo = recordedRepo('doctor-inject-ok');
    installClaudeHook({ settingsPath: claudeSettingsPath(repo) });

    const check = runtimeCheck(repo);

    expect(check?.status).toBe('ok');
    expect(check?.detail).toContain('returned context');
  });

  it('fails when the hook returns empty for a known-good payload', () => {
    const repo = recordedRepo('doctor-inject-empty');
    installClaudeHook({ settingsPath: claudeSettingsPath(repo) });
    const emptyRoot = tempDir('doctor-inject-empty-root');
    const previous = process.env['CLAUDE_PLUGIN_ROOT'];
    process.env['CLAUDE_PLUGIN_ROOT'] = emptyRoot;
    try {
      const report = runDoctor({ cwd: repo });
      const check = report.checks.find((entry) => entry.id === 'inject-runtime');
      expect(check?.status).toBe('fail');
      expect(check?.detail).toContain('returned no context');
      expect(report.exitCode).toBe(1);
    } finally {
      if (previous === undefined) delete process.env['CLAUDE_PLUGIN_ROOT'];
      else process.env['CLAUDE_PLUGIN_ROOT'] = previous;
    }
  });
});

describe('doctor: cli runtime', () => {
  it('reports ok because this checkout is built', () => {
    const check = runDoctor({ cwd: initRepo('doctor-cli-runtime') }).checks.find(
      (entry) => entry.id === 'cli-runtime',
    );
    expect(check?.status).toBe('ok');
    // The bundle, not the tsc output: a clone has only the bundle, and probing
    // the wrong artifact is what turned CI red for three commits.
    expect(check?.detail).toContain('dist/commitlore.mjs');
  });
});

describe('doctor: git capability and index', () => {
  it('verifies interpret-trailers by actually parsing a probe', () => {
    const { repo } = repoWithRemote('doctor-git');

    const check = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'git-trailers');

    expect(check?.status).toBe('ok');
    expect(check?.detail).toContain('git version');
  });

  it('fails, and exits 1, when git cannot parse trailers', () => {
    const { repo } = repoWithRemote('doctor-git-broken');
    // A git that cannot answer the probe makes every other reading suspect,
    // so this is the one condition that fails the command.
    const fakeBin = tempDir('doctor-git-broken-bin');
    writeScript(join(fakeBin, 'git'), '#!/bin/sh\necho "broken git" >&2\nexit 3\n');
    chmodSync(join(fakeBin, 'git'), 0o755);

    const realPath = process.env['PATH'];
    let report: DoctorReport;
    try {
      process.env['PATH'] = fakeBin;
      report = runDoctor({ cwd: repo });
    } finally {
      process.env['PATH'] = realPath;
    }

    const check = report.checks.find((entry) => entry.id === 'git-trailers');
    expect(check?.status).toBe('fail');
    expect(check?.fix).toContain('git');
    expect(report.exitCode).toBe(1);
  });

  it('warns rather than fails when a repository has no index yet', () => {
    // The index is a derived cache (ADR-0003) and every query has a --no-index
    // path, so its absence costs speed, not correctness. Reporting it as a
    // failure would train people to ignore doctor's exit code.
    const { repo } = repoWithRemote('doctor-index');

    const check = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'index-health');

    expect(check?.status).toBe('warn');
    expect(check?.fix).toContain('commitlore index');
  });

  it('reports the index as ok once it is current with HEAD', () => {
    const { repo } = repoWithRemote('doctor-index-built');
    const handle = openIndex({ cwd: repo });
    rebuildIndex(handle);
    closeIndex(handle);

    const check = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'index-health');

    expect(check?.status).toBe('ok');
    expect(check?.detail).toContain('current with HEAD');
  });
});

describe('doctor: report', () => {
  it('gives every check a status and exits 0 when nothing fails', () => {
    const { repo } = repoWithRemote('doctor-report');

    const report = runDoctor({ cwd: repo });

    expect(report.checks.map((entry) => entry.id)).toEqual([
      'cli-runtime',
      'notes-refspec',
      'notes-push',
      'commit-msg-hook',
      'hook-runtime',
      'inject-runtime',
      'git-trailers',
      'index-health',
    ]);
    for (const entry of report.checks) {
      expect(['ok', 'warn', 'fail', 'skipped']).toContain(entry.status);
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.detail.length).toBeGreaterThan(0);
    }
    expect(report.checks.some((entry) => entry.status === 'warn')).toBe(true);
    expect(report.exitCode).toBe(0);
  });

  it('serializes to JSON that parses back with a status per check', () => {
    const { repo } = repoWithRemote('doctor-json');

    const report = runDoctor({ cwd: repo });
    const parsed = JSON.parse(JSON.stringify(report, null, 2)) as DoctorReport;

    expect(parsed).toEqual(report);
    expect(parsed.checks).toHaveLength(8);
    for (const entry of parsed.checks) {
      expect(entry.status).toBeTypeOf('string');
      expect(entry.id).toBeTypeOf('string');
    }
  });

  it('prints one line per check plus the fix for anything not ok', () => {
    const { repo } = repoWithRemote('doctor-format');

    const text = formatReport(runDoctor({ cwd: repo }));

    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('notes fetch refspec');
    expect(text).toContain(`fix: git config --add remote.origin.fetch '${NOTES_REFSPEC}'`);
    expect(text).toContain('index health');
  });
});
