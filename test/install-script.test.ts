/**
 * T-1120 (#281) — `install.sh` is a Node-only installer, and the README
 * describes the installer that ships beside it.
 *
 * Acceptance row `B-8`. PRD-F14 requirements 4–15 and 29.
 *
 * The script is exercised for real, not inspected: each case runs it with a
 * controlled `PATH`, a scratch `HOME`, and a local source repository, because
 * three of these requirements exist only because this project already shipped
 * the defect they forbid —
 *
 *   - req 9: the wrapper is installed by atomic rename. An in-place overwrite of
 *     a file that may be executing forced a same-day patch release.
 *   - req 10: runtime verification decides whether activation may happen. The
 *     old installer reported success after a bundle had already proved unusable.
 *   - req 11: the installer never edits a shell profile. An active ruled-out
 *     record on this file rejects it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLER = join(REPO_ROOT, 'install.sh');
const READMES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md'];
const RUNTIME_MANIFEST = join('installer', 'runtime-manifest.txt');
const RUNTIME_MANIFEST_FORMAT = 'commitlore-runtime-manifest-v1';

const scratch: string[] = [];
const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-t1120-${label}-`));
  scratch.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A local repository the installer can clone a tag from — no network. */
let sourceRepo: string;
/** A source whose bundle exits non-zero — a real broken release, not a test hook. */
let brokenRepo: string;
/** A correctly named tag whose bundle reports a different release version. */
let versionMismatchRepo: string;
const TAG = 'v9.9.9';
const OLDER_TAG = 'v9.8.8';

const git = (cwd: string, args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.invalid', ...args], {
    cwd,
    encoding: 'utf8',
  });
};

