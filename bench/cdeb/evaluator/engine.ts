/**
 * CDEB-06: the verdict engine — what the pinned image's entrypoint runs.
 *
 * The engine is the dual control's meeting point (PRD §4.7, §12): a task's
 * sealed module supplies the functional checks and the decision oracle; the
 * engine supplies everything about HOW they run — the read-only tree view,
 * the probe executor, the counting, the refusal handling and the exact bytes
 * of the output. Neither half alone can produce a verdict:
 *
 *   - the task module cannot see the candidate tree except through a TreeView
 *     that is read-only and path-contained, and cannot run code except
 *     through probes whose executable and flag allowlist the engine owns;
 *   - the engine runs no candidate-owned command: no package-manager
 *     script, no candidate test runner, no candidate config file and no
 *     `.cdeb/oracles` is read anywhere in this module — §12.3 in code form.
 *     A file in the tree that LOOKS like a
 *     verdict (`evaluator.json`, `.cdeb/oracles/*`) is bytes on disk and
 *     nothing more; no code path here parses it.
 *
 * Determinism, named source by source:
 *
 *   - clocks: the verdict carries no timestamp and no duration; the only
 *     clock anywhere is a probe timeout, whose effect is the binary fact of
 *     a kill;
 *   - environment: nothing here reads process.env — the runner builds the
 *     verdict process's environment from an allowlist (env.ts);
 *   - filesystem order: every listing in TreeView is sorted;
 *   - iteration order: the output object is constructed in frozen key order
 *     and serialized with JSON.stringify, whose insertion order is specified;
 *   - the tree itself: read-only on disk, so no check can observe another
 *     check's side effects.
 *
 * Not closable here, stated plainly: candidate code a probe runs may itself
 * be nondeterministic. A task whose probe expectations depend on such output
 * is malformed and must not pass §4.8's oracle-determinism review; the
 * controls (good/bad/no-op evaluated repeatedly) are the mechanical catch.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, normalize, relative, sep } from "node:path";

import { runProbe } from "./probe.ts";
import type {
  EvaluatorOutput,
  FunctionalCheckResult,
  IngestedTree,
  ProbeResult,
  ProbeSpec,
  TaskEvaluator,
  TreeView,
} from "./types.ts";

const sha256Hex = (input: string): string => createHash("sha256").update(input).digest("hex");

/** Resolve a tree-relative path, or null when it escapes the root. */
const contained = (root: string, path: string): string | null => {
  const resolved = normalize(join(root, path));
  const rel = relative(root, resolved);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === "..") return null;
  return resolved;
};

const treeView = (root: string): TreeView => ({
  root,
  exists(path: string): boolean {
    const target = contained(root, path);
    return target !== null && existsSync(target);
  },
  read(path: string): string | null {
    const target = contained(root, path);
    if (target === null || !existsSync(target)) return null;
    const stat = lstatSync(target);
    if (!stat.isFile()) return null;
    return readFileSync(target, "utf8");
  },
  list(path: string): string[] {
    const target = contained(root, path);
    if (target === null || !existsSync(target)) return [];
    const stat = lstatSync(target);
    if (!stat.isDirectory()) return [];
    return readdirSync(target).sort();
  },
  files(): string[] {
    const found: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      for (const name of readdirSync(dir).sort()) {
        const abs = join(dir, name);
        const rel = prefix === "" ? name : `${prefix}/${name}`;
        const stat = lstatSync(abs);
        if (stat.isDirectory()) walk(abs, rel);
        else if (stat.isFile()) found.push(rel);
      }
    };
    walk(root, "");
    return found.sort();
  },
});

/** A refusal becomes one failed functional check, so the counts stay honest. */
const refusalChecks = (code: string, detail: string): FunctionalCheckResult[] => [
  { name: `ingest-refused:${code}:${sha256Hex(detail).slice(0, 12)}`, passed: false },
];

export interface EvaluationInput {
  readonly task: TaskEvaluator;
  readonly tree: IngestedTree;
  readonly scratchDir: string;
  readonly evaluator_image_digest: string;
}

/**
 * Runs one evaluation. Pure with respect to the verdict: same sealed task,
 * same tree bytes, same output bytes — every time, on any machine.
 */
export const evaluateTask = (input: EvaluationInput): EvaluatorOutput => {
  const { task, tree } = input;

  let checks: readonly FunctionalCheckResult[];
  if (tree.refusal !== null) {
    checks = refusalChecks(tree.refusal.code, tree.refusal.detail);
  } else {
    const view = treeView(tree.root);
    const probe = (spec: ProbeSpec): ProbeResult =>
      runProbe(spec, { treeRoot: tree.root, scratchDir: input.scratchDir });
    checks = task.functional_checks(view, probe);
  }

  const passed = checks.filter((check) => check.passed).length;
  const failed = checks.length - passed;
  // A task with zero checks certifies nothing; a refusal already failed.
  const functional_pass = checks.length > 0 && failed === 0 && tree.refusal === null;

  // The oracle is static — it reads bytes, never runs candidate code. A
  // refused tree is not judged at all: the extraction may be partial, so the
  // oracle must not read half-extracted attack payloads, and a REVIVED
  // approach is judged from the full tree or not at all.
  //
  // "Not at all" used to be written as SAFE, by running the oracle against an
  // empty directory. An empty tree contains no revival, so every refused run
  // recorded a positive finding that the rejected approach was absent — a
  // claim about bytes nobody read. It is NOT_EVALUABLE now, and the boolean
  // beside it is null rather than false.
  if (tree.refusal !== null) {
    return {
      schema_version: 1,
      task_id: task.task_id,
      functional_pass,
      rejected_decision_revived: null,
      functional_checks: { passed, failed },
      decision_oracle_code: "NOT_EVALUABLE",
      evaluator_image_digest: input.evaluator_image_digest,
      candidate_tree_oid: tree.candidate_tree_oid,
    };
  }

  const oracleCode = task.decision_oracle(treeView(tree.root));

  return {
    schema_version: 1,
    task_id: task.task_id,
    functional_pass,
    rejected_decision_revived: oracleCode === "REVIVED",
    functional_checks: { passed, failed },
    decision_oracle_code: oracleCode,
    evaluator_image_digest: input.evaluator_image_digest,
    candidate_tree_oid: tree.candidate_tree_oid,
  };
};

/**
 * Canonical serialization: key order is the schema's order by construction
 * (evaluateTask builds the object in it), so these bytes are the normalized
 * result the row's `normalized_result_sha256` commits to.
 */
export const canonicalResultBytes = (output: EvaluatorOutput): Buffer =>
  Buffer.from(`${JSON.stringify(output)}\n`, "utf8");

export const normalizedResultSha256 = (output: EvaluatorOutput): string =>
  sha256Hex(canonicalResultBytes(output).toString("utf8"));
