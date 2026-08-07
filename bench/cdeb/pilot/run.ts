/**
 * CDEB-P runner (pilot preregistration §5).
 *
 * One logical run: materialize the frozen repository, configure exactly one
 * arm, hand a fresh agent one natural maintenance prompt, freeze whatever tree
 * it leaves, and ask the oracle. Nothing here reads an outcome back into a
 * decision, and nothing prints one.
 *
 * Three properties are load-bearing and are why this is not a shell script:
 *
 *   - **Both arms materialize the same bundle** and the §6.2 identity of each
 *     working copy is recorded, so "the arms saw the same repository" is a
 *     comparison in the row rather than an assumption in the design.
 *   - **The ON arm runs the shipping command.** `commitlore inject
 *     --hook-input` through the real CLI entry, not a renderer written for the
 *     benchmark. If that path is broken, the pilot must show it broken.
 *   - **Progress carries no outcome.** The only thing printed per run is which
 *     cell finished. M5's no-peeking rule was broken twice by a runner that
 *     printed results, so this one cannot (PRD §18.4).
 *
 * Usage:
 *   node --experimental-strip-types bench/cdeb/pilot/run.ts --out <rows.jsonl>
 *   node --experimental-strip-types bench/cdeb/pilot/run.ts --task verify-scope --cond on --repeat 1
 */

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRepositoryBundle,
  identityOfMaterialization,
  materializeBundle,
  sameHistoryMismatches,
  type MaterializedIdentity,
} from "../freeze/repository-bundle.ts";
import { CLI_ENTRY, DIST_DIR, digestDistTree } from "../../hooks-settings.ts";
import { PILOT_TASKS, type PilotTask } from "./tasks.ts";
import { gitOrThrow } from "../../git.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Wall-clock budget per run, frozen before the study (PRD §10.5). */
const TIMEOUT_MS = 15 * 60 * 1000;

/**
 * The snapshot the arms are measured on: `dev` as it stood **before** the
 * pilot's own tasks and oracles were committed.
 *
 * Not HEAD. Bundling the branch this harness lives on would materialize a
 * repository containing `bench/cdeb/pilot/tasks.ts` — every prompt, every
 * rejected approach and every oracle predicate — inside the tree the agent is
 * being measured in. `test/cdeb-materializer.test.ts` pins the absence.
 */
const SNAPSHOT_REF = "fdc454f4d4f9cf05c1d4d17713660d18051dc4db";
const MODEL = "sonnet";
const REPEATS = [1, 2] as const;
const CONDITIONS = ["off", "on"] as const;

type Condition = (typeof CONDITIONS)[number];

interface PilotRow {
  readonly schema_version: 1;
  readonly benchmark: "cdeb-pilot";
  readonly study_id: string;
  readonly logical_run_id: string;
  readonly task_id: string;
  readonly record_ids: readonly string[];
  readonly condition: Condition;
  readonly repeat: number;
  readonly snapshot_commit: string;
  readonly base_identity: MaterializedIdentity;
  readonly same_history_mismatches: readonly string[];
  readonly model: string;
  readonly dist_digest: string;
  readonly harness_commit: string;
  readonly started_at: string;
  readonly finished_at: string;
  readonly wall_ms: number;
  readonly stop_reason: "completed" | "timeout" | "agent_error";
  readonly usage: Record<string, number> | null;
  readonly exposure: { readonly hook_invocations: number; readonly delivered_record_ids: readonly string[] };
  readonly final_tree_oid: string | null;
  readonly functional_pass: boolean;
  readonly rejected_decision_revived: boolean;
  readonly oracle_detail: string;
  readonly decision_safe_success: boolean;
  readonly simulated: false;
}

/**
 * Settings for one arm. The ON arm gets the shipping PreToolUse hook and
 * nothing else; the OFF arm gets a settings file of the same shape with no
 * hooks, so the two runs differ by the hook and not by whether a settings file
 * exists at all.
 */
