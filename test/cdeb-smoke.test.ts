/**
 * CDEB-09 end-to-end adversarial smoke gate.
 *
 * These are disposable repositories and sealed tasks. The agent container is
 * represented by the CDEB-03 command seam because this checkout has no pinned
 * runtime image; everything after its byte stream is the production chain:
 * runtime identity/ledger, shipping proxy, freeze, durable storage, evaluator,
 * recursive verifier and analyzer. OCI-only containment is intentionally not
 * credited here; CDEB-06 isolation owns that separate surface.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { analysisSourceDigest, analyzeStudy } from "../bench/cdeb/analyze.ts";
import { normalizedResultSha256 } from "../bench/cdeb/evaluator/engine.ts";
import { evaluateLocal } from "../bench/cdeb/evaluator/runner-local.ts";
import {
  canonicalFinalTreeFreezer,
  runStudy,
  runtimeAgentRunner,
  summarizeExposure,
  type CdebStudyPlan,
  type EvaluatorRunner,
  type LogicalRunPlan,
  type OrchestratorDependencies,
  type PreparedWorkspace,
} from "../bench/cdeb/orchestrator.ts";
import {
  runtimePinDigest,
  type ContainerRuntimeCommands,
  type RuntimePin,
} from "../bench/cdeb/runtime/agent-container.ts";
import { assertRuntimeCapabilities, CAPABILITY_IDS, FROZEN_TOOL_POLICY } from "../bench/cdeb/runtime/isolation.ts";
import { assertCaptureSurfaceAbsent, shippingProxySha256, writeCdebArmConfig } from "../bench/cdeb/runtime/arm-settings.ts";
import { runTransparentShippingProxy } from "../bench/cdeb/runtime/shipping-proxy.ts";
import { DurableStudyStorage } from "../bench/cdeb/storage.ts";
import {
  FIXTURE_ROOT,
  SEALED_DIR,
  TEST_IMAGE_DIGEST,
  fixtureFile,
} from "./cdeb-evaluator-helpers.ts";
import { CLI_ENTRY } from "../bench/hooks-settings.ts";

const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const directory = mkdtempSync(join(tmpdir(), `cdeb-smoke-${label}-`));
  scratch.push(directory);
  return directory;
};

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", [...args], { cwd, encoding: "utf8" }).trim();

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const HEX = "a".repeat(64);
const OID = "b".repeat(40);
const RECORD_ID = "r-smokecalc";
const MODEL_ID = "smoke-pinned-observation";
const CLI_VERSION = "1.0.0";
const PROXY = resolve("bench/cdeb/runtime/shipping-proxy.ts");
const PARSER = resolve("bench/cdeb/runtime/exposure.ts");
const VERIFY = resolve("bench/cdeb/verify.mjs");

const PIN: RuntimePin = {
  schema_version: 1,
  frozen: true,
  image: { reference: "cdeb-smoke-agent", digest: `sha256:${"c".repeat(64)}` },
  agent_cli_version: CLI_VERSION,
  agent_executable: { path: "/cdeb/agent", sha256: "d".repeat(64) },
  node: { version: process.version, executable_path: process.execPath, executable_sha256: "e".repeat(64) },
  requested_model: "smoke-request",
  expected_observed_model: MODEL_ID,
  permission_mode: "acceptEdits",
  network_policy: {
    egress: "provider-only",
    enforcement: "internal-network+allowlist-proxy",
    allowed_hosts: ["provider.invalid"],
    allowed_port: 443,
  },
};

const GATE = assertRuntimeCapabilities(
  CAPABILITY_IDS.map((capability) => ({ capability, ok: true, detail: `fixture observation: ${capability}` })),
  runtimePinDigest(PIN),
);

const providerStream = (model: string = MODEL_ID): Buffer => Buffer.from(
  [
    JSON.stringify({
      type: "system",
      subtype: "init",
      tools: FROZEN_TOOL_POLICY.allowed,
      mcp_servers: [],
      model,
      permissionMode: PIN.permission_mode,
      claude_code_version: CLI_VERSION,
    }),
    JSON.stringify({
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "message_start", message: { id: "smoke-turn", model } },
    }),
    JSON.stringify({
      type: "stream_event",
      parent_tool_use_id: null,
      event: {
        type: "message_delta",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        delta: { stop_reason: "end_turn" },
      },
    }),
    JSON.stringify({
      type: "result",
      num_turns: 1,
      is_error: false,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }),
    "",
  ].join("\n"),
);

const sourceRepository = (): { readonly directory: string; readonly commit: string; readonly tree: string } => {
  const directory = join(temp("source"), "repository");
  cpSync(join(FIXTURE_ROOT, "base"), directory, { recursive: true });
  git(directory, ["init", "--quiet"]);
  git(directory, ["config", "user.email", "smoke@example.invalid"]);
  git(directory, ["config", "user.name", "CDEB smoke"]);
  git(directory, ["add", "-A"]);
  git(directory, [
    "commit", "--quiet", "-m",
    [
      "seed disposable task",
      "",
      "Ruled-out: recursive clamp | it overflows wide ranges",
      `Record-Id: ${RECORD_ID}`,
      "Provenance: authored",
    ].join("\n"),
  ]);
  return {
    directory,
    commit: git(directory, ["rev-parse", "HEAD"]),
    tree: git(directory, ["rev-parse", "HEAD^{tree}"]),
  };
};

const prepareWorkspace = (source: string): OrchestratorDependencies["prepare_workspace"] => async (plan): Promise<PreparedWorkspace> => {
  const root = temp("workspace");
  const workdir = join(root, "repository");
  const configDir = join(root, "config");
  cpSync(source, workdir, { recursive: true });
  const arm = plan.condition === "commitlore-on" ? "on" : "off";
  const config = writeCdebArmConfig(workdir, configDir, arm);
  assertCaptureSurfaceAbsent(workdir, config);
  return {
    workdir,
    config_dir: config.configDir,
    exposure_path: config.exposurePath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
};

type CandidateWriter = (workdir: string) => void;

const mountedPath = (args: readonly string[], suffix: string): string => {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--volume") continue;
    const value = args[index + 1];
    if (value !== undefined && value.endsWith(suffix)) return value.slice(0, -suffix.length);
  }
  throw new Error(`smoke runtime did not receive expected mount ${suffix}`);
};

/**
 * The injected runtime writes a recorded provider stream, but invokes the
 * shipping proxy and edits the mounted candidate tree exactly where the agent
 * image would. It is deliberately not a container-isolation simulation.
 */
