/**
 * CDEB-Fresh v4 Stage 0 qualification and the GO/HOLD arithmetic.
 *
 * Every gate arrives here already decided -- mechanically, by two agreeing
 * reviewers, or by an adjudicator -- and this module only combines them. It
 * combines them one way: a candidate qualifies when every gate passed, and an
 * unresolved gate is a failure rather than a missing value to be filled in
 * later. That is the whole reason the merge is separate from the review.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { V4CandidateEntry } from "./census-v4.ts";
import type { ProvenanceAuditEntry } from "./provenance-v4.ts";
import type { StageAVerdict, StageBVerdict } from "./review-v4.ts";
import type { DeliveryFeasibility } from "./delivery-v4.ts";

export const GATES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"] as const;
export type Gate = (typeof GATES)[number];

export type GateSource = "mechanical" | "agreed" | "adjudicated" | "unresolved" | "unavailable";

export interface GateOutcome {
  readonly passed: boolean;
  readonly source: GateSource;
}

export interface QualificationEntry {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v4";
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly decision_audit_anchor: string;
  readonly identity_present: boolean;
  readonly record_id: string | null;
  readonly protocol_version: string | null;
  readonly lifecycle: string;
  readonly storage_kind: string;
  readonly gates: Readonly<Record<Gate, GateOutcome>>;
  readonly quote_overlap: number | null;
  readonly qualified: boolean;
  readonly exclusion_code: string | null;
  readonly provenance_tier: "P1" | "P2" | "unsupported";
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "that", "this",
  "it", "is", "was", "were", "be", "been", "as", "at", "by", "from", "into", "would",
  "could", "not", "no", "but", "so", "than", "then", "its", "their", "our", "we",
]);

/**
 * Content-word overlap between a reviewer's blind quote and the recorded ruling.
 *
 * A reviewer can find *a* rejected alternative in a commit that ruled out
 * three, and G2 asks whether *this* decision is recoverable. So the quote is
 * compared to this candidate's own ruling, the fraction is published per
 * candidate, and the floor it is compared against is named in the
 * preregistration refinement as well as here -- a reader who disagrees with the
 * floor can apply another one to the same published numbers.
 */
export const quoteOverlap = (quote: string, ruling: string): number => {
  const words = (value: string): Set<string> =>
    new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/u)
        .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
    );
  const left = words(quote);
  const right = words(ruling);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of right) if (left.has(word)) shared += 1;
  return shared / right.size;
};

/** The refinement recorded in deviations.jsonl before any merged count existed. */
export const QUOTE_OVERLAP_FLOOR = 0.34;

/**
 * Two blind reviewers, and a third blind vote where they split.
 *
 * The third vote is a vote, not an override: it is asked the same question from
 * the same evidence, in a fresh session, and the majority of three decides. An
 * adjudicator who already knows how the pair voted cannot be blind, and the
 * study operator adjudicating their own corpus is the least blind reader
 * available. Where no third vote exists the gate fails closed and stays visible
 * as a disagreement.
 */
const pairGate = (
  left: boolean | undefined,
  right: boolean | undefined,
  third?: boolean,
): GateOutcome => {
  if (left === undefined || right === undefined) return { passed: false, source: "unavailable" };
  if (left === right) return { passed: left, source: "agreed" };
  if (third === undefined) return { passed: false, source: "unresolved" };
  return { passed: third, source: "adjudicated" };
};

export interface MergeInputs {
  readonly candidates: readonly V4CandidateEntry[];
  readonly audit: readonly ProvenanceAuditEntry[];
  /** `r3` is present only where the pair split; it is a third blind vote, not an override. */
  readonly stageA: ReadonlyMap<string, { r1: StageAVerdict; r2: StageAVerdict; r3?: StageAVerdict }>;
  readonly stageB: ReadonlyMap<string, { r1: StageBVerdict; r2: StageBVerdict; r3?: StageBVerdict }>;
  readonly delivery: ReadonlyMap<string, DeliveryFeasibility>;
  readonly rulings: ReadonlyMap<string, { ruling: string; reason: string }>;
}

