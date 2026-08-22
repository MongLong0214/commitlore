/**
 * CDEB-Fresh v5 natural recorded authority (A0) and corroboration metadata (A1).
 *
 * v4 admitted a candidate only when the same ruling could be recovered from
 * prose with the record removed, and 190 of 241 failed that. The case it
 * excluded is the one the product exists for: a judgment recorded once, which
 * the current code does not explain.
 *
 * So the record is the authority here. What this module checks is that the
 * record is a *natural* one -- written during ordinary development, before the
 * cutoff, in the frozen snapshot, by nobody building a benchmark -- and that its
 * policy has the parts a policy needs. Whether the same decision also appears in
 * a pull request or an ADR is recorded beside the verdict and never in it.
 */

import { createHash } from "node:crypto";

import type { V4CandidateEntry } from "./census-v4.ts";

export const AUTHORITY_TIERS = ["A0", "A1", "none"] as const;
export type AuthorityTier = (typeof AUTHORITY_TIERS)[number];

/** Every way a candidate can fail A0. None of them is about corroboration. */
export const A0_FAILURE_CODES = [
  "post-cutoff",
  "benchmark-authored",
  "backfilled-or-reconstructed",
  "reason-not-explicit",
  "scope-unresolvable",
  "lifecycle-unresolvable",
  "unauthorized-repository",
  "record-absent-from-snapshot",
] as const;
export type A0FailureCode = (typeof A0_FAILURE_CODES)[number];

export interface AuthorityAuditEntry {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v5";
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly source_commit_sha: string;
  readonly decision_audit_anchor: string;
  readonly recorded_at: string | null;
  readonly pre_cutoff: boolean;
  readonly in_frozen_snapshot: boolean;
  readonly ordinary_development_origin: boolean;
  readonly benchmark_authored: boolean;
  readonly reconstructed_or_backfilled: boolean;
  readonly explicit_ruled_out: boolean;
  readonly explicit_reason: boolean;
  readonly scope_recoverable: boolean;
  readonly lifecycle_recoverable: boolean;
  readonly authorized_repository: boolean;
  readonly authority: AuthorityTier;
  readonly a0_failures: readonly A0FailureCode[];
  /** Metadata. It never appears in `authority` and never excludes. */
  readonly independent_corroboration: boolean;
  readonly corroboration_decidable: boolean;
  readonly corroboration_sources: readonly string[];
  readonly authority_strength: "A0" | "A1" | "none";
  /** Descriptive only, exactly as in v4. */
  readonly identity_present: boolean;
  readonly record_id: string | null;
}

export interface A0Inputs {
  readonly candidate: V4CandidateEntry;
  readonly cutoff: string;
  readonly authorizedRepositories: readonly string[];
  /** Record ids the study has positively identified as written for a benchmark. */
  readonly benchmarkAuthoredRecordIds: ReadonlySet<string>;
  /** Commits the study has positively identified as benchmark work. */
  readonly benchmarkAuthoredCommits: ReadonlySet<string>;
  /** The commit's subject and touched paths, for the marker scan. */
  readonly commitSubject?: string;
  readonly commitPaths?: readonly string[];
}

/**
 * `reconstructed` and `migrated` are the product's own words for a record that
 * tooling minted rather than a person writing it when the decision was made.
 * ADR-0014 refuses that identity and so does this.
 */
const isReconstructed = (candidate: V4CandidateEntry): boolean =>
  candidate.provenance_value === "reconstructed" || candidate.provenance_value === "migrated";

/**
 * A0, decided from immutable evidence only.
 *
 * Every check is a fact about the frozen history. None of them asks whether the
 * decision is written anywhere else, and none may be added later that does.
 */
