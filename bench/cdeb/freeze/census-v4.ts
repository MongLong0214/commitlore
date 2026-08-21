/**
 * CDEB-Fresh v4 Stage 0 candidate census.
 *
 * A fresh enumeration, not a re-read of the predecessor's. Two things separate
 * it from `census.ts`:
 *
 *  - A missing `Record-Id` is never an exclusion. The owner's estimand decision
 *    is that the study measures delivery of a prior repository decision, so
 *    identity is descriptive metadata (`identity_present`) and nothing more.
 *  - The unit is a decision, not a record. One commit can rule out three
 *    alternatives for three different reasons, and each is a separate judgment
 *    an agent could revive. Both counts are reported so the change in unit is
 *    visible rather than showing up as growth.
 *
 * Everything here is mechanical. The judgment gates -- hidden rationale,
 * wrong-path viability, oracle feasibility, delivery feasibility -- stay
 * `pending` and are decided by the adjudicated review stages, never here.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execGit } from "../../../dist/core/git.js";
import {
  RULED_OUT_KEY,
  runQuery,
  valuesOf,
  type GradedRecord,
} from "../../../dist/core/query.js";
import { splitRuledOut } from "../../../dist/core/trailers.js";

import {
  computeDecisionAnchor,
  decisionTextSha256,
  type DecisionLifecycle,
  type StorageKind,
} from "./decision-anchor.ts";
import { materializeBundle, type RepositoryBundleIdentity } from "./repository-bundle.ts";

export const V4_STUDY_ID = "cdeb-fresh-v4";

export interface SnapshotEntry {
  readonly repository_id: string;
  readonly snapshot_sha: string;
  readonly bundle_path: string;
  readonly bundle_sha256: string;
  readonly snapshot_commit: string;
  readonly snapshot_tree_oid: string;
  readonly refs_included: readonly string[];
  readonly refs_digest: string;
  readonly notes_refs_included: boolean;
  readonly notes_ref_digest: string;
  readonly source_authorization_id: string;
}

export interface LegacyExclusionEntry {
  readonly kind: string;
  readonly value: string;
  readonly reason: string;
}

/** Mechanical exclusions only. Nothing here encodes a judgment call. */
export const V4_MECHANICAL_CODES = [
  "reason-not-explicit",
  "legacy-exclusion-match",
  "commitlore-repository",
  "after-snapshot-cutoff",
  "benchmark-authored",
] as const;
export type V4MechanicalCode = (typeof V4_MECHANICAL_CODES)[number];

export interface V4CandidateEntry {
  readonly schema_version: 1;
  readonly study_id: typeof V4_STUDY_ID;
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly snapshot_sha: string;
  readonly source_commit_sha: string;
  readonly source_refs: readonly string[];
  readonly storage_kind: StorageKind;
  readonly storage_locator: string;
  readonly decision_ordinal: number;
  readonly sibling_decision_count: number;
  readonly decision_audit_anchor: string;
  /** Descriptive metadata. It never votes on qualification. */
  readonly identity_present: boolean;
  readonly record_id: string | null;
  readonly protocol_version: string | null;
  readonly provenance_value: string | null;
  readonly lifecycle: DecisionLifecycle;
  readonly path_scope: readonly string[];
  readonly decision_sha256: string;
  readonly reason_sha256: string;
  readonly reason_chars: number;
  readonly recorded_at: string | null;
  readonly pre_cutoff: boolean;
  readonly qualification_status: "pending" | "qualified" | "ineligible";
  readonly ineligibility_codes: readonly V4MechanicalCode[];
  readonly pending_gates: readonly string[];
}

export interface V4RepositoryCensus {
  readonly repository_id: string;
  readonly records_examined: number;
  readonly records_with_explicit_reason: number;
  readonly decisions_enumerated: number;
  readonly decisions_in_record_blocks: number;
  readonly decisions_in_ordinary_source: number;
  readonly potential_source_decision_pool: number;
  readonly identity_present: number;
  readonly identity_absent: number;
  readonly mechanically_excluded: number;
  readonly exclusion_reasons: Readonly<Record<V4MechanicalCode, number>>;
  readonly lifecycle_counts: Readonly<Record<DecisionLifecycle, number>>;
  readonly protocol_versions: Readonly<Record<string, number>>;
}

