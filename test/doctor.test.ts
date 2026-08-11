/**
 * T-301 acceptance criterion for `commitlore doctor`: it reports every check
 * with a status and a way to fix it, `--fix` touches nothing but reversible
 * local config, and it never installs a hook or pushes to a remote.
 */

import type { SpawnSyncReturns } from 'node:child_process';
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
  evaluateInjectRun,
  formatReport,
  runDoctor,
} from '../src/commands/doctor.js';
import { runSquashPreserve } from '../src/commands/squash-preserve.js';
import { execGit } from '../src/core/git.js';
import { packageVersion } from '../src/core/paths.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const QUERY_SKILL = fileURLToPath(new URL('../skills/commitlore-query/SKILL.md', import.meta.url));
import { NOTES_REF, NOTES_REFSPEC, writeRecord } from '../src/core/notes.js';
import { closeIndex, openIndex, rebuildIndex } from '../src/core/index-db.js';
import { runQuery } from '../src/core/query.js';
// The real stub T-202 installs — doctor must recognize that exact file, so the
// fixture is the installer's own output rather than a lookalike.
import { HOOK_MARKER, commitMsgStub } from '../src/hooks/commit-msg.js';
import {
  CLAUDE_HOOK_MARKER,
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

const hookPath = (repo: string): string =>
  resolve(repo, git(repo, ['rev-parse', '--git-path', 'hooks/commit-msg']).trim());

/** Writes a script, creating its directory: an empty init template leaves no `hooks/`. */
const writeScript = (path: string, contents: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
};

/**
 * `root` defaults to this project's own install root, matching where the
 * default `bin` actually lives — the same thing a real `hooks install` would
 * have recorded. Callers that pass an out-of-root `bin` (simulating a
 * `.git/config` edit after install, #71) get that mismatch for free: `root`
 * still reflects the legitimate install, `bin` no longer sits under it.
 */
const recordHookTarget = (
  repo: string,
  bin = resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'),
  node = process.execPath,
  root = realpathSync(PACKAGE_ROOT),
): void => {
  git(repo, ['config', '--local', 'commitlore.bin', bin]);
  git(repo, ['config', '--local', 'commitlore.node', node]);
  git(repo, ['config', '--local', 'commitlore.root', root]);
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

  it('keeps fetch working after --fix when the remote has no notes ref', () => {
    const { repo } = repoWithRemote('doctor-refspec-empty-remote');

    runDoctor({ cwd: repo, fix: true });
    const fetched = execGit(['fetch', 'origin'], { cwd: repo });

    expect(fetched.code).toBe(0);
  });

  it('does not report ok when the fixed refspec cannot be verified', () => {
    const { repo, remote } = repoWithRemote('doctor-refspec-offline');
    rmSync(remote, { recursive: true, force: true });

    const check = runDoctor({ cwd: repo, fix: true }).checks.find(
      (entry) => entry.id === 'notes-refspec',
    );

    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('could not verify');
  });

  it('replaces the unsafe exact refspec under --fix', () => {
    const { repo } = repoWithRemote('doctor-refspec-repair');
    const exact = `+${NOTES_REF}:${NOTES_REF}`;
    git(repo, ['config', '--add', 'remote.origin.fetch', exact]);

    const check = runDoctor({ cwd: repo, fix: true }).checks.find(
      (entry) => entry.id === 'notes-refspec',
    );
    const configured = git(repo, ['config', '--get-all', 'remote.origin.fetch']);

    expect(check?.status).toBe('ok');
    expect(configured).toContain(NOTES_REFSPEC);
    expect(configured).not.toContain(exact);
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
    // Unforced, and that is the whole difference from the case below. This
    // literal carried a `+` until #417: a wildcard that *covers* the mirror is
    // still accepted; one that *overwrites* it is not.
    git(repo, ['config', '--add', 'remote.origin.fetch', 'refs/notes/*:refs/notes/*']);

    const report = runDoctor({ cwd: repo });

    expect(statusOf(report, 'notes-refspec')).toBe('ok');
    const configured = git(repo, ['config', '--get-all', 'remote.origin.fetch'])
      .split('\n')
      .filter((line) => line === NOTES_REFSPEC);
    expect(configured).toHaveLength(1);
  });

  /**
   * #417. A forced notes refspec makes every `git fetch` overwrite the local
   * mirror with the remote's, destroying a record written here and not yet
   * pushed — silently, and with exit 0. It covers the mirror, so the
   * `coversNotes` check reported it `ok`.
   */
  it('warns about a forced notes refspec, and --fix unforces it', () => {
    const { repo } = repoWithRemote('doctor-refspec-forced');
    git(repo, ['config', '--add', 'remote.origin.fetch', '+refs/notes/*:refs/notes/*']);

    const check = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'notes-refspec');
    expect(check?.status).toBe('warn');
    expect(check?.detail).toMatch(/forced refspec/);

    expect(statusOf(runDoctor({ cwd: repo, fix: true }), 'notes-refspec')).toBe('ok');

    const configured = git(repo, ['config', '--get-all', 'remote.origin.fetch'])
      .split('\n')
      .filter((line) => line !== '');
    expect(configured).toContain(NOTES_REFSPEC);
    expect(configured.filter((line) => line.startsWith('+refs/notes/'))).toEqual([]);
  });

  it('leaves a remote’s unrelated refspecs alone when it unforces the notes one', () => {
    const { repo } = repoWithRemote('doctor-refspec-forced-neighbours');
    git(repo, ['config', '--add', 'remote.origin.fetch', '+refs/notes/*:refs/notes/*']);
    git(repo, ['config', '--add', 'remote.origin.fetch', '+refs/tags/*:refs/tags/*']);

    runDoctor({ cwd: repo, fix: true });

    const configured = git(repo, ['config', '--get-all', 'remote.origin.fetch'])
      .split('\n')
      .filter((line) => line !== '');
    expect(configured).toContain('+refs/tags/*:refs/tags/*');
    expect(configured).toContain(NOTES_REFSPEC);
  });

  it('warns when there is no remote at all', () => {
    const repo = initRepo('doctor-no-remote');

    const check = runDoctor({ cwd: repo, fix: true }).checks.find(
      (entry) => entry.id === 'notes-refspec',
    );

    expect(check?.status).toBe('warn');
    expect(check?.needsAttention).toBe(false);
    expect(check?.detail).toContain('no remote');
  });
});

