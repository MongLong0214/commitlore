/**
 * The `mcp-lifecycle` doctor check.
 *
 * It owns interpretation of local MCP lifecycle records because those records
 * describe a separate delivery surface from hooks or their configured builds.
 */

import { crashedRuns, unfinishedRuns } from '../../../mcp/lifecycle.js';
import { check, type Category, type DoctorCheck, type DoctorContext } from '../model.js';

/**
 * MCP servers that crashed here, or started here and never recorded an exit
 * (#424, #506).
 *
 * A session lost all seven commitlore tools mid-conversation while
 * `claude mcp list` still reported the server connected and no process was
 * running. Nothing on disk could say whether it had ever come up, because the
 * client was not started with `--debug` and the server's stderr went to a pipe.
 *
 * `mcp/lifecycle.ts` now leaves a start and an exit line. A `crashed:` exit
 * says the process died and why; a start with neither an exit beside it nor a
 * live process is a server that was killed rather than one that closed its
 * session — the observations nobody could make before.
 *
 * A `warn`, and only about the past: it says what happened, not that anything
 * is wrong now. Nothing here can restore a lost registration.
 */
export const checkMcpLifecycle = (ctx: DoctorContext): DoctorCheck => {
  const title = 'MCP server sessions';
  const id = 'mcp-lifecycle';
  const category: Category = 'delivery';
  const cwd = ctx.opts.cwd ?? process.cwd();
  const crashed = crashedRuns(cwd);
  const unfinished = unfinishedRuns(cwd);

  if (crashed.length === 0 && unfinished.length === 0) {
    return check(
      id,
      category,
      title,
      'ok',
      'every recorded MCP session ended cleanly, or is still running',
      null,
      false,
      undefined,
      { evidence: { unfinished_count: '0', last_pid: 'none', last_at: 'none' } },
    );
  }

  if (crashed.length > 0) {
    const last = crashed[crashed.length - 1];
    const cause = last?.detail.slice('crashed: '.length) || 'unknown error';
    const unfinishedDetail =
      unfinished.length === 0
        ? ''
        : ` ${unfinished.length} more session(s) started but never recorded an exit.`;
    return check(
      id,
      category,
      title,
      'warn',
      `${crashed.length} MCP server session(s) crashed — most recently pid ${String(last?.pid ?? 0)} ` +
        `at ${last?.at ?? 'unknown'}: ${cause}.${unfinishedDetail}`,
      'restart the client session; if this repeats, capture it with a client started under --debug',
      false,
      undefined,
      {
        evidence: {
          crash_count: String(crashed.length),
          last_crash_pid: String(last?.pid ?? 0),
          last_crash_at: last?.at ?? 'unknown',
          last_crash_cause: cause,
          unfinished_count: String(unfinished.length),
        },
      },
    );
  }

  const last = unfinished[unfinished.length - 1];
  return check(
    id,
      category,
    title,
    'warn',
    `${unfinished.length} MCP server session(s) started here and never recorded an exit — ` +
      `most recently pid ${String(last?.pid ?? 0)} at ${last?.at ?? 'unknown'}. ` +
      'A killed server loses its tool registration in the client, which reports the same as a tool that never existed (#424)',
    'restart the client session; if this repeats, capture it with a client started under --debug',
    false,
    undefined,
    {
      evidence: {
        unfinished_count: String(unfinished.length),
        last_pid: String(last?.pid ?? 0),
        last_at: last?.at ?? 'unknown',
      },
    },
  );
};
