/**
 * CDEB-06 OCI acceptance: execute the evaluator's attack matrix on a real
 * Docker daemon. The argv suite proves the requested contract; this suite
 * proves that Docker accepted and applied it to the container that evaluates
 * the hostile trees.
 */

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, chownSync, cpSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ENGINE_CONTEXT_FILES, EVALUATOR_RESOURCE_LIMITS, buildEvaluatorRunArgs, dockerDaemonAvailable, runEvaluatorOci } from "../bench/cdeb/evaluator/runner-oci.ts";
import type { OciEvaluationRequest } from "../bench/cdeb/evaluator/runner-oci.ts";
import type { EvaluatorOutput } from "../bench/cdeb/evaluator/types.ts";
import {
  FIXTURE_ROOT,
  REPO_ROOT,
  SEALED_DIR,
  TASK_ID,
  TEST_IMAGE_DIGEST,
  buildTree,
  cleanupScratch,
  fixtureFile,
  prepareRun,
  tempDir,
  type PreparedRun,
} from "./cdeb-evaluator-helpers.ts";

/**
 * These remain deliberately visible rather than being represented by weaker
 * tests. A property is listed here until this harness can observe its refusal.
 */
export const KNOWN_UNVERIFIED = [
  "evaluator image digest mismatch refusal: runner-oci passes imageDigest through to the verdict and does not compare it with Docker's resolved image identity.",
] as const;

const IMAGE_TAG = `cdeb-evaluator-oci-matrix-${String(process.pid)}-${String(Date.now())}`;
let sealedTasksDir = "";

interface DockerMount {
  readonly Type: "bind" | "volume" | "tmpfs";
  readonly Source: string;
  readonly Destination: string;
  readonly RW: boolean;
}

interface DockerInspection {
  readonly Config: { readonly Env: readonly string[] };
  readonly HostConfig: {
    readonly NetworkMode: string;
    readonly NanoCpus: number;
    readonly Memory: number;
    readonly MemorySwap: number;
    readonly PidsLimit: number;
  };
  readonly Mounts: readonly DockerMount[];
}

const docker = (args: readonly string[]): { stdout: string; stderr: string; status: number | null } => {
  const result = spawnSync("docker", args, { encoding: "utf8", shell: false });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
};

const imageBuildContext = (): string => {
  const context = tempDir("oci-image");
  const engine = join(context, "engine");
  mkdirSync(engine, { recursive: true });
  for (const name of ENGINE_CONTEXT_FILES) {
    if (name.startsWith("image/")) continue;
    cpSync(join(REPO_ROOT, "bench", "cdeb", "evaluator", name), join(engine, name));
  }
  // `engine/tree.ts` imports `../runtime/zstd.ts`; without it the image builds
  // and cannot start, which an argv assertion cannot tell from a working one.
  const runtime = join(context, "runtime");
  mkdirSync(runtime, { recursive: true });
  cpSync(
    join(REPO_ROOT, "bench", "cdeb", "runtime", "zstd.ts"),
    join(runtime, "zstd.ts"),
  );
  cpSync(
    join(REPO_ROOT, "bench", "cdeb", "evaluator", "image", "cdeb-evaluate.sh"),
    join(context, "cdeb-evaluate.sh"),
  );
  return context;
};

const requestFor = (run: PreparedRun): OciEvaluationRequest => ({
  imageRef: IMAGE_TAG,
  archivePath: run.archivePath,
  tasksDir: sealedTasksDir,
  taskId: TASK_ID,
  claimedOid: run.frozen.final_tree_oid,
  imageDigest: TEST_IMAGE_DIGEST,
});

const prepareOciRun = (label: string, tree: string): PreparedRun => {
  const run = prepareRun(label, tree);
  // `--cap-drop ALL` means the container's root process cannot bypass host
  // file modes. The archive is candidate-owned data, so read access is safe;
  // make it readable to the cap-dropped evaluator without opening the sealed
  // store below.
  chmodSync(dirname(run.archivePath), 0o755);
  chmodSync(run.archivePath, 0o444);
  return run;
};

const sealTasksForContainer = (): void => {
  const task = join(sealedTasksDir, `${TASK_ID}.task.ts`);
  chmodSync(sealedTasksDir, 0o500);
  chmodSync(task, 0o400);
  if (typeof process.getuid !== "function" || process.getuid() === 0) {
    chownSync(sealedTasksDir, 0, 0);
    chownSync(task, 0, 0);
    return;
  }
  const result = spawnSync("sudo", ["-n", "chown", "0:0", sealedTasksDir, task], { encoding: "utf8", shell: false });
  expect(result.status, result.stderr).toBe(0);
};

