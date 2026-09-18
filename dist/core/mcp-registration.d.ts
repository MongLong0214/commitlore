/**
 * MCP registration, at whichever scope the operator chose.
 *
 * A host keeps MCP configuration at more than one scope, and which one is
 * right is a property of the situation rather than of this tool: a solo
 * machine wants one registration covering every repository, a team wants one
 * the repository carries, and a shared machine wants one private to the person
 * sitting at it. `init` asks; this module writes whichever answer it gets.
 *
 * The two halves are written by different authors on purpose.
 *
 * **`project`** is `.mcp.json`, written here. It is a repository file, so the
 * command is the portable `commitlore mcp` pair — the same PATH-based route
 * the installed Git hooks use after their per-machine pin, never an absolute
 * path to the machine that happened to run `init`, which would break for the
 * next clone. Writing it here rather than through a host CLI is deliberate:
 * this writer merges without disturbing other servers, refuses to overwrite an
 * entry somebody chose, and works for a host that ships no CLI at all.
 *
 * **`user`** and **`local`** live in the host's own private configuration, and
 * this module does not write that. The format belongs to the host and has
 * already changed shape once; a second writer for it is a guess that goes
 * stale without saying so. Those two shell out to the host's CLI — the one
 * component contractually able to write its own file — and report exactly what
 * it was asked and exactly what it answered.
 */
/** The conventional repository configuration a repository-scoped host reads. */
export declare const MCP_REGISTRATION_FILE = ".mcp.json";
/** The key, command, and argv registered by `commitlore init`. */
export declare const MCP_SERVER_KEY = "commitlore";
export declare const MCP_SERVER_COMMAND = "commitlore";
export declare const MCP_SERVER_ARGS: readonly ["mcp"];
/**
 * `${VAR}` and `${VAR:-default}`, expanded the way a host expands them before
 * it launches the server.
 *
 * A registration is a launch instruction for a host, and the hosts that read
 * this file substitute environment placeholders in `command` and `args` first —
 * which is what lets one committed file name a path that only the host knows,
 * `${CLAUDE_PLUGIN_ROOT}` being the one this repository's own registration uses
 * (#870). Every reader here answers questions about that launch: what command a
 * host will run, whether it is ours, and — in doctor's unattended-initiator
 * check — whether it actually answers an MCP initialize. Reading the raw text
 * answered those questions about a command no host ever runs, and the probe
 * spawned the literal `${...}` as a path.
 *
 * An unset placeholder with no default is left as written rather than expanded
 * to nothing. A host refuses that registration outright, and `""/dist/x.mjs`
 * would turn the refusal into a plausible-looking path whose failure names a
 * file nobody wrote.
 */
export declare const expandHostPlaceholders: (value: string) => string;
/**
 * The command a registration under our key names, or null when there is none a
 * host could launch.
 *
 * Exposed because "there is a command here" and "that command is this tool" are
 * different facts, and doctor was reporting the first as though it were the
 * second: `{"command": "false"}` read as a working capture server.
 */
export declare const registeredMcpCommand: (cwd: string) => string | null;
/**
 * The complete launch command a host will use, when its argv is parseable, with
 * `${VAR}` placeholders expanded as the host would expand them.
 */
export declare const registeredMcpLaunch: (cwd: string) => {
    command: string;
    args: string[];
} | null;
/**
 * Whether the registered command is the one `init` writes.
 *
 * Not a probe — nothing is executed here. It answers the narrower question the
 * report needs: is this the entry this tool wrote, or something an operator
 * chose that this tool cannot vouch for?
 */
export declare const registrationIsOurs: (cwd: string) => boolean;
/** Absolute repository registration path, or null outside a repository. */
export declare const mcpRegistrationPath: (cwd: string) => string | null;
/**
 * Whether the repository advertises this server at all. Registration is not
 * proof that a host loaded it or invoked a tool; doctor reports that distinction
 * separately. Keeping this reader beside the writer stops their file/key
 * interpretation from drifting apart.
 */
export declare const registersCommitloreMcpServer: (cwd: string) => boolean;
/** Where Claude Code keeps a user-scope MCP registration. */
export declare const hostConfigPath: (home: string) => string;
/**
 * Whether this user's host config registers the server at user scope (#1079).
 *
 * A file read rather than `claude mcp list`, because doctor answers locally and
 * offline and shelling out to the host CLI would make a row's verdict depend on
 * that CLI being installed and healthy -- which is a different question from the
 * one being asked.
 *
 * Absence is reported as `false` and never as an error: a machine with no host
 * config has no user-scope registration, which is a complete answer.
 */
export declare const hostRegistersCommitlore: (home: string) => boolean;
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
/**
 * Where a registration is written.
 *
 * The three writable names are the host's own, not ours — `claude mcp add
 * --scope` takes exactly `local`, `user` and `project` — so an operator who
 * knows one vocabulary does not have to learn a second. `none` is this tool's
 * addition and writes nothing.
 */
export type McpScope = 'user' | 'project' | 'local' | 'none';
export declare const MCP_SCOPES: readonly McpScope[];
/** The scopes the host's own CLI owns. `project` is written by this module. */
export type HostOwnedScope = 'user' | 'local';
export declare const isMcpScope: (value: string) => value is McpScope;
/** The host CLI that owns `user` and `local` configuration. */
export declare const MCP_HOST_CLI = "claude";
/**
 * The exact command line a host-owned registration runs.
 *
 * Exposed because every report about this path prints it. A reader who is told
 * a registration failed can only act on it if they can run the same thing by
 * hand, and a paraphrase is not the same thing.
 */
export declare const hostRegistrationCommand: (scope: HostOwnedScope) => string;
export interface HostRegistrationResult {
    ok: boolean;
    scope: HostOwnedScope;
    state: 'registered' | 'already-registered' | 'host-missing' | 'host-failed';
    /** The command line attempted, verbatim, so a reader can repeat it. */
    command: string;
    /** The host's own words when it refused. Never a paraphrase of them. */
    error: string | null;
}
/**
 * Register at a host-owned scope by asking the host to do it.
 *
 * Measured, because the exit codes do not separate what a caller needs to
 * separate: `claude mcp add` exits 0 on a fresh add and **1** both when the
 * name already exists and when it genuinely refuses. The only difference
 * between those two is prose — "MCP server commitlore already exists in user
 * config" — and matching a message is matching a rendering, which changes
 * without notice.
 *
 * So the second question is asked separately, in a form whose answer is an
 * exit code: `claude mcp get commitlore` succeeds when something answers to
 * the name. A re-run of `init` is then `already-registered` rather than a
 * failure, which is what idempotence requires, and a real refusal still
 * carries the host's own output to the reader.
 */
export declare const registerWithHost: (scope: HostOwnedScope, cwd: string) => HostRegistrationResult;
