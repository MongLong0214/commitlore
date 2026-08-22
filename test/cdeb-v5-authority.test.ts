/**
 * CDEB-Fresh v5 authority: A0 admits the record itself, and A1 cannot exclude.
 *
 * Every A0 condition passed for all 241 candidates in the real corpus, because
 * the census only emits a candidate whose record parsed out of the frozen
 * bundle. That makes these tests the only place A0's teeth are visible, so each
 * rejection below is exercised on a fixture built to trip exactly one condition.
 */

import { describe, expect, it } from "vitest";

import type { V4CandidateEntry } from "../bench/cdeb/freeze/census-v4.ts";
import {
  A0_FAILURE_CODES,
  a0Discrimination,
  assertCorroborationIsNotAGate,
  attachCorroboration,
  classifyA0,
  looksBenchmarkAuthored,
  summarizeAuthority,
  type AuthorityAuditEntry,
} from "../bench/cdeb/freeze/authority-v5.ts";
import {
  MIN_RULING_CONTENT_WORDS,
  corroborationDecidable,
  coverage,
} from "../bench/cdeb/freeze/corroboration-v5.ts";

const CUTOFF = "2026-08-20T22:08:19Z";

const candidate = (overrides: Partial<V4CandidateEntry> = {}): V4CandidateEntry => ({
  schema_version: 1,
  study_id: "cdeb-fresh-v4",
  candidate_id: "v5-one",
  repository_id: "gitseed",
  snapshot_sha: "a".repeat(40),
  source_commit_sha: "b".repeat(40),
  source_refs: ["b".repeat(40)],
  storage_kind: "commit-trailer",
  storage_locator: `commit:${"b".repeat(40)}`,
  decision_ordinal: 0,
  sibling_decision_count: 1,
  decision_audit_anchor: "c".repeat(64),
  identity_present: false,
  record_id: null,
  protocol_version: null,
  provenance_value: "authored",
  lifecycle: "active",
  path_scope: ["src/seed.ts"],
  decision_sha256: "d".repeat(64),
  reason_sha256: "e".repeat(64),
  reason_chars: 48,
  recorded_at: "2026-07-01T00:00:00Z",
  pre_cutoff: true,
  qualification_status: "pending",
  ineligibility_codes: [],
  pending_gates: [],
  ...overrides,
});

const classify = (overrides: Partial<V4CandidateEntry> = {}, extra: Record<string, unknown> = {}) =>
  classifyA0({
    candidate: candidate(overrides),
    cutoff: CUTOFF,
    authorizedRepositories: ["gitseed", "agent-operator-score", "logic-pro-mcp", "agent-control-plane"],
    benchmarkAuthoredRecordIds: new Set<string>(),
    benchmarkAuthoredCommits: new Set<string>(),
    ...extra,
  });

const audited = (overrides: Partial<AuthorityAuditEntry> = {}): AuthorityAuditEntry => ({
  ...attachCorroboration(classify().fields, []),
  ...overrides,
});

describe("CDEB v5 A0 natural recorded authority", () => {
  it("admits a record with no Record-Id and no corroboration anywhere", () => {
    const { failures, fields } = classify();
    // The whole point of v5: this candidate would have failed v4 twice over.
    expect(failures).toEqual([]);
    expect(fields.authority).toBe("A0");
    expect(fields.identity_present).toBe(false);
    const entry = attachCorroboration(fields, []);
    expect(entry.independent_corroboration).toBe(false);
    expect(entry.authority_strength).toBe("A0");
  });

  it("rejects each way a record can fail to be natural, one at a time", () => {
    expect(classify({ recorded_at: "2026-08-21T00:00:00Z" }).failures).toEqual(["post-cutoff"]);
    expect(classify({ recorded_at: null }).failures).toEqual(["post-cutoff"]);
    expect(classify({ pre_cutoff: false }).failures).toEqual(["record-absent-from-snapshot"]);
    expect(classify({ provenance_value: "reconstructed" }).failures).toEqual(["backfilled-or-reconstructed"]);
    expect(classify({ provenance_value: "migrated" }).failures).toEqual(["backfilled-or-reconstructed"]);
    expect(classify({ reason_chars: 0 }).failures).toEqual(["reason-not-explicit"]);
    expect(classify({ path_scope: [] }).failures).toEqual(["scope-unresolvable"]);
    expect(classify({ lifecycle: "unknown" as never }).failures).toEqual(["lifecycle-unresolvable"]);
    expect(classify({ repository_id: "some-other-repo" }).failures).toEqual(["unauthorized-repository"]);
    // Every declared failure code is reachable from this fixture set except the
    // named-id path, which the next test covers.
    expect(new Set(A0_FAILURE_CODES).size).toBe(A0_FAILURE_CODES.length);
  });

  it("rejects a record a benchmark wrote, by name and by shape", () => {
    expect(
      classify({ record_id: "r-cdebp01" }, { benchmarkAuthoredRecordIds: new Set(["r-cdebp01"]) }).failures,
    ).toEqual(["benchmark-authored"]);
    expect(
      classify({}, { benchmarkAuthoredCommits: new Set(["b".repeat(40)]) }).failures,
    ).toEqual(["benchmark-authored"]);
    // The shape scan is the one A0 condition not satisfied by how the census
    // builds its input, so it has to be able to fire on its own.
    expect(classify({}, { commitPaths: ["bench/cdeb/freeze/census.ts"] }).failures).toEqual(["benchmark-authored"]);
    expect(classify({}, { commitSubject: "add CDEB corpus fixtures" }).failures).toEqual(["benchmark-authored"]);
    expect(looksBenchmarkAuthored("ordinary refactor", ["src/seed.ts"])).toBe(false);
    expect(looksBenchmarkAuthored("ordinary refactor", ["bench/results/x.jsonl"])).toBe(true);
  });

  it("reports which A0 conditions were inert rather than presenting a structural pass as a filter", () => {
    const allClean = [audited(), audited({ candidate_id: "v5-two" })];
    const report = a0Discrimination(allClean);
    expect(report.every((row) => row.inert)).toBe(true);
    const withOneFailure = [
      ...allClean,
      audited({ candidate_id: "v5-three", benchmark_authored: true, a0_failures: ["benchmark-authored"], authority: "none" }),
    ];
    const second = a0Discrimination(withOneFailure);
    expect(second.find((row) => row.condition === "not_benchmark_authored")).toEqual({
      condition: "not_benchmark_authored",
      failed: 1,
      inert: false,
    });
    expect(second.find((row) => row.condition === "pre_cutoff")?.inert).toBe(true);
  });
});

