/**
 * Where each coding agent installation stores the state `install.sh` and
 * `install.ps1` create. Codex's direct MCP registration uses its own CLI when
 * possible and a config-file fallback otherwise; its plugin uses the separate
 * client-owned plugin API. `commitlore uninstall` reads this table to decide
 * what it may remove; nothing else in `src/` knows these paths or selectors.
 *
 * One table, because two copies of this knowledge drift apart without failing:
 * an installer grows an agent the uninstall never learns about and the entry is
 * left behind, or the table keeps an agent no installer wires and the uninstall
 * reaches for something that was never written. `test/agent-configs.test.ts`
 * asserts this against both installers in both directions.
 */

/**
 * The four MCP shapes the installers write. They are not interchangeable:
 * opencode nests under `mcp` and spells the command as an array, so a recogniser
 * written for `mcpServers` alone leaves an opencode entry behind — silently,
 * because a removal that finds nothing looks exactly like a removal with
 * nothing to do.
 */
export type ConfigFormat = 'toml-mcp_servers' | 'json-mcpServers' | 'json-mcp' | 'yaml-mcp_servers';

/** Which interface owns registration for this config. */
export type RegistrationPath = 'cli-or-config-fallback' | 'config-file';

export interface McpAgentConfig {
  readonly kind: 'mcp';
  /** The name the installers report this agent by. */
  readonly agent: string;
  /** Path segments below the user's home directory. */
  readonly homeRelativePath: readonly string[];
  readonly format: ConfigFormat;
  readonly registration: RegistrationPath;
}

/**
 * Codex owns the plugin cache and marketplace, so the plugin route uses its
 * CLI rather than edit either. The marker is ours: it is the only proof that
 * this installer — rather than a user — installed this plugin, and it is what
 * makes removal conservative and repeatable.
 */
export interface CodexPluginConfig {
  readonly kind: 'codex-plugin';
  readonly agent: 'codex';
  readonly marketplace: string;
  readonly plugin: string;
  readonly marketplaceSource: string;
  /** Relative to the platform's CLI data directory. */
  readonly dataRelativePath: readonly string[];
}

export type AgentConfig = McpAgentConfig | CodexPluginConfig;

export const AGENT_CONFIGS: readonly AgentConfig[] = [
  {
    kind: 'mcp',
    agent: 'codex',
    homeRelativePath: ['.codex', 'config.toml'],
    format: 'toml-mcp_servers',
    registration: 'cli-or-config-fallback',
  },
  {
    kind: 'codex-plugin',
    agent: 'codex',
    marketplace: 'commitlore',
    plugin: 'commitlore',
    marketplaceSource: 'MongLong0214/commitlore',
    dataRelativePath: ['commitlore', 'codex-plugin.json'],
  },
  {
    kind: 'mcp',
    agent: 'gemini-cli',
    homeRelativePath: ['.gemini', 'settings.json'],
    format: 'json-mcpServers',
    registration: 'config-file',
  },
  {
    kind: 'mcp',
    agent: 'cursor',
    homeRelativePath: ['.cursor', 'mcp.json'],
    format: 'json-mcpServers',
    registration: 'config-file',
  },
  {
    kind: 'mcp',
    agent: 'hermes',
    homeRelativePath: ['.hermes', 'config.yaml'],
    format: 'yaml-mcp_servers',
    registration: 'config-file',
  },
  // Windsurf, under Codeium's config directory. Absent from the ticket's
  // measured inventory, which lists four configs; both installers write five.
  // The bidirectional assertion found it, which is the reason that assertion
  // reads the installers instead of trusting a list.
  {
    kind: 'mcp',
    agent: 'windsurf',
    homeRelativePath: ['.codeium', 'windsurf', 'mcp_config.json'],
    format: 'json-mcpServers',
    registration: 'config-file',
  },
  {
    kind: 'mcp',
    agent: 'opencode',
    homeRelativePath: ['.config', 'opencode', 'opencode.json'],
    format: 'json-mcp',
    registration: 'config-file',
  },
];

export const isMcpAgentConfig = (config: AgentConfig): config is McpAgentConfig => config.kind === 'mcp';

export const isCodexPluginConfig = (config: AgentConfig): config is CodexPluginConfig =>
  config.kind === 'codex-plugin';

/** The key both installers write the server under, in every format. */
export const SERVER_KEY = 'commitlore';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether an entry is one this install wrote — decided by its shape and by the
 * wrapper it points at, never by the key it sits under.
 *
 * A user may name their own MCP server `commitlore`, and a machine may carry two
 * installs. Removing on a key match would take both, and the config would simply
 * lose a server with nothing to report it. So the command has to match, and it
 * has to be *this* wrapper.
 */
export const isCommitloreEntry = (
  format: ConfigFormat,
  entry: unknown,
  wrapperPath: string,
): boolean => {
  if (!isRecord(entry)) return false;

  if (format === 'json-mcp') {
    // { type: "local", command: [<wrapper>, "mcp"], enabled: true }
    const command = entry['command'];
    return (
      Array.isArray(command) && command.length === 2 && command[0] === wrapperPath && command[1] === 'mcp'
    );
  }

  // { command: <wrapper>, args: ["mcp"] } — TOML, JSON mcpServers and
  // Hermes' YAML mcp_servers spell this common server shape the same way.
  const args = entry['args'];
  return (
    entry['command'] === wrapperPath &&
    Array.isArray(args) &&
    args.length === 1 &&
    args[0] === 'mcp'
  );
};