export const mergeQualification = (inputs: MergeInputs): QualificationEntry[] => {
  const auditById = new Map(inputs.audit.map((entry) => [entry.candidate_id, entry]));
  return inputs.candidates.map((candidate) => {
    const audit = auditById.get(candidate.candidate_id);
    const stageA = inputs.stageA.get(candidate.candidate_id);
    const stageB = inputs.stageB.get(candidate.candidate_id);
    const delivery = inputs.delivery.get(candidate.candidate_id);
    const ruling = inputs.rulings.get(candidate.candidate_id);

    const g8: GateOutcome = {
      passed: !candidate.ineligibility_codes.includes("legacy-exclusion-match"),
      source: "mechanical",
    };
    const g1: GateOutcome = {
      passed: audit?.g1_natural_provenance === true,
      source: audit === undefined ? "unavailable" : "mechanical",
    };

    let overlap: number | null = null;
    let g2: GateOutcome = { passed: false, source: "unavailable" };
    if (audit !== undefined && audit.mechanical_exclusion !== null) {
      g2 = { passed: false, source: "mechanical" };
    } else if (stageA !== undefined && ruling !== undefined) {
      const votes = [stageA.r1, stageA.r2, ...(stageA.r3 === undefined ? [] : [stageA.r3])];
      const found = pairGate(
        stageA.r1.states_rejected_alternative,
        stageA.r2.states_rejected_alternative,
        stageA.r3?.states_rejected_alternative,
      );
      overlap = Math.max(...votes.map((vote) => quoteOverlap(vote.quoted_alternative, ruling.ruling)));
      g2 = found.passed
        ? { passed: overlap >= QUOTE_OVERLAP_FLOOR, source: found.source }
        : found;
    }

    const g3 = pairGate(stageB?.r1.g3_reason_hidden_from_code, stageB?.r2.g3_reason_hidden_from_code, stageB?.r3?.g3_reason_hidden_from_code);
    const g4 = pairGate(stageB?.r1.g4_wrong_path_functionally_viable, stageB?.r2.g4_wrong_path_functionally_viable, stageB?.r3?.g4_wrong_path_functionally_viable);
    const g5 = pairGate(stageB?.r1.g5_oracle_deterministic, stageB?.r2.g5_oracle_deterministic, stageB?.r3?.g5_oracle_deterministic);
    const g7 = pairGate(stageB?.r1.g7_bounded_task_feasible, stageB?.r2.g7_bounded_task_feasible, stageB?.r3?.g7_bounded_task_feasible);
    const g6: GateOutcome = {
      passed: delivery?.delivered === true,
      source: delivery === undefined ? "unavailable" : "mechanical",
    };

    const gates: Record<Gate, GateOutcome> = { G1: g1, G2: g2, G3: g3, G4: g4, G5: g5, G6: g6, G7: g7, G8: g8 };
    const qualified = GATES.every((gate) => gates[gate].passed);
    return {
      schema_version: 1,
      study_id: "cdeb-fresh-v4",
      candidate_id: candidate.candidate_id,
      repository_id: candidate.repository_id,
      decision_audit_anchor: candidate.decision_audit_anchor,
      identity_present: candidate.identity_present,
      record_id: candidate.record_id,
      protocol_version: candidate.protocol_version,
      lifecycle: candidate.lifecycle,
      storage_kind: candidate.storage_kind,
      gates,
      quote_overlap: overlap,
      qualified,
      exclusion_code: qualified ? null : firstFailure(gates, audit, candidate),
      // Provenance only, not overall qualification: a candidate with independent
      // ordinary-source support that fails the delivery gate still has that
      // support, and calling it "unsupported" would misreport where it failed.
      // P2 is the owner-attested tier; Stage 0 collected no owner testimony, so
      // nothing here is P2 and the field records that rather than a choice.
      provenance_tier: g1.passed && g2.passed ? "P1" : "unsupported",
    };
  });
};

const GATE_CODES: Readonly<Record<Gate, string>> = {
  G1: "benchmark-authored",
  G2: "insufficient-provenance",
  G3: "reason-obvious-from-code",
  G4: "wrong-path-not-functionally-viable",
  G5: "oracle-not-deterministic",
  G6: "shipping-content-not-observable",
  G7: "task-not-bounded",
  G8: "legacy-exclusion-match",
};

const firstFailure = (
  gates: Readonly<Record<Gate, GateOutcome>>,
  audit: ProvenanceAuditEntry | undefined,
  candidate: V4CandidateEntry,
): string => {
  if (candidate.ineligibility_codes.length > 0) return candidate.ineligibility_codes[0]!;
  if (audit?.mechanical_exclusion !== null && audit?.mechanical_exclusion !== undefined) return audit.mechanical_exclusion;
  for (const gate of GATES) {
    if (!gates[gate].passed) {
      return gates[gate].source === "unresolved" ? `${GATE_CODES[gate]}-unresolved` : GATE_CODES[gate];
    }
  }
  return "unknown";
};