describe("CDEB v5 A1 corroboration is metadata", () => {
  it("cannot change an authority verdict in either direction", () => {
    const fields = classify().fields;
    const without = attachCorroboration(fields, []);
    const with_ = attachCorroboration(fields, [{ kind: "adr", locator: "docs/adr/ADR-1.md" }]);
    expect(without.authority).toBe("A0");
    expect(with_.authority).toBe("A0");
    expect(without.authority_strength).toBe("A0");
    expect(with_.authority_strength).toBe("A1");
    // A candidate that failed A0 does not become admissible by being corroborated.
    const failed = classify({ provenance_value: "reconstructed" }).fields;
    expect(attachCorroboration(failed, [{ kind: "adr", locator: "docs/adr/ADR-1.md" }]).authority).toBe("none");
  });

  it("refuses an audit in which corroboration and admission move together", () => {
    const mixed = [audited(), audited({ candidate_id: "v5-two", independent_corroboration: true, authority_strength: "A1" })];
    expect(() => assertCorroborationIsNotAGate(mixed)).not.toThrow();
    // Every A0 candidate corroborated: the audit cannot show corroboration is
    // not the thing doing the admitting.
    const allCorroborated = mixed.map((entry) => ({ ...entry, independent_corroboration: true }));
    expect(() => assertCorroborationIsNotAGate(allCorroborated)).toThrow(/cannot show that corroboration is not gating/);
    // A candidate excluded without naming an A0 failure is the v4 gate wearing
    // a different name.
    const silentlyExcluded = [...mixed, audited({ candidate_id: "v5-three", authority: "none", a0_failures: [] })];
    expect(() => assertCorroborationIsNotAGate(silentlyExcluded)).toThrow(/without naming an A0 failure/);
  });

  it("declines to match a ruling too generic to mean anything", () => {
    // Both were real false positives in the first run.
    expect(corroborationDecidable("artifact storage port")).toBe(false);
    expect(corroborationDecidable("fixing this gap in this commit")).toBe(false);
    expect(corroborationDecidable("monkeypatching isatty or injecting a fake stream into the reader")).toBe(true);
    expect(MIN_RULING_CONTENT_WORDS).toBe(5);
  });

  it("scores a window rather than a whole file, so scattered words do not count", () => {
    const ruling = "absolute paths taken from user input escape the target root";
    const together = "we rejected absolute paths taken from user input because one would escape the target root";
    const scattered = [
      "absolute",
      ...Array.from({ length: 60 }, () => "unrelated filler line"),
      "paths taken from user input",
      ...Array.from({ length: 60 }, () => "more filler"),
      "escape the target root",
    ].join("\n");
    expect(coverage(together, ruling)).toBeGreaterThan(0.8);
    expect(coverage(scattered, ruling)).toBeLessThan(0.8);
  });

  it("counts A0-only separately from A1 so the two are never merged", () => {
    const summary = summarizeAuthority([
      audited(),
      audited({ candidate_id: "v5-two", independent_corroboration: true, authority_strength: "A1" }),
      audited({ candidate_id: "v5-three", authority: "none", a0_failures: ["post-cutoff"] }),
    ]);
    expect(summary[0]).toMatchObject({ repository_id: "gitseed", raw_decisions: 3, a0: 2, a1: 1, a0_only: 1 });
    expect(summary[0]!.a0_failures).toEqual({ "post-cutoff": 1 });
  });
});
