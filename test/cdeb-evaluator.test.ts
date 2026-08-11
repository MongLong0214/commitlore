/**
 * CDEB-06 acceptance (PRD §12, §4.7): the immutable evaluator sandbox.
 *
 * This file covers the DUAL controls — good/bad/no-op produce exactly their
 * sealed verdicts through the full pipeline (freeze → archive → ingest →
 * pinned entrypoint in a subprocess) — plus determinism, the frozen OCI
 * contract, and the static tripwires that keep the engine honest. The
 * adversarial trees live in cdeb-evaluator-adversarial.test.ts.
 *
 * Machine note: these tests run the evaluator through runner-local.ts —
 * the qualification surface. The OCI daemon was unreachable in the
 * environment this ticket landed in, so the pinned image is asserted as a
 * frozen contract (exact argv, fail-closed absence) rather than executed;
 * see the commit record and runner-oci.ts for the boundary.
 */

import { cpSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

// `ajv`'s default export ships draft-07 only; the schema declares 2020-12.
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { controls } from "../bench/cdeb/test-fixtures/evaluator/sealed/smoke-calc-fix.task.ts";
import { ENTRYPOINT_PATH, evaluateLocal } from "../bench/cdeb/evaluator/runner-local.ts";
import {
  buildEvaluatorRunArgs,
  combineImageIdentity,
  digestRef,
  probeEvaluatorRuntime,
  ENGINE_CONTEXT_FILES,
  evaluatorImageContextDigest,
  EvaluatorRuntimeUnavailable,
  EVALUATOR_RESOURCE_LIMITS,
  runEvaluatorOci,
} from "../bench/cdeb/evaluator/runner-oci.ts";
import { freezeFinalTree } from "../bench/cdeb/evaluator/freeze-tree.ts";
import { normalizedResultSha256 } from "../bench/cdeb/evaluator/engine.ts";
import {
  buildTree,
  cleanupScratch,
  snapshotFixtures,
  evaluatePrepared,
  expectVerdict,
  fixtureFile,
  prepareRun,
  REPO_ROOT,
  SEALED_DIR,
  TASK_ID,
  tempDir,
  TEST_IMAGE_DIGEST,
} from "./cdeb-evaluator-helpers.ts";

const fixtureSnapshot = snapshotFixtures();

afterAll(() => {
  cleanupScratch();
  expect(snapshotFixtures()).toEqual(fixtureSnapshot);
});

const schemaValidator = (() => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schema = JSON.parse(
    readFileSync(join(REPO_ROOT, "bench", "cdeb", "schemas", "evaluator.schema.json"), "utf8"),
  );
  return ajv.compile(schema);
})();

const GOOD_OVERRIDES = { "src/calc.js": fixtureFile("patches", "good", "calc.js") };
const BAD_OVERRIDES = { "src/calc.js": fixtureFile("patches", "bad", "calc.js") };

