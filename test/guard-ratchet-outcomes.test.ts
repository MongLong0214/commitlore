import { describe, expect, it } from "vitest";

import {
  ALL_OUTCOMES,
  BASELINE_OUTCOMES,
  OUTCOME_SEVERITY,
  REGISTRATION_DEFECTS,
  classifyRun,
  severestOutcome,
  // @ts-expect-error -- the ratchet and its helpers are plain ESM, not typed sources
} from "../scripts/guard-outcomes.mjs";

const ran = (failed: number) => ({ started: true, executed: 1, failed, failedNames: [] as string[] });
const failing = (...names: string[]) => ({ started: true, executed: names.length, failed: names.length, failedNames: names });
const nothingMatched = { started: true, executed: 0, failed: 0, failedNames: [] as string[] };
const crashed = { started: false, reason: "vitest exited 1 without writing a report" };

describe("how the mutation ratchet reads a run", () => {
  it("calls a mutation bound when the registered test fails", () => {
    expect(classifyRun(ran(1), undefined)).toBe("bound");
  });

  it("calls a mutation inert when the registered test and every other test survive", () => {
    expect(classifyRun(ran(0), ran(0))).toBe("inert");
  });

  it("does not call a mutation inert when a test other than the registered one fails", () => {
    // The failure this exists to stop: a real mutation and a real test, paired
    // wrongly. Reading it as inert reports the property undefended when it is
    // defended, and points the repair at the mutation instead of the name.
    expect(classifyRun(ran(0), failing("holds the floors at the values the preregistration fixed"))).toBe("misfiled");
  });

  it("does not call a mutation inert when the registered name matches no test", () => {
    // `vitest run -t <name>` skips the whole file and exits 0 when nothing
    // matches, so an exit code alone reads a renamed test as a mutation nothing
    // reacted to. Renaming a test is routine; its guard must not go quiet.
    expect(classifyRun(nothingMatched, undefined)).toBe("unresolved");
  });

  it("does not consult the unfiltered run before the registered name has resolved", () => {
    // Whatever else is failing, an unresolved name was not measured, so the
    // unfiltered run cannot upgrade it to a statement about coverage.
    expect(classifyRun(nothingMatched, failing("some other test"))).toBe("unresolved");
  });

  it("reports a run that never started as unavailable rather than as a gap", () => {
    expect(classifyRun(crashed, undefined)).toBe("unavailable");
  });
});

describe("which outcome represents a property", () => {
  it("takes the worst outcome among a property's mutations", () => {
    expect(severestOutcome(["bound", "inert", "bound"])).toBe("inert");
    expect(severestOutcome(["bound", "misfiled"])).toBe("misfiled");
    expect(severestOutcome(["inert", "unresolved"])).toBe("unresolved");
  });

  it("ranks every outcome it can be handed", () => {
    for (const outcome of ALL_OUTCOMES.filter((name: string) => name !== "uncovered")) {
      expect(OUTCOME_SEVERITY).toContain(outcome);
    }
  });

  it("reports bound only when nothing worse was measured", () => {
    expect(severestOutcome(["bound", "bound"])).toBe("bound");
    expect(severestOutcome([])).toBe("bound");
  });
});

describe("what a baseline may record", () => {
  it("refuses to treat a broken registration as a carryable gap", () => {
    // bound/inert/unavailable/uncovered say how far coverage reaches and can be
    // carried with a reason. misfiled and unresolved say the registration itself
    // is wrong, and recording one would ratchet in a guard whose stated coverage
    // cannot be checked.
    for (const defect of REGISTRATION_DEFECTS) {
      expect(BASELINE_OUTCOMES.has(defect)).toBe(false);
    }
  });

  it("keeps the two sets disjoint and complete", () => {
    expect(ALL_OUTCOMES.length).toBe(BASELINE_OUTCOMES.size + REGISTRATION_DEFECTS.size);
    expect(new Set(ALL_OUTCOMES).size).toBe(ALL_OUTCOMES.length);
  });
});
