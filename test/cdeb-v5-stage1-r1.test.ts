/**
 * CDEB-Fresh v5 Stage 1-r1: the pre-execution design layer.
 *
 * Every test here maps to a FINAL-PRD §19 acceptance criterion, and several of
 * them assert that a guard throws on the artifact as committed. That is not a
 * placeholder: an unfinished census and an unfrozen runtime lock are the true
 * state of the study, and a guard that only fails on a synthetic fixture has
 * never been shown to fail on the thing it guards.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
  candidateEffects,
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
  assertRuntimeLockComplete,
  type RuntimeLock,
} from "../bench/cdeb/freeze/runtime-lock-v5.ts";
import {
  assertFeasibilityCarriesNoEffect,
  assertPowerInputsEffectBlind,
  assertPowerRuleComplete,
  evaluatePilot,
  minimumDetectableEffect,
  normalQuantile,
  type PilotFeasibility,
  type PilotFeasibilityThresholds,
  type PowerAndResourceRule,
} from "../bench/cdeb/freeze/effect-independence-v5.ts";

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
  const control = (overrides: Partial<OracleControl>): OracleControl => ({
    control_id: "c1",
    kind: "compliant-passing",
    patch_digest: "0".repeat(64),
    functional_acceptance_pass: true,
    oracle_revival: false,
    structural_note: "note",
    ...overrides,
  });

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

  it("refuses a sizing input that carries a treatment contrast", () => {
    expect(() => {
      assertPowerInputsEffectBlind({ per_task_completion_rate: 0.8 });
    }).not.toThrow();
    for (const key of ["observed_effect", "arm_difference", "dsfps_delta", "treatment_contrast"]) {
      expect(() => {
        assertPowerInputsEffectBlind({ [key]: 0.1 });
      }).toThrow(/treatment contrast/);
    }
    expect(() => {
      assertPowerInputsEffectBlind({ episodes_attempted: 40 });
    }).toThrow(/not a registered nuisance parameter/);
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
    expect(evaluatePilot(thresholds, met)).toEqual({ verdict: "PASS", failed: [] });
    expect(evaluatePilot(thresholds, { ...met, firewall_manifests_valid: 11 })).toEqual({
      verdict: "HOLD",
      failed: ["firewall_manifests_valid"],
    });
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
      evaluatePilot({ ...thresholds, frozen_before_pilot: false }, met);
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
    const effects = candidateEffects(synthetic());
    const options = { seed: "cdeb-fresh-v5-test-seed", replicates: 2000 };
    const first = stratifiedBootstrap(effects, REPOS, options);
    const second = stratifiedBootstrap(effects, REPOS, options);
    expect(first).toEqual(second);
    expect(first.point).toBeCloseTo(1 / 3, 10);
    expect(first.lower).toBeLessThanOrEqual(first.point);
    expect(first.upper).toBeGreaterThanOrEqual(first.point);
    expect(first.lower).toBeGreaterThan(0);
    expect(first.excludes_zero_in_predicted_direction).toBe(true);
    // A different seed gives a different draw; the point estimate does not move.
    const other = stratifiedBootstrap(effects, REPOS, { ...options, seed: "another-seed" });
    expect(other.point).toBeCloseTo(first.point, 10);
  });

  it("preregisters 20,000 replicates and 95% by default", () => {
    expect(PREREGISTERED_REPLICATES).toBe(20000);
    const plan = readFileSync(join(R1, "analysis-plan.md"), "utf8");
    expect(plan).toContain("20,000");
    expect(plan).toContain("The four repositories are never resampled");
    expect(plan).toMatch(/intention-to-treat/i);
  });

  it("reports non-degradation against the frozen margin", () => {
    const rows = synthetic();
    expect(nonDegradation(rows).holds).toBe(true);
    const broken = rows.map((row) => (row.arm === "on" ? { ...row, completed: false } : row));
    const result = nonDegradation(broken);
    expect(result.completion_difference).toBeCloseTo(-1, 10);
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
    expect(nonDegradation(rows).holds).toBe(false);
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