const writeRuntimeManifest = (target: string, assets: string[]): void => {
  const path = join(target, RUNTIME_MANIFEST);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${[RUNTIME_MANIFEST_FORMAT, ...assets].join('\n')}\n`);
};

/** The non-bundle files the installed CLI reads at runtime. */
const copyRuntimeAssets = (
  target: string,
  options: { manifest?: string[] | false; includeHermes?: boolean; version?: string } = {},
): void => {
  cpSync(join(REPO_ROOT, 'AGENTS.md'), join(target, 'AGENTS.md'));
  cpSync(join(REPO_ROOT, 'spec'), join(target, 'spec'), { recursive: true });
  if (options.includeHermes !== false) {
    cpSync(join(REPO_ROOT, 'hermes'), join(target, 'hermes'), { recursive: true });
  }
  writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'commitlore', version: options.version ?? '9.9.9' }));
  if (options.manifest === false) return;
  if (options.manifest !== undefined) {
    writeRuntimeManifest(target, options.manifest);
  } else {
    const destination = join(target, RUNTIME_MANIFEST);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(REPO_ROOT, RUNTIME_MANIFEST), destination);
  }
};

beforeAll(() => {
  sourceRepo = join(tempDir('source'), 'commitlore');
  mkdirSync(join(sourceRepo, 'dist'), { recursive: true });
  // The real bundle is needed for the Hermes host path below. Its version is
  // read from this fixture package.json, so the installer's ordinary wrapper
  // verification remains deterministic without a network or another worktree.
  cpSync(join(REPO_ROOT, 'dist', 'commitlore.mjs'), join(sourceRepo, 'dist', 'commitlore.mjs'));
  copyRuntimeAssets(sourceRepo, { version: '9.8.8' });
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: sourceRepo });
  git(sourceRepo, ['add', '-A']);
  git(sourceRepo, ['commit', '--quiet', '-m', 'older source']);
  git(sourceRepo, ['tag', OLDER_TAG]);
  writeFileSync(join(sourceRepo, 'package.json'), JSON.stringify({ name: 'commitlore', version: '9.9.9' }));
  git(sourceRepo, ['add', 'package.json']);
  git(sourceRepo, ['commit', '--quiet', '-m', 'requested source']);
  git(sourceRepo, ['tag', TAG]);

  brokenRepo = join(tempDir('broken'), 'commitlore');
  mkdirSync(join(brokenRepo, 'dist'), { recursive: true });
  writeFileSync(join(brokenRepo, 'dist', 'commitlore.mjs'), "process.exit(3);\n");
  copyRuntimeAssets(brokenRepo);
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: brokenRepo });
  git(brokenRepo, ['add', '-A']);
  git(brokenRepo, ['commit', '--quiet', '-m', 'broken bundle']);
  git(brokenRepo, ['tag', TAG]);

  versionMismatchRepo = join(tempDir('version-mismatch'), 'commitlore');
  mkdirSync(join(versionMismatchRepo, 'dist'), { recursive: true });
  cpSync(join(REPO_ROOT, 'dist', 'commitlore.mjs'), join(versionMismatchRepo, 'dist', 'commitlore.mjs'));
  copyRuntimeAssets(versionMismatchRepo, { version: '9.8.8' });
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: versionMismatchRepo });
  git(versionMismatchRepo, ['add', '-A']);
  git(versionMismatchRepo, ['commit', '--quiet', '-m', 'wrong runtime version']);
  git(versionMismatchRepo, ['tag', TAG]);
});

/** A PATH holding a shell and the tools the case wants, and nothing else. */
const stubPath = (opts: {
  node?: 'current' | 'old' | 'absent';
  git?: boolean;
  codex?: 'mcp-success' | 'mcp-stale-ours' | 'mcp-foreign';
  hermes?: boolean;
}): string => {
  const bin = tempDir('bin');
  if (opts.node === 'current') {
    writeFileSync(join(bin, 'node'), `#!/bin/sh\nexec ${process.execPath} "$@"\n`);
    chmodSync(join(bin, 'node'), 0o755);
  } else if (opts.node === 'old') {
    writeFileSync(join(bin, 'node'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo v20.11.0; exit 0; fi\nexit 0\n');
    chmodSync(join(bin, 'node'), 0o755);
  }
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  if (opts.git === false) {
    // A git that cannot run. Hiding /usr/bin/git is not possible without also
    // hiding the coreutils the script needs, and a broken git is the same
    // failure from the installer's point of view.
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nexit 127\n');
  } else {
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nexec ${realGit} "$@"\n`);
  }
  chmodSync(join(bin, 'git'), 0o755);
  if (opts.codex === 'mcp-stale-ours' || opts.codex === 'mcp-foreign') {
    // `mcp get` answers with an entry that already exists. For 'mcp-stale-ours'
    // it points inside the CommitLore data root, the shape an install of ours
    // leaves behind; for 'mcp-foreign' it points somewhere we never wrote.
    const pointsAt =
      opts.codex === 'mcp-stale-ours'
        ? '"$HOME"/.local/share/commitlore/v0.0.1/bin/commitlore'
        : '/opt/somebody-elses/commitlore';
    writeFileSync(
      join(bin, 'codex'),
      `#!/bin/sh
printf '%s\\n' "$*" >>"$COMMITLORE_CODEX_CALLS"
case "$1:$2" in
  mcp:get) printf 'commitlore\\n  enabled: true\\n  command: %s\\n' ${pointsAt} ;;
  mcp:remove) exit 0 ;;
  mcp:add) exit 0 ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(join(bin, 'codex'), 0o755);
  }
  if (opts.codex === 'mcp-success') {
    writeFileSync(
      join(bin, 'codex'),
      `#!/bin/sh
printf '%s\\n' "$*" >>"$COMMITLORE_CODEX_CALLS"
case "$1:$2" in
  mcp:list) printf '[]\\n' ;;
  mcp:get) exit 1 ;;
  mcp:remove) exit 0 ;;
  mcp:add) exit 0 ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(join(bin, 'codex'), 0o755);
  }
  if (opts.hermes === true) {
    writeFileSync(
      join(bin, 'hermes'),
      [
        '#!/bin/sh',
        'case "$1:$2" in',
        '  --version:) echo hermes-test ;;',
        '  skills:list) printf "commitlore-setup\\ncommitlore-query\\ncommitlore-commits\\n" ;;',
        '  mcp:test) printf "commitlore_before_change\\n" ;;',
        'esac',
      ].join('\n') + '\n',
    );
    chmodSync(join(bin, 'hermes'), 0o755);
  }
  return `${bin}:/usr/bin:/bin`;
};

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  home: string;
  wrapper: string;
  dataDir: string;
}

const runInstaller = (opts: {
  node?: 'current' | 'old' | 'absent';
  git?: boolean;
  hermes?: boolean;
  home?: string;
  extraEnv?: Record<string, string>;
  args?: string[];
  codex?: 'mcp-success';
}): RunResult => {
  const home = opts.home ?? tempDir('home');
  const run = spawnSync('/bin/sh', [INSTALLER, ...(opts.args ?? [TAG])], {
    encoding: 'utf8',
    env: {
      PATH: stubPath({ node: opts.node ?? 'current', git: opts.git, codex: opts.codex, hermes: opts.hermes }),
      HOME: home,
      COMMITLORE_INSTALL_SOURCE: sourceRepo,
      ...(opts.extraEnv ?? {}),
    },
  });
  return {
    status: run.status,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
    home,
    wrapper: join(home, '.local', 'bin', 'commitlore'),
    dataDir: join(home, '.local', 'share', 'commitlore'),
  };
};

describe('T-1120 prerequisites are checked before anything is written', () => {
  it('names Node and the required major version when node is absent, and writes nothing', () => {
    const r = runInstaller({ node: 'absent' });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/[Nn]ode/);
    expect(`${r.stdout}${r.stderr}`).toMatch(/22/);
    expect(existsSync(r.wrapper)).toBe(false);
    expect(existsSync(r.dataDir)).toBe(false);
  });

  it('names the version it found when node is older than 22', () => {
    const r = runInstaller({ node: 'old' });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/20\./);
    expect(existsSync(r.wrapper)).toBe(false);
  });

  it('names Git when git is absent', () => {
    const r = runInstaller({ git: false });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/[Gg]it/);
    expect(existsSync(r.wrapper)).toBe(false);
  });
});

describe('T-1120 a successful install produces a checkout and a thin wrapper', () => {
  it('writes the wrapper on PATH and the checkout under the data directory', () => {
    const r = runInstaller({});
    expect(r.status).toBe(0);
    expect(existsSync(r.wrapper)).toBe(true);
    const body = readFileSync(r.wrapper, 'utf8');
    // A thin wrapper: it resolves a node and execs the bundle, and does nothing
    // else. No install logic, no version check, no network.
    expect(body).toMatch(/^NODE=.*node"?$/m);
    expect(body).toMatch(/exec "\$NODE"/);
    expect(body).toContain('dist/commitlore.mjs');
    expect(body.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length).toBeLessThan(6);
    const checkouts = readdirSync(r.dataDir);
    expect(checkouts).toContain(TAG);
    expect(existsSync(join(r.dataDir, TAG, 'dist', 'commitlore.mjs'))).toBe(true);
    // And the wrapper actually runs.
    const version = spawnSync('/bin/sh', [r.wrapper, '--version'], {
      encoding: 'utf8',
      env: { PATH: stubPath({ node: 'current' }), HOME: r.home },
    });
    expect(version.stdout.trim()).toBe('9.9.9');
  });

  it('carries no asset download, checksum or target triple anywhere in the script', () => {
    const body = readFileSync(INSTALLER, 'utf8');
    for (const forbidden of ['SHA256SUMS', '.tar.gz', 'tar -xzf', 'unknown-linux-gnu', 'apple-darwin']) {
      expect(body, `install.sh must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('never edits a shell profile, and prints the PATH line instead', () => {
    const r = runInstaller({});
    for (const rc of ['.bashrc', '.zshrc', '.profile', '.bash_profile']) {
      expect(existsSync(join(r.home, rc)), `${rc} must not be created`).toBe(false);
    }
  });
});

