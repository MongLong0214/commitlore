/**
 * CDEB-06: behavioral probes — the ONLY place candidate code executes, and
 * only on the evaluator's terms (PRD §12.3).
 *
 * Authority split, enforced in code:
 *
 *   - the executable is the pinned node running the evaluator itself —
 *     `process.execPath`, never a binary named by the tree;
 *   - flags come from a frozen allowlist. Arbitrary node flags are a sandbox
 *     surface: `--inspect` opens a network port, `--require`/`--import` load
 *     code before the probe file, `--experimental-policy` changes what every
 *     later process may do. `--experimental-strip-types` is the only one a
 *     task needs (candidate sources in .ts), so it is the only one allowed;
 *   - the arguments after the flags are the probe file (tree-relative) and
 *     its inputs — stated by the sealed task module, not by the tree;
 *   - the environment is the hermetic allowlist (env.ts); the probe inherits
 *     nothing else;
 *   - cwd is the read-only tree, so a probe can import tree-relative modules
 *     but cannot mutate what later checks see;
 *   - output is capped and a timeout kills the process: a probe is an
 *     observation with a budget, not a tenant.
 *
 * The probe's stdout/stderr are DATA. Expectations are stated before the
 * probe runs (expect_exit, expect_stdout) and compared mechanically — no
 * verdict logic parses meaning out of what the candidate chose to print.
 */

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { dirname } from "node:path";

import { hermeticEnv } from "./env.ts";
import type { ProbeResult, ProbeSpec } from "./types.ts";

export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
export const MAX_PROBE_OUTPUT_BYTES = 1024 * 1024;

/**
 * Unprivileged id probes run under when the engine itself is privileged
 * (the OCI container case). The sealed task store and the engine sources are
 * readable only by the engine's user; dropping the probe's uid/gid is what
 * keeps candidate code from reading the oracle it is being judged by —
 * §12.3's "hidden evaluator path" prohibition, enforced per process.
 */
export const PROBE_UID = 65534;
export const PROBE_GID = 65534;

/**
 * Frozen allowlist — see the module comment for why it is this short.
 * `-e`/`--eval` are allowed because the evaluated string comes from the
 * sealed task module (evaluator-owned), never from the tree.
 */
export const ALLOWED_NODE_FLAGS = ["--experimental-strip-types", "-e", "--eval"] as const;

export interface ProbeContext {
  /** Read-only extraction of the candidate tree; the probe's cwd. */
  readonly treeRoot: string;
  /** Scratch directory used as HOME/TMPDIR for the probe. */
  readonly scratchDir: string;
}

export const runProbe = (spec: ProbeSpec, context: ProbeContext): ProbeResult => {
  const argv = [...spec.argv];
  const flags: string[] = [];
  let cursor = 0;
  let hasEval = false;
  while (cursor < argv.length) {
    const arg = argv[cursor]!;
    if (arg === "-e" || arg === "--eval") {
      // The expression and everything after it are script arguments, not flags.
      flags.push(arg, argv[cursor + 1] ?? "");
      cursor += 2;
      hasEval = true;
      break;
    }
    if (!arg.startsWith("-")) break; // file probe: file + script args follow
    if (!(ALLOWED_NODE_FLAGS as readonly string[]).includes(arg)) {
      return {
        exit_code: null,
        stdout: "",
        stderr: `probe: node flag ${arg} is not in the evaluator allowlist`,
        timed_out: false,
        truncated: false,
      };
    }
    flags.push(arg);
    cursor += 1;
  }
  const scriptArgs = argv.slice(cursor);
  if (!hasEval && scriptArgs.length === 0) {
    return { exit_code: null, stdout: "", stderr: "probe: no file or -e expression given", timed_out: false, truncated: false };
  }

  const timeoutMs = spec.timeout_ms ?? DEFAULT_PROBE_TIMEOUT_MS;
  const env = hermeticEnv({ scratchDir: context.scratchDir, nodeBinDir: dirname(process.execPath) });
  const spawnOptions: SpawnSyncOptions = {
    cwd: context.treeRoot,
    env,
    encoding: "buffer",
    timeout: timeoutMs,
    maxBuffer: MAX_PROBE_OUTPUT_BYTES,
    killSignal: "SIGKILL",
  };
  // Privilege drop: when the engine runs privileged (root in the pinned
  // image), candidate code must not. The sealed store and /cdeb are
  // root-owned and 0400/0500, so an unprivileged probe cannot read them.
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    spawnOptions.uid = PROBE_UID;
    spawnOptions.gid = PROBE_GID;
  }
  const result = spawnSync(process.execPath, [...flags, ...scriptArgs], spawnOptions);

  const stdoutRaw = (result.stdout ?? Buffer.alloc(0)) as Buffer;
  const stderrRaw = (result.stderr ?? Buffer.alloc(0)) as Buffer;
  const truncated = stdoutRaw.length >= MAX_PROBE_OUTPUT_BYTES || stderrRaw.length >= MAX_PROBE_OUTPUT_BYTES;

  return {
    exit_code: result.status,
    stdout: stdoutRaw.toString("utf8"),
    stderr: stderrRaw.toString("utf8"),
    timed_out: result.error !== undefined && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT" || (result.signal === "SIGKILL" && result.status === null),
    truncated,
  };
};

/** Strip exactly one trailing newline; nothing else about the bytes changes. */
export const normalizeProbeStdout = (stdout: string): string =>
  stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;

/** Mechanical expectation check — the only verdict-relevant use of a probe. */
export const probeMeets = (spec: ProbeSpec, result: ProbeResult): boolean => {
  if (result.timed_out) return false;
  if (result.exit_code !== spec.expect_exit) return false;
  if (spec.expect_stdout !== undefined && normalizeProbeStdout(result.stdout) !== spec.expect_stdout) return false;
  return true;
};
