/**
 * CDEB-10 candidate enumeration (PRD §3.1–§3.2).
 *
 * This is deliberately an enumerator, not a corpus selector. It reads records
 * through `runQuery`, the same query path the product ships, applies only
 * mechanical facts, and leaves the task-qualification calls as `undecided`.
 * A later freeze may consume this registry, but must not promote an undecided
 * entry merely because the quota is short.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { dump } from "js-yaml";

// This is the compiled shipping surface. The registry does not parse git
// trailers itself: it asks exactly the query engine the product delivers.
import { execGit } from "../../../dist/core/git.js";
import {
  RULED_OUT_KEY,
  runQuery,
  valuesOf,
  type GradedRecord,
} from "../../../dist/core/query.js";
import { splitRuledOut } from "../../../dist/core/trailers.js";

export type EligibilityValue = true | false | "undecided";

export interface CandidateEligibility {
  readonly explicit_rejection_reason: EligibilityValue;
  readonly wrong_path_functionally_viable: EligibilityValue;
  readonly deterministic_oracle_possible: EligibilityValue;
  readonly current_code_does_not_reveal_reason: EligibilityValue;
  readonly bounded_implementation: EligibilityValue;
}

/** One §3.2 registry row. The key order is also the canonical YAML order. */
export interface CandidateRegistryEntry {
  readonly schema_version: 1;
  readonly benchmark: "cdeb-v1";
  readonly candidate_id: string;
  readonly repository_id: string;
  /** A real Record-Id, or a transparent source token when the input had none. */
  readonly record_ids: readonly string[];
  readonly decision_source_refs: readonly string[];
  readonly record_commit_or_note_ref: string;
  readonly record_created_at: string;
  readonly natural_record: EligibilityValue;
  readonly benchmark_authored: EligibilityValue;
  readonly eligibility: CandidateEligibility;
  readonly review_status: "accepted" | "rejected";
  readonly rejection_reason: string | null;
}

export type RejectionCode =
  | "after_snapshot_cutoff"
  | "missing_explicit_rejection_reason"
  | "invalid_record_identity"
  | "synthetic_or_backfilled_record"
  | "benchmark_authored_record"
  | "commitlore_repository"
  | "notes_cutoff_undecidable"
  | "source_authorization_unverified"
  | "human_review_required";

export interface CandidateRegistryCensus {
  readonly records_examined: number;
  readonly candidates_reported: number;
  readonly eligible: number;
  readonly rejected: number;
  readonly blocked_on_human_review: number;
  readonly rejection_reasons: Readonly<Record<RejectionCode, number>>;
  readonly undecided_fields: Readonly<Record<string, number>>;
}

export interface CandidateRegistryResult {
  readonly candidates: readonly CandidateRegistryEntry[];
  readonly census: CandidateRegistryCensus;
}

export interface CandidateRegistryOptions {
  /** Repository whose history `runQuery` reads. Defaults to the current directory. */
  readonly cwd?: string;
  /** Stable CDEB repository name, not a filesystem path. */
  readonly repositoryId: string;
  /** Frozen §6.1 snapshot commit or ref. Every commit record must reach it. */
  readonly snapshotRef: string;
  /**
   * An explicit assertion for callers that know this is the product repository.
   * Omitted means the registry detects the repository id and package name.
   */
  readonly commitLoreRepository?: boolean;
  /** Record ids a human has already established were created for CDEB. */
  readonly benchmarkAuthoredRecordIds?: readonly string[];
  /**
   * The authorization boundary for an upstream fork. When set, a source record
   * must have one author in this allowlist. An empty allowlist is intentionally
   * not treated as authorization.
   */
  readonly authorizedDecisionAuthors?: readonly string[];
  readonly requireAuthorizedDecisionAuthor?: boolean;
}

type UndecidedField =
  | "natural_record"
  | "benchmark_authored"
  | keyof CandidateEligibility;

