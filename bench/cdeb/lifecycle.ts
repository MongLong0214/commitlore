/** PRD §4.1's ordered, forward-only study lifecycle. */
export const FORWARD_STUDY_STATES = [
  "DRAFT",
  "LITERATURE_LOCKED",
  "CORPUS_QUALIFIED",
  "INSTRUMENT_QUALIFIED",
  "PILOT_FROZEN",
  "PILOT_COMPLETE",
  "POWER_LOCKED",
  "PREREGISTERED",
  "CONFIRMATORY_FROZEN",
  "RUNNING",
  "ROWS_SEALED",
  "ANALYSIS_LOCKED",
  "PUBLISHED",
] as const;

/**
 * A study whose ledger outran its artifacts needs a terminal failure state.
 * Editing that ledger cannot repair it: an auditor cannot distinguish the edit
 * from the original mistake, so the instance must remain auditable and end.
 */
export const INVALIDATED = "INVALIDATED" as const;

export const STUDY_STATES = [...FORWARD_STUDY_STATES, INVALIDATED] as const;

export type StudyState = (typeof STUDY_STATES)[number];

const stateIndex = (state: (typeof FORWARD_STUDY_STATES)[number]): number =>
  FORWARD_STUDY_STATES.indexOf(state);

export const canTransition = (from: StudyState, to: StudyState): boolean => {
  if (from === INVALIDATED) return false;
  if (to === INVALIDATED) return true;
  // §4.1 orders states because each one earns the next. Skipping would make an
  // unearned state look valid, so only the immediately following state is legal.
  return stateIndex(to) === stateIndex(from) + 1;
};

export const assertTransition = (from: StudyState, to: StudyState): void => {
  if (!canTransition(from, to)) {
    throw new Error(`Refused study transition from ${from} to ${to}`);
  }
};
