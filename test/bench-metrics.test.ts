import { describe, expect, it } from "vitest";

import { countReproposalMatches } from "../bench/detect.ts";
import { assertPrimaryOutcomeCanBeRegistered } from "../bench/metrics.ts";
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
