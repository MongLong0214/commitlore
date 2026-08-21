/** CDEB-Fresh v4 adjudicated review and the GO/HOLD arithmetic. */

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));

import type { V4CandidateEntry } from "../bench/cdeb/freeze/census-v4.ts";
import type { DeliveryFeasibility } from "../bench/cdeb/freeze/delivery-v4.ts";
import type { ProvenanceAuditEntry } from "../bench/cdeb/freeze/provenance-v4.ts";
import {
  assertCoversBatch,
  parseStageAResponse,
  parseStageBResponse,
  type StageAVerdict,
  type StageBVerdict,
} from "../bench/cdeb/freeze/review-v4.ts";
import {
  GO_THRESHOLDS,
  QUOTE_OVERLAP_FLOOR,
  agreementByGate,
  decideStage0,
  mergeQualification,
  quoteOverlap,
  summarizeRepositories,
  type QualificationEntry,
} from "../bench/cdeb/freeze/qualify-v4.ts";

const candidate = (id: string, repository = "repo-a", overrides: Partial<V4CandidateEntry> = {}): V4CandidateEntry => ({
  schema_version: 1,
  study_id: "cdeb-fresh-v4",
  candidate_id: id,
  repository_id: repository,
  snapshot_sha: "a".repeat(40),
  source_commit_sha: "b".repeat(40),
  source_refs: ["b".repeat(40)],
  storage_kind: "commit-trailer",
  storage_locator: `commit:${"b".repeat(40)}`,
  decision_ordinal: 0,
  sibling_decision_count: 1,
  decision_audit_anchor: "c".repeat(64),
  identity_present: true,
  record_id: "r-example",
  protocol_version: "2.0.0",
  provenance_value: "authored",
  lifecycle: "active",
  path_scope: ["src/a.ts"],
  decision_sha256: "d".repeat(64),
  reason_sha256: "e".repeat(64),
  reason_chars: 40,
  recorded_at: "2026-01-01T00:00:00Z",
  pre_cutoff: true,
  qualification_status: "pending",
  ineligibility_codes: [],
  pending_gates: ["G2", "G3", "G4", "G5", "G6", "G7"],
  ...overrides,
});

const audit = (id: string, repository = "repo-a", overrides: Partial<ProvenanceAuditEntry> = {}): ProvenanceAuditEntry => ({
  schema_version: 1,
  candidate_id: id,
  repository_id: repository,
  source_commit_sha: "b".repeat(40),
  decision_audit_anchor: "c".repeat(64),
  ordinary_source: "prose",
  ordinary_source_sha256: "f".repeat(64),
  ordinary_body_chars: 5,
  ordinary_body_survives: true,
  removed_trailer_count: 3,
  residual_record_lines_removed: 0,
  files_changed: 2,
  insertions: 10,
  deletions: 2,
  changed_paths: ["src/a.ts"],
  benchmark_authored: false,
  provenance_value: "authored",
  g1_natural_provenance: true,
  g2_mechanical: true,
  mechanical_exclusion: null,
  provenance_tier: "pending",
  ...overrides,
});

const stageA = (found: boolean, quote: string): StageAVerdict => ({
  candidate_id: "x",
  states_rejected_alternative: found,
  quoted_alternative: quote,
  quoted_reason: "because it leaked state",
  note: "",
});

const stageB = (all: boolean, overrides: Partial<StageBVerdict> = {}): StageBVerdict => ({
  candidate_id: "x",
  g3_reason_hidden_from_code: all,
  g4_wrong_path_functionally_viable: all,
  g5_oracle_deterministic: all,
  g7_bounded_task_feasible: all,
  note: "",
  ...overrides,
});

const delivery = (delivered: boolean, identity = true): DeliveryFeasibility => ({
  candidate_id: "x",
  identity_present: identity,
  record_id: identity ? "r-example" : null,
  ruling_visible: delivered,
  reason_visible: delivered,
  before_first_mutation: true,
  scope_correct: delivered,
  lifecycle_correct: true,
  stale_as_current: false,
  delivered,
  in_scope_payload_bytes: 512,
  in_scope_payload_sha256: "0".repeat(64),
  out_of_scope_payload_bytes: 0,
  exit_code: 0,
  stderr: "",
});