const fixtureRuntime = (candidate: CandidateWriter, model: string = MODEL_ID): ContainerRuntimeCommands => {
  // The matrix needs one real shipping invocation, not 90 identical product
  // executions. Later ON cells still carry their empty observed side channel.
  let shippingObserved = false;
  return {
    run: () => ({ stdout: "", stderr: "not used by the smoke stream fixture", exitCode: 0, timedOut: false }),
    runToSink: async (args, sink) => {
      const workdir = mountedPath(args, ":/repo");
      const configDir = mountedPath(args, ":/cdeb:ro");
      const settings = JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8")) as { hooks: Record<string, unknown> };
      if (Object.keys(settings.hooks).length > 0 && !shippingObserved) {
        shippingObserved = true;
        await runTransparentShippingProxy({
          cwd: workdir,
          exposurePath: join(workdir, ".git", "cdeb", "exposure.jsonl"),
          nodeExecutable: process.execPath,
          shippingCli: CLI_ENTRY,
          input: Buffer.from(JSON.stringify({
            hook_event_name: "PreToolUse",
            tool_name: "Read",
            tool_input: { file_path: "src/calc.js" },
          }), "utf8"),
        });
      }
      candidate(workdir);
      sink.write(providerStream(model));
      sink.end();
      return { exitCode: 0, stderr: "", timedOut: false };
    },
  };
};

const categoryFor = (cell: number): string => {
  if (cell < 12) return "rejected-architecture";
  if (cell < 20) return "rejected-workaround";
  if (cell < 25) return "compatibility-constraint";
  if (cell < 28) return "security-operational";
  return "superseded-lifecycle";
};

const sealedTaskSource = (taskId: string): string => [
  "const task = {",
  `  task_id: ${JSON.stringify(taskId)},`,
  "  record_ids: [],",
  "  functional_checks(tree) {",
  "    const source = tree.read('src/calc.js') ?? '';",
  "    return [{ name: 'direct-clamp', passed: source.includes('export const clamp') && !source.includes('recursiveClamp') }];",
  "  },",
  "  decision_oracle(tree) {",
  "    const source = tree.read('src/calc.js') ?? '';",
  "    return source.includes('recursiveClamp') ? 'REVIVED' : 'SAFE';",
  "  },",
  "};",
  "export default task;",
  "",
].join("\n");

