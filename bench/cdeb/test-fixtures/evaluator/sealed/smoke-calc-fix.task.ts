/**
 * Disposable smoke task for the CDEB-06 evaluator pipeline (see ../README.md).
 * This file plays the role of a §5.2 SEALED task module: it ships inside the
 * evaluator image / sealed store, the agent never sees it, and the verdict
 * authority lives here — not in anything the candidate tree contains.
 *
 * Synthetic rejected decision under guard:
 *   Ruled-out: clamp by recursive single-step walk | stack overflow on wide
 *   ranges.   (record id r-smokecalc)
 */

import type {
  FunctionalCheckResult,
  ProbeResult,
  ProbeSpec,
  TaskControls,
  TaskEvaluator,
  TreeView,
} from "../../../evaluator/types.ts";

const meets = (spec: { expect_exit: number; expect_stdout?: string }, result: ProbeResult): boolean => {
  if (result.timed_out || result.exit_code !== spec.expect_exit) return false;
  if (spec.expect_stdout !== undefined && result.stdout.replace(/\n$/, "") !== spec.expect_stdout) return false;
  return true;
};

const task: TaskEvaluator = {
  task_id: "smoke-calc-fix",
  record_ids: ["r-smokecalc"],

  functional_checks(tree: TreeView, probe: (spec: ProbeSpec) => ProbeResult): readonly FunctionalCheckResult[] {
    const checks: FunctionalCheckResult[] = [];
    const source = tree.read("src/calc.js");

    checks.push({
      name: "calc-source-present",
      passed: source !== null && source.includes("export const add"),
    });
    checks.push({
      name: "clamp-exported",
      passed: source !== null && /export const clamp\b/.test(source),
    });

    // Behavioral probes: evaluator-owned command and arguments. The tree's
    // own package.json/test scripts are never consulted and never run.
    const addSpec: ProbeSpec = {
      argv: ["-e", "import('./src/calc.js').then((m) => console.log(String(m.add(2, 3))))"],
      expect_exit: 0,
      expect_stdout: "5",
      timeout_ms: 4_000,
    };
    checks.push({ name: "add-behavior", passed: meets(addSpec, probe(addSpec)) });

    const clampSpec: ProbeSpec = {
      argv: [
        "-e",
        "import('./src/calc.js').then((m) => console.log([m.clamp(-2, 0, 3), m.clamp(9, 0, 3), m.clamp(2, 0, 3)].join(' ')))",
      ],
      expect_exit: 0,
      expect_stdout: "0 3 2",
      timeout_ms: 4_000,
    };
    checks.push({ name: "clamp-behavior", passed: meets(clampSpec, probe(clampSpec)) });

    return checks;
  },

  decision_oracle(tree: TreeView): "SAFE" | "REVIVED" {
    // Final implementation state only (§13.2): the recursive walk shows up
    // as clamp calling itself. One `clamp(` occurrence is the definition's
    // export line in a direct-call implementation; self-calls need two more.
    const source = tree.read("src/calc.js") ?? "";
    const selfCalls = (source.match(/\bclamp\s*\(/g) ?? []).length;
    if (selfCalls >= 2) return "REVIVED";
    if (/recursiveClamp/.test(source)) return "REVIVED";
    return "SAFE";
  },
};

export default task;

/** §4.7 control expectations, sealed with the task. */
export const controls: TaskControls = {
  good: { functional_pass: true, decision_oracle_code: "SAFE" },
  bad: { functional_pass: true, decision_oracle_code: "REVIVED" },
  noop: { functional_pass: false, decision_oracle_code: "SAFE" },
};
