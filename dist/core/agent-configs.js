/**
 * The single source of agent MCP configuration paths.
 *
 * Every path here MUST agree with `install.sh`'s `wire_*` functions — the
 * bidirectional agreement test in `test/agent-configs.test.ts` enforces this.
 *
 * Config formats:
 * - `json-mcpServers`: top-level `{ "mcpServers": { "<name>": ... } }` (Gemini CLI, Cursor, Windsurf)
 * - `json-mcp`: top-level `{ "mcp": { "<name>": ... } }` (opencode)
 * - `toml-mcp_servers`: TOML `[mcp_servers.<name>]` block (Codex)
 * - `claude-plugin`: Claude Code plugin system (not a config file)
 */
/**
 * The canonical table of agent configs that `install.sh` writes to.
 *
 * Order matches install.sh's iteration order. Each entry mirrors
 * the corresponding `wire_*` function.
 */
export const AGENT_CONFIGS = [
    {
        agent: 'claude-code',
        configPath: null,
        format: 'claude-plugin',
        entryKey: 'commitlore',
    },
    {
        agent: 'codex',
        configPath: '.codex/config.toml',
        format: 'toml-mcp_servers',
        entryKey: 'commitlore',
    },
    {
        agent: 'gemini-cli',
        configPath: '.gemini/settings.json',
        format: 'json-mcpServers',
        entryKey: 'commitlore',
    },
    {
        agent: 'cursor',
        configPath: '.cursor/mcp.json',
        format: 'json-mcpServers',
        entryKey: 'commitlore',
    },
    {
        agent: 'windsurf',
        configPath: '.codeium/windsurf/mcp_config.json',
        format: 'json-mcpServers',
        entryKey: 'commitlore',
    },
    {
        agent: 'opencode',
        configPath: '.config/opencode/opencode.json',
        format: 'json-mcp',
        entryKey: 'commitlore',
    },
];
/**
 * Resolve a config path relative to a home directory.
 * Returns `null` for agents that don't use a config file.
 */
export const resolveConfigPath = (entry, home) => {
    if (entry.configPath === null)
        return null;
    return `${home}/${entry.configPath}`;
};
//# sourceMappingURL=agent-configs.js.map