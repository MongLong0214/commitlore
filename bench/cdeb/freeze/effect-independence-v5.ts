/**
 * CDEB-Fresh v5 Stage 1-r1: the power/resource rule and the pilot gate.
 *
 * Both exist to stop the same thing. A pilot produces an effect estimate long
 * before the confirmatory study is sized, and two decisions then sit within
 * reach of that estimate: how many observations to take, and whether to
 * continue at all. Either one, made after seeing the direction, converts the
 * confirmatory study into a search for the sample size that reaches
 * significance.
 *
 * The Stage 1 draft handled this with a blind, and the adversarial review found
 * the blind protected the analyst while the study operator held the key. A blind
 * that the decision-maker can lift is a procedure, not a control. So the rule
 * here is structural instead: the inputs to both decisions are a closed list,
 * and anything carrying an arm contrast is refused at the door. Nothing has to
 * be trusted not to look, because the thing to look at is not in the room.
 *
 * The pilot's own output is deliberately impoverished -- `PASS` or `HOLD`
 * against frozen feasibility thresholds. It cannot report a direction because
 * it is not given one.
 */

export const POWER_RULE_FIELDS = [
  "alpha_two_sided",
  "power_target",
  "confidence",
  "minimum_practically_important_dsfps_effect",
  "maximum_resource_budget_episodes",
  "repeats_per_arm",
  "infrastructure_allowance",
  "minimum_buildable_candidates_per_repository",
  "hold_rule",
] as const;

export type PowerRuleField = (typeof POWER_RULE_FIELDS)[number];

export interface PowerAndResourceRule {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v5";
  readonly stage: "stage1-r1";
  readonly frozen_before_pilot: boolean;
  readonly fields: Readonly<Partial<Record<PowerRuleField, unknown>>>;
  /** The nuisance parameters the rule is permitted to read from the pilot. */
  readonly permitted_pilot_inputs: readonly string[];
}

/**
 * The only pilot outputs the sizing may read. Each describes how noisy the
 * measurement is; none describes how large the effect is.
 */
export const PERMITTED_PILOT_INPUTS = [
  "per_repository_baseline_dsfps_suppressed",
  "within_repository_variance",
  "per_task_completion_rate",
  "per_task_runtime_seconds",
  "infrastructure_failure_rate",
] as const;

/** Substrings that mark a key as carrying an arm contrast rather than a nuisance parameter. */
const EFFECT_MARKERS = ["effect", "delta", "difference", "contrast", "improvement", "lift", "arm_", "_on_vs", "treatment"];

const namesAnEffect = (key: string): boolean => {
  const lowered = key.toLowerCase();
  return EFFECT_MARKERS.some((marker) => lowered.includes(marker));
};

export const assertPowerRuleComplete = (rule: PowerAndResourceRule): void => {
  const isEmpty = (value: unknown): boolean =>
    value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  const missing = POWER_RULE_FIELDS.filter((field) => isEmpty(rule.fields[field]));
  if (missing.length > 0) {
    throw new Error(
      `power-rule: ${String(missing.length)} field(s) are unset before the pilot: ${missing.join(", ")}. ` +
        `A value fixed after the pilot is a value the pilot could have chosen`,
    );
  }
  if (!rule.frozen_before_pilot) {
    throw new Error("power-rule: the rule is not marked frozen before the pilot, so its independence is unevidenced");
  }
  for (const input of rule.permitted_pilot_inputs) {
    if (!PERMITTED_PILOT_INPUTS.includes(input as (typeof PERMITTED_PILOT_INPUTS)[number])) {
      throw new Error(`power-rule: "${input}" is not a registered nuisance parameter`);
    }
  }
};

/**
 * Refuses a sizing input set that carries the pilot's treatment contrast. This
 * is checked on the keys handed to the sizing step, so a caller cannot pass the
 * effect under a neutral-sounding name without renaming it to something the
 * marker list catches.
 */
