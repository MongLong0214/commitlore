/**
 * CDEB-07 acceptance: exercise the real coordinator over recorded provider
 * bytes, the real final-tree freezer, the CDEB-05 ledger, and CDEB-06's
 * evaluator entrypoint.  The only substituted boundary is the provider/OCI
 * process itself; its responses are recorded fixtures so no test can call a
 * provider or require a container daemon.
 */

import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterAll, expect, it } from "vitest";

import { describeZstd as describe } from "./cdeb-zstd.ts";

import { normalizedResultSha256 } from "../bench/cdeb/evaluator/engine.ts";
import { evaluateLocal } from "../bench/cdeb/evaluator/runner-local.ts";
import {
  blockedRandomization,
  canonicalFinalTreeFreezer,
  runStudy,
  summarizeExposure,
  type AgentRunner,
  type CdebCondition,
  type CdebStudyPlan,
  type EvaluatorRunner,
  type LogicalRunPlan,
  type OrchestratorDependencies,
  type OutcomeFreeProgress,
  type PreparedWorkspace,
} from "../bench/cdeb/orchestrator.ts";
import { readProviderLedger } from "../bench/cdeb/runtime/provider-ledger.ts";
import { shippingProxySha256 } from "../bench/cdeb/runtime/arm-settings.ts";
import { DurableStudyStorage, SimulatedProcessKill } from "../bench/cdeb/storage.ts";
import { FIXTURE_ROOT, SEALED_DIR, TASK_ID, TEST_IMAGE_DIGEST } from "./cdeb-evaluator-helpers.ts";

const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const directory = mkdtempSync(join(tmpdir(), `cdeb-orchestrator-${label}-`));
  scratch.push(directory);
  return directory;
};

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", [...args], { cwd, encoding: "utf8" }).trim();

const HEX = "a".repeat(64);
const OID = "b".repeat(40);
const RECORDED_STREAM = (): Buffer => readFileSync("test/fixtures/claude-stream/partial-messages.jsonl");
const RECORDED_MODEL = "claude-haiku-4-5-20251001";
const PROXY = resolve("bench/cdeb/runtime/shipping-proxy.ts");
const PARSER = resolve("bench/cdeb/runtime/exposure.ts");

interface Counters {
  readonly agent: Map<string, number>;
  readonly evaluator: Map<string, number>;
  readonly evaluatorTreeOids: Map<string, string[]>;
}

const counter = (): Counters => ({ agent: new Map(), evaluator: new Map(), evaluatorTreeOids: new Map() });
const increment = (map: Map<string, number>, key: string): number => {
  const next = (map.get(key) ?? 0) + 1;
  map.set(key, next);
  return next;
};

const workspaceFor = (): PreparedWorkspace => {
  const root = temp("workspace");
  const workdir = join(root, "tree");
  const configDir = join(root, "config");
  cpSync(join(FIXTURE_ROOT, "base"), workdir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "settings.json"), "{\"hooks\":{}}\n");
  writeFileSync(join(configDir, "mcp.json"), "{\"mcpServers\":{}}\n");
  git(workdir, ["init", "--quiet"]);
  git(workdir, ["config", "user.email", "cdeb@example.test"]);
  git(workdir, ["config", "user.name", "CDEB test"]);
  git(workdir, ["add", "-A"]);
  git(workdir, ["commit", "--quiet", "-m", "base"]);
  const exposurePath = join(workdir, ".git", "cdeb", "exposure.jsonl");
  mkdirSync(dirname(exposurePath), { recursive: true });
  writeFileSync(exposurePath, "");
  return {
    workdir,
    exposure_path: exposurePath,
    config_dir: configDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
};

