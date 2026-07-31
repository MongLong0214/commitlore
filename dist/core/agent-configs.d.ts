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
/**
 * The three shapes the installers write. They are not interchangeable: opencode
 * nests under `mcp` and spells the command as an array, so a recogniser written
 * for `mcpServers` alone leaves an opencode entry behind — silently, because a
 * removal that finds nothing looks exactly like a removal with nothing to do.
 */
export type ConfigFormat = 'toml-mcp_servers' | 'json-mcpServers' | 'json-mcp';
export interface AgentConfig {
    /** The name the installers report this agent by. */
    readonly agent: string;
    /** Path segments below the user's home directory. */
    readonly homeRelativePath: readonly string[];
    readonly format: ConfigFormat;
}
export declare const AGENT_CONFIGS: readonly AgentConfig[];
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
