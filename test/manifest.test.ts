/**
 * Issue #51: the plugin manifest had no test. Nothing verified that
 * `.claude-plugin/plugin.json` parses, that its version matches
 * `package.json`, that a clean checkout carries every file the manifest and
 * the conventional locations need, or that the command `hooks/hooks.json`
 * declares actually resolves and produces output.
 *
 * "A clean checkout" is load-bearing: the working tree can hold a file that
 * is staged, gitignored, or otherwise never committed, and every check that
 * reads the working tree would pass anyway — then fail the moment someone
 * actually installs the plugin by cloning it (ADR-0011). So every check
 * below reads a throwaway `git clone` of HEAD, never the working tree.
 *
 * `plugin.json` used to redeclare `"hooks": "./hooks/hooks.json"` and
 * `"mcpServers": "./.mcp.json"` at exactly their auto-discovered
 * conventional paths. Reading Claude Code's own plugin loader
 * (src/utils/plugins/pluginLoader.ts, src/utils/plugins/schemas.ts) settled
 * what that actually does:
 *
 *   - `hooks/hooks.json` and `.mcp.json` at the plugin root are loaded
 *     unconditionally, whether or not the manifest declares them.
 *   - `manifest.hooks`/`manifest.mcpServers` exist to reference *additional*
 *     files (the schema's own field description says "in addition to those
 *     in hooks/hooks.json, if it exists" / "in addition to those in the
 *     .mcp.json file, if it exists").
 *   - Re-declaring the same path does not make the PreToolUse hook fire
 *     twice: the loader resolves the manifest path with `realpath`, sees it
 *     already loaded, and skips merging it. But under the loader's default
 *     `strict` mode it still records a `hook-load-failed` PluginError —
 *     "Duplicate hooks file detected ... manifest.hooks should only
 *     reference additional hook files" — which is user-visible (rendered by
 *     `PluginErrors.tsx`). The `mcpServers` case has no such guard, but is
 *     naturally harmless: servers merge by name into an object, so loading
 *     the same file twice just reassigns the same key to the same value.
 *
 * So the hypothesis that motivated this file ("declaring the conventional
 * path fires the hook twice") was wrong, but the redeclaration was still a
 * defect — a spurious, always-on plugin load error with no functional
 * benefit — and both keys were removed. The regression test below encodes
 * that finding directly, independent of anyone re-reading the loader.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { createTestRepo } from './git-fixtures.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const scratch: string[] = [];
const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-manifest-${label}-`));
  scratch.push(dir);
  return dir;
};

/** A throwaway clone of HEAD — what a real install actually gets, ADR-0011. */
let cloneDir: string;

