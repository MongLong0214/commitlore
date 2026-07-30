/**
 * The stdio MCP server (T-401) — SPEC §5's consumer routes, addressed by an
 * agent instead of a shell.
 *
 * ## One answer, not two
 *
 * The resource and `commitlore_query` return what `commitlore context --json`
 * returns, because two renderings of one answer become two answers the moment
 * one of them is edited. `toJson` is therefore imported from
 * `commands/query.ts` rather than re-derived here, even though it means this
 * module reaches sideways into the CLI layer. `commitlore_stale` does the same
 * with `buildReport` from `commands/stale.ts`.
 *
 * There is exactly one deliberate divergence, and it is named rather than
 * quietly introduced: a record graded `blocked` keeps its identity here and
 * loses its payload (`withheldBlocked`). The CLI prints that payload because a
 * person is reading it and can disbelieve it; a tool result is read by a model
 * as retrieved fact. Anything beyond this one rule belongs in `toJson`, where
 * both routes get it.
 *
 * ## stdout belongs to the protocol
 *
 * A stdio server speaks newline-delimited JSON-RPC on stdout. One stray
 * `console.log` — from this code, a dependency, or a native module's warning —
 * lands in the middle of a frame, and the client disconnects with a parse error
 * that names none of them. `startStdioServer` rebinds the console's
 * stdout-bound methods onto stderr before it connects, and every diagnostic
 * this module writes goes to stderr by hand.
 *
 * ## The low-level `Server`, not `McpServer`
 *
 * `McpServer.registerTool` takes a Zod schema, and Zod is not a dependency of
 * this package — it arrives only underneath the SDK. Declaring tools in the
 * wire's own JSON Schema keeps that transitive package out of our imports, and
 * keeps the schema in this file byte-identical to the one the client is handed.
 *
 * ## Nothing leaves the machine
 *
 * Every answer comes from `git` and the local index, and the repository is the
 * process's own working directory. There is no network client here, and
 * `test/mcp.test.ts` asserts the absence rather than trusting it.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
export declare const SERVER_NAME = "commitlore";
/** The four consumer routes of SPEC §5, under the names the CLI uses. */
export declare const QUERY_KINDS: readonly ["context", "limits", "ruled-out", "warnings"];
export type QueryKind = (typeof QUERY_KINDS)[number];
export declare const QUERY_TOOL = "commitlore_query";
export declare const STALE_TOOL = "commitlore_stale";
export declare const GUARD_TOOL = "commitlore_guard";
export declare const BEFORE_CHANGE_TOOL = "commitlore_before_change";
/**
 * `commitlore://context/<path>`. The template form uses RFC 6570 reserved
 * expansion (`{+path}`) so a client fills it with a real path rather than one
 * whose separators have been percent-escaped into a single opaque segment —
 * though `readContext` accepts either.
 */
export declare const CONTEXT_URI_PREFIX = "commitlore://context/";
export declare const CONTEXT_URI_TEMPLATE = "commitlore://context/{+path}";
export interface McpServerOptions {
    /** The repository to answer about. Defaults to the process's own directory. */
    cwd?: string;
}
/**
 * Turns a caller-supplied path into one this server will answer about, or
 * throws.
 *
 * The repository root is the process's working directory (T-401), so a path
 * that resolves outside it is not a query this server can answer — it is a
 * request to read somewhere else, and `..` is all it takes to write one. The
 * check is on the *resolved* path rather than on the presence of `..`, so
 * `src/../src` is allowed (it names the repository) while `../other` is not.
 *
 * The empty string and `.` both mean the whole repository, which is what
 * `runQuery` already understands them to mean.
 */
export declare const resolveRepoPath: (root: string, raw: string) => string;
/**
 * The path inside a `commitlore://context/...` URI.
 *
 * Matching the prefix literally, rather than parsing the URI, is what keeps a
 * host that differs only in case (`commitlore://Context/...`, which WHATWG
 * parsing preserves for a non-special scheme) from being served as if it were
 * the resource this server declares.
 */
export declare const contextUriPath: (uri: string) => string;
/**
 * Builds the server, wired to one repository.
 *
 * A tool that fails on its input answers with `isError`, not with a JSON-RPC
 * error: the protocol reserves error responses for failures in *finding* the
 * tool, and a model that never sees the message cannot correct the call that
 * caused it. A request naming a tool that does not exist is the other case, and
 * throws.
 */
export declare const createServer: (opts?: McpServerOptions) => Server;
/** Connects the server to this process's stdin/stdout. Resolves once listening. */
export declare const startStdioServer: (opts?: McpServerOptions) => Promise<Server>;
