/**
 * T-1108 acceptance: `commitlore uninstall` removes what install.sh wrote
 * and nothing else.
 *
 * RED test: fails because no `uninstall` command exists yet.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { AGENT_CONFIGS, resolveConfigPath } from '../src/core/agent-configs.js';
import { runUninstall, type UninstallResult } from '../src/commands/uninstall.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-uninstall-${label}-`));
  scratch.push(dir);
  return dir;
};

/** Create a fake commitlore binary that outputs a semver for --version. */
const createFakeBinary = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '#!/bin/sh\necho "0.4.1"\n');
  chmodSync(path, 0o755);
};

/** Create a fake NON-commitlore binary. */
const createForeignBinary = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '#!/bin/sh\necho "not commitlore"\n');
  chmodSync(path, 0o755);
};

/** JSON config with both commitlore and an unrelated MCP entry. */
const JSON_MCP_SERVERS_CONFIG = JSON.stringify(
  {
    mcpServers: {
      commitlore: { command: '/home/user/.local/bin/commitlore', args: ['mcp'] },
      'some-other-server': {
        command: '/usr/bin/other',
        args: ['serve'],
        env: { API_KEY: 'sk-secret-value-12345' },
      },
    },
  },
  null,
  2,
);

/** JSON config for opencode format (mcp key instead of mcpServers). */
const JSON_MCP_CONFIG = JSON.stringify(
  {
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      commitlore: { type: 'local', command: ['/home/user/.local/bin/commitlore', 'mcp'], enabled: true },
      'another-tool': {
        type: 'local',
        command: ['/usr/bin/another', 'run'],
        enabled: true,
        env: { SECRET_TOKEN: 'tok-private-9999' },
      },
    },
  },
  null,
  2,
);

/** TOML config for codex with both commitlore and an unrelated entry. */
const TOML_CONFIG = `[mcp_servers.commitlore]
command = "/home/user/.local/bin/commitlore"
args = ["mcp"]

[mcp_servers.another_server]
command = "/usr/bin/another"
args = ["serve"]
env = { API_KEY = "sk-toml-secret-key" }
`;