const REJECTION_TEXT: Readonly<Record<RejectionCode, string>> = {
  after_snapshot_cutoff: "record declaration is after the frozen snapshot cutoff",
  missing_explicit_rejection_reason: "record lacks an explicit Ruled-out alternative and rejection reason",
  invalid_record_identity: "record has no valid Record-Id",
  synthetic_or_backfilled_record: "record provenance is reconstructed, so it is synthetic or backfilled",
  benchmark_authored_record: "record is identified as benchmark-authored",
  commitlore_repository: "CommitLore repository decisions are excluded from the primary corpus",
  notes_cutoff_undecidable:
    "notes-only record creation cannot be placed at the commit snapshot without a frozen notes reference",
  source_authorization_unverified:
    "decision-source author is not covered by the supplied source authorization",
  human_review_required: "human review is required for undecided eligibility fields",
};

const EMPTY_REJECTION_COUNTS = (): Record<RejectionCode, number> => ({
  after_snapshot_cutoff: 0,
  missing_explicit_rejection_reason: 0,
  invalid_record_identity: 0,
  synthetic_or_backfilled_record: 0,
  benchmark_authored_record: 0,
  commitlore_repository: 0,
  notes_cutoff_undecidable: 0,
  source_authorization_unverified: 0,
  human_review_required: 0,
});

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const sourceToken = (record: GradedRecord): string => {
  const trailerDigest = sha256(
    record.trailers.map((trailer) => `${trailer.key}\u0000${trailer.value}`).join("\u0001"),
  ).slice(0, 12);
  return `unidentified:${record.source}:${record.sha}:${trailerDigest}`;
};

const validRecordId = (value: string | undefined): value is string =>
  value !== undefined && /^r-[a-z0-9]{6,}$/.test(value);

const candidateIdFor = (record: GradedRecord): string =>
  validRecordId(record.recordId)
    ? record.recordId
    : `record-${record.sha.slice(0, 12)}-${sha256(sourceToken(record)).slice(0, 12)}`;

const resolveSnapshot = (cwd: string, snapshotRef: string): string => {
  const result = execGit(
    ["rev-parse", "--verify", "--end-of-options", `${snapshotRef}^{commit}`],
    { cwd },
  );
  if (result.code !== 0 || result.stdout.trim() === "") {
    throw new Error(`candidate registry: snapshot ref ${JSON.stringify(snapshotRef)} is not a commit`);
  }
  return result.stdout.trim();
};

const isAncestor = (cwd: string, ancestor: string, descendant: string): boolean => {
  const result = execGit(["merge-base", "--is-ancestor", ancestor, descendant], { cwd });
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw new Error(
    `candidate registry: could not compare ${ancestor} with snapshot ${descendant}: ${result.stderr.trim()}`,
  );
};

const authorOf = (cwd: string, ref: string): string | null => {
  const result = execGit(["show", "-s", "--format=%an <%ae>", "--end-of-options", ref], { cwd });
  return result.code === 0 && result.stdout.trim() !== "" ? result.stdout.trim() : null;
};

const committedAt = (cwd: string, ref: string): string | null => {
  const result = execGit(["show", "-s", "--format=%cI", "--end-of-options", ref], { cwd });
  return result.code === 0 && result.stdout.trim() !== "" ? result.stdout.trim() : null;
};

const isCommitLoreRepository = (cwd: string, repositoryId: string, explicit: boolean | undefined): boolean => {
  if (explicit !== undefined) return explicit;
  if (repositoryId === "commitlore") return true;
  const packagePath = resolve(cwd, "package.json");
  if (!existsSync(packagePath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown };
    return parsed.name === "commitlore";
  } catch {
    return false;
  }
};

const hasExplicitRejectionReason = (record: GradedRecord): boolean =>
  valuesOf(record, RULED_OUT_KEY).some((value) => {
    const ruledOut = splitRuledOut(value);
    return (
      !ruledOut.malformed &&
      !ruledOut.unterminatedCodeSpan &&
      ruledOut.alternative !== "" &&
      ruledOut.reason !== ""
    );
  });

const recordAuthorsAreAuthorized = (
  cwd: string,
  record: GradedRecord,
  allowed: ReadonlySet<string>,
): boolean =>
  record.shas.some((sha) => {
    const author = authorOf(cwd, sha);
    return author !== null && allowed.has(author);
  });

