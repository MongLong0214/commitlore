/**
 * Trusted scoring for the native efficacy study — #1033 §2, revision
 * `native-efficacy-r6.1`.
 *
 * One artifact is assessed by two purposes, `feedback` and `audit`, each of
 * which either produces a checker envelope or does not. The whole difficulty is
 * that those two failure kinds look alike in a results file and mean opposite
 * things:
 *
 *   - a check that **ran and failed** is knowledge about the artifact;
 *   - an envelope that is missing, unparsable, or describes a different
 *     snapshot knows nothing, and the `false` inside it is arbitrary.
 *
 * Salvaging the second as the first is the error this module exists to prevent,
 * in both directions. A missing audit must not erase a feedback failure, and it
 * must not turn a feedback pass into full success either.
 *
 * So two values come out, and they are not derivable from each other:
 *
 *   - `score` — three-valued, about the artifact;
 *   - `coverage` — about the evidence, `complete | partial | unavailable`.
 *
 * `complete` means every required check was actually observed. It does not mean
 * pass, and a known failure can sit beside partial coverage (#1033 §2), which is
 * exactly the row that a two-valued design cannot express.
 *
 * Trust is **computed here**, never accepted from the caller. An envelope that
 * announces itself as valid while carrying another artifact's id, or a checker
 * revision the contract did not freeze, is untrusted — the point is to have one
 * enforcement site rather than a field somebody sets correctly most of the time.
 */

/** The two assessments of one artifact. #1033 fixes the pair; it is not open. */
export type Purpose = "feedback" | "audit";

export const PURPOSES: readonly Purpose[] = ["feedback", "audit"];

/**
 * Whether the envelope file exists and parses. It says nothing about whether it
 * describes the artifact under test — `trustOf` decides that.
 */
export type EnvelopePresence = "present" | "missing" | "unparsable";

/** Why an envelope contributed nothing. Reported, never collapsed into a score. */
export type UntrustedReason = "missing" | "unparsable" | "wrong_artifact" | "wrong_checker";

export type Coverage = "complete" | "partial" | "unavailable";

/**
 * One check as the checker reported it.
 *
 * `passed: null` is "the checker did not establish this" — a dependent check
 * skipped because the source build failed, or an environment fault. It is a
 * non-observation, and #1033 §3 is explicit that an environment fault must not
 * be encoded as a fake assertion failure, so `null` is the only honest way to
 * carry one through here.
 *
 * The build failure itself is a different thing: emitted by the valid checker it
 * is a trusted failure (`passed: false`) whose dependents are null, which scores
 * the artifact false on partial coverage.
 */
export interface CheckResult {
  readonly id: string;
  readonly passed: boolean | null;
  /** Free text from the checker, carried into the verdict for the report. */
  readonly detail?: string;
}

export interface Envelope {
  readonly presence: EnvelopePresence;
  /** The artifact the checker actually ran against, as it recorded it. */
  readonly artifact_id?: string;
  /** The checker/requirements revision that produced this, as it recorded it. */
  readonly checker_revision?: string;
  readonly checks?: readonly CheckResult[];
}

/**
 * What this artifact was required to answer, frozen before the run.
 *
 * `required_checks` is per purpose because #1033 §2 normalises "each purpose
 * against its expected check IDs": the same identifier under `feedback` and
 * under `audit` is two obligations, and a single flat list would let an audit
 * answer discharge a feedback one.
 */
export interface RequirementContract {
  readonly artifact_id: string;
  readonly checker_revision: string;
  readonly required_checks: Readonly<Record<Purpose, readonly string[]>>;
}