beforeAll(() => {
  cloneDir = join(tempDir('clone'), 'commitlore');
  createTestRepo({ path: cloneDir, source: REPO_ROOT, depth: 1 });
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const clonePath = (...segments: string[]): string => join(cloneDir, ...segments);

interface PluginManifest {
  version?: unknown;
  hooks?: unknown;
  mcpServers?: unknown;
}

interface MarketplaceManifest {
  plugins?: { name?: unknown; source?: unknown }[];
}

describe('plugin manifest: every declared file parses in a clean clone', () => {
  it.each([
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.mcp.json',
    'hooks/hooks.json',
    'package.json',
  ])('%s is valid JSON', (relPath) => {
    expect(existsSync(clonePath(relPath)), `${relPath} is missing from a clean clone`).toBe(true);
    expect(() => readJson(clonePath(relPath))).not.toThrow();
  });
});

describe('plugin manifest: version matches package.json', () => {
  it('plugin.json declares the same version as package.json', () => {
    const manifest = readJson(clonePath('.claude-plugin/plugin.json')) as PluginManifest;
    const pkg = readJson(clonePath('package.json')) as { version?: unknown };
    expect(manifest.version).toBe(pkg.version);
  });
});

describe('plugin manifest: does not redeclare the auto-discovered hooks/mcpServers path', () => {
  // The regression this file exists to prevent (see the file header): a
  // manifest.hooks or manifest.mcpServers that resolves to the exact file
  // Claude Code already auto-loads produces a `hook-load-failed` PluginError
  // (hooks) or a pointless self-merge (mcpServers). Additional hook/server
  // files are still a legitimate reason for these keys to exist — this only
  // forbids pointing them at the conventional path itself.
  it('manifest.hooks, if present, does not resolve to hooks/hooks.json', () => {
    const manifest = readJson(clonePath('.claude-plugin/plugin.json')) as PluginManifest;
    if (typeof manifest.hooks !== 'string') return;
    expect(resolve(cloneDir, manifest.hooks)).not.toBe(clonePath('hooks/hooks.json'));
  });

  it('manifest.mcpServers, if present, does not resolve to .mcp.json', () => {
    const manifest = readJson(clonePath('.claude-plugin/plugin.json')) as PluginManifest;
    if (typeof manifest.mcpServers !== 'string') return;
    expect(resolve(cloneDir, manifest.mcpServers)).not.toBe(clonePath('.mcp.json'));
  });
});

describe('plugin manifest: declared and conventional paths exist in a clean clone', () => {
  it('every marketplace plugin entry source resolves to an existing directory', () => {
    const marketplace = readJson(
      clonePath('.claude-plugin/marketplace.json'),
    ) as MarketplaceManifest;
    const entries = marketplace.plugins ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(typeof entry.source).toBe('string');
      const source = entry.source as string;
      expect(existsSync(resolve(cloneDir, source)), `${entry.name as string}: ${source}`).toBe(
        true,
      );
    }
  });

  // Auto-discovered regardless of what plugin.json declares (see file
  // header) — these are the files Claude Code actually reads at install
  // time, and the ones a `.gitignore` entry or an uncommitted file would
  // silently remove from a real clone while staying invisible in the
  // working tree.
  it.each([
    'hooks/hooks.json',
    '.mcp.json',
    'dist/commitlore.mjs',
    'scripts/commitlore-run.sh',
  ])('%s is committed and present in a clean clone', (relPath) => {
    expect(existsSync(clonePath(relPath))).toBe(true);
  });
});

describe('plugin manifest: entry points are runnable from a clean clone', () => {
  it('dist/commitlore.mjs --version runs and reports the manifest version', () => {
    const manifest = readJson(clonePath('.claude-plugin/plugin.json')) as PluginManifest;
    const run = spawnSync(process.execPath, [clonePath('dist/commitlore.mjs'), '--version'], {
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(manifest.version);
  });

  it('scripts/commitlore-run.sh resolves the plugin entry point via CLAUDE_PLUGIN_ROOT', () => {
    const manifest = readJson(clonePath('.claude-plugin/plugin.json')) as PluginManifest;
    const run = spawnSync('/bin/bash', [clonePath('scripts/commitlore-run.sh'), '--version'], {
      encoding: 'utf8',
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: process.env['HOME'] ?? '',
        CLAUDE_PLUGIN_ROOT: cloneDir,
      },
    });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(manifest.version);
  });
});

/**
 * hooks/hooks.json's whole content is one PreToolUse command:
 *   "${CLAUDE_PLUGIN_ROOT}"/scripts/commitlore-run.sh inject --hook-input
 *
 * This runs that exact command, from the exact files a clean clone ships,
 * against a valid payload — the shape of `checkInjectRuntime` in
 * src/commands/doctor.ts (an execution, not a config read, because a
 * resolution branch ending in a bare `node` reads as healthy right up until
 * git actually invokes it). doctor.ts probes the hook that is or isn't wired
 * into *this* repository; this probes the command the manifest ships,
 * against a disposable fixture repo, independent of any local install.
 */
describe("plugin manifest: hooks/hooks.json's command resolves and produces output", () => {
  const hooksConfig = () =>
    JSON.parse(readFileSync(clonePath('hooks/hooks.json'), 'utf8')) as {
      hooks: { PreToolUse: { matcher: string; hooks: { type: string; command: string }[] }[] };
    };

  it('declares one PreToolUse command using CLAUDE_PLUGIN_ROOT', () => {
    const config = hooksConfig();
    const commands = config.hooks.PreToolUse.flatMap((entry) =>
      entry.hooks.map((hook) => hook.command),
    );
    expect(commands).toEqual([
      '"${CLAUDE_PLUGIN_ROOT}"/scripts/commitlore-run.sh inject --hook-input',
    ]);
  });

  it('running that command against a valid payload injects context', () => {
    const repo = tempDir('probe-repo');
    createTestRepo({ path: repo });
    writeFileSync(join(repo, 'probe.ts'), 'export const probe = true;\n');
    const add = execGit(['add', 'probe.ts'], { cwd: repo });
    if (add.code !== 0) throw new Error(`git add failed: ${add.stderr}`);
    const commit = execGit(
      [
        'commit',
        '--quiet',
        '-m',
        'Add manifest injection probe\n\nLimit: manifest injection probe\nRecord-Id: r-manifestprobe',
      ],
      { cwd: repo },
    );
    if (commit.code !== 0) throw new Error(`git commit failed: ${commit.stderr}`);

    const payload = JSON.stringify({
      session_id: 'commitlore-manifest-test',
      cwd: repo,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: resolve(repo, 'probe.ts') },
    });

    const run = spawnSync('/bin/bash', [clonePath('scripts/commitlore-run.sh'), 'inject', '--hook-input'], {
      encoding: 'utf8',
      cwd: repo,
      input: payload,
      // No node beyond process.execPath's own directory, and no PATH entry
      // that could supply one besides it — this is the environment git
      // actually hands a hook (doctor.ts's checkHookRuntime rationale).
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: process.env['HOME'] ?? '',
        CLAUDE_PLUGIN_ROOT: cloneDir,
      },
    });

    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('r-manifestprobe');
  });

  // The runner's own first rule: fail open, always. A PreToolUse hook that
  // exits non-zero can stop the edit, and the worst acceptable outcome is that
  // the agent proceeds without records — exactly where it was before the plugin
  // existed. Its third rule is no stdout on failure, because stdout garbage
  // would corrupt the payload the agent reads.
  //
  // `test/inject.test.ts` covers the CLI's own fail-open branches (unparseable
  // payload, missing file_path, path outside the repository). The branch below
  // is the runner script's: it could not find a CLI to exec at all. That one had
  // no test, and it is the one whose regression would block edits rather than
  // merely lose context.
  it('exits 0 with no stdout when it cannot resolve a CLI at all', () => {
    const unresolvable = tempDir('no-cli');
    const payload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(unresolvable, 'anything.ts') },
    });

    const run = spawnSync('/bin/bash', [clonePath('scripts/commitlore-run.sh'), 'inject', '--hook-input'], {
      encoding: 'utf8',
      cwd: unresolvable,
      input: payload,
      // A PATH with a shell but deliberately no node, and a plugin root holding
      // neither the bundle nor a binary: every branch of resolve() must miss.
      env: {
        PATH: '/usr/bin:/bin',
        HOME: process.env['HOME'] ?? '',
        CLAUDE_PLUGIN_ROOT: unresolvable,
      },
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('no context was injected');
  });
});
