/**
 * Where each coding agent keeps its MCP config, and what `install.sh` and
 * `install.ps1` wrote into it. `commitlore uninstall` reads this to decide what
 * it may remove; nothing else in `src/` knows these paths.
 *
 * One table, because two copies of this knowledge drift apart without failing:
 * an installer grows an agent the uninstall never learns about and the entry is
 * left behind, or the table keeps an agent no installer wires and the uninstall
 * reaches for something that was never written. `test/agent-configs.test.ts`
 * asserts this against both installers in both directions.
 */
export const AGENT_CONFIGS = [
    { agent: 'codex', homeRelativePath: ['.codex', 'config.toml'], format: 'toml-mcp_servers' },
    { agent: 'gemini-cli', homeRelativePath: ['.gemini', 'settings.json'], format: 'json-mcpServers' },
    { agent: 'cursor', homeRelativePath: ['.cursor', 'mcp.json'], format: 'json-mcpServers' },
    // Windsurf, under Codeium's config directory. Absent from the ticket's
    // measured inventory, which lists four configs; both installers write five.
    // The bidirectional assertion found it, which is the reason that assertion
    // reads the installers instead of trusting a list.
    {
        agent: 'windsurf',
        homeRelativePath: ['.codeium', 'windsurf', 'mcp_config.json'],
        format: 'json-mcpServers',
    },
    {
        agent: 'opencode',
        homeRelativePath: ['.config', 'opencode', 'opencode.json'],
        format: 'json-mcp',
    },
];
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
    // { command: <wrapper>, args: ["mcp"] }
    const args = entry['args'];
    return (entry['command'] === wrapperPath &&
        Array.isArray(args) &&
        args.length === 1 &&
        args[0] === 'mcp');
};
//# sourceMappingURL=agent-configs.js.map