export interface V4CensusResult {
  readonly candidates: readonly V4CandidateEntry[];
  readonly repositories: readonly V4RepositoryCensus[];
}

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

const LIFECYCLES: Readonly<Record<string, DecisionLifecycle>> = {
  active: "active",
  superseded: "superseded",
  withdrawn: "withdrawn",
};

/**
 * A lifecycle this enumerator does not recognise becomes `superseded` in no
 * circumstance -- it throws. Silently mapping an unknown state onto a known one
 * would put a decision in the corpus under a lifecycle nobody asserted.
 */
const lifecycleOf = (record: GradedRecord): DecisionLifecycle => {
  const raw = String(record.lifecycle ?? "active");
  const known = LIFECYCLES[raw];
  if (known === undefined) {
    throw new Error(`census v4: record ${record.sha} has unrecognised lifecycle ${JSON.stringify(raw)}`);
  }
  return known;
};

const trailerValue = (record: GradedRecord, key: string): string | null => {
  const values = valuesOf(record, key);
  return values.length > 0 ? String(values[0]) : null;
};

const storageOf = (record: GradedRecord): { kind: StorageKind; locator: string } =>
  record.source === "notes"
    ? { kind: "git-note", locator: `refs/notes/commitlore:${record.sha}` }
    : { kind: "commit-trailer", locator: `commit:${record.sha}` };

const exclusionKey = (entry: LegacyExclusionEntry): string => `${entry.kind} ${entry.value}`;

/**
 * Every exclusion whose value looks like a record id must be handled by a kind
 * this census actually checks. Without this the index could name a record under
 * a new kind and the census would enumerate it as though it were never excluded
 * -- the exclusion would be recorded and unenforced at the same time.
 */
export const RECORD_EXCLUSION_KINDS = [
  "record-id",
  "candidate-id",
  "benchmark-authored-record",
  "publicly-answer-exposed-decision",
] as const;

/**
 * Matching is on kind and value together: a record id that happens to equal
 * some task id is not a match. The kinds checked are the record-naming ones,
 * kept honest by `assertRecordExclusionKindsCovered`.
 */
const legacyExclusionMatch = (
  entry: { readonly record_id: string | null; readonly source_commit_sha: string },
  index: ReadonlySet<string>,
): boolean =>
  (entry.record_id !== null &&
    RECORD_EXCLUSION_KINDS.some((kind) => index.has(`${kind} ${entry.record_id ?? ""}`))) ||
  index.has(`commit ${entry.source_commit_sha}`);

export const assertRecordExclusionKindsCovered = (
  exclusions: readonly LegacyExclusionEntry[],
): void => {
  const covered = new Set<string>(RECORD_EXCLUSION_KINDS);
  const uncovered = exclusions
    .filter((entry) => /^r-[a-z0-9]{6,}$/.test(entry.value) && !covered.has(entry.kind))
    .map((entry) => `${entry.kind} ${entry.value}`);
  if (uncovered.length > 0) {
    throw new Error(
      `census v4: exclusion index names records under kinds this census does not check: ${[...new Set(uncovered)].sort().join(", ")}`,
    );
  }
};


/**
 * Decisions the product's query cannot see.
 *
 * A record is the final trailer block of a commit message. A squash merge
 * concatenates several bodies, so an earlier body's `Ruled-out:` line ends up
 * as prose in the middle of the message: still a decision a person wrote, still
 * in the repository's history, but not a record.
 *
 * These are enumerated rather than skipped. Whether current shipping can
 * deliver them is a G6 question with an answer worth recording -- deciding it
 * here, at discovery, would hide the attrition inside the word "census".
 */