const RULING = "a global cache for tenant records";

const mergeOne = (options: {
  a?: { r1: StageAVerdict; r2: StageAVerdict; r3?: StageAVerdict };
  b?: { r1: StageBVerdict; r2: StageBVerdict; r3?: StageBVerdict };
  delivered?: boolean;
  auditOverrides?: Partial<ProvenanceAuditEntry>;
  candidateOverrides?: Partial<V4CandidateEntry>;
}): QualificationEntry => {
  const id = "v4-one";
  const merged = mergeQualification({
    candidates: [candidate(id, "repo-a", options.candidateOverrides)],
    audit: [audit(id, "repo-a", options.auditOverrides)],
    stageA: new Map(options.a === undefined ? [] : [[id, options.a]]),
    stageB: new Map(options.b === undefined ? [] : [[id, options.b]]),
    delivery: new Map([[id, delivery(options.delivered ?? true)]]),
    rulings: new Map([[id, { ruling: RULING, reason: "it leaked state across tenants" }]]),
  });
  return merged[0]!;
};

const passingPair = {
  a: { r1: stageA(true, "they considered a global cache for tenant records"), r2: stageA(true, "a global cache for tenant records") },
  b: { r1: stageB(true), r2: stageB(true) },
};

describe("CDEB v4 review coverage", () => {
  it("refuses a response that leaves part of its batch unmentioned", () => {
    expect(() => assertCoversBatch(["a", "b", "c"], ["a", "b"], [], "reviewer")).toThrow(
      /left 1 candidate\(s\) unaccounted for: c/,
    );
    // Declining is an answer; silence is not.
    expect(() => assertCoversBatch(["a", "b", "c"], ["a", "b"], ["c"], "reviewer")).not.toThrow();
  });

  it("refuses invented ids and a candidate both judged and declined", () => {
    expect(() => assertCoversBatch(["a"], ["a", "z"], [], "reviewer")).toThrow(/were not in the batch: z/);
    expect(() => assertCoversBatch(["a"], ["a"], ["a"], "reviewer")).toThrow(/both judged and declined a/);
  });

  it("parses a fenced response and refuses a non-boolean verdict", () => {
    const good = '```json\n{"verdicts":[{"candidate_id":"a","states_rejected_alternative":true,"quoted_alternative":"q","quoted_reason":"r"}],"declined":[]}\n```';
    expect(parseStageAResponse(good, ["a"], "reviewer")).toHaveLength(1);
    const unknown = '{"verdicts":[{"candidate_id":"a","states_rejected_alternative":"unknown"}],"declined":[]}';
    // "unknown" is not an answer, and coercing it to false records a decision
    // nobody made.
    expect(() => parseStageAResponse(unknown, ["a"], "reviewer")).toThrow(/must be true or false, received "unknown"/);
    expect(() => parseStageAResponse("no json here", ["a"], "reviewer")).toThrow(/returned no JSON object/);
  });

  it("requires every Stage B question to be answered", () => {
    const missingG5 = '{"verdicts":[{"candidate_id":"a","g3_reason_hidden_from_code":true,"g4_wrong_path_functionally_viable":true,"g7_bounded_task_feasible":true}],"declined":[]}';
    expect(() => parseStageBResponse(missingG5, ["a"], "reviewer")).toThrow(/g5 must be true or false/);
  });
});

