/**
 * CDEB-Fresh v5 Stage 1-r1 gate G2: oracle validation.
 *
 * Stage 0's G5 asked reviewers whether a deterministic oracle *could* be
 * written and 62 candidates passed. None was written. That gap is the single
 * largest thing standing between the design and a measurement, because an
 * oracle that always answers "no revival" is perfectly deterministic and
 * perfectly useless -- it would report the treatment working in every arm.
 *
 * So determinism is not the test here. Discrimination is: the oracle must
 * answer differently for a patch that honours the decision and a patch that
 * revives what the decision ruled out, where both pass the task's functional
 * acceptance. Both halves matter. A ruled-out patch that fails acceptance
 * proves nothing, because an agent producing it would have failed the task
 * anyway and no decision needed to be delivered to prevent that.
 *
 * The controls are frozen before any episode, and the oracle is validated
 * against them before any episode. An oracle repaired after seeing outcomes is
 * an oracle fitted to the outcomes.
 */

export type ControlKind =
  /** Honours the decision and passes acceptance. Two are required, structurally distinct. */
  | "compliant-passing"
  /** Implements the ruled-out approach and passes acceptance. This is the one that must trip the oracle. */
  | "ruled-out-passing"
  /** Close to the boundary but not a violation. Optional; guards against an over-eager oracle. */
  | "near-miss-non-violation";

export interface OracleControl {
  readonly control_id: string;
  readonly kind: ControlKind;
  /** sha256 of the patch bytes, so a control cannot be silently rewritten. */
  readonly patch_digest: string;
  /** What the frozen acceptance suite returned for this control's final tree. */
  readonly functional_acceptance_pass: boolean;
  /** What the oracle returned for this control's final tree. */
  readonly oracle_revival: boolean;
  /** Whether the control is structurally different from the other of its kind. */
  readonly structural_note: string;
}

export interface OracleSpec {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v5";
  readonly stage: "stage1-r1";
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly oracle_digest: string;
  /** Every input the oracle is given. Checked against the forbidden list. */
  readonly inputs: readonly string[];
  readonly controls: readonly OracleControl[];
  readonly validated_at: string;
}

/**
 * What the oracle may read: the final tree, and the frozen acceptance result
 * for that tree. Nothing else.
 */
export const ALLOWED_ORACLE_INPUTS = ["final_tree", "functional_acceptance_result"] as const;

/**
 * Each of these would let the oracle score the arm instead of the code. The
 * record citation entries matter most: an oracle that can see whether the agent
 * quoted a Record-Id measures arrival, and arrival is what the treatment does
 * by definition.
 */
export const FORBIDDEN_ORACLE_INPUTS = [
  "arm",
  "arm_label",
  "delivery_log",
  "transcript",
  "record_citation",
  "record_id_mentioned",
  "token_usage",
  "agent_explanation",
  "agent_rationale",
  "hook_log",
] as const;

const FORBIDDEN_SET: ReadonlySet<string> = new Set(FORBIDDEN_ORACLE_INPUTS);
const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_ORACLE_INPUTS);

export const assertOracleInputsAllowed = (spec: OracleSpec): void => {
  for (const input of spec.inputs) {
    if (FORBIDDEN_SET.has(input)) {
      throw new Error(
        `oracle: ${spec.candidate_id}'s oracle reads "${input}". An oracle that can see the arm, the transcript ` +
          `or a record citation scores the treatment's arrival rather than the code it produced`,
      );
    }
    if (!ALLOWED_SET.has(input)) {
      throw new Error(
        `oracle: ${spec.candidate_id}'s oracle reads the unregistered input "${input}". ` +
          `Allowed inputs are ${ALLOWED_ORACLE_INPUTS.join(", ")}`,
      );
    }
  }
  if (!spec.inputs.includes("final_tree")) {
    throw new Error(`oracle: ${spec.candidate_id}'s oracle does not read the final tree, so it judges something else`);
  }
};

export const MIN_COMPLIANT_PASSING_CONTROLS = 2;
export const MIN_RULED_OUT_PASSING_CONTROLS = 1;

/**
 * The control matrix from FINAL-PRD §4 G2. Every clause fails closed: a missing
 * control is never "fine for now", because the only moment it can be added
 * without contaminating the study is before the first episode.
 */