describe('commitlore uninstall', () => {
  describe('removes binary and commitlore MCP entry, preserves everything else', () => {
    it('removes the binary and json-mcpServers entry, unrelated entry survives byte-for-byte', () => {
      const home = tempDir('json-mcpServers');
      const binPath = join(home, '.local', 'bin', 'commitlore');
      createFakeBinary(binPath);

      // Set up a cursor config with both entries
      const cursorEntry = AGENT_CONFIGS.find((e) => e.agent === 'cursor')!;
      const configPath = resolveConfigPath(cursorEntry, home)!;
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON_MCP_SERVERS_CONFIG);

      const result = runUninstall({ home, dryRun: false });

      // Binary should be gone
      expect(existsSync(binPath)).toBe(false);

      // Config file should still exist
      expect(existsSync(configPath)).toBe(true);
      const remaining = JSON.parse(readFileSync(configPath, 'utf8'));

      // commitlore entry should be gone
      expect(remaining.mcpServers.commitlore).toBeUndefined();

      // unrelated entry must survive byte-for-byte
      expect(remaining.mcpServers['some-other-server']).toEqual({
        command: '/usr/bin/other',
        args: ['serve'],
        env: { API_KEY: 'sk-secret-value-12345' },
      });

      // Report shape
      const cursorReport = result.agents.find((a) => a.agent === 'cursor');
      expect(cursorReport).toBeDefined();
      expect(cursorReport!.outcome).toBe('removed');
    });

    it('removes opencode json-mcp entry, unrelated entry survives', () => {
      const home = tempDir('json-mcp');
      const binPath = join(home, '.local', 'bin', 'commitlore');
      createFakeBinary(binPath);

      const opencodeEntry = AGENT_CONFIGS.find((e) => e.agent === 'opencode')!;
      const configPath = resolveConfigPath(opencodeEntry, home)!;
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON_MCP_CONFIG);

      const result = runUninstall({ home, dryRun: false });

      const remaining = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(remaining.mcp.commitlore).toBeUndefined();
      expect(remaining.mcp['another-tool']).toEqual({
        type: 'local',
        command: ['/usr/bin/another', 'run'],
        enabled: true,
        env: { SECRET_TOKEN: 'tok-private-9999' },
      });

      const opencodeReport = result.agents.find((a) => a.agent === 'opencode');
      expect(opencodeReport).toBeDefined();
      expect(opencodeReport!.outcome).toBe('removed');
    });

    it('removes codex TOML entry, unrelated entry survives', () => {
      const home = tempDir('toml');
      const binPath = join(home, '.local', 'bin', 'commitlore');
      createFakeBinary(binPath);

      const codexEntry = AGENT_CONFIGS.find((e) => e.agent === 'codex')!;
      const configPath = resolveConfigPath(codexEntry, home)!;
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, TOML_CONFIG);

      const result = runUninstall({ home, dryRun: false });

      const remaining = readFileSync(configPath, 'utf8');
      // commitlore block should be gone
      expect(remaining).not.toContain('[mcp_servers.commitlore]');
      // unrelated block must survive
      expect(remaining).toContain('[mcp_servers.another_server]');
      expect(remaining).toContain('command = "/usr/bin/another"');

      const codexReport = result.agents.find((a) => a.agent === 'codex');
      expect(codexReport).toBeDefined();
      expect(codexReport!.outcome).toBe('removed');
    });
  });

  describe('idempotent: second run removes nothing and exits 0', () => {
    it('second run reports nothing removed', () => {
      const home = tempDir('idempotent');
      const binPath = join(home, '.local', 'bin', 'commitlore');
      createFakeBinary(binPath);

      const cursorEntry = AGENT_CONFIGS.find((e) => e.agent === 'cursor')!;
      const configPath = resolveConfigPath(cursorEntry, home)!;
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON_MCP_SERVERS_CONFIG);

      // First run
      runUninstall({ home, dryRun: false });

      // Second run
      const result2 = runUninstall({ home, dryRun: false });

      // Binary already gone → not-found
      expect(result2.binary.outcome).toBe('not-found');

      // Cursor entry already gone → not-found
      const cursorReport = result2.agents.find((a) => a.agent === 'cursor');
      expect(cursorReport!.outcome).toBe('not-found');
    });
  });

  describe('refuses a foreign (non-commitlore) binary', () => {
    it('leaves a foreign binary in place with a named reason', () => {
      const home = tempDir('foreign-binary');
      const binPath = join(home, '.local', 'bin', 'commitlore');
      createForeignBinary(binPath);

      const result = runUninstall({ home, dryRun: false });

      // Binary must still exist
      expect(existsSync(binPath)).toBe(true);
      expect(result.binary.outcome).toBe('left');
      expect(result.binary.reason).toContain('does not identify itself as commitlore');
    });
  });

  describe('--dry-run changes nothing', () => {
    it('dry-run reports what would be done but changes nothing', () => {
      const home = tempDir('dry-run');
      const binPath = join(home, '.local', 'bin', 'commitlore');
      createFakeBinary(binPath);

      const cursorEntry = AGENT_CONFIGS.find((e) => e.agent === 'cursor')!;
      const configPath = resolveConfigPath(cursorEntry, home)!;
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON_MCP_SERVERS_CONFIG);
      const originalContent = readFileSync(configPath, 'utf8');

      const result = runUninstall({ home, dryRun: true });

      // Nothing should have changed
      expect(existsSync(binPath)).toBe(true);
      expect(readFileSync(configPath, 'utf8')).toBe(originalContent);

      // But report should indicate what WOULD be done
      expect(result.binary.outcome).toBe('would-remove');
      const cursorReport = result.agents.find((a) => a.agent === 'cursor');
      expect(cursorReport!.outcome).toBe('would-remove');
    });
  });

  describe('privacy: does not leak other entries', () => {
    it('JSON output never contains other MCP entries API keys or values', () => {
      const home = tempDir('privacy');
      const binPath = join(home, '.local', 'bin', 'commitlore');
      createFakeBinary(binPath);

      const cursorEntry = AGENT_CONFIGS.find((e) => e.agent === 'cursor')!;
      const configPath = resolveConfigPath(cursorEntry, home)!;
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON_MCP_SERVERS_CONFIG);

      const opencodeEntry = AGENT_CONFIGS.find((e) => e.agent === 'opencode')!;
      const ocConfigPath = resolveConfigPath(opencodeEntry, home)!;
      mkdirSync(dirname(ocConfigPath), { recursive: true });
      writeFileSync(ocConfigPath, JSON_MCP_CONFIG);

      const result = runUninstall({ home, dryRun: false, json: true });

      // Serialize the result to check it doesn't contain secrets
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('sk-secret-value-12345');
      expect(serialized).not.toContain('tok-private-9999');
      expect(serialized).not.toContain('sk-toml-secret-key');
      expect(serialized).not.toContain('some-other-server');
      expect(serialized).not.toContain('another-tool');
      expect(serialized).not.toContain('/usr/bin/other');
      expect(serialized).not.toContain('/usr/bin/another');
    });
  });

  describe('config not found', () => {
    it('reports not-found for agents with no config file', () => {
      const home = tempDir('no-config');
      const binPath = join(home, '.local', 'bin', 'commitlore');
      createFakeBinary(binPath);

      const result = runUninstall({ home, dryRun: false });

      // All file-based agents should report not-found since no configs exist
      for (const agentResult of result.agents) {
        if (agentResult.agent === 'claude-code') continue; // plugin-based
        expect(['not-found', 'removed']).toContain(agentResult.outcome);
      }
    });
  });
});