describe('Codex MCP registration uses the owning CLI when it is available', () => {
  it('registers through codex mcp list and add, without hand-writing its config', () => {
    const home = tempDir('codex-cli-home');
    const calls = join(tempDir('codex-cli-calls'), 'calls.txt');

    const result = runInstaller({
      home,
      codex: 'mcp-success',
      extraEnv: { COMMITLORE_CODEX_CALLS: calls },
    });

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('registered commitlore with codex mcp add');
    // The ownership question is asked of the entry, not of the list: a
    // registration named `commitlore` can point anywhere, and one here
    // pointed at a wrapper in a temp directory from an install months old.
    expect(readFileSync(calls, 'utf8')).toContain('mcp get commitlore');
    expect(readFileSync(calls, 'utf8')).toContain('mcp add commitlore --');
    expect(existsSync(join(home, '.codex', 'config.toml'))).toBe(false);
  });

  it('uses the config-file fallback only when an existing Codex home has no CLI', () => {
    const home = tempDir('codex-fallback-home');
    mkdirSync(join(home, '.codex'), { recursive: true });

    const result = runInstaller({ home });
    const config = join(home, '.codex', 'config.toml');

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('config-file fallback; codex CLI is unavailable');
    expect(readFileSync(config, 'utf8')).toContain('[mcp_servers.commitlore]');
  });
});

