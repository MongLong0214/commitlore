/**
 * How a mutation run is read, kept apart from the runner that produces it.
 *
 * The ratchet spawns one Vitest process per mutation, so the only way to test
 * its reading inside the suite is to separate the reading from the running.
 * Everything here is pure.
 */

// bound, inert, unavailable and uncovered are states a baseline may record: they
// describe how far coverage reaches, and a known gap can be carried.
export const BASELINE_OUTCOMES = new Set(["bound", "inert", "unavailable", "uncovered"]);

// These two are not gaps, they are broken registrations, so the baseline may not
// hold them and measuring one always fails.
export const REGISTRATION_DEFECTS = new Set(["misfiled", "unresolved"]);

export const ALL_OUTCOMES = [...BASELINE_OUTCOMES, ...REGISTRATION_DEFECTS];

// Worst first. unresolved leads because nothing was measured at all, so the
// property is neither shown defended nor shown undefended. inert outranks
// misfiled because inert means no test anywhere reacted, whereas misfiled means
// the property is defended and only the name recorded against it is wrong.
export const OUTCOME_SEVERITY = ["unresolved", "unavailable", "inert", "misfiled", "bound"];

/**
 * Read one mutation from its runs.
 *
 * `named` is the run filtered to the registered test name; `whole` is the same
 * file unfiltered and is only consulted when the named test survived.
 *
 * The `executed === 0` branch is the one that matters. `vitest run -t <name>`
 * exits 0 when the name matches nothing -- it skips the whole file and reports
 * success -- so an exit code alone cannot separate a mutation nothing reacted to
 * from a test name that no longer resolves. Renaming a test is routine, and
 * under that reading its guard degrades to inert without anything saying so.
 */
export const classifyRun = (named, whole) => {
  if (!named.started) return "unavailable";
  if (named.executed === 0) return "unresolved";
  if (named.failed > 0) return "bound";
  // The named test survived. Before calling the property undefended, ask whether
  // anything else in the file reacted: a mutation registered against the wrong
  // test looks identical to one nothing catches, and only the second is a
  // coverage gap.
  if (whole !== undefined && whole.started && whole.failed > 0) return "misfiled";
  return "inert";
};

/** A property is represented by the worst outcome among its mutations. */
export const severestOutcome = (outcomes) =>
  OUTCOME_SEVERITY.find((candidate) => outcomes.includes(candidate)) ?? "bound";
