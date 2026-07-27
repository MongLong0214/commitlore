import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";

import { assembleContext, collectRuledOutAlternatives } from "./context.ts";
import { digestCli, HOOK_PLANS, writeArmSettings } from "./hooks-settings.ts";
import { countViolations, evaluateGroup } from "./detect.ts";
import { createDriver, DRIVER_NAMES } from "./drivers/registry.ts";
import type { DriverResult } from "./drivers/types.ts";
import { readCommits } from "./git.ts";
import { loadTasks } from "./task-loader.ts";
import type { ConditionSpec, RunRecord, Task } from "./types.ts";
import { CONDITIONS, PRIMARY_CONDITIONS, SUPPORTED_CONDITIONS } from "./types.ts";
import { collectSurfaces, createWorkspace, destroyWorkspace } from "./workspace.ts";

const BENCH_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(BENCH_DIR, "..");
const DEFAULT_MAX_TOKENS = 500_000;
const DEFAULT_TIMEOUT_MS = 600_000;

const resolveHarnessCommit = (): string => {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  if (commit === "") throw new Error("git rev-parse HEAD returned an empty harness commit");
  return commit;
};

interface RunnerOptions {
  readonly tasks: string;
  readonly task?: string;
  readonly cond: string;
  readonly seed: string;
  readonly driver: string;
  readonly out?: string;
  readonly maxTokens: string;
  readonly maxTurns?: string;
  readonly timeoutMs: string;
  readonly model?: string;
  readonly permissionMode?: string;
  readonly keep?: boolean;
  readonly saveTranscripts?: string;
}

const makeRunId = (): string => {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
};

const parseIntOption = (name: string, raw: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer, got "${raw}"`);
  return value;
};

const parseSeeds = (raw: string): readonly number[] => {
  const seeds = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const value = Number(part);
      if (!Number.isInteger(value)) throw new Error(`--seed must be integers, got "${part}"`);
      return value;
    });
  if (seeds.length === 0) throw new Error("--seed must name at least one seed");
  return seeds;
};

/**
 * `both` is the primary comparison and `all` is every arm that exists.
 *
 * Until T-703 these were the same list, because the ablation arms were
 * `planned` and "supported" meant "one of the two v0.1 arms". They are spelled
 * out separately now: `--cond both` still runs the two arms of the registered
 * hypothesis test, and a re-run of the M1 matrix costs what it cost before.
 */
const expandAlias = (raw: string): readonly string[] => {
  if (raw === "both") return PRIMARY_CONDITIONS;
  if (raw === "all") return SUPPORTED_CONDITIONS;
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
};

const resolveConditions = (raw: string): readonly ConditionSpec[] => {
  const requested = expandAlias(raw);
  if (requested.length === 0) throw new Error("--cond must name at least one condition");

  const seen = new Set<string>();
  return requested.map((id) => {
    const condition = CONDITIONS[id];
    if (condition === undefined) {
      throw new Error(`unknown condition \`${id}\` (known: ${Object.keys(CONDITIONS).join(", ")})`);
    }
    if (condition.status !== "supported") {
      throw new Error(
        `condition \`${id}\` is registered but not implemented: ${condition.description}`,
      );
    }
    // A duplicate would double one arm's weight in every rate derived from the
    // file, and nothing downstream can tell that from a genuinely larger arm.
    if (seen.has(id)) throw new Error(`--cond names \`${id}\` more than once`);
    seen.add(id);
    return condition;
  });
};

/**
 * Records in the repository the agent is about to be handed — CPAA's
 * denominator (`RunRecord.accepted_records`).
 *
 * Read after seeding and **before** the driver runs: a record the agent writes
 * during its own run is not one the harvest pipeline paid to produce, and
 * counting it would shrink a cost-per-record that nothing had spent. One
 * commit carrying at least one trailer is one record, which is the unit
 * `context.ts` assembles from.
 */
const countSeededRecords = (dir: string): number =>
  readCommits(dir).filter((commit) => commit.trailers.length > 0).length;

const selectTasks = (all: readonly Task[], filter: string | undefined): readonly Task[] => {
  if (filter === undefined) return all;
  const wanted = new Set(
    filter
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
  );
  const selected = all.filter((task) => wanted.has(task.id));
  const missing = [...wanted].filter((id) => !all.some((task) => task.id === id));
  if (missing.length > 0) throw new Error(`no such task: ${missing.join(", ")}`);
  if (selected.length === 0) throw new Error("--task selected nothing");
  return selected;
};

const literalViolationTokens = (task: Task): readonly string[] => {
  const group = task.detect.violation_if;
  if (group === undefined) return [];
  return [...(group.any_of ?? []), ...(group.all_of ?? [])]
    .filter((matcher) => matcher.kind === "literal")
    .map((matcher) => matcher.value);
};