describe("dual controls (§4.7, §12.5)", () => {
  it("good control → functional PASS, decision SAFE", () => {
    const run = prepareRun("good", buildTree("good", GOOD_OVERRIDES));
    const verdict = expectVerdict(evaluatePrepared(run));
    expect(verdict.functional_pass).toBe(true);
    expect(verdict.rejected_decision_revived).toBe(false);
    expect(verdict.decision_oracle_code).toBe("SAFE");
    expect(verdict.functional_checks).toEqual({ passed: 4, failed: 0 });
    expect(verdict.candidate_tree_oid).toBe(run.frozen.final_tree_oid);
    expect(verdict.evaluator_image_digest).toBe(TEST_IMAGE_DIGEST);
    expect(verdict.task_id).toBe(TASK_ID);
    expect(verdict).toEqual(expect.objectContaining(controls.good));
  });

  it("bad control → functional PASS, decision REVIVED", () => {
    const run = prepareRun("bad", buildTree("bad", BAD_OVERRIDES));
    const verdict = expectVerdict(evaluatePrepared(run));
    expect(verdict.functional_pass).toBe(true);
    expect(verdict.decision_oracle_code).toBe("REVIVED");
    expect(verdict.rejected_decision_revived).toBe(true);
    expect(verdict).toEqual(expect.objectContaining(controls.bad));
  });

  it("no-op control → functional FAIL", () => {
    const run = prepareRun("noop", buildTree("noop", {}));
    const verdict = expectVerdict(evaluatePrepared(run));
    expect(verdict.functional_pass).toBe(false);
    expect(verdict.decision_oracle_code).toBe("SAFE");
    expect(verdict).toEqual(expect.objectContaining(controls.noop));
  });

  it("every control verdict validates against the frozen §12.4 schema", () => {
    for (const [label, overrides] of [
      ["good", GOOD_OVERRIDES],
      ["bad", BAD_OVERRIDES],
      ["noop", {}],
    ] as const) {
      const verdict = expectVerdict(evaluatePrepared(prepareRun(`schema-${label}`, buildTree(`schema-${label}`, overrides))));
      expect(schemaValidator(verdict), JSON.stringify(schemaValidator.errors)).toBe(true);
    }
  });

  it("verdict stdout is exactly the canonical JSON and nothing else", () => {
    const run = prepareRun("stdout", buildTree("stdout", GOOD_OVERRIDES));
    const result = evaluatePrepared(run);
    const text = result.rawStdout.toString("utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).toBe(`${JSON.stringify(result.verdict)}\n`);
  });
});

describe("determinism (§12.5: repeated evaluation → byte-identical result)", () => {
  it("the same tree evaluated twice yields byte-identical verdicts", () => {
    const run = prepareRun("det", buildTree("det", GOOD_OVERRIDES));
    const first = evaluatePrepared(run);
    const second = evaluatePrepared(run);
    expect(first.rawStdout.equals(second.rawStdout)).toBe(true);
    expect(normalizedResultSha256(expectVerdict(first))).toBe(normalizedResultSha256(expectVerdict(second)));
  });

  it("a hostile host environment does not reach the verdict", () => {
    const run = prepareRun("hostile", buildTree("hostile", GOOD_OVERRIDES));
    const clean = evaluatePrepared(run);
    const poisoned = evaluatePrepared(run, {
      env: {
        TZ: "America/New_York",
        LC_ALL: "en_US.UTF-8",
        LANG: "en_US.UTF-8",
        CDEB_STUDY_SECRET: "hunter2",
        NODE_OPTIONS: "--max-old-space-size=1234",
        http_proxy: "http://127.0.0.1:1",
      },
    });
    expect(clean.rawStdout.equals(poisoned.rawStdout)).toBe(true);
    expect(expectVerdict(poisoned).functional_pass).toBe(true);
  });

  it("freezing the same tree is byte-reproducible", () => {
    const tree = buildTree("freeze-det", GOOD_OVERRIDES);
    const one = freezeFinalTree(tree, tempDir("freeze-det-1"));
    const two = freezeFinalTree(tree, tempDir("freeze-det-2"));
    expect(one.tar_sha256).toBe(two.tar_sha256);
    expect(one.final_tree_oid).toBe(two.final_tree_oid);
    expect(one.archive_zst_sha256).toBe(two.archive_zst_sha256);
  });
});

describe("OCI contract (§12.1/§12.2) — frozen argv, fail-closed absence", () => {
  const request = {
    imageRef: "registry.example/cdeb-eval@sha256:" + "cd".repeat(32),
    archivePath: "/host/runs/x/final-tree.tar.zst",
    tasksDir: "/host/sealed",
    taskId: "smoke-calc-fix",
    claimedOid: "e".repeat(40),
    imageDigest: TEST_IMAGE_DIGEST,
  };

  it("builds the exact control surface as argv", () => {
    const argv = buildEvaluatorRunArgs(request);
    const joined = argv.join(" ");
    expect(argv[0]).toBe("run");
    expect(joined).toContain("--network none");
    expect(joined).toContain("--read-only");
    expect(joined).toContain("--cap-drop ALL");
    expect(joined).toContain("--security-opt no-new-privileges");
    expect(joined).toContain(`--cpus ${String(EVALUATOR_RESOURCE_LIMITS.cpu_limit)}`);
    expect(joined).toContain(`--memory ${String(EVALUATOR_RESOURCE_LIMITS.memory_mb)}m`);
    expect(joined).toContain(`--pids-limit ${String(EVALUATOR_RESOURCE_LIMITS.pids_limit)}`);
    expect(joined).toContain("source=/host/runs/x/final-tree.tar.zst,target=/input/tree.tar.zst,readonly");
    expect(joined).toContain("source=/host/sealed,target=/sealed,readonly");
    expect(joined).toContain("TZ=UTC");
    expect(joined).toContain("LC_ALL=C");
    expect(argv.slice(-4)).toEqual([
      "--claimed-oid", request.claimedOid,
      "--image-digest", request.imageDigest,
    ]);
  });

  it("mounts no docker socket and no host HOME", () => {
    const joined = buildEvaluatorRunArgs(request).join(" ");
    expect(joined).not.toContain("docker.sock");
    expect(joined).not.toContain("/var/run");
    expect(joined).not.toMatch(/source=\/(Users|home|root)\b/);
  });

  it("refuses to evaluate when no daemon is reachable — never downgrades", () => {
    // One probe, used for both the decision to assert and the call being
    // asserted on. Asking twice is what made this intermittent: a five-second
    // probe could time out on the first call and succeed on the second, so the
    // guard concluded "no daemon" and the runner then found one and did not
    // throw. The property is fail-closed behaviour, not the machine's mood.
    const probe = probeEvaluatorRuntime();
    if (probe.available) {
      // On a machine with a live daemon this path executes the pinned argv
      // against whatever image is named; the fail-closed property under test
      // only has teeth where the daemon is absent.
      return;
    }
    expect(() => runEvaluatorOci(request, probe)).toThrow(EvaluatorRuntimeUnavailable);
  });
});

describe("image identity", () => {
  it("the engine context digest is stable and schema-shaped", () => {
    const once = evaluatorImageContextDigest();
    const twice = evaluatorImageContextDigest();
    expect(once).toBe(twice);
    expect(digestRef(once)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(combineImageIdentity(once, "ff".repeat(32))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("every file the image context names actually exists", () => {
    for (const name of ENGINE_CONTEXT_FILES) {
      expect(() => readFileSync(join(REPO_ROOT, "bench", "cdeb", "evaluator", name)), name).not.toThrow();
    }
  });
});

describe("static tripwires (§12.3 — candidate-controlled command prohibition)", () => {
  const engineSources = [
    "engine.ts", "entrypoint.ts", "ingest.ts", "tree.ts", "git-tree.ts", "env.ts",
  ].map((name) => ({
    name,
    text: readFileSync(join(REPO_ROOT, "bench", "cdeb", "evaluator", name), "utf8"),
  }));

  it("no engine module invokes a package manager", () => {
    for (const { name, text } of engineSources) {
      expect(text, name).not.toMatch(/\b(npm|yarn|pnpm)\s+(test|run|install|ci|start|exec)\b/);
    }
  });

  it("the verdict engine never executes candidates and never reads package.json", () => {
    const engine = engineSources.find((entry) => entry.name === "engine.ts")!.text;
    expect(engine).not.toContain("child_process");
    expect(engine).not.toContain("package.json");
    const entrypoint = engineSources.find((entry) => entry.name === "entrypoint.ts")!.text;
    expect(entrypoint).not.toContain("child_process");
  });

  it("probes execute only the pinned node binary", () => {
    const probe = readFileSync(join(REPO_ROOT, "bench", "cdeb", "evaluator", "probe.ts"), "utf8");
    expect(probe).toContain("process.execPath");
    expect(probe).not.toMatch(/spawn(Sync)?\(\s*["'`]/); // no literal command strings
  });
});

describe("entrypoint infrastructure semantics (§10.3)", () => {
  it("an unknown task is an infrastructure failure, not a verdict", () => {
    const run = prepareRun("unknown", buildTree("unknown", GOOD_OVERRIDES));
    const result = evaluateLocal({
      tasksDir: SEALED_DIR,
      taskId: "no-such-task",
      archivePath: run.archivePath,
      imageDigest: TEST_IMAGE_DIGEST,
    });
    expect(result.exitCode).toBe(2);
    expect(result.verdict).toBeNull();
  });

  it("a missing archive is an infrastructure failure, not a verdict", () => {
    const result = evaluateLocal({
      tasksDir: SEALED_DIR,
      taskId: TASK_ID,
      archivePath: join(tempDir("missing"), "nope.tar.zst"),
      imageDigest: TEST_IMAGE_DIGEST,
    });
    expect(result.exitCode).toBe(2);
    expect(result.verdict).toBeNull();
  });

  it("refuses a sealed task store that overlaps the candidate tree", () => {
    // The entrypoint extracts under mkdtemp(os.tmpdir()); pointing TMPDIR at
    // the sealed store itself puts the extracted tree inside it — the
    // overlap the forgery check exists to catch.
    const storeDir = tempDir("overlap-store");
    // The module is present so a removed overlap check would proceed all the
    // way to a verdict — the assertion fails on status, not on a missing file.
    cpSync(join(SEALED_DIR, `${TASK_ID}.task.ts`), join(storeDir, `${TASK_ID}.task.ts`));
    const archive = prepareRun("overlap", buildTree("overlap", GOOD_OVERRIDES));
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types", ENTRYPOINT_PATH,
        "--tasks", storeDir,
        "--task", TASK_ID,
        "--tree", archive.archivePath,
      ],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          TMPDIR: storeDir,
          HOME: storeDir,
        },
        timeout: 60_000,
      },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("overlap");
  });
});

describe("runtime probe (#553): one question, one answer", () => {
  const probeRequest = {
    imageRef: "registry.example/cdeb-eval@sha256:" + "cd".repeat(32),
    archivePath: "/host/runs/x/final-tree.tar.zst",
    tasksDir: "/host/sealed",
    taskId: "smoke-calc-fix",
    claimedOid: "e".repeat(40),
    imageDigest: TEST_IMAGE_DIGEST,
  };

  it("reports why it is unavailable, and never calls a timeout an absence", () => {
    const probe = probeEvaluatorRuntime();
    if (probe.available) {
      expect(typeof probe.serverVersion).toBe("string");
      return;
    }
    expect(["unreachable", "timed-out", "not-installed"]).toContain(probe.reason);
    expect(probe.detail.length).toBeGreaterThan(0);
  });

  // The defect this closes: the guard and the guarded call each probed, and a
  // slow daemon answered differently to each. A caller that has decided must be
  // able to hand that decision in, or the two can never be made to agree.
  it("refuses on an injected unavailable probe regardless of the machine", () => {
    expect(() =>
      runEvaluatorOci(probeRequest, { available: false, reason: "timed-out", detail: "injected" }),
    ).toThrow(EvaluatorRuntimeUnavailable);
  });

  it("names the reason in what it throws, so an operator learns which happened", () => {
    try {
      runEvaluatorOci(probeRequest, { available: false, reason: "not-installed", detail: "docker is not on PATH" });
      expect.unreachable("expected a refusal");
    } catch (error) {
      expect(String(error)).toContain("not-installed");
      expect(String(error)).toContain("docker is not on PATH");
    }
  });
});
