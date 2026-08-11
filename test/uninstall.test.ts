/**
 * T-1123 (#272): `commitlore uninstall` removes what `install.sh` and
 * `install.ps1` wrote — a wrapper, a pinned checkout, and one MCP entry per
 * agent config — and nothing else.
 *
 * "Nothing else" is the whole ticket. Every assertion here is about restraint:
 * an unrelated server keeps its entry, an unrelated key keeps its bytes, a
 * wrapper this installer did not write is reported rather than deleted, a config
 * that cannot be parsed is left alone, and per-repository state belongs to
 * `hooks uninstall` rather than to this command.
 *
 * Separate from `test/agent-configs.test.ts`, which asserts the table of paths
 * and shapes against the installers. This file asserts what the command does
 * with that table, and the two fail for different reasons.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runUninstall } from '../src/commands/uninstall.js';

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const WRAPPER_MARKER = '# commitlore:wrapper:v1';

interface Home {
  readonly home: string;
  readonly wrapper: string;
  readonly checkout: string;
  path(...segments: string[]): string;
}

const write = (path: string, contents: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
};

/** A home directory shaped the way the shipped installer leaves one. */
const makeHome = (options: { wrapperContents?: string } = {}): Home => {
  const home = mkdtempSync(join(tmpdir(), 'commitlore-uninstall-'));
  scratch.push(home);
  const wrapper = join(home, '.local', 'bin', 'commitlore');
  const checkout = join(home, '.local', 'share', 'commitlore', 'v9.9.9');
  write(
    wrapper,
    options.wrapperContents ?? `#!/bin/sh\n${WRAPPER_MARKER}\nexec node "${checkout}/dist/commitlore.mjs" "$@"\n`,
  );
  write(join(checkout, 'dist', 'commitlore.mjs'), 'export {};\n');
  write(join(checkout, 'package.json'), '{"name":"commitlore"}\n');
  return { home, wrapper, checkout, path: (...s) => join(home, ...s) };
};

/** A cursor config carrying our entry beside somebody else's. */
const cursorConfig = (wrapper: string): string =>
  `${JSON.stringify(
    {
      mcpServers: {
        commitlore: { command: wrapper, args: ['mcp'] },
        'other-server': { command: '/usr/local/bin/other', args: ['serve'] },
      },
      'unrelated-top-level': { keep: 'me' },
    },
    null,
    2,
  )}\n`;

describe('T-1123 uninstall removes what the installer wrote', () => {
  it('removes the wrapper, the checkout and our entry', async () => {
    const h = makeHome();
    write(h.path('.cursor', 'mcp.json'), cursorConfig(h.wrapper));

    const result = await runUninstall({ home: h.home });

    expect(result.exitCode).toBe(0);
    expect(existsSync(h.wrapper), 'the wrapper survived').toBe(false);
    expect(existsSync(h.checkout), 'the checkout survived').toBe(false);
    const after = JSON.parse(readFileSync(h.path('.cursor', 'mcp.json'), 'utf8'));
    expect(after.mcpServers.commitlore).toBeUndefined();
  });

  it('leaves every other entry and key byte-for-byte', () => {
    const h = makeHome();
    const path = h.path('.cursor', 'mcp.json');
    write(path, cursorConfig(h.wrapper));

    return runUninstall({ home: h.home }).then(() => {
      const after = JSON.parse(readFileSync(path, 'utf8'));
      // The other server keeps its exact contents, not an equivalent rewrite.
      expect(after.mcpServers['other-server']).toEqual({
        command: '/usr/local/bin/other',
        args: ['serve'],
      });
      expect(after['unrelated-top-level']).toEqual({ keep: 'me' });
    });
  });

  it('refuses a wrapper it did not write, and says why', async () => {
    const h = makeHome({ wrapperContents: '#!/bin/sh\necho somebody elses program\n' });

    const result = await runUninstall({ home: h.home });

    expect(existsSync(h.wrapper), 'a foreign wrapper was deleted').toBe(true);
    const report = result.report.join('\n');
    expect(report).toMatch(/not written by|foreign|marker/i);
    expect(report).toContain(h.wrapper);
  });

  it('leaves an entry that carries our name but another program', async () => {
    const h = makeHome();
    const path = h.path('.cursor', 'mcp.json');
    write(
      path,
      `${JSON.stringify({ mcpServers: { commitlore: { command: '/opt/theirs', args: ['mcp'] } } }, null, 2)}\n`,
    );

    await runUninstall({ home: h.home });

    const after = JSON.parse(readFileSync(path, 'utf8'));
    expect(after.mcpServers.commitlore, 'an entry we did not write was removed').toEqual({
      command: '/opt/theirs',
      args: ['mcp'],
    });
  });

  it('leaves an unparseable config untouched and reports it', async () => {
    const h = makeHome();
    const path = h.path('.cursor', 'mcp.json');
    const broken = '{ this is not json\n';
    write(path, broken);

    const result = await runUninstall({ home: h.home });

    expect(readFileSync(path, 'utf8'), 'a config we could not parse was rewritten').toBe(broken);
    expect(result.report.join('\n')).toMatch(/could not|parse/i);
    expect(result.exitCode).toBe(0);
  });
});

