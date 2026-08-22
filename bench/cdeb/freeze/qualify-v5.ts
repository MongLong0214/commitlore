/**
 * CDEB-Fresh v5 Stage 0 qualification and the GO/HOLD arithmetic.
 *
 * Every gate arrives decided -- mechanically, by two agreeing blind reviewers,
 * or by a third blind vote -- and this module only combines them. It combines
 * them one way: all eight or nothing, and an unresolved disagreement is a
 * failure rather than a value to be filled in later.
 *
 * One rule is enforced here rather than trusted: no gate may require a decision
 * to be documented outside its own record. That was v4's gate, it removed 190
 * of 241 candidates, and `assertNoProvenanceGate` exists so it cannot come back
 * as a differently-named field.
 */

import type { AuthorityAuditEntry } from "./authority-v5.ts";
import type { DeliveryFeasibility } from "./delivery-v4.ts";

export const V5_GATES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"] as const;
export type V5Gate = (typeof V5_GATES)[number];

export type GateSource = "mechanical" | "agreed" | "adjudicated" | "unresolved" | "unavailable";

export interface GateOutcome {
  readonly passed: boolean;
  readonly source: GateSource;
}

/** One reviewer's reading of what policy a frozen record defines. */
export interface Interpretation {
  readonly candidate_id: string;
  readonly ruled_out_behavior: string;
  readonly reason: string;
  readonly scope: readonly string[];
  readonly lifecycle: string;
  readonly violation_boundary: string;
  readonly compliance_boundary: string;
  readonly decidable: boolean;
  readonly g3_reason_hidden_from_code: boolean;
  readonly g4_wrong_path_functionally_viable: boolean;
  readonly g5_oracle_deterministic: boolean;
  readonly g7_bounded_task_feasible: boolean;
  readonly note: string;
}

export interface V5QualificationEntry {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v5";
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly decision_audit_anchor: string;
  readonly authority: string;
  readonly authority_strength: string;
  readonly independent_corroboration: boolean;
  readonly identity_present: boolean;
  readonly record_id: string | null;
  readonly lifecycle: string;
  readonly gates: Readonly<Record<V5Gate, GateOutcome>>;
  readonly qualified: boolean;
  readonly exclusion_code: string | null;
}

const GATE_CODES: Readonly<Record<V5Gate, string>> = {
  G1: "not-natural-recorded-authority",
  G2: "record-ambiguous",
  G3: "reason-obvious-from-code",
  G4: "wrong-path-not-functionally-viable",
  G5: "oracle-not-deterministic",
  G6: "shipping-content-not-observable",
  G7: "task-not-bounded",
  G8: "leakage-risk",
};

/**
 * Two blind reviewers, and a third blind vote where they split. The third is a
 * vote asked the same question from the same evidence, not an adjudicator who
 * already knows how the pair voted -- the study operator reading their own
 * corpus is the least blind reader available. With no third vote the gate fails
 * closed and stays visible as a disagreement.
 */
export const pairGate = (
  left: boolean | undefined,
  right: boolean | undefined,
  third?: boolean,
): GateOutcome => {
  if (left === undefined || right === undefined) return { passed: false, source: "unavailable" };
  if (left === right) return { passed: left, source: "agreed" };
  if (third === undefined) return { passed: false, source: "unresolved" };
  return { passed: third, source: "adjudicated" };
};

/**
 * Two tie-breakers, not one, and they must agree.
 *
 * The first run used a single third vote drawn from the same model as reviewer
 * A. Measured against the splits it resolved, it sided with A 67% of the time
 * rather than the ~50% independence would give -- so it was substantially A
 * voting twice, and it was the mechanism that took the corpus from 44 qualified
 * to 88. A tie-break that leans toward one of the disputants is not a tie-break.
 *
 * So a split is resolved only when both tie-breakers, run fresh and blind from
 * the two different models, return the same answer. Where they disagree the
 * gate stays unresolved and fails closed, which is the honest outcome for a
 * question two independent readings could not settle.
 */
export const resolveTieBreak = (
  first: boolean | undefined,
  second: boolean | undefined,
): boolean | undefined => (first !== undefined && first === second ? first : undefined);

export interface MergeInputs {
  readonly authority: readonly AuthorityAuditEntry[];
  readonly interpretations: ReadonlyMap<string, { a: Interpretation; b: Interpretation; c?: Interpretation; d?: Interpretation }>;
  readonly delivery: ReadonlyMap<string, DeliveryFeasibility>;
  readonly leakageExcluded: ReadonlySet<string>;
}

