/**
 * `commitlore mcp` — serve the consumer routes of SPEC §5 over stdio MCP
 * (T-401).
 *
 * The command writes nothing of its own, ever. stdout carries newline-delimited
 * JSON-RPC frames and a single stray byte on it ends the session; the server
 * (`mcp/server.ts`) is what owns that stream, and this file only hands it over.
 *
 * A server that never started is a usage error, not a finding (SPEC §10): the
 * findings this server has to report live inside the JSON-RPC frames it never
 * got to send.
 */

import type { Command } from 'commander';

import { startStdioServer } from '../mcp/server.js';

export const register = (program: Command): void => {
  program
    .command('mcp')
    .description('serve CommitLore over stdio MCP: commitlore://context/<path> and query tools')
    .addHelpText('after', '\nExit codes: 0 the session ended cleanly, 2 the server could not start (SPEC §10).')
    .action(() => {
      startStdioServer().catch((error: unknown) => {
        process.stderr.write(
          `commitlore: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 2;
      });
    });
};
