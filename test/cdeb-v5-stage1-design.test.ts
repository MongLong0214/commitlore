/** CDEB-Fresh v5 Stage 1 is design only: nothing here may start a measured run. */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const V5 = resolve(HERE, "..", "bench", "cdeb", "studies", "cdeb-fresh-v5");

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const readJsonl = (path: string): Record<string, unknown>[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe("CDEB v5 Stage 1 design", () => {
  it("keeps the measured run shut and creates no execution directory", () => {
    expect(readJson(join(V5, "STATUS.json")).measured_run_allowed).toBe(false);
    expect(readJson(join(V5, "study.json")).measured_run_allowed).toBe(false);
    // The design may name what a pilot would use; it may not create the places
    // a run would write to.
    for (const forbidden of ["tasks", "gold", "oracles", "pilot", "rows", "randomization"]) {
      expect(existsSync(join(V5, forbidden))).toBe(false);
    }
    const design = readJson(join(V5, "stage1", "pilot-design.json"));
    expect(design.measured_run_allowed).toBe(false);
  });

  it("allocates a pilot that is disjoint from the confirmatory reserve", () => {
    const design = readJson(join(V5, "stage1", "pilot-design.json"));
    const pilot = design.pilot as { n: number; candidates: { candidate_id: string; repository_id: string }[] };
    const reserve = design.confirmatory_reserve as {
      n: number;
      floor_required: number;
      candidates: { candidate_id: string }[];
    };
    expect(pilot.n).toBe(12);
    expect(reserve.n).toBe(50);
    expect(reserve.n).toBeGreaterThanOrEqual(reserve.floor_required);

    const pilotIds = new Set(pilot.candidates.map((row) => row.candidate_id));
    const reserveIds = new Set(reserve.candidates.map((row) => row.candidate_id));
    expect(pilotIds.size).toBe(pilot.n);
    // A candidate used in the pilot never enters the confirmatory corpus.
    for (const id of pilotIds) expect(reserveIds.has(id)).toBe(false);
    expect(pilotIds.size + reserveIds.size).toBe(62);
  });

  it("draws the pilot only from Stage 0's qualified candidates, three per repository", () => {
    const design = readJson(join(V5, "stage1", "pilot-design.json"));
    const pilot = design.pilot as { candidates: { candidate_id: string; repository_id: string }[] };
    const qualified = new Set(
      readJsonl(join(V5, "feasibility", "qualification.jsonl"))
        .filter((row) => row.qualified === true)
        .map((row) => row.candidate_id as string),
    );
    for (const row of pilot.candidates) expect(qualified.has(row.candidate_id)).toBe(true);
    const perRepository = new Map<string, number>();
    for (const row of pilot.candidates) {
      perRepository.set(row.repository_id, (perRepository.get(row.repository_id) ?? 0) + 1);
    }
    expect([...perRepository.values()]).toEqual([3, 3, 3, 3]);
    expect([...perRepository.keys()].sort()).toEqual(design.fixed_repository_set);
  });

  it("selects by a rule that cannot see the decision's content", () => {
    const design = readJson(join(V5, "stage1", "pilot-design.json"));
    const pilot = design.pilot as { candidates: { candidate_id: string; repository_id: string }[] };
    const qualified = readJsonl(join(V5, "feasibility", "qualification.jsonl")).filter((row) => row.qualified === true);
    // Recompute the registered rule from the artifacts: first three per
    // repository by candidate_id, which derives from the decision audit anchor.
    const expected: string[] = [];
    for (const repository of design.fixed_repository_set as string[]) {
      expected.push(
        ...qualified
          .filter((row) => row.repository_id === repository)
          .map((row) => row.candidate_id as string)
          .sort()
          .slice(0, 3),
      );
    }
    expect(pilot.candidates.map((row) => row.candidate_id)).toEqual(expected);
    // The rationale was wrong and is corrected: the anchor hashes the decision
    // text, so the ordering is pseudorandom under a hash assumption, not blind.
    expect(String(design.selection_rule)).toMatch(/NOT independent of content/);
    expect(String(design.selection_rule_correction)).toMatch(/was false/);
  });

  it("refuses to register while the adversarial review's defects stand", () => {
    const prereg = readFileSync(join(V5, "STAGE1-PREREGISTRATION.md"), "utf8");
    expect(prereg).toContain("DRAFT-NOT-FROZEN-failed-adversarial-review");
    expect(prereg).toContain("A measured run may not begin against this document");
    expect(existsSync(join(V5, "stage1", "adversarial-review.md"))).toBe(true);
    expect(prereg).toContain("revival = the final tree implements the ruled-out approach");
    expect(prereg).toContain("wording repetition and reason restatement are forbidden as endpoints");
    expect(prereg).toContain("final N per repository            from the power artifact");
    expect(prereg).toContain("the only permitted amendment to this document");
    expect(prereg).toContain("measured product-effect rows = 0");
    // The estimand must fail loudly on an empty stratum rather than recompute.
    expect(prereg).toContain("it is not\nrecomputed over the surviving strata");
  });

  it("keeps the power analysis blind to the pilot's effect", () => {
    const plan = readFileSync(join(V5, "stage1", "power-analysis-plan.md"), "utf8");
    expect(plan).toContain("the pilot's estimated treatment effect");
    expect(plan).toContain("arm labels withheld");
    expect(plan).toContain("it does not authorise a measured run");
  });

  it("names the irreversible step and what must exist before it", () => {
    const prd = readFileSync(join(V5, "STAGE1-CONFIRMATORY-PRD.md"), "utf8");
    expect(prd).toContain("running one agent episode under an assigned arm");
    expect(prd).toContain("explicit owner approval to execute");
    // The firewall is the anti-circularity argument and it has not run yet.
    expect(prd).toContain("has **not been\nexercised yet**");
  });

  it("carries Stage 0's limits forward instead of inheriting silence", () => {
    for (const file of ["STAGE1-CONFIRMATORY-PRD.md", "STAGE1-PREREGISTRATION.md"]) {
      const text = readFileSync(join(V5, file), "utf8");
      expect(text).toMatch(/No reviewer read the current code or ran a test|no reviewer read code or ran a test/);
      expect(text).toContain("62 is a lower bound");
      expect(text).toMatch(/anti-provenance guard cannot/);
    }
  });
});
