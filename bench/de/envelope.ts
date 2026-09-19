/**
 * Checker envelope validation — #1038 §4, revision `native-efficacy-r6.1`.
 *
 * This is where `scoring.ts` gets its input. That module takes an `Envelope` and
 * decides trust from the artifact identity and the checker revision; everything
 * *before* that — is this JSON even a result, does it describe the checks that
 * were described, does its exit code agree with its own rows — happens here.
 *
 * The rule the whole thing turns on: **a candidate's output is not evidence
 * until it has been validated against a definition written beforehand.** #1038:
 * "Do not trust a candidate-provided identity or PASS line." An envelope that
 * names its own checks can pass by describing fewer of them, and an exit code
 * that disagrees with its rows is a result nobody can read either way.
 *
 * So validation is exhaustive rather than best-effort. Missing, extra or
 * duplicated rows, a malformed shape, a wrong artifact or revision, or an exit
 * that contradicts the rows all invalidate the envelope — and an invalid
 * envelope contributes nothing, which is exactly what `scoring.ts` then refuses
 * to salvage a `false` from. What it never does is erase a separate valid
 * envelope's failure.
 *
 * Two asymmetries between the purposes are deliberate and come straight from
 * §4: a feedback `false` must carry a public explanation, because a failure
 * nobody can read cannot be repaired from; and an audit's `public_feedback` must
 * be null, because the audit is hidden and a leaked explanation would make it a
 * second feedback round.
 */

import type { Envelope, Purpose } from "./scoring.ts";

export type CheckCategory = "request" | "regression" | "decision" | "current_override";

export const CHECK_CATEGORIES: readonly CheckCategory[] = [
  "request",
  "regression",
  "decision",
  "current_override",
];

/** Written before the run and frozen. The envelope is validated against it. */
export interface CheckDefinition {
  readonly id: string;
  readonly category: CheckCategory;
  readonly purpose: Purpose;
  readonly requirement_ids: readonly string[];
}

export interface ValidationInput {
  readonly purpose: Purpose;
  readonly artifact_id: string;
  readonly checker_revision: string;
  /** Every check described for this purpose. All of them are required. */
  readonly described: readonly CheckDefinition[];
  /** The parsed envelope, or `null` when the bytes did not parse. */
  readonly raw: unknown;
}

export type EnvelopeVerdict =
  | { readonly valid: true; readonly envelope: Envelope }
  | { readonly valid: false; readonly reasons: readonly string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * Validate one envelope against the checks described for its purpose.
 *
 * Returns the `scoring.ts` shape on success so there is one path from raw bytes
 * to a score, rather than two readers whose first disagreement is silent.
 */
export const validateEnvelope = (input: ValidationInput): EnvelopeVerdict => {
  const reasons: string[] = [];
  const fail = (reason: string): void => {
    reasons.push(reason);
  };

  if (!isObject(input.raw)) {
    return { valid: false, reasons: ["the envelope did not parse into an object"] };
  }
  const raw = input.raw;

  if (raw["purpose"] !== input.purpose) {
    fail(`purpose is ${JSON.stringify(raw["purpose"])}; this envelope was read for ${input.purpose}`);
  }
  // Identity and revision are checked here for shape and again in `scoring.ts`
  // against the contract. A candidate cannot assert its way past either.
  if (!isNonEmptyString(raw["artifact_id"])) fail("artifact_id is missing or not a non-empty string");
  if (!isNonEmptyString(raw["checker_revision"])) fail("checker_revision is missing or not a non-empty string");

  const rows = raw["checks"];
  if (!Array.isArray(rows)) {
    return { valid: false, reasons: [...reasons, "checks is not an array"] };
  }

  const described = new Map(input.described.map((definition) => [definition.id, definition]));
  const seen = new Set<string>();
  const checks: { id: string; passed: boolean | null; detail?: string }[] = [];

  for (const row of rows) {
    if (!isObject(row)) {
      fail("a check row is not an object");
      continue;
    }
    const id = row["id"];
    if (!isNonEmptyString(id)) {
      fail("a check row has no usable id");
      continue;
    }
    if (seen.has(id)) {
      fail(`check ${id} appears more than once`);
      continue;
    }
    seen.add(id);

    const definition = described.get(id);
    if (definition === undefined) {
      // An extra row is not a bonus. It means the candidate described a check
      // nobody asked for, which is indistinguishable from renaming one it failed.
      fail(`check ${id} was not described for ${input.purpose}`);
      continue;
    }
    if (row["category"] !== definition.category) {
      fail(`check ${id} reports category ${JSON.stringify(row["category"])}, described as ${definition.category}`);
    }
    const passed = row["pass"];
    if (passed !== true && passed !== false && passed !== null) {
      fail(`check ${id} reports pass ${JSON.stringify(passed)}; only true, false or null are results`);
      continue;
    }
    if (!isNonEmptyString(row["evidence"])) fail(`check ${id} carries no evidence`);

    const feedback = row["public_feedback"];
    if (input.purpose === "feedback") {
      // A failure nobody can read cannot be repaired from, and #1042 rule 4
      // turns a missing explanation into `unavailable` rather than a repair.
      if (passed === false && !isNonEmptyString(feedback)) {
        fail(`check ${id} failed with no public explanation`);
      }
    } else if (feedback !== null && feedback !== undefined) {
      // The audit is hidden. A leaked explanation would make it a second
      // feedback round rather than an independent one.
      fail(`audit check ${id} carries public_feedback, which must be null`);
    }

    checks.push(
      isNonEmptyString(row["evidence"])
        ? { id, passed, detail: row["evidence"] }
        : { id, passed },
    );
  }

  for (const definition of input.described) {
    if (!seen.has(definition.id)) fail(`check ${definition.id} was described and is missing`);
  }

  const environmentError = raw["environment_error"];
  const hasEnvironmentError = environmentError !== null && environmentError !== undefined && environmentError !== false;
  const exit = raw["exit_code"];
  const anyFalse = checks.some((check) => check.passed === false);
  const allTrue = checks.length === input.described.length && checks.every((check) => check.passed === true);
  const anyUnknown = checks.some((check) => check.passed === null);

  // The exit code is a second statement about the same rows. When the two
  // disagree, neither can be believed, so the envelope is invalid rather than
  // resolved in favour of one of them.
  if (exit === 0) {
    if (!allTrue) fail("exit 0 claims every required check passed, and the rows do not");
    if (hasEnvironmentError) fail("exit 0 claims success while reporting an environment error");
  } else if (exit === 1) {
    if (!anyFalse) fail("exit 1 claims a trustworthy false and no row reports one");
  } else if (exit === 2) {
    if (anyFalse) fail("exit 2 claims unknown with no false, and a row reports false");
    if (!anyUnknown) fail("exit 2 claims unknown and no row is unresolved");
  } else {
    fail(`exit_code is ${JSON.stringify(exit)}; the contract defines 0, 1 and 2`);
  }

  if (reasons.length > 0) return { valid: false, reasons };

  return {
    valid: true,
    envelope: {
      presence: "present",
      artifact_id: raw["artifact_id"] as string,
      checker_revision: raw["checker_revision"] as string,
      checks,
    },
  };
};

/** The envelope handed to `scoring.ts` when validation failed. */
export const unparsableEnvelope = (): Envelope => ({ presence: "unparsable" });