describe("CDEB v4 qualification merge", () => {
  it("qualifies only when every gate passed", () => {
    const entry = mergeOne(passingPair);
    expect(entry.qualified).toBe(true);
    expect(entry.exclusion_code).toBeNull();
    expect(entry.provenance_tier).toBe("P1");
    expect(entry.quote_overlap).toBeGreaterThanOrEqual(QUOTE_OVERLAP_FLOOR);
  });

  it("fails closed on a split pair with no third vote, and resolves by majority when there is one", () => {
    const split = mergeOne({ ...passingPair, b: { r1: stageB(true), r2: stageB(true, { g4_wrong_path_functionally_viable: false }) } });
    expect(split.gates.G4).toEqual({ passed: false, source: "unresolved" });
    expect(split.qualified).toBe(false);
    expect(split.exclusion_code).toBe("wrong-path-not-functionally-viable-unresolved");

    const resolved = mergeOne({
      ...passingPair,
      b: {
        r1: stageB(true),
        r2: stageB(true, { g4_wrong_path_functionally_viable: false }),
        r3: stageB(true),
      },
    });
    expect(resolved.gates.G4).toEqual({ passed: true, source: "adjudicated" });
    expect(resolved.qualified).toBe(true);
  });

  it("fails G2 when the reviewers found a different decision in the same commit", () => {
    const wrongDecision = mergeOne({
      ...passingPair,
      a: {
        r1: stageA(true, "they considered shipping without a migration"),
        r2: stageA(true, "shipping without a migration was rejected"),
      },
    });
    // Both reviewers found *a* rejected alternative; neither found this one.
    expect(wrongDecision.gates.G2.passed).toBe(false);
    expect(wrongDecision.quote_overlap).toBeLessThan(QUOTE_OVERLAP_FLOOR);
    expect(wrongDecision.exclusion_code).toBe("insufficient-provenance");
  });

  it("treats a missing reviewer verdict as a failure, never as a pass", () => {
    const noStageB = mergeOne({ a: passingPair.a });
    expect(noStageB.gates.G3).toEqual({ passed: false, source: "unavailable" });
    expect(noStageB.qualified).toBe(false);
  });

  it("keeps identity out of the verdict in both directions", () => {
    const idLess = mergeOne({ ...passingPair, candidateOverrides: { identity_present: false, record_id: null } });
    expect(idLess.qualified).toBe(true);
    expect(idLess.identity_present).toBe(false);
    const identifiedButUndelivered = mergeOne({ ...passingPair, delivered: false });
    expect(identifiedButUndelivered.qualified).toBe(false);
    expect(identifiedButUndelivered.exclusion_code).toBe("shipping-content-not-observable");
  });

  it("excludes a superseded decision that shipping still puts in front of an agent", () => {
    const stale: DeliveryFeasibility = {
      ...delivery(false),
      ruling_visible: true,
      reason_visible: true,
      lifecycle_correct: false,
      stale_as_current: true,
      delivered: false,
    };
    const id = "v4-stale";
    const [entry] = mergeQualification({
      candidates: [candidate(id, "repo-a", { lifecycle: "superseded" })],
      audit: [audit(id)],
      stageA: new Map([[id, passingPair.a]]),
      stageB: new Map([[id, passingPair.b]]),
      delivery: new Map([[id, stale]]),
      rulings: new Map([[id, { ruling: RULING, reason: "it leaked state across tenants" }]]),
    });
    expect(entry!.lifecycle).toBe("superseded");
    expect(entry!.gates.G6.passed).toBe(false);
    expect(entry!.qualified).toBe(false);
  });

  it("carries no treatment or outcome field anywhere in a qualification row", () => {
    const entry = mergeOne(passingPair);
    const text = JSON.stringify(entry);
    // Stage 0 must not be able to hold an outcome even by accident: a field
    // named for one is how a feasibility artifact quietly becomes a result.
    for (const forbidden of ["arm", "treatment", "outcome", "token", "safe_success", "revival", "randomization"]) {
      expect(text).not.toMatch(new RegExp(`"[a-z_]*${forbidden}[a-z_]*"\\s*:`, "i"));
    }
  });

  it("measures overlap against this ruling, ignoring case and punctuation", () => {
    expect(quoteOverlap("A Global Cache, for tenant records.", RULING)).toBe(1);
    expect(quoteOverlap("an unrelated sentence", RULING)).toBe(0);
    expect(quoteOverlap("", RULING)).toBe(0);
  });
});