export const classifyA0 = (inputs: A0Inputs): {
  readonly failures: A0FailureCode[];
  readonly fields: Omit<AuthorityAuditEntry, "schema_version" | "study_id" | "independent_corroboration" | "corroboration_decidable" | "corroboration_sources" | "authority_strength">;
} => {
  const { candidate, cutoff } = inputs;
  const failures: A0FailureCode[] = [];

  const recordedAt = candidate.recorded_at;
  // A record with no readable timestamp cannot be shown to predate the cutoff,
  // and "probably before" is not evidence.
  const preCutoff = recordedAt !== null && Date.parse(recordedAt) <= Date.parse(cutoff);
  if (!preCutoff) failures.push("post-cutoff");

  // The census reads only the materialized frozen bundle, so presence is
  // structural. It is still recorded rather than assumed, because a future
  // caller could enumerate from somewhere else.
  const inSnapshot = candidate.pre_cutoff;
  if (!inSnapshot) failures.push("record-absent-from-snapshot");

  const benchmarkAuthored =
    (candidate.record_id !== null && inputs.benchmarkAuthoredRecordIds.has(candidate.record_id)) ||
    inputs.benchmarkAuthoredCommits.has(candidate.source_commit_sha) ||
    looksBenchmarkAuthored(inputs.commitSubject ?? "", inputs.commitPaths ?? candidate.path_scope);
  if (benchmarkAuthored) failures.push("benchmark-authored");

  const reconstructed = isReconstructed(candidate);
  if (reconstructed) failures.push("backfilled-or-reconstructed");

  // The enumerator only emits a candidate when a ruled-out alternative and its
  // reason both parsed, so these are true by construction and recorded as
  // evidence rather than re-derived from text this module cannot see.
  const explicitRuledOut = candidate.decision_sha256 !== "";
  const explicitReason = candidate.reason_sha256 !== "" && candidate.reason_chars > 0;
  if (!explicitReason) failures.push("reason-not-explicit");

  const scopeRecoverable = candidate.path_scope.length > 0;
  if (!scopeRecoverable) failures.push("scope-unresolvable");

  const lifecycleRecoverable = candidate.lifecycle === "active" || candidate.lifecycle === "superseded" || candidate.lifecycle === "withdrawn";
  if (!lifecycleRecoverable) failures.push("lifecycle-unresolvable");

  const authorized = inputs.authorizedRepositories.includes(candidate.repository_id);
  if (!authorized) failures.push("unauthorized-repository");

  return {
    failures,
    fields: {
      candidate_id: candidate.candidate_id,
      repository_id: candidate.repository_id,
      source_commit_sha: candidate.source_commit_sha,
      decision_audit_anchor: candidate.decision_audit_anchor,
      recorded_at: recordedAt,
      pre_cutoff: preCutoff,
      in_frozen_snapshot: inSnapshot,
      ordinary_development_origin: !benchmarkAuthored && !reconstructed,
      benchmark_authored: benchmarkAuthored,
      reconstructed_or_backfilled: reconstructed,
      explicit_ruled_out: explicitRuledOut,
      explicit_reason: explicitReason,
      scope_recoverable: scopeRecoverable,
      lifecycle_recoverable: lifecycleRecoverable,
      authorized_repository: authorized,
      authority: failures.length === 0 ? "A0" : "none",
      a0_failures: failures,
      identity_present: candidate.identity_present,
      record_id: candidate.record_id,
    },
  };
};

/**
 * The guard that keeps A1 out of admission.
 *
 * The v4 gate could come back as a line of code that reads
 * `if (!independent_corroboration) exclude`. This refuses an audit in which
 * corroboration and authority move together, which is what that line would look
 * like from the outside.
 */
export const assertCorroborationIsNotAGate = (entries: readonly AuthorityAuditEntry[]): void => {
  const a0 = entries.filter((entry) => entry.authority === "A0");
  if (a0.length === 0) return;
  const withoutCorroboration = a0.filter((entry) => !entry.independent_corroboration);
  if (withoutCorroboration.length === 0) {
    throw new Error(
      `authority v5: every one of the ${String(a0.length)} A0 candidates is also corroborated, so this audit cannot show that corroboration is not gating admission`,
    );
  }
  const excludedForCorroboration = entries.filter(
    (entry) => entry.authority !== "A0" && entry.a0_failures.length === 0,
  );
  if (excludedForCorroboration.length > 0) {
    throw new Error(
      `authority v5: ${String(excludedForCorroboration.length)} candidate(s) lost A0 without naming an A0 failure; corroboration or something like it is gating admission`,
    );
  }
};

export interface CorroborationHit {
  readonly kind: "pull-request" | "issue" | "adr" | "ordinary-prose" | "design-doc" | "code-comment" | "test-rationale";
  readonly locator: string;
}

/**
 * Attaches A1 metadata. Authority is passed through untouched -- this function
 * cannot change it, which is the point.
 */
export const attachCorroboration = (
  fields: ReturnType<typeof classifyA0>["fields"],
  hits: readonly CorroborationHit[],
  decidable = true,
): AuthorityAuditEntry => ({
  schema_version: 1,
  study_id: "cdeb-fresh-v5",
  ...fields,
  independent_corroboration: decidable && hits.length > 0,
  corroboration_decidable: decidable,
  corroboration_sources: hits.map((hit) => `${hit.kind}:${hit.locator}`),
  authority_strength: fields.authority === "A0" ? (decidable && hits.length > 0 ? "A1" : "A0") : "none",
});