export const assertPowerInputsEffectBlind = (inputs: Readonly<Record<string, unknown>>): void => {
  for (const key of Object.keys(inputs)) {
    if (namesAnEffect(key)) {
      throw new Error(
        `power-rule: sizing input "${key}" carries a treatment contrast. Choosing N from an observed effect is ` +
          `choosing the N that reaches significance`,
      );
    }
    if (!PERMITTED_PILOT_INPUTS.includes(key as (typeof PERMITTED_PILOT_INPUTS)[number])) {
      throw new Error(`power-rule: sizing input "${key}" is not a registered nuisance parameter`);
    }
  }
};

/**
 * The detectable difference for the equal-weight `Delta` at a frozen resource
 * envelope. The direction of the rule matters: N is fixed by the envelope and
 * the study *reports* what it can detect, rather than solving for the N that
 * detects what the pilot happened to show.
 *
 * The variance has two parts and only one of them shrinks with repeats:
 *
 *   within-candidate  2p(1-p)/R  -- binomial noise in one candidate's two arms,
 *                                   which more repeats do reduce
 *   between-candidate tau^2      -- candidates differ in how much delivery helps
 *                                   them, and repeating a candidate cannot
 *                                   average that away
 *
 * `tau_squared` is a nuisance parameter the pilot supplies. Passing zero gives
 * the binomial-only bound, which is an *optimistic* floor, not a conservative
 * one -- naming it that way was the error this signature exists to prevent.
 */
export const minimumDetectableEffect = (input: {
  /** Analysable candidates per fixed repository. Equal weighting makes the shape matter, not just the total. */
  readonly candidates_per_repository: readonly number[];
  readonly repeats_per_arm: number;
  readonly baseline_rate: number;
  /** Between-candidate variance of the per-candidate ON-minus-OFF difference. */
  readonly tau_squared: number;
  readonly alpha_two_sided: number;
  readonly power_target: number;
}): number => {
  if (input.candidates_per_repository.length === 0) {
    throw new Error("power-rule: a detectable difference needs at least one repository");
  }
  if (input.candidates_per_repository.some((count) => count <= 0)) {
    throw new Error(
      "power-rule: every fixed repository needs at least one analysable candidate; the equal-weight estimand is " +
        "undefined when a stratum is empty",
    );
  }
  if (input.repeats_per_arm <= 0) throw new Error("power-rule: repeats per arm must be positive");
  if (input.baseline_rate <= 0 || input.baseline_rate >= 1) {
    throw new Error("power-rule: the baseline rate must lie strictly between 0 and 1");
  }
  if (input.tau_squared < 0) throw new Error("power-rule: between-candidate variance cannot be negative");

  const zAlpha = normalQuantile(1 - input.alpha_two_sided / 2);
  const zBeta = normalQuantile(input.power_target);
  const perCandidate =
    input.tau_squared + (2 * input.baseline_rate * (1 - input.baseline_rate)) / input.repeats_per_arm;
  const strata = input.candidates_per_repository.length;
  // Var(Delta) = (1/K^2) * sum_r Var(D_r), Var(D_r) = perCandidate / m_r.
  const variance =
    input.candidates_per_repository.reduce((total, count) => total + perCandidate / count, 0) / (strata * strata);
  return (zAlpha + zBeta) * Math.sqrt(variance);
};

/** Horner evaluation, written as a fold so a dropped coefficient is impossible. */
const horner = (coefficients: readonly number[], x: number): number =>
  coefficients.reduce((accumulator, coefficient) => accumulator * x + coefficient, 0);

/**
 * Acklam's inverse normal CDF, sufficient for a sizing constant.
 *
 * The rational-approximation coefficients were first transcribed with the
 * central denominator one term short, which made every quantile about 1/400 of
 * its true value and every detectable effect correspondingly tiny. It looked
 * like a very well-powered study. `horner` and the exported entry point exist
 * so the next transcription error fails a test instead of flattering a design.
 */