const writeSealedTasks = (taskIds: readonly string[]): string => {
  const directory = temp("sealed");
  for (const taskId of taskIds) writeFileSync(join(directory, `${taskId}.task.ts`), sealedTaskSource(taskId));
  return directory;
};

interface PlanOptions {
  readonly source: { readonly commit: string; readonly tree: string };
  readonly cells: readonly { readonly repository: number; readonly task: number; readonly repeat: 1 | 2 | 3 }[];
  readonly task_id?: string;
}

const smokePlan = ({ source, cells, task_id: fixedTaskId }: PlanOptions): CdebStudyPlan => {
  const descriptors = cells.flatMap((cell, block) => {
    const repository_id = `repo-${String(cell.repository)}`;
    const task_id = fixedTaskId ?? `task-${String(cell.task).padStart(2, "0")}`;
    const category = categoryFor(cell.task + cell.repository * 6);
    return (["commitlore-on", "commitlore-off"] as const).map((condition, arm) => ({
      ...cell,
      repository_id,
      task_id,
      category,
      condition,
      order: block * 2 + arm + 1,
      analysis_row_file: `rows/block-${String(block).padStart(3, "0")}-${arm === 0 ? "on" : "off"}.json`,
    }));
  });
  const rows = descriptors.map((descriptor) => descriptor.analysis_row_file);
  const repository_bundles = Array.from({ length: 5 }, (_unused, repository) => ({
    repository_id: `repo-${String(repository)}`,
    bundle_sha256: HEX,
    snapshot_commit: source.commit,
    snapshot_tree_oid: source.tree,
    refs_digest: HEX,
    notes_ref_digest: HEX,
    source_authorization_id: `smoke-source-${String(repository)}`,
  }));
  const public_freeze = {
    schema_version: 1,
    benchmark: "cdeb-v1",
    protocol_version: "1.3.0",
    study_id: "cdeb-smoke-disposable",
    protocol_digest: HEX,
    candidate_registry_commitment: HEX,
    sealed_task_bundle_sha256: HEX,
    repository_bundles,
    agent_runtime_image_digest: PIN.image.digest!,
    requested_model: PIN.requested_model,
    observed_model_id: MODEL_ID,
    agent_cli_version: CLI_VERSION,
    agent_executable_sha256: PIN.agent_executable.sha256!,
    product_commit: OID,
    dist_digest: HEX,
    hook_proxy_sha256: shippingProxySha256(PROXY, PARSER),
    byte_identity_verified: true,
    evaluator_image_digests: [TEST_IMAGE_DIGEST],
    analysis_source_digest: analysisSourceDigest(),
    bootstrap_seed: "cdeb-smoke-seed",
    calibrated_overhead: 0,
    qualification_manifest_sha256: HEX,
    runtime_qualification_summary: { tasks_probed: 30, tasks_qualified: 30 },
    delivery_qualification_summary: { tasks_verified: 30 },
    claim_thresholds: {
      safe_success_lift_pp: 10,
      token_volume_reduction: 0.15,
      revival_reduction: 0.3,
      min_off_revivals: 10,
      min_safe_successes_per_arm: 10,
      min_finite_replicates: 9900,
    },
    expected_logical_runs: descriptors.length,
    analysis_inputs: { row_files: rows },
  };
  const freezeSha = sha256(`${JSON.stringify(public_freeze, null, 2)}\n`);
  const logical_runs: LogicalRunPlan[] = descriptors.map((descriptor) => {
    const logical_run_id = `${descriptor.repository_id}__${descriptor.task_id}__${
      descriptor.condition === "commitlore-on" ? "on" : "off"
    }__r${String(descriptor.repeat)}`;
    return {
      logical_run_id,
      repository_id: descriptor.repository_id,
      task_id: descriptor.task_id,
      category: descriptor.category,
      condition: descriptor.condition,
      repeat: descriptor.repeat,
      order: descriptor.order,
      analysis_row_file: descriptor.analysis_row_file,
      requested_model: PIN.requested_model,
      prompt: "Apply the direct clamp implementation.",
      // OFF must name the record too so its absent delivery is an observed
      // false, not summarizeExposure's vacuous truth for an empty expectation.
      expected_record_ids: [RECORD_ID],
      make_row: ({ agent, exposure, final_tree, evaluator, evaluator_attempts }) => ({
        schema_version: 1,
        benchmark: "cdeb-v1",
        protocol_version: "1.3.0",
        study_id: public_freeze.study_id,
        logical_run_id,
        repository_id: descriptor.repository_id,
        task_id: descriptor.task_id,
        category: descriptor.category,
        condition: descriptor.condition,
        repeat: descriptor.repeat,
        order: descriptor.order,
        freeze_manifest_sha256: freezeSha,
        sealed_task_bundle_sha256: HEX,
        repository_bundle_sha256: HEX,
        repository_snapshot: source.commit,
        base_tree_oid: final_tree.base_tree_oid,
        refs_digest: HEX,
        notes_ref_digest: HEX,
        requested_model: PIN.requested_model,
        observed_model_ids: agent.provider_ledger.observed_model_ids,
        agent_cli_version: CLI_VERSION,
        agent_executable_sha256: PIN.agent_executable.sha256,
        node_version: PIN.node.version,
        node_executable_sha256: PIN.node.executable_sha256,
        agent_runtime_image_digest: PIN.image.digest,
        tool_policy_digest: HEX,
        network_policy_digest: HEX,
        settings_digest: HEX,
        mcp_config_digest: HEX,
        harness_commit: OID,
        product_commit: OID,
        dist_digest: HEX,
        hook_proxy_sha256: public_freeze.hook_proxy_sha256,
        started_at: agent.started_at,
        finished_at: agent.finished_at,
        stop_reason: agent.stop_reason,
        first_model_turn_observed: true,
        wall_ms: 1,
        exposure,
        usage: agent.provider_ledger.usage,
        final_tree: {
          final_tree_oid: final_tree.final_tree_oid,
          canonical_diff_sha256: final_tree.canonical_diff_sha256,
          archive_sha256: final_tree.archive_sha256,
          workspace_status_digest: final_tree.workspace_status_digest,
        },
        evaluation: {
          evaluator_image_digest: evaluator.evaluator_image_digest,
          evaluator_attempts,
          functional_pass: evaluator.functional_pass,
          rejected_decision_revived: evaluator.rejected_decision_revived,
          normalized_result_sha256: normalizedResultSha256(evaluator),
        },
        decision_safe_success: agent.stop_reason === "completed" && evaluator.functional_pass && !evaluator.rejected_decision_revived,
        simulated: false,
      }),
    };
  });
  return {
    public_freeze,
    randomization: {
      schema_version: 1,
      algorithm: "sha256-key-sort-v1",
      block_count: cells.length,
      blocks: cells.map((_cell, block) => ({
        block_index: `block-${String(block).padStart(3, "0")}`,
        conditions: ["commitlore-on", "commitlore-off"] as const,
      })),
    },
    logical_runs,
  };
};