const readOrdinarySourceDecisions = (
  cwd: string,
  snapshotSha: string,
): { sha: string; alternative: string; reason: string; ordinal: number; committedAt: string | null; paths: string[] }[] => {
  const separator = "\u001f";
  const terminator = "\u001e";
  const result = execGit(["log", `--format=%H${separator}%cI${separator}%B${terminator}`, "--end-of-options", snapshotSha], { cwd });
  if (result.code !== 0) {
    throw new Error(`census v4: could not read commit bodies: ${result.stderr.trim()}`);
  }
  const found: { sha: string; alternative: string; reason: string; ordinal: number; committedAt: string | null; paths: string[] }[] = [];
  for (const chunk of result.stdout.split(terminator)) {
    const parts = chunk.split(separator);
    if (parts.length < 3) continue;
    const sha = parts[0]!.trim();
    const committedAt = parts[1]!.trim() === "" ? null : parts[1]!.trim();
    const body = parts.slice(2).join(separator);
    const paragraphs = body.trim().split(/\n\s*\n/).filter((paragraph) => paragraph.trim() !== "");
    const finalBlock = paragraphs.length > 0 ? paragraphs[paragraphs.length - 1]! : "";
    const inFinal = new Set(finalBlock.split("\n").filter((line) => line.startsWith("Ruled-out:")));
    // Unfold: a trailer value continues on indented lines beneath it.
    const lines = body.split("\n");
    let ordinal = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!line.startsWith("Ruled-out:")) continue;
      if (inFinal.has(line)) continue;
      let value = line.slice("Ruled-out:".length).trim();
      for (let next = index + 1; next < lines.length; next += 1) {
        const continuation = lines[next]!;
        if (!/^\s+\S/.test(continuation)) break;
        value = `${value} ${continuation.trim()}`;
      }
      const split = splitRuledOut(value);
      if (split.malformed || split.alternative === "" || split.reason === "") continue;
      const names = execGit(["show", "--pretty=format:", "--name-only", "--end-of-options", sha], { cwd });
      const paths = names.code === 0 ? [...new Set(names.stdout.split("\n").map((path) => path.trim()).filter((path) => path !== ""))].sort() : [];
      found.push({ sha, alternative: split.alternative, reason: split.reason, ordinal, committedAt, paths });
      ordinal += 1;
    }
  }
  return found;
};

const candidateIdFor = (anchor: string): string => `v4-${anchor.slice(0, 16)}`;

export interface EnumerateRepositoryOptions {
  readonly cwd: string;
  readonly snapshot: SnapshotEntry;
  readonly exclusionIndex: ReadonlySet<string>;
  readonly benchmarkAuthoredRecordIds?: ReadonlySet<string>;
  readonly commitLoreRepository?: boolean;
}

const emptyExclusionCounts = (): Record<V4MechanicalCode, number> => ({
  "reason-not-explicit": 0,
  "legacy-exclusion-match": 0,
  "commitlore-repository": 0,
  "after-snapshot-cutoff": 0,
  "benchmark-authored": 0,
});

/** The gates the census deliberately leaves undecided (preregistration §4). */
export const PENDING_GATES = ["G2", "G3", "G4", "G5", "G6", "G7"] as const;

