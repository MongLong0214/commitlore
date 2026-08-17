/**
 * T-1123 (#272): `src/core/agent-configs.ts` is the single place that knows
 * where each agent's MCP config lives and the Codex plugin state the installers
 * write. `commitlore uninstall` reads it to decide what it is allowed to remove.
 *
 * The assertions are **bidirectional** on purpose. Two sources of the same truth
 * diverge silently: the table can grow an agent no installer wires, and an
 * installer can grow an agent the table never learns about, and in both
 * directions nothing fails — the uninstall simply leaves something behind or
 * reaches for something that was never written. So every row must be found in
 * both installers, and every config path either installer writes must be in the
 * table.
 *
 * The installers are read as text rather than executed. They are `sh` and
 * PowerShell; the point is to catch the two files drifting apart from this one,
 * and the paths and entry shapes are literals in both.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AGENT_CONFIGS,
  isCodexPluginConfig,
  isCommitloreEntry,
  isMcpAgentConfig,
} from '../src/core/agent-configs.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const sh = (): string => readFileSync(join(REPO_ROOT, 'install.sh'), 'utf8');
const ps1 = (): string => readFileSync(join(REPO_ROOT, 'install.ps1'), 'utf8');
const enumeration = (): string =>
  readFileSync(join(REPO_ROOT, 'src', 'commands', 'installer-hosts.ts'), 'utf8');

describe('T-1123 the config table names every agent both installers wire', () => {
  it('covers every agent the installers wire, and nothing else', () => {
    // Six, not the four the ticket's measured inventory lists. Both installers
    // wire Windsurf and Hermes, and the bidirectional assertion below is what
    // finds this kind of silent installer/uninstall disagreement.
    expect(AGENT_CONFIGS.filter(isMcpAgentConfig).map((c) => c.agent).sort()).toEqual([
      'codex',
      'cursor',
      'gemini-cli',
      'hermes',
      'opencode',
      'windsurf',
    ]);
  });

  it('records that Codex registration is CLI-owned with a config-file fallback', () => {
    const codex = AGENT_CONFIGS.find((config) => isMcpAgentConfig(config) && config.agent === 'codex');
    expect(codex?.registration).toBe('cli-or-config-fallback');
    for (const config of AGENT_CONFIGS.filter(isMcpAgentConfig).filter((config) => config.agent !== 'codex')) {
      expect(config.registration).toBe('config-file');
    }
  });

  // Both installers used to spell these paths themselves, and this table was
  // checked against both. #691 deleted that code -- it was unreachable in
  // install.ps1 and uncalled in install.sh -- so the one place a config path is
  // now written is the enumeration, and that is what this table has to agree
  // with. Checking the installers again would assert against files that no
  // longer decide anything.
  it.each(AGENT_CONFIGS.filter(isMcpAgentConfig))('$agent: the enumeration writes the path this table names', (config) => {
    const spelled = `join(home, ${config.homeRelativePath.map((segment) => `'${segment}'`).join(', ')})`;
    expect(enumeration(), `installer-hosts.ts does not write ${spelled}`).toContain(spelled);
  });

  it('knows about every config path the enumeration writes', () => {
    const written = [...enumeration().matchAll(/join\(home, ((?:'[\w.-]+', )*'[\w.-]+\.(?:toml|json|yaml)')\)/g)].map(
      (m) => (m[1] ?? '').split(', ').map((quoted) => quoted.slice(1, -1)).join('/'),
    );
    expect(written.length, 'no config paths found in installer-hosts.ts — the pattern went stale').toBeGreaterThan(0);
    const known = new Set(AGENT_CONFIGS.filter(isMcpAgentConfig).map((c) => c.homeRelativePath.join('/')));
    for (const path of new Set(written)) {
      expect(known.has(path), `installer-hosts.ts writes ${path}, which this table does not know`).toBe(true);
    }
  });

  it('records the Codex plugin alongside the MCP files, not in a second table', () => {
    const plugin = AGENT_CONFIGS.find(isCodexPluginConfig);
    expect(plugin).toEqual({
      kind: 'codex-plugin',
      agent: 'codex',
      marketplace: 'commitlore',
      plugin: 'commitlore',
      marketplaceSource: 'MongLong0214/commitlore',
      dataRelativePath: ['commitlore', 'codex-plugin.json'],
    });
    expect(enumeration()).toContain('plugin install-codex');
  });
});

describe('T-1123 an entry is recognised by its shape, not by its name', () => {
  const WRAPPER = '/home/u/.local/bin/commitlore';

  /**
   * The rule this protects: never remove an entry the installer did not write.
   * A user is free to name their own server `commitlore`, and deleting it
   * because the key matched is the failure nobody would notice — the config
   * simply loses a server and nothing reports it.
   */
  it('accepts what the installer writes, for each format', () => {
    const written: Record<string, unknown> = {
      'toml-mcp_servers': { command: WRAPPER, args: ['mcp'] },
      'json-mcpServers': { command: WRAPPER, args: ['mcp'] },
      'yaml-mcp_servers': { command: WRAPPER, args: ['mcp'], enabled: true },
      // opencode's shape is its own: the command is an array, and there are two
      // more keys. A recogniser written only for the shape above silently leaves
      // this one behind.
      'json-mcp': { type: 'local', command: [WRAPPER, 'mcp'], enabled: true },
    };
    for (const config of AGENT_CONFIGS.filter(isMcpAgentConfig)) {
      const entry = written[config.format];
      expect(entry, `no sample for ${config.format}`).toBeDefined();
      expect(
        isCommitloreEntry(config.format, entry, WRAPPER),
        `${config.agent}: the installer's own entry was not recognised`,
      ).toBe(true);
    }
  });

  it.each([
    ['a different program under our name', { command: '/usr/local/bin/other', args: ['mcp'] }],
    ['our wrapper with different arguments', { command: WRAPPER, args: ['serve'] }],
    ['our wrapper with no arguments', { command: WRAPPER }],
    ['a name-only match', { command: 'commitlore' }],
    ['an unrelated object', { url: 'https://example.invalid' }],
    ['nothing at all', null],
  ])('refuses %s in an mcpServers config', (_label, entry) => {
    expect(isCommitloreEntry('json-mcpServers', entry, WRAPPER)).toBe(false);
  });

  it.each([
    ['a different program', { type: 'local', command: ['/usr/local/bin/other', 'mcp'], enabled: true }],
    ['our wrapper with a different subcommand', { type: 'local', command: [WRAPPER, 'serve'], enabled: true }],
    ['the string form in the array-shaped config', { command: WRAPPER, args: ['mcp'] }],
  ])('refuses %s in an opencode config', (_label, entry) => {
    expect(isCommitloreEntry('json-mcp', entry, WRAPPER)).toBe(false);
  });

  it('refuses our own shape when it points at a different install', () => {
    // Two installs on one machine: removing the other one's entry is removing
    // something this uninstall did not write.
    expect(
      isCommitloreEntry('json-mcpServers', { command: WRAPPER, args: ['mcp'] }, '/opt/other/commitlore'),
    ).toBe(false);
  });

  it('dispatches Hermes through the shared host command', () => {
    // The YAML updater has to preserve comments and unrelated operator policy,
    // so it lives in the CLI rather than growing two subtly different parsers.
    // Both installers used to spell this invocation themselves; #691 deleted
    // those copies, and the one that runs is the enumeration's.
    expect(enumeration()).toContain("'hermes', 'install', '--config'");
    expect(enumeration()).toContain("'--verify'");
  });
});
