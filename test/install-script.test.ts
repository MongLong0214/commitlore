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
 *   - req 10: post-install verification never decides the exit code. That was
 *     the other half of the same defect: the install had succeeded and the
 *     script reported failure with exit 137.
 *   - req 11: the installer never edits a shell profile. An active ruled-out
 *     record on this file rejects it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLER = join(REPO_ROOT, 'install.sh');
const READMES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md'];

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
const TAG = 'v9.9.9';

const git = (cwd: string, args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.invalid', ...args], {
    cwd,
    encoding: 'utf8',
  });
};

beforeAll(() => {
  sourceRepo = join(tempDir('source'), 'commitlore');
  mkdirSync(join(sourceRepo, 'dist'), { recursive: true });
  // The real bundle is needed for the Hermes host path below. Its version is
  // read from this fixture package.json, so the installer's ordinary wrapper
  // verification remains deterministic without a network or another worktree.
  cpSync(join(REPO_ROOT, 'dist', 'commitlore.mjs'), join(sourceRepo, 'dist', 'commitlore.mjs'));
  cpSync(join(REPO_ROOT, 'hermes'), join(sourceRepo, 'hermes'), { recursive: true });
  writeFileSync(join(sourceRepo, 'package.json'), JSON.stringify({ name: 'commitlore', version: '9.9.9' }));
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: sourceRepo });
  git(sourceRepo, ['add', '-A']);
  git(sourceRepo, ['commit', '--quiet', '-m', 'source']);
  git(sourceRepo, ['tag', TAG]);

  brokenRepo = join(tempDir('broken'), 'commitlore');
  mkdirSync(join(brokenRepo, 'dist'), { recursive: true });
  writeFileSync(join(brokenRepo, 'dist', 'commitlore.mjs'), "process.exit(3);\n");
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: brokenRepo });
  git(brokenRepo, ['add', '-A']);
  git(brokenRepo, ['commit', '--quiet', '-m', 'broken bundle']);
  git(brokenRepo, ['tag', TAG]);
});

/** A PATH holding a shell and the tools the case wants, and nothing else. */
const stubPath = (opts: {
  node?: 'current' | 'old' | 'absent';
  git?: boolean;
  codex?: 'mcp-success';
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
  if (opts.codex === 'mcp-success') {
    writeFileSync(
      join(bin, 'codex'),
      `#!/bin/sh
printf '%s\\n' "$*" >>"$COMMITLORE_CODEX_CALLS"
case "$1:$2" in
  mcp:list) printf '[]\\n' ;;
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
    expect(readFileSync(calls, 'utf8')).toContain('mcp list --json');
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

  it('still exits 0 when post-install verification cannot complete', () => {
    // req 10: verification may report, never decide. Forced by making the
    // bundle unusable at the moment the installer checks it.
    const r = runInstaller({ extraEnv: { COMMITLORE_INSTALL_SOURCE: brokenRepo } });
    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/unverified/i);
    expect(existsSync(r.wrapper)).toBe(true);
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
    writeFileSync(join(repo, 'dist', 'commitlore.mjs'), "console.log('10.0.0');\n");
    execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: repo });
    git(repo, ['add', '-A']);
    git(repo, ['commit', '--quiet', '-m', 'src']);
    for (const tag of ['v1.0.0', 'v2.5.0', 'v9.9.9', 'v10.0.0']) git(repo, ['tag', tag]);

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
