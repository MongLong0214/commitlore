/**
 * CDEB-Fresh v8: the guards for everything frozen before the first episode runs.
 *
 * SSOT §32 lists twenty-nine mandatory tests. Roughly half of them govern rows,
 * judgements and analysis outputs that do not exist yet — v8 is frozen at
 * SCHEDULE_FROZEN with `measured_run_allowed: false`. Asserting those would be
 * writing tests that pass because nothing exists, so they are not here; the ones
 * about the freeze are.
 *
 * Every assertion reads the committed artifacts, so an edit that breaks the
 * study's own record fails here rather than at analysis time. Two of them go
 * further and recompute what an artifact claims: the schedule seed is derived
 * again from the four frozen files, and the analysis harness is bound to the
 * simulation results by digest — so editing `analysis.py` without rerunning the
 * controls fails, which is the failure mode a recorded "12/12 caught" cannot
 * catch on its own.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const V7 = resolve(HERE, "..", "bench", "cdeb", "studies", "cdeb-fresh-v7");
const V8 = resolve(HERE, "..", "bench", "cdeb", "studies", "cdeb-fresh-v8");

const readJson = <T = Record<string, unknown>>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);

const sha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

interface Candidate {
  candidate_id: string;
  repository_id: string;
  v7_boundary_status: string | null;
}

interface Episode {
  episode_index: number;
  pair_position: number;
  slot_in_pair: number;
  candidate_id: string;
  repetition: number;
  arm: string;
  repository_id: string;
}

const population = readJson<{
  counts: Record<string, number>;
  candidates: Candidate[];
  import_valid: boolean;
  drift: unknown[];
  boundary_counts_match_v7_result: boolean;
  good_control_bytes_exist: boolean;
}>(resolve(V8, "task-population.json"));

const schedule = readJson<{
  seed: string;
  seed_inputs: Record<string, string>;
  counts: Record<string, number>;
  concurrency: Record<string, unknown>;
  pairs: { candidate_id: string; repetition: number; first_arm: string }[];
  episodes: Episode[];
}>(resolve(V8, "schedule.json"));

const expectedRows = readJson<{
  expected_row_count: number;
  expected_judgements: number;
  rows: { candidate_id: string; repetition: number; arm: string }[];
}>(resolve(V8, "expected-rows.json"));

const status = readJson<Record<string, unknown>>(resolve(V8, "STATUS.json"));

describe("v8 inherits a terminal v7 and no product rows", () => {
  it("v7 is terminal with zero product effect rows", () => {
    const v7 = readJson<Record<string, unknown>>(resolve(V7, "STATUS.json"));
    expect(v7.state_machine_position).toBe("TERMINAL_HOLD_FINAL");
    expect(v7.verdict).toBe("TERMINAL_HOLD_FINAL");
    expect(v7.product_effect_rows).toBe(0);
    expect(v7.measured_run_allowed).toBe(false);
  });

  it("every measured row is one the frozen schedule asked for", () => {
    // This used to assert that no row existed at all, which was the right guard
    // until the run started and the wrong one afterwards. What must hold now is
    // that the rows on disk are a subset of the 340 the schedule fixed, that no
    // assignment appears twice, and that STATUS agrees with what is there.
    expect(status.no_automatic_v9).toBe(true);

    const rowsDir = resolve(V8, "rows");
    const rows: { candidate_id: string; repetition: number; arm: string }[] = [];
    if (existsSync(rowsDir)) {
      for (const entry of readdirSync(rowsDir)) {
        const path = resolve(rowsDir, entry, "row.json");
        if (existsSync(path)) rows.push(readJson(path));
      }
    }

    expect(rows.length).toBeLessThanOrEqual(340);
    expect(status.product_effect_rows).toBe(rows.length);

    const scheduled = new Set(
      expectedRows.rows.map((r) => `${r.candidate_id}|${r.repetition}|${r.arm}`),
    );
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.candidate_id}|${row.repetition}|${row.arm}`;
      expect(scheduled.has(key), key).toBe(true);
      expect(seen.has(key), `${key} appears twice`).toBe(false);
      seen.add(key);
    }
  });

  it("the measured run is only open when someone opened it", () => {
    // The gate is a decision, not a default. It may be true while a run is in
    // flight; what must never happen is finding it true with nothing recording why.
    if (status.measured_run_allowed === true) {
      expect(typeof status.measured_run_scope).toBe("string");
      expect(status.measured_run_scope.length).toBeGreaterThan(0);
    }
  });
});

describe("the seventeen are frozen with their boundary status", () => {
  it("is exactly 17 candidates split 8 and 9", () => {
    expect(population.counts.total).toBe(17);
    expect(population.counts["agent-operator-score"]).toBe(8);
    expect(population.counts.gitseed).toBe(9);
    expect(population.candidates).toHaveLength(17);
    expect(new Set(population.candidates.map((c) => c.candidate_id)).size).toBe(17);
  });

  it("imported with no drift, every referenced artifact rehashed", () => {
    expect(population.drift).toEqual([]);
    expect(population.import_valid).toBe(true);
  });

  it("says which verified bytes a clone will not have", () => {
    // `drift: []` above is a claim about the machine that wrote it. A hostile
    // review found that two snapshot bundles it certifies are gitignored, so a
    // clone cannot repeat the check and cannot instantiate a base tree. That is
    // a deliberate repository policy, and the defect was stating the
    // verification without stating its reach. Assert the distinction is carried
    // structurally, not that everything happens to be present here.
    const lock = readJson<{
      repositories: { tracked_in_git: boolean; present_on_this_machine: boolean; matches: boolean }[];
      bundles_untracked: number;
      what_the_digest_does_and_does_not_give: string;
      what_a_clone_can_still_check: string;
    }>(resolve(V8, "snapshot-lock.json"));

    expect(lock.repositories).toHaveLength(2);
    for (const repository of lock.repositories) {
      expect(typeof repository.tracked_in_git).toBe("boolean");
      expect(repository.matches).toBe(true);
    }
    const untracked = lock.repositories.filter((r) => !r.tracked_in_git).length;
    expect(lock.bundles_untracked).toBe(untracked);
    if (untracked > 0) {
      expect(lock.what_the_digest_does_and_does_not_give).toMatch(
        /integrity, not availability/i,
      );
      expect(lock.what_a_clone_can_still_check).toMatch(/snapshot commit/i);
    }
  });

  it("pins the product the episodes actually invoke", () => {
    // Not dist/commitlore.mjs: the tree has moved past v1.2.0, so comparing the
    // pin against the checked-out build reports a mismatch that says nothing
    // about what ran.
    const lock = readJson<{
      dist_sha256_pinned: string;
      product_under_test: { matches_pin: boolean; outside_the_repository?: boolean };
    }>(resolve(V8, "product-lock.json"));
    expect(lock.dist_sha256_pinned).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.product_under_test.matches_pin).toBe(true);
  });

  it("is 8 settled and 9 unresolved, matching what v7 published", () => {
    expect(population.counts.boundary_settled).toBe(8);
    expect(population.counts.boundary_unresolved).toBe(9);
    expect(population.boundary_counts_match_v7_result).toBe(true);
    for (const candidate of population.candidates) {
      expect(["BOUNDARY_SETTLED", "BOUNDARY_UNRESOLVED"]).toContain(
        candidate.v7_boundary_status,
      );
    }
  });

  it("keeps every unresolved task in the measured population", () => {
    // v7 made unresolved ambiguity terminal. v8 does not: BOUNDARY_UNRESOLVED is
    // descriptive, so a study that quietly dropped those nine would be measuring
    // an easier benchmark than the one it registered.
    const unresolved = population.candidates.filter(
      (c) => c.v7_boundary_status === "BOUNDARY_UNRESOLVED",
    );
    expect(unresolved).toHaveLength(9);
    const scheduled = new Set(schedule.episodes.map((e) => e.candidate_id));
    for (const candidate of unresolved) {
      expect(scheduled.has(candidate.candidate_id)).toBe(true);
    }
  });

  it("records that no Good A/B control bytes survive", () => {
    // The digests in the manifest are of v6's prose accounts. Reading them as
    // patch hashes would make the controls look reproducible when they are not.
    expect(population.good_control_bytes_exist).toBe(false);
  });
});

describe("the 340-episode schedule", () => {
  it("is 340 episodes across 170 pairs, all unique", () => {
    expect(schedule.episodes).toHaveLength(340);
    expect(schedule.pairs).toHaveLength(170);
    const assignments = new Set(
      schedule.episodes.map((e) => `${e.candidate_id}|${e.repetition}|${e.arm}`),
    );
    expect(assignments.size).toBe(340);
  });

  it("gives every candidate ten repeats per arm", () => {
    const counts = new Map<string, { ON: number; SUPPRESSED: number }>();
    for (const episode of schedule.episodes) {
      const entry = counts.get(episode.candidate_id) ?? { ON: 0, SUPPRESSED: 0 };
      entry[episode.arm as "ON" | "SUPPRESSED"] += 1;
      counts.set(episode.candidate_id, entry);
    }
    expect(counts.size).toBe(17);
    for (const [, entry] of counts) {
      expect(entry).toEqual({ ON: 10, SUPPRESSED: 10 });
    }
  });

  it("runs the two episodes of a pair adjacent", () => {
    for (let index = 0; index < schedule.episodes.length; index += 2) {
      const first = schedule.episodes[index]!;
      const second = schedule.episodes[index + 1]!;
      expect(second.candidate_id).toBe(first.candidate_id);
      expect(second.repetition).toBe(first.repetition);
      expect(first.slot_in_pair).toBe(0);
      expect(second.slot_in_pair).toBe(1);
      expect(new Set([first.arm, second.arm])).toEqual(
        new Set(["ON", "SUPPRESSED"]),
      );
    }
  });

  it("does not let a repetition index carry a fixed arm order", () => {
    const byRepetition = new Map<number, Set<string>>();
    for (const pair of schedule.pairs) {
      const seen = byRepetition.get(pair.repetition) ?? new Set<string>();
      seen.add(pair.first_arm);
      byRepetition.set(pair.repetition, seen);
    }
    for (const [, seen] of byRepetition) expect(seen.size).toBe(2);
  });

  it("derives its seed from the four frozen artifacts", () => {
    // Recomputed, not compared to itself: a schedule built from anything else
    // fails here even though it would look internally consistent.
    const recomputed = createHash("sha256")
      .update(
        [
          "CDEB-FRESH-V8",
          sha256(resolve(V8, "task-population.json")),
          sha256(resolve(V8, "calibration", "panel-freeze.json")),
          sha256(resolve(V8, "runtime-lock.json")),
          schedule.seed_inputs.preregistration_commit_sha,
        ].join(""),
      )
      .digest("hex");
    expect(recomputed).toBe(schedule.seed);
  });

  it("has a packet-id commitment built from this schedule", () => {
    // The mapping covers exactly the scheduled episodes, so a re-freeze makes it
    // stale — and a commitment to a stale mapping attests that the assignment was
    // fixed for a run nobody is making. The mapping itself stays out of the
    // repository until section 21.4's seal; only this digest is published.
    const commitment = readJson<{
      mapping_sha256: string;
      packets: number;
      built_from_schedule_sha256: string;
      built_from_schedule_seed: string;
      scheme: string;
    }>(resolve(V8, "packet-id-commitment.json"));

    expect(commitment.packets).toBe(340);
    expect(commitment.built_from_schedule_sha256).toBe(sha256(resolve(V8, "schedule.json")));
    expect(commitment.built_from_schedule_seed).toBe(schedule.seed);
    expect(commitment.scheme).toMatch(/HMAC/);
    expect(commitment.mapping_sha256).toMatch(/^[0-9a-f]{64}$/);
    // The mapping must not be in the tree while judging is open.
    expect(existsSync(resolve(V8, "packet-mapping.json"))).toBe(false);
  });

  it("holds the concurrency limits the protocol fixed", () => {
    expect(schedule.concurrency).toMatchObject({
      max_active_coding_episodes: 2,
      max_active_per_repository: 1,
      same_pair_concurrent: false,
    });
  });

  it("expects 340 rows and 1,020 judgements, matching the schedule exactly", () => {
    expect(expectedRows.expected_row_count).toBe(340);
    expect(expectedRows.expected_judgements).toBe(1020);
    expect(expectedRows.rows.map((r) => `${r.candidate_id}|${r.repetition}|${r.arm}`)).toEqual(
      schedule.episodes.map((e) => `${e.candidate_id}|${e.repetition}|${e.arm}`),
    );
  });
});

describe("the judge panel", () => {
  const panel = readJson<{
    panel: { seat: string; model: string; family: string }[];
    frozen: {
      aggregation: string;
      no_fourth_judge_on_disagreement: boolean;
      judge_prompt_sha256: string;
      judge_schema_sha256: string;
    };
  }>(resolve(V8, "calibration", "panel-freeze.json"));

  it("freezes the prompt, the schema and the aggregation rule", () => {
    // `frozen` is what was frozen, not a flag saying it was.
    expect(panel.frozen.no_fourth_judge_on_disagreement).toBe(true);
    expect(panel.frozen.aggregation).toMatch(/majority/i);
    expect(panel.frozen.judge_prompt_sha256).toBe(
      sha256(resolve(V8, "harness", "judge-prompt.txt")),
    );
    expect(panel.frozen.judge_schema_sha256).toBe(
      sha256(resolve(V8, "harness", "judge-schema.json")),
    );
  });

  it("is three fixed seats", () => {
    expect(panel.panel).toHaveLength(3);
    expect(new Set(panel.panel.map((seat) => seat.seat)).size).toBe(3);
    expect(new Set(panel.panel.map((seat) => seat.model)).size).toBe(3);
    expect(status.panel).toEqual(panel.panel.map((seat) => seat.model));
  });

  it("spans at least two model families", () => {
    // The gate's "at least 2 judge model families" is the claim this backs. One
    // family holding two seats is recorded in the freeze; zero diversity is not
    // allowed to pass as diversity.
    expect(new Set(panel.panel.map((seat) => seat.family)).size).toBeGreaterThanOrEqual(2);
  });
});

describe("the judge packet leaks neither arm nor assignment", () => {
  const simulation = readJson<{
    arm_cue_present: Record<string, boolean>;
    checks: Record<string, unknown>;
    scanner_negative_control: { every_cue_detectable: boolean; no_benign_text_fires: boolean };
    constructed_cases: {
      differing_trees_pair: {
        trees_actually_differ: boolean;
        same_field_shape: boolean;
        arm_cues_found: number;
      };
      leaked_tree: { arm_cue_present: boolean; cues_found: string[] };
    };
  }>(resolve(V8, "preflight", "judge-packet-simulation.json"));

  it("finds no arm cue in either arm's packet", () => {
    expect(simulation.arm_cue_present).toEqual({ on: false, suppressed: false });
    expect(simulation.checks.packet_ids_share_no_prefix).toBe(true);
  });

  it("proves the scanner can fire before trusting that it did not", () => {
    expect(simulation.scanner_negative_control.every_cue_detectable).toBe(true);
    expect(simulation.scanner_negative_control.no_benign_text_fires).toBe(true);
  });

  it("keeps the packet shape identical across genuinely different trees", () => {
    const pair = simulation.constructed_cases.differing_trees_pair;
    expect(pair.trees_actually_differ).toBe(true);
    expect(pair.same_field_shape).toBe(true);
    expect(pair.arm_cues_found).toBe(0);
  });

  it("flags a tree that carries the assignment or the delivery log", () => {
    const leak = simulation.constructed_cases.leaked_tree;
    expect(leak.arm_cue_present).toBe(true);
    expect(leak.cues_found).toContain("experiment-assignment");
    expect(leak.cues_found).toContain("delivery-log");
  });
});

describe("the analysis was proven before any episode existed", () => {
  const scenarios = readJson<
    Record<string, { expectation_met: boolean; strong_claim_allowed: boolean }>
  >(resolve(V8, "analysis-simulation", "scenarios.json"));

  it("recovers every registered scenario", () => {
    expect(Object.keys(scenarios)).toHaveLength(6);
    for (const [, result] of Object.entries(scenarios)) {
      expect(result.expectation_met).toBe(true);
    }
  });

  it("blocks every scenario that was not generated with a positive effect", () => {
    // This used to assert that no scenario reached the claim, which was true only
    // by accident: RBDR was implemented before it was defined, and the invented
    // formula happened to fall below the 50% threshold. With the registered
    // pair-based definition, a scenario generated with a large positive effect and
    // every non-statistical condition held at passing does reach the claim -- which
    // is the gate working. What must never pass is a scenario with no effect or a
    // harmful one.
    const mustBeBlocked = [
      "exact_null",
      "known_negative",
      "completion_degraded",
      "high_indeterminate",
      "suppressed_fvr_zero",
    ];
    for (const name of mustBeBlocked) {
      expect(scenarios[name], name).toBeDefined();
      expect(scenarios[name]!.strong_claim_allowed, name).toBe(false);
    }
  });

  it("caught every injected defect", () => {
    const mutations = readFileSync(
      resolve(V8, "analysis-simulation", "mutation-controls.txt"),
      "utf8",
    );
    expect(mutations).toContain("baseline unmutated: all controls pass");
    expect(mutations).toMatch(/\n(\d+)\/\1 mutations caught/);
    expect(mutations).not.toContain("SURVIVED");
  });

  it("binds those results to the analysis code that produced them", () => {
    // Without this, editing analysis.py leaves a committed "12/12 caught" that
    // describes code no longer in the tree.
    const pinned = readJson<{ analysis_sha256: string }>(
      resolve(V8, "analysis-simulation", "code-pin.json"),
    );
    expect(pinned.analysis_sha256).toBe(sha256(resolve(V8, "harness", "analysis.py")));
  });
});

describe("the transition log records how the freeze was reached", () => {
  const transitions = readJsonl<{ transition: string; checks?: string[] }>(
    resolve(V8, "transitions.jsonl"),
  );

  it("records every freeze the schedule depends on", () => {
    // Deliberately not "the last transition is X". The log grows as preflights
    // land, and an assertion on its tail fails the next time one is appended
    // while saying nothing about whether the study is sound. What is durable is
    // that each freeze happened and that the population freeze precedes the
    // schedule that hashes it into its seed.
    const names = transitions.map((t) => t.transition);
    for (const required of [
      "V8_DRAFT",
      "PANEL_FROZEN",
      "RUNTIME_LOCKED",
      "TASK_POPULATION_IMPORTED",
      "SCHEDULE_FROZEN",
      "JUDGE_PACKET_SIMULATED",
    ]) {
      expect(names).toContain(required);
    }
    expect(names.indexOf("TASK_POPULATION_IMPORTED")).toBeLessThan(
      names.indexOf("SCHEDULE_FROZEN"),
    );
  });

  it("cross-references every deviation by id, in both directions", () => {
    // Two transitions had put the deviation's prose into the field meant for its
    // id, and one deviation was reachable from nothing. Either way the log stops
    // being an index of itself, which is the only thing it is for.
    const deviations = readJsonl<{ deviation_id: string }>(
      resolve(V8, "deviations.jsonl"),
    );
    const ids = new Set(deviations.map((d) => d.deviation_id));
    const referenced = new Set(
      transitions.flatMap((t) => (t as { deviations?: string[] }).deviations ?? []),
    );

    expect(ids.size).toBe(deviations.length);
    for (const id of ids) expect(id).toMatch(/^v8-d\d{3}$/);
    for (const reference of referenced) {
      expect(reference).toMatch(/^v8-d\d{3}$/);
      expect(ids.has(reference)).toBe(true);
    }
    for (const id of ids) expect(referenced.has(id)).toBe(true);
  });

  it("does not claim a seal or a publication before there is one", () => {
    // CONFIRMATORY_RUNNING is legitimate once the owner opens the gate. What must
    // not appear ahead of the rows is a claim that they are sealed or published.
    const names = transitions.map((t) => t.transition);
    const rowsDir = resolve(V8, "rows");
    const rowCount = existsSync(rowsDir)
      ? readdirSync(rowsDir).filter((e) => existsSync(resolve(rowsDir, e, "row.json"))).length
      : 0;
    if (rowCount < 340) {
      for (const name of names) {
        expect(name).not.toMatch(/ROWS_SEALED|PUBLISHED/);
      }
    }
  });
});