const agentRunner = (counts: Counters, preTurnFailures = 0): AgentRunner => ({
  run: async ({ plan, workspace, on_first_model_turn }) => {
    const ordinal = increment(counts.agent, plan.logical_run_id);
    if (ordinal <= preTurnFailures) {
      return { kind: "before-first-model-turn", failure_detail: "recorded preflight transport refusal" };
    }
    on_first_model_turn();
    writeFileSync(
      join(workspace.workdir, "src", "calc.js"),
      readFileSync(join(FIXTURE_ROOT, "patches", "good", "calc.js"), "utf8"),
    );
    const raw = RECORDED_STREAM();
    return {
      kind: "after-first-model-turn",
      started_at: "2026-08-11T00:00:00.000Z",
      finished_at: "2026-08-11T00:00:01.000Z",
      stop_reason: "completed",
      provider_ledger: readProviderLedger({ requested_model: RECORDED_MODEL, raw_ndjson: raw }),
      raw_provider_ndjson: raw,
    };
  },
});

const evaluatorRunner = (counts: Counters, failFirst: boolean): EvaluatorRunner => ({
  evaluate: async ({ plan, archive_path, final_tree }) => {
    const ordinal = increment(counts.evaluator, plan.logical_run_id);
    const trees = counts.evaluatorTreeOids.get(plan.logical_run_id) ?? [];
    trees.push(final_tree.final_tree_oid);
    counts.evaluatorTreeOids.set(plan.logical_run_id, trees);
    if (failFirst && ordinal === 1) {
      return { kind: "infrastructure-failure", failure_detail: "recorded evaluator transport interruption" };
    }
    const local = evaluateLocal({
      tasksDir: SEALED_DIR,
      taskId: TASK_ID,
      archivePath: archive_path,
      claimedOid: final_tree.final_tree_oid,
      imageDigest: TEST_IMAGE_DIGEST,
    });
    if (local.verdict === null) {
      return { kind: "infrastructure-failure", failure_detail: local.stderr || "recorded evaluator did not return a verdict" };
    }
    return { kind: "verdict", verdict: local.verdict };
  },
});

const makePlan = (condition: CdebCondition, order: number): LogicalRunPlan => {
  const suffix = condition === "commitlore-on" ? "on" : "off";
  const logical_run_id = `repo-a__${TASK_ID}__${suffix}__r1`;
  return {
    logical_run_id,
    repository_id: "repo-a",
    task_id: TASK_ID,
    category: "rejected-architecture",
    condition,
    repeat: 1,
    order,
    analysis_row_file: `rows/${logical_run_id}.json`,
    requested_model: RECORDED_MODEL,
    prompt: "Fix calc without running external services.",
    expected_record_ids: [],
    make_row: ({ agent, exposure, final_tree, evaluator, evaluator_attempts }) => ({
      schema_version: 1,
      benchmark: "cdeb-v1",
      protocol_version: "1.3.0",
      study_id: "cdeb-orchestrator-test",
      logical_run_id,
      repository_id: "repo-a",
      task_id: TASK_ID,
      category: "rejected-architecture",
      condition,
      repeat: 1,
      order,
      freeze_manifest_sha256: HEX,
      sealed_task_bundle_sha256: HEX,
      repository_bundle_sha256: HEX,
      repository_snapshot: OID,
      base_tree_oid: final_tree.base_tree_oid,
      refs_digest: HEX,
      notes_ref_digest: HEX,
      requested_model: RECORDED_MODEL,
      observed_model_ids: agent.provider_ledger.observed_model_ids,
      agent_cli_version: "2.1.220",
      agent_executable_sha256: HEX,
      node_version: process.version,
      node_executable_sha256: HEX,
      agent_runtime_image_digest: `sha256:${HEX}`,
      tool_policy_digest: HEX,
      network_policy_digest: HEX,
      settings_digest: HEX,
      mcp_config_digest: HEX,
      harness_commit: OID,
      product_commit: OID,
      dist_digest: HEX,
      hook_proxy_sha256: HEX,
      started_at: agent.started_at,
      finished_at: agent.finished_at,
      stop_reason: agent.stop_reason,
      first_model_turn_observed: true,
      wall_ms: 1_000,
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
      decision_safe_success:
        agent.stop_reason === "completed" && evaluator.functional_pass && !evaluator.rejected_decision_revived,
      simulated: false,
    }),
  };
};