export interface RepositorySummary {
  readonly repository_id: string;
  readonly raw_decisions: number;
  readonly provenance_pass: number;
  readonly hidden_rationale_pass: number;
  readonly wrong_path_viable: number;
  readonly oracle_feasible: number;
  readonly shipping_delivery_feasible: number;
  readonly bounded: number;
  readonly final_qualified: number;
  readonly qualified_with_identity: number;
  readonly qualified_without_identity: number;
  readonly eligible: boolean;
}

/** Registered before the census ran; taken unchanged from the owner's Stage 0 PRD. */
export const GO_THRESHOLDS = {
  minEligibleRepositories: 3,
  minQualifiedPerRepository: 12,
  minTotalQualified: 48,
} as const;

export const summarizeRepositories = (
  entries: readonly QualificationEntry[],
): RepositorySummary[] => {
  const byRepository = new Map<string, QualificationEntry[]>();
  for (const entry of entries) {
    const list = byRepository.get(entry.repository_id) ?? [];
    list.push(entry);
    byRepository.set(entry.repository_id, list);
  }
  return [...byRepository.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([repository_id, list]) => {
      const qualified = list.filter((entry) => entry.qualified);
      return {
        repository_id,
        raw_decisions: list.length,
        provenance_pass: list.filter((entry) => entry.gates.G1.passed && entry.gates.G2.passed).length,
        hidden_rationale_pass: list.filter((entry) => entry.gates.G3.passed).length,
        wrong_path_viable: list.filter((entry) => entry.gates.G4.passed).length,
        oracle_feasible: list.filter((entry) => entry.gates.G5.passed).length,
        shipping_delivery_feasible: list.filter((entry) => entry.gates.G6.passed).length,
        bounded: list.filter((entry) => entry.gates.G7.passed).length,
        final_qualified: qualified.length,
        qualified_with_identity: qualified.filter((entry) => entry.identity_present).length,
        qualified_without_identity: qualified.filter((entry) => !entry.identity_present).length,
        eligible: qualified.length >= GO_THRESHOLDS.minQualifiedPerRepository,
      };
    });
};

export interface Stage0Verdict {
  readonly verdict: "GO" | "HOLD";
  readonly eligible_repositories: number;
  readonly total_qualified: number;
  readonly recommended_fixed_set: readonly string[];
  readonly unmet: readonly string[];
  readonly delivery_observable_with_identity: boolean;
  readonly delivery_observable_without_identity: boolean;
}

/**
 * The verdict is a lookup against thresholds fixed before the counts existed.
 * Nothing here is allowed to relax on the way past: a threshold that moves when
 * the count is short is not a threshold.
 */
export const decideStage0 = (
  summaries: readonly RepositorySummary[],
  entries: readonly QualificationEntry[],
): Stage0Verdict => {
  const eligible = summaries.filter((summary) => summary.eligible);
  const totalQualified = summaries.reduce((sum, summary) => sum + summary.final_qualified, 0);
  const qualified = entries.filter((entry) => entry.qualified);
  const withIdentity = qualified.some((entry) => entry.identity_present);
  const withoutIdentity = qualified.some((entry) => !entry.identity_present);
  const unmet: string[] = [];
  if (eligible.length < GO_THRESHOLDS.minEligibleRepositories) {
    unmet.push(`eligible repositories ${String(eligible.length)} < ${String(GO_THRESHOLDS.minEligibleRepositories)}`);
  }
  if (totalQualified < GO_THRESHOLDS.minTotalQualified) {
    unmet.push(`total qualified ${String(totalQualified)} < ${String(GO_THRESHOLDS.minTotalQualified)}`);
  }
  if (!withIdentity) unmet.push("no identified decision qualified, so delivery observability is not demonstrated for both identity states");
  if (!withoutIdentity) unmet.push("no id-less decision qualified, so the estimand change is not demonstrated");
  return {
    verdict: unmet.length === 0 ? "GO" : "HOLD",
    eligible_repositories: eligible.length,
    total_qualified: totalQualified,
    recommended_fixed_set: eligible.map((summary) => summary.repository_id),
    unmet,
    delivery_observable_with_identity: withIdentity,
    delivery_observable_without_identity: withoutIdentity,
  };
};

export interface AgreementSummary {
  readonly gate: string;
  readonly compared: number;
  readonly agreed: number;
  readonly rate: number;
}

/**
 * Reported per gate, not as one number. A pair that agrees on an easy gate and
 * splits on the hard one has a respectable average and no useful reliability.
 */
