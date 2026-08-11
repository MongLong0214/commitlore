import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  codexPluginInstallCommand,
  codexPluginMarkerPath,
  installCodexPlugin,
  type CodexCommandResult,
} from '../src/core/codex-plugin.js';

const ROOT = resolve(import.meta.dirname, '..');
const scratch: string[] = [];

const dataHome = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-codex-plugin-'));
  scratch.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const result = (stdout = '', status = 0): CodexCommandResult => ({ status, stdout, stderr: '' });

describe('Codex plugin installation', () => {
  it('uses Codex APIs once and records ownership only after the plugin is installed', () => {
    const calls: string[][] = [];
    const responses = [
      result('MARKETPLACE ROOT\n'),
      result(),
      result('PLUGIN STATUS VERSION PATH\ncommitlore@commitlore not installed\n'),
      result(),
    ];
    const home = dataHome();

    const installed = installCodexPlugin({
      dataHome: home,
      run: (args) => {
        calls.push([...args]);
        return responses.shift() ?? result('', 2);
      },
    });

    expect(installed.exitCode).toBe(0);
    expect(calls).toEqual([
      ['plugin', 'marketplace', 'list'],
      ['plugin', 'marketplace', 'add', 'MongLong0214/commitlore'],
      ['plugin', 'list'],
      ['plugin', 'add', 'commitlore@commitlore'],
    ]);
    expect(readFileSync(codexPluginMarkerPath(undefined, home), 'utf8')).toContain('commitlore@commitlore');
  });

  it('is idempotent when Codex already reports the marketplace and plugin installed', () => {
    const calls: string[][] = [];
    const installed = installCodexPlugin({
      dataHome: dataHome(),
      run: (args) => {
        calls.push([...args]);
        return args.join(' ') === 'plugin marketplace list'
          ? result('MARKETPLACE ROOT\ncommitlore /tmp/commitlore\n')
          : result('PLUGIN STATUS VERSION PATH\ncommitlore@commitlore installed, enabled 0.7.1 /tmp/commitlore\n');
      },
    });

    expect(installed.exitCode).toBe(0);
    expect(calls).toEqual([
      ['plugin', 'marketplace', 'list'],
      ['plugin', 'list'],
    ]);
    expect(installed.report).toContain('Codex plugin already installed: commitlore@commitlore');
  });

  it('does not leave an ownership marker when Codex cannot add the marketplace', () => {
    const home = dataHome();
    const installed = installCodexPlugin({
      dataHome: home,
      run: (args) => (args.join(' ') === 'plugin marketplace list' ? result('MARKETPLACE ROOT\n') : result('', 2)),
    });

    expect(installed.exitCode).toBe(2);
    expect(existsSync(codexPluginMarkerPath(undefined, home))).toBe(false);
  });
});

describe('Codex plugin package', () => {
  it('declares the MCP server and all skills from the repository plugin root', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, '.codex-plugin', 'plugin.json'), 'utf8')) as {
      name: string;
      version: string;
      skills: string;
      mcpServers: string;
    };
    const mcp = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8')) as {
      mcpServers: { commitlore: { command: string; args: string[]; cwd: string } };
    };

    expect(manifest).toMatchObject({
      name: 'commitlore',
      version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
      skills: './skills/',
      mcpServers: './.mcp.json',
    });
    expect(mcp.mcpServers.commitlore).toEqual({
      command: 'node',
      args: ['./dist/commitlore.mjs', 'mcp'],
      cwd: '.',
    });
  });

  it('ships a Codex capture skill whose evidence refusals drop claims instead of inventing citations', () => {
    const skill = readFileSync(join(ROOT, 'skills', 'commitlore-codex', 'SKILL.md'), 'utf8');
    expect(skill).toContain('Discard any record with no `evidence` item that cites the transcript');
    expect(skill).toContain('Discard every trailer whose claim is not supported by the cited transcript');
    expect(skill).toContain('Never invent a citation, locator, quote, or supporting rationale');
  });

  it('publishes one exact command that runs the idempotent install route', () => {
    expect(codexPluginInstallCommand()).toBe('commitlore plugin install-codex');
  });
});
