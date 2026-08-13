/**
 * CDEB-07 durable study storage (PRD §§19–20).
 *
 * This module deliberately makes every authoritative write immutable.  A
 * result may be mirrored, inspected and analysed later; it must never be
 * "updated" after the fact.  Interrupted `.partial` names are outside the
 * contract and are removed before resume — no caller can mistake one for a
 * durable observation.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { zstdCompressSync } from "./runtime/zstd.ts";

export class ImmutableArtifactError extends Error {
  public constructor(message: string) {
    super(`CDEB durable storage: ${message}`);
    this.name = "ImmutableArtifactError";
  }
}

/** Test-only fault used to model a process death after fsync and before rename. */
export class SimulatedProcessKill extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SimulatedProcessKill";
  }
}

export interface StorageFaults {
  /** Called after a temporary file is fsynced, immediately before its rename. */
  readonly after_file_fsync_before_rename?: (relativePath: string) => void;
}

export interface DurableStudyStorageOptions {
  /** `bench/results/cdeb/<study-id>` — never a temporary directory. */
  readonly studyDir: string;
  /** Required independent mirror for every completed artifact (§20.3). */
  readonly backupDir: string;
  readonly faults?: StorageFaults;
}

export interface FinalTreeArtifact {
  readonly schema_version: 1;
  readonly base_tree_oid: string;
  readonly final_tree_oid: string;
  readonly canonical_diff_sha256: string;
  readonly archive_sha256: string;
  readonly workspace_status_digest: string;
}

export interface AgentLaunchCheckpoint {
  readonly schema_version: 1;
  readonly logical_run_id: string;
  readonly attempt_id: string;
  readonly launched_at: string;
}

export interface AgentStartedCheckpoint extends AgentLaunchCheckpoint {
  readonly first_model_turn_observed: true;
}

export interface StoredAttempt {
  readonly schema_version: 1;
  readonly benchmark: "cdeb-v1";
  readonly attempt_id: string;
  readonly logical_run_id: string;
  readonly terminal_state:
    | "MEASURED"
    | "PRE_AGENT_INFRA_FAILURE"
    | "MEASURED_AGENT_FAILURE"
    | "EVALUATOR_INFRA_FAILURE"
    | "MEASUREMENT_INTEGRITY_FAILURE";
  readonly started_at: string;
  readonly finished_at: string;
  readonly first_model_turn_observed: boolean;
  readonly failure_detail?: string;
}

export interface StoredRunState {
  readonly logical_run_id: string;
  readonly row: Record<string, unknown> | null;
  readonly final_tree: FinalTreeArtifact | null;
  readonly launched_attempt_ids: readonly string[];
  readonly started_attempt_ids: readonly string[];
  readonly agent_attempts: readonly StoredAttempt[];
  readonly evaluator_attempt_count: number;
}

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

const fsyncDirectory = (directory: string): void => {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

const ensureDirectory = (directory: string): void => {
  mkdirSync(directory, { recursive: true });
};

const jsonBytes = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

const parseJsonFile = <T>(path: string, label: string): T => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new ImmutableArtifactError(`${label} is not valid JSON (${(error as Error).message})`);
  }
};

const isInside = (candidate: string, parent: string): boolean => {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
};

const assertRelative = (path: string): void => {
  if (path === "" || isAbsolute(path) || path.split(/[\\/]/u).some((part) => part === ".." || part === "")) {
    throw new ImmutableArtifactError(`unsafe relative artifact path ${JSON.stringify(path)}`);
  }
};

const logicalIdPathSafe = (logicalRunId: string): void => {
  if (!/^[a-z0-9-]+__[a-z0-9-]+__(on|off)__r[1-3]$/u.test(logicalRunId)) {
    throw new ImmutableArtifactError(`invalid logical run id ${JSON.stringify(logicalRunId)}`);
  }
};