export const mergeV5 = (inputs: MergeInputs): V5QualificationEntry[] =>
  inputs.authority.map((entry) => {
    const pair = inputs.interpretations.get(entry.candidate_id);
    const delivery = inputs.delivery.get(entry.candidate_id);

    const g1: GateOutcome = { passed: entry.authority === "A0", source: "mechanical" };
    // Semantic decidability: can two independent readers each draw the line a
    // program would later judge against? Not "is it written elsewhere".
    const g2 = pairGate(pair?.a.decidable, pair?.b.decidable, resolveTieBreak(pair?.c?.decidable, pair?.d?.decidable));
    const g3 = pairGate(pair?.a.g3_reason_hidden_from_code, pair?.b.g3_reason_hidden_from_code, resolveTieBreak(pair?.c?.g3_reason_hidden_from_code, pair?.d?.g3_reason_hidden_from_code));
    const g4 = pairGate(pair?.a.g4_wrong_path_functionally_viable, pair?.b.g4_wrong_path_functionally_viable, resolveTieBreak(pair?.c?.g4_wrong_path_functionally_viable, pair?.d?.g4_wrong_path_functionally_viable));
    const g5 = pairGate(pair?.a.g5_oracle_deterministic, pair?.b.g5_oracle_deterministic, resolveTieBreak(pair?.c?.g5_oracle_deterministic, pair?.d?.g5_oracle_deterministic));
    const g7 = pairGate(pair?.a.g7_bounded_task_feasible, pair?.b.g7_bounded_task_feasible, resolveTieBreak(pair?.c?.g7_bounded_task_feasible, pair?.d?.g7_bounded_task_feasible));
    const g6: GateOutcome = {
      passed: delivery?.delivered === true,
      source: delivery === undefined ? "unavailable" : "mechanical",
    };
    const g8: GateOutcome = { passed: !inputs.leakageExcluded.has(entry.candidate_id), source: "mechanical" };

    const gates: Record<V5Gate, GateOutcome> = { G1: g1, G2: g2, G3: g3, G4: g4, G5: g5, G6: g6, G7: g7, G8: g8 };
    const qualified = V5_GATES.every((gate) => gates[gate].passed);
    let exclusion: string | null = null;
    if (!qualified) {
      const failed = V5_GATES.find((gate) => !gates[gate].passed)!;
      exclusion = gates[failed].source === "unresolved" ? `${GATE_CODES[failed]}-unresolved` : GATE_CODES[failed];
    }
    return {
      schema_version: 1,
      study_id: "cdeb-fresh-v5",
      candidate_id: entry.candidate_id,
      repository_id: entry.repository_id,
      decision_audit_anchor: entry.decision_audit_anchor,
      authority: entry.authority,
      authority_strength: entry.authority_strength,
      independent_corroboration: entry.independent_corroboration,
      identity_present: entry.identity_present,
      record_id: entry.record_id,
      lifecycle: delivery === undefined ? "unknown" : delivery.stale_as_current ? "stale" : "current",
      gates,
      qualified,
      exclusion_code: exclusion,
    };
  });

/**
 * The regression guard aimed at v4's gate.
 *
 * It would come back as a candidate excluded while every gate it declares has
 * passed, or as an exclusion code naming provenance or corroboration. Both
 * shapes are refused here rather than left for a reader to notice.
 */
export const assertNoProvenanceGate = (entries: readonly V5QualificationEntry[]): void => {
  const banned = /provenance|corroborat|independent-source|documented-elsewhere/iu;
  const named = entries.filter((entry) => entry.exclusion_code !== null && banned.test(entry.exclusion_code));
  if (named.length > 0) {
    throw new Error(
      `qualify v5: ${String(named.length)} candidate(s) excluded under a provenance-shaped code (${named[0]!.exclusion_code}); v4's gate has returned under a new name`,
    );
  }
  const silent = entries.filter(
    (entry) => !entry.qualified && V5_GATES.every((gate) => entry.gates[gate].passed),
  );
  if (silent.length > 0) {
    throw new Error(
      `qualify v5: ${String(silent.length)} candidate(s) failed while every declared gate passed; something is excluding outside the gates`,
    );
  }
  const corroborationOnly = entries.filter(
    (entry) => entry.qualified && !entry.independent_corroboration,
  );
  if (entries.some((entry) => entry.qualified) && corroborationOnly.length === 0) {
    throw new Error(
      "qualify v5: every qualified candidate is corroborated, so this run cannot show that corroboration is not required",
    );
  }
};

export interface V5RepositorySummary {
  readonly repository_id: string;
  readonly raw: number;
  readonly a0: number;
  readonly a1: number;
  readonly semantic: number;
  readonly hidden: number;
  readonly viable: number;
  readonly oracle: number;
  readonly delivery: number;
  readonly bounded: number;
  readonly leakage_safe: number;
  readonly qualified: number;
  readonly qualified_identified: number;
  readonly qualified_id_less: number;
  readonly qualified_a0_only: number;
  readonly eligible: boolean;
}

