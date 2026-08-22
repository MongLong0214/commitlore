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

import { seededRandom } from "./analysis-v5.ts";

export const POWER_RULE_FIELDS = [
  "alpha_two_sided",
  "power_target",
  "confidence",
  "minimum_practically_important_dsfps_effect",
  /** SSOT 9.2: a table, not a number. Repeats follow the buildable count. */
  "repeats_rule",
  "maximum_resource_budget_episodes",
  "minimum_buildable_candidates_per_repository",
  "minimum_confirmatory_reserve_total",
  "infrastructure_allowance",
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
 * Empty, and that is the design. SSOT section 9 sizes the confirmatory study
 * from the buildable count, which is frozen before any episode, so the pilot
 * supplies nothing to the sizing at all -- not even a nuisance parameter.
 *
 * An earlier revision allowed five of them behind a blind. A channel that
 * carries nothing cannot carry the effect by accident, and nobody has to be
 * trusted not to look.
 */
export const PERMITTED_PILOT_INPUTS = [] as const;

/**
 * The frozen upper bound on between-candidate heterogeneity in the ON-minus-OFF
 * difference.
 *
 * This constant exists because the design was internally contradictory and an
 * adversarial review named it: `minimumDetectableEffect` needs `tau_squared`,
 * which is a property of the *arm contrast*, while the power rule forbids the
 * sizing step from reading any arm comparison. The pilot cannot supply it
 * either -- three candidates per repository cannot estimate a variance.
 *
 * The resolution is to stop treating it as something to be measured later.
 * `TAU_SQUARED_BOUND` is fixed here, before any outcome, at the top of the
 * bracket the design was already reporting. The study then registers what it
 * can detect under that bound and lives with the answer, rather than
 * substituting a smaller within-arm variance and certifying a power it does not
 * have.
 *
 * The bound is conservative in the sense that matters: if the true
 * heterogeneity is lower, the study detects more than it promised, which is the
 * safe direction to be wrong in.
 */
export const TAU_SQUARED_BOUND = 0.06;

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
  if (rule.permitted_pilot_inputs.length > 0) {
    throw new Error(
      `power-rule: the rule declares ${String(rule.permitted_pilot_inputs.length)} pilot input(s). Section 9 sizes ` +
        `the study from the buildable count alone, so the pilot supplies nothing and the channel stays shut`,
    );
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
    throw new Error(
      `power-rule: sizing input "${key}" is not permitted. Section 9 sizes the study from the buildable count ` +
        `alone, so the sizing step takes no input from the pilot`,
    );
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

/**
 * SSOT §9.2: repeats follow the buildable count and nothing else.
 *
 * This replaces an earlier design of mine that inverted the detectable-effect
 * formula to find the smallest envelope reaching a target. That direction is
 * the one §9 forbids -- it lets the target and the budget negotiate with each
 * other. Here the corpus decides the repeats and the study then reports what
 * that envelope can detect.
 */
export const confirmatoryRepeatRule = (
  buildableTotal: number,
  minimumPerRepository: number,
): number | "HOLD" => {
  if (minimumPerRepository < 5) return "HOLD";
  if (buildableTotal >= 40) return 4;
  if (buildableTotal >= 30) return 5;
  if (buildableTotal >= 24) return 6;
  return "HOLD";
};

/**
 * SSOT §9.3's conservative binary simulation.
 *
 * Each episode is a Bernoulli draw; a candidate's per-arm rate is the mean of
 * its repeats; the estimand is the equal-weight average of within-repository
 * mean differences. Power is the fraction of simulated studies whose
 * repository-stratified interval excludes zero when the true effect is the
 * registered minimum important one.
 *
 * `tauSquared` is exposed rather than hidden at zero. The simulation as §9.3
 * names it -- binary outcomes, nothing else -- is the `tauSquared = 0` case, and
 * that is what the registered gate runs. But zero is an assumption of perfectly
 * homogeneous candidates, and it is the optimistic end rather than the
 * conservative one, so the sensitivity is computed alongside and registered.
 */
export const simulatePower = (input: {
  readonly candidates_per_repository: readonly number[];
  readonly repeats_per_arm: number;
  readonly baseline_rate: number;
  readonly true_effect: number;
  readonly tau_squared?: number;
  readonly replicates?: number;
  readonly seed: string;
}): number => {
  const replicates = input.replicates ?? 2000;
  const tauSquared = input.tau_squared ?? 0;
  const random = seededRandom(input.seed);
  const gaussian = (): number => {
    // Box-Muller, from the same stream so the whole simulation is reproducible.
    const u = Math.max(random(), Number.EPSILON);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  const clamp = (value: number): number => Math.min(0.999, Math.max(0.001, value));

  let detected = 0;
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const perRepositoryDifferences: number[][] = [];
    for (const count of input.candidates_per_repository) {
      const differences: number[] = [];
      for (let candidate = 0; candidate < count; candidate += 1) {
        // Candidate-level heterogeneity in how much delivery helps this one.
        const shift = tauSquared === 0 ? 0 : gaussian() * Math.sqrt(tauSquared);
        const off = clamp(input.baseline_rate);
        const on = clamp(input.baseline_rate + input.true_effect + shift);
        let onHits = 0;
        let offHits = 0;
        for (let repeat = 0; repeat < input.repeats_per_arm; repeat += 1) {
          if (random() < on) onHits += 1;
          if (random() < off) offHits += 1;
        }
        differences.push((onHits - offHits) / input.repeats_per_arm);
      }
      perRepositoryDifferences.push(differences);
    }
    // Normal-approximation interval on the equal-weight Delta, from the
    // between-candidate variance the simulated study would actually observe.
    const strata = perRepositoryDifferences.length;
    let delta = 0;
    let variance = 0;
    for (const differences of perRepositoryDifferences) {
      const n = differences.length;
      const mean = differences.reduce((total, value) => total + value, 0) / n;
      const spread =
        n < 2 ? 0 : differences.reduce((total, value) => total + (value - mean) ** 2, 0) / (n - 1);
      delta += mean / strata;
      variance += spread / n / (strata * strata);
    }
    const lower = delta - 1.959963984540054 * Math.sqrt(variance);
    if (lower > 0) detected += 1;
  }
  return detected / replicates;
};

/**
 * The analytic counterpart to `simulatePower`, and the cross-check rather than
 * the registered gate: SSOT §9.3 registers the binary simulation, and §9.2
 * fixes repeats from the buildable count, so nothing sizes the study by
 * inverting this function any more. It is kept because it carries the
 * between-candidate term explicitly and is the more pessimistic of the two, and
 * a disagreement between the two is worth seeing rather than averaging.
 *
 * It is deliberately one-directional. If the envelope cannot detect the
 * registered minimum important effect at `TAU_SQUARED_BOUND`, the answer is
 * HOLD and a report. It is never "lower the important effect to what the
 * envelope reaches", which is the move that turns an underpowered study into a
 * study that found something.
 */
export const assertEnvelopeDetectsImportantEffect = (input: {
  readonly candidates_per_repository: readonly number[];
  readonly repeats_per_arm: number;
  readonly baseline_rate: number;
  readonly minimum_important_effect: number;
  readonly alpha_two_sided: number;
  readonly power_target: number;
}): void => {
  const detectable = minimumDetectableEffect({ ...input, tau_squared: TAU_SQUARED_BOUND });
  if (detectable > input.minimum_important_effect) {
    throw new Error(
      `power-rule: at ${String(input.repeats_per_arm)} repeats over ` +
        `${input.candidates_per_repository.join("/")} candidates the envelope detects ` +
        `${(detectable * 100).toFixed(1)} percentage points, which is larger than the registered minimum ` +
        `important effect of ${(input.minimum_important_effect * 100).toFixed(1)}. HOLD and report. Do not ` +
        `lower the important effect to match what the envelope reaches`,
    );
  }
};

/** The smallest repeat count whose envelope reaches the important effect, or null if none within `maxRepeats`. */
export const repeatsRequiredForImportantEffect = (
  input: {
    readonly candidates_per_repository: readonly number[];
    readonly baseline_rate: number;
    readonly minimum_important_effect: number;
    readonly alpha_two_sided: number;
    readonly power_target: number;
  },
  maxRepeats = 200,
): number | null => {
  for (let repeats = 1; repeats <= maxRepeats; repeats += 1) {
    const detectable = minimumDetectableEffect({ ...input, repeats_per_arm: repeats, tau_squared: TAU_SQUARED_BOUND });
    if (detectable <= input.minimum_important_effect) return repeats;
  }
  return null;
};

export interface PilotFeasibilityThresholds {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v5";
  readonly stage: "stage1-r1";
  readonly frozen_before_pilot: boolean;
  /**
   * The counted thresholds are denominated in the *buildable* subset of the 12,
   * not in 12. Requiring all 12 while the census may legitimately dispose a
   * pilot candidate NOT_BUILDABLE puts feasibility pressure behind the decision
   * to call a marginal candidate buildable, and that decision has to be free of
   * it. A NOT_BUILDABLE pilot candidate is not replaced; too few of them is a
   * HOLD.
   */
  readonly min_buildable_pilot_candidates: number;
  readonly min_buildable_pilot_candidates_per_repository: number;
  readonly require_all_buildable_covered: boolean;
  /** Every threshold is a property of the instrument, never of the contrast. */
  readonly max_infrastructure_failure_rate: number;
  readonly max_median_runtime_seconds: number;
  readonly min_evaluator_reproducibility: number;
}

/** How many pilot candidates the census called buildable, overall and per repository. */
export interface PilotBuildableCount {
  readonly total: number;
  readonly per_repository: Readonly<Record<string, number>>;
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
  buildable: PilotBuildableCount,
): PilotVerdict => {
  assertFeasibilityCarriesNoEffect(feasibility as unknown as Record<string, unknown>);
  if (!thresholds.frozen_before_pilot) {
    throw new Error("pilot-gate: thresholds were not frozen before the pilot, so they could have been set to what it produced");
  }
  const failed: string[] = [];
  if (buildable.total < thresholds.min_buildable_pilot_candidates) failed.push("min_buildable_pilot_candidates");
  for (const [repository, count] of Object.entries(buildable.per_repository)) {
    if (count < thresholds.min_buildable_pilot_candidates_per_repository) {
      failed.push(`min_buildable_pilot_candidates_per_repository:${repository}`);
    }
  }
  // The counted measures are denominated in the buildable subset, so full
  // coverage means covering exactly those, not covering twelve.
  if (thresholds.require_all_buildable_covered) {
    if (feasibility.firewall_manifests_valid < buildable.total) failed.push("firewall_manifests_valid");
    if (feasibility.oracle_controls_reproduced < buildable.total) failed.push("oracle_controls_reproduced");
    if (feasibility.delivery_manipulation_observed < buildable.total) failed.push("delivery_manipulation_observed");
  }
  if (feasibility.infrastructure_failure_rate > thresholds.max_infrastructure_failure_rate) failed.push("infrastructure_failure_rate");
  if (feasibility.median_runtime_seconds > thresholds.max_median_runtime_seconds) failed.push("median_runtime_seconds");
  if (feasibility.evaluator_reproducibility < thresholds.min_evaluator_reproducibility) failed.push("evaluator_reproducibility");
  return { verdict: failed.length === 0 ? "PASS" : "HOLD", failed };
};