export const enumerateRepositoryDecisions = (
  options: EnumerateRepositoryOptions,
): { readonly candidates: V4CandidateEntry[]; readonly census: V4RepositoryCensus } => {
  const { cwd, snapshot } = options;
  const queried = runQuery({
    cwd,
    // Superseded and withdrawn decisions are part of the universe: lifecycle is
    // a field the study reports, not a filter the enumerator applies.
    allHistory: true,
    at: new Date("9999-12-31T23:59:59.999Z"),
  });
  if (queried.history !== "ready") {
    throw new Error(
      `census v4: ${snapshot.repository_id} history is ${queried.history}; that is unknown, not empty`,
    );
  }

  const benchmarkAuthored = options.benchmarkAuthoredRecordIds ?? new Set<string>();
  const candidates: V4CandidateEntry[] = [];
  const exclusionReasons = emptyExclusionCounts();
  const lifecycleCounts: Record<DecisionLifecycle, number> = { active: 0, superseded: 0, withdrawn: 0 };
  const protocolVersions: Record<string, number> = {};
  let recordsWithExplicitReason = 0;
  let identityPresent = 0;

  for (const record of queried.records) {
    const ruledOut = valuesOf(record, RULED_OUT_KEY)
      .map((value) => splitRuledOut(String(value)))
      .filter((value) => !value.malformed && value.alternative !== "" && value.reason !== "");
    if (ruledOut.length === 0) continue;
    recordsWithExplicitReason += 1;

    const recordId = typeof record.recordId === "string" && record.recordId !== "" ? record.recordId : null;
    const lifecycle = lifecycleOf(record);
    const protocolVersion = trailerValue(record, "CommitLore-Version");
    const pathScope = [...new Set((record.paths ?? []).filter((path) => path !== ""))].sort();
    const storage = storageOf(record);
    if (recordId !== null) identityPresent += 1;

    for (const [ordinal, decision] of ruledOut.entries()) {
      const anchorInput = {
        repository_id: snapshot.repository_id,
        snapshot_sha: snapshot.snapshot_sha,
        source_commit_sha: record.sha,
        storage_kind: storage.kind,
        storage_locator: storage.locator,
        decision_ordinal: ordinal,
        normalized_decision_sha256: decisionTextSha256(decision.alternative),
        normalized_reason_sha256: decisionTextSha256(decision.reason),
        // A record whose commit touched no path still has a scope: the commit
        // itself. Using an empty array would make the anchor refuse it, and
        // dropping the decision would be a silent exclusion.
        path_scope: pathScope.length > 0 ? pathScope : [`commit:${record.sha}`],
        lifecycle,
      };
      const anchor = computeDecisionAnchor(anchorInput);
      const codes: V4MechanicalCode[] = [];
      if (options.commitLoreRepository === true) codes.push("commitlore-repository");
      if (recordId !== null && benchmarkAuthored.has(recordId)) codes.push("benchmark-authored");
      if (legacyExclusionMatch({ record_id: recordId, source_commit_sha: record.sha }, options.exclusionIndex)) {
        codes.push("legacy-exclusion-match");
      }
      candidates.push({
        schema_version: 1,
        study_id: V4_STUDY_ID,
        candidate_id: candidateIdFor(anchor),
        repository_id: snapshot.repository_id,
        snapshot_sha: snapshot.snapshot_sha,
        source_commit_sha: record.sha,
        source_refs: [...(record.shas ?? [record.sha])],
        storage_kind: storage.kind,
        storage_locator: storage.locator,
        decision_ordinal: ordinal,
        sibling_decision_count: ruledOut.length,
        decision_audit_anchor: anchor,
        identity_present: recordId !== null,
        record_id: recordId,
        protocol_version: protocolVersion,
        provenance_value: record.provenanceValue ?? null,
        lifecycle,
        path_scope: anchorInput.path_scope,
        decision_sha256: anchorInput.normalized_decision_sha256,
        reason_sha256: anchorInput.normalized_reason_sha256,
        reason_chars: decision.reason.length,
        recorded_at: record.committedAt ?? null,
        // Structural, not asserted: the materialization is a detached checkout
        // of the frozen snapshot, so every record the query walks is an
        // ancestor of it. materializeBundle refuses any other HEAD.
        pre_cutoff: true,
        qualification_status: codes.length > 0 ? "ineligible" : "pending",
        ineligibility_codes: codes,
        pending_gates: codes.length > 0 ? [] : [...PENDING_GATES],
      });
      for (const code of codes) exclusionReasons[code] += 1;
      lifecycleCounts[lifecycle] += 1;
      const versionKey = protocolVersion ?? "none";
      protocolVersions[versionKey] = (protocolVersions[versionKey] ?? 0) + 1;
    }
  }

  for (const decision of readOrdinarySourceDecisions(cwd, snapshot.snapshot_commit)) {
    const pathScope = decision.paths.length > 0 ? decision.paths : [`commit:${decision.sha}`];
    const anchorInput = {
      repository_id: snapshot.repository_id,
      snapshot_sha: snapshot.snapshot_sha,
      source_commit_sha: decision.sha,
      storage_kind: "ordinary-source" as const,
      storage_locator: `commit-body:${decision.sha}`,
      decision_ordinal: decision.ordinal,
      normalized_decision_sha256: decisionTextSha256(decision.alternative),
      normalized_reason_sha256: decisionTextSha256(decision.reason),
      path_scope: pathScope,
      lifecycle: "active" as const,
    };
    const anchor = computeDecisionAnchor(anchorInput);
    const codes: V4MechanicalCode[] = options.commitLoreRepository === true ? ["commitlore-repository"] : [];
    candidates.push({
      schema_version: 1,
      study_id: V4_STUDY_ID,
      candidate_id: candidateIdFor(anchor),
      repository_id: snapshot.repository_id,
      snapshot_sha: snapshot.snapshot_sha,
      source_commit_sha: decision.sha,
      source_refs: [decision.sha],
      storage_kind: "ordinary-source",
      storage_locator: anchorInput.storage_locator,
      decision_ordinal: decision.ordinal,
      sibling_decision_count: 1,
      decision_audit_anchor: anchor,
      identity_present: false,
      record_id: null,
      protocol_version: null,
      provenance_value: null,
      lifecycle: "active",
      path_scope: pathScope,
      decision_sha256: anchorInput.normalized_decision_sha256,
      reason_sha256: anchorInput.normalized_reason_sha256,
      reason_chars: decision.reason.length,
      recorded_at: decision.committedAt,
      pre_cutoff: true,
      qualification_status: codes.length > 0 ? "ineligible" : "pending",
      ineligibility_codes: codes,
      pending_gates: codes.length > 0 ? [] : [...PENDING_GATES],
    });
    for (const code of codes) exclusionReasons[code] += 1;
    lifecycleCounts.active += 1;
    protocolVersions.none = (protocolVersions.none ?? 0) + 1;
  }

  candidates.sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
  const excluded = candidates.filter((candidate) => candidate.qualification_status === "ineligible").length;
  return {
    candidates,
    census: {
      repository_id: snapshot.repository_id,
      records_examined: queried.records.length,
      records_with_explicit_reason: recordsWithExplicitReason,
      decisions_enumerated: candidates.length,
      decisions_in_record_blocks: candidates.filter((candidate) => candidate.storage_kind !== "ordinary-source").length,
      decisions_in_ordinary_source: candidates.filter((candidate) => candidate.storage_kind === "ordinary-source").length,
      potential_source_decision_pool: candidates.length - excluded,
      identity_present: candidates.filter((candidate) => candidate.identity_present).length,
      identity_absent: candidates.filter((candidate) => !candidate.identity_present).length,
      mechanically_excluded: excluded,
      exclusion_reasons: exclusionReasons,
      lifecycle_counts: lifecycleCounts,
      protocol_versions: protocolVersions,
    },
  };
};

