/**
 * Where each coding agent keeps its MCP config. `install.sh` and `install.ps1`
 * use Codex's own MCP CLI when it exists; that CLI owns the write but persists
 * the same Codex config that the installers edit only as their CLI-absent
 * fallback. `commitlore uninstall` reads this table to decide what it may
 * remove; nothing else in `src/` knows these paths.
 *
 * One table, because two copies of this knowledge drift apart without failing:
 * an installer grows an agent the uninstall never learns about and the entry is
 * left behind, or the table keeps an agent no installer wires and the uninstall
 * reaches for something that was never written. `test/agent-configs.test.ts`
 * asserts this against both installers in both directions.
 */

/**
 * The three shapes the installers write. They are not interchangeable: opencode
 * nests under `mcp` and spells the command as an array, so a recogniser written
 * for `mcpServers` alone leaves an opencode entry behind — silently, because a
 * removal that finds nothing looks exactly like a removal with nothing to do.
 */
export type ConfigFormat = 'toml-mcp_servers' | 'json-mcpServers' | 'json-mcp';

/** Which interface owns registration for this config. */
export type RegistrationPath = 'cli-or-config-fallback' | 'config-file';

export interface AgentConfig {
  /** The name the installers report this agent by. */
  readonly agent: string;
  /** Path segments below the user's home directory. */
  readonly homeRelativePath: readonly string[];
  readonly format: ConfigFormat;
  readonly registration: RegistrationPath;
}

export const AGENT_CONFIGS: readonly AgentConfig[] = [
  {
    agent: 'codex',
    homeRelativePath: ['.codex', 'config.toml'],
    format: 'toml-mcp_servers',
    registration: 'cli-or-config-fallback',
  },
  {
    agent: 'gemini-cli',
    homeRelativePath: ['.gemini', 'settings.json'],
    format: 'json-mcpServers',
    registration: 'config-file',
  },
  {
    agent: 'cursor',
    homeRelativePath: ['.cursor', 'mcp.json'],
    format: 'json-mcpServers',
    registration: 'config-file',
  },
  // Windsurf, under Codeium's config directory. Absent from the ticket's
  // measured inventory, which lists four configs; both installers write five.
  // The bidirectional assertion found it, which is the reason that assertion
  // reads the installers instead of trusting a list.
  {
    agent: 'windsurf',
    homeRelativePath: ['.codeium', 'windsurf', 'mcp_config.json'],
    format: 'json-mcpServers',
    registration: 'config-file',
  },
  {
    agent: 'opencode',
    homeRelativePath: ['.config', 'opencode', 'opencode.json'],
    format: 'json-mcp',
    registration: 'config-file',
  },
];

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

  // { command: <wrapper>, args: ["mcp"] }
  const args = entry['args'];
  return (
    entry['command'] === wrapperPath &&
    Array.isArray(args) &&
    args.length === 1 &&
    args[0] === 'mcp'
  );
};