/** Registered before the census ran, taken unchanged from the owner's decision. */
export const V5_THRESHOLDS = {
  minQualifiedPerEligibleRepository: 8,
  minEligibleRepositories: 3,
  minTotalQualified: 36,
} as const;

export const summarizeV5 = (entries: readonly V5QualificationEntry[]): V5RepositorySummary[] => {
  const byRepository = new Map<string, V5QualificationEntry[]>();
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
        raw: list.length,
        a0: list.filter((entry) => entry.gates.G1.passed).length,
        a1: list.filter((entry) => entry.independent_corroboration).length,
        semantic: list.filter((entry) => entry.gates.G2.passed).length,
        hidden: list.filter((entry) => entry.gates.G3.passed).length,
        viable: list.filter((entry) => entry.gates.G4.passed).length,
        oracle: list.filter((entry) => entry.gates.G5.passed).length,
        delivery: list.filter((entry) => entry.gates.G6.passed).length,
        bounded: list.filter((entry) => entry.gates.G7.passed).length,
        leakage_safe: list.filter((entry) => entry.gates.G8.passed).length,
        qualified: qualified.length,
        qualified_identified: qualified.filter((entry) => entry.identity_present).length,
        qualified_id_less: qualified.filter((entry) => !entry.identity_present).length,
        qualified_a0_only: qualified.filter((entry) => !entry.independent_corroboration).length,
        eligible: qualified.length >= V5_THRESHOLDS.minQualifiedPerEligibleRepository,
      };
    });
};

export interface V5Verdict {
  readonly verdict: "GO" | "HOLD";
  readonly eligible_repositories: number;
  readonly total_qualified: number;
  readonly recommended_fixed_set: readonly string[];
  readonly unmet: readonly string[];
  readonly delivery_observable_identified: boolean;
  readonly delivery_observable_id_less: boolean;
}

export const decideV5 = (
  summaries: readonly V5RepositorySummary[],
  entries: readonly V5QualificationEntry[],
): V5Verdict => {
  const eligible = summaries.filter((summary) => summary.eligible);
  const total = summaries.reduce((sum, summary) => sum + summary.qualified, 0);
  const qualified = entries.filter((entry) => entry.qualified);
  const identified = qualified.some((entry) => entry.identity_present);
  const idLess = qualified.some((entry) => !entry.identity_present);
  const unmet: string[] = [];
  if (eligible.length < V5_THRESHOLDS.minEligibleRepositories) {
    unmet.push(`eligible repositories ${String(eligible.length)} < ${String(V5_THRESHOLDS.minEligibleRepositories)}`);
  }
  if (total < V5_THRESHOLDS.minTotalQualified) {
    unmet.push(`total qualified ${String(total)} < ${String(V5_THRESHOLDS.minTotalQualified)}`);
  }
  // Observability is required where each identity state is present at all. A
  // corpus with no id-less decisions left cannot be asked to demonstrate one.
  const anyIdLess = entries.some((entry) => !entry.identity_present);
  const anyIdentified = entries.some((entry) => entry.identity_present);
  if (anyIdentified && !identified) unmet.push("no identified decision qualified, so delivery observability is not demonstrated for that state");
  if (anyIdLess && !idLess) unmet.push("no id-less decision qualified, so the estimand change is not demonstrated");
  return {
    verdict: unmet.length === 0 ? "GO" : "HOLD",
    eligible_repositories: eligible.length,
    total_qualified: total,
    recommended_fixed_set: eligible.map((summary) => summary.repository_id),
    unmet,
    delivery_observable_identified: identified,
    delivery_observable_id_less: idLess,
  };
};

export const exclusionCounts = (entries: readonly V5QualificationEntry[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.exclusion_code === null) continue;
    counts[entry.exclusion_code] = (counts[entry.exclusion_code] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([, left], [, right]) => right - left));
};

export const agreementByGate = (
  entries: readonly V5QualificationEntry[],
): { gate: string; compared: number; agreed: number; rate: number }[] =>
  (["G2", "G3", "G4", "G5", "G7"] as const).map((gate) => {
    const decided = entries.filter((entry) =>
      ["agreed", "unresolved", "adjudicated"].includes(entry.gates[gate].source),
    );
    const agreed = decided.filter((entry) => entry.gates[gate].source === "agreed").length;
    return { gate, compared: decided.length, agreed, rate: decided.length === 0 ? 0 : agreed / decided.length };
  });