const bundleIdentityFor = (snapshot: SnapshotEntry): RepositoryBundleIdentity => ({
  repository_id: snapshot.repository_id,
  snapshot_commit: snapshot.snapshot_commit,
  snapshot_tree_oid: snapshot.snapshot_tree_oid,
  refs_digest: snapshot.refs_digest,
  notes_ref_digest: snapshot.notes_ref_digest,
  bundle_sha256: snapshot.bundle_sha256,
  refs_included: [...snapshot.refs_included],
  notes_refs_included: snapshot.notes_refs_included,
});

const bundlePathFor = (snapshotsPath: string, snapshot: SnapshotEntry): string => {
  if (isAbsolute(snapshot.bundle_path)) {
    throw new Error(`census v4: ${snapshot.repository_id} bundle_path must be relative`);
  }
  const directory = resolve(snapshotsPath, "..");
  const path = resolve(directory, snapshot.bundle_path);
  if (relative(directory, path).startsWith("..")) {
    throw new Error(`census v4: ${snapshot.repository_id} bundle_path escapes the snapshots directory`);
  }
  return path;
};

export interface RunCensusOptions {
  readonly snapshotsPath: string;
  readonly exclusionIndexPath: string;
  readonly benchmarkAuthoredRecordIds?: readonly string[];
}

