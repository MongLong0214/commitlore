/**
 * CDEB-Fresh v3 candidate-direction primitives. The legacy v1 census remains
 * intentionally untouched; a later packet wires this contract into it.
 */
export const QUALIFICATION_STATUSES = ["pending", "eligible", "ineligible"] as const;

export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number];

export interface CandidateV3Qualification {
  readonly qualification_status: QualificationStatus;
  readonly pending_fields: readonly string[];
  readonly ineligibility_codes: readonly string[];
}

/** Pending adjudication is not evidence of permanent ineligibility. */
export const qualificationStatusFor = (
  pendingFields: readonly string[],
  ineligibilityCodes: readonly string[],
): QualificationStatus => {
  if (pendingFields.length > 0) return "pending";
  return ineligibilityCodes.length > 0 ? "ineligible" : "eligible";
};

/** Selection must consume only adjudicated eligible candidates. */
export const assertCandidateSelectable = (candidate: CandidateV3Qualification): void => {
  if (candidate.qualification_status !== "eligible") {
    throw new Error(`Candidate is not selectable: qualification_status is ${candidate.qualification_status}`);
  }
  if (candidate.pending_fields.length !== 0) {
    throw new Error(`Candidate is not selectable: pending_fields measured ${candidate.pending_fields.length}`);
  }
  if (candidate.ineligibility_codes.length !== 0) {
    throw new Error(`Candidate is not selectable: ineligibility_codes measured ${candidate.ineligibility_codes.length}`);
  }
};