const hasUndecidedField = (entry: Pick<CandidateRegistryEntry, "natural_record" | "benchmark_authored" | "eligibility">): boolean =>
  entry.natural_record === "undecided" ||
  entry.benchmark_authored === "undecided" ||
  Object.values(entry.eligibility).some((value) => value === "undecided");

const compareCandidate = (left: CandidateRegistryEntry, right: CandidateRegistryEntry): number => {
  if (left.candidate_id !== right.candidate_id) {
    return left.candidate_id < right.candidate_id ? -1 : 1;
  }
  const leftSource = left.record_commit_or_note_ref;
  const rightSource = right.record_commit_or_note_ref;
  return leftSource < rightSource ? -1 : leftSource > rightSource ? 1 : 0;
};

interface AssessedCandidate {
  readonly entry: CandidateRegistryEntry;
  readonly rejectionCodes: readonly RejectionCode[];
}

const assessRecord = (
  record: GradedRecord,
  cwd: string,
  options: Required<Pick<CandidateRegistryOptions, "repositoryId" | "snapshotRef">> & CandidateRegistryOptions,
  snapshot: string,
  commitLoreRepository: boolean,
  benchmarkAuthored: ReadonlySet<string>,
  authorizedAuthors: ReadonlySet<string>,
): AssessedCandidate => {
  const recordId = record.recordId;
  const recordIdIsValid = validRecordId(recordId);
  const id = recordIdIsValid ? recordId : sourceToken(record);
  const benchmarkAuthoredRecord = recordIdIsValid && benchmarkAuthored.has(recordId);
  const reconstructed = record.provenance?.kind === "reconstructed";
  const references = record.shas.length > 0 ? record.shas : [record.sha];
  // A re-declaration after the cutoff does not erase an earlier record with
  // the same identity. `runQuery` already blocks divergent identities; here
  // we ask the §3.1 question literally: did this record exist by the snapshot?
  const referencesAtSnapshot = references.filter((ref) => isAncestor(cwd, ref, snapshot));
  const afterSnapshot = referencesAtSnapshot.length === 0;
  const notesOnly = record.sources.length === 1 && record.sources[0] === "notes";
  const recordRef = notesOnly ? record.sha : (referencesAtSnapshot[0] ?? references[0] ?? record.sha);
  const requiresAuthorizedAuthor = options.requireAuthorizedDecisionAuthor === true;
  const authorizationVerified =
    !requiresAuthorizedAuthor ||
    (authorizedAuthors.size > 0 && recordAuthorsAreAuthorized(cwd, record, authorizedAuthors));

  const eligibility: CandidateEligibility = {
    explicit_rejection_reason: hasExplicitRejectionReason(record),
    wrong_path_functionally_viable: "undecided",
    deterministic_oracle_possible: "undecided",
    current_code_does_not_reveal_reason: "undecided",
    bounded_implementation: "undecided",
  };
  const natural_record: EligibilityValue =
    reconstructed || benchmarkAuthoredRecord ? false : "undecided";
  const benchmark_authored: EligibilityValue = benchmarkAuthoredRecord ? true : "undecided";
  const rejectionCodes: RejectionCode[] = [];
  if (afterSnapshot) rejectionCodes.push("after_snapshot_cutoff");
  if (!eligibility.explicit_rejection_reason) rejectionCodes.push("missing_explicit_rejection_reason");
  if (!recordIdIsValid) rejectionCodes.push("invalid_record_identity");
  if (reconstructed) rejectionCodes.push("synthetic_or_backfilled_record");
  if (benchmarkAuthoredRecord) rejectionCodes.push("benchmark_authored_record");
  if (commitLoreRepository) rejectionCodes.push("commitlore_repository");
  if (notesOnly) rejectionCodes.push("notes_cutoff_undecidable");
  if (!authorizationVerified) rejectionCodes.push("source_authorization_unverified");

  const provisional: Omit<CandidateRegistryEntry, "review_status" | "rejection_reason"> = {
    schema_version: 1,
    benchmark: "cdeb-v1",
    candidate_id: candidateIdFor(record),
    repository_id: options.repositoryId,
    record_ids: [id],
    decision_source_refs: references,
    record_commit_or_note_ref: notesOnly ? `refs/notes/commitlore:${record.sha}` : recordRef,
    record_created_at: recordRef === record.sha ? record.committedAt : (committedAt(cwd, recordRef) ?? record.committedAt),
    natural_record,
    benchmark_authored,
    eligibility,
  };
  if (hasUndecidedField(provisional)) rejectionCodes.push("human_review_required");

  const review_status = rejectionCodes.length === 0 ? "accepted" : "rejected";
  return {
    entry: {
      ...provisional,
      review_status,
      rejection_reason:
        review_status === "accepted"
          ? null
          : rejectionCodes.map((code) => REJECTION_TEXT[code]).join("; "),
    },
    rejectionCodes,
  };
};