/** Reads only verified sealed bundles. It never opens a live working repository. */
export const runV4Census = (options: RunCensusOptions): V4CensusResult => {
  const snapshots = JSON.parse(readFileSync(options.snapshotsPath, "utf8")) as {
    repositories: readonly SnapshotEntry[];
  };
  const exclusions = JSON.parse(readFileSync(options.exclusionIndexPath, "utf8")) as {
    exclusions: readonly LegacyExclusionEntry[];
  };
  assertRecordExclusionKindsCovered(exclusions.exclusions);
  const exclusionIndex = new Set(exclusions.exclusions.map(exclusionKey));
  const benchmarkAuthored = new Set(options.benchmarkAuthoredRecordIds ?? []);

  const candidates: V4CandidateEntry[] = [];
  const repositories: V4RepositoryCensus[] = [];
  for (const snapshot of snapshots.repositories) {
    const bundlePath = bundlePathFor(options.snapshotsPath, snapshot);
    const digest = sha256(readFileSync(bundlePath));
    if (digest !== snapshot.bundle_sha256) {
      throw new Error(
        `census v4: bundle for ${snapshot.repository_id} digests ${digest}, manifest says ${snapshot.bundle_sha256}`,
      );
    }
    const root = mkdtempSync(join(tmpdir(), "cdeb-v4-census-"));
    try {
      const repository = join(root, "repository");
      materializeBundle(bundleIdentityFor(snapshot), bundlePath, repository);
      const result = enumerateRepositoryDecisions({
        cwd: repository,
        snapshot,
        exclusionIndex,
        benchmarkAuthoredRecordIds: benchmarkAuthored,
        commitLoreRepository: snapshot.repository_id === "commitlore",
      });
      candidates.push(...result.candidates);
      repositories.push(result.census);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  return { candidates, repositories };
};

export const serializeCandidates = (candidates: readonly V4CandidateEntry[]): string =>
  `${candidates.map((candidate) => JSON.stringify(candidate)).join("\n")}\n`;

export const writeCensus = (
  result: V4CensusResult,
  censusPath: string,
  summaryPath: string,
): void => {
  writeFileSync(censusPath, serializeCandidates(result.candidates));
  const totals = result.repositories.reduce(
    (accumulator, repository) => ({
      decisions_enumerated: accumulator.decisions_enumerated + repository.decisions_enumerated,
      potential_source_decision_pool:
        accumulator.potential_source_decision_pool + repository.potential_source_decision_pool,
      identity_present: accumulator.identity_present + repository.identity_present,
      identity_absent: accumulator.identity_absent + repository.identity_absent,
    }),
    { decisions_enumerated: 0, potential_source_decision_pool: 0, identity_present: 0, identity_absent: 0 },
  );
  writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        schema_version: 1,
        study_id: V4_STUDY_ID,
        // Named so no reader can mistake it for a task count.
        naming_note:
          "These are potential source decisions, not qualified tasks and not benchmark cases. Every candidate is pending until the adjudicated gates decide it.",
        totals,
        repositories: result.repositories,
      },
      null,
      2,
    )}\n`,
  );
};

const requiredValue = (argv: readonly string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`census v4: ${flag} requires a value`);
  return value;
};

const main = (argv: readonly string[]): void => {
  let studyRoot: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--study-root") { studyRoot = requiredValue(argv, index, "--study-root"); index += 1; }
    else if (argv[index]?.startsWith("--")) throw new Error(`census v4: unknown flag ${argv[index]}`);
  }
  if (studyRoot === undefined) throw new Error("census v4: --study-root is required");
  const root = resolve(studyRoot);
  const result = runV4Census({
    snapshotsPath: join(root, "corpus", "snapshots.json"),
    exclusionIndexPath: join(root, "corpus", "legacy-exclusion-index.json"),
  });
  writeCensus(
    result,
    join(root, "feasibility", "candidate-census.jsonl"),
    join(root, "feasibility", "census-summary.json"),
  );
  for (const repository of result.repositories) {
    process.stdout.write(
      `${repository.repository_id.padEnd(22)} records ${String(repository.records_examined).padStart(4)}` +
        `  with-reason ${String(repository.records_with_explicit_reason).padStart(4)}` +
        `  decisions ${String(repository.decisions_enumerated).padStart(4)}` +
        `  pool ${String(repository.potential_source_decision_pool).padStart(4)}` +
        `  id+ ${String(repository.identity_present).padStart(4)}` +
        `  id- ${String(repository.identity_absent).padStart(4)}\n`,
    );
  }
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