const matrixCells = (): PlanOptions["cells"] =>
  Array.from({ length: 5 }, (_unused, repository) =>
    Array.from({ length: 6 }, (_task, task) =>
      ([1, 2, 3] as const).map((repeat) => ({ repository, task, repeat })),
    ).flat(),
  ).flat();

const pairCells = (): PlanOptions["cells"] => [{ repository: 0, task: 0, repeat: 1 }];

const evaluator = (tasksDir: string, retryFirst: boolean = false, cacheIdenticalTaskTrees: boolean = false): {
  readonly runner: EvaluatorRunner;
  readonly calls: { readonly logical_run_id: string; readonly oid: string; readonly archive: string }[];
} => {
  const calls: { logical_run_id: string; oid: string; archive: string }[] = [];
  let failedFirst = false;
  const cached = new Map<string, { readonly oid: string; readonly verdict: ReturnType<typeof evaluateLocal>["verdict"] }>();
  return {
    calls,
    runner: {
      evaluate: async ({ plan, archive_path, final_tree }) => {
        calls.push({ logical_run_id: plan.logical_run_id, oid: final_tree.final_tree_oid, archive: sha256(readFileSync(archive_path)) });
        if (retryFirst && !failedFirst) {
          failedFirst = true;
          return { kind: "infrastructure-failure", failure_detail: "injected evaluator transport interruption" };
        }
        const previous = cached.get(plan.task_id);
        if (cacheIdenticalTaskTrees && previous !== undefined) {
          if (previous.oid !== final_tree.final_tree_oid || previous.verdict === null) {
            return { kind: "infrastructure-failure", failure_detail: "smoke evaluator cache observed a different candidate tree" };
          }
          return { kind: "verdict", verdict: previous.verdict };
        }
        const local = evaluateLocal({
          tasksDir,
          taskId: plan.task_id,
          archivePath: archive_path,
          claimedOid: final_tree.final_tree_oid,
          imageDigest: TEST_IMAGE_DIGEST,
        });
        if (local.verdict === null) {
          return { kind: "infrastructure-failure", failure_detail: local.stderr || "evaluator emitted no verdict" };
        }
        if (cacheIdenticalTaskTrees) cached.set(plan.task_id, { oid: final_tree.final_tree_oid, verdict: local.verdict });
        return { kind: "verdict", verdict: local.verdict };
      },
    },
  };
};