export const agreementByGate = (entries: readonly QualificationEntry[]): AgreementSummary[] =>
  (["G2", "G3", "G4", "G5", "G7"] as const).map((gate) => {
    const decided = entries.filter((entry) =>
      ["agreed", "unresolved", "adjudicated"].includes(entry.gates[gate].source),
    );
    const agreed = decided.filter((entry) => entry.gates[gate].source === "agreed").length;
    return { gate, compared: decided.length, agreed, rate: decided.length === 0 ? 0 : agreed / decided.length };
  });

export interface ReviewRow {
  readonly candidate_id: string;
  readonly reviewer: "reviewer-1" | "reviewer-2" | "reviewer-3";
}

export type StageARow = ReviewRow & Omit<StageAVerdict, "candidate_id">;
export type StageBRow = ReviewRow & Omit<StageBVerdict, "candidate_id">;

const byReviewer = <T extends ReviewRow, V>(
  rows: readonly T[],
  build: (row: T) => V,
): Map<string, { r1: V; r2: V; r3?: V }> => {
  const map = new Map<string, { r1?: V; r2?: V; r3?: V }>();
  for (const row of rows) {
    const slot = map.get(row.candidate_id) ?? {};
    if (row.reviewer === "reviewer-1") slot.r1 = build(row);
    else if (row.reviewer === "reviewer-2") slot.r2 = build(row);
    else slot.r3 = build(row);
    map.set(row.candidate_id, slot);
  }
  const complete = new Map<string, { r1: V; r2: V; r3?: V }>();
  for (const [id, slot] of map) {
    // A candidate seen by only one reviewer is not a paired review, and
    // treating it as one would give a single opinion the authority of two.
    if (slot.r1 === undefined || slot.r2 === undefined) continue;
    complete.set(id, slot.r3 === undefined ? { r1: slot.r1, r2: slot.r2 } : { r1: slot.r1, r2: slot.r2, r3: slot.r3 });
  }
  return complete;
};

export const stageAIndex = (rows: readonly StageARow[]): Map<string, { r1: StageAVerdict; r2: StageAVerdict; r3?: StageAVerdict }> =>
  byReviewer(rows, (row) => ({
    candidate_id: row.candidate_id,
    states_rejected_alternative: row.states_rejected_alternative,
    quoted_alternative: row.quoted_alternative,
    quoted_reason: row.quoted_reason,
    note: row.note,
  }));

export const stageBIndex = (rows: readonly StageBRow[]): Map<string, { r1: StageBVerdict; r2: StageBVerdict; r3?: StageBVerdict }> =>
  byReviewer(rows, (row) => ({
    candidate_id: row.candidate_id,
    g3_reason_hidden_from_code: row.g3_reason_hidden_from_code,
    g4_wrong_path_functionally_viable: row.g4_wrong_path_functionally_viable,
    g5_oracle_deterministic: row.g5_oracle_deterministic,
    g7_bounded_task_feasible: row.g7_bounded_task_feasible,
    note: row.note,
  }));

/**
 * The Stage 0 merge, run from the artifacts on disk.
 *
 * Everything it reads is a committed study artifact, so the verdict can be
 * recomputed by anyone holding this repository -- the reviewers' raw verdicts
 * included. A GO or HOLD that only its author can reproduce is not a result.
 */
/**
 * How often the two reviewers, having both found a rejection, quoted the same
 * span of text.
 *
 * It is not a quality measure. It measures how independent the pair actually
 * was: two models of one family that converge on the same sentence are two
 * readings of one habit, and the agreement rate has to be read in that light.
 */
export const quoteConcordance = (
  stageA: ReadonlyMap<string, { r1: StageAVerdict; r2: StageAVerdict; r3?: StageAVerdict }>,
): { pairs: number; mean_jaccard: number; near_identical: number } => {
  const tokens = (value: string): Set<string> =>
    new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/u)
        .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
    );
  let pairs = 0;
  let total = 0;
  let nearIdentical = 0;
  for (const { r1, r2 } of stageA.values()) {
    if (!r1.states_rejected_alternative || !r2.states_rejected_alternative) continue;
    const left = tokens(r1.quoted_alternative);
    const right = tokens(r2.quoted_alternative);
    if (left.size === 0 && right.size === 0) continue;
    const shared = [...left].filter((word) => right.has(word)).length;
    const jaccard = shared / (left.size + right.size - shared);
    pairs += 1;
    total += jaccard;
    if (jaccard > 0.9) nearIdentical += 1;
  }
  return { pairs, mean_jaccard: pairs === 0 ? 0 : total / pairs, near_identical: nearIdentical };
};

