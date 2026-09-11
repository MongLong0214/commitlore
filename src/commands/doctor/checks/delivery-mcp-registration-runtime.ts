/**
 * The `mcp-registration-runtime` doctor check.
 *
 * Whether the command `.mcp.json` registers can actually be launched from the
 * environment a host gives it — not whether the file says the right words.
 *
 * A user reported `CONNECTION_CLOSED` for a project-scoped CommitLore server
 * while their CLI worked. Their tools then resolved to a different, already
 * running CommitLore server owned by another process, which answered about a
 * different repository, and every field of every answer was internally
 * consistent. Measured: `.mcp.json` registers the bare name `commitlore`,
 * `command -v commitlore` finds it in an interactive shell, and under
 * `PATH=/usr/bin:/bin` — roughly what a GUI- or daemon-launched host inherits —
 * it is not found at all. The repository's own `mcp-lifecycle.log` carried
 * `started` lines for older versions and none for the installed one, which is
 * the signature of a binary that was never executed: `recordServerStart` runs
 * inside the server, so a spawn that fails leaves nothing behind anywhere.
 *
 * **The bare name is not the defect.** `.mcp.json` is committed, and
 * `core/mcp-registration.ts` says in as many words why an absolute path is
 * refused there: it would break for the next clone. A machine-local path in a
 * shared file trades one host's PATH miss for a guaranteed miss on every other
 * machine, which is worse. The registration is portable on purpose.
 *
 * What was missing is that nothing ever checked the pairing. `hooks install`
 * has had this for its own hook since #910 — `capture-hook-runtime` executes the
 * installed hook under a PATH carrying no node, because that is the environment
 * git really gives it — and the same question was never asked of the MCP
 * registration. So this asks it the same way, and reports an exposure rather
 * than rewriting a shared file to suit one machine.
 *
 * `warn`, not `fail`: the host may be launched from a shell that does carry the
 * directory, in which case nothing is broken today. What the row buys is that
 * the failure stops being silent — a server that never starts writes no log, and
 * the tools quietly answer from somewhere else.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MCP_REGISTRATION_FILE,
  MCP_SERVER_COMMAND,
} from '../../../core/mcp-registration.js';
import { check, type DoctorCheck, type DoctorContext } from '../model.js';

/**
 * The PATH a host that was not started from a shell inherits. The same constant
 * `capture-hook-runtime` probes hooks with, for the same reason: it is the
 * environment the failure actually happens in, and an interactive PATH is the one
 * environment where it never does.
 */
const HOST_PATH = '/usr/bin:/bin';

/** The command this repository's registration names, or null if it names none. */
const registeredCommand = (cwd: string): string | null => {
  const path = join(cwd, MCP_REGISTRATION_FILE);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (typeof servers !== 'object' || servers === null) return null;
  const entry = (servers as Record<string, unknown>)['commitlore'];
  if (typeof entry !== 'object' || entry === null) return null;
  const command = (entry as { command?: unknown }).command;
  return typeof command === 'string' && command !== '' ? command : null;
};

/** Whether this operator's own environment can find the command. */
const resolvesHere = (command: string, cwd: string): boolean => {
  const probe = spawnSync('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command], {
    shell: false,
    cwd,
  });
  return probe.error === undefined && probe.status === 0;
};

/** Whether a host-like environment can find the command at all. */
const resolvesOnHostPath = (command: string, cwd: string): boolean => {
  const probe = spawnSync('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command], {
    shell: false,
    cwd,
    env: { PATH: HOST_PATH },
  });
  return probe.error === undefined && probe.status === 0;
};

export const checkMcpRegistrationRuntime = (ctx: DoctorContext): DoctorCheck => {
  const id = 'mcp-registration-runtime';
  const title = 'MCP registration runtime';
  const cwd = ctx.opts.cwd ?? process.cwd();

  const command = registeredCommand(cwd);
  if (command === null) {
    return check(
      id,
      'delivery',
      title,
      'ok',
      `no ${MCP_REGISTRATION_FILE} registers commitlore here — nothing to launch, so nothing to check`,
      null,
      false,
      undefined,
      { evidence: { registered_command: 'none' } },
    );
  }

  // An absolute path is a legitimate registration and resolves without a PATH at
  // all; only a name has to be found.
  const isPath = command.includes('/');
  if (isPath) {
    const runnable = existsSync(command);
    return check(
      id,
      'delivery',
      title,
      runnable ? 'ok' : 'warn',
      runnable
        ? `${MCP_REGISTRATION_FILE} registers an absolute path that exists, so the host launches it without needing a PATH`
        : `${MCP_REGISTRATION_FILE} registers ${command}, which does not exist on this machine. A host cannot launch it, ` +
          `and a server that never starts writes no log — its tools answer from whatever other CommitLore server is running`,
      runnable ? null : `register a path that exists here, or the portable name ${MCP_SERVER_COMMAND} with its directory on the host's PATH`,
      false,
      undefined,
      { evidence: { registered_command: command, resolves: String(runnable) } },
    );
  }

  const onHostPath = resolvesOnHostPath(command, cwd);
  const here = resolvesHere(command, cwd);
  const evidence = {
    registered_command: command,
    host_path: HOST_PATH,
    resolves_on_host_path: String(onHostPath),
    resolves_here: String(here),
  };

  /*
   * Not resolvable anywhere is the only definite fault, and it is the one worth
   * interrupting for: no environment on this machine can launch the server.
   */
  if (!here && !onHostPath) {
    return check(
      id,
      'delivery',
      title,
      'warn',
      `${MCP_REGISTRATION_FILE} registers "${command}", and nothing on this machine can find it — not a `+
        `host started with PATH=${HOST_PATH}, and not this shell either. A host cannot spawn the server, `+
        `and a server that never starts writes no lifecycle entry, so the failure leaves no trace beyond `+
        `the host's own connection error`,
      `install commitlore so that "${command}" resolves, or register a command that does`,
      false,
      undefined,
      { evidence },
    );
  }

  /*
   * Resolvable here but not on a bare system PATH is the ordinary shape of a
   * correct install -- `~/.local/bin` is never on `/usr/bin:/bin` -- so warning
   * would fire on every healthy repository and teach the reader to skip the row,
   * which is the failure #925 fixed in the squash row. It is still worth stating:
   * it is the first thing to check when a host reports a closed connection, and a
   * row nobody can act on is different from a fact nobody can find.
   */
  if (!onHostPath) {
    return check(
      id,
      'delivery',
      title,
      'ok',
      `${MCP_REGISTRATION_FILE} registers "${command}", which this shell resolves. A host started without `+
        `a shell PATH -- an editor or a daemon, roughly PATH=${HOST_PATH} -- would not, and would report a `+
        `closed connection with nothing in the lifecycle log, because the server never runs. Hosts started `+
        `from a shell are unaffected`,
      null,
      false,
      undefined,
      { evidence },
    );
  }

  return check(
    id,
    'delivery',
    title,
    'ok',
    `${MCP_REGISTRATION_FILE} registers "${command}", and even a host started with no shell PATH can find it`,
    null,
    false,
    undefined,
    { evidence },
  );
};