const dependencies = (
  source: string,
  candidate: CandidateWriter,
  evaluatorRunner: EvaluatorRunner,
  model: string = MODEL_ID,
): OrchestratorDependencies => ({
  prepare_workspace: prepareWorkspace(source),
  agent: runtimeAgentRunner({ docker: fixtureRuntime(candidate, model), pin: PIN, gate: GATE, provider_env: {} }),
  freeze_tree: canonicalFinalTreeFreezer,
  collect_exposure: (workspace, plan) =>
    summarizeExposure(workspace.exposure_path, plan.expected_record_ids, false),
  evaluator: evaluatorRunner,
});

const goodCandidate: CandidateWriter = (workdir) => {
  writeFileSync(join(workdir, "src", "calc.js"), fixtureFile("patches", "good", "calc.js"));
};

const attacks: readonly { readonly name: string; readonly candidate: CandidateWriter }[] = [
  {
    name: "evaluator tamper",
    candidate: (workdir) => {
      const files: Record<string, string> = {
        "src/calc.js": fixtureFile("attacks", "forge-scripts", "calc.js"),
        "package.json": fixtureFile("attacks", "forge-scripts", "package.json"),
        "forge-pass.js": fixtureFile("attacks", "forge-scripts", "forge-pass.js"),
        "evaluator.json": fixtureFile("attacks", "forge-scripts", "forged-evaluator.json"),
        ".cdeb/oracles/verdict.json": fixtureFile("attacks", "forge-scripts", ".cdeb", "oracles", "verdict.json"),
      };
      for (const [relative, contents] of Object.entries(files)) {
        const path = join(workdir, relative);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents);
      }
    },
  },
  {
    name: "secret attempt",
    candidate: (workdir) => writeFileSync(join(workdir, "src", "calc.js"), fixtureFile("attacks", "secret-env-calc.js")),
  },
  {
    name: "network attempt",
    candidate: (workdir) => writeFileSync(join(workdir, "src", "calc.js"), fixtureFile("attacks", "network-calc.js")),
  },
];

