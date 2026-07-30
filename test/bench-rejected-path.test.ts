/**
 * Rejected-path work (bug #141).
 *
 * `reproposed`/`reproposal_matches` answer "did the output match the rejected
 * alternative's signature", and a correct refusal can match that signature too
 * — an agent that explains, in prose, that it declined the rejected
 * alternative was scored the same as one that implemented it. This suite
 * covers the replacement: separate observable counts of how much a diff
 * actually pursued the rejected path, derived from the diff and a task's own
 * `reproposed_if` clauses rather than from a new parallel matcher.
 */

import { describe, expect, it } from "vitest";

import { countRejectedPathWork } from "../bench/detect.ts";
import { assertOutcomeCanBeRegistered } from "../bench/metrics.ts";
import type { MatcherGroup, RunRecord } from "../bench/types.ts";

const REDIS_GROUP: MatcherGroup = {
  any_of: [{ kind: "literal", value: "redis", in: "code" }],
};

const row = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  run_id: "rejected-path-test",
  harness_commit: "1111111111111111111111111111111111111111",
  dist_digest: "2222222222222222222222222222222222222222222222222222222222222222",
  task: "reproposal-redis-cache",
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

describe("rejected-path work", () => {
  it("scores zero when the diff only explains that the alternative was declined", () => {
    // Same shape as reproposal-rabbitmq-queue seed 2 (test/bench-detect.test.ts):
    // the alternative is named, but only in a comment explaining it was avoided.
    // No line here implements Redis, so none of the four counts should move.
    const diff = [
      "diff --git a/src/session.ts b/src/session.ts",
      "--- a/src/session.ts",
      "+++ b/src/session.ts",
      "@@ -1,2 +1,3 @@",
      "+// Extending the TTL would also work, but a shared Redis cache was ruled",
      "+// out on security policy, so this keeps the in-process map.",
      " export const readSession = (id: string): string | null => get(`session:${id}`);",
    ].join("\n");

    const work = countRejectedPathWork(REDIS_GROUP, diff);

    expect(work).toEqual({
      editHunks: 0,
      linesChanged: 0,
      dependencyAdditions: 0,
      firstEditOccurred: 0,
    });
  });

  it("counts hunks and lines when the diff edits toward the rejected alternative", () => {
    const diff = [
      "diff --git a/src/cache.ts b/src/cache.ts",
      "--- a/src/cache.ts",
      "+++ b/src/cache.ts",
      "@@ -1,2 +1,4 @@",
      "-const store = new Map<string, Entry>();",
      '+import Redis from "ioredis";',
      "+",
      "+const client = new Redis(process.env.REDIS_URL);",
    ].join("\n");

    const work = countRejectedPathWork(REDIS_GROUP, diff);

    expect(work.editHunks).toBe(1);
    // 1 removed + 3 added lines in the one matched hunk.
    expect(work.linesChanged).toBe(4);
    expect(work.firstEditOccurred).toBe(1);
  });

  it("counts a dependency added to a manifest separately from edit hunks", () => {
    const diff = [
      "diff --git a/package.json b/package.json",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -3,6 +3,7 @@",
      '     "commander": "^15.0.0",',
      '+    "ioredis": "^5.4.1",',
      '     "js-yaml": "^5.2.2",',
    ].join("\n");

    const work = countRejectedPathWork(REDIS_GROUP, diff);

    expect(work.dependencyAdditions).toBe(1);
    expect(work.firstEditOccurred).toBe(1);
  });

  it("reads only added lines, so deleting the rejected code is not pursuing it", () => {
    const diff = [
      "diff --git a/src/cache.ts b/src/cache.ts",
      "--- a/src/cache.ts",
      "+++ b/src/cache.ts",
      "@@ -1,2 +1,1 @@",
      '-import Redis from "ioredis";',
      "+const store = new Map<string, Entry>();",
    ].join("\n");

    const work = countRejectedPathWork(REDIS_GROUP, diff);

    expect(work).toEqual({
      editHunks: 0,
      linesChanged: 0,
      dependencyAdditions: 0,
      firstEditOccurred: 0,
    });
  });

  it("does not fabricate a turn count for abandoning the rejected path", () => {
    // Bug #141 named six counts. Two are not observable with what this harness
    // records today:
    //   - rejected-path tool actions: the driver's transcript is the CLI's
    //     final result text, not a tool-call log.
    //   - turns spent before abandoning the rejected path: `RunRecord.turns` is
    //     a single run-total (`num_turns`), with no per-turn attribution.
    // This test is the contract that a future change does not quietly invent
    // either of them: `countRejectedPathWork` returns exactly the four counts
    // that are derivable from the diff, and nothing shaped like a turn index
    // or an action tally.
    const work = countRejectedPathWork(REDIS_GROUP, "");

    expect(Object.keys(work).sort()).toEqual(
      ["dependencyAdditions", "editHunks", "firstEditOccurred", "linesChanged"].sort(),
    );
  });

  it("refuses the new outcome at registration when it has zero variance", () => {
    expect(() =>
      assertOutcomeCanBeRegistered(
        "rejected_path_edit_hunks",
        [
          row({ rejected_path_edit_hunks: 0 }),
          row({ seed: 2, rejected_path_edit_hunks: 0 }),
        ],
        new Map([["reproposal-redis-cache", 3]]),
        (r) => r.rejected_path_edit_hunks,
      ),
    ).toThrow(/rejected_path_edit_hunks.*zero variance.*pinned at 0/i);
  });

  it("accepts the new outcome at registration when it has genuine spread", () => {
    expect(() =>
      assertOutcomeCanBeRegistered(
        "rejected_path_edit_hunks",
        [
          row({ rejected_path_edit_hunks: 0 }),
          row({ seed: 2, rejected_path_edit_hunks: 1 }),
          row({ seed: 3, rejected_path_edit_hunks: 2 }),
        ],
        new Map([["reproposal-redis-cache", 3]]),
        (r) => r.rejected_path_edit_hunks,
      ),
    ).not.toThrow();
  });
});
