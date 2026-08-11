/**
 * Hermes host setup stays deliberately separate from `commitlore init`:
 * repository hooks/index/policy are repository-owned, while this suite covers
 * the active Hermes profile's MCP and externally-owned skill bundle.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runHermesInstall } from '../src/commands/hermes.js';
import { addHermesConfig, removeHermesConfig } from '../src/core/hermes-config.js';

const scratch: string[] = [];
afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const path = mkdtempSync(join(tmpdir(), `commitlore-hermes-${label}-`));
  scratch.push(path);
  return path;
};

const write = (path: string, contents: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
};

const operatorConfig = [
  'approvals:',
  '  mode: ask',
  '  deny:',
  '    - "*git push*--force*"',
  '    - "*mailx*"',
  'command_allowlist:',
  '  - shell command via -c/-lc flag',
  'mcp_servers:',
  '  existing:',
  '    command: other-mcp',
  '    args:',
  '      - serve',
  'skills:',
  '  external_dirs:',
  '    - "/operator/skills"',
  'agent:',
  '  max_turns: 50',
  '',
].join('\n');

describe('Hermes host configuration', () => {
  it('adds only the MCP and external-skill blocks, after backing up the exact config', () => {
    const home = temp('profile');
    const configPath = join(home, '.hermes', 'config.yaml');
    const dataHome = join(home, '.local', 'share');
    const skillsDir = join(dataHome, 'commitlore', 'v9.9.9', 'hermes', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    write(configPath, operatorConfig);

    const result = runHermesInstall({ configPath, home, dataHome, skillsDir, detected: true });

    expect(result.exitCode).toBe(0);
    expect(result.changed).toEqual(['mcp', 'skills']);
    const after = readFileSync(configPath, 'utf8');
    expect(after).toContain('  existing:\n    command: other-mcp');
    expect(after).toContain('    - "/operator/skills"');
    // Operator-owned policy is copied as an exact byte sequence, never parsed
    // and emitted in a normalized order.
    expect(after).toContain(operatorConfig.slice(0, operatorConfig.indexOf('mcp_servers:')));
    expect(after).toContain('  commitlore:\n    command: ' + JSON.stringify(join(home, '.local', 'bin', 'commitlore')));
    expect(after).toContain(`    - ${JSON.stringify(skillsDir)}`);

    const backup = `${configPath}.commitlore-backup`;
    expect(existsSync(backup)).toBe(true);
    expect(readFileSync(backup, 'utf8')).toBe(operatorConfig);
  });

  it('is byte-stable on a second run and says it made no change', () => {
    const home = temp('repeat');
    const configPath = join(home, '.hermes', 'config.yaml');
    const dataHome = join(home, '.local', 'share');
    const skillsDir = join(dataHome, 'commitlore', 'v9.9.9', 'hermes', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    write(configPath, operatorConfig);

    runHermesInstall({ configPath, home, dataHome, skillsDir, detected: true });
    const beforeSecond = readFileSync(configPath, 'utf8');
    const second = runHermesInstall({ configPath, home, dataHome, skillsDir, detected: true });

    expect(second.exitCode).toBe(0);
    expect(second.changed).toEqual([]);
    expect(second.report).toContain('Hermes already configured (unchanged).');
    expect(readFileSync(configPath, 'utf8')).toBe(beforeSecond);
    expect(existsSync(`${configPath}.commitlore-backup.1`)).toBe(false);
  });

  it('does not create a profile merely because Hermes is absent', () => {
    const home = temp('absent');
    const result = runHermesInstall({ home, skillsDir: join(home, 'skills'), detected: false });

    expect(result.exitCode).toBe(0);
    expect(result.report).toEqual(['Hermes not detected — left its profile untouched.']);
    expect(existsSync(join(home, '.hermes'))).toBe(false);
  });

  it('uses Hermes\' selected profile when HERMES_HOME is set', () => {
    const home = temp('selected-user-home');
    const profile = temp('selected-profile');
    const skillsDir = join(home, 'bundle');
    mkdirSync(skillsDir, { recursive: true });
    const previous = process.env['HERMES_HOME'];
    process.env['HERMES_HOME'] = profile;
    try {
      const result = runHermesInstall({ home, skillsDir, detected: true });
      expect(result.exitCode).toBe(0);
    } finally {
      if (previous === undefined) delete process.env['HERMES_HOME'];
      else process.env['HERMES_HOME'] = previous;
    }

    expect(existsSync(join(profile, 'config.yaml'))).toBe(true);
    expect(existsSync(join(home, '.hermes', 'config.yaml'))).toBe(false);
  });

  it('reports a conflicting server instead of overwriting it', () => {
    const home = temp('conflict');
    const configPath = join(home, '.hermes', 'config.yaml');
    const skillsDir = join(home, 'bundle');
    mkdirSync(skillsDir, { recursive: true });
    const foreign = operatorConfig.replace(
      '  existing:',
      '  commitlore:\n    command: "/other/commitlore"\n    args:\n      - mcp\n    enabled: true\n  existing:',
    );
    write(configPath, foreign);

    const result = runHermesInstall({ configPath, home, skillsDir, detected: true });

    expect(result.exitCode).toBe(1);
    expect(readFileSync(configPath, 'utf8')).toContain('command: "/other/commitlore"');
    expect(result.report.join('\n')).toMatch(/already exists|could not configure/);
  });

  it('does not claim or remove a similar server with operator settings', () => {
    const home = temp('shaped-conflict');
    const dataRoot = join(home, '.local', 'share', 'commitlore');
    const configPath = join(home, '.hermes', 'config.yaml');
    const wrapper = join(home, '.local', 'bin', 'commitlore');
    const skillsDir = join(dataRoot, 'v9.9.9', 'hermes', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    const foreign = [
      'mcp_servers:',
      '  commitlore:',
      `    command: ${JSON.stringify(wrapper)}`,
      '    args:',
      '      - mcp',
      '    enabled: true',
      '    env:',
      '      EXTRA_SETTING: keep',
      '',
    ].join('\n');
    write(configPath, foreign);

    const install = runHermesInstall({ configPath, home, skillsDir, dataRoot, detected: true });
    const removal = removeHermesConfig(foreign, { wrapperPath: wrapper, dataRoot });

    expect(install.exitCode).toBe(1);
    expect(readFileSync(configPath, 'utf8')).toBe(foreign);
    expect(removal.removed).toEqual([]);
    expect(removal.contents).toBe(foreign);
  });

  it('removes only its exact MCP entry and managed external directory', () => {
    const home = temp('remove');
    const dataRoot = join(home, '.local', 'share', 'commitlore');
    const wrapper = join(home, '.local', 'bin', 'commitlore');
    const skillsDir = join(dataRoot, 'v9.9.9', 'hermes', 'skills');
    const installed = addHermesConfig(operatorConfig, { wrapperPath: wrapper, skillsDir, dataRoot });

    const removed = removeHermesConfig(installed.contents, { wrapperPath: wrapper, dataRoot });

    expect(removed.removed).toEqual(['mcp', 'skills']);
    expect(removed.contents).toContain('  existing:\n    command: other-mcp');
    expect(removed.contents).toContain('    - "/operator/skills"');
    expect(removed.contents).not.toContain(wrapper);
    expect(removed.contents).not.toContain(skillsDir);
  });
});