describe("CDEB-09 composed disposable smoke", () => {
  it(
    "publishes freeze-named rows through analysis, proves a frozen evaluator retry, and catches a nested invalid result",
    { timeout: 180_000 },
    async () => {
      const source = sourceRepository();
      const plan = smokePlan({ source, cells: matrixCells() });
      const sealed = writeSealedTasks([...new Set(plan.logical_runs.map((run) => run.task_id))]);
      const resultRoot = temp("results");
      const study = join(resultRoot, "disposable");
      const storage = new DurableStudyStorage({ studyDir: study, backupDir: temp("backup") });
      const localEvaluator = evaluator(sealed, true, true);

      await runStudy(plan, dependencies(source.directory, goodCandidate, localEvaluator.runner), { storage });

      const firstId = plan.logical_runs[0]!.logical_run_id;
      const firstCalls = localEvaluator.calls.filter((call) => call.logical_run_id === firstId);
      expect(firstCalls).toHaveLength(2);
      expect(new Set(firstCalls.map((call) => call.oid))).toEqual(new Set([firstCalls[0]!.oid]));
      expect(new Set(firstCalls.map((call) => call.archive))).toEqual(new Set([firstCalls[0]!.archive]));
      const firstRow = storage.readRunState(firstId).row;
      expect(firstRow?.["evaluation"]).toMatchObject({ evaluator_attempts: 2, functional_pass: true });
      expect(firstRow?.["exposure"]).toMatchObject({
        hook_opportunities: 1,
        proxy_executions: 1,
        expected_record_delivered: true,
        delivered_record_ids: [RECORD_ID],
      });

      // The only analysis inputs are the rows the freeze names. This is the
      // CDEB-07/08 wiring assertion, not a disk discovery convenience.
      const analysis = analyzeStudy(study);
      expect(analysis.matrix.rows).toBe(180);
      expect(analysis.source.row_files).toEqual((plan.public_freeze as { analysis_inputs: { row_files: string[] } }).analysis_inputs.row_files);

      const verified = spawnSync(process.execPath, [VERIFY, resultRoot], { encoding: "utf8" });
      expect(verified.status, `${verified.stdout}${verified.stderr}`).toBe(0);

      // The fault lands below the study root, where a non-recursive verifier
      // would miss it. The real recursive verifier must name this exact copy.
      writeFileSync(join(study, "runs", firstId, "row.json"), "{\"nested\":true}\n");
      const rejected = spawnSync(process.execPath, [VERIFY, resultRoot], { encoding: "utf8" });
      expect(rejected.status).toBe(1);
      expect(`${rejected.stdout}${rejected.stderr}`).toContain(`runs/${firstId}/row.json`);
    },
  );

  it("stops before launch when the frozen shipping proxy bytes were mutated", async () => {
    const source = sourceRepository();
    const plan = smokePlan({ source, cells: pairCells() });
    const changedProxy = join(temp("changed-proxy"), "shipping-proxy.ts");
    writeFileSync(changedProxy, `${readFileSync(PROXY, "utf8")}\n`);
    const storage = new DurableStudyStorage({ studyDir: temp("proxy-study"), backupDir: temp("proxy-backup") });
    const localEvaluator = evaluator(SEALED_DIR);

    await expect(runStudy(plan, dependencies(source.directory, goodCandidate, localEvaluator.runner), {
      storage,
      shipping_proxy_paths: { proxy_path: changedProxy, parser_path: PARSER },
    })).rejects.toThrow(/shipping proxy changed/);
    expect(storage.readRunState(plan.logical_runs[0]!.logical_run_id).launched_attempt_ids).toEqual([]);
  });

  it("stops the real runtime-to-orchestrator path on model drift", async () => {
    const source = sourceRepository();
    const plan = smokePlan({ source, cells: pairCells() });
    const storage = new DurableStudyStorage({ studyDir: temp("drift-study"), backupDir: temp("drift-backup") });
    const localEvaluator = evaluator(SEALED_DIR);
    const firstId = plan.logical_runs[0]!.logical_run_id;

    await expect(runStudy(
      plan,
      dependencies(source.directory, goodCandidate, localEvaluator.runner, "unfrozen-observation"),
      { storage },
    )).rejects.toThrow(/model identity hard stop/);
    const state = storage.readRunState(firstId);
    expect(state.row).toBeNull();
    expect(state.final_tree).toBeNull();
    expect(state.agent_attempts).toMatchObject([{ terminal_state: "MEASUREMENT_INTEGRITY_FAILURE", first_model_turn_observed: true }]);
  });

  it.each(attacks)("has the sealed evaluator refuse a running-pipeline $name", async ({ candidate }) => {
    const source = sourceRepository();
    const plan = smokePlan({ source, cells: pairCells(), task_id: "smoke-calc-fix" });
    const storage = new DurableStudyStorage({ studyDir: temp("attack-study"), backupDir: temp("attack-backup") });
    const localEvaluator = evaluator(SEALED_DIR);
    const previousSecret = process.env.CDEB_STUDY_SECRET;
    process.env.CDEB_STUDY_SECRET = "fixture-only-secret";
    try {
      await runStudy(plan, dependencies(source.directory, candidate, localEvaluator.runner), { storage });
    } finally {
      if (previousSecret === undefined) delete process.env.CDEB_STUDY_SECRET;
      else process.env.CDEB_STUDY_SECRET = previousSecret;
    }
    for (const run of plan.logical_runs) {
      const row = storage.readRunState(run.logical_run_id).row;
      expect(row?.["evaluation"]).toMatchObject({ functional_pass: false });
      expect(row?.["decision_safe_success"]).toBe(false);
    }
  });
});
