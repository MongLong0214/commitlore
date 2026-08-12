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
      result('{"marketplaces":[]}'),
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
      ['plugin', 'marketplace', 'list', '--json'],
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
        return args.join(' ') === 'plugin marketplace list --json'
          ? result(
              JSON.stringify({
                marketplaces: [
                  {
                    name: 'commitlore',
                    // What Codex actually reports for `MongLong0214/commitlore`.
                    marketplaceSource: {
                      sourceType: 'git',
                      source: 'https://github.com/MongLong0214/commitlore.git',
                    },
                  },
                ],
              }),
            )
          : result('PLUGIN STATUS VERSION PATH\ncommitlore@commitlore installed, enabled 0.7.1 /tmp/commitlore\n');
      },
    });

    expect(installed.exitCode).toBe(0);
    expect(calls).toEqual([
      ['plugin', 'marketplace', 'list', '--json'],
      ['plugin', 'list'],
    ]);
    expect(installed.report.join('\n')).toContain('Codex plugin already installed: commitlore@commitlore');
  });

  // The marker is a claim of ownership and `uninstall` removes what it marks.
  // Finding a plugin someone else installed and recording it as ours meant a
  // later uninstall would delete their state, which is the opposite of the
  // promise in docs/install.md. This test existed and checked the calls and the
  // wording; it did not check the one durable side effect that mattered.
  /**
   * The name was the whole test, so a marketplace called `commitlore` was
   * accepted however it had been configured — and the next call was
   * `plugin add commitlore@commitlore`. A marketplace of that name pointing
   * anywhere else meant installing somebody else's plugin and reporting
   * CommitLore installed.
   */
  it('refuses to install from a marketplace of our name that points elsewhere', () => {
    const calls: string[][] = [];
    const home = dataHome();

    const installed = installCodexPlugin({
      dataHome: home,
      run: (args) => {
        calls.push([...args]);
        return result(
          JSON.stringify({
            marketplaces: [
              {
                name: 'commitlore',
                marketplaceSource: { sourceType: 'git', source: 'https://github.com/attacker/commitlore.git' },
              },
            ],
          }),
        );
      },
    });

    expect(installed.exitCode).toBe(2);
    // Nothing was added and nothing was installed: the listing is the only call.
    expect(calls).toEqual([['plugin', 'marketplace', 'list', '--json']]);
    expect(installed.report.join('\n')).toContain('attacker/commitlore');
    expect(existsSync(codexPluginMarkerPath(undefined, home))).toBe(false);
  });

  it('accepts the source Codex reports for the shorthand this tool adds', () => {
    // `MongLong0214/commitlore` goes in; `https://github.com/MongLong0214/commitlore.git`
    // comes back. Comparing those literally would refuse every correct install.
    const installed = installCodexPlugin({
      dataHome: dataHome(),
      run: (args) =>
        args.join(' ') === 'plugin marketplace list --json'
          ? result(
              JSON.stringify({
                marketplaces: [
                  {
                    name: 'commitlore',
                    marketplaceSource: {
                      sourceType: 'git',
                      source: 'https://github.com/MongLong0214/commitlore.git',
                    },
                  },
                ],
              }),
            )
          : result('PLUGIN STATUS VERSION PATH\ncommitlore@commitlore installed, enabled 0.8.0 /tmp/c\n'),
    });

    expect(installed.exitCode).toBe(0);
    expect(installed.report.join('\n')).not.toContain('points at');
  });

  it('refuses when a marketplace of our name is present but unidentifiable', () => {
    // Same risk as `foreign`: the next call would be `plugin add
    // commitlore@commitlore`, installing whatever that marketplace serves.
    const calls: string[][] = [];
    const home = dataHome();
    const installed = installCodexPlugin({
      dataHome: home,
      run: (args) => {
        calls.push([...args]);
        return result('MARKETPLACE ROOT\ncommitlore /tmp/somebody-elses\n');
      },
    });

    expect(installed.exitCode).toBe(2);
    expect(calls).toEqual([['plugin', 'marketplace', 'list', '--json']]);
    expect(installed.report.join('\n')).toContain('does not report where it points');
    expect(existsSync(codexPluginMarkerPath(undefined, home))).toBe(false);
  });

  it('says so when Codex cannot report where a marketplace points', () => {
    // An older Codex prints a table with no source column. That is neither
    // "ours" nor "theirs", and reporting it as either would be a claim this
    // tool cannot support.
    const installed = installCodexPlugin({
      dataHome: dataHome(),
      run: (args) =>
        args.join(' ') === 'plugin marketplace list --json'
          ? result('MARKETPLACE ROOT\nopenai-bundled /tmp/bundled\n')
          : result('PLUGIN STATUS VERSION PATH\ncommitlore@commitlore installed, enabled 0.8.0 /tmp/c\n'),
    });

    expect(installed.exitCode).toBe(0);
    expect(installed.report.join('\n')).toContain('none named commitlore was visible');
  });

  it('claims no ownership over a plugin it found already installed', () => {
    const home = dataHome();
    const installed = installCodexPlugin({
      dataHome: home,
      run: (args) =>
        args.join(' ') === 'plugin marketplace list'
          ? result('MARKETPLACE ROOT\ncommitlore /tmp/commitlore\n')
          : result('PLUGIN STATUS VERSION PATH\ncommitlore@commitlore installed, enabled 0.7.1 /tmp/commitlore\n'),
    });

    expect(installed.exitCode).toBe(0);
    expect(existsSync(codexPluginMarkerPath(undefined, home))).toBe(false);
  });

  // A review ran this with GitHub unreachable. Codex printed "Could not resolve
  // host: github.com" and the operator was shown "could not add the marketplace"
  // followed by "retry with" the identical command — advice that could not work,
  // with the one sentence explaining why already captured and thrown away.
  it('reports what Codex said when it fails, not only that it failed', () => {
    const home = dataHome();
    const failed = installCodexPlugin({
      dataHome: home,
      run: (args) =>
        args.join(' ') === 'plugin marketplace list'
          ? result('MARKETPLACE ROOT\n')
          : { status: 2, stdout: '', stderr: 'Could not resolve host: github.com\n' },
    });

    expect(failed.exitCode).toBe(2);
    expect(failed.report.join('\n')).toContain('Could not resolve host: github.com');
  });

  it('says nothing extra when Codex itself said nothing', () => {
    const home = dataHome();
    const failed = installCodexPlugin({
      dataHome: home,
      run: (args) => (args.join(' ') === 'plugin marketplace list' ? result('MARKETPLACE ROOT\n') : result('', 2)),
    });

    expect(failed.report.join('\n')).not.toContain('codex said:');
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