const restoreSealedTasks = (): void => {
  if (sealedTasksDir === "") return;
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    const result = spawnSync(
      "sudo",
      ["-n", "chown", `${String(process.getuid())}:${String(process.getgid?.() ?? 0)}`, sealedTasksDir, join(sealedTasksDir, `${TASK_ID}.task.ts`)],
      { encoding: "utf8", shell: false },
    );
    expect(result.status, result.stderr).toBe(0);
  }
  chmodSync(sealedTasksDir, 0o700);
};

const evaluate = (label: string, tree: string): EvaluatorOutput => {
  const run = prepareOciRun(label, tree);
  const result = runEvaluatorOci(requestFor(run));
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  const text = result.stdout.toString("utf8");
  expect(() => JSON.parse(text), text).not.toThrow();
  const verdict = JSON.parse(text) as EvaluatorOutput;
  // Candidate output never shares the evaluator's stdout. In particular this
  // keeps a candidate-owned `npm test` script from being an alternate verdict
  // channel: the only permitted bytes are the evaluator's canonical JSON.
  expect(text).toBe(`${JSON.stringify(verdict)}\n`);
  return verdict;
};

const expectRefused = (verdict: EvaluatorOutput, checks: { passed: number; failed: number }): void => {
  expect(verdict.functional_pass).toBe(false);
  expect(verdict.functional_checks).toEqual(checks);
  expect(verdict.evaluator_image_digest).toBe(TEST_IMAGE_DIGEST);
};

const waitForContainer = async (): Promise<string> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const listed = docker(["ps", "--quiet", "--filter", `ancestor=${IMAGE_TAG}`]);
    expect(listed.status, listed.stderr).toBe(0);
    const id = listed.stdout.trim().split(/\s+/)[0];
    if (id !== undefined && id !== "") return id;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the resource-hog evaluator container was never observable through docker ps");
};

const inspect = (containerId: string): DockerInspection => {
  const result = docker(["inspect", containerId]);
  expect(result.status, result.stderr).toBe(0);
  const parsed = JSON.parse(result.stdout) as DockerInspection[];
  expect(parsed).toHaveLength(1);
  return parsed[0]!;
};

const runAsynchronously = (request: OciEvaluationRequest): Promise<{ stdout: Buffer; stderr: string; exitCode: number | null }> =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", buildEvaluatorRunArgs(request), { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8"), exitCode });
    });
    child.stdin.end();
  });

/**
 * The sealed store must be root-owned and unreadable to the candidate, which
 * needs either root or passwordless sudo. A daemon alone is not enough, and
 * `beforeAll` runs even when every `it` in the block is skipped -- so gating on
 * the daemon only turned "cannot run here" into a red suite on any machine with
 * Docker and an interactive sudo.
 */
const canSealAsRoot = (): boolean => {
  if (typeof process.getuid !== "function" || process.getuid() === 0) return true;
  return spawnSync("sudo", ["-n", "true"], { encoding: "utf8", shell: false }).status === 0;
};

export const CAN_RUN_MATRIX = dockerDaemonAvailable() && canSealAsRoot();

/**
 * The point of this file is that CI runs it for real. A skip is correct on a
 * laptop and is a silent hole on the runner: the job would go green having
 * executed nothing, which is the shape #548 exists to close. So on CI the
 * matrix must be runnable, and saying so is itself an assertion.
 */
/**
 * The image was unrunnable and nothing said so. `engine/tree.ts` imports
 * `../runtime/zstd.ts`, the Dockerfile copied only `engine/`, and every
 * isolation test asserted the `docker run` argv -- which an image that cannot
 * start satisfies exactly as well as one that can.
 *
 * This check needs no daemon, so it holds on every machine rather than only
 * where the matrix can run.
 */
/**
 * The image needs more than the engine's imports: it needs the executables the
 * engine spawns. `freeze-tree.ts` and `git-tree.ts` both call `git`, and
 * `node:22-alpine` does not ship it, so every evaluation inside the container
 * died on `git init ... failed`. The Dockerfile comment asserted the opposite --
 * "zero dependencies beyond the node runtime itself" -- which was a claim about
 * an image nobody had started.
 *
 * Node itself is the base image and is not checked here.
 */
