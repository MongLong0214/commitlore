/**
 * #1079: two installers register the same MCP server and neither can see the
 * other.
 *
 * This is #781 one surface over. That issue fixed the `PreToolUse` hook — "the
 * plugin ships `hooks/hooks.json`, `init` writes `settings.json`, and a user who
 * follows the README to the plugin and then runs the documented `init` carries
 * both" — and the MCP server has the same two installers and kept the defect.
 *
 * Measured on one machine before the fix: a session whose plugin server was
 * 1.3.17 while its user-scope registration served 1.5.0. Inside that one session
 * the hooks graded every edit by one build's rules while the tools answered as
 * another's, and no row said so.
 *
 * Both halves are pinned here, because the `init` fix reaches nobody who already
 * has both:
 *
 *   1. `init` must not write a host registration when the plugin will deliver;
 *   2. `doctor` must report a machine that already carries two routes.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { checkMcpDeliveryRoutes } from '../src/commands/doctor/checks/delivery-mcp-delivery-routes.js';
import type { DoctorContext } from '../src/commands/doctor/model.js';
import { hostRegistersCommitlore } from '../src/core/mcp-registration.js';
import { createTestRepo } from './git-fixtures.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * A HOME whose Claude Code state says the plugin is installed and enabled.
 *
 * Both halves are required by `pluginDeliveryProof`, which answers `false` for
 * anything it cannot read affirmatively — the failure direction #781 chose on
 * purpose.
 */
const home = (options: { plugin: boolean; userScope: boolean }): string => {
  const root = mkdtempSync(join(tmpdir(), 'de-routes-home-'));
  roots.push(root);
  mkdirSync(join(root, '.claude', 'plugins'), { recursive: true });
  if (options.plugin) {
    writeFileSync(
      join(root, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'commitlore@commitlore': [{ version: '1.5.0' }] } }),
    );
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'commitlore@commitlore': true } }),
    );
  }
  writeFileSync(
    join(root, '.claude.json'),
    JSON.stringify({ mcpServers: options.userScope ? { commitlore: { command: 'commitlore', args: ['mcp'] } } : {} }),
  );
  return root;
};

const repo = (withProjectRegistration: boolean): string => {
  const root = mkdtempSync(join(tmpdir(), 'de-routes-repo-'));
  roots.push(root);
  const path = join(root, 'repo');
  createTestRepo({ path });
  if (withProjectRegistration) {
    writeFileSync(
      join(path, '.mcp.json'),
      JSON.stringify({ mcpServers: { commitlore: { command: 'commitlore', args: ['mcp'] } } }),
    );
  }
  return path;
};

const routes = (cwd: string, HOME: string) =>
  checkMcpDeliveryRoutes({ opts: { cwd }, env: { HOME } } as unknown as DoctorContext);

describe('#1079 doctor reports a host carrying two routes', () => {
  it('warns when the plugin and a user-scope registration both deliver', () => {
    const row = routes(repo(false), home({ plugin: true, userScope: true }));

    expect(row.status).toBe('warn');
    expect(row.evidence['route_count']).toBe('2');
    expect(row.detail).toMatch(/2 routes deliver/);
    // The remedy keeps the plugin's hooks and skills, which the host registration
    // does not carry, so it names the server rather than the plugin.
    expect(row.fix).toMatch(/\/mcp disable plugin:commitlore:commitlore/);
  });

  it('warns when the plugin and a project-scope registration both deliver', () => {
    const row = routes(repo(true), home({ plugin: true, userScope: false }));

    expect(row.status).toBe('warn');
    expect(row.evidence['project_scope']).toBe('true');
  });

  it('counts all three when all three are present', () => {
    const row = routes(repo(true), home({ plugin: true, userScope: true }));

    expect(row.evidence['route_count']).toBe('3');
  });

  it('does not claim attention — it observes the host, not this repository', () => {
    // #750: a finding about the machine must not make `init` report a step that
    // did not complete.
    expect(routes(repo(true), home({ plugin: true, userScope: true })).needsAttention).toBe(false);
  });
});

describe('#1079 one route is the healthy state', () => {
  it('is ok with the plugin alone', () => {
    const row = routes(repo(false), home({ plugin: true, userScope: false }));

    expect(row.status).toBe('ok');
    expect(row.detail).toMatch(/one route delivers/);
  });

  it('is ok with a user-scope registration alone', () => {
    const row = routes(repo(false), home({ plugin: false, userScope: true }));

    expect(row.status).toBe('ok');
    expect(row.evidence['route_count']).toBe('1');
  });

  it('is ok, and says so plainly, when no route delivers at all', () => {
    // Not a warning: a repository whose user runs no host is a complete answer,
    // and a row that fired here would fire on every machine without the plugin.
    const row = routes(repo(false), home({ plugin: false, userScope: false }));

    expect(row.status).toBe('ok');
    expect(row.detail).toMatch(/no route delivers/);
  });
});

describe('#1079 the user-scope reader', () => {
  it('reads a registration out of the host config', () => {
    expect(hostRegistersCommitlore(home({ plugin: false, userScope: true }))).toBe(true);
  });

  it('answers false for a host config that is absent or unreadable', () => {
    // Absence is a complete answer, not an error: a machine with no host config
    // has no user-scope registration.
    expect(hostRegistersCommitlore(join(tmpdir(), 'de-routes-nothing-here'))).toBe(false);
  });
});
