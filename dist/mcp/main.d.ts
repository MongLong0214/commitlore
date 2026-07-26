#!/usr/bin/env node
/**
 * The stdio MCP server as a process of its own: `node dist/mcp/main.js`.
 *
 * `commitlore mcp` (`commands/mcp.ts`) is the supported way to start it, and
 * both call the same `startStdioServer`. This entry exists because an MCP
 * client configuration is a bare argv — a client that would rather point at a
 * file than at a subcommand can, and the test suite can spawn the server
 * without depending on how the CLI happens to be wired.
 *
 * Failure to start is reported on stderr and exits non-zero. It cannot be
 * reported on stdout: that stream is the protocol.
 */
export {};
