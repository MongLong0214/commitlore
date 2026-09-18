/**
 * The repair selector — #1042, revision `native-efficacy-r6.1`.
 *
 * Repair is at most ONE additional fresh consumer session after a public
 * feedback failure, and #1042 fixes the selection as an ordered list of seven
 * rules. Order is the whole contract: a definitive handoff failure outranks
 * repairable feedback, and a missing checkpoint outranks both, so evaluating
 * them as independent conditions would launch repairs the policy forbids.
 *
 * Two things are deliberately **not** here.
 *
 * `chooseRepair` never sees the hidden audit, the combined first-pass score, the
 * reference labels or the other arm's result (#1042). That is not a promise in a
 * comment: the verdict handed in is rejected at runtime if it carries an audit
 * observation, because `bench/` is outside `tsconfig`'s `include` and a types-only
 * guarantee here is not checked by anything.
 *
 * And a recommendation is not a launch. The runner still owns the preconditions
 * — an open model-execution stage, no already-launched repair for this episode,
 * authorised budget left — and #1042 is explicit that a required repair blocked
 * by budget or restoration failure stays `unavailable` rather than becoming an
 * executed zero-token success. None of those belong in this function, so none of
 * them are parameters.
 */

import type { ArtifactVerdict } from "./scoring.ts";

/**
 * `terminal_handoff` is rule 1 alone; the workflow is false and no consumer runs.
 * `not_eligible` is rule 2: the episode never reached a state where repair is a
 * question. `unavailable` is rules 3, 4 and 7: repair applies, but an input it
 * requires is missing or untrusted.
 *
 * #1042 writes "unavailable/not_eligible" for rule 2 without separating them.
 * The split above is this module's reading, and `rule` is returned beside the
 * decision so a consumer that disagrees can re-derive either grouping without
 * the information being lost.
 */
export type RepairDecision =
  | "terminal_handoff"
  | "not_eligible"
  | "unavailable"
  | "not_triggered"
  | "repair";

export type RepairRule = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface RepairChoice {
  readonly decision: RepairDecision;
  /** Which of #1042's seven rules fired. The ordering is the contract. */
  readonly rule: RepairRule;
  readonly reason: string;
}

export type HandoffStatus = "valid" | "terminal_failure" | "unknown";

/**
 * `interrupted` is the independent provider, harness or operator interruption of
 * rule 2 — not a product-owned refusal or error, which #1042 says is *not*
 * automatically rule 2 and takes the ordinary bounded repair path when the
 * handoff is valid and the checkpoint is stable.
 */
export type SolveExecution = "completed" | "unstarted" | "interrupted";

/**
 * A checkpoint is complete only with the actual Git and notes state, not just
 * code (#1034). `incomplete` is a source patch that lost the first solve's
 * legitimate commits or notes, and it is a restoration limitation rather than a
 * reason to substitute the original handoff state.
 */
export type CheckpointStatus = "complete" | "incomplete" | "unavailable";

export interface NormalizedFeedback {
  /** False for a missing, invalid or wrong-snapshot envelope (#1033 §2). */
  readonly trusted: boolean;
  /** Scored over the feedback purpose ALONE. An audit observation is refused. */
  readonly verdict: ArtifactVerdict;
  /** Whether a required failure carries an adequate public explanation. */
  readonly public_explanation: boolean;
  /** An unsafe evaluation environment blocks repair whatever the feedback says. */
  readonly environment_fault: boolean;
}

const refuseAuditInput = (verdict: ArtifactVerdict): void => {
  const audit =
    verdict.observed.some((check) => check.purpose === "audit") ||
    verdict.unobserved.some((check) => check.purpose === "audit") ||
    verdict.untrusted.some((envelope) => envelope.purpose === "audit");
  if (audit) {
    throw new Error(
      "chooseRepair was given a verdict carrying audit observations; the hidden audit is never an input " +
        "to repair selection (#1042). Score the feedback purpose alone before calling this.",
    );
  }
};

const choice = (decision: RepairDecision, rule: RepairRule, reason: string): RepairChoice => ({
  decision,
  rule,
  reason,
});

/**
 * #1042's seven rules, in their order.
 *
 * The four parameters are the four the contract names, and there are no others:
 * adding one is the change that would let the audit, the other arm or a
 * reference label reach this decision.
 */
export const chooseRepair = (
  handoff: HandoffStatus,
  solveExecution: SolveExecution,
  normalizedFeedback: NormalizedFeedback,
  checkpointStatus: CheckpointStatus,
): RepairChoice => {
  refuseAuditInput(normalizedFeedback.verdict);

  // 1. A definitively failed handoff is a known failure. No consumer repair, and
  //    the workflow is false -- not unknown, and not rescued by a second actor.
  if (handoff === "terminal_failure") {
    return choice("terminal_handoff", 1, "the handoff failed definitively, so no consumer session runs");
  }

  // 2. Nothing was established to repair. Known first-phase failures and partial
  //    artifacts survive in scoring; this must not infer a successful continuation.
  if (handoff === "unknown") {
    return choice("not_eligible", 2, "the handoff is unknown, so there is no established first result to repair");
  }
  if (solveExecution === "unstarted") {
    return choice("not_eligible", 2, "the first solve never started");
  }
  if (solveExecution === "interrupted") {
    return choice(
      "not_eligible",
      2,
      "the first solve was interrupted independently by the provider, harness or operator",
    );
  }

  // 3. A checkpoint is Git and notes, not code alone. Without a stable complete
  //    one there is nothing legitimate to restore, and the original handoff state
  //    is not a substitute for it.
  if (checkpointStatus !== "complete") {
    return choice(
      "unavailable",
      3,
      `the first-solve checkpoint is ${checkpointStatus}; restoring the original handoff instead would pair ` +
        "this code with another stage's memory",
    );
  }

  // 4. Inputs that cannot be trusted. Feedback invented from private logs is the
  //    failure this rule exists to prevent; separately trusted failures are kept
  //    by the scorer regardless of what is decided here.
  if (!normalizedFeedback.trusted) {
    return choice("unavailable", 4, "the feedback envelope is missing, invalid or describes another snapshot");
  }
  if (normalizedFeedback.environment_fault) {
    return choice("unavailable", 4, "the evaluation environment is unsafe, so a repair result would not be assessable");
  }
  if (normalizedFeedback.verdict.score === false && !normalizedFeedback.public_explanation) {
    return choice("unavailable", 4, "a required check failed with no adequate public explanation to repair from");
  }

  // 5. Nothing to repair.
  if (normalizedFeedback.verdict.score === true) {
    return choice("not_triggered", 5, "every required check passed on trusted feedback");
  }

  // 6. The one repair. A source-build failure whose dependent checks are null
  //    reaches here: the build check is itself a trusted failure (#1033 §2), so
  //    the score is false even though coverage is partial.
  if (normalizedFeedback.verdict.score === false) {
    return choice("repair", 6, "trusted feedback establishes a required failure with an adequate public explanation");
  }

  // 7. No known false, and a required check left unresolved. Not a pass, and not
  //    a repair either -- there is no established failure to repair from.
  return choice(
    "unavailable",
    7,
    "no required check is known to have failed and at least one is unresolved",
  );
};