describe('Codex registration is judged by where it points, not by its name', () => {
  // A machine here carried an `mcp_servers.commitlore` entry aimed at a wrapper
  // in a temp directory, left by an install from months earlier. The name-only
  // check called it correct and skipped, so every session got a server that was
  // not what the name said, and reinstalling never repaired it.
  it('repairs an entry left by an earlier install of ours', () => {
    const home = tempDir('codex-stale-home');
    const calls = join(tempDir('codex-stale-calls'), 'calls.txt');

    const result = runInstaller({
      home,
      codex: 'mcp-stale-ours',
      extraEnv: { COMMITLORE_CODEX_CALLS: calls },
    });

    expect(result.status).toBe(0);
    const invoked = readFileSync(calls, 'utf8');
    expect(invoked).toContain('mcp remove commitlore');
    expect(invoked).toContain('mcp add commitlore --');
    expect(`${result.stdout}${result.stderr}`).toContain('registered commitlore with codex mcp add');
  });

  it('leaves a server this install did not write alone, and says so', () => {
    const home = tempDir('codex-foreign-home');
    const calls = join(tempDir('codex-foreign-calls'), 'calls.txt');

    const result = runInstaller({
      home,
      codex: 'mcp-foreign',
      extraEnv: { COMMITLORE_CODEX_CALLS: calls },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(calls, 'utf8')).not.toContain('mcp remove');
    expect(`${result.stdout}${result.stderr}`).toContain('points somewhere this install did not write');
  });
});

describe('Hermes host setup in the shell installer', () => {
  it('backs up and extends the active profile without touching approval policy', () => {
    const home = tempDir('hermes');
    const config = join(home, '.hermes', 'config.yaml');
    const operatorConfig = [
      'approvals:',
      '  deny:',
      '    - "*git push*--force*"',
      'command_allowlist:',
      '  - shell command via -c/-lc flag',
      '',
    ].join('\n');
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, operatorConfig);

    const r = runInstaller({ home, hermes: true });

    expect(r.status).toBe(0);
    const after = readFileSync(config, 'utf8');
    expect(after).toContain(operatorConfig);
    expect(after).toContain(`command: ${JSON.stringify(r.wrapper)}`);
    expect(after).toContain(JSON.stringify(realpathSync(join(r.dataDir, TAG, 'hermes', 'skills'))));
    expect(readFileSync(`${config}.commitlore-backup`, 'utf8')).toBe(operatorConfig);
    expect(`${r.stdout}${r.stderr}`).toContain('verified: fresh Hermes process lists');
    expect(`${r.stdout}${r.stderr}`).toContain('verified: Hermes MCP probe lists CommitLore tools');

    const beforeSecond = readFileSync(config, 'utf8');
    const second = runInstaller({ home, hermes: true });
    expect(second.status).toBe(0);
    expect(readFileSync(config, 'utf8')).toBe(beforeSecond);
    expect(`${second.stdout}${second.stderr}`).toContain('Hermes already configured (unchanged).');
  });
});