const studyPlan = (): CdebStudyPlan => {
  const logical_runs = [makePlan("commitlore-on", 1), makePlan("commitlore-off", 2)];
  return {
    public_freeze: {
      benchmark: "cdeb-v1",
      study_id: "cdeb-orchestrator-test",
      freeze: "fixture",
      hook_proxy_sha256: shippingProxySha256(PROXY, PARSER),
      analysis_inputs: { row_files: logical_runs.map((run) => run.analysis_row_file) },
    },
    randomization: {
      schema_version: 1,
      algorithm: "sha256-key-sort-v1",
      block_count: 1,
      blocks: [{ block_index: "block-000", conditions: ["commitlore-on", "commitlore-off"] }],
    },
    logical_runs,
  };
};

const dependencies = (counts: Counters, options: { failEvaluatorFirst?: boolean; preTurnFailures?: number } = {}): OrchestratorDependencies => ({
  prepare_workspace: async () => workspaceFor(),
  agent: agentRunner(counts, options.preTurnFailures ?? 0),
  freeze_tree: canonicalFinalTreeFreezer,
  collect_exposure: (workspace, plan) => summarizeExposure(workspace.exposure_path, plan.expected_record_ids, false),
  evaluator: evaluatorRunner(counts, options.failEvaluatorFirst ?? false),
});

describe("CDEB-07 blocked randomization", () => {
  it("publishes only opaque indices and randomized arm order", () => {
    const randomized = blockedRandomization(
      [
        { sealed_key: "repo-secret/task-secret/r1", value: { task_id: "task-secret" } },
        { sealed_key: "repo-secret/task-other/r1", value: { task_id: "task-other" } },
      ],
      "frozen-seed",
    );
    const publicText = JSON.stringify(randomized.public_manifest);
    expect(publicText).not.toContain("task-secret");
    expect(publicText).not.toContain("repo-secret");
    expect(randomized.public_manifest.blocks.map((block) => block.block_index)).toEqual(["block-000", "block-001"]);
    expect(randomized.sealed_schedule.map((block) => block.value.task_id).sort()).toEqual(["task-other", "task-secret"]);
    for (const block of randomized.public_manifest.blocks) {
      expect([...block.conditions].sort()).toEqual(["commitlore-off", "commitlore-on"]);
    }
  });
});

