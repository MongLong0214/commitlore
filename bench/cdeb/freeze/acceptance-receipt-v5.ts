/**
 * Machine-generated evidence that acceptance actually ran.
 *
 * The census spent its first weeks trusting sentences. An adjudicator wrote
 * "acceptance again passed: 41 passed, 0 failed" and the verdict was built on
 * that string. Seven verdicts had to be voided when it turned out the sandbox
 * had blocked the registered command and the adjudicator had judged a subset it
 * chose itself -- and the prose for those seven read exactly like the prose for
 * the ones that were fine. There is no way to tell a true summary from a
 * confident one by looking at it.
 *
 * So the summary stops being evidence. A verdict now needs a receipt: what
 * command ran, whether it was the registered one, when it started and stopped,
 * what it exited with, what the counts were, and digests of the output it
 * produced. Every field is emitted by the harness rather than written by the
 * worker, and `receipt_valid` is *computed here* from the other fields rather
 * than claimed anywhere -- a worker that could set it would be back to writing
 * prose with a stricter grammar.
 *
 * The rule the rest of the pipeline depends on: an attempt without a valid
 * receipt cannot reach adjudicationOf(). Not weighted lower -- excluded.
 */

/** The registered acceptance configuration a receipt is checked against. */
export interface RegisteredAcceptance {
  readonly repository_id: string;
  readonly command: string;
  readonly command_sha256: string;
  readonly cwd: string;
  /**
   * Baseline failures that are expected on the unmodified tree.
   *
   * Frozen as an exact list of test ids, never as a count. A count lets a patch
   * break one test while fixing another and still look clean; the ids make the
   * substitution visible.
   */
  readonly expected_failure_ids: readonly string[];
}

/** A structured baseline. Never a tail of output, never a duration. */
export interface AcceptanceBaseline {
  readonly repository_id: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly expected_failure_ids: readonly string[];
  readonly captured_at: string;
  /** Digest of the unmodified tree the baseline was taken on. */
  readonly tree_oid: string;
}

export interface AcceptanceReceipt {
  readonly schema_version: 1;
  readonly candidate_id: string;
  readonly attempt_id: string;
  readonly repository_id: string;

  readonly registered_acceptance_command: string;
  readonly registered_acceptance_command_sha256: string;
  /** What was actually executed. Compared against the registered digest. */
  readonly executed_command_sha256: string;

  readonly command_started_at: string;
  readonly command_finished_at: string;
  readonly exit_code: number;

  readonly baseline_fingerprint: string;
  readonly observed_fingerprint: string;

  readonly test_total: number;
  readonly test_pass: number;
  readonly test_fail: number;
  readonly test_skip: number;

  readonly excluded_test_ids: readonly string[];
  /** Observed failures that the baseline did not already have. */
  readonly unexpected_failures: readonly string[];

  /**
   * What the attempt changed in the tree, from `git status --porcelain`.
   *
   * Load-bearing, and it took a live failure to notice. Four adjudicators
   * declined to implement their approach, changed nothing, and the acceptance
   * run passed -- because an unmodified tree passes its own baseline. Every one
   * of those would have been recorded as a passing revival, which is the
   * `is_baseline` mistake wearing different clothes.
   */
  readonly changed_files: readonly string[];

  readonly sandbox_profile: string;
  readonly runtime_identity: string;
  readonly worktree_sha: string;
  readonly final_tree_oid: string;

  readonly stdout_sha256: string;
  readonly stderr_sha256: string;
}

/** A receipt plus the verdict this module computed about it. */
export interface ValidatedReceipt {
  readonly receipt: AcceptanceReceipt;
  readonly receipt_valid: boolean;
  readonly defects: readonly string[];
  /** Derived from unexpected_failures, not from any field a worker writes. */
  readonly acceptance_passed: boolean;
}

const SHA256 = /^[0-9a-f]{64}$/;
const NONEMPTY = (value: string | undefined | null): boolean => (value ?? "").trim() !== "";