describe('T-1120 upgrade and verification', () => {
  it('replaces a running wrapper by rename and exits 0', () => {
    const home = tempDir('upgrade');
    expect(runInstaller({ home }).status).toBe(0);
    const wrapper = join(home, '.local', 'bin', 'commitlore');
    // Second run over the same target: an in-place overwrite of a file that may
    // be executing is the defect req 9 forbids, so the replacement is a rename.
    // The wrapper must be whole and working afterwards, and must still point at
    // the same checkout — byte equality is not the property, because the
    // resolved node path legitimately differs between environments.
    const again = runInstaller({ home });
    expect(again.status).toBe(0);
    expect(existsSync(wrapper)).toBe(true);
    const after = readFileSync(wrapper, 'utf8');
    expect(after).toContain('# commitlore:wrapper:v1');
    expect(after).toContain(join(home, '.local', 'share', 'commitlore', TAG, 'dist', 'commitlore.mjs'));
    expect(`${again.stdout}${again.stderr}`).toMatch(/upgrading the existing commitlore wrapper/);
  });

  it('refuses a foreign file at the wrapper path instead of overwriting it', () => {
    const home = tempDir('foreign');
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    const wrapper = join(home, '.local', 'bin', 'commitlore');
    writeFileSync(wrapper, '#!/bin/sh\necho not commitlore\n');
    chmodSync(wrapper, 0o755);
    const r = runInstaller({ home });
    expect(r.status).not.toBe(0);
    expect(readFileSync(wrapper, 'utf8')).toContain('not commitlore');
    expect(`${r.stdout}${r.stderr}`).toMatch(/refus|already exists|not .*commitlore/i);
  });

  /**
   * The case above uses a file that answers `--version` with prose, which the
   * old check already refused. The dangerous shape is the one that answers like
   * a version: printing a bare semver was the entire test of ownership, so any
   * unrelated executable at this path that happened to print `1.2.3` was
   * silently replaced. The old check passes the case above with that defect
   * fully present.
   */
  /**
   * The generic agent-config step skips any file that mentions commitlore,
   * which preserves a registration somebody configured on purpose. It also
   * preserved ones that could not start: four hosts on this author's machine
   * pointed at `/tmp/fresh256…/bin/commitlore`, a temp directory from a test
   * install deleted long before, and every reinstall reported "already
   * mentions commitlore -- left unchanged" while those hosts had no server.
   *
   * The file is still never rewritten. What changed is that a target which
   * does not exist is named instead of counted as fine.
   */
  it('names a registration whose command no longer exists instead of calling it fine', () => {
    const home = tempDir('dead-agent-path');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(
      join(home, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: { commitlore: { command: '/tmp/definitely-not-here/bin/commitlore', args: ['mcp'] } },
      }),
    );

    const r = runInstaller({ home });
    const out = `${r.stdout}${r.stderr}`;

    expect(out).toMatch(/definitely-not-here/);
    expect(out).toMatch(/does not exist/);
    // Still left unchanged: reporting is the fix, not rewriting somebody's file.
    expect(JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: { commitlore: { command: '/tmp/definitely-not-here/bin/commitlore', args: ['mcp'] } },
    });
  });

  it('leaves a registration whose command exists reported as before', () => {
    const home = tempDir('live-agent-path');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(
      join(home, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { commitlore: { command: '/bin/sh', args: ['mcp'] } } }),
    );

    const out = (() => {
      const r = runInstaller({ home });
      return `${r.stdout}${r.stderr}`;
    })();

    expect(out).toMatch(/already mentions commitlore -- left unchanged/);
    expect(out).not.toMatch(/does not exist/);
  });

  it('refuses a foreign executable that merely prints a version', () => {
    const home = tempDir('foreign-semver');
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    const wrapper = join(home, '.local', 'bin', 'commitlore');
    writeFileSync(wrapper, '#!/bin/sh\necho 1.2.3\n');
    chmodSync(wrapper, 0o755);

    const r = runInstaller({ home });

    expect(r.status).not.toBe(0);
    expect(readFileSync(wrapper, 'utf8')).toContain('echo 1.2.3');
    expect(`${r.stdout}${r.stderr}`).toMatch(/no commitlore checkout under/);
  });

  it('still replaces an older install that left the checkout it claims', () => {
    // The evidence is the managed checkout, so an install this script really
    // did perform is still upgraded rather than refused.
    const home = tempDir('older-install');
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    mkdirSync(join(home, '.local', 'share', 'commitlore', 'v1.2.3'), { recursive: true });
    const wrapper = join(home, '.local', 'bin', 'commitlore');
    writeFileSync(wrapper, '#!/bin/sh\necho 1.2.3\n');
    chmodSync(wrapper, 0o755);

    const r = runInstaller({ home });

    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/replacing a previous commitlore install/);
  });

  it('fails before activation when runtime verification runs and fails', () => {
    // #541 flips the old expectation: a bundle that runs and exits 3 has
    // conclusively failed verification, so reporting a successful install would
    // promise a CLI that cannot start.
    const r = runInstaller({ extraEnv: { COMMITLORE_INSTALL_SOURCE: brokenRepo } });
    expect(r.status).toBe(3);
    expect(`${r.stdout}${r.stderr}`).toMatch(/verification ran.*unusable/i);
    expect(existsSync(r.wrapper)).toBe(false);
  });

  it('refuses a requested tag whose binary reports another version before activating a wrapper', () => {
    // Tag identity alone is insufficient: a tag can point at bytes that still
    // declare an older release. The exact --version value is what the wrapper
    // will expose to every later invocation.
    const r = runInstaller({ extraEnv: { COMMITLORE_INSTALL_SOURCE: versionMismatchRepo } });
    expect(r.status).toBe(3);
    expect(`${r.stdout}${r.stderr}`).toContain('--version reported "9.8.8", want requested version "9.9.9"');
    expect(existsSync(r.wrapper)).toBe(false);
  });

  it('refuses a clean older checkout placed at the requested release path', () => {
    // This is the upgrade failure that a directory name cannot prove away: the
    // checkout is internally clean, but its HEAD is the older tag. It must stay
    // untouched for the operator to inspect or remove deliberately.
    const home = tempDir('wrong-clean-checkout');
    const checkout = join(home, '.local', 'share', 'commitlore', TAG);
    mkdirSync(dirname(checkout), { recursive: true });
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', OLDER_TAG, sourceRepo, checkout]);
    const before = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    const r = runInstaller({ home });
    expect(r.status).toBe(3);
    expect(`${r.stdout}${r.stderr}`).toMatch(/requested tag v9\.9\.9/);
    expect(existsSync(r.wrapper)).toBe(false);
    expect(execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(before);
    expect(execFileSync('node', ['dist/commitlore.mjs', '--version'], { cwd: checkout, encoding: 'utf8' }).trim()).toBe('9.8.8');
  });

  it('accepts an older tag whose own manifest names fewer runtime assets', () => {
    // This source predates the Hermes bundle. Its manifest deliberately lists
    // only the files that tag reads, and the checkout itself carries that
    // smaller list. A newer installer must not demand newer Hermes files.
    const olderRepo = join(tempDir('older-manifest'), 'commitlore');
    const olderTag = 'v9.8.0';
    mkdirSync(join(olderRepo, 'dist'), { recursive: true });
    cpSync(join(REPO_ROOT, 'dist', 'commitlore.mjs'), join(olderRepo, 'dist', 'commitlore.mjs'));
    copyRuntimeAssets(olderRepo, {
      includeHermes: false,
      manifest: ['AGENTS.md', 'dist/commitlore.mjs', 'package.json', 'spec/SPEC.md', 'spec/schema/record.schema.json'],
      version: '9.8.0',
    });
    execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: olderRepo });
    git(olderRepo, ['add', '-A']);
    git(olderRepo, ['commit', '--quiet', '-m', 'older runtime manifest']);
    git(olderRepo, ['tag', olderTag]);

    const r = runInstaller({ args: [olderTag], extraEnv: { COMMITLORE_INSTALL_SOURCE: olderRepo } });
    expect(r.status).toBe(0);
    expect(existsSync(join(r.dataDir, olderTag, 'hermes'))).toBe(false);
    expect(existsSync(r.wrapper)).toBe(true);
  });

  it('uses legacy bootstrap checks when the pinned tree predates the manifest', () => {
    // No manifest in the pinned Git tree means an older release, not a reason
    // to trust it silently. The installer checks the bundle it can name itself
    // and runs its only cross-version smoke check: --version. This fixture has
    // no current doctor/validate interface, as a genuinely old CLI may not.
    const legacyRepo = join(tempDir('legacy-manifest'), 'commitlore');
    const legacyTag = 'v9.7.0';
    mkdirSync(join(legacyRepo, 'dist'), { recursive: true });
    writeFileSync(
      join(legacyRepo, 'dist', 'commitlore.mjs'),
      "if (process.argv[2] === '--version') process.stdout.write('9.7.0\\n'); else process.exit(1);\n",
    );
    copyRuntimeAssets(legacyRepo, { manifest: false, version: '9.7.0' });
    execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: legacyRepo });
    git(legacyRepo, ['add', '-A']);
    git(legacyRepo, ['commit', '--quiet', '-m', 'release before runtime manifest']);
    git(legacyRepo, ['tag', legacyTag]);

    const r = runInstaller({ args: [legacyTag], extraEnv: { COMMITLORE_INSTALL_SOURCE: legacyRepo } });
    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('predates installer/runtime-manifest.txt');
    expect(existsSync(r.wrapper)).toBe(true);
  });

  it('refuses a manifest missing from a checkout whose pinned tree records it', () => {
    // This is the damaged-checkout side of the missing-manifest rule. Unlike a
    // legacy tag, HEAD names the manifest, so its disappearance is corruption.
    const home = tempDir('missing-manifest');
    const first = runInstaller({ home });
    expect(first.status).toBe(0);
    const wrapperBefore = readFileSync(first.wrapper, 'utf8');
    const manifest = join(first.dataDir, TAG, RUNTIME_MANIFEST);
    rmSync(manifest);

    const rerun = runInstaller({ home });
    expect(rerun.status).toBe(3);
    expect(`${rerun.stdout}${rerun.stderr}`).toContain(manifest);
    expect(readFileSync(first.wrapper, 'utf8')).toBe(wrapperBefore);
  });

  it('refuses a checkout that ships an empty manifest instead of trusting less', () => {
    // The manifest is checkout-owned, but it cannot opt out of verification by
    // committing only its format header. This exercises the parser after the
    // manifest has already matched the pinned tree, not merely Git's dirty-tree
    // detection for a locally edited file.
    const emptyManifestRepo = join(tempDir('empty-manifest-source'), 'commitlore');
    mkdirSync(join(emptyManifestRepo, 'dist'), { recursive: true });
    cpSync(join(REPO_ROOT, 'dist', 'commitlore.mjs'), join(emptyManifestRepo, 'dist', 'commitlore.mjs'));
    copyRuntimeAssets(emptyManifestRepo, { manifest: [] });
    execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: emptyManifestRepo });
    git(emptyManifestRepo, ['add', '-A']);
    git(emptyManifestRepo, ['commit', '--quiet', '-m', 'empty runtime manifest']);
    git(emptyManifestRepo, ['tag', TAG]);

    const r = runInstaller({ extraEnv: { COMMITLORE_INSTALL_SOURCE: emptyManifestRepo } });
    expect(r.status).toBe(3);
    expect(`${r.stdout}${r.stderr}`).toContain('the runtime manifest must name at least one runtime asset');
    expect(existsSync(r.wrapper)).toBe(false);
  });

  it('refuses a locally emptied manifest instead of letting it weaken verification', () => {
    const home = tempDir('empty-manifest');
    const first = runInstaller({ home });
    expect(first.status).toBe(0);
    const wrapperBefore = readFileSync(first.wrapper, 'utf8');
    const manifest = join(first.dataDir, TAG, RUNTIME_MANIFEST);
    writeFileSync(manifest, '');

    const rerun = runInstaller({ home });
    expect(rerun.status).toBe(3);
    expect(`${rerun.stdout}${rerun.stderr}`).toContain(manifest);
    expect(readFileSync(first.wrapper, 'utf8')).toBe(wrapperBefore);
  });

  for (const damage of ['deleted', 'replaced with a directory'] as const) {
    it(`refuses a ${damage} installed bundle without changing the previous wrapper`, () => {
      const home = tempDir(`damaged-${damage.replace(/\W+/g, '-')}`);
      const first = runInstaller({ home });
      expect(first.status).toBe(0);
      const wrapperBefore = readFileSync(first.wrapper, 'utf8');
      const bundle = join(first.dataDir, TAG, 'dist', 'commitlore.mjs');

      if (damage === 'deleted') {
        rmSync(bundle);
      } else {
        rmSync(bundle);
        mkdirSync(bundle);
      }

      const rerun = runInstaller({ home });
      expect(rerun.status).toBe(3);
      expect(`${rerun.stdout}${rerun.stderr}`).toContain(bundle);
      expect(readFileSync(first.wrapper, 'utf8')).toBe(wrapperBefore);
      if (damage === 'deleted') {
        expect(existsSync(bundle)).toBe(false);
      } else {
        expect(statSync(bundle).isDirectory()).toBe(true);
      }
    });
  }

  it('gives a damaged checkout a repair command that returns it to an installable state', () => {
    const home = tempDir('damaged-repair');
    const first = runInstaller({ home });
    expect(first.status).toBe(0);
    const bundle = join(first.dataDir, TAG, 'dist', 'commitlore.mjs');
    rmSync(bundle);

    const refused = runInstaller({ home });
    expect(refused.status).toBe(3);
    const repair = `${refused.stdout}${refused.stderr}`.match(/^  (rm -rf .+)$/m)?.[1];
    expect(repair).toBeDefined();

    // Execute the exact command the refusal printed, then rerun the original
    // installation. The installer never removes an unverified checkout itself.
    const repairedPath = spawnSync('/bin/sh', ['-c', repair!], { encoding: 'utf8' });
    expect(repairedPath.status).toBe(0);
    expect(existsSync(join(first.dataDir, TAG))).toBe(false);

    const repaired = runInstaller({ home });
    expect(repaired.status).toBe(0);
    const version = spawnSync('/bin/sh', [repaired.wrapper, '--version'], {
      encoding: 'utf8',
      env: { PATH: stubPath({ node: 'current' }), HOME: home },
    });
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe('9.9.9');
  });
});

