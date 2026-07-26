/**
 * `commitlore mcp` — serve the consumer routes of SPEC §5 over stdio MCP
 * (T-401).
 *
 * The command writes nothing of its own, ever. stdout carries newline-delimited
 * JSON-RPC frames and a single stray byte on it ends the session; the server
 * (`mcp/server.ts`) is what owns that stream, and this file only hands it over.
 */
import { startStdioServer } from '../mcp/server.js';
export const register = (program) => {
    program
        .command('mcp')
        .description('serve CommitLore over stdio MCP: commitlore://context/<path> and query tools')
        .action(() => {
        startStdioServer().catch((error) => {
            process.stderr.write(`commitlore: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        });
    });
};
//# sourceMappingURL=mcp.js.map