/**
 * Enumerates every record visible through the product query path. No model,
 * ON/OFF run, path heuristic, or task selection is involved.
 */
export const enumerateCandidateRegistry = (
  options: CandidateRegistryOptions,
): CandidateRegistryResult => {
  const cwd = options.cwd ?? process.cwd();
  const snapshot = resolveSnapshot(cwd, options.snapshotRef);
  // `allHistory` preserves superseded candidates too; §3.4 deliberately has a
  // lifecycle category, so the query's normal active-only display would be a
  // selection decision hidden in the enumerator.
  const queried = runQuery({
    cwd,
    allHistory: true,
    // A fixed far-future instant keeps future-dated fixture commits visible and
    // makes enumeration independent of the wall clock.
    at: new Date("9999-12-31T23:59:59.999Z"),
  });
  if (queried.history !== "ready") {
    throw new Error(
      `candidate registry: repository history is ${queried.history}; enumeration cannot treat that as an empty corpus`,
    );
  }

  const commitLoreRepository = isCommitLoreRepository(cwd, options.repositoryId, options.commitLoreRepository);
  const benchmarkAuthored = new Set(options.benchmarkAuthoredRecordIds ?? []);
  const authorizedAuthors = new Set(options.authorizedDecisionAuthors ?? []);
  const assessed = queried.records.map((record) =>
    assessRecord(record, cwd, options, snapshot, commitLoreRepository, benchmarkAuthored, authorizedAuthors),
  );
  const candidates = assessed.map(({ entry }) => entry).sort(compareCandidate);
  const rejectionReasons = EMPTY_REJECTION_COUNTS();
  const undecidedFields: Record<UndecidedField, number> = {
    natural_record: 0,
    benchmark_authored: 0,
    explicit_rejection_reason: 0,
    wrong_path_functionally_viable: 0,
    deterministic_oracle_possible: 0,
    current_code_does_not_reveal_reason: 0,
    bounded_implementation: 0,
  };
  for (const assessedCandidate of assessed) {
    for (const code of assessedCandidate.rejectionCodes) rejectionReasons[code] += 1;
    const entry = assessedCandidate.entry;
    if (entry.natural_record === "undecided") undecidedFields.natural_record += 1;
    if (entry.benchmark_authored === "undecided") undecidedFields.benchmark_authored += 1;
    for (const field of Object.keys(entry.eligibility) as (keyof CandidateEligibility)[]) {
      if (entry.eligibility[field] === "undecided") undecidedFields[field] += 1;
    }
  }

  return {
    candidates,
    census: {
      records_examined: queried.records.length,
      candidates_reported: candidates.length,
      eligible: candidates.filter((candidate) => candidate.review_status === "accepted").length,
      rejected: candidates.filter((candidate) => candidate.review_status === "rejected").length,
      blocked_on_human_review: candidates.filter(hasUndecidedField).length,
      rejection_reasons: rejectionReasons,
      undecided_fields: undecidedFields,
    },
  };
};

/** Canonical YAML for a registry: a document list of exactly the §3.2 rows. */
export const serializeCandidateRegistry = (registry: CandidateRegistryResult): string =>
  dump(registry.candidates, {
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  });