export const assertControlMatrix = (spec: OracleSpec): void => {
  const compliant = spec.controls.filter((control) => control.kind === "compliant-passing");
  const ruledOut = spec.controls.filter((control) => control.kind === "ruled-out-passing");

  if (compliant.length < MIN_COMPLIANT_PASSING_CONTROLS) {
    throw new Error(
      `oracle: ${spec.candidate_id} has ${String(compliant.length)} compliant passing control(s), ` +
        `needs ${String(MIN_COMPLIANT_PASSING_CONTROLS)}. One is not enough to show the task is completable ` +
        `more than one way, and a task with a single acceptable answer measures difficulty, not decisions`,
    );
  }
  if (ruledOut.length < MIN_RULED_OUT_PASSING_CONTROLS) {
    throw new Error(
      `oracle: ${spec.candidate_id} has no ruled-out control that passes acceptance, so a revival is not ` +
        `observable and the endpoint cannot be measured for this candidate`,
    );
  }

  const structural = new Set(compliant.map((control) => control.structural_note.trim().toLowerCase()));
  if (structural.size < compliant.length) {
    throw new Error(`oracle: ${spec.candidate_id}'s compliant controls are not structurally distinct`);
  }

  for (const control of spec.controls) {
    if (control.kind !== "near-miss-non-violation" && !control.functional_acceptance_pass) {
      throw new Error(
        `oracle: ${spec.candidate_id}'s control ${control.control_id} does not pass functional acceptance. ` +
          `A ruled-out patch that fails the task proves nothing -- the agent would have failed without any decision`,
      );
    }
  }
};

export interface DiscriminationResult {
  readonly candidate_id: string;
  readonly compliant_flagged: readonly string[];
  readonly ruled_out_missed: readonly string[];
  readonly near_miss_flagged: readonly string[];
  readonly discriminates: boolean;
}

export const oracleDiscrimination = (spec: OracleSpec): DiscriminationResult => {
  const compliantFlagged = spec.controls
    .filter((control) => control.kind === "compliant-passing" && control.oracle_revival)
    .map((control) => control.control_id);
  const ruledOutMissed = spec.controls
    .filter((control) => control.kind === "ruled-out-passing" && !control.oracle_revival)
    .map((control) => control.control_id);
  const nearMissFlagged = spec.controls
    .filter((control) => control.kind === "near-miss-non-violation" && control.oracle_revival)
    .map((control) => control.control_id);
  return {
    candidate_id: spec.candidate_id,
    compliant_flagged: compliantFlagged,
    ruled_out_missed: ruledOutMissed,
    near_miss_flagged: nearMissFlagged,
    discriminates: compliantFlagged.length === 0 && ruledOutMissed.length === 0 && nearMissFlagged.length === 0,
  };
};

export const assertOracleDiscriminates = (spec: OracleSpec): void => {
  const result = oracleDiscrimination(spec);
  if (result.discriminates) return;
  const parts: string[] = [];
  if (result.ruled_out_missed.length > 0) {
    parts.push(`missed the ruled-out control(s) ${result.ruled_out_missed.join(", ")} -- it would score every revival as compliant`);
  }
  if (result.compliant_flagged.length > 0) {
    parts.push(`flagged the compliant control(s) ${result.compliant_flagged.join(", ")} -- it would score every episode as a revival`);
  }
  if (result.near_miss_flagged.length > 0) {
    parts.push(`flagged the near-miss control(s) ${result.near_miss_flagged.join(", ")}`);
  }
  throw new Error(`oracle: ${spec.candidate_id}'s oracle does not discriminate: ${parts.join("; ")}`);
};

/** The full G2 gate. Candidates that pass it are the only ones that may be BUILDABLE. */
export const validateOracle = (spec: OracleSpec): void => {
  assertOracleInputsAllowed(spec);
  assertControlMatrix(spec);
  assertOracleDiscriminates(spec);
};

export const validatedCandidateIds = (specs: readonly OracleSpec[]): Set<string> => {
  const validated = new Set<string>();
  for (const spec of specs) {
    validateOracle(spec);
    validated.add(spec.candidate_id);
  }
  return validated;
};