describe('commitlore-query skill', () => {
  it('documents that multi-path queries answer literal paths and report skipped rename following', () => {
    const repo = initRepo('query-skill-multiple-paths');
    // `init` builds the index; without one the query reports that it answered
    // by full scan (#522), which is a true diagnostic about a different thing.
    const handle = openIndex({ cwd: repo });
    rebuildIndex(handle, { reason: 'test fixture' });
    closeIndex(handle);
    const result = runQuery({ cwd: repo, paths: ['a.ts', 'b.ts'] });
    const skill = readFileSync(QUERY_SKILL, 'utf8');

    expect(result.follow).toBe(false);
    expect(result.diagnostics).toEqual([
      'git log --follow accepts exactly one pathspec, so renames are not followed for 2 paths; ' +
        'query one path at a time to follow its rename chain',
    ]);
    expect(skill).toContain(
      'When several paths are supplied, the CLI answers each literal path and\n' +
        'prints a diagnostic that renames were not followed; query one path at a time\n' +
        'when historical names matter.',
    );
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

  it('reports ok after the local mirror has reached the remote', () => {
    const { repo, sha } = repoWithRemote('doctor-push-complete');
    writeRecord(sha, [{ key: 'Blast', value: 'local' }], { cwd: repo });
    git(repo, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    git(repo, ['push', '--quiet', 'origin', NOTES_REF]);

    const check = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'notes-push');

    expect(check?.status).toBe('ok');
    expect(check?.fix).toBeNull();
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

  /**
   * Before #71's install-root enforcement, a recorded CLI outside the package
   * root was merely `warn` — a fact worth noting, not something the stub acted
   * on, because it would run the file either way. Now the stub refuses it, so
   * in the PATH-less environment `hook-runtime` probes with, the hook genuinely
   * cannot resolve a CLI: `fail`, not `warn`, is the honest status.
   */
  it('fails for a byte-current hook whose recorded CLI is outside the package root', () => {
    const { repo } = repoWithRemote('doctor-hook-external-target');
    writeScript(hookPath(repo), commitMsgStub());
    const outside = join(tempDir('doctor-external-target'), 'commitlore.mjs');
    writeFileSync(outside, 'process.exit(0);\n');
    recordHookTarget(repo, outside);

    const check = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'commit-msg-hook');
    expect(check?.status).toBe('fail');
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

  /**
   * An extensionless `commitlore` is no longer a recognized COMMITLORE_BIN shape
   * (ADR-0026 removed the compiled build that made the name meaningful), so doctor
   * reports the rejection wording rather than the active-override notice. The
   * distinction matters to a reader: the override is being *ignored*, and saying
   * "override is active" would tell them the opposite.
   */
  it('rejects a COMMITLORE_BIN override with no extension', () => {
    const { repo } = repoWithRemote('doctor-hook-env-override-binary');
    writeScript(hookPath(repo), commitMsgStub());
    recordHookTarget(repo);
    const override = join(repo, 'commitlore');
    const previous = process.env['COMMITLORE_BIN'];
    process.env['COMMITLORE_BIN'] = override;
    try {
      const check = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'commit-msg-hook');
      expect(check?.status).toBe('warn');
      expect(check?.detail).toContain('is not a .js or .mjs file');
      expect(check?.detail).toContain('the hook ignores it');
    } finally {
      if (previous === undefined) delete process.env['COMMITLORE_BIN'];
      else process.env['COMMITLORE_BIN'] = previous;
    }
  });
});

/**
 * #382: the pin outlives the upgrade.
 *
 * `hooks install` writes `commitlore.bin`/`commitlore.root` into the
 * repository's own config, and nothing rewrites them when a newer CLI is
 * installed somewhere else. The hook then keeps validating every commit with
 * the build it was pinned to while `commitlore --version` reports the new one —
 * and doctor printed that stale path inside its own `ok` line without ever
 * comparing it.
 *
 * The fixture is a second install directory, because that is what the upgrade
 * actually leaves behind: a complete package root of its own, with its own
 * `package.json` version, still sitting on disk and still pinned.
 */
describe('doctor: the pinned CLI is a different version than the running one (#382)', () => {
  /** A package root whose `package.json` declares `version`, with a runnable bundle in it. */
  const otherInstall = (label: string, version: string | null): string => {
    const root = tempDir(label);
    if (version !== null) {
      writeFileSync(
        join(root, 'package.json'),
        `${JSON.stringify({ name: 'commitlore', version, type: 'module' }, null, 2)}\n`,
      );
    }
    const bin = join(root, 'dist', 'commitlore.mjs');
    // Exits 0 for any argv, so the `hook-runtime` probe stays `ok` and this
    // check is the only thing the assertions can be reacting to.
    writeScript(bin, 'process.exit(0);\n');
    return bin;
  };

  const pinnedTo = (label: string, bin: string): string => {
    const { repo } = repoWithRemote(label);
    writeScript(hookPath(repo), commitMsgStub());
    recordHookTarget(repo, bin, process.execPath, realpathSync(dirname(dirname(bin))));
    return repo;
  };

  it('does not report ok, and names both versions and the remedy', () => {
    const repo = pinnedTo('doctor-pin-skew', otherInstall('doctor-pin-old-install', '0.5.0'));

    const report = runDoctor({ cwd: repo });
    const check = report.checks.find((entry) => entry.id === 'commit-msg-hook');

    expect(statusOf(report, 'hook-runtime')).toBe('ok');
    expect(check?.status).not.toBe('ok');
    expect(check?.detail).toContain('0.5.0');
    expect(check?.detail).toContain(packageVersion());
    expect(check?.fix).toContain('hooks install');
  });

  it('stays ok when the pinned install declares the running version', () => {
    const repo = pinnedTo('doctor-pin-same', otherInstall('doctor-pin-same-install', packageVersion()));

    const check = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'commit-msg-hook');

    expect(check?.status).toBe('ok');
  });

  /**
   * A pin whose version cannot be established is not health. It is also not a
   * crash: doctor has to keep reporting every other check.
   */
  it('does not report ok when the pinned install declares no version', () => {
    const repo = pinnedTo('doctor-pin-unknown', otherInstall('doctor-pin-unknown-install', null));

    const report = runDoctor({ cwd: repo });
    const check = report.checks.find((entry) => entry.id === 'commit-msg-hook');

    expect(check?.status).not.toBe('ok');
    expect(check?.detail).toContain('version');
    expect(check?.fix).toContain('hooks install');
    expect(report.checks).toHaveLength(13);
  });
});

describe('doctor: hook runtime', () => {
  const installedHook = (repo: string): void => {
    writeScript(hookPath(repo), commitMsgStub());
    git(repo, ['config', '--local', 'commitlore.bin', resolve(PACKAGE_ROOT, 'dist/cli.js')]);
    git(repo, ['config', '--local', 'commitlore.node', process.execPath]);
    git(repo, ['config', '--local', 'commitlore.root', realpathSync(PACKAGE_ROOT)]);
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

    const report = runDoctor({ cwd: repo });
    const runtime = report.checks.find((entry) => entry.id === 'hook-runtime');
    const installation = report.checks.find((entry) => entry.id === 'commit-msg-hook');
    expect(runtime?.status).toBe('fail');
    expect(runtime?.fix).toContain('hooks install');
    expect(installation?.status).toBe('fail');
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

  it('does not claim "carries no node" when stderr shows a runtime error', () => {
    const repo = initRepo('doctor-runtime-threw');
    installedHook(repo);
    // Override the hook to simulate node running and throwing a stack trace:
    writeScript(
      hookPath(repo),
      '#!/bin/sh\necho "at Object.<anonymous> (/path/dist/mcp/server.js:49:1)" >&2\nexit 1\n',
    );
    chmodSync(hookPath(repo), 0o755);

    const runtime = runtimeCheck(repo);
    expect(runtime?.status).toBe('fail');
    expect(runtime?.detail).not.toContain('carries no node');
  });

  it('mentions missing node when stderr says "node: not found"', () => {
    const repo = initRepo('doctor-runtime-no-node-msg');
    installedHook(repo);
    writeScript(
      hookPath(repo),
      '#!/bin/sh\necho "sh: node: not found" >&2\nexit 127\n',
    );
    chmodSync(hookPath(repo), 0o755);

    const runtime = runtimeCheck(repo);
    expect(runtime?.status).toBe('fail');
    expect(runtime?.detail).toContain('node');
    expect(runtime?.detail).toMatch(/cannot find|not found|missing/i);
  });

  it('reports cause unclear when stderr has unexpected content', () => {
    const repo = initRepo('doctor-runtime-unknown');
    installedHook(repo);
    writeScript(
      hookPath(repo),
      '#!/bin/sh\necho "something unexpected happened" >&2\nexit 42\n',
    );
    chmodSync(hookPath(repo), 0o755);

    const runtime = runtimeCheck(repo);
    expect(runtime?.status).toBe('fail');
    expect(runtime?.detail).toMatch(/unclear|cannot determine/i);
    expect(runtime?.detail).not.toContain('carries no node');
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

  it('runs the configured binary command without node on PATH', () => {
    const repo = recordedRepo('doctor-inject-ok');
    installClaudeHook({ settingsPath: claudeSettingsPath(repo) });
    const bin = tempDir('doctor-inject-bin');
    const command = join(bin, 'commitlore');
    writeScript(command, '#!/bin/sh\nprintf \'{"hookSpecificOutput":{"additionalContext":"context"}}\\n\'\n');
    chmodSync(command, 0o755);
    const previousPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:/usr/bin:/bin`;

    try {
      const check = runtimeCheck(repo);

      expect(check?.status).toBe('ok');
      expect(check?.detail).toContain('returned context');
    } finally {
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
    }
  });

  it('reports when the configured executable is not resolvable', () => {
    const repo = recordedRepo('doctor-inject-not-resolvable');
    installClaudeHook({ settingsPath: claudeSettingsPath(repo) });
    const previousPath = process.env['PATH'];
    process.env['PATH'] = '/usr/bin:/bin';

    try {
      const check = runtimeCheck(repo);

      expect(check?.status).toBe('fail');
      expect(check?.detail).toContain('configured PreToolUse hook executable "commitlore" is not resolvable from PATH');
      expect(check?.fix).toContain('PATH');
    } finally {
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
    }
  });

  it('does not run an unrecognised configured command', () => {
    const repo = recordedRepo('doctor-inject-unrecognised');
    installClaudeHook({
      settingsPath: claudeSettingsPath(repo),
      command: `printf unsafe ${CLAUDE_HOOK_MARKER}`,
    });

    const check = runtimeCheck(repo);

    expect(check?.status).toBe('skipped');
    expect(check?.detail).toContain('not checked');
    expect(check?.detail).toContain('might have side effects');
    expect(check?.fix).toBeNull();
  });

  it('fails for a broken configured command until its executable is repaired', () => {
    const repo = recordedRepo('doctor-inject-broken');
    installClaudeHook({ settingsPath: claudeSettingsPath(repo) });
    const bin = tempDir('doctor-inject-broken-bin');
    const command = join(bin, 'commitlore');
    writeScript(command, '#!/bin/sh\necho broken >&2\nexit 7\n');
    chmodSync(command, 0o755);
    const previousPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:/usr/bin:/bin`;

    try {
      const failed = runtimeCheck(repo);

      expect(failed?.status).toBe('fail');
      expect(failed?.detail).toContain('exits 7');
      expect(failed?.fix).toContain('reinstall the commitlore executable');

      writeScript(command, '#!/bin/sh\nprintf context\\n\n');
      chmodSync(command, 0o755);
      expect(runtimeCheck(repo)?.status).toBe('ok');
    } finally {
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
    }
  });

  it('fails when the hook returns empty for a known-good payload', () => {
    const repo = recordedRepo('doctor-inject-empty');
    installClaudeHook({ settingsPath: claudeSettingsPath(repo) });
    const bin = tempDir('doctor-inject-empty-bin');
    const command = join(bin, 'commitlore');
    writeScript(command, '#!/bin/sh\nexit 0\n');
    chmodSync(command, 0o755);
    const previousPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:/usr/bin:/bin`;
    try {
      const report = runDoctor({ cwd: repo });
      const check = report.checks.find((entry) => entry.id === 'inject-runtime');
      expect(check?.status).toBe('fail');
      expect(check?.detail).toContain('returned no context');
      expect(report.exitCode).toBe(1);
    } finally {
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
    }
  });
});

/**
 * `spawnSync`'s `input` write races a child that exits before reading stdin —
 * reproduced directly against the actual CI Node 22 and 24 images at a
 * 15-25% hit rate per run, 0/several-thousand on macOS, which is why the two
 * tests above only ever caught this in CI. When that write is what fails,
 * Node still reports the process's real `status`/`stdout`/`stderr` on the
 * same result object that carries the `error` — so these tests hand
 * `evaluateInjectRun` a synthetic result with both, and assert on the
 * decision without depending on the race actually firing.
 */
describe('doctor: PreToolUse hook runtime — deciding a completed run', () => {
  const ctx = {
    id: 'inject-runtime',
    title: 'PreToolUse hook runtime',
    executable: 'commitlore',
    path: 'probe.ts',
    fix: 'reinstall the commitlore executable that the configured hook runs, then rerun: commitlore doctor',
    unavailableFix:
      'install the configured hook executable where the hook can resolve it (or add its install directory to PATH), then rerun: commitlore doctor',
  };

  const epipe = (): NodeJS.ErrnoException => {
    const error = new Error('spawnSync commitlore EPIPE') as NodeJS.ErrnoException;
    error.code = 'EPIPE';
    return error;
  };

  const run = (overrides: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> => ({
    pid: 1,
    output: [null, '', ''],
    stdout: '',
    stderr: '',
    status: 0,
    signal: null,
    ...overrides,
  });

  it('reports ok when a real success status arrives alongside an EPIPE from the input-write race', () => {
    const result = evaluateInjectRun(
      run({ status: 0, stdout: '{"hookSpecificOutput":{"additionalContext":"context"}}\n', error: epipe() }),
      ctx,
    );

    expect(result.status).toBe('ok');
    expect(result.detail).toContain('returned context');
  });

  it('still fails a hook that resolves and genuinely exits non-zero, even racing the same EPIPE', () => {
    const result = evaluateInjectRun(run({ status: 7, stderr: 'broken\n', error: epipe() }), ctx);

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('exits 7');
    expect(result.detail).toContain('broken');
  });

  it('still fails empty output from a hook that ran, even racing the same EPIPE', () => {
    const result = evaluateInjectRun(run({ status: 0, stdout: '', error: epipe() }), ctx);

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('returned no context');
  });

  it('fails a broken command with no EPIPE in the picture, the ordinary case', () => {
    const result = evaluateInjectRun(run({ status: 7, stderr: 'broken\n' }), ctx);

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('exits 7');
  });

  it('treats a genuinely unresolvable executable as unresolvable, not as "could not run"', () => {
    const error = new Error('spawnSync commitlore ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    const result = evaluateInjectRun(run({ status: null, error }), ctx);

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('is not resolvable from PATH');
    expect(result.fix).toBe(ctx.unavailableFix);
  });

  it('falls back to a generic message when spawning fails for a reason other than ENOENT', () => {
    const error = new Error('spawnSync commitlore EACCES') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    const result = evaluateInjectRun(run({ status: null, error }), ctx);

    expect(result.status).toBe('fail');
    expect(result.detail).toBe('could not run the PreToolUse hook: spawnSync commitlore EACCES');
    expect(result.fix).toBe(ctx.fix);
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
      'inject-version',
      'mcp-lifecycle',
      'pending-backlog',
      'git-trailers',
      'history-depth',
      'index-health',
      'squash-conservation',
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
    expect(parsed.checks).toHaveLength(13);
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

describe('doctor: squash conservation (bug-issue-60 finding 1)', () => {
  /** A feature branch off `main`, one commit declaring `recordId`. */
  const growFeatureBranch = (repo: string, recordId: string): { base: string; featureSha: string } => {
    const base = git(repo, ['rev-parse', 'HEAD']).trim();
    git(repo, ['checkout', '--quiet', '-b', 'feature']);
    writeFileSync(join(repo, 'feature.ts'), 'export const x = 1;\n');
    git(repo, ['add', '--', 'feature.ts']);
    git(repo, [
      'commit',
      '--quiet',
      '-m',
      `add the feature\n\nLimit: the vendor caps concurrency\nRecord-Id: ${recordId}\n`,
    ]);
    const featureSha = git(repo, ['rev-parse', 'HEAD']).trim();
    git(repo, ['checkout', '--quiet', 'main']);
    return { base, featureSha };
  };

  /** Collapses `feature` onto `main` the way `git merge --squash` does, alone. */
  const squashWithoutPreserving = (repo: string): string => {
    git(repo, ['merge', '--squash', 'feature']);
    git(repo, ['commit', '--quiet', '-m', 'Squash in the feature']);
    return git(repo, ['rev-parse', 'HEAD']).trim();
  };

  /** Adds refs directly so the cap fixture measures branches, not branch-creation process startup. */
  const fillBranches = (repo: string, total: number): void => {
    const existing = git(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads'])
      .split('\n')
      .filter((line) => line !== '').length;
    const head = git(repo, ['rev-parse', 'HEAD']).trim();
    const creates = Array.from(
      { length: total - existing },
      (_, index) => `create refs/heads/zz-cap-${String(index + 1).padStart(3, '0')} ${head}`,
    );
    if (creates.length > 0) {
      const result = execGit(['update-ref', '--stdin'], {
        cwd: repo,
        stdin: `${creates.join('\n')}\n`,
      });
      if (result.code !== 0) throw new Error(`git update-ref failed: ${result.stderr}`);
    }
  };

  const preservedSquash = (repo: string, recordId: string): void => {
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'seed']);
    const { base, featureSha } = growFeatureBranch(repo, recordId);
    const mergeSha = squashWithoutPreserving(repo);
    const outcome = runSquashPreserve({ range: `${base}..${featureSha}`, target: mergeSha, cwd: repo });
    expect(outcome.code).toBe(0);
    rebuildIndex(openIndex({ cwd: repo }));
  };

  it('skips when no local branch looks like a squash source', () => {
    const repo = initRepo('squash-conservation-none');
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'first']);

    const report = runDoctor({ cwd: repo });
    expect(statusOf(report, 'squash-conservation')).toBe('skipped');
  });

  it('warns when a squashed branch left a Record-Id behind that HEAD cannot find', () => {
    const repo = initRepo('squash-conservation-lost');
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'seed']);
    growFeatureBranch(repo, 'r-lost01');
    squashWithoutPreserving(repo);

    const report = runDoctor({ cwd: repo });
    expect(statusOf(report, 'squash-conservation')).toBe('warn');
    const entry = report.checks.find((check) => check.id === 'squash-conservation');
    expect(entry?.detail).toContain('r-lost01');
    expect(entry?.detail).toContain('feature');
    expect(entry?.fix).toContain('squash-preserve');
  });

  it('reports ok once squash-preserve has attached the branch records', () => {
    const repo = initRepo('squash-conservation-fixed');
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'seed']);
    const { base, featureSha } = growFeatureBranch(repo, 'r-fixed01');
    const mergeSha = squashWithoutPreserving(repo);

    const before = runDoctor({ cwd: repo });
    expect(statusOf(before, 'squash-conservation')).toBe('warn');

    const outcome = runSquashPreserve({
      range: `${base}..${featureSha}`,
      target: mergeSha,
      cwd: repo,
    });
    expect(outcome.code).toBe(0);
    rebuildIndex(openIndex({ cwd: repo }));

    const after = runDoctor({ cwd: repo });
    const entry = after.checks.find((check) => check.id === 'squash-conservation');
    expect(entry?.status).toBe('ok');
    expect(entry?.detail).toContain('reachable from HEAD');
  });

  it('discloses the 200-branch limit instead of reporting an unqualified subset', () => {
    const repo = initRepo('squash-conservation-capped');
    preservedSquash(repo, 'r-capped01');
    fillBranches(repo, 201);

    const entry = runDoctor({ cwd: repo }).checks.find((check) => check.id === 'squash-conservation');

    expect(entry?.status).toBe('ok');
    expect(entry?.evidence).toMatchObject({ branches_seen: '201', branches_checked: '200' });
    expect(entry?.detail).toContain('first 200 of 201 local branches');
  });

  it('keeps a 200-branch scan byte-for-byte on the existing report shape', () => {
    const repo = initRepo('squash-conservation-at-cap');
    preservedSquash(repo, 'r-atcap01');
    fillBranches(repo, 200);

    const entry = runDoctor({ cwd: repo }).checks.find((check) => check.id === 'squash-conservation');

    expect(entry?.status).toBe('ok');
    expect(entry?.detail).toBe(
      '1 squash-shaped branch(es) checked, every declared Record-Id is reachable from HEAD',
    );
    expect(entry?.evidence).toEqual({
      candidates: '1',
      checked: '1',
      uncheckable: '0',
      lost_count: '0',
    });
  });
});
