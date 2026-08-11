/**
 * CDEB-06: the local evaluation runner — the qualification and development
 * surface for the evaluator pipeline.
 *
 * This runs the SAME entrypoint the pinned image runs, as a child process
 * under the hermetic environment (env.ts): allowlisted env only, HOME and
 * TMPDIR inside a fresh scratch, pinned TZ/locale, nothing inherited from
 * the host. The verdict therefore proves the structural controls on any
 * machine:
 *
 *   - evaluator code and oracle come from the sealed store, not the tree;
 *   - nothing candidate-written executes with evaluator authority;
 *   - the verdict derives from the pinned harness's observations;
 *   - host environment (secrets, TZ, locale, NODE_OPTIONS) cannot reach it.
 *
 * What this runner does NOT provide, stated plainly: kernel-level
 * containment. Network isolation, filesystem confinement outside the env/HOME
 * construction, CPU/memory/PID limits — those are the OCI runner's controls
 * (runner-oci.ts), and study rows must be produced there. A verdict here is
 * a qualification artifact, not a measured row.
 */

import { chmodSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { hermeticEnv } from "./env.ts";
import type { EvaluatorOutput } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ENTRYPOINT_PATH = join(HERE, "entrypoint.ts");

export interface LocalEvaluationRequest {
  readonly tasksDir: string;
  readonly taskId: string;
  readonly archivePath: string;
  readonly claimedOid?: string;
  readonly imageDigest?: string;
  readonly timeoutMs?: number;
}

export interface LocalEvaluationResult {
  readonly exitCode: number | null;
  /** Parsed verdict when exit 0 and stdout was canonical JSON. */
  readonly verdict: EvaluatorOutput | null;
  /** Exact stdout bytes — determinism is asserted on these. */
  readonly rawStdout: Buffer;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export const evaluateLocal = (request: LocalEvaluationRequest): LocalEvaluationResult => {
  const scratch = mkdtempSync(join(realpathSync(tmpdir()), "cdeb-eval-local-"));
  const args = [
    "--experimental-strip-types",
    ENTRYPOINT_PATH,
    "--tasks", request.tasksDir,
    "--task", request.taskId,
    "--tree", request.archivePath,
  ];
  if (request.claimedOid !== undefined) args.push("--claimed-oid", request.claimedOid);
  if (request.imageDigest !== undefined) args.push("--image-digest", request.imageDigest);

  const result = spawnSync(process.execPath, args, {
    cwd: scratch,
    env: hermeticEnv({ scratchDir: scratch, nodeBinDir: dirname(process.execPath) }),
    encoding: "buffer",
    timeout: request.timeoutMs ?? 120_000,
    maxBuffer: 16 * 1024 * 1024,
    killSignal: "SIGKILL",
  });

  const stdout = (result.stdout ?? Buffer.alloc(0)) as Buffer;
  const stderr = ((result.stderr ?? Buffer.alloc(0)) as Buffer).toString("utf8");
  const timedOut = result.signal === "SIGKILL" && result.status === null;

  let verdict: EvaluatorOutput | null = null;
  if (result.status === 0) {
    try {
      verdict = JSON.parse(stdout.toString("utf8")) as EvaluatorOutput;
    } catch {
      verdict = null;
    }
  }

  // The extraction inside scratch is read-only by construction; restore
  // permissions before removing so the qualification surface leaves no
  // debris behind.
  try {
    const unlock = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        const stat = statSync(path);
        if (stat.isDirectory()) unlock(path);
        chmodSync(path, stat.mode | 0o700);
      }
    };
    unlock(scratch);
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // the tmp filesystem reclaims whatever is left
  }

  return { exitCode: result.status, verdict, rawStdout: stdout, stderr, timedOut };
};
