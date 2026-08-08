/**
 * The `mcp-lifecycle` doctor check.
 *
 * It owns interpretation of local MCP lifecycle records because those records
 * describe a separate delivery surface from hooks or their configured builds.
 */
import { type DoctorCheck, type DoctorOptions } from '../model.js';
/**
 * MCP servers that started here and never recorded an exit (#424).
 *
 * A session lost all seven commitlore tools mid-conversation while
 * `claude mcp list` still reported the server connected and no process was
 * running. Nothing on disk could say whether it had ever come up, because the
 * client was not started with `--debug` and the server's stderr went to a pipe.
 *
 * `mcp/lifecycle.ts` now leaves a start and an exit line. A start with neither
 * an exit beside it nor a live process is a server that was killed rather than
 * one that closed its session — which is the observation nobody could make.
 *
 * A `warn`, and only about the past: it says what happened, not that anything
 * is wrong now. Nothing here can restore a lost registration.
 */
export declare const checkMcpLifecycle: (opts: DoctorOptions) => DoctorCheck;