/**
 * Whether a commit is benchmark work rather than ordinary development.
 *
 * This is the one A0 condition that is not satisfied by how the census builds
 * its input, so it is the one that has to be able to fail. It reads the commit's
 * own paths and subject: a decision recorded by a commit that touches a
 * benchmark tree, or announces itself as benchmark work, is not ordinary
 * development history however natural its wording.
 */
export const BENCHMARK_PATH_MARKERS = ["bench/", "benchmark/", "cdeb"] as const;
export const BENCHMARK_SUBJECT_MARKERS = ["cdeb", "benchmark corpus", "benchmark task", "study corpus"] as const;

export const looksBenchmarkAuthored = (subject: string, paths: readonly string[]): boolean => {
  const lowerSubject = subject.toLowerCase();
  if (BENCHMARK_SUBJECT_MARKERS.some((marker) => lowerSubject.includes(marker))) return true;
  return paths.some((path) => {
    const lower = path.toLowerCase();
    return BENCHMARK_PATH_MARKERS.some((marker) => lower.includes(marker));
  });
};

/**
 * Says which A0 conditions could have failed on this corpus and which were true
 * for every candidate.
 *
 * A gate that passes everything is not evidence until someone has checked
 * whether it could have done anything else. Reporting 241 of 241 without this
 * would present a structural certainty as a measurement.
 */
export const a0Discrimination = (
  entries: readonly AuthorityAuditEntry[],
): { condition: string; failed: number; inert: boolean }[] => {
  const conditions: { condition: string; failed: (entry: AuthorityAuditEntry) => boolean }[] = [
    { condition: "pre_cutoff", failed: (entry) => !entry.pre_cutoff },
    { condition: "in_frozen_snapshot", failed: (entry) => !entry.in_frozen_snapshot },
    { condition: "not_benchmark_authored", failed: (entry) => entry.benchmark_authored },
    { condition: "not_reconstructed_or_backfilled", failed: (entry) => entry.reconstructed_or_backfilled },
    { condition: "explicit_reason", failed: (entry) => !entry.explicit_reason },
    { condition: "scope_recoverable", failed: (entry) => !entry.scope_recoverable },
    { condition: "lifecycle_recoverable", failed: (entry) => !entry.lifecycle_recoverable },
    { condition: "authorized_repository", failed: (entry) => !entry.authorized_repository },
  ];
  return conditions.map(({ condition, failed }) => {
    const count = entries.filter(failed).length;
    return { condition, failed: count, inert: count === 0 };
  });
};

export interface AuthoritySummary {
  readonly repository_id: string;
  readonly raw_decisions: number;
  readonly a0: number;
  readonly a1: number;
  readonly a0_only: number;
  readonly identified: number;
  readonly id_less: number;
  readonly a0_failures: Readonly<Record<string, number>>;
}

export const summarizeAuthority = (entries: readonly AuthorityAuditEntry[]): AuthoritySummary[] => {
  const byRepository = new Map<string, AuthorityAuditEntry[]>();
  for (const entry of entries) {
    const list = byRepository.get(entry.repository_id) ?? [];
    list.push(entry);
    byRepository.set(entry.repository_id, list);
  }
  return [...byRepository.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([repository_id, list]) => {
      const a0 = list.filter((entry) => entry.authority === "A0");
      const failures: Record<string, number> = {};
      for (const entry of list) {
        for (const code of entry.a0_failures) failures[code] = (failures[code] ?? 0) + 1;
      }
      return {
        repository_id,
        raw_decisions: list.length,
        a0: a0.length,
        a1: a0.filter((entry) => entry.independent_corroboration).length,
        a0_only: a0.filter((entry) => !entry.independent_corroboration).length,
        identified: list.filter((entry) => entry.identity_present).length,
        id_less: list.filter((entry) => !entry.identity_present).length,
        a0_failures: Object.fromEntries(Object.entries(failures).sort(([, a], [, b]) => b - a)),
      };
    });
};

export const authorityDigest = (entries: readonly AuthorityAuditEntry[]): string =>
  createHash("sha256").update(entries.map((entry) => `${entry.candidate_id}:${entry.authority}`).join("\n"), "utf8").digest("hex");