export interface ObservedCheck {
  readonly purpose: Purpose;
  readonly id: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface RequiredCheckRef {
  readonly purpose: Purpose;
  readonly id: string;
}

export interface UntrustedEnvelope {
  readonly purpose: Purpose;
  readonly reason: UntrustedReason;
  /** What it claimed, when it claimed something, so the report can name it. */
  readonly saw?: string;
}

export interface ArtifactVerdict {
  /** `false` any trusted required check failed; `true` all observed and passed; else `null`. */
  readonly score: boolean | null;
  readonly coverage: Coverage;
  readonly observed: readonly ObservedCheck[];
  /** Required checks with no trusted, non-null observation. */
  readonly unobserved: readonly RequiredCheckRef[];
  readonly untrusted: readonly UntrustedEnvelope[];
}

const trustOf = (contract: RequirementContract, envelope: Envelope): UntrustedReason | null => {
  if (envelope.presence === "missing") return "missing";
  if (envelope.presence === "unparsable") return "unparsable";
  if (envelope.artifact_id !== contract.artifact_id) return "wrong_artifact";
  if (envelope.checker_revision !== contract.checker_revision) return "wrong_checker";
  return null;
};

const claimOf = (envelope: Envelope, reason: UntrustedReason): string | undefined => {
  if (reason === "wrong_artifact") return envelope.artifact_id;
  if (reason === "wrong_checker") return envelope.checker_revision;
  return undefined;
};

/**
 * Score one saved artifact against one frozen requirement contract.
 *
 * Envelopes are keyed by purpose rather than supplied as a list, because two
 * envelopes claiming the same purpose is not a state with a defensible answer —
 * the caller would be asking which of two feedback runs to believe, and picking
 * one silently is how a re-run quietly replaces a failure.
 */
export const scoreArtifact = (
  contract: RequirementContract,
  envelopes: Readonly<Record<Purpose, Envelope>>,
): ArtifactVerdict => {
  const observed: ObservedCheck[] = [];
  const unobserved: RequiredCheckRef[] = [];
  const untrusted: UntrustedEnvelope[] = [];

  for (const purpose of PURPOSES) {
    const envelope = envelopes[purpose];
    const required = contract.required_checks[purpose] ?? [];
    const reason = trustOf(contract, envelope);

    if (reason !== null) {
      const saw = claimOf(envelope, reason);
      untrusted.push(saw === undefined ? { purpose, reason } : { purpose, reason, saw });
      // Nothing from an untrusted envelope reaches `observed`, including its
      // `false`s. That is the whole rule: it is not evidence of failure, it is
      // an absence of evidence.
      for (const id of required) unobserved.push({ purpose, id });
      continue;
    }

    const byId = new Map((envelope.checks ?? []).map((check) => [check.id, check]));
    for (const id of required) {
      const check = byId.get(id);
      if (check === undefined || check.passed === null) {
        unobserved.push({ purpose, id });
        continue;
      }
      observed.push(
        check.detail === undefined
          ? { purpose, id, passed: check.passed }
          : { purpose, id, passed: check.passed, detail: check.detail },
      );
    }
  }

  const anyFailed = observed.some((check) => !check.passed);
  const score = anyFailed ? false : unobserved.length === 0 ? true : null;

  // `unavailable` is "nothing was observed at all", which is not the same as
  // "something is missing". The table's last row -- invalid feedback with a
  // missing audit -- is the only shape that reaches it.
  const coverage: Coverage =
    unobserved.length === 0 ? "complete" : observed.length === 0 ? "unavailable" : "partial";

  return { score, coverage, observed, unobserved, untrusted };
};

/**
 * The first workflow score: a three-valued AND of handoff validity and the first
 * artifact's score (#1033 §2).
 *
 * `handoff === false` is false whatever the artifact says, including when no
 * solve was ever launched — a definitively failed handoff is a known failure,
 * not an absence. A successful commit carrying no record is a *valid* handoff
 * and proceeds; recording nothing is a complete answer in this product, and a
 * scorer that treated it as invalid would measure the study's own assumption.
 */
export const andThreeValued = (handoff: boolean | null, artifact: boolean | null): boolean | null => {
  if (handoff === false || artifact === false) return false;
  if (handoff === true && artifact === true) return true;
  return null;
};
