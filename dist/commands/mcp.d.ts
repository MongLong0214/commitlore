/**
 * `commitlore mcp` — serve the consumer routes of SPEC §5 over stdio MCP
 * (T-401).
 *
 * The command writes nothing of its own, ever. stdout carries newline-delimited
 * JSON-RPC frames and a single stray byte on it ends the session; the server
 * (`mcp/server.ts`) is what owns that stream, and this file only hands it over.
 */
import type { Command } from 'commander';
export declare const register: (program: Command) => void;