describe("the evaluator image carries every executable the engine spawns", () => {
  it("each spawned binary is installed or is node", () => {
    const dockerfile = readFileSync(
      join(REPO_ROOT, "bench", "cdeb", "evaluator", "image", "Dockerfile"),
      "utf8",
    );
    const engineDir = join(REPO_ROOT, "bench", "cdeb", "evaluator");
    // The runners are in the build context but do not run inside the container:
    // `runner-oci.ts` spawns `docker` from the host, and an evaluator image that
    // carried a docker client would hand a compromised evaluator the socket it
    // is otherwise denied. Only what executes inside is scanned.
    const HOST_SIDE = new Set(["runner-oci.ts", "runner-local.ts"]);
    const spawned = new Set<string>();
    for (const name of ENGINE_CONTEXT_FILES) {
      if (name.startsWith("image/") || HOST_SIDE.has(name)) continue;
      const source = readFileSync(join(engineDir, name), "utf8");
      for (const match of source.matchAll(/spawnSync\(\s*["']([a-z][a-z0-9-]*)["']/g)) {
        spawned.add(match[1] as string);
      }
    }
    expect(spawned.size, "no spawned executable found; the scan stopped working").toBeGreaterThan(0);
    for (const binary of spawned) {
      if (binary === "node") continue;
      expect(dockerfile, `the engine spawns ${binary} and the image never installs it`).toMatch(
        new RegExp(`apk add[^\n]*\\b${binary}\\b`),
      );
    }
  });
});

describe("the evaluator image carries everything the engine imports", () => {
  it("every relative import outside engine/ is copied into the image", () => {
    const dockerfile = readFileSync(
      join(REPO_ROOT, "bench", "cdeb", "evaluator", "image", "Dockerfile"),
      "utf8",
    );
    const engineDir = join(REPO_ROOT, "bench", "cdeb", "evaluator");
    const outside = new Set<string>();
    for (const name of ENGINE_CONTEXT_FILES) {
      if (name.startsWith("image/")) continue;
      const source = readFileSync(join(engineDir, name), "utf8");
      for (const match of source.matchAll(/from\s+["']\.\.\/([a-z-]+)\//g)) {
        outside.add(match[1] as string);
      }
    }
    for (const dir of outside) {
      expect(dockerfile, `engine imports ../${dir}/ and the image never copies it`).toContain(
        `COPY ${dir}/ /cdeb/${dir}/`,
      );
    }
  });
});

describe("the real-runtime matrix is not silently skipped on CI", () => {
  it("runs for real wherever CI runs it", () => {
    if (process.env.CI !== "true") {
      expect(typeof CAN_RUN_MATRIX).toBe("boolean");
      return;
    }
    expect(
      CAN_RUN_MATRIX,
      "CI must provide a Docker daemon and root or passwordless sudo, or this gate proves nothing",
    ).toBe(true);
  });
});

describe.skipIf(!CAN_RUN_MATRIX)("CDEB-06 OCI isolation matrix on a real Docker daemon", () => {
  beforeAll(() => {
    sealedTasksDir = tempDir("oci-sealed");
    const task = join(sealedTasksDir, `${TASK_ID}.task.ts`);
    cpSync(join(SEALED_DIR, `${TASK_ID}.task.ts`), task);
    // The engine runs as root, while candidate probes drop to nobody. These
    // modes make the sealed oracle readable to the former and inaccessible to
    // the latter, just as a frozen sealed store must be in production.
    sealTasksForContainer();

    const context = imageBuildContext();
    const result = docker([
      "build",
      "--tag", IMAGE_TAG,
      "--file", join(REPO_ROOT, "bench", "cdeb", "evaluator", "image", "Dockerfile"),
      context,
    ]);
    expect(result.status, result.stderr).toBe(0);
  }, 180_000);

  afterAll(() => {
    restoreSealedTasks();
    const result = docker(["image", "rm", "--force", IMAGE_TAG]);
    // The unique test image may already be gone if Docker's cleanup ran; any
    // other error is worth surfacing because it can contaminate a later run.
    expect(result.status === 0 || result.stderr.includes("No such image")).toBe(true);
    cleanupScratch();
  });

  it("runs the positive control in the built evaluator image", () => {
    const verdict = evaluate("oci-good", buildTree("oci-good", { "src/calc.js": fixtureFile("patches", "good", "calc.js") }));
    expect(verdict.functional_pass).toBe(true);
    expect(verdict.functional_checks).toEqual({ passed: 4, failed: 0 });
  }, 60_000);

  it("refuses network egress outside the provider allowlist", () => {
    const verdict = evaluate("oci-network", buildTree("oci-network", { "src/calc.js": fixtureFile("attacks", "network-calc.js") }));
    expectRefused(verdict, { passed: 3, failed: 1 });
  }, 60_000);

  it("does not pass host environment secrets to a candidate probe", () => {
    const previous = process.env.CDEB_STUDY_SECRET;
    process.env.CDEB_STUDY_SECRET = "planted-secret-must-not-reach-oci-probe";
    try {
      const verdict = evaluate(
        "oci-secret-env",
        buildTree("oci-secret-env", { "src/calc.js": fixtureFile("attacks", "secret-env-calc.js") }),
      );
      expectRefused(verdict, { passed: 3, failed: 1 });
    } finally {
      if (previous === undefined) delete process.env.CDEB_STUDY_SECRET;
      else process.env.CDEB_STUDY_SECRET = previous;
    }
  }, 60_000);

  it("refuses a candidate read of the sealed evaluator store", () => {
    const verdict = evaluate(
      "oci-hidden-read",
      buildTree("oci-hidden-read", { "src/calc.js": fixtureFile("attacks", "hidden-read-calc.js") }),
    );
    expectRefused(verdict, { passed: 2, failed: 2 });
  }, 60_000);

  it("applies cgroup limits and the probe wall timeout to the CPU hog", async () => {
    const run = prepareOciRun(
      "oci-hog",
      buildTree("oci-hog", { "src/calc.js": fixtureFile("attacks", "hog-calc.js") }),
    );
    const startedAt = Date.now();
    const completion = runAsynchronously(requestFor(run));
    const container = await waitForContainer();
    const applied = inspect(container);

    // This is Docker's post-create state for the live evaluator, not a check
    // of the argv that requested it. Exactly the two declared inputs are host
    // mounts; neither a host filesystem tree nor the daemon socket reaches it.
    expect(applied.HostConfig.NetworkMode).toBe("none");
    expect(applied.HostConfig.NanoCpus).toBe(EVALUATOR_RESOURCE_LIMITS.cpu_limit * 1_000_000_000);
    expect(applied.HostConfig.Memory).toBe(EVALUATOR_RESOURCE_LIMITS.memory_mb * 1024 * 1024);
    expect(applied.HostConfig.MemorySwap).toBe(EVALUATOR_RESOURCE_LIMITS.memory_mb * 1024 * 1024);
    expect(applied.HostConfig.PidsLimit).toBe(EVALUATOR_RESOURCE_LIMITS.pids_limit);
    const hostBackedMounts = applied.Mounts.filter((mount) => mount.Type !== "tmpfs");
    expect(hostBackedMounts).toHaveLength(2);
    expect(hostBackedMounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ Source: run.archivePath, Destination: "/input/tree.tar.zst", RW: false }),
      expect.objectContaining({ Source: sealedTasksDir, Destination: "/sealed", RW: false }),
    ]));
    expect(hostBackedMounts.map((mount) => mount.Destination)).not.toContain("/var/run/docker.sock");
    expect(applied.Config.Env).not.toContain("CDEB_STUDY_SECRET=planted-secret-must-not-reach-oci-probe");

    const result = await completion;
    const elapsedMs = Date.now() - startedAt;
    expect(result.exitCode, result.stderr).toBe(0);
    const verdict = JSON.parse(result.stdout.toString("utf8")) as EvaluatorOutput;
    expectRefused(verdict, { passed: 3, failed: 1 });
    // The sealed task gives a probe four seconds. Leave startup latitude for
    // an overloaded hosted runner, but never let a spin become an unbounded run.
    expect(elapsedMs).toBeLessThan(30_000);
  }, 60_000);

  it("does not let environment and filesystem leak probes alter the verdict", () => {
    const verdict = evaluate("oci-leak", buildTree("oci-leak", { "src/calc.js": fixtureFile("attacks", "leak-calc.js") }));
    expectRefused(verdict, { passed: 2, failed: 2 });
  }, 60_000);

  it("ignores candidate-authored verdict files and test scripts", () => {
    const tree = buildTree("oci-forge", { "src/calc.js": fixtureFile("attacks", "forge-scripts", "calc.js") });
    cpSync(join(FIXTURE_ROOT, "attacks", "forge-scripts"), tree, { recursive: true, force: true });

    const verdict = evaluate("oci-forge", tree);
    expectRefused(verdict, { passed: 1, failed: 3 });
    expect(verdict).not.toEqual(JSON.parse(readFileSync(join(tree, "forged-evaluator.json"), "utf8")));
    expect(verdict).not.toEqual(JSON.parse(readFileSync(join(tree, ".cdeb", "oracles", "verdict.json"), "utf8")));
    expect(verdict.decision_oracle_code).toBe("SAFE");
  }, 60_000);
});