const parseTime = (value: string): number => {
  const at = Date.parse(value);
  return Number.isNaN(at) ? Number.NaN : at;
};

/**
 * Checks a receipt against the registered configuration and the baseline.
 *
 * Every check here is one of the ways the seven voided verdicts could have been
 * caught while they were being made. The sandbox ones ran a narrower command
 * than the registered one -- `executed_command_sha256` catches that. They
 * reported counts that no run produced -- the arithmetic check catches that.
 * They cited a baseline they never took -- the fingerprint match catches that.
 */
export const validateReceipt = (
  receipt: AcceptanceReceipt,
  registered: RegisteredAcceptance,
  baseline: AcceptanceBaseline,
): ValidatedReceipt => {
  const defects: string[] = [];

  if (receipt.repository_id !== registered.repository_id) {
    defects.push(
      `receipt is for repository ${receipt.repository_id} but was checked against ${registered.repository_id}`,
    );
  }
  if (receipt.registered_acceptance_command_sha256 !== registered.command_sha256) {
    defects.push("the receipt names a different registered command than the frozen configuration");
  }
  if (receipt.executed_command_sha256 !== registered.command_sha256) {
    defects.push(
      "the command that ran is not the registered acceptance command. A narrowed or substituted command " +
        "measures something the study did not register, which is how the voided agent-control-plane verdicts happened",
    );
  }

  const started = parseTime(receipt.command_started_at);
  const finished = parseTime(receipt.command_finished_at);
  if (Number.isNaN(started) || Number.isNaN(finished)) {
    defects.push("the receipt does not carry parseable start and finish timestamps");
  } else if (finished < started) {
    defects.push("the receipt finishes before it starts");
  }

  if (!Number.isInteger(receipt.exit_code)) defects.push("the receipt carries no integer exit code");

  for (const [label, value] of [
    ["stdout_sha256", receipt.stdout_sha256],
    ["stderr_sha256", receipt.stderr_sha256],
  ] as const) {
    if (!SHA256.test(value ?? "")) defects.push(`${label} is not a sha256 digest, so the output cannot be checked`);
  }

  for (const [label, value] of [
    ["sandbox_profile", receipt.sandbox_profile],
    ["runtime_identity", receipt.runtime_identity],
    ["worktree_sha", receipt.worktree_sha],
    ["final_tree_oid", receipt.final_tree_oid],
  ] as const) {
    if (!NONEMPTY(value)) defects.push(`${label} is empty, so the run cannot be located afterwards`);
  }

  const counts = [receipt.test_total, receipt.test_pass, receipt.test_fail, receipt.test_skip];
  if (counts.some((count) => !Number.isInteger(count) || count < 0)) {
    defects.push("the receipt's test counts are not non-negative integers");
  } else if (receipt.test_pass + receipt.test_fail + receipt.test_skip !== receipt.test_total) {
    defects.push(
      `the counts do not add up: ${String(receipt.test_pass)} + ${String(receipt.test_fail)} + ` +
        `${String(receipt.test_skip)} != ${String(receipt.test_total)}`,
    );
  }

  if (receipt.baseline_fingerprint !== fingerprintOf(baseline)) {
    defects.push(
      "the receipt cites a baseline that is not the frozen one for this repository, so 'matches baseline' " +
        "compares against something unrecorded",
    );
  }

  const excluded = new Set(receipt.excluded_test_ids);
  for (const id of registered.expected_failure_ids) {
    if (!excluded.has(id)) {
      defects.push(`registered exclusion ${id} is missing from the receipt's excluded list`);
    }
  }
  for (const id of receipt.excluded_test_ids) {
    if (!registered.expected_failure_ids.includes(id)) {
      defects.push(
        `${id} was excluded but is not a registered exclusion. Exclusions chosen during a run are chosen ` +
          `knowing what failed`,
      );
    }
  }

  const expected = new Set(baseline.expected_failure_ids);
  for (const id of receipt.unexpected_failures) {
    if (expected.has(id)) {
      defects.push(`${id} is counted as an unexpected failure but the baseline already has it`);
    }
  }

  // A revival may add tests. It may not remove them or silence them: a patch
  // that deletes the test failing it, or marks it skipped, passes acceptance
  // while having done the opposite of what acceptance is for. Neither shape has
  // appeared in the census so far -- 42 receipts, every one at or above the
  // baseline's total and none with a higher skip count -- which is why the check
  // costs nothing to add and is worth having before it does.
  if (receipt.test_total < baseline.total) {
    defects.push(
      `the run has ${String(receipt.test_total)} tests where the baseline has ${String(baseline.total)}. ` +
        `A revival may add coverage and may not remove it`,
    );
  }
  if (receipt.test_skip > baseline.skipped) {
    defects.push(
      `the run skips ${String(receipt.test_skip)} tests where the baseline skips ${String(baseline.skipped)}. ` +
        `Silencing a test that fails is the same move as deleting it`,
    );
  }

  if (receipt.changed_files.length === 0) {
    defects.push(
      "the tree is unchanged, so this run measured the baseline rather than a revival. An unmodified tree " +
        "passes its own acceptance by construction, and reading that as a passing revival records the tree " +
        "working as the ruled-out approach working",
    );
  }

  return {
    receipt,
    receipt_valid: defects.length === 0,
    defects,
    acceptance_passed: defects.length === 0 && receipt.unexpected_failures.length === 0 && receipt.exit_code === 0,
  };
};