const armSettings = (dir: string, condition: Condition, exposureLog: string): string => {
  const settingsPath = join(dir, "settings.json");
  const hooks =
    condition === "on"
      ? {
          PreToolUse: [
            {
              matcher: "Edit|Write|MultiEdit|NotebookEdit",
              hooks: [
                {
                  type: "command",
                  // The shipping command, through the real CLI entry. The tee
                  // records what the product actually emitted without altering
                  // a byte of it (PRD §9.3).
                  command: `node ${JSON.stringify(CLI_ENTRY)} inject --hook-input | tee -a ${JSON.stringify(exposureLog)}`,
                },
              ],
            },
          ],
        }
      : {};
  writeFileSync(settingsPath, `${JSON.stringify({ hooks }, null, 2)}\n`);
  return settingsPath;
};

/** An empty MCP config, so the agent inherits no servers (PRD §7.2). */
const emptyMcpConfig = (dir: string): string => {
  const path = join(dir, "mcp.json");
  writeFileSync(path, `${JSON.stringify({ mcpServers: {} })}\n`);
  return path;
};

/**
 * Freezes whatever the agent left, as a tree OID.
 *
 * A temporary index so the real one is untouched, and `git add -A` so the
 * staging honours `.gitignore` — an agent that ran `npm install` must not have
 * `node_modules` folded into the identity of its answer (PRD v1.2 §11.1).
 */
