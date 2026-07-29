import { describe, expect, it } from "vitest";

import { countReproposalMatches } from "../bench/detect.ts";
import {
  assertPrimaryOutcomeCanBeRegistered,
  qualifyAnalysisSet,
} from "../bench/metrics.ts";
import type { RunRecord } from "../bench/types.ts";

const row = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  run_id: "metrics-test",
  harness_commit: "1111111111111111111111111111111111111111",
  dist_digest: "2222222222222222222222222222222222222222222222222222222222222222",
  task: "task-a",
  cond: "commitlore-on",
  seed: 1,
  reproposed: false,
  violations: 0,
  turns: 1,
  tokens: 1,
  stopped_by: "completed",
  duration_ms: 1,
  driver: "synthetic",
  started_at: "2026-07-28T00:00:00.000Z",
  simulated: false,
  guard_exposure: { complete: true, executed: false, checks: 0, fires: 0, matches: [] },
  ...overrides,
});

const rowWithoutExposure = (): RunRecord => {
  const result = { ...row() };
  delete result.guard_exposure;
  return result;
};

const qualificationRows = (task: string, counts: readonly number[], cond = "commitlore-off"): RunRecord[] =>
  counts.map((reproposal_matches, index) =>
    row({
      task,
      cond,
      seed: index + 1,
      reproposed: reproposal_matches > 0,
      reproposal_matches,
    }),
  );

describe("reproposal primary outcome", () => {
  it("counts each matched reproposal label once", () => {
    const result = countReproposalMatches(
      {
        any_of: [
          { kind: "literal", value: "redis", label: "redis" },
          { kind: "literal", value: "Redis", label: "redis" },
        ],
      },
      { transcript: "", diff: "+ add Redis\n", commits: "" },
    );

    expect(result.count).toBe(1);
  });

  it("refuses an all-zero primary outcome", () => {
    expect(() =>
      assertPrimaryOutcomeCanBeRegistered(
        "reproposal_matches",
        [row({ reproposal_matches: 0 }), row({ seed: 2, reproposal_matches: 0 })],
        new Map([["task-a", 2]]),
      ),
    ).toThrow(/reproposal_matches.*zero variance.*pinned at 0/i);
  });

  it("refuses an outcome at every task structural maximum", () => {
    expect(() =>
      assertPrimaryOutcomeCanBeRegistered(
        "reproposal_matches",
        [row({ reproposal_matches: 1 }), row({ task: "task-b", seed: 2, reproposal_matches: 2 })],
        new Map([
          ["task-a", 1],
          ["task-b", 2],
        ]),
      ),
    ).toThrow(/reproposal_matches.*structural maximum/i);
  });

  it("accepts a primary outcome with genuine spread", () => {
    expect(() =>
      assertPrimaryOutcomeCanBeRegistered(
        "reproposal_matches",
        [
          row({ reproposal_matches: 0 }),
          row({ seed: 2, reproposal_matches: 1 }),
          row({ task: "task-b", seed: 3, reproposal_matches: 2 }),
        ],
        new Map([
          ["task-a", 2],
          ["task-b", 3],
        ]),
      ),
    ).not.toThrow();
  });

  it("refuses registration with no pilot rows", () => {
    expect(() => assertPrimaryOutcomeCanBeRegistered("reproposal_matches", [], new Map())).toThrow(
      "refusing to register primary outcome `reproposal_matches`: no pilot rows",
    );
  });

  it("refuses registration when pilot guard exposure is missing or incomplete", () => {
    expect(() =>
      assertPrimaryOutcomeCanBeRegistered(
        "reproposal_matches",
        [
          rowWithoutExposure(),
          row({
            seed: 2,
            guard_exposure: { complete: false, executed: false, checks: 0, fires: 0, matches: [] },
          }),
        ],
        new Map([["task-a", 2]]),
      ),
    ).toThrow(
      "refusing to register primary outcome `reproposal_matches`: guard exposure is unknown for 2 pilot row(s)",
    );
  });

  it("refuses registration when an outcome is not a non-negative integer", () => {
    expect(() =>
      assertPrimaryOutcomeCanBeRegistered(
        "reproposal_matches",
        [row({ reproposal_matches: -1 })],
        new Map([["task-a", 2]]),
      ),
    ).toThrow(
      "refusing to register primary outcome `reproposal_matches`: it is not a non-negative integer on every pilot row",
    );
  });

  it("refuses registration when a pilot task has no structural maximum", () => {
    expect(() =>
      assertPrimaryOutcomeCanBeRegistered("reproposal_matches", [row({ reproposal_matches: 1 })], new Map()),
    ).toThrow(
      "refusing to register primary outcome `reproposal_matches`: structural maximum is missing for a pilot task",
    );
  });
});

describe("task qualification", () => {
  const maximums = new Map([
    ["at-floor", 7],
    ["inside", 8],
    ["above-ceiling", 7],
  ]);

  it("qualifies the inclusive 4/6 floor using the count outcome", () => {
    const result = qualifyAnalysisSet(qualificationRows("at-floor", [3, 5, 5, 5, 5, 5]), maximums, "commitlore-off");

    expect(result.qualifications).toEqual([
      expect.objectContaining({ task: "at-floor", matches: 28, opportunities: 42, rate: 4 / 6, qualifies: true }),
    ]);
    expect(result.analysis).toHaveLength(6);
  });

  it("qualifies a rate inside the band", () => {
    const result = qualifyAnalysisSet(qualificationRows("inside", [6, 6, 6, 6, 6, 6]), maximums, "commitlore-off");

    expect(result.qualifications[0]).toMatchObject({
      task: "inside",
      matches: 36,
      opportunities: 48,
      rate: 4.5 / 6,
      qualifies: true,
    });
  });

  it("excludes a count rate above the ceiling and records it", () => {
    const result = qualifyAnalysisSet(qualificationRows("above-ceiling", [6, 6, 6, 6, 6, 6]), maximums, "commitlore-off");

    expect(result.qualifications[0]).toMatchObject({
      task: "above-ceiling",
      matches: 36,
      opportunities: 42,
      rate: 6 / 7,
      qualifies: false,
      exclusion: "rate 36/42 is outside 4/6–5/6",
    });
  });

  it("uses matched-label counts rather than binary re-proposal presence", () => {
    const result = qualifyAnalysisSet(qualificationRows("inside", [4, 4, 4, 4, 4, 4]), maximums, "commitlore-off");

    expect(result.qualifications[0]).toMatchObject({
      matches: 24,
      opportunities: 48,
      rate: 3 / 6,
      qualifies: false,
    });
  });

  it("shrinks the analysis set when a task is excluded", () => {
    const rows = [
      ...qualificationRows("inside", [6, 6, 6, 6, 6, 6]),
      ...qualificationRows("inside", [1], "commitlore-on"),
      ...qualificationRows("above-ceiling", [6, 6, 6, 6, 6, 6]),
      ...qualificationRows("above-ceiling", [1], "commitlore-on"),
    ];

    const result = qualifyAnalysisSet(rows, maximums, "commitlore-off");

    expect(result.analysis).toHaveLength(7);
    expect(result.analysis.every((candidate) => candidate.task === "inside")).toBe(true);
  });
});