describe("CDEB-07 state machine", () => {
  it("never reruns an agent after its first turn; evaluator retries receive the same frozen tree", async () => {
    const root = temp("evaluator-retry");
    const storage = new DurableStudyStorage({ studyDir: join(root, "study"), backupDir: join(root, "backup") });
    const counts = counter();
    const plan = studyPlan();
    await runStudy(plan, dependencies(counts, { failEvaluatorFirst: true }), { storage });

    const onId = plan.logical_runs[0]!.logical_run_id;
    expect(counts.agent.get(onId)).toBe(1);
    expect(counts.evaluator.get(onId)).toBe(2);
    expect(new Set(counts.evaluatorTreeOids.get(onId)).size).toBe(1);

    // A normal resume sees row.json and cannot reach either provider or evaluator.
    await runStudy(plan, dependencies(counts, { failEvaluatorFirst: true }), { storage });
    expect(counts.agent.get(onId)).toBe(1);
    expect(counts.evaluator.get(onId)).toBe(2);
  });

  it("retries only a typed pre-first-turn failure and preserves its attempt lineage", async () => {
    const root = temp("pre-turn-retry");
    const storage = new DurableStudyStorage({ studyDir: join(root, "study"), backupDir: join(root, "backup") });
    const counts = counter();
    await runStudy(studyPlan(), dependencies(counts, { preTurnFailures: 1 }), { storage });
    const id = makePlan("commitlore-on", 1).logical_run_id;
    expect(counts.agent.get(id)).toBe(2);
    const attempts = storage.preAgentAttempts(id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.first_model_turn_observed).toBe(false);
  });

  it("resume launches only missing logical ids after an interruption between durable rows", async () => {
    const root = temp("resume-missing");
    const storage = new DurableStudyStorage({ studyDir: join(root, "study"), backupDir: join(root, "backup") });
    const counts = counter();
    const plan = studyPlan();
    let interrupted = false;
    await expect(runStudy(plan, dependencies(counts), {
      storage,
      progress: (progress) => {
        if (!interrupted && progress.state === "MEASURED") {
          interrupted = true;
          throw new SimulatedProcessKill("process killed between logical rows");
        }
      },
    })).rejects.toThrow(SimulatedProcessKill);

    const [first, second] = plan.logical_runs;
    expect(counts.agent.get(first!.logical_run_id)).toBe(1);
    expect(counts.agent.get(second!.logical_run_id) ?? 0).toBe(0);

    const resumed = await runStudy(plan, dependencies(counts), { storage });
    expect(resumed.missing_logical_run_ids).toEqual([]);
    expect(counts.agent.get(first!.logical_run_id)).toBe(1);
    expect(counts.agent.get(second!.logical_run_id)).toBe(1);
  });

  it("cleans an fsynced-but-unrenamed row partial and finishes that row without a second evaluation or agent", async () => {
    const root = temp("atomic-row");
    let killed = false;
    const storage = new DurableStudyStorage({
      studyDir: join(root, "study"),
      backupDir: join(root, "backup"),
      faults: {
        after_file_fsync_before_rename: (relativePath) => {
          if (!killed && relativePath.endsWith("row.json")) {
            killed = true;
            throw new SimulatedProcessKill("killed after row fsync before rename");
          }
        },
      },
    });
    const counts = counter();
    const plan = studyPlan();
    await expect(runStudy(plan, dependencies(counts), { storage })).rejects.toThrow(SimulatedProcessKill);
    const first = plan.logical_runs[0]!;
    expect(counts.agent.get(first.logical_run_id)).toBe(1);
    expect(counts.evaluator.get(first.logical_run_id)).toBe(1);

    const resumedStorage = new DurableStudyStorage({ studyDir: join(root, "study"), backupDir: join(root, "backup") });
    await runStudy(plan, dependencies(counts), { storage: resumedStorage });
    expect(counts.agent.get(first.logical_run_id)).toBe(1);
    expect(counts.evaluator.get(first.logical_run_id)).toBe(1);
  });

  it("treats a kill between final-tree archive and metadata as incomplete, never as permission to rerun its agent", async () => {
    const root = temp("atomic-tree");
    let killed = false;
    const storage = new DurableStudyStorage({
      studyDir: join(root, "study"),
      backupDir: join(root, "backup"),
      faults: {
        after_file_fsync_before_rename: (relativePath) => {
          if (!killed && relativePath.endsWith("final-tree.json")) {
            killed = true;
            throw new SimulatedProcessKill("killed after final-tree metadata fsync before rename");
          }
        },
      },
    });
    const counts = counter();
    const plan = studyPlan();
    await expect(runStudy(plan, dependencies(counts), { storage })).rejects.toThrow(SimulatedProcessKill);
    const first = plan.logical_runs[0]!;

    const resumedStorage = new DurableStudyStorage({ studyDir: join(root, "study"), backupDir: join(root, "backup") });
    await expect(runStudy(plan, dependencies(counts), { storage: resumedStorage })).rejects.toThrow(/refusing an agent rerun/);
    expect(counts.agent.get(first.logical_run_id)).toBe(1);
    expect(resumedStorage.exists(join("runs", first.logical_run_id, "final-tree.tar.zst"))).toBe(false);
    expect(resumedStorage.exists(join("runs", first.logical_run_id, "final-tree.json"))).toBe(false);
  });
});

describe("CDEB-07 outcome-free progress", () => {
  it("exposes exactly lifecycle and count fields, never an outcome surface", async () => {
    const root = temp("progress");
    const storage = new DurableStudyStorage({ studyDir: join(root, "study"), backupDir: join(root, "backup") });
    const observed: OutcomeFreeProgress[] = [];
    await runStudy(studyPlan(), dependencies(counter()), { storage, progress: (event) => observed.push(event) });
    expect(observed.length).toBeGreaterThan(0);
    for (const event of observed) {
      expect(Object.keys(event).sort()).toEqual([
        "attempt_count", "completed", "logical_run_id", "remaining", "state",
      ]);
      expect(Object.isFrozen(event)).toBe(true);
      expect(JSON.stringify(event)).not.toMatch(/functional|decision_safe|revived|token|usage|aggregate/i);
    }
  });
});
