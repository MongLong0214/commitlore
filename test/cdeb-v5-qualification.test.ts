/** CDEB-Fresh v5 qualification: the removed gate stays removed, and a tie-break must break the tie. */

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { AuthorityAuditEntry } from "../bench/cdeb/freeze/authority-v5.ts";
import type { DeliveryFeasibility } from "../bench/cdeb/freeze/delivery-v4.ts";
import {
  V5_THRESHOLDS,
  assertNoProvenanceGate,
  decideV5,
  mergeV5,
  resolveTieBreak,
  summarizeV5,
  type Interpretation,
  type V5QualificationEntry,
} from "../bench/cdeb/freeze/qualify-v5.ts";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const V5 = resolve(HERE, "..", "bench", "cdeb", "studies", "cdeb-fresh-v5");
const SCRIPT = resolve(HERE, "..", "scripts", "render-v5-stage0-result.mjs");

const authority = (id: string, repository = "repo-a", overrides: Partial<AuthorityAuditEntry> = {}): AuthorityAuditEntry => ({
  schema_version: 1,
  study_id: "cdeb-fresh-v5",
  candidate_id: id,
  repository_id: repository,
  source_commit_sha: "b".repeat(40),
  decision_audit_anchor: "c".repeat(64),
  recorded_at: "2026-07-01T00:00:00Z",
  pre_cutoff: true,
  in_frozen_snapshot: true,
  ordinary_development_origin: true,
  benchmark_authored: false,
  reconstructed_or_backfilled: false,
  explicit_ruled_out: true,
  explicit_reason: true,
  scope_recoverable: true,
  lifecycle_recoverable: true,
  authorized_repository: true,
  authority: "A0",
  a0_failures: [],
  independent_corroboration: false,
  corroboration_decidable: true,
  corroboration_sources: [],
  authority_strength: "A0",
  identity_present: false,
  record_id: null,
  ...overrides,
});

const interpretation = (all: boolean, overrides: Partial<Interpretation> = {}): Interpretation => ({
  candidate_id: "x",
  ruled_out_behavior: "a global cache for tenant records",
  reason: "it leaked state across tenants",
  scope: ["src/a.ts"],
  lifecycle: "active",
  violation_boundary: "any module-level cache keyed without the tenant",
  compliance_boundary: "a per-request cache keyed by tenant",
  decidable: all,
  g3_reason_hidden_from_code: all,
  g4_wrong_path_functionally_viable: all,
  g5_oracle_deterministic: all,
  g7_bounded_task_feasible: all,
  note: "",
  ...overrides,
});

const delivered = (ok: boolean): DeliveryFeasibility => ({
  candidate_id: "x",
  identity_present: false,
  record_id: null,
  ruling_visible: ok,
  reason_visible: ok,
  before_first_mutation: true,
  scope_correct: ok,
  lifecycle_correct: true,
  stale_as_current: false,
  delivered: ok,
  in_scope_payload_bytes: 512,
  in_scope_payload_sha256: "0".repeat(64),
  out_of_scope_payload_bytes: 0,
  exit_code: 0,
  stderr: "",
});

const mergeOne = (options: {
  a?: Interpretation;
  b?: Interpretation;
  c?: Interpretation;
  d?: Interpretation;
  deliveredOk?: boolean;
  auth?: Partial<AuthorityAuditEntry>;
}): V5QualificationEntry => {
  const id = "v5-one";
  const pair = options.a && options.b
    ? new Map([[id, { a: options.a, b: options.b, ...(options.c ? { c: options.c } : {}), ...(options.d ? { d: options.d } : {}) }]])
    : new Map();
  return mergeV5({
    authority: [authority(id, "repo-a", options.auth)],
    interpretations: pair,
    delivery: new Map([[id, delivered(options.deliveredOk ?? true)]]),
    leakageExcluded: new Set(),
  })[0]!;
};