export const normalQuantile = (p: number): number => {
  if (p <= 0 || p >= 1) throw new Error("power-rule: quantile argument must lie strictly between 0 and 1");
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return horner(c, q) / (horner(d, q) * q + 1);
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (horner(a, r) * q) / (horner(b, r) * r + 1);
};

export interface PilotFeasibilityThresholds {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v5";
  readonly stage: "stage1-r1";
  readonly frozen_before_pilot: boolean;
  /** Every threshold is a property of the instrument, never of the contrast. */
  readonly min_firewall_manifests_valid: number;
  readonly min_oracle_controls_reproduced: number;
  readonly min_delivery_manipulation_observed: number;
  readonly max_infrastructure_failure_rate: number;
  readonly max_median_runtime_seconds: number;
  readonly min_evaluator_reproducibility: number;
}

/** What the pilot may report. Note that no field names an arm or an outcome contrast. */
export interface PilotFeasibility {
  readonly firewall_manifests_valid: number;
  readonly oracle_controls_reproduced: number;
  readonly delivery_manipulation_observed: number;
  readonly infrastructure_failure_rate: number;
  readonly median_runtime_seconds: number;
  readonly evaluator_reproducibility: number;
}

const PILOT_FEASIBILITY_KEYS: readonly string[] = [
  "firewall_manifests_valid",
  "oracle_controls_reproduced",
  "delivery_manipulation_observed",
  "infrastructure_failure_rate",
  "median_runtime_seconds",
  "evaluator_reproducibility",
];

/**
 * The gate that keeps continuation effect-independent. It refuses input rather
 * than ignoring it: a feasibility record that carries a DSFPS contrast has
 * already put the effect in front of whoever reads the file.
 */
export const assertFeasibilityCarriesNoEffect = (feasibility: Readonly<Record<string, unknown>>): void => {
  for (const key of Object.keys(feasibility)) {
    if (namesAnEffect(key) || key.toLowerCase().includes("dsfps") || key.toLowerCase().includes("revival")) {
      throw new Error(
        `pilot-gate: feasibility record carries "${key}". Pilot continuation may not read treatment-effect ` +
          `direction or magnitude, and a field that reports it has already shown it`,
      );
    }
    if (!PILOT_FEASIBILITY_KEYS.includes(key)) {
      throw new Error(`pilot-gate: "${key}" is not a registered feasibility measure`);
    }
  }
};

export interface PilotVerdict {
  readonly verdict: "PASS" | "HOLD";
  readonly failed: readonly string[];
}

export const evaluatePilot = (
  thresholds: PilotFeasibilityThresholds,
  feasibility: PilotFeasibility,
): PilotVerdict => {
  assertFeasibilityCarriesNoEffect(feasibility as unknown as Record<string, unknown>);
  if (!thresholds.frozen_before_pilot) {
    throw new Error("pilot-gate: thresholds were not frozen before the pilot, so they could have been set to what it produced");
  }
  const failed: string[] = [];
  if (feasibility.firewall_manifests_valid < thresholds.min_firewall_manifests_valid) failed.push("firewall_manifests_valid");
  if (feasibility.oracle_controls_reproduced < thresholds.min_oracle_controls_reproduced) failed.push("oracle_controls_reproduced");
  if (feasibility.delivery_manipulation_observed < thresholds.min_delivery_manipulation_observed) {
    failed.push("delivery_manipulation_observed");
  }
  if (feasibility.infrastructure_failure_rate > thresholds.max_infrastructure_failure_rate) failed.push("infrastructure_failure_rate");
  if (feasibility.median_runtime_seconds > thresholds.max_median_runtime_seconds) failed.push("median_runtime_seconds");
  if (feasibility.evaluator_reproducibility < thresholds.min_evaluator_reproducibility) failed.push("evaluator_reproducibility");
  return { verdict: failed.length === 0 ? "PASS" : "HOLD", failed };
};