const main = async (): Promise<number> => {
  const program = new Command();
  program
    .name("commitlorebench")
    .description("Run the CommitLore re-proposal benchmark and write one JSONL row per run")
    .option("--tasks <dir>", "task directory", path.join(BENCH_DIR, "tasks"))
    .option("--task <ids>", "comma-separated task ids to run (default: all)")
    .option(
      "--cond <list>",
      `\`both\` (${PRIMARY_CONDITIONS.join(", ")}), \`all\` (${SUPPORTED_CONDITIONS.length} arms), ` +
        `or a comma-separated list of ${SUPPORTED_CONDITIONS.join(", ")}`,
      "both",
    )
    .option("--seed <list>", "comma-separated integer seeds", "1")
    .option("--driver <name>", `agent driver (${DRIVER_NAMES.join(", ")})`, "dry-run")
    .option("--out <file>", "JSONL output path (default: bench/results/<run-id>.jsonl)")
    .option("--max-tokens <n>", "global token cap across the whole invocation", String(DEFAULT_MAX_TOKENS))
    .option("--max-turns <n>", "override every task's turn budget")
    .option("--timeout-ms <n>", "per-run wall-clock timeout", String(DEFAULT_TIMEOUT_MS))
    .option("--model <name>", "model passed through to the agent driver")
    .option("--permission-mode <mode>", "permission mode passed through to the agent driver")
    .option("--keep", "keep the temporary workspaces and print their paths")
    .option("--save-transcripts <dir>", "write each run's transcript, diff and commits for auditing")
    .parse();

  const options = program.opts<RunnerOptions>();
  const conditions = resolveConditions(options.cond);
  const seeds = parseSeeds(options.seed);
  const tasks = selectTasks(loadTasks(path.resolve(options.tasks)), options.task);
  const maxTokens = parseIntOption("max-tokens", options.maxTokens);
  const timeoutMs = parseIntOption("timeout-ms", options.timeoutMs);
  const turnsOverride = options.maxTurns === undefined ? null : parseIntOption("max-turns", options.maxTurns);

  const driver = createDriver(options.driver, {
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.permissionMode === undefined ? {} : { permissionMode: options.permissionMode }),
  });
  const harnessCommit = resolveHarnessCommit();
  const cliDigest = digestCli();

  const runId = makeRunId();
  const outPath = path.resolve(options.out ?? path.join(BENCH_DIR, "results", `${runId}.jsonl`));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (fs.existsSync(outPath)) process.stderr.write(`! overwriting ${outPath}\n`);
  fs.writeFileSync(outPath, "");

  if (driver.simulated) {
    process.stderr.write(
      `\n!! driver "${driver.name}" fabricates transcripts. Every row is marked simulated:true and is NOT a measurement.\n\n`,
    );
  }

  const total = seeds.length * tasks.length * conditions.length;

  // Printed before the first run, not inferred from the row labels afterwards.
  // `--cond all` went from two arms to five when T-703 landed, and against a
  // live driver the difference between those two invocations is money — so the
  // resolved arms and the run count are stated while there is still time to
  // interrupt.
  process.stderr.write(
    `conditions ${conditions.map((condition) => condition.id).join(", ")}\n` +
      `runs       ${total} (${seeds.length} seed(s) x ${tasks.length} task(s) x ${conditions.length} condition(s))\n\n`,
  );

  const kept: string[] = [];
  let index = 0;
  let tokensUsed = 0;
  let errors = 0;

  // Seed-major, then task, then condition: the arms of one comparison run back
  // to back, so exhausting the token cap costs at most one half-finished pair
  // rather than starving whichever condition was scheduled last. Skipped runs
  // are still written out, so the analysis can drop unpaired rows.
  for (const seed of seeds) {
    for (const task of tasks) {
      for (const condition of conditions) {
        index += 1;
        const startedAt = new Date().toISOString();
        const started = Date.now();
        const label = `[${index}/${total}] ${task.id} ${condition.id} seed=${seed}`;
        const remaining = maxTokens - tokensUsed;

        if (remaining <= 0) {
          const record: RunRecord = {
            run_id: runId,
            harness_commit: harnessCommit,
            cli_digest: cliDigest,
            task: task.id,
            cond: condition.id,
            seed,
            reproposed: false,
            violations: 0,
            turns: 0,
            tokens: 0,
            stopped_by: "over-tokens",
            duration_ms: 0,
            driver: driver.name,
            started_at: startedAt,
            simulated: driver.simulated,
            error: `global token cap of ${maxTokens} exhausted before this run started`,
          };
          fs.appendFileSync(outPath, `${JSON.stringify(record)}\n`);
          process.stderr.write(`${label} skipped — global token cap reached\n`);
          continue;
        }

        let workspaceDir: string | null = null;
        let record: RunRecord;
        try {
          const workspace = createWorkspace(task, seed, REPO_ROOT, { seedRecords: condition.seed_records });
          workspaceDir = workspace.dir;
          const acceptedRecords = countSeededRecords(workspace.dir);
          // Two delivery paths, and the arm decides. A hook plan runs the
          // shipped injector per edit, path-scoped, the way the product does;
          // without one the arm falls back to the harness's session-start
          // block. See bench/hooks-settings.ts (#36).
          const plan = HOOK_PLANS[condition.id] ?? {};
          const settingsPath = writeArmSettings(plan, cliDigest);
          const injectedContext =
            settingsPath === null ? assembleContext(workspace.dir, condition) : null;
          const result: DriverResult = await driver.run({
            taskId: task.id,
            condition: condition.id,
            prompt: task.prompt,
            injectedContext,
            workspace: workspace.dir,
            seed,
            maxTurns: Math.min(task.budget.turns, turnsOverride ?? task.budget.turns),
            maxTokens: Math.min(task.budget.tokens, remaining),
            timeoutMs,
            ...(settingsPath === null ? {} : { settingsPath }),
            simulation: {
              ruledOutAlternatives: collectRuledOutAlternatives(task, REPO_ROOT),
              violationTokens: literalViolationTokens(task),
            },
          });

          const surfaces = collectSurfaces(workspace, result.transcript);
          const reproposed = evaluateGroup(task.detect.reproposed_if, surfaces);
          const violations = countViolations(task.detect.violation_if, surfaces);

          // A detector verdict nobody can re-read is a verdict nobody can
          // challenge — and a bare literal cannot tell "use Redis" from
          // "Redis was ruled out, so I will not".
          if (options.saveTranscripts !== undefined) {
            const dir = path.resolve(options.saveTranscripts);
            fs.mkdirSync(dir, { recursive: true });
            const name = `${runId}__${task.id}__${condition.id}__seed${seed}.json`;
            fs.writeFileSync(
              path.join(dir, name),
              `${JSON.stringify(
                {
                  run_id: runId,
                  task: task.id,
                  cond: condition.id,
                  seed,
                  reproposed: reproposed.matched,
                  matched: [...reproposed.labels, ...violations.labels],
                  injected_context: injectedContext,
                  ...surfaces,
                },
                null,
                2,
              )}\n`,
            );
          }
          tokensUsed += result.tokens;
          if (result.stoppedBy === "error") errors += 1;

          record = {
            run_id: runId,
            harness_commit: harnessCommit,
            cli_digest: cliDigest,
            task: task.id,
            cond: condition.id,
            seed,
            reproposed: reproposed.matched,
            violations: violations.labels.length,
            turns: result.turns,
            tokens: result.tokens,
            stopped_by: result.stoppedBy,
            duration_ms: Date.now() - started,
            driver: driver.name,
            started_at: startedAt,
            simulated: driver.simulated,
            matched: [...reproposed.labels, ...violations.labels],
            accepted_records: acceptedRecords,
            ...(result.error === undefined ? {} : { error: result.error }),
          };
        } catch (error) {
          errors += 1;
          record = {
            run_id: runId,
            harness_commit: harnessCommit,
            cli_digest: cliDigest,
            task: task.id,
            cond: condition.id,
            seed,
            reproposed: false,
            violations: 0,
            turns: 0,
            tokens: 0,
            stopped_by: "error",
            duration_ms: Date.now() - started,
            driver: driver.name,
            started_at: startedAt,
            simulated: driver.simulated,
            error: (error as Error).message,
          };
        } finally {
          if (workspaceDir !== null) {
            if (options.keep === true) kept.push(workspaceDir);
            else destroyWorkspace(workspaceDir);
          }
        }

        fs.appendFileSync(outPath, `${JSON.stringify(record)}\n`);
        process.stderr.write(
          `${label} reproposed=${record.reproposed} violations=${record.violations} ` +
            `turns=${record.turns} tokens=${record.tokens} stopped_by=${record.stopped_by}\n`,
        );
      }
    }
  }

  process.stderr.write(`\nrun_id ${runId}\n`);
  process.stderr.write(`rows   ${total} -> ${outPath}\n`);
  process.stderr.write(`tokens ${tokensUsed}/${maxTokens}\n`);
  if (kept.length > 0) process.stderr.write(`kept   ${kept.join("\n       ")}\n`);
  if (errors > 0) process.stderr.write(`errors ${errors}\n`);
  return errors > 0 ? 1 : 0;
};

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`commitlorebench: ${(error as Error).message}\n`);
    process.exitCode = 1;
  },
);
