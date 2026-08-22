/**
 * CDEB-Fresh v5 Stage 1-r1: the pre-execution design layer.
 *
 * Every test here maps to a FINAL-PRD §19 acceptance criterion, and several of
 * them assert that a guard throws on the artifact as committed. That is not a
 * placeholder: an unfinished census and an unfrozen runtime lock are the true
 * state of the study, and a guard that only fails on a synthetic fixture has
 * never been shown to fail on the thing it guards.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
// ajv-formats is CommonJS whose declaration ends in `export default`, so the
// callable lives on `.default` under this module resolution -- src/core/schema.ts
// unwraps it the same way.
import ajvFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const addFormats: FormatsPlugin = ajvFormats.default;

import {
  BUILDABLE,
  NOT_BUILDABLE_REASONS,
  assertBuildableHasValidatedControls,
  assertCensusComplete,
  assertDispositionsOutcomeBlind,
  assertExactlyOneDispositionPerCandidate,
  parseDisposition,
  summarizeCensus,
  type BuildabilityRow,
} from "../bench/cdeb/freeze/buildability-v5.ts";
import {
  assertFirewallCoversBuildable,
  assertManifestsPair,
  assertNoRecordLeakage,
  assertTaskAuthorInputsAllowed,
  assertTaskFrozenBeforeOracle,
  detectRecordLeakage,
  taskManifestDigest,
  type OracleBuildManifest,
  type TaskAuthorManifest,
} from "../bench/cdeb/freeze/firewall-v5.ts";
import {
  assertControlMatrix,
  assertControlsAreDistinctTrees,
  assertOracleDiscriminates,
  assertOracleInputsAllowed,
  validateOracle,
  type OracleControl,
  type OracleSpec,
} from "../bench/cdeb/freeze/oracle-v5.ts";
import {
  PREREGISTERED_REPLICATES,
  assertNoPostTreatmentDrop,
  assertNoRepositoryResampling,
  candidateClusters,
  candidateEffects,
  claimGate,
  dsfps,
  equalWeightDelta,
  ittEpisodes,
  nonDegradation,
  stratifiedBootstrap,
  type AssignedEpisode,
  type Episode,
} from "../bench/cdeb/freeze/analysis-v5.ts";
import {
  RUNTIME_LOCK_FIELDS,
  assertArmsDifferOnlyByDelivery,
  assertEpisodeMatchesFrozenLock,
  assertRuntimeLockComplete,
  type RuntimeLock,
} from "../bench/cdeb/freeze/runtime-lock-v5.ts";
import {
  TAU_SQUARED_BOUND,
  assertEnvelopeDetectsImportantEffect,
  assertFeasibilityCarriesNoEffect,
  assertPowerInputsEffectBlind,
  assertPowerRuleComplete,
  evaluatePilot,
  minimumDetectableEffect,
  normalQuantile,
  confirmatoryRepeatRule,
  repeatsRequiredForImportantEffect,
  simulatePower,
  type PilotFeasibility,
  type PilotFeasibilityThresholds,
  type PowerAndResourceRule,
} from "../bench/cdeb/freeze/effect-independence-v5.ts";
import { analysisPreconditions, assertEnvelopeArtifactsAgree } from "../bench/cdeb/freeze/stage1-analysis-v5.ts";
import {
  MIN_NEEDS,
  assertNeedScoutAnswer,
  needScoutPrompt,
  selectNeed,
} from "../bench/cdeb/freeze/task-chain-v5.ts";
import {
  assertSandboxIsRecordBlind,
  materializeRecordBlindTree,
  scanForRecordLeaks,
} from "../bench/cdeb/freeze/need-scout-v5.ts";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const V5 = resolve(HERE, "..", "bench", "cdeb", "studies", "cdeb-fresh-v5");
const R1 = join(V5, "stage1-r1");

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);

const censusRows = (): BuildabilityRow[] => readJsonl<BuildabilityRow>(join(R1, "buildability-census.jsonl"));

const qualifiedIds = (): string[] =>
  readJsonl<{ candidate_id: string; qualified: boolean }>(join(V5, "feasibility", "qualification.jsonl"))
    .filter((row) => row.qualified)
    .map((row) => row.candidate_id);

describe("§19.1-2 the failed draft stays visible and r1 is a distinct registration", () => {
  it("keeps the failed Stage 1 draft and its review in the tree", () => {
    const draft = readFileSync(join(V5, "STAGE1-PREREGISTRATION.md"), "utf8");
    expect(draft).toContain("DRAFT-NOT-FROZEN-failed-adversarial-review");
    expect(existsSync(join(V5, "stage1", "adversarial-review.md"))).toBe(true);
  });

  it("gives r1 its own identifier and names what it supersedes", () => {
    const r1 = readFileSync(join(R1, "STAGE1-PREREGISTRATION-r1.md"), "utf8");
    expect(r1).toContain("preregistration_identifier: CDEB-FRESH-V5-STAGE1-R1");
    expect(r1).toContain("supersedes: cdeb-fresh-v5-stage1-preregistration");
    expect(r1).toContain("A distinct preregistration, not an amendment");
  });
});

describe("§19.3-4 the measured run stays shut", () => {
  it("keeps measured_run_allowed false everywhere it is declared", () => {
    expect(readJson(join(V5, "STATUS.json")).measured_run_allowed).toBe(false);
    expect(readJson(join(V5, "study.json")).measured_run_allowed).toBe(false);
    expect(readFileSync(join(R1, "STAGE1-PREREGISTRATION-r1.md"), "utf8")).toContain("measured_run_allowed: false");
    expect(readFileSync(join(R1, "analysis-plan.md"), "utf8")).toContain("measured_run_allowed: false");
  });

  it("creates no directory a measured run would write outcomes into", () => {
    for (const forbidden of ["tasks", "gold", "oracles", "pilot", "rows", "randomization", "episodes", "results"]) {
      expect(existsSync(join(V5, forbidden))).toBe(false);
      expect(existsSync(join(R1, forbidden))).toBe(false);
    }
  });

  it("holds zero measured product-effect rows", () => {
    // The census is the only per-candidate artifact that exists, and it carries
    // no outcome field at all.
    assertDispositionsOutcomeBlind(censusRows() as unknown as Record<string, unknown>[]);
    expect(readJson(join(R1, "buildability-summary.json")).census_complete).toBe(false);
  });
});

describe("§19.5-6 the buildability census covers 62 and its reasons are schema-bound", () => {
  it("enumerates every qualified candidate exactly once", () => {
    const rows = censusRows();
    const population = qualifiedIds();
    expect(population.length).toBe(62);
    expect(rows.length).toBe(62);
    expect(() => {
      assertExactlyOneDispositionPerCandidate(population, rows);
    }).not.toThrow();
  });

  it("refuses a duplicated, a missing and an out-of-population candidate", () => {
    const rows = censusRows();
    const population = qualifiedIds();
    const first = rows[0];
    if (first === undefined) throw new Error("census is empty");
    expect(() => {
      assertExactlyOneDispositionPerCandidate(population, [...rows, first]);
    }).toThrow(/disposed twice/);
    expect(() => {
      assertExactlyOneDispositionPerCandidate(population, rows.slice(1));
    }).toThrow(/have no disposition/);
    expect(() => {
      assertExactlyOneDispositionPerCandidate(population, [...rows, { ...first, candidate_id: "v4-deadbeefdeadbeef" }]);
    }).toThrow(/outside the frozen population/);
  });

  it("accepts only registered reasons", () => {
    expect(parseDisposition(BUILDABLE)).toBe(BUILDABLE);
    for (const reason of NOT_BUILDABLE_REASONS) {
      expect(parseDisposition(`NOT_BUILDABLE:${reason}`)).toBe(`NOT_BUILDABLE:${reason}`);
    }
    expect(() => parseDisposition("NOT_BUILDABLE:too-awkward-to-bother")).toThrow(/not a registered reason/);
    expect(() => parseDisposition("SKIPPED")).toThrow(/is neither/);
    // The schema file and the code must list the same reasons.
    const schema = readFileSync(join(R1, "buildability-reasons.schema.json"), "utf8");
    for (const reason of NOT_BUILDABLE_REASONS) expect(schema).toContain(`NOT_BUILDABLE:${reason}`);
  });

  it("validates every committed row against the committed schema", () => {
    // The schema is additionalProperties:false, so a field added to the row type
    // and not to the schema makes the two disagree silently. That happened once,
    // with attempt_log_digest, and nothing caught it until this test existed.
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(join(R1, "buildability-reasons.schema.json"), "utf8")));
    for (const row of censusRows()) {
      const valid = validate(row);
      expect(valid, `${row.candidate_id}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
    // Every shape the code can emit must also validate.
    const sample = censusRows()[0];
    if (sample === undefined) throw new Error("census is empty");
    for (const disposition of [BUILDABLE, ...NOT_BUILDABLE_REASONS.map((reason) => `NOT_BUILDABLE:${reason}`)]) {
      expect(
        validate({
          ...sample,
          disposition,
          decided_at: new Date(0).toISOString(),
          evidence: "why",
          attempt_log_digest: "d".repeat(64),
        }),
        `${disposition}: ${ajv.errorsText(validate.errors)}`,
      ).toBe(true);
    }
    // And a reason the code refuses must be refused here too.
    expect(validate({ ...sample, disposition: "NOT_BUILDABLE:too-awkward-to-bother" })).toBe(false);
  });

  it("throws on the census as committed, because 62 dispositions are still open", () => {
    const rows = censusRows();
    expect(summarizeCensus(rows)).toMatchObject({ total: 62, buildable: 0, not_buildable: 0, undecided: 62 });
    expect(() => {
      assertCensusComplete(rows);
    }).toThrow(/62 of 62 candidates have no frozen disposition/);
  });

  it("refuses a row that could see an outcome", () => {
    expect(() => {
      assertDispositionsOutcomeBlind([{ candidate_id: "v4-0000000000000000", revival: false }]);
    }).toThrow(/post-hoc exclusion with a schema/);
  });

  it("refuses BUILDABLE without validated oracle controls", () => {
    const rows = censusRows();
    const first = rows[0];
    if (first === undefined) throw new Error("census is empty");
    const claimed: BuildabilityRow = { ...first, disposition: BUILDABLE, decided_at: new Date(0).toISOString() };
    expect(() => {
      assertBuildableHasValidatedControls([claimed], new Set());
    }).toThrow(/BUILDABLE with no validated oracle controls/);
    expect(() => {
      assertBuildableHasValidatedControls([claimed], new Set([first.candidate_id]));
    }).not.toThrow();
  });
});

describe("§19.7 pilot and reserve are deterministic, disjoint and total 62", () => {
  it("recomputes the allocation from the artifacts", () => {
    const design = readJson(join(V5, "stage1", "pilot-design.json"));
    const pilot = design.pilot as { candidates: { candidate_id: string; repository_id: string }[] };
    const reserve = design.confirmatory_reserve as { candidates: { candidate_id: string }[] };
    const pilotIds = new Set(pilot.candidates.map((row) => row.candidate_id));
    const reserveIds = new Set(reserve.candidates.map((row) => row.candidate_id));
    expect(pilotIds.size).toBe(12);
    expect(reserveIds.size).toBe(50);
    for (const id of pilotIds) expect(reserveIds.has(id)).toBe(false);
    expect(pilotIds.size + reserveIds.size).toBe(62);
    // Every allocated candidate is in the census, and vice versa.
    const censusIds = new Set(censusRows().map((row) => row.candidate_id));
    expect(censusIds.size).toBe(62);
    for (const id of [...pilotIds, ...reserveIds]) expect(censusIds.has(id)).toBe(true);
  });
});

describe("§19.8 every BUILDABLE candidate has the required oracle controls", () => {
  // Every control needs its own patch and its own tree: an oracle that reads
  // the final tree cannot answer differently for the same tree.
  let controlSeed = 0;
  const control = (overrides: Partial<OracleControl>): OracleControl => {
    controlSeed += 1;
    const unique = String(controlSeed).padStart(2, "0");
    return {
      control_id: `c${unique}`,
      kind: "compliant-passing",
      patch_digest: unique.repeat(32),
      final_tree_oid: `t${unique}`.padEnd(40, "0"),
      functional_acceptance_pass: true,
      oracle_revival: false,
      structural_note: "note",
      ...overrides,
    };
  };

  const spec = (controls: readonly OracleControl[], inputs: readonly string[] = ["final_tree"]): OracleSpec => ({
    schema_version: 1,
    study_id: "cdeb-fresh-v5",
    stage: "stage1-r1",
    candidate_id: "v4-0000000000000000",
    repository_id: "gitseed",
    oracle_digest: "1".repeat(64),
    inputs,
    controls,
    validated_at: new Date(0).toISOString(),
  });

  const wellFormed = [
    control({ control_id: "compliant-a", structural_note: "guard at the call site" }),
    control({ control_id: "compliant-b", structural_note: "guard in the collaborator" }),
    control({ control_id: "ruled-out", kind: "ruled-out-passing", oracle_revival: true, structural_note: "revives it" }),
  ];

  it("accepts a matrix with two distinct compliant controls and a passing violation", () => {
    expect(() => {
      validateOracle(spec(wellFormed));
    }).not.toThrow();
  });

  it("refuses one compliant control, no passing violation, and indistinct compliants", () => {
    expect(() => {
      assertControlMatrix(spec(wellFormed.slice(1)));
    }).toThrow(/compliant passing control/);
    expect(() => {
      assertControlMatrix(spec(wellFormed.slice(0, 2)));
    }).toThrow(/no ruled-out control that passes acceptance/);
    expect(() => {
      assertControlMatrix(
        spec([
          control({ control_id: "compliant-a", structural_note: "same" }),
          control({ control_id: "compliant-b", structural_note: "same" }),
          wellFormed[2] as OracleControl,
        ]),
      );
    }).toThrow(/not structurally distinct/);
  });

  it("refuses a ruled-out control that fails acceptance, because it proves nothing", () => {
    expect(() => {
      assertControlMatrix(
        spec([
          wellFormed[0] as OracleControl,
          wellFormed[1] as OracleControl,
          control({ control_id: "ruled-out", kind: "ruled-out-passing", oracle_revival: true, functional_acceptance_pass: false, structural_note: "revives it" }),
        ]),
      );
    }).toThrow(/does not pass functional acceptance/);
  });

  it("refuses an oracle that always answers the same, in either direction", () => {
    const blind = [
      wellFormed[0] as OracleControl,
      wellFormed[1] as OracleControl,
      control({ control_id: "ruled-out", kind: "ruled-out-passing", oracle_revival: false, structural_note: "revives it" }),
    ];
    expect(() => {
      assertOracleDiscriminates(spec(blind));
    }).toThrow(/score every revival as compliant/);
    const paranoid = [
      control({ control_id: "compliant-a", oracle_revival: true, structural_note: "a" }),
      control({ control_id: "compliant-b", oracle_revival: true, structural_note: "b" }),
      wellFormed[2] as OracleControl,
    ];
    expect(() => {
      assertOracleDiscriminates(spec(paranoid));
    }).toThrow(/score every episode as a revival/);
  });

  it("refuses an oracle that can read the arm, the transcript or a citation", () => {
    for (const leak of ["arm", "transcript", "record_citation", "token_usage"]) {
      expect(() => {
        assertOracleInputsAllowed(spec(wellFormed, ["final_tree", leak]));
      }).toThrow(/scores the treatment's arrival|unregistered input/);
    }
    expect(() => {
      assertOracleInputsAllowed(spec(wellFormed, ["functional_acceptance_result"]));
    }).toThrow(/does not read the final tree/);
  });

  it("has no oracle for any of the 62, which is why the census cannot close", () => {
    expect(existsSync(join(R1, "oracles"))).toBe(false);
    expect(readFileSync(join(R1, "STAGE1-PREREGISTRATION-r1.md"), "utf8")).toContain(
      "No oracle exists for any candidate",
    );
  });
});

describe("§19.9 firewall manifests prove the task froze before the oracle", () => {
  const task: TaskAuthorManifest = {
    schema_version: 1,
    study_id: "cdeb-fresh-v5",
    stage: "stage1-r1",
    candidate_id: "v4-0000000000000000",
    repository_id: "gitseed",
    phase: "record-blind-task",
    sequence: 1,
    inputs: { base_tree_oid: "a".repeat(40), repository_id: "b".repeat(64), allowed_scope: "c".repeat(64) },
    task_digest: "d".repeat(64),
    acceptance_digest: "e".repeat(64),
    frozen_at: new Date(0).toISOString(),
  };
  const oracle: OracleBuildManifest = {
    schema_version: 1,
    study_id: "cdeb-fresh-v5",
    stage: "stage1-r1",
    candidate_id: "v4-0000000000000000",
    repository_id: "gitseed",
    phase: "record-aware-oracle",
    sequence: 2,
    task_manifest_digest: taskManifestDigest(task),
    task_digest: task.task_digest,
    acceptance_digest: task.acceptance_digest,
    oracle_digest: "f".repeat(64),
    frozen_at: new Date(0).toISOString(),
  };

  it("accepts a well-ordered pair", () => {
    expect(() => {
      assertManifestsPair([task, oracle]);
    }).not.toThrow();
  });

  it("refuses a task author who was shown the record", () => {
    for (const leak of ["record", "reason", "ruled_out", "decision_audit_anchor", "gold"]) {
      expect(() => {
        assertTaskAuthorInputsAllowed({ ...task, inputs: { ...task.inputs, [leak]: "x".repeat(64) } });
      }).toThrow(/measure its own setup/);
    }
    expect(() => {
      assertTaskAuthorInputsAllowed({ ...task, inputs: { ...task.inputs, hint: "x" } });
    }).toThrow(/unregistered input/);
  });

  it("refuses an oracle built before, or against a task edited after", () => {
    expect(() => {
      assertTaskFrozenBeforeOracle(task, { ...oracle, sequence: 0 });
    }).toThrow(/may not precede the task freeze/);
    const edited: TaskAuthorManifest = { ...task, task_digest: "9".repeat(64) };
    expect(() => {
      assertTaskFrozenBeforeOracle(edited, oracle);
    }).toThrow(/The task changed after the oracle was built/);
  });

  it("refuses a half-built pair in either direction", () => {
    expect(() => {
      assertManifestsPair([task]);
    }).toThrow(/has a task but no oracle manifest/);
    expect(() => {
      assertManifestsPair([oracle]);
    }).toThrow(/no record-blind task manifest/);
  });

  it("does not let an empty manifest file satisfy a BUILDABLE candidate", () => {
    expect(readFileSync(join(R1, "firewall-manifest.jsonl"), "utf8").trim()).toBe("");
    // Vacuous pass on the empty set is correct; the coverage gate is what bites.
    expect(() => {
      assertManifestsPair([]);
    }).not.toThrow();
    expect(() => {
      assertFirewallCoversBuildable(["v4-0000000000000000"], []);
    }).toThrow(/no firewall manifest pair/);
    expect(() => {
      assertFirewallCoversBuildable([], []);
    }).not.toThrow();
  });

  it("catches the record's own phrasing surviving into the task text", () => {
    const record = "do not reach for the global cache from inside the request handler";
    const clean = detectRecordLeakage("v4-0", "Make the listing endpoint respond within the documented budget.", record);
    expect(clean.leaked).toBe(false);
    const leaked = detectRecordLeakage("v4-0", "Please avoid the global cache from inside the request handler here.", record);
    expect(leaked.leaked).toBe(true);
    expect(leaked.shared_count).toBeGreaterThan(0);
    expect(() => {
      assertNoRecordLeakage([leaked]);
    }).toThrow(/repeat the record's own phrasing/);
  });
});

describe("§19.10 the runtime lock is complete or it is not a lock", () => {
  it("throws on the lock as committed, which is unfrozen and empty", () => {
    const lock = readJson(join(R1, "runtime-lock.json")) as unknown as RuntimeLock;
    expect(lock.frozen_at).toBe(null);
    expect(() => {
      assertRuntimeLockComplete(lock);
    }).toThrow(/17 field\(s\) are unset/);
  });

  it("accepts a fully pinned lock and refuses an unregistered field", () => {
    const fields = Object.fromEntries(RUNTIME_LOCK_FIELDS.map((field) => [field, `pinned-${field}`]));
    const complete: RuntimeLock = {
      schema_version: 1,
      study_id: "cdeb-fresh-v5",
      stage: "stage1-r1",
      frozen_at: new Date(0).toISOString(),
      fields,
      arm_difference: "automatic-model-visible-commitlore-delivery",
    };
    expect(() => {
      assertRuntimeLockComplete(complete);
    }).not.toThrow();
    expect(() => {
      assertRuntimeLockComplete({ ...complete, fields: { ...fields, extra_knob: "x" } });
    }).toThrow(/unregistered field/);
    expect(() => {
      assertRuntimeLockComplete({ ...complete, frozen_at: null });
    }).toThrow(/not frozen/);
  });

  it("names every field on which the two arms drifted", () => {
    const fields = Object.fromEntries(RUNTIME_LOCK_FIELDS.map((field) => [field, `pinned-${field}`]));
    expect(() => {
      assertArmsDifferOnlyByDelivery(fields, fields);
    }).not.toThrow();
    expect(() => {
      assertArmsDifferOnlyByDelivery(fields, { ...fields, model_id: "moved-mid-run" });
    }).toThrow(/differ in model_id/);
  });
});

describe("§19.11 and §19.14 nothing about the effect reaches a design choice", () => {
  it("reads the frozen power rule and finds every field set before the pilot", () => {
    const rule = readJson(join(R1, "power-and-resource-rule.json")) as unknown as PowerAndResourceRule;
    expect(rule.frozen_before_pilot).toBe(true);
    expect(() => {
      assertPowerRuleComplete(rule);
    }).not.toThrow();
  });

  it("refuses every sizing input, because section 9 takes none", () => {
    // The empty input set is the design, not an oversight: N comes from the
    // buildable count, so the channel that could carry the effect is shut
    // rather than filtered.
    expect(() => {
      assertPowerInputsEffectBlind({});
    }).not.toThrow();
    for (const key of ["observed_effect", "arm_difference", "dsfps_delta", "treatment_contrast"]) {
      expect(() => {
        assertPowerInputsEffectBlind({ [key]: 0.1 });
      }).toThrow(/treatment contrast/);
    }
    // Even a genuine nuisance parameter is refused now.
    expect(() => {
      assertPowerInputsEffectBlind({ per_task_completion_rate: 0.8 });
    }).toThrow(/is not permitted/);
  });

  it("computes the detectable effect from the frozen envelope, and it is large", () => {
    const reserve = [7, 14, 19, 10];
    const at = (repeats: number, tau2: number): number =>
      minimumDetectableEffect({
        candidates_per_repository: reserve,
        repeats_per_arm: repeats,
        baseline_rate: 0.5,
        tau_squared: tau2,
        alpha_two_sided: 0.05,
        power_target: 0.9,
      });
    // The registered envelope: 8 repeats. Matches the table in the rule file.
    expect(at(8, 0)).toBeCloseTo(0.123, 3);
    expect(at(8, 0.03)).toBeCloseTo(0.149, 3);
    // More repeats help, but heterogeneity does not average away.
    expect(at(20, 0.06)).toBeGreaterThan(at(8, 0));
    expect(at(20, 0.06)).toBeCloseTo(0.143, 3);
    // An empty stratum has no detectable effect at all -- it has no estimand.
    expect(() =>
      minimumDetectableEffect({
        candidates_per_repository: [7, 14, 19, 0],
        repeats_per_arm: 8,
        baseline_rate: 0.5,
        tau_squared: 0,
        alpha_two_sided: 0.05,
        power_target: 0.9,
      }),
    ).toThrow(/undefined when a stratum is empty/);
  });

  it("computes quantiles that match published values", () => {
    // The first transcription dropped a denominator term, which made every z
    // about 1/400 of its true value and every design look superbly powered.
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.9)).toBeCloseTo(1.281552, 5);
    expect(normalQuantile(0.01)).toBeCloseTo(-2.326348, 5);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 10);
  });

  it("gates the pilot on feasibility alone and refuses a record carrying an effect", () => {
    const thresholds = readJson(join(R1, "pilot-feasibility-thresholds.json")) as unknown as PilotFeasibilityThresholds;
    const met: PilotFeasibility = {
      firewall_manifests_valid: 12,
      oracle_controls_reproduced: 12,
      delivery_manipulation_observed: 12,
      infrastructure_failure_rate: 0.05,
      median_runtime_seconds: 900,
      evaluator_reproducibility: 1,
    };
    const allBuildable = { total: 12, per_repository: { a: 3, b: 3, c: 3, d: 3 } };
    expect(evaluatePilot(thresholds, met, allBuildable)).toEqual({ verdict: "PASS", failed: [] });
    expect(evaluatePilot(thresholds, { ...met, firewall_manifests_valid: 11 }, allBuildable)).toEqual({
      verdict: "HOLD",
      failed: ["firewall_manifests_valid"],
    });
    // The counted thresholds follow the buildable subset, so a census that
    // disposes two pilot candidates NOT_BUILDABLE does not turn feasibility
    // pressure into a reason to call them buildable.
    const tenBuildable = { total: 10, per_repository: { a: 3, b: 3, c: 2, d: 2 } };
    const covered = { ...met, firewall_manifests_valid: 10, oracle_controls_reproduced: 10, delivery_manipulation_observed: 10 };
    expect(evaluatePilot(thresholds, covered, tenBuildable)).toEqual({ verdict: "PASS", failed: [] });
    // Too few buildable is a HOLD, and the candidate is never replaced.
    const tooFew = { total: 7, per_repository: { a: 3, b: 3, c: 1, d: 0 } };
    const verdict = evaluatePilot(thresholds, { ...covered, firewall_manifests_valid: 7, oracle_controls_reproduced: 7, delivery_manipulation_observed: 7 }, tooFew);
    expect(verdict.verdict).toBe("HOLD");
    expect(verdict.failed).toContain("min_buildable_pilot_candidates");
    expect(verdict.failed).toContain("min_buildable_pilot_candidates_per_repository:d");
    // The message matters, not just the throw. Every effect-named key is also
    // absent from the registered list, so a test that accepts either message
    // passes with the effect check disabled -- the mutation ratchet caught
    // exactly that and reported this guard inert. Asserting the effect-specific
    // diagnosis is what binds it.
    for (const key of ["dsfps_on", "revival_rate", "arm_delta", "observed_effect"]) {
      expect(() => {
        assertFeasibilityCarriesNoEffect({ ...met, [key]: 0.2 });
      }).toThrow(/may not read treatment-effect/);
    }
    expect(() => {
      assertFeasibilityCarriesNoEffect({ ...met, wall_clock_p95: 12 });
    }).toThrow(/not a registered feasibility measure/);
    expect(() => {
      evaluatePilot({ ...thresholds, frozen_before_pilot: false }, met, allBuildable);
    }).toThrow(/not frozen before the pilot/);
  });
});

describe("§19.12-13 the inference resamples candidates, and ITT keeps its failures", () => {
  const REPOS = ["agent-control-plane", "agent-operator-score", "gitseed", "logic-pro-mcp"];

  const episode = (overrides: Partial<Episode> & Pick<Episode, "candidate_id" | "repository_id" | "arm">): Episode => ({
    repeat_index: 0,
    completed: true,
    functional_acceptance_pass: true,
    revival: false,
    ...overrides,
  });

  const synthetic = (): Episode[] => {
    const rows: Episode[] = [];
    for (const [index, repository] of REPOS.entries()) {
      for (let candidate = 0; candidate < 3; candidate += 1) {
        const id = `c-${String(index)}-${String(candidate)}`;
        rows.push(episode({ candidate_id: id, repository_id: repository, arm: "on", revival: false }));
        rows.push(
          episode({ candidate_id: id, repository_id: repository, arm: "suppressed", revival: candidate === 0 }),
        );
      }
    }
    return rows;
  };

  it("scores DSFPS as a conjunction, with an unjudged episode as failure", () => {
    const base = { candidate_id: "c", repository_id: "gitseed", arm: "on" as const, repeat_index: 0 };
    expect(dsfps({ ...base, completed: true, functional_acceptance_pass: true, revival: false })).toBe(true);
    expect(dsfps({ ...base, completed: false, functional_acceptance_pass: true, revival: false })).toBe(false);
    expect(dsfps({ ...base, completed: true, functional_acceptance_pass: false, revival: false })).toBe(false);
    expect(dsfps({ ...base, completed: true, functional_acceptance_pass: true, revival: true })).toBe(false);
    // null is "the oracle could not judge", which is a failure, not a pass.
    expect(dsfps({ ...base, completed: true, functional_acceptance_pass: true, revival: null })).toBe(false);
  });

  it("keeps an assigned-but-unobserved episode in the denominator as a failure", () => {
    const assigned: AssignedEpisode[] = [
      { candidate_id: "c", repository_id: "gitseed", arm: "on", repeat_index: 0 },
      { candidate_id: "c", repository_id: "gitseed", arm: "suppressed", repeat_index: 0 },
    ];
    const observed = [episode({ candidate_id: "c", repository_id: "gitseed", arm: "suppressed" })];
    const itt = ittEpisodes(assigned, observed);
    expect(itt).toHaveLength(2);
    const missing = itt.find((row) => row.arm === "on");
    expect(missing?.completed).toBe(false);
    expect(missing?.revival).toBe(null);
    expect(dsfps(missing as Episode)).toBe(false);
  });

  it("refuses an analysis set that dropped an assigned episode", () => {
    const assigned: AssignedEpisode[] = [
      { candidate_id: "c", repository_id: "gitseed", arm: "on", repeat_index: 0 },
      { candidate_id: "c", repository_id: "gitseed", arm: "suppressed", repeat_index: 0 },
    ];
    const kept = [episode({ candidate_id: "c", repository_id: "gitseed", arm: "suppressed" })];
    expect(() => {
      assertNoPostTreatmentDrop(assigned, kept);
    }).toThrow(/can manufacture\s+the contrast/);
    expect(() => {
      assertNoPostTreatmentDrop(assigned, ittEpisodes(assigned, kept));
    }).not.toThrow();
  });

  it("refuses an observed episode that was never assigned", () => {
    expect(() =>
      ittEpisodes(
        [{ candidate_id: "c", repository_id: "gitseed", arm: "on", repeat_index: 0 }],
        [episode({ candidate_id: "other", repository_id: "gitseed", arm: "on" })],
      ),
    ).toThrow(/never assigned/);
  });

  it("weights the four repositories equally and stops on an empty stratum", () => {
    const effects = candidateEffects(synthetic());
    expect(effects).toHaveLength(12);
    const { delta, per_repository } = equalWeightDelta(effects, REPOS);
    // One candidate in three revives under suppression in every repository.
    for (const repository of REPOS) expect(per_repository[repository]).toBeCloseTo(1 / 3, 10);
    expect(delta).toBeCloseTo(1 / 3, 10);
    expect(() => equalWeightDelta(effects, [...REPOS, "empty-repository"])).toThrow(/undefined when one is empty/);
  });

  it("refuses a half-observed candidate rather than treating it as paired", () => {
    const rows = synthetic().filter((row) => !(row.candidate_id === "c-0-0" && row.arm === "on"));
    expect(() => candidateEffects(rows)).toThrow(/does not carry both arms/);
  });

  it("resamples candidates within fixed repositories and never the repositories", () => {
    expect(() => {
      assertNoRepositoryResampling("candidate");
    }).not.toThrow();
    for (const unit of ["repository", "repositories", "stratum", "strata"]) {
      expect(() => {
        assertNoRepositoryResampling(unit);
      }).toThrow(/256 distinct draws/);
    }
    expect(() => {
      assertNoRepositoryResampling("episode");
    }).toThrow(/must be the candidate cluster/);
  });

  it("produces a reproducible interval that brackets the point estimate", () => {
    const clusters = candidateClusters(synthetic());
    const options = { seed: "cdeb-fresh-v5-test-seed", replicates: 2000 };
    const first = stratifiedBootstrap(clusters, REPOS, options);
    const second = stratifiedBootstrap(clusters, REPOS, options);
    expect(first).toEqual(second);
    expect(first.point).toBeCloseTo(1 / 3, 10);
    expect(first.lower).toBeLessThanOrEqual(first.point);
    expect(first.upper).toBeGreaterThanOrEqual(first.point);
    expect(first.lower).toBeGreaterThan(0);
    expect(first.excludes_zero_in_predicted_direction).toBe(true);
    // A different seed gives a different draw; the point estimate does not move.
    const other = stratifiedBootstrap(clusters, REPOS, { ...options, seed: "another-seed" });
    expect(other.point).toBeCloseTo(first.point, 10);
  });

  it("preregisters 20,000 replicates and 95% by default", () => {
    expect(PREREGISTERED_REPLICATES).toBe(20000);
    const plan = readFileSync(join(R1, "analysis-plan.md"), "utf8");
    expect(plan).toContain("20,000");
    expect(plan).toContain("The four repositories are never resampled");
    expect(plan).toMatch(/intention-to-treat/i);
  });

  it("reports non-degradation against the frozen margin, under equal repository weighting", () => {
    const options = { seed: "nd-seed", replicates: 500 };
    const rows = synthetic();
    expect(nonDegradation(rows, REPOS, options).holds).toBe(true);
    const broken = rows.map((row) => (row.arm === "on" ? { ...row, completed: false } : row));
    const result = nonDegradation(broken, REPOS, options);
    expect(result.completion.point).toBeCloseTo(-1, 10);
    expect(result.holds).toBe(false);
  });

  it("cannot score a treatment that only prevents completion as a success", () => {
    // The ON arm finishes nothing; the SUPPRESSED arm finishes and half revives.
    const rows: Episode[] = [];
    for (const [index, repository] of REPOS.entries()) {
      for (let candidate = 0; candidate < 2; candidate += 1) {
        const id = `c-${String(index)}-${String(candidate)}`;
        rows.push(episode({ candidate_id: id, repository_id: repository, arm: "on", completed: false, revival: null }));
        rows.push(episode({ candidate_id: id, repository_id: repository, arm: "suppressed", revival: candidate === 0 }));
      }
    }
    const { delta } = equalWeightDelta(candidateEffects(rows), REPOS);
    // Delta is negative: never finishing is not decision-safe success.
    expect(delta).toBeLessThan(0);
    expect(nonDegradation(rows, REPOS, { seed: "s", replicates: 500 }).holds).toBe(false);
  });
});

/**
 * Each of these reproduces a defect an independent adversarial review found in
 * the first revision of this layer. All six were confirmed by running the code
 * before being fixed, and the numbers quoted are the ones that came back.
 */
