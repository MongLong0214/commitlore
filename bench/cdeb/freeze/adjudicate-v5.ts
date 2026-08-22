/**
 * G4 adjudication: is the ruled-out approach still functionally violable?
 *
 * The requirement itself never moves. A candidate is only studiable if a patch
 * exists that implements what the decision ruled out **and passes functional
 * acceptance**, because the endpoint is exactly that event. Relaxing it would
 * make the study measure something other than what it claims to.
 *
 * What changes here is what happens to the candidates that fail it. Discarding
 * them as a bare failure throws away the most interesting thing the census
 * found: for most decisions attempted so far, the work that implemented the
 * decision also installed the thing that enforces it, so the wrong path is not
 * merely unlikely -- it cannot pass. That is a property of the tree, it is
 * measurable, and it bounds what a decision-delivery product is for.
 *
 * So those candidates become `TREE_ENFORCED` and carry which mechanism does the
 * enforcing. The ratio is published as a descriptive result whichever way the
 * confirmatory study lands, and the final product-effect claim is scoped to the
 * population it was actually measured on.
 */

/** What in the frozen tree refuses the ruled-out approach. */
export const ENFORCEMENT_MECHANISMS = [
  /** A test asserts the compliant behaviour, or names the forbidden one. */
  "test",
  /** A schema, contract document or closed field list rejects the shape. */
  "schema",
  /** The type system will not compile the ruled-out form. */
  "type",
  /** A runtime check throws, refuses or exits on it. */
  "runtime-guard",
  /** An invariant elsewhere in the tree becomes false, breaking something unrelated. */
  "structural-invariant",
] as const;

export type EnforcementMechanism = (typeof ENFORCEMENT_MECHANISMS)[number];

export const ADJUDICATIONS = [
  /** A revival exists and passes acceptance. The candidate can carry the endpoint. */
  "FUNCTIONALLY_VIOLABLE",
  /** Every revival attempted fails acceptance because the tree enforces the decision. */
  "TREE_ENFORCED",
  /** Excluded for a reason that is not about viability at all. */
  "NOT_BUILDABLE_OTHER",
] as const;

export type Adjudication = (typeof ADJUDICATIONS)[number];

export interface RevivalAttempt {
  readonly attempt_id: string;
  /** What the ruled-out approach was implemented as. */
  readonly approach: string;
  readonly acceptance_passed: boolean;
  readonly acceptance_summary: string;
  /**
   * Failures the attempt's own sloppiness caused. Kept separate because a
   * revival that fails because it was written badly says nothing about whether
   * the approach is viable, and counting those as enforcement would inflate
   * TREE_ENFORCED with the adjudicator's own mistakes.
   */
  readonly failures_attributable_to_the_patch: readonly string[];
  /** Failures no implementation of this approach could avoid. */
  readonly failures_no_implementation_can_avoid: readonly string[];
  readonly enforcing_mechanism: EnforcementMechanism | null;
  /** Where the enforcement lives, so a reader can open it. */
  readonly enforcement_locator: string | null;
}

export interface CandidateAdjudication {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v5";
  readonly stage: "stage1-r1";
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly ruled_out_approach: string;
  readonly acceptance_command: string;
  readonly baseline_summary: string;
  readonly attempts: readonly RevivalAttempt[];
  readonly adjudication: Adjudication;
  readonly adjudicated_at: string;
}

const MECHANISMS: ReadonlySet<string> = new Set(ENFORCEMENT_MECHANISMS);

/**
 * The minimum number of structurally distinct approaches that must fail before
 * a negative verdict is recorded at all.
 *
 * Three, because two was demonstrably not enough. Candidate v4-a7b04c5208e493e4
 * was adjudicated twice by accident: one worker failed two approaches and
 * concluded TREE_ENFORCED, the other found a third that passed the whole suite.
 * The requirement cannot make a universal claim safe -- nothing finite can --
 * but it moves the floor above the case that actually failed.
 */
export const MIN_DISTINCT_APPROACHES_FOR_A_NEGATIVE = 3;

/**
 * A single passing revival settles it. The requirement is existential, so one
 * attempt that passes makes the candidate violable however many others failed.
 *
 * The two verdicts are not symmetric and the code should not pretend they are.
 * FUNCTIONALLY_VIOLABLE is proved by one witness and cannot be undone by later
 * failures. TREE_ENFORCED asserts that no implementation can pass, which no
 * number of failed attempts establishes -- it is a bounded negative, and
 * `assertNegativeIsBounded` records the bound rather than hiding it.
 */
export const adjudicationOf = (attempts: readonly RevivalAttempt[]): Adjudication => {
  if (attempts.length === 0) throw new Error("adjudicate: a candidate with no attempt has not been adjudicated");
  if (attempts.some((attempt) => attempt.acceptance_passed)) return "FUNCTIONALLY_VIOLABLE";
  return "TREE_ENFORCED";
};

/**
 * TREE_ENFORCED is a claim about the tree, so it needs at least one attempt
 * that failed for a reason no implementation could avoid, and that reason has
 * to name a registered mechanism and a place to look.
 *
 * Without this an adjudicator could write a deliberately broken patch, watch it
 * fail, and record the tree as enforcing something it does not enforce.
 */