describe("CDEB v4 Stage 0 verdict", () => {
  const entriesFor = (counts: Record<string, number>, identityMix = true): QualificationEntry[] => {
    const entries: QualificationEntry[] = [];
    for (const [repository, count] of Object.entries(counts)) {
      for (let index = 0; index < count; index += 1) {
        entries.push({
          ...mergeOne(passingPair),
          candidate_id: `${repository}-${String(index)}`,
          repository_id: repository,
          identity_present: identityMix ? index % 2 === 0 : true,
        });
      }
    }
    return entries;
  };

  it("says GO only when every registered threshold is met", () => {
    const entries = entriesFor({ "repo-a": 16, "repo-b": 16, "repo-c": 16 });
    const verdict = decideStage0(summarizeRepositories(entries), entries);
    expect(verdict).toMatchObject({ verdict: "GO", eligible_repositories: 3, total_qualified: 48, unmet: [] });
    expect(verdict.recommended_fixed_set).toEqual(["repo-a", "repo-b", "repo-c"]);
  });

  it("holds when a repository is short, and names what was short", () => {
    const entries = entriesFor({ "repo-a": 30, "repo-b": 30, "repo-c": 11 });
    const summaries = summarizeRepositories(entries);
    const verdict = decideStage0(summaries, entries);
    expect(summaries.find((summary) => summary.repository_id === "repo-c")?.eligible).toBe(false);
    expect(verdict.verdict).toBe("HOLD");
    expect(verdict.unmet).toContain(`eligible repositories 2 < ${String(GO_THRESHOLDS.minEligibleRepositories)}`);
    // The total is met and the repository count is not; a threshold that traded
    // one for the other would not be a threshold.
    expect(verdict.total_qualified).toBe(71);
  });

  it("holds when only identified decisions qualify, because that proves the old instrument and nothing else", () => {
    const entries = entriesFor({ "repo-a": 16, "repo-b": 16, "repo-c": 16 }, false);
    const verdict = decideStage0(summarizeRepositories(entries), entries);
    expect(verdict.verdict).toBe("HOLD");
    expect(verdict.unmet).toContain("no id-less decision qualified, so the estimand change is not demonstrated");
  });

  it("reports agreement per gate rather than as one average", () => {
    const entries = [
      { ...mergeOne(passingPair) },
      { ...mergeOne({ ...passingPair, b: { r1: stageB(true), r2: stageB(true, { g4_wrong_path_functionally_viable: false }) } }) },
    ];
    const rates = agreementByGate(entries);
    expect(rates.find((rate) => rate.gate === "G3")?.rate).toBe(1);
    expect(rates.find((rate) => rate.gate === "G4")?.rate).toBe(0.5);
  });
});

describe("CDEB v4 Stage 0 result rendering", () => {
  const STUDY = resolve(HERE, "..", "bench", "cdeb", "studies", "cdeb-fresh-v4");
  const SCRIPT = resolve(HERE, "..", "scripts", "render-stage0-result.mjs");

  const run = (args: readonly string[]): string => {
    try {
      return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      // The renderer reports its refusal on stderr and exits 1; the message is
      // the thing under test, so it must reach the assertion.
      const stderr = (error as { stderr?: string }).stderr ?? "";
      throw new Error(stderr.trim() === "" ? String(error) : stderr.trim());
    }
  };

  it("keeps the committed result in step with the artifacts it reports", () => {
    // Two copies of the same counts disagree eventually, and the disagreement is
    // silent. --check is what makes it loud.
    run(["--check", "--study-root", STUDY]);
  });

  it("refuses to render a study that claims a measured run", () => {
    const directory = mkdtempSync(join(tmpdir(), "cdeb-v4-render-"));
    mkdirSync(join(directory, "feasibility"), { recursive: true });
    cpSync(join(STUDY, "study.json"), join(directory, "study.json"));
    writeFileSync(join(directory, "STATUS.json"), '{"study_id":"x","phase":"p","measured_run_allowed":true}\n');
    expect(() => run(["--study-root", directory])).toThrow(/measured_run_allowed is not false/);
    rmSync(directory, { recursive: true, force: true });
  });
});
