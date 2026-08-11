/**
 * CDEB-06: the OCI evaluation runner — the study's containment surface
 * (PRD §12.1/§12.2).
 *
 * The pinned image runs one evaluation with:
 *
 *   --network none          no network, full stop (§12.2)
 *   --read-only             rootfs is immutable; scratch is a size-capped tmpfs
 *   --cap-drop ALL          no capabilities beyond a plain process
 *   --security-opt no-new-privileges
 *   --cpus / --memory / --pids-limit    §12.1's frozen resource envelope
 *   candidate archive bind-mounted READ-ONLY; sealed tasks bind-mounted READ-ONLY
 *   no host HOME, no docker socket, no host config mounted
 *
 * FAIL-CLOSED, by design: when no OCI daemon is reachable, this runner
 * throws `EvaluatorRuntimeUnavailable`. There is no silent downgrade to a
 * weaker surface — §24.1 names the fail-open isolation fallback as a pattern
 * this benchmark must not reuse. Qualification on a daemon-less machine uses
 * runner-local.ts and says so in every artifact it produces.
 *
 * `buildEvaluatorRunArgs` is pure: the exact argv is inspectable and testable
 * on a machine that will never run a container, and a drift between this
 * argv and §12's requirements is a test failure rather than a review hope.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Hex } from "./tree.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** §12.1's frozen envelope. Changing these is a protocol change, not a tune. */
export const EVALUATOR_RESOURCE_LIMITS = {
  cpu_limit: 2,
  memory_mb: 4096,
  pids_limit: 256,
  timeout_ms: 180_000,
  tmpfs_size_mb: 512,
} as const;

export class EvaluatorRuntimeUnavailable extends Error {
  constructor(detail: string) {
    super(`evaluator OCI runtime unavailable: ${detail}`);
    this.name = "EvaluatorRuntimeUnavailable";
  }
}

export interface OciEvaluationRequest {
  /** Pinned image reference, digest form (`repo@sha256:...`) at study time. */
  readonly imageRef: string;
  /** Host path of the final-tree archive; mounted read-only. */
  readonly archivePath: string;
  /** Host path of the sealed task store; mounted read-only. */
  readonly tasksDir: string;
  readonly taskId: string;
  readonly claimedOid?: string;
  readonly imageDigest?: string;
}

/**
 * The exact `docker run` argv. Pure and total: every control §12 requires is
 * visible here as a flag, so the test suite can assert the contract without
 * running a container.
 */
export const buildEvaluatorRunArgs = (request: OciEvaluationRequest): string[] => {
  const limits = EVALUATOR_RESOURCE_LIMITS;
  const args = [
    "run", "--rm", "--interactive",
    "--network", "none",
    "--read-only",
    "--tmpfs", `/tmp:rw,noexec,nosuid,size=${String(limits.tmpfs_size_mb)}m`,
    "--cpus", String(limits.cpu_limit),
    "--memory", `${String(limits.memory_mb)}m`,
    "--memory-swap", `${String(limits.memory_mb)}m`,
    "--pids-limit", String(limits.pids_limit),
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--env", "TZ=UTC",
    "--env", "LC_ALL=C",
    "--env", "HOME=/tmp",
    // The engine runs privileged INSIDE the container (caps dropped,
    // read-only rootfs, no network) because the probes it spawns drop to
    // uid/gid 65534 (probe.ts): candidate code must not be able to read the
    // sealed store or the engine sources. The sealed store must therefore be
    // host-side 0400 root:wheel before this mount — a world-readable sealed
    // mount is a frozen-task leak, and the freeze gate checks it.
    "--mount", `type=bind,source=${request.archivePath},target=/input/tree.tar.zst,readonly`,
    "--mount", `type=bind,source=${request.tasksDir},target=/sealed,readonly`,
    request.imageRef,
    "/cdeb/evaluate",
    "--tasks", "/sealed",
    "--task", request.taskId,
    "--tree", "/input/tree.tar.zst",
  ];
  if (request.claimedOid !== undefined) args.push("--claimed-oid", request.claimedOid);
  if (request.imageDigest !== undefined) args.push("--image-digest", request.imageDigest);
  return args;
};

export const dockerDaemonAvailable = (): boolean => {
  const result = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0;
};

/**
 * Runs one evaluation in the pinned image. Throws EvaluatorRuntimeUnavailable
 * when the daemon cannot be reached — never falls back to a weaker surface.
 */
export const runEvaluatorOci = (request: OciEvaluationRequest): { stdout: Buffer; stderr: string; exitCode: number | null } => {
  if (!dockerDaemonAvailable()) {
    throw new EvaluatorRuntimeUnavailable(
      "no reachable docker daemon — study evaluation requires the pinned image; refusing to downgrade",
    );
  }
  const result = spawnSync("docker", buildEvaluatorRunArgs(request), {
    encoding: "buffer",
    timeout: EVALUATOR_RESOURCE_LIMITS.timeout_ms + 30_000,
    maxBuffer: 16 * 1024 * 1024,
    killSignal: "SIGKILL",
  });
  return {
    stdout: (result.stdout ?? Buffer.alloc(0)) as Buffer,
    stderr: ((result.stderr ?? Buffer.alloc(0)) as Buffer).toString("utf8"),
    exitCode: result.status,
  };
};

/* -------------------------------------------------------------------------- */
/* Image identity                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Engine sources the image bakes in. The sealed task modules are added at
 * freeze time (they are §5.2 private assets), so the FULL image identity is
 * `combineImageIdentity(contextDigest, sealedBundleDigest)`; the context
 * digest alone identifies the evaluator engine the image carries.
 */
export const ENGINE_CONTEXT_FILES = [
  "entrypoint.ts", "engine.ts", "env.ts", "freeze-tree.ts", "git-tree.ts",
  "ingest.ts", "probe.ts", "tree.ts", "types.ts", "runner-local.ts", "runner-oci.ts",
  "image/Dockerfile", "image/cdeb-evaluate.sh",
] as const;

export const evaluatorImageContextDigest = (): string => {
  const manifest = ENGINE_CONTEXT_FILES.map((name) => {
    const bytes = readFileSync(join(HERE, name));
    return `${name} ${sha256Hex(bytes)}`;
  }).join("\n");
  return sha256Hex(manifest);
};

/** `sha256:<hex>` form for the verdict field, from a bare hex digest. */
export const digestRef = (hexDigest: string): string => `sha256:${hexDigest}`;

/** Full image identity recorded by the freeze once the sealed bundle is known. */
export const combineImageIdentity = (contextDigest: string, sealedBundleDigest: string): string =>
  sha256Hex(`${contextDigest}:${sealedBundleDigest}`);