export const assertTreeEnforcedIsEvidenced = (row: CandidateAdjudication): void => {
  if (row.adjudication !== "TREE_ENFORCED") return;
  const structural = row.attempts.filter((attempt) => attempt.failures_no_implementation_can_avoid.length > 0);
  if (structural.length === 0) {
    throw new Error(
      `adjudicate: ${row.candidate_id} is TREE_ENFORCED with no failure that a better patch could not remove. ` +
        `A revival that fails because it was written badly is evidence about the patch, not about the tree`,
    );
  }
  for (const attempt of structural) {
    if (attempt.enforcing_mechanism === null || !MECHANISMS.has(attempt.enforcing_mechanism)) {
      throw new Error(
        `adjudicate: ${row.candidate_id} attempt ${attempt.attempt_id} names no registered enforcement mechanism ` +
          `(one of ${ENFORCEMENT_MECHANISMS.join(", ")})`,
      );
    }
    if ((attempt.enforcement_locator ?? "").trim() === "") {
      throw new Error(
        `adjudicate: ${row.candidate_id} attempt ${attempt.attempt_id} says the tree enforces the decision but ` +
          `does not say where, so nobody can check it`,
      );
    }
  }
};

/**
 * A candidate found violable must actually have a passing attempt recorded --
 * the adjudication and the evidence cannot drift apart.
 */
export const assertViolableIsEvidenced = (row: CandidateAdjudication): void => {
  if (row.adjudication !== "FUNCTIONALLY_VIOLABLE") return;
  const passing = row.attempts.filter((attempt) => attempt.acceptance_passed);
  if (passing.length === 0) {
    throw new Error(`adjudicate: ${row.candidate_id} is FUNCTIONALLY_VIOLABLE with no attempt that passed acceptance`);
  }
};

/**
 * A negative verdict must say how hard it was tried. Below the registered
 * minimum the verdict is not recorded -- the candidate goes back for more
 * approaches instead, because the difference between "cannot be done" and
 * "was not done here" is the whole content of the claim.
 */
export const assertNegativeIsBounded = (row: CandidateAdjudication): void => {
  if (row.adjudication !== "TREE_ENFORCED") return;
  const distinct = new Set(row.attempts.map((attempt) => attempt.approach.trim().toLowerCase()));
  if (distinct.size < MIN_DISTINCT_APPROACHES_FOR_A_NEGATIVE) {
    throw new Error(
      `adjudicate: ${row.candidate_id} is TREE_ENFORCED after ${String(distinct.size)} distinct approach(es), ` +
        `below the registered ${String(MIN_DISTINCT_APPROACHES_FOR_A_NEGATIVE)}. A negative that asserts no ` +
        `implementation can pass has to have tried more than the one that was already shown insufficient`,
    );
  }
};

export const assertAdjudicationConsistent = (row: CandidateAdjudication): void => {
  assertNegativeIsBounded(row);
  if (row.adjudication !== adjudicationOf(row.attempts) && row.adjudication !== "NOT_BUILDABLE_OTHER") {
    throw new Error(
      `adjudicate: ${row.candidate_id} records ${row.adjudication} but its attempts imply ` +
        `${adjudicationOf(row.attempts)}`,
    );
  }
  assertTreeEnforcedIsEvidenced(row);
  assertViolableIsEvidenced(row);
};

export interface CensusRatio {
  readonly adjudicated: number;
  readonly functionally_violable: number;
  readonly tree_enforced: number;
  readonly not_buildable_other: number;
  readonly by_mechanism: Readonly<Record<string, number>>;
  readonly tree_enforced_share: number;
}

/**
 * The descriptive result the study publishes whichever way the confirmatory
 * numbers land: how much of a real decision corpus is still violable at all.
 */
export const censusRatio = (rows: readonly CandidateAdjudication[]): CensusRatio => {
  const byMechanism: Record<string, number> = {};
  let violable = 0;
  let enforced = 0;
  let other = 0;
  for (const row of rows) {
    if (row.adjudication === "FUNCTIONALLY_VIOLABLE") violable += 1;
    else if (row.adjudication === "NOT_BUILDABLE_OTHER") other += 1;
    else {
      enforced += 1;
      for (const attempt of row.attempts) {
        if (attempt.enforcing_mechanism === null) continue;
        byMechanism[attempt.enforcing_mechanism] = (byMechanism[attempt.enforcing_mechanism] ?? 0) + 1;
      }
    }
  }
  return {
    adjudicated: rows.length,
    functionally_violable: violable,
    tree_enforced: enforced,
    not_buildable_other: other,
    by_mechanism: byMechanism,
    tree_enforced_share: rows.length === 0 ? 0 : enforced / rows.length,
  };
};

/**
 * The population the final product-effect claim may be made about.
 *
 * It is not "all decisions". A study that could only measure the decisions
 * still violable at the frozen snapshot has measured those, and saying so is
 * the difference between a finding and an overclaim.
 */
export const CLAIM_POPULATION =
  "decisions that remained functionally violable at the frozen snapshot" as const;

export const assertClaimPopulationScoped = (claimText: string): void => {
  if (/\ball decisions\b/i.test(claimText)) {
    throw new Error(
      `claim: "all decisions" is not the population this study measured. Scope it to ${CLAIM_POPULATION}`,
    );
  }
  if (!claimText.includes(CLAIM_POPULATION)) {
    throw new Error(`claim: a product-effect claim must name its population -- ${CLAIM_POPULATION}`);
  }
};