describe("CDEB v5 qualification", () => {
  it("qualifies a decision with no identity and no corroboration anywhere", () => {
    const entry = mergeOne({ a: interpretation(true), b: interpretation(true) });
    expect(entry.qualified).toBe(true);
    expect(entry.identity_present).toBe(false);
    expect(entry.independent_corroboration).toBe(false);
    expect(entry.exclusion_code).toBeNull();
  });

  it("never excludes for missing identity or missing corroboration", () => {
    for (const auth of [{ identity_present: false, record_id: null }, { independent_corroboration: false }]) {
      expect(mergeOne({ a: interpretation(true), b: interpretation(true), auth }).qualified).toBe(true);
    }
    // Corroboration present changes strength, not admission.
    const corroborated = mergeOne({
      a: interpretation(true),
      b: interpretation(true),
      auth: { independent_corroboration: true, authority_strength: "A1" },
    });
    expect(corroborated.qualified).toBe(true);
    expect(corroborated.authority_strength).toBe("A1");
  });

  it("refuses a run in which v4's provenance gate has returned under a new name", () => {
    const clean = [mergeOne({ a: interpretation(true), b: interpretation(true) })];
    expect(() => assertNoProvenanceGate(clean)).not.toThrow();
    const renamed = [{ ...clean[0]!, qualified: false, exclusion_code: "insufficient-provenance" }];
    expect(() => assertNoProvenanceGate(renamed)).toThrow(/provenance-shaped code/);
    const corroborationCode = [{ ...clean[0]!, qualified: false, exclusion_code: "no-independent-corroboration" }];
    expect(() => assertNoProvenanceGate(corroborationCode)).toThrow(/provenance-shaped code/);
    // Excluded while every declared gate passed: something outside the gates did it.
    const silent = [{ ...clean[0]!, qualified: false, exclusion_code: null }];
    expect(() => assertNoProvenanceGate(silent)).toThrow(/every declared gate passed/);
    // Every qualified candidate corroborated: the run cannot show corroboration is optional.
    const allCorroborated = [{ ...clean[0]!, independent_corroboration: true }];
    expect(() => assertNoProvenanceGate(allCorroborated)).toThrow(/cannot show that corroboration is not required/);
  });

  it("only lets a tie-break resolve when both tie-breakers agree", () => {
    expect(resolveTieBreak(true, true)).toBe(true);
    expect(resolveTieBreak(false, false)).toBe(false);
    // A tie-break drawn from one disputant's own model is that disputant voting
    // twice; two that disagree have not broken anything.
    expect(resolveTieBreak(true, false)).toBeUndefined();
    expect(resolveTieBreak(true, undefined)).toBeUndefined();
    expect(resolveTieBreak(undefined, undefined)).toBeUndefined();

    const split = { a: interpretation(true), b: interpretation(true, { g3_reason_hidden_from_code: false }) };
    expect(mergeOne(split).gates.G3).toEqual({ passed: false, source: "unresolved" });
    expect(mergeOne({ ...split, c: interpretation(true) }).gates.G3).toEqual({ passed: false, source: "unresolved" });
    expect(mergeOne({ ...split, c: interpretation(true), d: interpretation(true) }).gates.G3).toEqual({
      passed: true,
      source: "adjudicated",
    });
    expect(
      mergeOne({ ...split, c: interpretation(true), d: interpretation(true, { g3_reason_hidden_from_code: false }) }).gates.G3,
    ).toEqual({ passed: false, source: "unresolved" });
  });

  it("fails closed on a missing reviewer and on an undelivered decision", () => {
    expect(mergeOne({}).gates.G2).toEqual({ passed: false, source: "unavailable" });
    expect(mergeOne({}).qualified).toBe(false);
    const undelivered = mergeOne({ a: interpretation(true), b: interpretation(true), deliveredOk: false });
    expect(undelivered.qualified).toBe(false);
    expect(undelivered.exclusion_code).toBe("shipping-content-not-observable");
  });

  it("applies the registered repository rule and takes no outcome into it", () => {
    const entries: V5QualificationEntry[] = [];
    for (const [repository, count] of [["repo-a", 8], ["repo-b", 8], ["repo-c", 20], ["repo-d", 7]] as const) {
      for (let index = 0; index < count; index += 1) {
        entries.push({ ...mergeOne({ a: interpretation(true), b: interpretation(true) }), candidate_id: `${repository}-${String(index)}`, repository_id: repository });
      }
    }
    const summaries = summarizeV5(entries);
    expect(summaries.find((row) => row.repository_id === "repo-d")?.eligible).toBe(false);
    const verdict = decideV5(summaries, entries);
    expect(verdict).toMatchObject({ verdict: "GO", eligible_repositories: 3, total_qualified: 43 });
    expect(verdict.recommended_fixed_set).toEqual(["repo-a", "repo-b", "repo-c"]);
    // One short everywhere: the thresholds do not bend.
    const short = entries.slice(0, 35);
    expect(decideV5(summarizeV5(short), short).verdict).toBe("HOLD");
    expect(V5_THRESHOLDS).toEqual({ minQualifiedPerEligibleRepository: 8, minEligibleRepositories: 3, minTotalQualified: 36 });
  });

  it("carries no treatment or outcome field in a Stage 0 row", () => {
    const text = JSON.stringify(mergeOne({ a: interpretation(true), b: interpretation(true) }));
    for (const forbidden of ["arm", "treatment", "outcome", "token", "revival", "randomization"]) {
      expect(text).not.toMatch(new RegExp(`"[a-z_]*${forbidden}[a-z_]*"\\s*:`, "i"));
    }
  });
});

describe("CDEB v5 Stage 0 result rendering", () => {
  const run = (args: readonly string[]): string => {
    try {
      return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? "";
      throw new Error(stderr.trim() === "" ? String(error) : stderr.trim());
    }
  };

  it("keeps the committed result in step with the artifacts it reports", () => {
    run(["--check", "--study-root", V5]);
  });

  it("refuses to render a study that claims a measured run", () => {
    const directory = mkdtempSync(join(tmpdir(), "cdeb-v5-render-"));
    mkdirSync(join(directory, "feasibility"), { recursive: true });
    cpSync(join(V5, "study.json"), join(directory, "study.json"));
    writeFileSync(join(directory, "STATUS.json"), '{"study_id":"x","phase":"p","measured_run_allowed":true}\n');
    expect(() => run(["--study-root", directory])).toThrow(/measured_run_allowed is not false/);
    rmSync(directory, { recursive: true, force: true });
  });

  it("reports the verdict, the thresholds and zero measured rows", () => {
    const result = readFileSync(join(V5, "feasibility", "RESULT.md"), "utf8");
    expect(result).toContain("measured product-effect rows = 0");
    expect(result).toContain("CDEB-FRESH V5 STAGE 0 COMPLETE — PRODUCT-EFFECT MEASUREMENT NOT STARTED");
    expect(result).toContain("owner testimony:  disabled — A2 collected 0");
    expect(result).toContain("missing-id exclusions: 0");
    expect(result).toContain("no pilot");
  });
});
