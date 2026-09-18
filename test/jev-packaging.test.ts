/**
 * #1050 / #1051 §2: installation, uninstallation, and the read paths a record
 * travels once it exists.
 *
 * The prototype is supposed to be removable and invisible. That claim is about
 * *installation state* rather than about runtime, so the tests here are about
 * files: what `init` writes, what `uninstall` takes back, what a stub installed
 * by an older release does against this binary, and whether a record the
 * prototype produced is an ordinary record on every native path afterwards.
 *
 * Two of these are regressions #1050 asks for by name — an installed path
 * containing a space, and a repository that moved its hooks with
 * `core.hooksPath` — because both are the kind of thing a string-count
 * assertion passes and a real install fails.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { claudeSettingsPath, installClaudeHook, uninstallClaudeHook, INJECT_HOOK } from '../src/hooks/claude-settings.js';
import { JEV_SESSION_HOOK, JEV_SESSION_HOOK_MARKER } from '../src/commands/jev-session.js';
import { commitMsgStub } from '../src/hooks/commit-msg.js';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(REPO_ROOT, 'dist', 'commitlore.mjs');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const KEY = 'apikey_test_packaging_000000000000000000';

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Pack',
  GIT_AUTHOR_EMAIL: 'pack@example.invalid',
  GIT_COMMITTER_NAME: 'Pack',
  GIT_COMMITTER_EMAIL: 'pack@example.invalid',
  GIT_CONFIG_GLOBAL: '/nonexistent/commitlore-tests-must-not-read-this',
  GIT_CONFIG_SYSTEM: '/nonexistent/commitlore-tests-must-not-read-this',
} as const;

const git = (cwd: string, args: readonly string[]): { status: number; out: string } => {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV },
    shell: false,
  });
  return { status: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
};

const cli = (cwd: string, args: readonly string[], extra: Record<string, string> = {}): { status: number; out: string } => {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, ...extra },
    shell: false,
  });
  return { status: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
};

const temporary = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-jevpack-${name}-`));
  scratch.push(dir);
  return dir;
};

const repo = (name: string, inner = 'repo'): string => {
  const dir = join(temporary(name), inner);
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '--initial-branch=main', '.']);
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--no-verify', '-m', 'initial']);
  return dir;
};

describe('#1050 an installed path with a space in it', () => {
  it('installs, and the hook it wrote actually runs', () => {
    // The regression #1050 names. An unquoted path in a stub passes every
    // string-count assertion and dies at the first commit.
    const dir = join(temporary('spaces'), 'my repo with spaces');
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '--initial-branch=main', '.']);
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--no-verify', '-m', 'initial']);

    const installed = cli(dir, ['hooks', 'install']);
    expect(installed.status, installed.out).toBe(0);

    writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n');
    git(dir, ['add', '-A']);
    const bad = spawnSync('git', ['commit', '-F', '-'], {
      cwd: dir,
      input: 'Bad\n\nProse.\n\nBlast: worldwide\nRecord-Id: r-spaces0001\n',
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, COMMITLORE_BIN: CLI, COMMITLORE_JEV_API_KEY: KEY },
      shell: false,
    });
    // The hook ran and refused: a stub that could not resolve its own path
    // would either pass the commit or die with 127.
    expect(bad.status).not.toBe(0);
    expect(`${bad.stdout}${bad.stderr}`).toContain('enum Blast');
  }, 300_000);
});

describe('#1050 a repository that moved its hooks', () => {
  it('honours core.hooksPath for install and for the chained-hook check', () => {
    // `--git-path hooks` honours `core.hooksPath`; `.git/hooks` does not. The
    // producer's foreign-hook check reads the same resolved directory, so a
    // repository that moved its hooks must not be told there is no foreign hook
    // when there is one.
    const dir = repo('hookspath');
    const elsewhere = join(dirname(dir), 'git-hooks');
    mkdirSync(elsewhere, { recursive: true });
    git(dir, ['config', 'core.hooksPath', elsewhere]);

    const installed = cli(dir, ['hooks', 'install']);
    expect(installed.status, installed.out).toBe(0);
    expect(existsSync(join(elsewhere, 'commit-msg')), 'the hook went to .git/hooks anyway').toBe(true);
    expect(existsSync(join(dir, '.git', 'hooks', 'commit-msg'))).toBe(false);

    // And it is the hook git runs.
    writeFileSync(join(dir, 'a.ts'), 'export const a = 3;\n');
    git(dir, ['add', '-A']);
    const bad = spawnSync('git', ['commit', '-F', '-'], {
      cwd: dir,
      input: 'Bad\n\nProse.\n\nUndo: cheap\nRecord-Id: r-hookspath01\n',
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, COMMITLORE_BIN: CLI },
      shell: false,
    });
    expect(bad.status).not.toBe(0);
    expect(`${bad.stdout}${bad.stderr}`).toContain('enum Undo');
  }, 300_000);
});

describe('#1050 a stub from an older release keeps working', () => {
  it('validates natively and acquires no prototype until a reinstall', () => {
    // The promise that makes the gate's changed exec line an opt-in rather than
    // a migration: an old stub execs `validate`, which is untouched.
    const dir = repo('oldstub');
    const installed = cli(dir, ['hooks', 'install']);
    expect(installed.status, installed.out).toBe(0);

    const hookPath = join(dir, '.git', 'hooks', 'commit-msg');
    const current = readFileSync(hookPath, 'utf8');
    expect(current).toBe(commitMsgStub());
    // Exactly what v1.4.1 wrote: the same body, execing `validate`.
    const old = current.replaceAll('commit-msg --message-file "$1"', 'validate --message-file "$1"');
    expect(old).not.toBe(current);
    writeFileSync(hookPath, old, { mode: 0o755 });
    chmodSync(hookPath, 0o755);

    writeFileSync(join(dir, 'a.ts'), 'export const a = 4;\n');
    git(dir, ['add', '-A']);
    const bad = spawnSync('git', ['commit', '-F', '-'], {
      cwd: dir,
      input: 'Bad\n\nProse.\n\nCertainty: maybe\nRecord-Id: r-oldstub0001\n',
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, COMMITLORE_BIN: CLI, COMMITLORE_JEV_API_KEY: KEY },
      shell: false,
    });
    expect(bad.status, 'the old stub stopped validating').not.toBe(0);
    expect(`${bad.stdout}${bad.stderr}`).toContain('enum Certainty');

    // No prototype reached it: with a key set and an old stub, nothing optional
    // was written.
    expect(existsSync(join(dir, '.git', 'commitlore', 'jev-last-result.json'))).toBe(false);

    // And `hooks status` names the remedy, which is what `r-binx428` warned a
    // stub change would produce and the reason a reinstall is the opt-in.
    const status = cli(dir, ['hooks', 'status']);
    expect(status.out).toContain('stub is out of date');
    expect(status.out).toContain('commitlore hooks install');
    expect(cli(dir, ['hooks', 'install']).status).toBe(0);
    expect(readFileSync(hookPath, 'utf8')).toBe(commitMsgStub());
  }, 300_000);
});

describe('#1050 the SessionStart entry installs and uninstalls cleanly', () => {
  const settingsWith = (name: string, extra: Record<string, unknown> = {}): string => {
    const dir = temporary(name);
    const path = join(dir, 'settings.json');
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          // A foreign hook on the same event, and an unrelated key. Both must
          // survive every operation below.
          $schema: 'https://example.invalid/schema.json',
          permissions: { allow: ['Bash(ls:*)'] },
          hooks: {
            SessionStart: [
              { matcher: 'startup', hooks: [{ type: 'command', command: 'echo somebody-elses-hook' }] },
            ],
          },
          ...extra,
        },
        null,
        2,
      )}\n`,
    );
    return path;
  };

  it('merges beside a foreign hook and leaves every other key alone', () => {
    const path = settingsWith('merge');
    const result = installClaudeHook({ settingsPath: path, kind: JEV_SESSION_HOOK });
    expect(result.code, result.stderr).toBe(0);

    const after = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(after['$schema']).toBe('https://example.invalid/schema.json');
    expect(after['permissions']).toEqual({ allow: ['Bash(ls:*)'] });
    const groups = (after['hooks'] as { SessionStart: { hooks: { command: string }[] }[] }).SessionStart;
    const commands = groups.flatMap((group) => group.hooks.map((entry) => entry.command));
    expect(commands).toContain('echo somebody-elses-hook');
    expect(commands.some((command) => command.includes(JEV_SESSION_HOOK_MARKER))).toBe(true);
  }, 300_000);

  it('is idempotent', () => {
    const path = settingsWith('idempotent');
    installClaudeHook({ settingsPath: path, kind: JEV_SESSION_HOOK });
    const once = readFileSync(path, 'utf8');
    const again = installClaudeHook({ settingsPath: path, kind: JEV_SESSION_HOOK });
    expect(again.changed).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(once);
  }, 300_000);

  it('uninstalls itself and not the foreign hook or the injection entry', () => {
    const path = settingsWith('uninstall');
    installClaudeHook({ settingsPath: path, kind: INJECT_HOOK });
    installClaudeHook({ settingsPath: path, kind: JEV_SESSION_HOOK });

    const removed = uninstallClaudeHook({ settingsPath: path, kind: JEV_SESSION_HOOK });
    expect(removed.code, removed.stderr).toBe(0);

    const after = JSON.parse(readFileSync(path, 'utf8')) as {
      permissions?: unknown;
      hooks?: { SessionStart?: { hooks: { command: string }[] }[]; PreToolUse?: { hooks: { command: string }[] }[] };
    };
    const session = (after.hooks?.SessionStart ?? []).flatMap((group) =>
      group.hooks.map((entry) => entry.command),
    );
    expect(session).toContain('echo somebody-elses-hook');
    expect(session.some((command) => command.includes(JEV_SESSION_HOOK_MARKER))).toBe(false);
    // The injection entry is a different marker and is untouched.
    const inject = (after.hooks?.PreToolUse ?? []).flatMap((group) =>
      group.hooks.map((entry) => entry.command),
    );
    expect(inject.some((command) => command.includes('commitlore-inject-hook'))).toBe(true);
    expect(after.permissions).toEqual({ allow: ['Bash(ls:*)'] });
  }, 300_000);

  it('the documented uninstall command removes both entries', () => {
    const dir = repo('injectuninstall');
    const path = claudeSettingsPath(dir);
    installClaudeHook({ settingsPath: path, kind: INJECT_HOOK });
    installClaudeHook({ settingsPath: path, kind: JEV_SESSION_HOOK });

    const result = cli(dir, ['inject', 'uninstall-claude-hook']);
    expect(result.status, result.out).toBe(0);

    const after = readFileSync(path, 'utf8');
    expect(after).not.toContain('commitlore-inject-hook');
    expect(after).not.toContain(JEV_SESSION_HOOK_MARKER);
  }, 300_000);

  it('refuses to touch a settings file it cannot read', () => {
    const dir = temporary('unreadable');
    const path = join(dir, 'settings.json');
    writeFileSync(path, '{ this is not json');
    const result = installClaudeHook({ settingsPath: path, kind: JEV_SESSION_HOOK });
    expect(result.code).toBe(2);
    expect(readFileSync(path, 'utf8')).toBe('{ this is not json');
  }, 300_000);
});

describe('#1050 no artifact carries the key', () => {
  it('nothing the installation writes contains it', () => {
    const dir = repo('nokeyartifacts');
    expect(cli(dir, ['hooks', 'install'], { COMMITLORE_JEV_API_KEY: KEY }).status).toBe(0);
    expect(cli(dir, ['auto', 'on', '--local'], { COMMITLORE_JEV_API_KEY: KEY }).status).toBe(0);
    installClaudeHook({ settingsPath: claudeSettingsPath(dir), kind: JEV_SESSION_HOOK });

    const files: string[] = [];
    const walk = (at: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const path = join(at, entry.name);
        if (entry.isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      let body: string;
      try {
        body = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      expect(body, `${file} contains the key`).not.toContain(KEY);
    }
  }, 300_000);
});

describe('#1051 §2 a prototype record is an ordinary record afterwards', () => {
  it('survives a push to a bare remote and a fresh keyless clone', () => {
    // The point of copying a decision into a commit trailer is that it travels.
    // Nothing new is added for that here — this is the existing mirror and the
    // existing `git push`, exercised with a record the prototype produced.
    const dir = repo('remote');
    expect(cli(dir, ['hooks', 'install']).status).toBe(0);
    expect(cli(dir, ['index', '--rebuild']).status).toBe(0);

    // A record the prototype's own composer produced, applied the way it
    // applies one: the value and its evidence both come from a conversation.
    writeFileSync(join(dir, 'a.ts'), 'export const a = 5;\n');
    git(dir, ['add', '-A']);
    const message =
      'Lower the ceiling\n\nOrdinary prose.\n\n' +
      'Limit: The vendor caps us at three retries per minute on that endpoint.\n' +
      'Record-Id: r-travelled0001\nProvenance: drafted\n';
    const committed = spawnSync('git', ['commit', '-F', '-'], {
      cwd: dir,
      input: message,
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, COMMITLORE_BIN: CLI },
      shell: false,
    });
    expect(committed.status, `${committed.stdout}${committed.stderr}`).toBe(0);

    const bare = join(temporary('bare'), 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', bare], { encoding: 'utf8' });
    git(dir, ['remote', 'add', 'origin', bare]);
    const pushed = git(dir, ['push', '-q', 'origin', 'main']);
    expect(pushed.status, pushed.out).toBe(0);

    const clone = join(temporary('clone'), 'fresh');
    execFileSync('git', ['clone', '-q', bare, clone], {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV },
    });

    // A fresh reader, no key anywhere, unchanged tooling.
    const read = cli(clone, ['limits', 'a.ts']);
    expect(read.out).toContain('three retries per minute');
    expect(read.out).toContain('r-travelled0001');
    // Exit 3, not 0, and that is the documented answer rather than a failure:
    // SPEC §10 uses it for "answered, but the notes mirror is unfetched or the
    // scan was truncated", and an ordinary clone has no `refs/notes/commitlore`
    // refspec until `commitlore init` writes one. The record itself came
    // through the trailer, which is the half that travels with a clone.
    expect([0, 3]).toContain(read.status);
    expect(read.out).toContain('notes mirror has not been fetched');
  }, 300_000);

  it('travels through the notes mirror to a bare remote and back', () => {
    // The other half of the round trip #1051 §2 asks for. A commit trailer
    // reaches a clone on its own; `refs/notes/commitlore` does not, and this is
    // the existing mirror and the existing `commitlore sync` carrying a record
    // the prototype produced — no new remote-write mechanism.
    const dir = repo('mirror');
    expect(cli(dir, ['hooks', 'install']).status).toBe(0);
    writeFileSync(join(dir, 'a.ts'), 'export const a = 7;\n');
    git(dir, ['add', '-A']);
    const block =
      'Limit: The vendor caps us at three retries per minute on that endpoint.\n' +
      'Record-Id: r-travelled0002\nProvenance: drafted\n';
    const committed = spawnSync('git', ['commit', '-F', '-'], {
      cwd: dir,
      input: `Lower the ceiling\n\nOrdinary prose.\n\n${block}`,
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, COMMITLORE_BIN: CLI },
      shell: false,
    });
    expect(committed.status, `${committed.stdout}${committed.stderr}`).toBe(0);

    // The mirror: the same record under `refs/notes/commitlore`, which is what
    // `squash-preserve` writes and what a clone has to fetch separately.
    const noted = git(dir, ['notes', '--ref', 'refs/notes/commitlore', 'add', '-m', block, 'HEAD']);
    expect(noted.status, noted.out).toBe(0);

    const bare = join(temporary('baremirror'), 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', bare], { encoding: 'utf8' });
    git(dir, ['remote', 'add', 'origin', bare]);
    expect(git(dir, ['push', '-q', 'origin', 'main']).status).toBe(0);

    // `commitlore sync` publishes the mirror. It is the existing command and it
    // is run with no key in the environment.
    const synced = cli(dir, ['sync']);
    expect(synced.status, synced.out).toBe(0);
    expect(
      git(bare, ['rev-parse', '--verify', 'refs/notes/commitlore']).status,
      'the mirror never reached the remote',
    ).toBe(0);

    const clone = join(temporary('clonemirror'), 'fresh');
    execFileSync('git', ['clone', '-q', bare, clone], {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV },
    });
    // The refspec `commitlore init` and `doctor --fix` write. Those commands
    // have their own tests; what this one is about is that a clone with the
    // mirror configured gets a complete answer rather than a caveated one.
    git(clone, [
      'config',
      '--add',
      'remote.origin.fetch',
      '+refs/notes/commitlore:refs/notes/commitlore',
    ]);
    const collected = cli(clone, ['sync', '--fetch-only']);
    expect(collected.status, collected.out).toBe(0);

    const read = cli(clone, ['limits', 'a.ts']);
    expect(read.status, read.out).toBe(0);
    expect(read.out).toContain('three retries per minute');
    expect(read.out).not.toContain('notes mirror has not been fetched');
  }, 300_000);

  it('validates in a range the way any other record does', () => {
    const dir = repo('validates');
    expect(cli(dir, ['hooks', 'install']).status).toBe(0);
    writeFileSync(join(dir, 'a.ts'), 'export const a = 6;\n');
    git(dir, ['add', '-A']);
    const committed = spawnSync('git', ['commit', '-F', '-'], {
      cwd: dir,
      input:
        'Lower the ceiling\n\nOrdinary prose.\n\n' +
        'Limit: The vendor caps us at three retries per minute on that endpoint.\n' +
        'Record-Id: r-validates0001\nProvenance: drafted\n',
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, COMMITLORE_BIN: CLI },
      shell: false,
    });
    expect(committed.status, `${committed.stdout}${committed.stderr}`).toBe(0);

    const validated = cli(dir, ['validate', '--range', 'HEAD~1..HEAD']);
    expect(validated.status, validated.out).toBe(0);
  }, 300_000);
});
