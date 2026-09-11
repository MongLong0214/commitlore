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
import { isAbsolute, join } from 'node:path';

import {
  MCP_REGISTRATION_FILE,
  MCP_SERVER_COMMAND,
  expandHostPlaceholders,
} from '../../../core/mcp-registration.js';
import { check, type DoctorCheck, type DoctorContext } from '../model.js';

/**
 * The PATH a host that was not started from a shell inherits. The same constant
 * `capture-hook-runtime` probes hooks with, for the same reason: it is the
 * environment the failure actually happens in, and an interactive PATH is the one
 * environment where it never does.
 */
const HOST_PATH = '/usr/bin:/bin';

/** What this repository's registration tells a host to launch, or null if nothing. */
const registeredLaunch = (cwd: string): { command: string; args: string[] } | null => {
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
  if (typeof command !== 'string' || command === '') return null;
  const rawArgs = (entry as { args?: unknown }).args;
  const args = Array.isArray(rawArgs) ? rawArgs.filter((a): a is string => typeof a === 'string') : [];
  return { command, args };
};

/**
 * The file the launch actually loads, if the registration names one.
 *
 * `command` resolving is not the same question as the launch working, and the
 * first version of this check only asked the first one. The failure it was
 * written for is the second: the plugin registration runs `node` -- which always
 * resolves -- against an entry point that did not exist, and the server died in
 * 75ms with MODULE_NOT_FOUND before anything of ours ran. A check that asked only
 * about `node` would have called that registration healthy.
 */
const entryPoint = (args: readonly string[]): string | null =>
  args.find((arg) => /\.(mjs|js|cjs)$/.test(arg)) ?? null;

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

  const launch = registeredLaunch(cwd);
  if (launch === null) {
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

  const { command, args } = launch;

  /*
   * The entry point first, because it is the half that actually failed in the
   * field and the half a command-only check calls healthy.
   *
   * `.mcp.json` named `${CLAUDE_PLUGIN_ROOT:-.}/dist/commitlore.mjs`. When the
   * host did not set that variable the `:-.` default resolved to the session's
   * working directory, so node was asked for `<the user's repo>/dist/commitlore.mjs`
   * and exited in 75ms with MODULE_NOT_FOUND -- which is #870 exactly, preserved
   * by the default that was added while fixing it. The registration names no
   * default now, so an unexpanded placeholder is refused by the host instead of
   * being turned into a plausible wrong path, and this row says so either way.
   */
  const rawEntry = entryPoint(args);
  if (rawEntry !== null) {
    /*
     * Expanded the way a host expands it, through the reader the rest of this
     * project uses. The first version of this branch matched `${VAR}` with a
     * regex and reported it unset without ever reading the environment, so a
     * session that *did* set the variable got a warning it could not clear --
     * the #925 shape, rebuilt minutes after it was removed elsewhere. It also
     * never matched the `${VAR:-default}` form that COMPATIBILITY.md still
     * prints, and resolved relative paths against the process rather than the
     * repository under examination.
     */
    const entry = expandHostPlaceholders(rawEntry);
    const unexpanded = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/.exec(entry);
    if (unexpanded !== null) {
      return check(
        id,
        'delivery',
        title,
        'warn',
        `${MCP_REGISTRATION_FILE} launches ${rawEntry}, and ${unexpanded[0]} is unset here. A host that sets ` +
          `it launches the server normally; one that does not is refused the registration outright, which is ` +
          `the intended failure — it names the variable instead of resolving to a path nobody wrote`,
        `set ${unexpanded[0]} for the host, or register a command that does not depend on it`,
        false,
        undefined,
        { evidence: { registered_command: command, entry_point: rawEntry, entry_resolves: 'unexpanded' } },
      );
    }
    const resolved = isAbsolute(entry) ? entry : join(cwd, entry);
    if (!existsSync(resolved)) {
      return check(
        id,
        'delivery',
        title,
        'warn',
        `${MCP_REGISTRATION_FILE} launches ${resolved}, which does not exist. The host spawns ${command}, node ` +
          `fails to find the module, and the server exits before any of this tool runs — so it writes no ` +
          `lifecycle entry and the only symptom is the host's own connection error. A path that resolves ` +
          `against the session directory rather than the install directory fails exactly this way`,
        `register the entry point by a path that does not depend on the session's working directory`,
        false,
        undefined,
        { evidence: { registered_command: command, entry_point: resolved, entry_resolves: 'false' } },
      );
    }
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
