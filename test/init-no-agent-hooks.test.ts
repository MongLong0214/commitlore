/**
 * bug-issue-1181: `commitlore init --no-agent-hooks` writes nothing inside the
 * working tree, and still answers with init's own verdict.
 *
 * The `PreToolUse` injection hook at `<cwd>/.claude/settings.json` is the only
 * file `init` writes into the tree — `AGENTS.md` has been opt-in since
 * `--agents-md` — and it is untracked, so after `init` the checkout is no
 * longer clean. agent-control-plane's bootstrap runs `init` as a *required
 * observation of a clean checkout*, so it saw its own observation as a change.
 * `--mcp-scope none` never covered it, because everything else `init` wires
 * lives under `.git/`, in git config, or in the host's own configuration, none
 * of which `git status` reports.
 *
 * Two halves are pinned here and both were needed. A clean tree alone is not
 * enough: with the hook skipped, `inject-runtime` is the one doctor row that
 * needs attention, so without the verdict exclusion every `--no-agent-hooks`
 * run reports 1 and the caller has traded a dirty checkout for a failed
 * verdict.
 *
 * `HOME` is pinned to an empty directory in every case, for the reason
 * `r-dualmcpregistration` records: the step asks whether the Claude Code plugin
 * already delivers this hook, so a run with an ambient `HOME` asserts whatever
 * the developer happens to have installed. With the plugin present the hook is
 * skipped anyway and these cases would pass without the fix.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { runInit, type InitReport } from '../src/commands/init.js';
import { claudeSettingsPath } from '../src/hooks/claude-settings.js';
import { execGit } from '../src/core/git.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'commitlore.mjs');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-1181-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[]): string => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
};

const repo = (label: string): string => {
  const dir = tempDir(label);
  git(dir, ['init', '--quiet', '--template=', '--initial-branch=main', '.']);
  git(dir, ['config', 'user.name', 'CommitLore Test']);
  git(dir, ['config', 'user.email', 'test@example.invalid']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'probe.ts'), 'export const probe = true;\n');
  git(dir, ['add', '--', 'probe.ts']);
  git(dir, ['commit', '--quiet', '-m', 'probe']);
  return dir;
};

const dirty = (cwd: string): string =>
  git(cwd, ['status', '--porcelain', '--untracked-files=all']).trim();

/**
 * `init` with no plugin in `HOME`, nothing of the developer's on `PATH`, and
 * `argv[1]` pointing at the built CLI.
 *
 * `argv[1]` is how the runtime rows locate the installation they grade; left as
 * vitest's own entry, the verdict is about the test runner rather than about
 * this repository. The init suite pins all three for the same reason.
 */
const withoutPlugin = <T>(run: () => T): T => {
  const originalHome = process.env['HOME'];
  const originalPath = process.env['PATH'];
  const originalArgv = process.argv[1];
  process.env['HOME'] = tempDir('empty-home');
  process.env['PATH'] = '/usr/bin:/bin';
  process.argv[1] = CLI;
  try {
    return run();
  } finally {
    process.argv[1] = originalArgv;
    if (originalHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = originalHome;
    if (originalPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = originalPath;
  }
};

const stepOf = (report: InitReport, step: string): InitReport['steps'][number] => {
  const found = report.steps.find((entry) => entry.step === step);
  if (found === undefined) throw new Error(`no ${step} step in the report`);
  return found;
};

const HOOKS = ['commit-msg', 'prepare-commit-msg', 'post-commit', 'pre-push'];

describe('init --no-agent-hooks leaves the working tree alone (bug-issue-1181)', () => {
  it('writes nothing inside the tree, wires everything else, and still reports ready', () => {
    const cwd = repo('declined');
    expect(dirty(cwd)).toBe('');

    const report = withoutPlugin(() =>
      runInit({ cwd, mcpScope: 'none', unattended: false, agentHooks: false }),
    );

    // The reported symptom, gone.
    expect(existsSync(claudeSettingsPath(cwd))).toBe(false);
    expect(dirty(cwd)).toBe('');

    // Everything outside the tree still happened.
    for (const hook of HOOKS) expect(existsSync(join(cwd, '.git', 'hooks', hook))).toBe(true);

    // And init's own verdict is still usable, which a clean tree alone does not
    // give: `inject-runtime` is the one row that needs attention once the hook
    // is declined.
    expect(report.exitCode).toBe(0);
    const doctor = stepOf(report, 'doctor');
    expect(doctor.code).toBe(0);
    expect(doctor.lines.join('\n')).toContain('--no-agent-hooks declined it');

    // Nothing is hidden: the row is still in the report, and the step that did
    // not write says so.
    const checks = (doctor.detail as { checks: { id: string; needsAttention?: boolean }[] }).checks;
    expect(checks.find((entry) => entry.id === 'inject-runtime')?.needsAttention).toBe(true);
    expect(stepOf(report, 'claude-hook').lines.join('\n')).toContain('--no-agent-hooks was given');
  });

  it('is the reproduction without the flag: the hook lands in the tree', () => {
    const cwd = repo('control');

    const report = withoutPlugin(() => runInit({ cwd, mcpScope: 'none', unattended: false }));

    expect(existsSync(claudeSettingsPath(cwd))).toBe(true);
    expect(dirty(cwd)).toContain('.claude/settings.json');
    // The default install is unchanged, including its verdict.
    expect(report.exitCode).toBe(0);
    expect(stepOf(report, 'doctor').lines.join('\n')).not.toContain('--no-agent-hooks');
  });

  it('is reachable from the command line, which is where the caller types it', () => {
    const cwd = repo('cli');
    const home = tempDir('cli-empty-home');

    const out = execFileSync(
      process.execPath,
      [CLI, 'init', '--mcp-scope', 'none', '--no-unattended', '--no-agent-hooks'],
      { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    expect(out).toContain('init: ready');
    expect(dirty(cwd)).toBe('');
    expect(existsSync(claudeSettingsPath(cwd))).toBe(false);
  });
});