export interface RunQualificationOptions {
  readonly studyRoot: string;
}

export interface QualificationOutput {
  readonly entries: readonly QualificationEntry[];
  readonly repositories: readonly RepositorySummary[];
  readonly verdict: Stage0Verdict;
  readonly agreement: readonly AgreementSummary[];
  readonly concordance: { pairs: number; mean_jaccard: number; near_identical: number };
}

export const runQualification = (options: RunQualificationOptions): QualificationOutput => {
  const root = resolve(options.studyRoot);
  const readRows = <T>(name: string): T[] =>
    readFileSync(join(root, "feasibility", name), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as T);

  const candidates = readRows<V4CandidateEntry>("candidate-census.jsonl");
  const audit = readRows<ProvenanceAuditEntry>("provenance-audit.jsonl");
  const delivery = new Map(
    readRows<DeliveryFeasibility>("delivery-feasibility.jsonl").map((row) => [row.candidate_id, row]),
  );
  const rulings = new Map(
    readRows<{ candidate_id: string; ruling: string; reason: string }>("rulings.jsonl").map((row) => [
      row.candidate_id,
      { ruling: row.ruling, reason: row.reason },
    ]),
  );
  const stageA = stageAIndex(readRows<StageARow>("review-stage-a.jsonl"));
  const entries = mergeQualification({
    candidates,
    audit,
    stageA,
    stageB: stageBIndex(readRows<StageBRow>("review-stage-b.jsonl")),
    delivery,
    rulings,
  });
  const repositories = summarizeRepositories(entries);
  return {
    entries,
    repositories,
    verdict: decideStage0(repositories, entries),
    agreement: agreementByGate(entries),
    concordance: quoteConcordance(stageA),
  };
};

const main = (argv: readonly string[]): void => {
  const index = argv.indexOf("--study-root");
  const studyRoot = index >= 0 ? argv[index + 1] : undefined;
  if (studyRoot === undefined) throw new Error("qualify v4: --study-root is required");
  const root = resolve(studyRoot);
  const output = runQualification({ studyRoot: root });
  writeFileSync(
    join(root, "feasibility", "qualification.jsonl"),
    `${output.entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
  writeFileSync(
    join(root, "feasibility", "repository-summary.json"),
    `${JSON.stringify({ schema_version: 1, study_id: "cdeb-fresh-v4", thresholds: GO_THRESHOLDS, repositories: output.repositories }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "feasibility", "qualification-summary.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        study_id: "cdeb-fresh-v4",
        measured_product_effect_rows: 0,
        thresholds: GO_THRESHOLDS,
        verdict: output.verdict,
        reviewer_agreement_by_gate: output.agreement,
        reviewer_quote_concordance: output.concordance,
        exclusion_reasons: exclusionCounts(output.entries),
        identity_composition: identityCounts(output.entries),
      },
      null,
      2,
    )}\n`,
  );
  for (const repository of output.repositories) {
    process.stdout.write(
      `${repository.repository_id.padEnd(22)} raw ${String(repository.raw_decisions).padStart(4)}` +
        `  prov ${String(repository.provenance_pass).padStart(3)}` +
        `  hidden ${String(repository.hidden_rationale_pass).padStart(3)}` +
        `  viable ${String(repository.wrong_path_viable).padStart(3)}` +
        `  oracle ${String(repository.oracle_feasible).padStart(3)}` +
        `  delivery ${String(repository.shipping_delivery_feasible).padStart(3)}` +
        `  bounded ${String(repository.bounded).padStart(3)}` +
        `  qualified ${String(repository.final_qualified).padStart(3)}` +
        `${repository.eligible ? "  ELIGIBLE" : ""}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(output.verdict, null, 1)}\n`);
};

export const exclusionCounts = (entries: readonly QualificationEntry[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.exclusion_code === null) continue;
    counts[entry.exclusion_code] = (counts[entry.exclusion_code] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([, left], [, right]) => right - left));
};

export const identityCounts = (entries: readonly QualificationEntry[]): Record<string, number> => {
  const qualified = entries.filter((entry) => entry.qualified);
  return {
    qualified_total: qualified.length,
    qualified_with_identity: qualified.filter((entry) => entry.identity_present).length,
    qualified_without_identity: qualified.filter((entry) => !entry.identity_present).length,
    enumerated_with_identity: entries.filter((entry) => entry.identity_present).length,
    enumerated_without_identity: entries.filter((entry) => !entry.identity_present).length,
  };
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