/** The public freeze may name only opaque, flat analysis rows. */
const analysisRowPathSafe = (path: string): void => {
  if (!/^rows\/[a-z0-9][a-z0-9._-]*\.json$/u.test(path)) {
    throw new ImmutableArtifactError(`invalid freeze-named analysis row path ${JSON.stringify(path)}`);
  }
};

const attemptIdPathSafe = (attemptId: string): void => {
  if (!/^[a-z0-9-]+__[a-z0-9-]+__(on|off)__r[1-3]__a[1-9][0-9]*$/u.test(attemptId)) {
    throw new ImmutableArtifactError(`invalid attempt id ${JSON.stringify(attemptId)}`);
  }
};

/**
 * Owns the two authoritative roots.  The backup root deliberately has the
 * same layout as the primary, allowing a reviewer to compare relative paths
 * without trusting a database or a copy manifest.
 */
export class DurableStudyStorage {
  public readonly studyDir: string;
  public readonly backupDir: string;
  private readonly faults: StorageFaults | undefined;
  private temporarySequence = 0;

  public constructor(options: DurableStudyStorageOptions) {
    if (options.studyDir === "") throw new ImmutableArtifactError("studyDir must not be empty");
    if (options.backupDir === "") throw new ImmutableArtifactError("CDEB_BACKUP_DIR is required");
    this.studyDir = resolve(options.studyDir);
    this.backupDir = resolve(options.backupDir);
    if (this.studyDir === this.backupDir) {
      throw new ImmutableArtifactError("backup directory must differ from the authoritative study directory");
    }
    this.faults = options.faults;
    ensureDirectory(this.studyDir);
    ensureDirectory(this.backupDir);
  }

  private absolute(relativePath: string, root: string = this.studyDir): string {
    assertRelative(relativePath);
    const path = resolve(root, relativePath);
    if (!isInside(path, root)) throw new ImmutableArtifactError(`artifact path escapes root: ${relativePath}`);
    return path;
  }

  private temporaryFor(destination: string): string {
    this.temporarySequence += 1;
    return `${destination}.${String(process.pid)}.${String(this.temporarySequence)}.${randomBytes(6).toString("hex")}.partial`;
  }