describe("adversarial review findings, closed", () => {
  const REPOS = ["a", "b", "c", "d"];

  it("refuses two controls that share a patch or a tree", () => {
    const base: OracleSpec = {
      schema_version: 1,
      study_id: "cdeb-fresh-v5",
      stage: "stage1-r1",
      candidate_id: "v4-0",
      repository_id: "gitseed",
      oracle_digest: "1".repeat(64),
      inputs: ["final_tree"],
      validated_at: new Date(0).toISOString(),
      controls: [
        { control_id: "a", kind: "compliant-passing", patch_digest: "a".repeat(64), final_tree_oid: "t1".padEnd(40, "0"), functional_acceptance_pass: true, oracle_revival: false, structural_note: "x" },
        { control_id: "b", kind: "compliant-passing", patch_digest: "a".repeat(64), final_tree_oid: "t2".padEnd(40, "0"), functional_acceptance_pass: true, oracle_revival: false, structural_note: "y" },
        { control_id: "c", kind: "ruled-out-passing", patch_digest: "c".repeat(64), final_tree_oid: "t3".padEnd(40, "0"), functional_acceptance_pass: true, oracle_revival: true, structural_note: "z" },
      ],
    };
    // Before the fix this exact shape validated: one patch, contradictory verdicts.
    expect(() => {
      assertControlsAreDistinctTrees(base);
    }).toThrow(/share patch_digest/);
    const sharedTree: OracleSpec = {
      ...base,
      controls: base.controls.map((control, index) =>
        index === 1 ? { ...control, patch_digest: "b".repeat(64), final_tree_oid: "t1".padEnd(40, "0") } : control,
      ),
    };
    expect(() => {
      assertControlsAreDistinctTrees(sharedTree);
    }).toThrow(/share final_tree_oid/);
  });

  it("refuses a NOT_BUILDABLE row whose justification is only its label", () => {
    const row: BuildabilityRow = {
      schema_version: 1,
      study_id: "cdeb-fresh-v5",
      stage: "stage1-r1",
      candidate_id: "v4-0000000000000000",
      repository_id: "gitseed",
      screen: { base_tree_resolvable: true, scope_paths_present: 1, scope_paths_total: 1, acceptance_runner_present: true, acceptance_runner: "npm test" },
      disposition: "NOT_BUILDABLE:neutral-task-not-derivable",
      decided_at: new Date(0).toISOString(),
      evidence: null,
    };
    expect(() => {
      assertCensusComplete([row]);
    }).toThrow(/with no evidence/);
    // Evidence alone is not enough for a reason that asserts a failed attempt.
    expect(() => {
      assertCensusComplete([{ ...row, evidence: "tried and could not" }]);
    }).toThrow(/carries no attempt log/);
    expect(() => {
      assertCensusComplete([{ ...row, evidence: "tried and could not", attempt_log_digest: "d".repeat(64) }]);
    }).not.toThrow();
    // A mechanically decided reason needs evidence but no attempt log.
    expect(() => {
      assertCensusComplete([{ ...row, disposition: "NOT_BUILDABLE:scope-not-isolatable", evidence: "screen" }]);
    }).not.toThrow();
  });

  it("refuses a second observation of one assigned episode, and a wrong repository label", () => {
    const assigned: AssignedEpisode[] = [{ candidate_id: "c", repository_id: "a", arm: "on", repeat_index: 0 }];
    const failure: Episode = { candidate_id: "c", repository_id: "a", arm: "on", repeat_index: 0, completed: false, functional_acceptance_pass: false, revival: null };
    const success: Episode = { ...failure, completed: true, functional_acceptance_pass: true, revival: false };
    // Before the fix the success silently replaced the failure and every
    // assigned key was still present, so the drop guard saw nothing.
    expect(() => ittEpisodes(assigned, [failure, success])).toThrow(/two observations for the assigned episode/);
    expect(() => ittEpisodes(assigned, [{ ...success, repository_id: "WRONG" }])).toThrow(/never assigned/);
  });

  it("does not collapse the interval when every candidate agrees", () => {
    // 20 candidates, 8 repeats, each exactly 1-of-8 ON against 0-of-8 OFF.
    // Resampling only the candidate point estimates gave [0.125, 0.125] and
    // declared superiority; drawing the repeats too restores the uncertainty.
    const rows: Episode[] = [];
    for (const repository of REPOS) {
      for (let candidate = 0; candidate < 5; candidate += 1) {
        for (let repeat = 0; repeat < 8; repeat += 1) {
          rows.push({ candidate_id: `${repository}-${String(candidate)}`, repository_id: repository, arm: "on", repeat_index: repeat, completed: true, functional_acceptance_pass: true, revival: repeat !== 0 });
          rows.push({ candidate_id: `${repository}-${String(candidate)}`, repository_id: repository, arm: "suppressed", repeat_index: repeat, completed: true, functional_acceptance_pass: true, revival: true });
        }
      }
    }
    const interval = stratifiedBootstrap(candidateClusters(rows), REPOS, { seed: "collapse", replicates: 2000 });
    expect(interval.point).toBeCloseTo(0.125, 10);
    expect(interval.upper - interval.lower).toBeGreaterThan(0.01);
    expect(interval.lower).toBeLessThan(0.125);
  });

  it("does not let three large repositories mask a completion collapse in a small one", () => {
    const rows: Episode[] = [];
    for (const [index, repository] of REPOS.entries()) {
      const candidates = index === 0 ? 1 : 20;
      for (let candidate = 0; candidate < candidates; candidate += 1) {
        const id = `${repository}-${String(candidate)}`;
        rows.push({ candidate_id: id, repository_id: repository, arm: "on", repeat_index: 0, completed: index !== 0, functional_acceptance_pass: true, revival: false });
        rows.push({ candidate_id: id, repository_id: repository, arm: "suppressed", repeat_index: 0, completed: true, functional_acceptance_pass: true, revival: false });
      }
    }
    // Pooled, this was -1.6 points and passed. Equal-weighted it is -25.
    const result = nonDegradation(rows, REPOS, { seed: "mask", replicates: 500 });
    expect(result.completion.point).toBeCloseTo(-0.25, 10);
    expect(result.holds).toBe(false);
  });

  it("judges the margin on the confidence bound, not the point estimate", () => {
    // Four candidates per repository, eight repeats, one candidate losing one
    // completion. The point estimate is -3.1 points and clears the -5 margin;
    // the bound is -7.8 and does not. Comparing the point alone lets an
    // arbitrarily imprecise estimate a hair above the margin pass.
    const rows: Episode[] = [];
    for (const repository of REPOS) {
      for (let candidate = 0; candidate < 4; candidate += 1) {
        for (let repeat = 0; repeat < 8; repeat += 1) {
          const id = `${repository}-${String(candidate)}`;
          rows.push({ candidate_id: id, repository_id: repository, arm: "on", repeat_index: repeat, completed: !(candidate === 0 && repeat === 0), functional_acceptance_pass: true, revival: false });
          rows.push({ candidate_id: id, repository_id: repository, arm: "suppressed", repeat_index: repeat, completed: true, functional_acceptance_pass: true, revival: false });
        }
      }
    }
    const result = nonDegradation(rows, REPOS, { seed: "bound", replicates: 4000 });
    expect(result.completion.point).toBeGreaterThan(result.completion.margin);
    expect(result.completion.lower).toBeLessThan(result.completion.margin);
    expect(result.holds).toBe(false);
  });

  it("gates the headline claim on superiority and both margins together", () => {
    const assigned: AssignedEpisode[] = [];
    const observed: Episode[] = [];
    for (const repository of REPOS) {
      for (let candidate = 0; candidate < 4; candidate += 1) {
        const id = `${repository}-${String(candidate)}`;
        for (let repeat = 0; repeat < 4; repeat += 1) {
          for (const arm of ["on", "suppressed"] as const) {
            assigned.push({ candidate_id: id, repository_id: repository, arm, repeat_index: repeat });
            // ON never completes; SUPPRESSED completes and revives.
            observed.push(
              arm === "on"
                ? { candidate_id: id, repository_id: repository, arm, repeat_index: repeat, completed: false, functional_acceptance_pass: false, revival: null }
                : { candidate_id: id, repository_id: repository, arm, repeat_index: repeat, completed: true, functional_acceptance_pass: true, revival: true },
            );
          }
        }
      }
    }
    const gate = claimGate(assigned, observed, REPOS, { seed: "gate", replicates: 500 });
    expect(gate.may_claim_improvement).toBe(false);
    expect(gate.refusals.join(" ")).toMatch(/completion fell below/);
  });

  it("catches both arms drifting together away from the freeze", () => {
    const fields = Object.fromEntries(RUNTIME_LOCK_FIELDS.map((field) => [field, `frozen-${field}`]));
    const lock: RuntimeLock = {
      schema_version: 1,
      study_id: "cdeb-fresh-v5",
      stage: "stage1-r1",
      frozen_at: new Date(0).toISOString(),
      fields,
      arm_difference: "automatic-model-visible-commitlore-delivery",
    };
    const drifted = { ...fields, model_id: "rolled-forward" };
    // Arm-versus-arm sees two equal objects and passes; the freeze does not.
    expect(() => {
      assertArmsDifferOnlyByDelivery(drifted, drifted);
    }).not.toThrow();
    expect(() => {
      assertEpisodeMatchesFrozenLock(lock, drifted, "episode-1");
    }).toThrow(/differs from the freeze in model_id/);
    expect(() => {
      assertEpisodeMatchesFrozenLock(lock, fields, "episode-1");
    }).not.toThrow();
  });

  // The analytic path below is the cross-check, not the registered gate. SSOT
  // 9.3 registers the binary simulation; this closed-form version adds the
  // between-candidate term the simulation only models when asked, and it is
  // kept because it is the more pessimistic of the two and disagreement between
  // them is worth seeing.
  it("holds rather than lowering the important effect the envelope cannot reach", () => {
    const reserve = [7, 14, 19, 10];
    const base = { candidates_per_repository: reserve, baseline_rate: 0.5, alpha_two_sided: 0.05, power_target: 0.9 };
    expect(TAU_SQUARED_BOUND).toBe(0.06);
    // The registered envelope of 15 repeats reaches 15 points; 8 does not.
    expect(() => {
      assertEnvelopeDetectsImportantEffect({ ...base, repeats_per_arm: 15, minimum_important_effect: 0.15 });
    }).not.toThrow();
    expect(() => {
      assertEnvelopeDetectsImportantEffect({ ...base, repeats_per_arm: 8, minimum_important_effect: 0.15 });
    }).toThrow(/Do not\s+lower the important effect/);
    expect(repeatsRequiredForImportantEffect({ ...base, minimum_important_effect: 0.15 })).toBe(15);
    // Ten points is unreachable at any repeat count: heterogeneity does not
    // shrink with repeats, and the corpus is fixed at 62 candidates.
    expect(repeatsRequiredForImportantEffect({ ...base, minimum_important_effect: 0.1 })).toBe(null);
    expect(
      minimumDetectableEffect({ ...base, repeats_per_arm: 15, tau_squared: TAU_SQUARED_BOUND }),
    ).toBeLessThanOrEqual(0.15);
  });

  it("registers the SSOT envelope, its gate result and its sensitivity", () => {
    const rule = readJson(join(R1, "power-and-resource-rule.json"));
    const fields = rule.fields as Record<string, unknown>;
    expect(fields.minimum_practically_important_dsfps_effect).toBe(0.2);
    expect(fields.maximum_resource_budget_episodes).toBe(400);
    // Repeats are a table, not a number: the buildable count decides them.
    expect(fields.repeats_rule).toMatchObject({
      "M>=40 and m>=5": 4,
      "30<=M<40 and m>=5": 5,
      "24<=M<30 and m>=5": 6,
      otherwise: "HOLD",
    });
    expect(fields.repeats_per_arm).toBeUndefined();
    // The pilot supplies nothing at all.
    expect(rule.permitted_pilot_inputs).toEqual([]);
    // The gate result and the sensitivity are both registered before any episode.
    expect((rule.section_9_3_gate as Record<string, unknown>).verdict).toMatch(/^PASS\./);
    expect(JSON.stringify(rule)).toMatch(/registered_sensitivity_to_candidate_heterogeneity/);
    expect(JSON.stringify(rule)).toMatch(/fragile to one it does not test/);
  });

  it("runs the section 9.3 gate and the repeat rule as committed", () => {
    // SSOT 9.2 exactly, including both HOLD directions.
    expect(confirmatoryRepeatRule(40, 5)).toBe(4);
    expect(confirmatoryRepeatRule(30, 5)).toBe(5);
    expect(confirmatoryRepeatRule(24, 5)).toBe(6);
    expect(confirmatoryRepeatRule(23, 5)).toBe("HOLD");
    expect(confirmatoryRepeatRule(40, 4)).toBe("HOLD");
    // SSOT 9.3: every branch reaches the registered power at the registered effect.
    for (const [total, repeats] of [[40, 4], [30, 5], [24, 6]] as const) {
      const per = [Math.floor(total / 4), Math.floor(total / 4), Math.floor(total / 4), total - 3 * Math.floor(total / 4)];
      const power = simulatePower({
        candidates_per_repository: per,
        repeats_per_arm: repeats,
        baseline_rate: 0.4,
        true_effect: 0.2,
        replicates: 3000,
        seed: "cdeb-v5-ssot-9.3",
      });
      expect(power, `M=${String(total)} repeats=${String(repeats)}`).toBeGreaterThanOrEqual(0.9);
    }
    // And it degrades with heterogeneity, which is the registered sensitivity.
    const heterogeneous = simulatePower({
      candidates_per_repository: [6, 6, 6, 6],
      repeats_per_arm: 6,
      baseline_rate: 0.4,
      true_effect: 0.2,
      tau_squared: 0.06,
      replicates: 3000,
      seed: "cdeb-v5-ssot-9.3",
    });
    expect(heterogeneous).toBeLessThan(0.9);
  });

  it("holds the committed artifacts to one envelope, and catches one that drifts", () => {
    expect(() => {
      assertEnvelopeArtifactsAgree(V5);
    }).not.toThrow();

    // Asserting only that the current artifacts agree proves nothing about the
    // check -- the mutation ratchet reported this guard inert for exactly that
    // reason. So drift one document in a copy and require the throw.
    const scratch = mkdtempSync(join(tmpdir(), "cdeb-envelope-"));
    try {
      cpSync(V5, scratch, { recursive: true });
      const prereg = join(scratch, "stage1-r1", "STAGE1-PREREGISTRATION-r1.md");
      writeFileSync(
        prereg,
        `${readFileSync(prereg, "utf8")}\n\nThe confirmatory study runs 9 repeats per arm.\n`,
        "utf8",
      );
      expect(() => {
        assertEnvelopeArtifactsAgree(scratch);
      }).toThrow(/states 9 repeats, which is not a branch of the registered rule/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("refuses a task whose maintenance need came from someone who read the record", () => {
    const manifest: TaskAuthorManifest = {
      schema_version: 1,
      study_id: "cdeb-fresh-v5",
      stage: "stage1-r1",
      candidate_id: "v4-0",
      repository_id: "gitseed",
      phase: "record-blind-task",
      sequence: 1,
      inputs: { base_tree_oid: "a".repeat(40), maintenance_need: "b".repeat(64) },
      task_digest: "d".repeat(64),
      acceptance_digest: "e".repeat(64),
      frozen_at: new Date(0).toISOString(),
    };
    expect(() => {
      assertTaskAuthorInputsAllowed(manifest);
    }).toThrow(/without naming who produced it/);
    expect(() => {
      assertTaskAuthorInputsAllowed({
        ...manifest,
        input_producers: { maintenance_need: { producer_id: "study-operator", record_blind: false } },
      });
    }).toThrow(/is not\s+declared record-blind/);
    expect(() => {
      assertTaskAuthorInputsAllowed({
        ...manifest,
        input_producers: { maintenance_need: { producer_id: "blind-author-1", record_blind: true } },
      });
    }).not.toThrow();
  });

  it("has one analysis entry point that refuses to run and names every blocker", () => {
    const preconditions = analysisPreconditions(V5);
    expect(preconditions.ready).toBe(false);
    const joined = preconditions.blockers.join("\n");
    expect(joined).toMatch(/62 of 62 candidates have no frozen disposition/);
    expect(joined).toMatch(/17 field\(s\) are unset/);
    expect(joined).toMatch(/no seed is committed/);
    expect(joined).toMatch(/no schedule hash is committed/);
    expect(joined).toMatch(/episodes\.jsonl does not exist/);
    expect(preconditions.blockers.length).toBe(6);
  });
});

describe("the record-blind sandbox", () => {
  /**
   * The sealed corpus bundles are gitignored on purpose -- they mirror private
   * repositories and must not be published -- so this builds its own, with a
   * record in the commit message AND in refs/notes/commitlore. That is the
   * stronger test: it proves the sandbox strips a history whose contents are
   * known, rather than one nobody looked inside.
   */
  const buildBundleWithARecord = (): { dir: string; bundle: string; sha256: string; commit: string } => {
    const dir = mkdtempSync(join(tmpdir(), "cdeb-src-"));
    const run = (args: string[], cwd = dir): string =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    run(["init", "--quiet", "-b", "main"]);
    run(["config", "user.email", "study@example.invalid"]);
    run(["config", "user.name", "study"]);
    writeFileSync(join(dir, "app.ts"), "export const value = 1;\n", "utf8");
    run(["add", "app.ts"]);
    run([
      "commit",
      "--quiet",
      "-m",
      "widen the floor\n\nRecord-Id: r-secretdecision\nProvenance: authored\nRuled-out: caching the value globally | it outlives the request",
    ]);
    const commit = run(["rev-parse", "HEAD"]).trim();
    run(["notes", "--ref", "commitlore", "add", "-m", "Record-Id: r-secretdecision\nRuled-out: caching the value globally | it outlives the request", commit]);
    run(["update-ref", "refs/heads/cdeb-snapshot", commit]);
    const bundle = join(dir, "sealed.bundle");
    run(["bundle", "create", bundle, "refs/heads/cdeb-snapshot", "refs/notes/commitlore"]);
    return { dir, bundle, sha256: createHash("sha256").update(readFileSync(bundle)).digest("hex"), commit };
  };

  it("destroys a history that provably contained the record", () => {
    const source = buildBundleWithARecord();
    try {
      const sandbox = materializeRecordBlindTree({
        bundlePath: source.bundle,
        bundleSha256: source.sha256,
        snapshotCommit: source.commit,
        repositoryId: "synthetic",
      });
      try {
        // The bundle carried the ruling twice over: in the commit message and
        // in refs/notes/commitlore. Neither survives into the author's tree.
        expect(existsSync(join(sandbox.dir, ".git"))).toBe(false);
        expect(readFileSync(join(sandbox.dir, "app.ts"), "utf8")).toContain("export const value");
        expect(sandbox.file_count).toBe(1);
        expect(sandbox.leaks).toEqual([]);
        expect(() => {
          assertSandboxIsRecordBlind(sandbox);
        }).not.toThrow();
        // And the ruling really is unreachable, not merely un-checked-out.
        expect(() =>
          execFileSync("git", ["log", "-1"], { cwd: sandbox.dir, stdio: ["ignore", "pipe", "pipe"] }),
        ).toThrow();
      } finally {
        rmSync(sandbox.dir, { recursive: true, force: true });
      }
    } finally {
      rmSync(source.dir, { recursive: true, force: true });
    }
  });

  it("refuses a bundle whose bytes do not match the freeze", () => {
    const source = buildBundleWithARecord();
    try {
      expect(() =>
        materializeRecordBlindTree({
          bundlePath: source.bundle,
          bundleSha256: "f".repeat(64),
          snapshotCommit: source.commit,
          repositoryId: "synthetic",
        }),
      ).toThrow(/not the frozen/);
    } finally {
      rmSync(source.dir, { recursive: true, force: true });
    }
  });

  it("refuses a tree whose own files quote a record", () => {
    // Two repositories in the real corpus do; the check has to fire on content,
    // because removing the history cannot reach it.
    const leaked = {
      dir: mkdtempSync(join(tmpdir(), "cdeb-leak-")),
      repository_id: "gitseed",
      snapshot_commit: "0".repeat(40),
      tree_digest: "0".repeat(64),
      file_count: 1,
      leaks: [{ path: "docs/adr/ADR-0008.md", marker: "Record-Id", line: "Record-Id: r-gsf501" }],
    };
    try {
      expect(() => {
        assertSandboxIsRecordBlind(leaked);
      }).toThrow(/quotes 1 record line/);
    } finally {
      rmSync(leaked.dir, { recursive: true, force: true });
    }
  });

  it("finds the record markers in content and ignores prose that merely mentions them", () => {
    const dir = mkdtempSync(join(tmpdir(), "cdeb-scan-"));
    try {
      writeFileSync(join(dir, "leaks.md"), "intro\nRecord-Id: r-abc123\nmore\n", "utf8");
      writeFileSync(join(dir, "clean.md"), "We discuss provenance and record ids in general terms.\n", "utf8");
      writeFileSync(join(dir, "binary.png"), "Record-Id: r-abc123", "utf8");
      const found = scanForRecordLeaks(dir, ["leaks.md", "clean.md", "binary.png"]);
      expect(found.map((leak) => leak.path)).toEqual(["leaks.md"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records what the screen measured, with its null control", () => {
    const screen = readFileSync(join(R1, "firewall-leak-screen.md"), "utf8");
    // The null is the load-bearing part: without it a shared 5-gram is just English.
    expect(screen).toMatch(/against another repository\s+0\s+0\s+0/);
    expect(screen).toContain("34             0");
    expect(screen).toContain("no reviewer read the current code or ran a test");
    expect(screen).toContain("What this does not establish");
  });
});

describe("the record-blind task-author chain", () => {
  const answer = (): { candidate_id: string; needs: { need_id: string; summary: string; tree_evidence: string[]; rationale: string }[] } => ({
    candidate_id: "v4-0000000000000000",
    needs: [
      { need_id: "a", summary: "The loader assumes every entry is a readable file.", tree_evidence: ["src/load.ts"], rationale: "r" },
      { need_id: "b", summary: "The case table covers six of the eight declared reports.", tree_evidence: ["spec.json"], rationale: "r" },
    ],
  });
  const request = { candidate_id: "v4-0000000000000000", repository_id: "gitseed", sandbox_dir: "/tmp/x", tree_digest: "0".repeat(64), path_scope: ["src/load.ts"], prompt: "" };

  it("asks for maintenance work without mentioning that a decision exists", () => {
    const prompt = needScoutPrompt(["src/load.ts", "spec.json"]);
    expect(prompt).toContain("src/load.ts");
    // A scout told "there is a ruling here you must not see" writes around the
    // shape of the thing it was told about.
    for (const word of ["decision", "record", "ruled out", "Record-Id", "CommitLore"]) {
      expect(prompt.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it("refuses a need with no tree evidence, and a wrong count", () => {
    expect(MIN_NEEDS).toBe(2);
    expect(() => {
      assertNeedScoutAnswer(request, answer());
    }).not.toThrow();
    const noEvidence = answer();
    noEvidence.needs[0]!.tree_evidence = [];
    expect(() => {
      assertNeedScoutAnswer(request, noEvidence);
    }).toThrow(/cites no file/);
    expect(() => {
      assertNeedScoutAnswer(request, { ...answer(), needs: answer().needs.slice(0, 1) });
    }).toThrow(/produced 1 needs/);
  });

  it("selects a need from the seed alone, and the seed moves the choice", () => {
    const chosen = selectNeed("seed-one", answer());
    expect(selectNeed("seed-one", answer()).need_id).toBe(chosen.need_id);
    const seeds = ["s1", "s2", "s3", "s4", "s5", "s6"].map((seed) => selectNeed(seed, answer()).need_id);
    // Deterministic per seed, but not constant across seeds -- otherwise the
    // "external seed" is decoration and the first need always wins.
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it("records a first run in which the scout saw no record and repeated none", () => {
    const evidence = JSON.parse(
      readFileSync(join(R1, "evidence", "need-scout-first-run.json"), "utf8"),
    ) as Record<string, unknown>;
    const sandbox = evidence.sandbox as Record<string, unknown>;
    const validation = evidence.validation as Record<string, unknown>;
    expect(sandbox.git_metadata_present).toBe(false);
    expect(validation.record_leakage_shared_4grams).toBe(0);
    expect(validation.cited_files_missing).toBe(0);
    expect((evidence.needs as unknown[]).length).toBe(3);
  });
});

describe("§19.15 the implementation executes no episode", () => {
  it("declares the state plainly and leaves the randomization schedule uncomputable", () => {
    const randomization = readJson(join(R1, "randomization-plan.json"));
    expect(randomization.schedule_sha256).toBe(null);
    expect((randomization.seed as { value: unknown }).value).toBe(null);
    expect(randomization.status).toBe("PLAN-FROZEN-SCHEDULE-NOT-COMPUTABLE");
    const r1 = readFileSync(join(R1, "STAGE1-PREREGISTRATION-r1.md"), "utf8");
    expect(r1).toContain("measured product-effect rows = 0");
    expect(r1).toContain("buildability dispositions    = 0 of 62");
    expect(r1).toMatch(/separate\s+explicit owner approval/);
  });

  it("maps every §19 criterion in the validation report", () => {
    const report = readFileSync(join(R1, "validation-report.md"), "utf8");
    for (let criterion = 1; criterion <= 15; criterion += 1) {
      expect(report).toContain(`| ${String(criterion)} |`);
    }
    expect(report).toContain("HOLD");
  });
});
