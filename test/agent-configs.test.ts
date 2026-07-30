/**
 * Bidirectional agreement between `src/core/agent-configs.ts` and `install.sh`.
 *
 * Two sources of the same truth diverge silently. This test catches it:
 * every config path in a `wire_*` function must have an entry in the table,
 * and every entry in the table must appear in `install.sh`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AGENT_CONFIGS } from '../src/core/agent-configs.js';

const INSTALL_SH = readFileSync(
  fileURLToPath(new URL('../install.sh', import.meta.url)),
  'utf8',
);

/**
 * Extract agent names from install.sh's iteration loop.
 * The loop uses the format: "Agent Name:has_fn:wire_fn"
 */
const extractAgentNamesFromLoop = (): string[] => {
  const loopMatch = INSTALL_SH.match(
    /for spec in\s*\\?\n([\s\S]*?)\s*;\s*do/,
  );
  if (!loopMatch) throw new Error('could not find the agent loop in install.sh');
  const loopBody = loopMatch[1]!;
  // Each line has "AgentName:has_fn:wire_fn"
  const agents: string[] = [];
  for (const match of loopBody.matchAll(/"([^"]+)"/g)) {
    const parts = match[1]!.split(':');
    agents.push(parts[0]!);
  }
  return agents;
};

/**
 * Extract config paths from install.sh's wire_* functions.
 * Returns a map of agent-name → config path (relative to $HOME).
 */
const extractConfigPathsFromInstallSh = (): Map<string, string | null> => {
  const result = new Map<string, string | null>();

  // wire_codex: config_path="$HOME/.codex/config.toml"
  const codexMatch = INSTALL_SH.match(
    /wire_codex\(\)\s*\{[\s\S]*?config_path="\$HOME\/([^"]+)"/,
  );
  if (codexMatch) result.set('codex', codexMatch[1]!);

  // wire_gemini calls wire_mcp_servers_json "gemini-cli" "$HOME/.gemini/settings.json"
  const geminiMatch = INSTALL_SH.match(
    /wire_gemini\(\)\s*\{[^}]*wire_mcp_servers_json\s+"gemini-cli"\s+"\$HOME\/([^"]+)"/,
  );
  if (geminiMatch) result.set('gemini-cli', geminiMatch[1]!);

  // wire_cursor calls wire_mcp_servers_json "cursor" "$HOME/.cursor/mcp.json"
  const cursorMatch = INSTALL_SH.match(
    /wire_cursor\(\)\s*\{[^}]*wire_mcp_servers_json\s+"cursor"\s+"\$HOME\/([^"]+)"/,
  );
  if (cursorMatch) result.set('cursor', cursorMatch[1]!);

  // wire_windsurf calls wire_mcp_servers_json "windsurf" "$HOME/.codeium/windsurf/mcp_config.json"
  const windsurfMatch = INSTALL_SH.match(
    /wire_windsurf\(\)\s*\{[^}]*wire_mcp_servers_json\s+"windsurf"\s+"\$HOME\/([^"]+)"/,
  );
  if (windsurfMatch) result.set('windsurf', windsurfMatch[1]!);

  // wire_opencode: config_path="$HOME/.config/opencode/opencode.json"
  const opencodeMatch = INSTALL_SH.match(
    /wire_opencode\(\)\s*\{[\s\S]*?config_path="\$HOME\/([^"]+)"/,
  );
  if (opencodeMatch) result.set('opencode', opencodeMatch[1]!);

  // wire_claude_code uses plugin CLI, not a config file
  result.set('claude-code', null);

  return result;
};

describe('agent-configs bidirectional agreement with install.sh', () => {
  const installShPaths = extractConfigPathsFromInstallSh();
  const installShAgents = extractAgentNamesFromLoop();

  it('every agent in install.sh loop has an entry in AGENT_CONFIGS', () => {
    const tableAgents = AGENT_CONFIGS.map((e) => e.agent);
    // Normalize: install.sh uses display names like "Claude Code", table uses "claude-code"
    const normalizedInstallAgents = installShAgents.map((a) =>
      a.toLowerCase().replace(/\s+/g, '-'),
    );
    for (const agent of normalizedInstallAgents) {
      // Map "gemini-cli" from display name "Gemini CLI" → "gemini-cli"
      expect(tableAgents).toContain(agent);
    }
  });

  it('every entry in AGENT_CONFIGS has a wire_* function in install.sh', () => {
    const normalizedInstallAgents = installShAgents.map((a) =>
      a.toLowerCase().replace(/\s+/g, '-'),
    );
    for (const entry of AGENT_CONFIGS) {
      expect(normalizedInstallAgents).toContain(entry.agent);
    }
  });

  it('config paths match between install.sh and AGENT_CONFIGS', () => {
    for (const entry of AGENT_CONFIGS) {
      const installShPath = installShPaths.get(entry.agent);
      if (installShPath === undefined) {
        throw new Error(
          `agent "${entry.agent}" not found in install.sh path extraction`,
        );
      }
      expect(entry.configPath).toBe(installShPath);
    }
  });

  it('install.sh config paths all have a matching AGENT_CONFIGS entry', () => {
    for (const [agent, path] of installShPaths) {
      const entry = AGENT_CONFIGS.find((e) => e.agent === agent);
      expect(entry).toBeDefined();
      expect(entry!.configPath).toBe(path);
    }
  });
});