  private writeNewAt(root: string, relativePath: string, bytes: Uint8Array): void {
    const destination = this.absolute(relativePath, root);
    ensureDirectory(dirname(destination));
    if (existsSync(destination)) {
      throw new ImmutableArtifactError(`refusing to overwrite ${relativePath}`);
    }
    const temporary = this.temporaryFor(destination);
    let descriptor: number | null = null;
    try {
      descriptor = openSync(temporary, "wx");
      let offset = 0;
      while (offset < bytes.byteLength) {
        offset += writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
      }
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      this.faults?.after_file_fsync_before_rename?.(relativePath);
      if (existsSync(destination)) {
        throw new ImmutableArtifactError(`refusing to overwrite ${relativePath}`);
      }
      renameSync(temporary, destination);
      fsyncDirectory(dirname(destination));
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      // A real SIGKILL cannot execute cleanup.  Retaining the partial in this
      // synthetic equivalent lets resume exercise exactly that path.
      if (!(error instanceof SimulatedProcessKill) && existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
  }

  private mirrorExisting(relativePath: string): void {
    const primary = this.absolute(relativePath);
    const backup = this.absolute(relativePath, this.backupDir);
    if (!existsSync(primary)) throw new ImmutableArtifactError(`cannot mirror missing primary ${relativePath}`);
    const primaryBytes = readFileSync(primary);
    if (existsSync(backup)) {
      const backupBytes = readFileSync(backup);
      if (sha256(primaryBytes) !== sha256(backupBytes)) {
        throw new ImmutableArtifactError(`backup hash differs for ${relativePath}`);
      }
      return;
    }
    this.writeNewAt(this.backupDir, relativePath, primaryBytes);
    const copied = readFileSync(backup);
    if (sha256(primaryBytes) !== sha256(copied)) {
      throw new ImmutableArtifactError(`backup hash differs after copy for ${relativePath}`);
    }
  }

  /** Immutable primary write followed by an independently fsynced mirror. */
  public writeNew(relativePath: string, bytes: Uint8Array | string): void {
    const value = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
    this.writeNewAt(this.studyDir, relativePath, value);
    this.mirrorExisting(relativePath);
  }

  public writeJsonNew(relativePath: string, value: unknown): void {
    this.writeNew(relativePath, jsonBytes(value));
  }

  /**
   * Finish a row publication interrupted between its two immutable views.
   * Both views carry the same bytes: the per-run `row.json` binds the row to its
   * evidence, while the freeze-named `rows/*.json` file is the analyzer's
   * only permitted input.  Either existing copy is evidence; divergent copies
   * are an integrity failure, never a choice for recovery to make.
   */
  private writeOrMatch(relativePath: string, bytes: Buffer): void {
    const primary = this.absolute(relativePath);
    const backup = this.absolute(relativePath, this.backupDir);
    if (existsSync(primary)) {
      if (!readFileSync(primary).equals(bytes)) {
        throw new ImmutableArtifactError(`existing artifact differs from immutable row publication ${relativePath}`);
      }
      this.mirrorExisting(relativePath);
      return;
    }
    if (existsSync(backup) && !readFileSync(backup).equals(bytes)) {
      throw new ImmutableArtifactError(`backup artifact differs from immutable row publication ${relativePath}`);
    }
    this.writeNew(relativePath, bytes);
  }

  public readJson<T>(relativePath: string): T | null {
    const path = this.absolute(relativePath);
    return existsSync(path) ? parseJsonFile<T>(path, relativePath) : null;
  }

  public exists(relativePath: string): boolean {
    return existsSync(this.absolute(relativePath));
  }

  /**
   * Writes an initial immutable freeze document, or proves a resume is against
   * byte-identical commitments.  A changed freeze is a different study.
   */
  public ensureCommittedJson(relativePath: string, value: unknown): void {
    const expected = jsonBytes(value);
    const primary = this.absolute(relativePath);
    if (!existsSync(primary)) {
      this.writeNew(relativePath, expected);
      return;
    }
    const actual = readFileSync(primary);
    if (!actual.equals(expected)) {
      throw new ImmutableArtifactError(`${relativePath} differs from the already committed freeze`);
    }
    this.mirrorExisting(relativePath);
  }

  private runRelative(logicalRunId: string, name: string): string {
    logicalIdPathSafe(logicalRunId);
    assertRelative(name);
    return join("runs", logicalRunId, name);
  }

  private runDirectory(logicalRunId: string): string {
    logicalIdPathSafe(logicalRunId);
    return this.absolute(join("runs", logicalRunId));
  }

  /** Creates an empty per-run directory atomically, before an agent can start. */
  private ensureRunDirectory(logicalRunId: string): void {
    const destination = this.runDirectory(logicalRunId);
    if (existsSync(destination)) {
      if (!statSync(destination).isDirectory()) throw new ImmutableArtifactError(`run path is not a directory for ${logicalRunId}`);
      return;
    }
    ensureDirectory(dirname(destination));
    const temporary = this.temporaryFor(destination);
    try {
      mkdirSync(temporary);
      mkdirSync(join(temporary, "attempts"));
      fsyncDirectory(join(temporary, "attempts"));
      fsyncDirectory(temporary);
      if (existsSync(destination)) throw new ImmutableArtifactError(`run directory already exists for ${logicalRunId}`);
      renameSync(temporary, destination);
      fsyncDirectory(dirname(destination));
      this.mirrorRunDirectory(logicalRunId);
    } catch (error) {
      if (!(error instanceof SimulatedProcessKill) && existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  private mirrorRunDirectory(logicalRunId: string): void {
    const primary = this.runDirectory(logicalRunId);
    const backup = this.absolute(join("runs", logicalRunId), this.backupDir);
    if (!existsSync(backup)) {
      ensureDirectory(dirname(backup));
      mkdirSync(backup);
      mkdirSync(join(backup, "attempts"));
      fsyncDirectory(join(backup, "attempts"));
      fsyncDirectory(backup);
      fsyncDirectory(dirname(backup));
    }
    if (!statSync(primary).isDirectory() || !statSync(backup).isDirectory()) {
      throw new ImmutableArtifactError(`run mirror is not a directory for ${logicalRunId}`);
    }
  }

  /**
   * Must be called immediately before spawning the agent.  Its presence means
   * a process may have reached a model turn; an interrupted launch is therefore
   * never guessed to be safe to rerun.
   */
  public beginAgentAttempt(checkpoint: AgentLaunchCheckpoint): void {
    logicalIdPathSafe(checkpoint.logical_run_id);
    attemptIdPathSafe(checkpoint.attempt_id);
    this.ensureRunDirectory(checkpoint.logical_run_id);
    const dir = this.runRelative(checkpoint.logical_run_id, join("attempts", checkpoint.attempt_id));
    const primary = this.absolute(dir);
    if (existsSync(primary)) throw new ImmutableArtifactError(`attempt directory already exists for ${checkpoint.attempt_id}`);
    ensureDirectory(primary);
    ensureDirectory(this.absolute(dir, this.backupDir));
    fsyncDirectory(dirname(primary));
    fsyncDirectory(dirname(this.absolute(dir, this.backupDir)));
    this.writeJsonNew(join(dir, "agent-launched.json"), checkpoint);
  }

  /** Durable first-turn marker.  It is a state checkpoint, never an outcome. */
  public markFirstModelTurn(checkpoint: AgentStartedCheckpoint): void {
    const dir = this.runRelative(checkpoint.logical_run_id, join("attempts", checkpoint.attempt_id));
    if (!existsSync(this.absolute(dir))) {
      throw new ImmutableArtifactError(`agent attempt was not launched for ${checkpoint.attempt_id}`);
    }
    this.writeJsonNew(join(dir, "agent-started.json"), checkpoint);
  }

  /** Pre-turn failures have no logical outcome but are preserved for retry lineage. */
  public writePreAgentAttempt(attempt: StoredAttempt): void {
    if (attempt.terminal_state !== "PRE_AGENT_INFRA_FAILURE" || attempt.first_model_turn_observed) {
      throw new ImmutableArtifactError("pre-agent attempt must be PRE_AGENT_INFRA_FAILURE with no first model turn");
    }
    attemptIdPathSafe(attempt.attempt_id);
    this.writeJsonNew(join("attempts", `${attempt.attempt_id}.json`), attempt);
  }

  /** The terminal agent attempt belongs beside the frozen observation. */
  public writeAgentAttempt(attempt: StoredAttempt): void {
    if (!attempt.first_model_turn_observed) {
      throw new ImmutableArtifactError("a measured agent attempt must have a durable first-model-turn marker");
    }
    const dir = this.runRelative(attempt.logical_run_id, join("attempts", attempt.attempt_id));
    if (!this.exists(join(dir, "agent-started.json"))) {
      throw new ImmutableArtifactError(`first model turn was not durably marked for ${attempt.attempt_id}`);
    }
    this.writeJsonNew(join(dir, "attempt.json"), attempt);
  }

  /** Facts needed to resume evaluator-only work, stored beside that agent attempt. */
  public writeAgentObservation(logicalRunId: string, attemptId: string, value: unknown): void {
    attemptIdPathSafe(attemptId);
    const dir = this.runRelative(logicalRunId, join("attempts", attemptId));
    if (!this.exists(join(dir, "attempt.json"))) {
      throw new ImmutableArtifactError(`cannot attach an observation before terminal agent attempt ${attemptId}`);
    }
    this.writeJsonNew(join(dir, "observation.json"), value);
  }

  public readAgentObservation<T>(logicalRunId: string, attemptId: string): T | null {
    return this.readJson<T>(this.runRelative(logicalRunId, join("attempts", attemptId, "observation.json")));
  }

  public writeExposure(logicalRunId: string, bytes: Uint8Array): void {
    this.ensureRunDirectory(logicalRunId);
    const artifact = this.runRelative(logicalRunId, "exposure.jsonl");
    this.writeNew(artifact, bytes);
    this.writeNew(
      this.runRelative(logicalRunId, "exposure.sha256"),
      `${sha256(bytes)}  exposure.jsonl\n`,
    );
  }

  /** CDEB-05's evidence pair, mirrored as one immutable durable artifact. */
  public writeProviderNdjson(logicalRunId: string, rawNdjson: Uint8Array): void {
    this.ensureRunDirectory(logicalRunId);
    const raw = Buffer.from(rawNdjson);
    const digest = sha256(raw);
    this.writeNew(this.runRelative(logicalRunId, "provider.ndjson.zst"), zstdCompressSync(raw));
    this.writeNew(this.runRelative(logicalRunId, "provider.ndjson.sha256"), `${digest}  provider.ndjson\n`);
  }

  /** Absolute path for a durable run artifact, for the evaluator's read-only mount. */
  public runArtifactPath(logicalRunId: string, name: string): string {
    return this.absolute(this.runRelative(logicalRunId, name));
  }

  /** Absolute durable run directory, for readers of multi-file artifacts. */
  public runDirectoryPath(logicalRunId: string): string {
    return this.runDirectory(logicalRunId);
  }

  /** Archive first, metadata commit record second: no partial tree can verify. */
  public writeFinalTree(logicalRunId: string, archive: Uint8Array, metadata: FinalTreeArtifact): void {
    this.ensureRunDirectory(logicalRunId);
    if (sha256(archive) !== metadata.archive_sha256) {
      throw new ImmutableArtifactError(`final tree archive digest does not match metadata for ${logicalRunId}`);
    }
    this.writeNew(this.runRelative(logicalRunId, "final-tree.tar.zst"), archive);
    this.writeJsonNew(this.runRelative(logicalRunId, "final-tree.json"), metadata);
  }

  public writeEvaluatorAttempt(logicalRunId: string, attemptId: string, value: unknown): void {
    this.ensureRunDirectory(logicalRunId);
    if (!/^e[1-9][0-9]*$/u.test(attemptId)) throw new ImmutableArtifactError(`invalid evaluator attempt id ${attemptId}`);
    const relativePath = this.runRelative(logicalRunId, join("evaluator-attempts", `${attemptId}.json`));
    this.writeJsonNew(relativePath, value);
  }

  public writeEvaluatorResult(logicalRunId: string, value: unknown): void {
    this.writeJsonNew(this.runRelative(logicalRunId, "evaluator.json"), value);
  }

  /**
   * The row is the final commit record.  The per-run and analysis views are
   * byte-identical immutable publications of one observation, not two rows.
   */
  public writeRow(logicalRunId: string, analysisRowPath: string, row: Record<string, unknown>): void {
    const named = row["logical_run_id"];
    if (named !== logicalRunId) {
      throw new ImmutableArtifactError(`row logical_run_id does not match its directory for ${logicalRunId}`);
    }
    analysisRowPathSafe(analysisRowPath);
    const bytes = jsonBytes(row);
    // The analyzer-facing name lands first. A kill before the run-local copy
    // is recovered by `reconcileNamedRows` before resume decides what is done.
    this.writeOrMatch(analysisRowPath, bytes);
    this.writeOrMatch(this.runRelative(logicalRunId, "row.json"), bytes);
  }

  /** Repairs a killed row publication without re-running its observation. */
  public reconcileNamedRows(namedRows: ReadonlyMap<string, string>): void {
    const paths = new Set<string>();
    for (const [logicalRunId, analysisRowPath] of namedRows) {
      logicalIdPathSafe(logicalRunId);
      analysisRowPathSafe(analysisRowPath);
      if (paths.has(analysisRowPath)) {
        throw new ImmutableArtifactError(`freeze names ${analysisRowPath} for more than one logical row`);
      }
      paths.add(analysisRowPath);
      const runPath = this.runRelative(logicalRunId, "row.json");
      const primaryRun = this.absolute(runPath);
      const primaryAnalysis = this.absolute(analysisRowPath);
      const hasRun = existsSync(primaryRun);
      const hasAnalysis = existsSync(primaryAnalysis);
      if (!hasRun && !hasAnalysis) continue;
      const bytes = hasRun ? readFileSync(primaryRun) : readFileSync(primaryAnalysis);
      this.writeOrMatch(runPath, bytes);
      this.writeOrMatch(analysisRowPath, bytes);
    }
  }

  public readFinalTree(logicalRunId: string): FinalTreeArtifact | null {
    return this.readJson<FinalTreeArtifact>(this.runRelative(logicalRunId, "final-tree.json"));
  }

  public readRunState(logicalRunId: string): StoredRunState {
    logicalIdPathSafe(logicalRunId);
    const runDir = this.runDirectory(logicalRunId);
    const row = this.readJson<Record<string, unknown>>(this.runRelative(logicalRunId, "row.json"));
    const finalTree = this.readFinalTree(logicalRunId);
    const launched: string[] = [];
    const started: string[] = [];
    const agentAttempts: StoredAttempt[] = [];
    const attemptsDir = join(runDir, "attempts");
    if (existsSync(attemptsDir)) {
      for (const name of readdirSync(attemptsDir).sort()) {
        const attemptDir = join(attemptsDir, name);
        if (!statSync(attemptDir).isDirectory()) throw new ImmutableArtifactError(`run attempt entry is not a directory: ${name}`);
        if (existsSync(join(attemptDir, "agent-launched.json"))) launched.push(name);
        if (existsSync(join(attemptDir, "agent-started.json"))) started.push(name);
        if (existsSync(join(attemptDir, "attempt.json"))) {
          agentAttempts.push(parseJsonFile<StoredAttempt>(join(attemptDir, "attempt.json"), `attempt ${name}`));
        }
      }
    }
    const evaluatorDir = join(runDir, "evaluator-attempts");
    const evaluatorAttemptCount = existsSync(evaluatorDir)
      ? readdirSync(evaluatorDir).filter((name) => name.endsWith(".json") && statSync(join(evaluatorDir, name)).isFile()).length
      : 0;
    return {
      logical_run_id: logicalRunId,
      row,
      final_tree: finalTree,
      launched_attempt_ids: launched,
      started_attempt_ids: started,
      agent_attempts: agentAttempts,
      evaluator_attempt_count: evaluatorAttemptCount,
    };
  }

  public preAgentAttempts(logicalRunId: string): StoredAttempt[] {
    const directory = this.absolute("attempts");
    if (!existsSync(directory)) return [];
    const records: StoredAttempt[] = [];
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (!name.endsWith(".json") || !statSync(path).isFile()) {
        throw new ImmutableArtifactError(`top-level attempts contains a non-JSON artifact: ${name}`);
      }
      const value = parseJsonFile<StoredAttempt>(path, `attempt ${name}`);
      if (value.logical_run_id === logicalRunId) records.push(value);
    }
    return records;
  }

  /**
   * Finds completed ids from durable row commit records, rejecting all the
   * ambiguous cases before a resume can decide what to run.
   */
  public completedRows(expectedLogicalIds: readonly string[]): ReadonlyMap<string, Record<string, unknown>> {
    const expected = new Set(expectedLogicalIds);
    if (expected.size !== expectedLogicalIds.length) throw new ImmutableArtifactError("expected logical ids are duplicated");
    const rows = new Map<string, Record<string, unknown>>();
    const runs = this.absolute("runs");
    if (existsSync(runs)) {
      for (const name of readdirSync(runs).sort()) {
        const runDir = join(runs, name);
        if (!statSync(runDir).isDirectory()) throw new ImmutableArtifactError(`runs contains a non-directory artifact: ${name}`);
        if (name.includes(".partial")) throw new ImmutableArtifactError(`unrecovered partial run directory: ${name}`);
        const path = join(runDir, "row.json");
        if (!existsSync(path)) continue;
        const row = parseJsonFile<Record<string, unknown>>(path, `row ${name}`);
        const id = row["logical_run_id"];
        if (typeof id !== "string" || id !== name) throw new ImmutableArtifactError(`row directory/id mismatch in ${name}`);
        if (!expected.has(id)) throw new ImmutableArtifactError(`durable row ${id} is not named by this randomization`);
        if (rows.has(id)) throw new ImmutableArtifactError(`duplicate logical row ${id}`);
        rows.set(id, row);
      }
    }
    return rows;
  }

  public missingLogicalIds(expectedLogicalIds: readonly string[]): string[] {
    const complete = this.completedRows(expectedLogicalIds);
    return expectedLogicalIds.filter((id) => !complete.has(id));
  }

  /** Removes only unpublished names generated by this module's atomic writer. */
  public recoverUnpublishedPartials(): number {
    let removed = 0;
    const removePartialsUnder = (directory: string): void => {
      if (!existsSync(directory)) return;
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        const stat = statSync(path);
        if (name.includes(".partial")) {
          rmSync(path, { recursive: stat.isDirectory(), force: true });
          removed += 1;
        } else if (stat.isDirectory()) {
          removePartialsUnder(path);
        }
      }
    };
    removePartialsUnder(this.studyDir);
    removePartialsUnder(this.backupDir);
    const removeUncommittedPairs = (root: string): void => {
      const runs = join(root, "runs");
      if (!existsSync(runs)) return;
      for (const name of readdirSync(runs)) {
        const run = join(runs, name);
        if (!statSync(run).isDirectory()) continue;
        const removePairWhenIncomplete = (left: string, right: string): void => {
          const leftPath = join(run, left);
          const rightPath = join(run, right);
          if (existsSync(leftPath) !== existsSync(rightPath)) {
            // Neither half has its commit record.  It was never a readable
            // CDEB artifact and deleting it prevents a verifier from treating
            // a byte blob as a frozen tree or provider stream.
            rmSync(leftPath, { force: true });
            rmSync(rightPath, { force: true });
            removed += 1;
          }
        };
        removePairWhenIncomplete("provider.ndjson.zst", "provider.ndjson.sha256");
        removePairWhenIncomplete("exposure.jsonl", "exposure.sha256");
        removePairWhenIncomplete("final-tree.tar.zst", "final-tree.json");
      }
    };
    removeUncommittedPairs(this.studyDir);
    removeUncommittedPairs(this.backupDir);
    return removed;
  }

  /**
   * Completes backup copies interrupted after the primary rename.  It reads
   * primary bytes only and refuses a divergent backup, so recovery never
   * rewrites or selects between two observations.
   */
  public repairBackupMirrors(): void {
    const walk = (directory: string, prefix: string): void => {
      if (!existsSync(directory)) return;
      for (const name of readdirSync(directory).sort()) {
        if (name.includes(".partial")) {
          throw new ImmutableArtifactError(`cannot mirror unpublished partial ${join(prefix, name)}`);
        }
        const path = join(directory, name);
        const rel = prefix === "" ? name : join(prefix, name);
        const stat = statSync(path);
        if (stat.isDirectory()) walk(path, rel);
        else if (stat.isFile()) this.mirrorExisting(rel);
        else throw new ImmutableArtifactError(`authoritative storage contains a non-file artifact ${rel}`);
      }
    };
    walk(this.studyDir, "");
  }

  /** Repairs a missing backup copy, but never changes primary evidence. */
  public ensureBackup(relativePath: string): void {
    this.mirrorExisting(relativePath);
  }
}