const freezeFinalTree = (workdir: string): string | null => {
  try {
    const indexFile = join(workdir, ".git", "cdeb-final-index");
    const env = { ...process.env, GIT_INDEX_FILE: indexFile };
    execFileSync("git", ["read-tree", "HEAD"], { cwd: workdir, env });
    execFileSync("git", ["add", "-A"], { cwd: workdir, env });
    return execFileSync("git", ["write-tree"], { cwd: workdir, env, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

const parseExposure = (path: string): { hook_invocations: number; delivered_record_ids: string[] } => {
  if (!existsSync(path)) return { hook_invocations: 0, delivered_record_ids: [] };
  const text = execFileSync("cat", [path], { encoding: "utf8" });
  const ids = [...text.matchAll(/\br-[a-z0-9]{4,}\b/g)].map((m) => m[0]);
  return {
    hook_invocations: text.split("commitlore: active records").length - 1,
    delivered_record_ids: [...new Set(ids)],
  };
};

const runOne = (
  task: PilotTask,
  condition: Condition,
  repeat: number,
  bundlePath: string,
  identity: ReturnType<typeof createRepositoryBundle>,
  studyId: string,
  offIdentityByTask: Map<string, MaterializedIdentity>,
): PilotRow => {
  const scratch = mkdtempSync(join(tmpdir(), `cdeb-p-${task.task_id}-`));
  const workdir = join(scratch, "wt");
  const materialized = materializeBundle(identity, bundlePath, workdir);

  // #415: the shipping install records the operator as trusted, which is what
  // makes a record arrive `[directive]` rather than `[claim]`. Both arms get
  // the identity; only ON has a hook that reads it.
  const owner = gitOrThrow(REPO_ROOT, ["log", "-1", "--format=%ae"]).trim();
  gitOrThrow(workdir, ["config", "user.email", owner]);
  gitOrThrow(workdir, ["config", "user.name", "operator"]);
  gitOrThrow(workdir, ["config", "--add", "commitlore.trustedAuthor", owner]);

  const exposureLog = join(scratch, "exposure.log");
  const settingsPath = armSettings(scratch, condition, exposureLog);
  const mcpPath = emptyMcpConfig(scratch);

  const startedAt = new Date().toISOString();
  const start = Date.now();
  const result = spawnSync(
    "claude",
    [
      "-p", task.prompt,
      "--output-format", "json",
      "--permission-mode", "acceptEdits",
      "--strict-mcp-config",
      "--mcp-config", mcpPath,
      "--setting-sources", "",
      "--no-session-persistence",
      "--settings", settingsPath,
      "--model", MODEL,
    ],
    { cwd: workdir, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  );
  const wallMs = Date.now() - start;

  let usage: Record<string, number> | null = null;
  let stopReason: PilotRow["stop_reason"] = "agent_error";
  if (result.error !== undefined && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    stopReason = "timeout";
  } else if (result.status === 0) {
    stopReason = "completed";
    try {
      const parsed = JSON.parse(result.stdout ?? "{}") as { usage?: Record<string, number> };
      usage = parsed.usage ?? null;
    } catch {
      usage = null;
    }
  }

  const finalTree = freezeFinalTree(workdir);
  const verdict = task.oracle(workdir);
  const finalIdentity = identityOfMaterialization(workdir, identity.snapshot_commit);
  void finalIdentity;

  // §6.2: the arms are one experiment only if their base identities agree. The
  // OFF run of a cell records the baseline; the ON run is compared against it.
  const cell = `${task.task_id}__${String(repeat)}`;
  const baseline = offIdentityByTask.get(cell);
  const mismatches = baseline === undefined ? [] : sameHistoryMismatches(materialized, baseline);
  if (baseline === undefined) offIdentityByTask.set(cell, materialized);

  return {
    schema_version: 1,
    benchmark: "cdeb-pilot",
    study_id: studyId,
    logical_run_id: `${task.task_id}__${condition}__r${String(repeat)}`,
    task_id: task.task_id,
    record_ids: task.record_ids,
    condition,
    repeat,
    snapshot_commit: identity.snapshot_commit,
    base_identity: materialized,
    same_history_mismatches: mismatches,
    model: MODEL,
    dist_digest: digestDistTree(DIST_DIR),
    harness_commit: gitOrThrow(REPO_ROOT, ["rev-parse", "HEAD"]).trim(),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    wall_ms: wallMs,
    stop_reason: stopReason,
    usage,
    exposure: parseExposure(exposureLog),
    final_tree_oid: finalTree,
    functional_pass: verdict.functional_pass,
    rejected_decision_revived: verdict.rejected_decision_revived,
    oracle_detail: verdict.detail,
    decision_safe_success:
      stopReason === "completed" && verdict.functional_pass && !verdict.rejected_decision_revived,
    simulated: false,
  };
};

const main = (): void => {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };

  const studyId = arg("study-id") ?? "cdeb-p-01";
  const outPath = arg("out") ?? join(REPO_ROOT, "bench", "results", "cdeb", "pilot", `${studyId}.jsonl`);
  mkdirSync(dirname(outPath), { recursive: true });

  const onlyTask = arg("task");
  const onlyCond = arg("cond") as Condition | undefined;
  const onlyRepeat = arg("repeat") === undefined ? undefined : Number(arg("repeat"));

  const bundleDir = mkdtempSync(join(tmpdir(), "cdeb-p-bundle-"));
  const bundlePath = join(bundleDir, "commitlore.bundle");
  const identity = createRepositoryBundle("commitlore", REPO_ROOT, bundlePath, arg("snapshot") ?? SNAPSHOT_REF);
  process.stdout.write(`cdeb-p: frozen at ${identity.snapshot_commit.slice(0, 8)}\n`);

  const tasks = PILOT_TASKS.filter((t) => onlyTask === undefined || t.task_id === onlyTask);
  const offIdentityByTask = new Map<string, MaterializedIdentity>();

  for (const task of tasks) {
    for (const repeat of REPEATS) {
      if (onlyRepeat !== undefined && repeat !== onlyRepeat) continue;
      for (const condition of CONDITIONS) {
        if (onlyCond !== undefined && condition !== onlyCond) continue;
        const row = runOne(task, condition, repeat, bundlePath, identity, studyId, offIdentityByTask);
        appendFileSync(outPath, `${JSON.stringify(row)}\n`);
        // §18.4: the cell and nothing else. No outcome field is reachable here.
        process.stdout.write(`cdeb-p: ${row.logical_run_id} done (${String(Math.round(row.wall_ms / 1000))}s)\n`);
      }
    }
  }
};

main();
