/**
 * CDEB-06: contracts for the immutable evaluator (PRD §12).
 *
 * Everything here serves one property: the agent that produced the candidate
 * tree is an UNTRUSTED AUTHOR of it. It can write anything — a test that
 * passes trivially, a stub that satisfies a matcher, a file that pretends to
 * be the evaluator's own output. So:
 *
 *   - the evaluator's code and task oracles come from the pinned image / sealed
 *     task store, never from the candidate tree;
 *   - nothing the candidate wrote is executed with the evaluator's authority
 *     (no package.json scripts, no candidate test runners, no candidate
 *     config — §12.3);
 *   - the verdict is derived from what the pinned harness observes — the
 *     evaluator's own functional checks and decision oracle reading a
 *     read-only extraction of the tree — never from anything the tree reports
 *     about itself.
 *
 * The verdict shape is frozen by `bench/cdeb/schemas/evaluator.schema.json`
 * (PRD §12.4): no free-form quality score is representable, and no field
 * exists for the candidate to influence beyond what the checks observed.
 */

/** The frozen §12.4 output. Key order here is the canonical serialization order. */
export interface EvaluatorOutput {
  readonly schema_version: 1;
  readonly task_id: string;
  readonly functional_pass: boolean;
  /**
   * Null when the decision could not be judged at all -- see
   * `decision_oracle_code`. It is not `false`, because `false` is the positive
   * claim that the rejected approach is absent from the tree, and a tree the
   * evaluator could not read supports no such claim.
   */
  readonly rejected_decision_revived: boolean | null;
  readonly functional_checks: {
    readonly passed: number;
    readonly failed: number;
  };
  /**
   * `NOT_EVALUABLE` when the tree was refused: the extraction may be partial,
   * so the oracle is not run at all rather than run against what arrived. The
   * older shape had no third value and recorded these as `SAFE`, which counted
   * an unread tree as evidence that nothing was revived.
   */
  readonly decision_oracle_code: "SAFE" | "REVIVED" | "NOT_EVALUABLE";
  readonly evaluator_image_digest: string;
  readonly candidate_tree_oid: string;
}

/** One evaluator-owned functional check as it ran. */
export interface FunctionalCheckResult {
  readonly name: string;
  readonly passed: boolean;
}

/**
 * Read-only view of the materialized candidate tree handed to task code.
 *
 * Every listing is sorted; every read is contained to the tree root. Task
 * oracles see exactly the bytes the agent left and nothing else — no process
 * environment, no clock, no network handle. An oracle is a pure function of
 * this view; §4.8 reviews oracle determinism before a task is sealed.
 */
export interface TreeView {
  /** Absolute path of the extracted tree root (read-only on disk). */
  readonly root: string;
  /** True when the path exists inside the tree. Path traversal is refused. */
  exists(path: string): boolean;
  /** UTF-8 contents, or null when the path is absent or not a regular file. */
  read(path: string): string | null;
  /** Sorted entry names of a directory, or [] when absent. */
  list(path: string): string[];
  /** Sorted tree-relative paths of every regular file. */
  files(): string[];
}

/**
 * A behavioral probe: candidate code run with EVALUATOR-OWNED command and
 * arguments (§12.3: the evaluator may build/run candidate code, but the
 * command, the arguments and the expected behavior are the evaluator's).
 *
 * The probe's stdout/stderr are DATA. No verdict logic anywhere trusts what
 * the candidate says about itself; a probe only matters through the
 * expectations the task module states up front.
 */
export interface ProbeSpec {
  /**
   * Arguments after the pinned node executable. Must start with the file to
   * run (tree-relative) or `-e`. Flags are allowed only from the engine's
   * frozen allowlist — arbitrary node flags are a sandbox surface (for
   * example `--inspect` opens a network port) and are refused.
   */
  readonly argv: readonly string[];
  /** Exact exit code the task expects. */
  readonly expect_exit: number;
  /** Exact stdout the task expects, after stripping one trailing newline. */
  readonly expect_stdout?: string;
  /** Kill the probe after this many milliseconds. */
  readonly timeout_ms?: number;
}

export interface ProbeResult {
  readonly exit_code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timed_out: boolean;
  /** True when the output hit the capture cap and was truncated. */
  readonly truncated: boolean;
}

/**
 * The sealed, pinned evaluator definition of one task. Lives in the sealed
 * task store (PRD §5.2), ships inside the evaluator image, and is never
 * readable from the agent runtime or writable by the candidate tree.
 */
export interface TaskEvaluator {
  readonly task_id: string;
  /** Records whose rejected decision this task's oracle guards. */
  readonly record_ids: readonly string[];
  /**
   * The evaluator's own functional checks. An EMPTY list can never pass:
   * a task that asserts nothing certifies nothing.
   */
  functional_checks(tree: TreeView, probe: (spec: ProbeSpec) => ProbeResult): readonly FunctionalCheckResult[];
  /** Inspects the final implementation state only — never the transcript (§13.2). */
  decision_oracle(tree: TreeView): "SAFE" | "REVIVED";
}

/** The §4.7 control expectations every sealed task must carry. */
export interface ControlExpectation {
  readonly functional_pass: boolean;
  readonly decision_oracle_code: "SAFE" | "REVIVED";
}

export interface TaskControls {
  /** functional PASS, decision SAFE. */
  readonly good: ControlExpectation;
  /** functional PASS, decision REVIVED. */
  readonly bad: ControlExpectation;
  /** functional FAIL. */
  readonly noop: ControlExpectation;
}

/** Why the evaluator refused to even extract a candidate archive. */
export type IngestRefusalCode =
  | "archive-too-large"
  | "too-many-files"
  | "file-too-large"
  | "path-too-long"
  | "path-escapes-tree"
  | "dot-git-smuggled"
  | "duplicate-entry"
  | "symlink-escapes-tree"
  | "symlink-through-symlink"
  | "hardlink-refused"
  | "special-file-refused"
  | "pax-or-gnu-extension-refused"
  | "invalid-tar"
  | "tree-oid-mismatch";

export interface IngestRefusal {
  readonly code: IngestRefusalCode;
  readonly detail: string;
}

/** A successfully materialized candidate tree. */
export interface IngestedTree {
  /** Extraction root; read-only on disk. */
  readonly root: string;
  /** Recomputed by the evaluator with its own staging — never trusted. */
  readonly candidate_tree_oid: string;
  /** Present when the archive carried entries the hygiene gate refused. */
  readonly refusal: IngestRefusal | null;
}

/** Hard caps on what one candidate archive may occupy (§12.2 resource limits). */
export interface IngestLimits {
  readonly max_total_bytes: number;
  readonly max_files: number;
  readonly max_file_bytes: number;
  readonly max_path_length: number;
}

export const DEFAULT_INGEST_LIMITS: IngestLimits = {
  max_total_bytes: 64 * 1024 * 1024,
  max_files: 20_000,
  max_file_bytes: 8 * 1024 * 1024,
  max_path_length: 512,
};