/** Human-readable audit census, deterministic in both field and reason order. */
export const formatCandidateCensus = (census: CandidateRegistryCensus): string => {
  const lines = [
    `records examined: ${String(census.records_examined)}`,
    `candidates reported: ${String(census.candidates_reported)}`,
    `eligible: ${String(census.eligible)}`,
    `rejected: ${String(census.rejected)}`,
    `blocked on human review: ${String(census.blocked_on_human_review)}`,
    "disqualified:",
  ];
  for (const code of Object.keys(EMPTY_REJECTION_COUNTS()) as RejectionCode[]) {
    lines.push(`  ${code}: ${String(census.rejection_reasons[code])}`);
  }
  lines.push("undecided:");
  for (const [field, count] of Object.entries(census.undecided_fields)) {
    lines.push(`  ${field}: ${String(count)}`);
  }
  return `${lines.join("\n")}\n`;
};

interface CliOptions {
  cwd?: string;
  output?: string;
  repositoryId?: string;
  snapshotRef?: string;
  commitLoreRepository?: boolean;
  benchmarkAuthoredRecordIds: string[];
  authorizedDecisionAuthors: string[];
  requireAuthorizedDecisionAuthor?: boolean;
}

const usage = (): string =>
  [
    "usage: node --experimental-strip-types bench/cdeb/freeze/candidate-registry.ts \\",
    "  --repository-id <id> --snapshot-ref <commit-or-ref> [--cwd <repo>] [--output <registry.yaml>] \\",
    "  [--commitlore-repository] [--benchmark-authored-record-id <record-id>] \\",
    "  [--require-authorized-decision-author --authorized-decision-author <name <email>>]",
  ].join("\n");

const requiredValue = (argv: readonly string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
};

const parseCli = (argv: readonly string[]): CliOptions => {
  const options: CliOptions = {
    benchmarkAuthoredRecordIds: [],
    authorizedDecisionAuthors: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--cwd":
        options.cwd = requiredValue(argv, index, arg);
        index += 1;
        break;
      case "--output":
        options.output = requiredValue(argv, index, arg);
        index += 1;
        break;
      case "--repository-id":
        options.repositoryId = requiredValue(argv, index, arg);
        index += 1;
        break;
      case "--snapshot-ref":
        options.snapshotRef = requiredValue(argv, index, arg);
        index += 1;
        break;
      case "--commitlore-repository":
        options.commitLoreRepository = true;
        break;
      case "--benchmark-authored-record-id":
        options.benchmarkAuthoredRecordIds.push(requiredValue(argv, index, arg));
        index += 1;
        break;
      case "--require-authorized-decision-author":
        options.requireAuthorizedDecisionAuthor = true;
        break;
      case "--authorized-decision-author":
        options.authorizedDecisionAuthors.push(requiredValue(argv, index, arg));
        index += 1;
        break;
      case "--help":
      case "-h":
        throw new Error(usage());
      default:
        throw new Error(`unknown argument ${JSON.stringify(arg)}\n${usage()}`);
    }
  }
  if (options.repositoryId === undefined || options.snapshotRef === undefined) {
    throw new Error(`--repository-id and --snapshot-ref are required\n${usage()}`);
  }
  return options;
};

const isMain = (): boolean =>
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain()) {
  try {
    const options = parseCli(process.argv.slice(2));
    const registryOptions: CandidateRegistryOptions = {
      repositoryId: options.repositoryId!,
      snapshotRef: options.snapshotRef!,
      benchmarkAuthoredRecordIds: options.benchmarkAuthoredRecordIds,
      authorizedDecisionAuthors: options.authorizedDecisionAuthors,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.commitLoreRepository === undefined
        ? {}
        : { commitLoreRepository: options.commitLoreRepository }),
      ...(options.requireAuthorizedDecisionAuthor === undefined
        ? {}
        : { requireAuthorizedDecisionAuthor: options.requireAuthorizedDecisionAuthor }),
    };
    const registry = enumerateCandidateRegistry(registryOptions);
    const yaml = serializeCandidateRegistry(registry);
    if (options.output === undefined) process.stdout.write(yaml);
    else writeFileSync(options.output, yaml, "utf8");
    process.stderr.write(formatCandidateCensus(registry.census));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
