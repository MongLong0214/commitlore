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
export const AGENT_CONFIGS = [
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
export const isMcpAgentConfig = (config) => config.kind === 'mcp';
export const isCodexPluginConfig = (config) => config.kind === 'codex-plugin';
/** The key both installers write the server under, in every format. */
export const SERVER_KEY = 'commitlore';
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * Whether an entry is one this install wrote — decided by its shape and by the
 * wrapper it points at, never by the key it sits under.
 *
 * A user may name their own MCP server `commitlore`, and a machine may carry two
 * installs. Removing on a key match would take both, and the config would simply
 * lose a server with nothing to report it. So the command has to match, and it
 * has to be *this* wrapper.
 */
export const isCommitloreEntry = (format, entry, wrapperPath) => {
    if (!isRecord(entry))
        return false;
    if (format === 'json-mcp') {
        // { type: "local", command: [<wrapper>, "mcp"], enabled: true }
        const command = entry['command'];
        return (Array.isArray(command) && command.length === 2 && command[0] === wrapperPath && command[1] === 'mcp');
    }
    // { command: <wrapper>, args: ["mcp"] } — TOML, JSON mcpServers and
    // Hermes' YAML mcp_servers spell this common server shape the same way.
    const args = entry['args'];
    return (entry['command'] === wrapperPath &&
        Array.isArray(args) &&
        args.length === 1 &&
        args[0] === 'mcp');
};
//# sourceMappingURL=agent-configs.js.map