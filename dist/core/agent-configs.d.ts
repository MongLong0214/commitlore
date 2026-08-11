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
export declare const AGENT_CONFIGS: readonly AgentConfig[];
export declare const isMcpAgentConfig: (config: AgentConfig) => config is McpAgentConfig;
export declare const isCodexPluginConfig: (config: AgentConfig) => config is CodexPluginConfig;
/** The key both installers write the server under, in every format. */
export declare const SERVER_KEY = "commitlore";
/**
 * Whether an entry is one this install wrote — decided by its shape and by the
 * wrapper it points at, never by the key it sits under.
 *
 * A user may name their own MCP server `commitlore`, and a machine may carry two
 * installs. Removing on a key match would take both, and the config would simply
 * lose a server with nothing to report it. So the command has to match, and it
 * has to be *this* wrapper.
 */
export declare const isCommitloreEntry: (format: ConfigFormat, entry: unknown, wrapperPath: string) => boolean;
