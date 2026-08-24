/**
 * CDEB-Fresh v6: the guards for the stages this study actually ran.
 *
 * SSOT §27 lists twenty-one mandatory tests. Eleven of them govern the oracle,
 * the pilot and the analysis, and v6 stopped at the task-buildability gate
 * without reaching any of those. Writing assertions about stages that produced
 * no artifacts would be writing tests that pass because nothing exists, which is
 * the opposite of coverage.
 *
 * What is asserted here is what v6 produced: the source pool, the firewall, the
 * freeze order, the dual acceptance, the semantic judging, and the floor
 * arithmetic that stopped it. Each test reads the committed artifacts rather
 * than a fixture, so a later edit that breaks the study's own record fails here.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TERMINAL_STUDY_PHASES } from "../bench/cdeb/active-study.ts";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const V6 = resolve(HERE, "..", "bench", "cdeb", "studies", "cdeb-fresh-v6");
const V5 = resolve(HERE, "..", "bench", "cdeb", "studies", "cdeb-fresh-v5");

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);

interface PoolCandidate {
  candidate_id: string;
  repository_id: string;
  decision_audit_anchor: string;
  v5_current_adjudication: string;
  ruling: string;
  reason: string;
  path_scope: string[];
}

interface Disposition {
  candidate_id: string;
  repository_id: string;
  disposition: string;
  basis: string;
}

const pool = (): { candidates: PoolCandidate[] } & Record<string, unknown> =>
  readJson(join(V6, "source-pool.json")) as { candidates: PoolCandidate[] } & Record<string, unknown>;

describe("§27 the v5 predecessor cannot be resumed and its excluded rows cannot enter", () => {
  it("keeps v5 terminal with zero measured rows", () => {
    const status = readJson(join(V5, "STATUS.json"));
    expect(status).toMatchObject({ phase: "stage1-hold", verdict: "TERMINAL_HOLD", measured_run_allowed: false });
  });

  it("selects exactly 16 agent-operator-score and 18 gitseed", () => {
    const p = pool();
    const byRepository = p.candidates.reduce<Record<string, number>>((counts, c) => {
      counts[c.repository_id] = (counts[c.repository_id] ?? 0) + 1;
      return counts;
    }, {});
    expect(byRepository).toEqual({ "agent-operator-score": 16, gitseed: 18 });
    expect(p.candidates.length).toBe(34);
    expect(p.counts_match_expected).toBe(true);
  });

  it("admits no ambiguous or nondeterministic-repository candidate", () => {
    // v5 disposed 23 candidates because their repository's acceptance could not
    // give the same answer twice, and 5 more because the judges could not settle
    // what the ruling meant. Either kind entering here would put a decision the
    // predecessor could not classify into the population v6 measures.
    const p = pool();
    for (const c of p.candidates) {
      expect(c.v5_current_adjudication).toBe("FUNCTIONALLY_VIOLABLE");
      expect(["agent-operator-score", "gitseed"]).toContain(c.repository_id);
    }
  });

  it("carries a decision audit anchor for every candidate and no v5 patch bytes", () => {
    const p = pool();
    for (const c of p.candidates) {
      expect(c.decision_audit_anchor).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(p.carries_no_v5_patch_bytes).toBe(true);
    expect(p.carries_no_v5_worker_prose).toBe(true);
    // The pool is the input to v6's control builders, and a diff in it would be
    // a v5 implementation reaching a v6 control by the back door.
    expect(JSON.stringify(p)).not.toMatch(/^\+\+\+ b\//m);
  });
});

describe("§27 the task author was blind and the freeze came before any record-aware work", () => {
  it("hands the author only allow-listed inputs", () => {
    // 33, not 34: the candidate excluded for a tree that revealed its own
    // decision never reached a scout. Asserting 34 here would require having
    // scouted a candidate the firewall had already stopped.
    const scouted = pool().candidates.filter((c) =>
      existsSync(join(V6, "buildability", "needs", `${c.candidate_id}.json`)),
    );
    expect(scouted.length).toBe(33);
    const manifests = scouted.map((c) =>
      readJson(join(V6, "buildability", "needs", `${c.candidate_id}.json`)),
    );
    for (const m of manifests) {
      const text = JSON.stringify(m);
      // The scout's own record of what it opened. A ruling reaching it would
      // show up as the candidate's own wording in the files it read.
      expect(Array.isArray(m.needs)).toBe(true);
      expect(text).not.toContain("Ruled-out:");
      expect(text).not.toContain("refs/notes/commitlore");
    }
  });

  it("excludes the one candidate whose tree revealed its own decision", () => {
    const firewall = readJson(join(V6, "buildability", "firewall-leak-adjudication.json"));
    const adjudications = firewall.adjudications as { candidate_id: string; verdict: string }[];
    const excluded = adjudications.filter((a) => a.verdict === "EXCLUDED");
    expect(excluded.length).toBe(1);
    const dispositions = readJsonl<Disposition>(join(V6, "buildability", "dispositions.jsonl"));
    const row = dispositions.find((d) => d.candidate_id === excluded[0]?.candidate_id);
    expect(row?.disposition).toBe("NOT_TASK_BUILDABLE:candidate-decision-visible-to-task-author");
  });

  it("freezes the task and its acceptance before a control exists", () => {
    // The order is the whole firewall: an acceptance written after the ruling is
    // known can encode the answer. A manifest written afterwards could claim any
    // order, so this checks the manifest carries the digests it says it froze.
    const freeze = readJson(join(V6, "buildability", "task-freeze-manifest.json"));
    const frozen = freeze.frozen as { candidate_id: string; task_prompt_sha256: string;
      acceptance_source_sha256: string; verified_fails_on_base: boolean }[];
    expect(frozen.length).toBe(30);
    for (const f of frozen) {
      expect(f.task_prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.acceptance_source_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.verified_fails_on_base).toBe(true);
    }
  });

  it("refuses a task the base already satisfies", () => {
    const verification = readJson(join(V6, "buildability", "acceptance-base-verification.json"));
    const outcomes = verification.outcomes as Record<string, number>;
    expect(outcomes.FAILS_AS_EXPECTED).toBe(30);
    expect(outcomes.PASSES_ON_BASE).toBe(3);
    // A test that errors is not a test that failed, and folding the two together
    // would let a broken test file certify a candidate.
    expect(outcomes.DOES_NOT_RUN ?? 0).toBe(0);
  });
});

describe("§27 both acceptances decide a control, and a receipt is what says so", () => {
  const receipts = () =>
    readJsonl<{
      candidate_id: string; variant: string; functional_pass: boolean;
      task_acceptance: { pass: boolean; command_sha256: string };
      regression_acceptance: { pass: boolean; registered_command_sha256: string;
        executed_command_sha256: string; unexpected_failures: string[];
        coverage_lost: boolean; tests_silenced: boolean };
      baseline_used: string;
    }>(join(V6, "buildability", "control-acceptance-receipts.jsonl"));

  it("never calls a regression-only pass a functional pass", () => {
    for (const r of receipts()) {
      if (r.functional_pass) {
        expect(r.task_acceptance.pass).toBe(true);
        expect(r.regression_acceptance.pass).toBe(true);
      }
      expect(r.functional_pass).toBe(r.task_acceptance.pass && r.regression_acceptance.pass);
    }
  });

  it("rejects a receipt whose executed command is not the registered one", () => {
    for (const r of receipts()) {
      expect(r.regression_acceptance.executed_command_sha256)
        .toBe(r.regression_acceptance.registered_command_sha256);
    }
  });

  it("fails a control that removed coverage or silenced tests", () => {
    // Deleting the test that fails you, or marking it skipped, passes the suite
    // while defeating it. Neither produces a failure, so neither is visible in
    // the unexpected-failures list.
    for (const r of receipts()) {
      if (!r.regression_acceptance.pass) continue;
      expect(r.regression_acceptance.coverage_lost).toBe(false);
      expect(r.regression_acceptance.tests_silenced).toBe(false);
    }
  });

  it("judges every control against a baseline that includes its own acceptance file", () => {
    // The repository-wide baseline was measured on a tree the controls never run
    // in. Adding one acceptance file fails eight of agent-operator-score's own
    // census tests before any implementation exists, and four sound controls had
    // been recorded as failures because of it.
    for (const r of receipts()) {
      expect(r.baseline_used).toBe("per-candidate");
    }
    const defect = readJson(join(V6, "buildability", "regression-baseline-defect.json"));
    const impact = defect.measured_impact as { verdicts_flipped: number; every_flip_direction: string };
    expect(impact.verdicts_flipped).toBeGreaterThan(0);
    expect(impact.every_flip_direction).toBe("false -> true");
  });
});

describe("§27 a passing implementation is not automatically a violation", () => {
  it("requires two blind judges to agree before a Bad control counts", () => {
    const dispositions = readJsonl<Disposition>(join(V6, "buildability", "dispositions.jsonl"));
    const buildable = dispositions.filter((d) => d.disposition === "TASK_BUILDABLE");
    for (const d of buildable) {
      const judged = readJson(join(V6, "buildability", "judgements", `${d.candidate_id}-badA.json`));
      const verdicts = Object.values(judged).map((v) => (v as { verdict: string }).verdict);
      expect(verdicts.length).toBe(2);
      expect(new Set(verdicts).size).toBe(1);
      expect(verdicts[0]).toBe("VIOLATION_CONFIRMED");
    }
  });

  it("excludes a control that passed both acceptances but was judged compliant", () => {
    // One candidate's Bad control did the task, took what the builder described
    // as the ruled-out approach, and passed both suites -- and both judges said
    // it does not violate the decision. Counting a pass as a violation would
    // have moved agent-operator-score from eight to nine.
    const receipts = readJsonl<{ candidate_id: string; variant: string; functional_pass: boolean }>(
      join(V6, "buildability", "control-acceptance-receipts.jsonl"),
    );
    const dispositions = readJsonl<Disposition>(join(V6, "buildability", "dispositions.jsonl"));
    const buildable = new Set(
      dispositions.filter((d) => d.disposition === "TASK_BUILDABLE").map((d) => d.candidate_id),
    );
    const passedBadA = receipts.filter((r) => r.variant === "badA" && r.functional_pass);
    const passedButExcluded = passedBadA.filter((r) => !buildable.has(r.candidate_id));
    expect(passedButExcluded.length).toBeGreaterThan(0);
    for (const r of passedButExcluded) {
      const row = dispositions.find((d) => d.candidate_id === r.candidate_id);
      expect(row?.disposition).toMatch(/no-functionally-passing-violation|semantic-boundary-ambiguous/);
    }
  });
});

describe("§27 the floor decided the study and was not adjusted to fit it", () => {
  it("gives every source candidate exactly one registered disposition", () => {
    const dispositions = readJsonl<Disposition>(join(V6, "buildability", "dispositions.jsonl"));
    expect(dispositions.length).toBe(34);
    expect(new Set(dispositions.map((d) => d.candidate_id)).size).toBe(34);
    const registered = new Set([
      "TASK_BUILDABLE",
      "NOT_TASK_BUILDABLE:candidate-decision-visible-to-task-author",
      "NOT_TASK_BUILDABLE:neutral-maintenance-need-not-derivable",
      "NOT_TASK_BUILDABLE:task-already-satisfied-by-base",
      "NOT_TASK_BUILDABLE:task-functional-acceptance-not-deterministic",
      "NOT_TASK_BUILDABLE:regression-acceptance-not-deterministic",
      "NOT_TASK_BUILDABLE:scope-not-isolatable",
      "NOT_TASK_BUILDABLE:no-two-compliant-controls",
      "NOT_TASK_BUILDABLE:no-functionally-passing-violation-for-frozen-task",
      "NOT_TASK_BUILDABLE:semantic-boundary-ambiguous-for-frozen-bad-control",
      "NOT_TASK_BUILDABLE:oracle-not-discriminative",
      "NOT_TASK_BUILDABLE:oracle-redteam-failure",
      "NOT_TASK_BUILDABLE:runtime-budget-infeasible",
    ]);
    for (const d of dispositions) expect(registered).toContain(d.disposition);
  });

  it("holds the floors at the values the preregistration fixed", () => {
    const summary = readJson(join(V6, "buildability", "summary.json"));
    expect(summary.floors).toEqual({ per_repository: 10, total: 22 });
    const prereg = readFileSync(join(V6, "PREREGISTRATION.md"), "utf8");
    expect(prereg).toContain("TASK_BUILDABLE >= 10");
    expect(prereg).toContain("TASK_BUILDABLE >= 22");
  });

  it("reads the shortfall as TERMINAL_HOLD_FINAL rather than as a smaller study", () => {
    const summary = readJson(join(V6, "buildability", "summary.json"));
    expect(summary.undecided).toBe(0);
    expect(summary.task_buildable_by_repository).toEqual({ "agent-operator-score": 8, gitseed: 9 });
    expect(summary.task_buildable_total).toBe(17);
    expect(summary.verdict).toBe("TERMINAL_HOLD_FINAL");
    const status = readJson(join(V6, "STATUS.json"));
    expect(status).toMatchObject({ phase: "stage1-hold", verdict: "TERMINAL_HOLD_FINAL", measured_run_allowed: false });
  });

  it("holds zero measured product-effect rows and reaches no claim", () => {
    const status = readJson(join(V6, "STATUS.json"));
    expect(status.product_effect_rows).toBe(0);
    const result = readFileSync(join(V6, "RESULT.md"), "utf8");
    expect(result).toContain("measured_product_effect_rows: 0");
    // The study stopped before it could estimate anything, so the result must
    // not read as a finding about the product.
    expect(result).not.toMatch(/\d+% fewer repeated bad decisions/);
  });

  it("ends terminal, is never itself the active study, and forces a successor to carry a new id", () => {
    // Written first as `active_study_id === null`, which held only while v6 was
    // the most recent study and broke the moment a successor opened. What v6
    // durably established is that it ended and cannot be reopened -- so assert
    // that, and that no declaration can name v6 itself as active again.
    const declaration = readJson(resolve(V6, "..", "..", "ACTIVE-STUDY.json"));
    expect(declaration.last_terminal_study_id).toBe("cdeb-fresh-v6");
    expect(declaration.active_study_id).not.toBe("cdeb-fresh-v6");
    expect(declaration.successor_requires_new_study_id).toBe(true);

    const status = readJson(join(V6, "STATUS.json"));
    expect(status.verdict).toBe("TERMINAL_HOLD_FINAL");
    expect(TERMINAL_STUDY_PHASES).toContain(status.phase);
  });
});