describe('#298 tag auto-resolution needs no sort extension', () => {
  /**
   * `sort -V` is not POSIX, and this file is POSIX `sh`. Where it is absent the
   * major field compares lexically, which puts v9 above v10 — the installer
   * would log success while installing an older release. Today's tags are all
   * v0.x so both orderings agree, which is exactly why this needs a test rather
   * than a reading.
   */
  it('no grep invocation uses a non-POSIX option (#305)', () => {
    // POSIX grep defines exactly these options. Anything else -- `-m` being the
    // one that got in -- is an extension, and this file is declared POSIX sh.
    // Generalised from the sort -V check because the same commit that removed
    // that flag introduced grep -m1: a one-off assertion catches one instance,
    // an invariant catches the next.
    const POSIX_GREP = new Set(['E', 'F', 'c', 'e', 'f', 'i', 'l', 'n', 'q', 's', 'v', 'x']);
    const offenders: string[] = [];
    const code = readFileSync(INSTALLER, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'));
    for (const line of code) {
      for (const match of line.matchAll(/\bgrep\s+(-[a-zA-Z0-9]+)/g)) {
        const flags = match[1]!.slice(1).replace(/[0-9]+$/, '');
        for (const flag of flags) {
          if (!POSIX_GREP.has(flag)) offenders.push(`${match[1]} in: ${line.trim().slice(0, 80)}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the script resolves versions without depending on sort -V', () => {
    // Invocations, not prose: the comment beside the fix names the flag on
    // purpose, and a test that forbade the word would delete the explanation.
    const code = readFileSync(INSTALLER, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'));
    for (const line of code) {
      expect(line, `no sort invocation may use -V: ${line}`).not.toMatch(/\bsort\b[^|]*-V/);
      expect(line).not.toMatch(/-k1,1V/);
    }
  });

  it('resolves the newest tag when a double-digit major exists', () => {
    const repo = join(tempDir('majors'), 'commitlore');
    mkdirSync(join(repo, 'dist'), { recursive: true });
    // Version resolution needs a real release-shaped checkout: the transaction
    // now validates every runtime asset and runs its smoke commands before it
    // activates the wrapper, so a one-line version stub is not an installable
    // source repository.
    cpSync(join(REPO_ROOT, 'dist', 'commitlore.mjs'), join(repo, 'dist', 'commitlore.mjs'));
    copyRuntimeAssets(repo);
    execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: repo });
    git(repo, ['add', '-A']);
    git(repo, ['commit', '--quiet', '-m', 'src']);
    for (const tag of ['v1.0.0', 'v2.5.0', 'v9.9.9']) git(repo, ['tag', tag]);
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'commitlore', version: '10.0.0' }));
    git(repo, ['add', 'package.json']);
    git(repo, ['commit', '--quiet', '-m', 'newest source']);
    git(repo, ['tag', 'v10.0.0']);

    const home = tempDir('majors-home');
    const run = spawnSync('/bin/sh', [INSTALLER], {
      encoding: 'utf8',
      env: {
        PATH: stubPath({ node: 'current' }),
        HOME: home,
        COMMITLORE_INSTALL_SOURCE: repo,
      },
    });
    expect(run.status).toBe(0);
    // The newest is v10.0.0, not v9.9.9.
    expect(`${run.stdout}${run.stderr}`).toContain('installing v10.0.0');
    expect(readdirSync(join(home, '.local', 'share', 'commitlore'))).toContain('v10.0.0');
  });
});

describe('T-1120 the README describes the installer that ships beside it (req 29)', () => {
  const bodies = (): Record<string, string> =>
    Object.fromEntries(READMES.map((f) => [f, readFileSync(join(REPO_ROOT, f), 'utf8')]));

  it('no README shell-install region mentions an asset, a checksum list or a target triple', () => {
    for (const [file, body] of Object.entries(bodies())) {
      for (const forbidden of ['SHA256SUMS', '.tar.gz', 'aarch64-apple-darwin', 'releases/download']) {
        expect(body, `${file} must not mention ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('every README states the Node and Git prerequisites for the script path', () => {
    for (const [file, body] of Object.entries(bodies())) {
      expect(body, `${file} must state the Node floor`).toMatch(/Node\.js 22\+|Node 22\+|Node\.js 22/);
      expect(body, `${file} must name Git`).toMatch(/Git/);
    }
  });

  it('the plugin-first block above it is unchanged, in all four files', () => {
    for (const [file, body] of Object.entries(bodies())) {
      expect(body, `${file} must still lead with the plugin commands`).toContain(
        '/plugin marketplace add MongLong0214/commitlore',
      );
      expect(body).toContain('/plugin install commitlore@commitlore');
    }
  });

  it('all four change together — the set is asserted, not one file', () => {
    const b = bodies();
    expect(Object.keys(b)).toHaveLength(4);
    // A forbidden mention: no README may describe a checksum file, because no

    // release publishes one (ADR-0026).

    const forbidden = Object.entries(b).filter(([, body]) => body.includes('SHA256SUMS'));

    expect(forbidden.map(([f]) => f)).toEqual([]);
  });
});
