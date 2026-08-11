/**
 * CDEB-06: the evaluator entrypoint — what `/cdeb/evaluate` runs inside the
 * pinned image (PRD §12.1: `task_entrypoint: ["/cdeb/evaluate", "<task>"]`).
 *
 * Contract:
 *
 *   evaluate --tasks <sealed-task-dir> --task <task-id> --tree <archive>
 *            [--claimed-oid <40-hex>] [--image-digest sha256:<64-hex>]
 *
 *   stdout: exactly the canonical verdict JSON (evaluator.schema.json) plus a
 *   newline, and nothing else — no progress, no outcome commentary (§18.4's
 *   no-peeking rule reaches the evaluator too).
 *
 *   exit 0: a verdict was produced (PASS or FAIL alike — a FAIL is a result,
 *           not an error; §10.3 retries are for infrastructure failures).
 *   exit 2: infrastructure failure — unreadable archive, unknown task,
 *           malformed sealed module. The orchestrator retries the SAME tree
 *           (§10.3); a persistent exit 2 leaves the matrix incomplete rather
 *           than inventing a verdict.
 *
 * Trust boundaries enforced here:
 *
 *   - the sealed task directory must exist and must NOT be inside the
 *     candidate tree (and the tree must not be inside it) — a tree mounted
 *     as its own oracle source is the forgery this check exists to catch;
 *   - the task module is loaded from the sealed directory only; its task_id
 *     must equal the requested one;
 *   - the archive is read, ingested through the hygiene gate, and its tree
 *     OID recomputed; a claimed OID is compared, never adopted.
 */

import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { ingestFinalTree } from "./ingest.ts";
import { evaluateTask, canonicalResultBytes } from "./engine.ts";
import type { EvaluatorOutput, TaskEvaluator } from "./types.ts";

const USAGE = "evaluate --tasks <sealed-task-dir> --task <task-id> --tree <archive> [--claimed-oid <oid>] [--image-digest sha256:<hex>]";

interface ParsedArgs {
  tasksDir: string;
  taskId: string;
  treeArchive: string;
  claimedOid?: string;
  imageDigest: string;
}

const parseArgs = (argv: readonly string[]): ParsedArgs | string => {
  let tasksDir = "";
  let taskId = "";
  let treeArchive = "";
  let claimedOid: string | undefined;
  let imageDigest = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = (): string => {
      i += 1;
      const value = argv[i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      return value;
    };
    try {
      if (arg === "--tasks") tasksDir = next();
      else if (arg === "--task") taskId = next();
      else if (arg === "--tree") treeArchive = next();
      else if (arg === "--claimed-oid") claimedOid = next();
      else if (arg === "--image-digest") imageDigest = next();
      else return `unknown argument ${arg}`;
    } catch (error) {
      return (error as Error).message;
    }
  }
  if (tasksDir === "" || taskId === "" || treeArchive === "") return USAGE;
  if (claimedOid !== undefined && !/^[0-9a-f]{40}$/.test(claimedOid)) return "claimed-oid must be 40 lowercase hex chars";
  return claimedOid === undefined
    ? { tasksDir, taskId, treeArchive, imageDigest }
    : { tasksDir, taskId, treeArchive, claimedOid, imageDigest };
};

const isWithin = (maybeChild: string, maybeParent: string): boolean => {
  const rel = relative(maybeParent, maybeChild);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
};

const looksLikeTask = (value: unknown): value is TaskEvaluator => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.task_id === "string" &&
    Array.isArray(candidate.record_ids) &&
    typeof candidate.functional_checks === "function" &&
    typeof candidate.decision_oracle === "function"
  );
};

export const main = async (argv: readonly string[]): Promise<number> => {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    process.stderr.write(`${parsed}\n`);
    return 2;
  }

  if (!existsSync(parsed.tasksDir) || !existsSync(parsed.treeArchive)) {
    process.stderr.write("evaluate: sealed task dir or tree archive missing\n");
    return 2;
  }

  const tasksDir = realpathSync(parsed.tasksDir);
  const scratch = mkdtempSync(join(tmpdir(), "cdeb-eval-"));

  let archiveBytes: Buffer;
  try {
    archiveBytes = readFileSync(parsed.treeArchive);
  } catch (error) {
    process.stderr.write(`evaluate: cannot read archive: ${(error as Error).message}\n`);
    return 2;
  }

  const tree = ingestFinalTree(
    archiveBytes,
    join(scratch, "ingest"),
    parsed.claimedOid === undefined ? {} : { claimedOid: parsed.claimedOid },
  );

  // The sealed store and the candidate tree must be disjoint. Checked after
  // extraction so the tree's real location is known.
  if (tree.refusal === null) {
    if (isWithin(tasksDir, tree.root) || isWithin(tree.root, tasksDir)) {
      process.stderr.write("evaluate: sealed task store and candidate tree overlap — refusing\n");
      return 2;
    }
  }

  const modulePath = join(tasksDir, `${parsed.taskId}.task.ts`);
  if (!existsSync(modulePath)) {
    process.stderr.write(`evaluate: no sealed task module for ${parsed.taskId}\n`);
    return 2;
  }

  let task: TaskEvaluator;
  try {
    const loaded = (await import(pathToFileURL(modulePath).href)) as { default?: unknown };
    if (!looksLikeTask(loaded.default)) {
      process.stderr.write(`evaluate: ${parsed.taskId}.task.ts does not export a TaskEvaluator\n`);
      return 2;
    }
    task = loaded.default;
  } catch (error) {
    process.stderr.write(`evaluate: cannot load sealed task module: ${(error as Error).message}\n`);
    return 2;
  }
  if (task.task_id !== parsed.taskId) {
    process.stderr.write(`evaluate: module task_id ${task.task_id} does not match requested ${parsed.taskId}\n`);
    return 2;
  }

  let output: EvaluatorOutput;
  try {
    output = evaluateTask({
      task,
      tree,
      scratchDir: join(scratch, "engine"),
      evaluator_image_digest: parsed.imageDigest,
    });
  } catch (error) {
    // A sealed task that passed review should never throw; if one does, that
    // is an infrastructure failure, and inventing a verdict would be worse.
    process.stderr.write(`evaluate: engine failure: ${(error as Error).message}\n`);
    return 2;
  }

  process.stdout.write(canonicalResultBytes(output));
  return 0;
};

// Direct invocation (image entrypoint or local runner). Import-only use
// (tests) never reaches this.
const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`evaluate: fatal: ${(error as Error).message}\n`);
      process.exit(2);
    },
  );
}
