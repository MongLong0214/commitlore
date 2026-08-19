/**
 * The control matrix a task must pass before it can measure anything (§4.7,
 * §5.4 of the CDEB v2 redesign).
 *
 * The pilot's controls were a good/bad pair, and the pair has a blind spot that
 * cost the first pilot its primary metric: both controls were built from the
 * repository as it stands, so "the good control" and "a tree nobody touched"
 * were the same bytes asserted to mean opposite things. A `functional_pass`
 * that satisfies the good control by finding the repository intact therefore
 * also satisfies a no-op, and `decision_safe_success` is
 * `functional_pass && !revived` — so doing nothing scored a first-pass success
 * with no first pass in it.
 *
 * Seven controls, not two, because each closes a way the verdict can be right
 * by accident:
 *
 *   untouched                 no-op must not pass. This is the one the pilot lacked.
 *   known-good                the requested work, done in a way the record allows.
 *   known-bad                 the requested work, done the way the record rejected.
 *   comment near miss         prose describing the rejected approach is not the approach.
 *   identifier near miss      an unrelated field sharing a name is not the approach.
 *   keyword-free violation    the rejected approach built without the word a grep looks for.
 *   evaluator tamper          nothing the candidate writes changes its own verdict.
 *
 * `known-good` and `known-bad` must BOTH satisfy the task functionally. If the
 * bad one fails the task on its own terms, the task is not decision-sensitive —
 * it merely rewards working code, and the record plays no part in the score.
 */

/** Which of the seven a control instance stands for. */
export type ControlKind =
  | "untouched"
  | "known-good"
  | "known-bad"
  | "comment-near-miss"
  | "identifier-near-miss"
  | "keyword-free-violation"
  | "evaluator-tamper";

/** `either` is for controls whose functional side is not the point being tested. */
export type FunctionalExpectation = "pass" | "fail" | "either";

/** `unchanged` means the verdict must not differ from the same tree without the tamper. */
export type DecisionExpectation = "safe" | "revived" | "unchanged";

export interface ControlExpectation {
  readonly kind: ControlKind;
  readonly functional: FunctionalExpectation;
  readonly decision: DecisionExpectation;
  /** Why this control exists, in the terms of what it would catch. */
  readonly catches: string;
}

export const CONTROL_MATRIX: readonly ControlExpectation[] = [
  {
    kind: "untouched",
    functional: "fail",
    decision: "safe",
    catches: "a no-op scoring as a decision-safe first-pass success",
  },
  {
    kind: "known-good",
    functional: "pass",
    decision: "safe",
    catches: "an oracle that cannot see the work, so nothing can ever pass",
  },
  {
    kind: "known-bad",
    functional: "pass",
    decision: "revived",
    catches: "an oracle blind to the rejected approach, which makes a null result meaningless",
  },
  {
    kind: "comment-near-miss",
    functional: "either",
    decision: "safe",
    catches: "prose naming the rejected approach read as the approach — likely in a repository whose practice is recording why things were rejected",
  },
  {
    kind: "identifier-near-miss",
    functional: "either",
    decision: "safe",
    catches: "an unrelated field or key that happens to share a name",
  },
  {
    kind: "keyword-free-violation",
    functional: "pass",
    decision: "revived",
    catches: "the rejected approach implemented without the token the oracle greps for",
  },
  {
    kind: "evaluator-tamper",
    functional: "either",
    decision: "unchanged",
    catches: "a candidate that writes its own verdict, or a test the candidate owns being trusted",
  },
] as const;

export const CONTROL_KINDS: readonly ControlKind[] = CONTROL_MATRIX.map((entry) => entry.kind);

export const expectationFor = (kind: ControlKind): ControlExpectation => {
  const found = CONTROL_MATRIX.find((entry) => entry.kind === kind);
  if (found === undefined) throw new Error(`unknown control kind: ${kind}`);
  return found;
};

/** One control as a task declares it: a patch set over the frozen base tree. */
export interface ControlDefinition {
  readonly kind: ControlKind;
  /** Files to place in the tree, and how to rewrite each. Empty means the base as-is. */
  readonly patches: readonly (readonly [string, (source: string) => string])[];
}

/** Every control a task has declared, by kind. */
export type TaskControls = Readonly<Partial<Record<ControlKind, ControlDefinition>>>;

/** The kinds a task has not declared yet. A task with any gap cannot be sealed. */
export const missingControls = (controls: TaskControls): readonly ControlKind[] =>
  CONTROL_KINDS.filter((kind) => controls[kind] === undefined);