describe('Codex MCP removal uses the owning CLI when it is available', () => {
  it('checks the registered server shape, then removes it through codex mcp remove', async () => {
    const h = makeHome();
    const config = h.path('.codex', 'config.toml');
    const calls = h.path('codex-calls.txt');
    const codex = h.path('bin', 'codex');
    write(config, `[mcp_servers.commitlore]\ncommand = "${h.wrapper}"\nargs = ["mcp"]\n`);
    write(
      codex,
      `#!/bin/sh
printf '%s\\n' "$*" >>"${calls}"
case "$1:$2" in
  mcp:list) printf '[{"name":"commitlore","transport":{"type":"stdio","command":"${h.wrapper}","args":["mcp"]}}]\\n' ;;
  mcp:remove) rm -f "${config}" ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(codex, 0o755);

    const result = await runUninstall({ home: h.home, codexCommand: codex });

    expect(existsSync(config)).toBe(false);
    expect(readFileSync(calls, 'utf8')).toContain('mcp list --json');
    expect(readFileSync(calls, 'utf8')).toContain('mcp remove commitlore');
    expect(result.report.join('\n')).toContain('through codex mcp remove');
  });
});

describe('T-1123 uninstall is safe to repeat and safe to rehearse', () => {
  it('--dry-run changes nothing', async () => {
    const h = makeHome();
    const path = h.path('.cursor', 'mcp.json');
    const before = cursorConfig(h.wrapper);
    write(path, before);

    const result = await runUninstall({ home: h.home, dryRun: true });

    expect(existsSync(h.wrapper)).toBe(true);
    expect(existsSync(h.checkout)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(result.exitCode).toBe(0);
    expect(result.report.join('\n')).toMatch(/would/i);
  });

  it('a second run removes nothing and still exits 0', async () => {
    const h = makeHome();
    write(h.path('.cursor', 'mcp.json'), cursorConfig(h.wrapper));

    await runUninstall({ home: h.home });
    const second = await runUninstall({ home: h.home });

    expect(second.exitCode).toBe(0);
    expect(second.removed, 'the second run claimed to remove something').toEqual([]);
  });
});

describe('T-1123 the report says what it did and leaks nothing else', () => {
  it('names no other entry anywhere in the report or the json', async () => {
    const h = makeHome();
    write(h.path('.cursor', 'mcp.json'), cursorConfig(h.wrapper));

    const result = await runUninstall({ home: h.home });
    const surface = `${result.report.join('\n')}\n${JSON.stringify(result.json)}`;

    expect(surface, "another server's name reached the output").not.toContain('other-server');
    expect(surface).not.toContain('/usr/local/bin/other');
    expect(surface).not.toContain('unrelated-top-level');
  });

  it('points at the per-repository commands instead of doing their work', async () => {
    const h = makeHome();
    const report = (await runUninstall({ home: h.home })).report.join('\n');
    expect(report).toContain('hooks uninstall');
    expect(report).toContain('inject uninstall-claude-hook');
  });

  it('names the plugin path rather than reaching into it', async () => {
    const h = makeHome();
    // A plugin cache is a full copy of the repository keyed by version, written
    // by Claude Code. Removing thousands of files this command did not write
    // would be doing another tool's job badly.
    const cache = h.path('.claude', 'plugins', 'cache', 'commitlore', 'file.txt');
    write(cache, 'not ours\n');

    const result = await runUninstall({ home: h.home });

    expect(existsSync(cache), 'the plugin cache was deleted').toBe(true);
    expect(result.report.join('\n')).toMatch(/plugin/i);
  });
});

describe('T-1123 uninstall honours where the installer actually put things', () => {
  it('follows XDG_DATA_HOME for the checkout', async () => {
    const h = makeHome();
    const xdg = mkdtempSync(join(tmpdir(), 'commitlore-xdg-'));
    scratch.push(xdg);
    const checkout = join(xdg, 'commitlore', 'v9.9.9');
    write(join(checkout, 'dist', 'commitlore.mjs'), 'export {};\n');
    rmSync(h.checkout, { recursive: true, force: true });

    await runUninstall({ home: h.home, dataHome: xdg });

    expect(existsSync(checkout), 'the XDG checkout survived').toBe(false);
  });
});
