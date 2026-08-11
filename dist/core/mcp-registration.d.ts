/**
 * Repository-scoped MCP registration.
 *
 * `.mcp.json` is deliberately a repository file, not an edit to a host's
 * private configuration. It lets a host that elects to load repository MCP
 * configuration discover CommitLore's capture tools after a clone, while
 * leaving hosts that keep their configuration elsewhere alone.
 *
 * The command is the portable `commitlore mcp` pair. It is the same PATH-based
 * resolution route the installed Git hooks use after their per-machine pin,
 * rather than an absolute path to the machine that happened to run `init`.
 * Because this file is committed, such a path would break for the next clone.
 */
/** The conventional repository configuration a repository-scoped host reads. */
export declare const MCP_REGISTRATION_FILE = ".mcp.json";
/** The key, command, and argv registered by `commitlore init`. */
export declare const MCP_SERVER_KEY = "commitlore";
export declare const MCP_SERVER_COMMAND = "commitlore";
export declare const MCP_SERVER_ARGS: readonly ["mcp"];
/** Absolute repository registration path, or null outside a repository. */
export declare const mcpRegistrationPath: (cwd: string) => string | null;
/**
 * Whether the repository advertises this server at all. Registration is not
 * proof that a host loaded it or invoked a tool; doctor reports that distinction
 * separately. Keeping this reader beside the writer stops their file/key
 * interpretation from drifting apart.
 */
export declare const registersCommitloreMcpServer: (cwd: string) => boolean;
export interface McpRegistrationSuccess {
    ok: true;
    /** Absolute path that was inspected or written. */
    path: string;
    /** Whether a new file was created, an existing one was merged, or it was already present. */
    state: 'created' | 'merged' | 'already-registered';
    /** False only when the repository already held its own entry. */
    changed: boolean;
}
export interface McpRegistrationFailure {
    ok: false;
    /** Null only when `cwd` was not inside a Git repository. */
    path: string | null;
    /** The named reason the existing file was left untouched. */
    error: string;
}
export type McpRegistrationResult = McpRegistrationSuccess | McpRegistrationFailure;
/**
 * Register CommitLore without ever replacing an entry an operator already
 * chose. A malformed or incompatible file is left untouched and returned as a
 * named failure for `init` to report without making the installation unusable.
 */
export declare const registerCommitloreMcpServer: (cwd: string) => McpRegistrationResult;
