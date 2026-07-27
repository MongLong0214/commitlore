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
 * Failure to start is reported on stderr and exits 2 (SPEC §10: a usage
 * error, matching `commands/mcp.ts`). It cannot be reported on stdout: that
 * stream is the protocol.
 */
import { startStdioServer } from './server.js';
startStdioServer().catch((error) => {
    process.stderr.write(`commitlore mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
});
//# sourceMappingURL=main.js.map