/**
 * The baseline's identity, so a receipt cannot cite a baseline nobody took.
 *
 * Deliberately built from the structured counts and the exact failure ids
 * rather than from output text: two runs of the same suite differ in duration
 * and ordering, and a fingerprint that changed with those would be useless.
 */
export const fingerprintOf = (baseline: AcceptanceBaseline): string =>
  [
    baseline.repository_id,
    `total=${String(baseline.total)}`,
    `pass=${String(baseline.passed)}`,
    `fail=${String(baseline.failed)}`,
    `skip=${String(baseline.skipped)}`,
    `expected=${[...baseline.expected_failure_ids].sort().join(",")}`,
  ].join(" ");

/**
 * Refuses a baseline that carries no structure.
 *
 * The agent-control-plane baseline was for a while the last three lines of test
 * output, which held a duration and nothing else. Any candidate run "matched"
 * it, because a duration matches a duration. A baseline has to say what passed.
 */
export const assertBaselineIsSemantic = (baseline: AcceptanceBaseline): void => {
  if (!Number.isInteger(baseline.total) || baseline.total <= 0) {
    throw new Error(
      `baseline for ${baseline.repository_id} records no test total. A baseline that is captured output rather ` +
        `than a parsed result matches anything, including a run that never executed a test`,
    );
  }
  if (baseline.passed + baseline.failed + baseline.skipped !== baseline.total) {
    throw new Error(`baseline for ${baseline.repository_id} does not add up to its own total`);
  }
  if (baseline.failed !== baseline.expected_failure_ids.length) {
    throw new Error(
      `baseline for ${baseline.repository_id} has ${String(baseline.failed)} failures but names ` +
        `${String(baseline.expected_failure_ids.length)} of them. A count without ids lets a patch break one test ` +
        `and fix another while the total stays put`,
    );
  }
  if (!NONEMPTY(baseline.tree_oid)) {
    throw new Error(`baseline for ${baseline.repository_id} does not say which tree it was taken on`);
  }
};

/**
 * The gate the rest of the pipeline calls. Fails closed: anything that is not a
 * clean receipt is an exclusion, never a discount.
 */
export const assertReceiptAdmissible = (validated: ValidatedReceipt): void => {
  if (validated.receipt_valid) return;
  throw new Error(
    `acceptance: ${validated.receipt.candidate_id} attempt ${validated.receipt.attempt_id} has no valid receipt ` +
      `and cannot be adjudicated -- ${validated.defects.join("; ")}`,
  );
};
