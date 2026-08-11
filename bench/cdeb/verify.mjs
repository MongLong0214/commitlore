#!/usr/bin/env node
// CDEB recursive verifier (PRD §21). Plain ESM, no build step.
//
// The legacy gate (bench/verify.mjs) is default-in over top-level
// bench/results/*.jsonl and deliberately does not recurse — CDEB studies are
// nested directories with a fixed layout, and #441 showed what happens when an
// analysis surface discovers its inputs instead of naming them: the M5 analyzer
// globbed 1,835 rows from four different experiments and would have passed its
// own stopping rule on the contamination. So this verifier owns
// bench/results/cdeb/ recursively, and CDEB rows carry an explicit
// `benchmark: "cdeb-v1"` — `schema_version` is NOT reused as a skip
// discriminator (PRD §21.2).
//
// Everything here fails loudly and specifically:
//   - an empty study directory is a finding, not a skip
//   - an unknown file anywhere in a study is a finding
//   - a schema-invalid row, attempt, evaluator output or freeze manifest fails
//   - a derived field that does not equal its recomputation fails
//     (total_token_volume vs the raw category sum when usage is available;
//     decision_safe_success vs stop_reason/functional_pass/rejected-decision
//     revival — §14.7)
//   - a duplicate logical_run_id fails
//   - if randomization.json names the expected logical runs, a missing or
//     extra row fails; RESULT.json with an incomplete matrix fails (§22.6)
//
// Exit 0: every study verifies, or there are no studies. Exit 1 otherwise.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";

// `ajv`'s default export ships the draft-07 meta-schema only; these schemas
// declare draft 2020-12, which lives in its own entry point.
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, "..", "results", "cdeb");

const SCHEMA_DIR = join(HERE, "schemas");
const loadSchema = (name) => JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.schema.json`), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validators = {
  result: ajv.compile(loadSchema("result")),
  evaluator: ajv.compile(loadSchema("evaluator")),
  attempt: ajv.compile(loadSchema("attempt")),
  study: ajv.compile(loadSchema("study")),
};

/** Entries a study directory may contain, and nothing else (PRD §20.1). */
const STUDY_ENTRIES = new Set([
  "public-freeze.json", "randomization.json", "deviations.md",
  "RESULT.json", "RESULT.md", "runs", "rows", "attempts",
]);

/** Entries a runs/<logical-run-id>/ directory may contain (PRD §19.1). */
const RUN_ENTRIES = new Set([
  "attempts", "provider.ndjson.zst", "provider.ndjson.sha256",
  "exposure.jsonl", "exposure.sha256", "final-tree.tar.zst", "final-tree.json",
  "evaluator-attempts", "evaluator.json", "row.json",
]);

/**
 * Directories under the CDEB root that are not studies and must never be read
 * as one (CDEB-P preregistration §8).
 *
 * A pilot produces rows deliberately outside the protocol — a different schema,
 * no freeze manifest, no claim gate — and its numbers may not reach a verdict.
 * Naming it here is the mechanism for that promise: the verifier skips it, and
 * because the skip is a name rather than a heuristic, a real study can never
 * become invisible by accident. The skip is printed on every run.
 */
const NON_STUDY_DIRS = new Set(["pilot"]);

const findings = [];
const fail = (study, message) => findings.push(`${study}: ${message}`);

const readJson = (study, path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(study, `${path} is not valid JSON: ${error.message}`);
    return null;
  }
};

const validateAgainst = (study, kind, path, value) => {
  if (value === null) return false;
  if (validators[kind](value)) return true;
  for (const err of validators[kind].errors ?? []) {
    fail(study, `${path}: ${err.instancePath || "/"} ${err.message}`);
  }
  return false;
};

/**
 * §9.5 (v1.3): exposure fields must be mutually consistent. The schema accepts
 * each field in isolation, so a row can claim a delivered record with zero
 * proxy executions and still validate. These are the relations that make the
 * opportunity/delivery split mean something rather than name something.
 */
const checkExposure = (study, path, row) => {
  const e = row.exposure;
  if (e.proxy_executions > e.hook_opportunities) {
    fail(study, `${path}: proxy_executions ${e.proxy_executions} exceeds hook_opportunities ${e.hook_opportunities}`);
  }
  if (e.delivered_record_ids.length > 0 && e.proxy_executions === 0) {
    fail(study, `${path}: records delivered with zero proxy executions — nothing ran to deliver them`);
  }
  if (e.payload_sha256s.length > e.proxy_executions) {
    fail(study, `${path}: ${e.payload_sha256s.length} payload(s) from ${e.proxy_executions} proxy execution(s)`);
  }
  if (e.expected_record_delivered && e.delivered_record_ids.length === 0) {
    fail(study, `${path}: expected_record_delivered is true with no delivered_record_ids`);
  }
  if (e.delivered_before_first_mutation && e.delivered_record_ids.length === 0) {
    fail(study, `${path}: delivered_before_first_mutation is true with nothing delivered`);
  }
  if (e.product_failures > e.proxy_executions) {
    fail(study, `${path}: ${e.product_failures} product failure(s) from ${e.proxy_executions} execution(s)`);
  }
};

/**
 * §14.7: stored derived fields are recomputed from their raw inputs. Schema
 * validity proves the shape; only recomputation proves the value.
 */
const checkDerived = (study, path, row) => {
  const u = row.usage;
  if (u.availability === "measured") {
    const sum = u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
    if (u.total_token_volume !== sum) {
      fail(study, `${path}: total_token_volume ${u.total_token_volume} != raw category sum ${sum}`);
    }
  }
  const recomputed =
    row.stop_reason === "completed" &&
    row.evaluation.functional_pass === true &&
    row.evaluation.rejected_decision_revived === false;
  if (row.decision_safe_success !== recomputed) {
    fail(study, `${path}: decision_safe_success ${row.decision_safe_success} != recomputed ${recomputed} from stop_reason/evaluation`);
  }
};

/**
 * CDEB-05: the row's digest names the raw, decompressed NDJSON bytes, not a
 * convenient recompression. A per-run row without those bytes is not evidence
 * that the provider stream it claims to summarize was retained.
 */
const checkProviderArtifact = (study, runDir, row) => {
  const compressedPath = join(runDir, "provider.ndjson.zst");
  const checksumPath = join(runDir, "provider.ndjson.sha256");
  const hasCompressed = existsSync(compressedPath);
  const hasChecksum = existsSync(checksumPath);
  if (!hasCompressed && !hasChecksum) {
    if (row !== null) fail(study, `${runDir}: row.json has no provider NDJSON artifact`);
    return;
  }
  if (!hasCompressed || !hasChecksum) {
    fail(study, `${runDir}: provider NDJSON artifact and checksum must appear together`);
    return;
  }
  let raw;
  try {
    raw = zstdDecompressSync(readFileSync(compressedPath));
  } catch (error) {
    fail(study, `${compressedPath}: cannot decompress provider NDJSON: ${error.message}`);
    return;
  }
  const sidecar = readFileSync(checksumPath, "utf8");
  const sidecarMatch = sidecar.match(/^([0-9a-f]{64})  provider\.ndjson\n$/);
  if (sidecarMatch?.[1] === undefined) {
    fail(study, `${checksumPath}: malformed provider NDJSON checksum`);
    return;
  }
  const digest = createHash("sha256").update(raw).digest("hex");
  if (digest !== sidecarMatch[1]) {
    fail(study, `${runDir}: provider NDJSON checksum does not match decompressed bytes`);
  }
  if (row !== null && digest !== row.usage.raw_stream_sha256) {
    fail(study, `${runDir}: row usage raw_stream_sha256 does not match provider NDJSON`);
  }
};

/**
 * CDEB-07: a final tree is an archive PLUS its metadata commit record.  An
 * archive without final-tree.json is deliberately not a tree that can verify;
 * accepting it would turn a kill between the two writes into durable-looking
 * evidence.  The metadata's digest binds the bytes and the row binds both
 * object identity and digests.
 */
const checkFinalTreeArtifact = (study, runDir, row) => {
  const archivePath = join(runDir, "final-tree.tar.zst");
  const metadataPath = join(runDir, "final-tree.json");
  const hasArchive = existsSync(archivePath);
  const hasMetadata = existsSync(metadataPath);
  if (!hasArchive && !hasMetadata) {
    if (row !== null) fail(study, `${runDir}: row.json has no final tree artifact`);
    return;
  }
  if (!hasArchive || !hasMetadata) {
    fail(study, `${runDir}: final tree archive and metadata must appear together`);
    return;
  }
  const metadata = readJson(study, metadataPath);
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return;
  const expectedKeys = [
    "archive_sha256", "base_tree_oid", "canonical_diff_sha256", "final_tree_oid", "schema_version", "workspace_status_digest",
  ].sort();
  const actualKeys = Object.keys(metadata).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    fail(study, `${metadataPath}: final tree metadata has an unexpected shape`);
    return;
  }
  if (metadata.schema_version !== 1) {
    fail(study, `${metadataPath}: final tree metadata schema_version must be 1`);
    return;
  }
  for (const key of ["base_tree_oid", "final_tree_oid"] ) {
    if (typeof metadata[key] !== "string" || !/^[0-9a-f]{40}$/.test(metadata[key])) {
      fail(study, `${metadataPath}: ${key} is not a git object id`);
    }
  }
  for (const key of ["archive_sha256", "canonical_diff_sha256", "workspace_status_digest"]) {
    if (typeof metadata[key] !== "string" || !/^[0-9a-f]{64}$/.test(metadata[key])) {
      fail(study, `${metadataPath}: ${key} is not a sha256`);
    }
  }
  const archiveDigest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (archiveDigest !== metadata.archive_sha256) {
    fail(study, `${runDir}: final tree archive digest does not match metadata`);
  }
  if (row !== null) {
    if (row.final_tree.final_tree_oid !== metadata.final_tree_oid) {
      fail(study, `${runDir}: row final tree oid does not match final-tree.json`);
    }
    if (row.final_tree.archive_sha256 !== metadata.archive_sha256) {
      fail(study, `${runDir}: row final tree archive digest does not match final-tree.json`);
    }
    if (row.final_tree.canonical_diff_sha256 !== metadata.canonical_diff_sha256) {
      fail(study, `${runDir}: row canonical diff digest does not match final-tree.json`);
    }
    if (row.final_tree.workspace_status_digest !== metadata.workspace_status_digest) {
      fail(study, `${runDir}: row workspace status digest does not match final-tree.json`);
    }
  }
};

const verifyStudy = (root, studyName) => {
  const study = studyName;
  const dir = join(root, studyName);
  const entries = readdirSync(dir);

  if (entries.length === 0) {
    fail(study, "study directory is empty — a study that produced nothing is a finding, not a skip");
    return;
  }
  for (const entry of entries) {
    if (!STUDY_ENTRIES.has(entry)) {
      fail(study, `unknown entry "${entry}" — every file in a study is accounted for or the study fails`);
    }
  }

  // A study without its freeze manifest is not a study whose rows mean
  // anything: the thresholds, the qualification summaries and the model and
  // product commitments all live there. v1.2's verifier validated it only when
  // it happened to exist, so a directory of valid rows verified clean with no
  // commitments at all.
  const freezePath = join(dir, "public-freeze.json");
  let expectedRuns = null;
  let freeze = null;
  if (!existsSync(freezePath)) {
    fail(study, "public-freeze.json is missing — rows without a freeze manifest commit to nothing");
  } else {
    freeze = readJson(study, freezePath);
    if (freeze !== null && validateAgainst(study, "study", freezePath, freeze)) {
      expectedRuns = freeze.expected_logical_runs;
    }
  }
  if (!existsSync(join(dir, "randomization.json"))) {
    fail(study, "randomization.json is missing — the run order was never committed");
  }

  // Expected logical run ids, when the randomization names them. Kept minimal:
  // the file may hold opaque blocks pre-reveal, so ids are only enforced when
  // present.
  let expectedIds = null;
  const randPath = join(dir, "randomization.json");
  if (existsSync(randPath)) {
    const rand = readJson(study, randPath);
    if (rand !== null && Array.isArray(rand.expected_logical_run_ids)) {
      expectedIds = new Set(rand.expected_logical_run_ids);
    }
  }

  const seenIds = new Map(); // logical_run_id -> path

  const verifyRow = (path) => {
    const row = readJson(study, path);
    if (!validateAgainst(study, "result", path, row)) return null;
    checkDerived(study, path, row);
    checkExposure(study, path, row);
    if (seenIds.has(row.logical_run_id)) {
      fail(study, `duplicate logical_run_id ${row.logical_run_id} in ${path} and ${seenIds.get(row.logical_run_id)}`);
    } else {
      seenIds.set(row.logical_run_id, path);
    }
    if (expectedIds !== null && !expectedIds.has(row.logical_run_id)) {
      fail(study, `${path}: logical_run_id ${row.logical_run_id} is not in the randomization's expected set`);
    }
    // Every row must name the study it belongs to and the protocol it was
    // produced under. A row from another freeze inside this directory is the
    // contamination #441 was about, one level down.
    if (freeze !== null) {
      if (row.study_id !== freeze.study_id) {
        fail(study, `${path}: study_id ${row.study_id} does not match the freeze's ${freeze.study_id}`);
      }
      if (row.protocol_version !== freeze.protocol_version) {
        fail(study, `${path}: protocol_version ${row.protocol_version} does not match the freeze's ${freeze.protocol_version}`);
      }
      if (row.product_commit !== freeze.product_commit) {
        fail(study, `${path}: product_commit does not match the freeze`);
      }
      if (row.dist_digest !== freeze.dist_digest) {
        fail(study, `${path}: dist_digest does not match the freeze`);
      }
      if (row.requested_model !== freeze.requested_model) {
        fail(study, `${path}: requested_model does not match the freeze`);
      }
      if (
        row.observed_model_ids.length !== 1 ||
        row.observed_model_ids[0] !== freeze.observed_model_id
      ) {
        fail(
          study,
          `${path}: observed_model_ids ${JSON.stringify(row.observed_model_ids)} do not exactly match the freeze's observed_model_id`,
        );
      }
    }
    return row;
  };

  const rowsDir = join(dir, "rows");
  if (existsSync(rowsDir)) {
    for (const name of readdirSync(rowsDir).sort()) {
      const path = join(rowsDir, name);
      if (!name.endsWith(".json") || !statSync(path).isFile()) {
        fail(study, `rows/${name}: only row .json files belong here`);
        continue;
      }
      verifyRow(path);
    }
  }

  const runsDir = join(dir, "runs");
  if (existsSync(runsDir)) {
    for (const runName of readdirSync(runsDir).sort()) {
      const runDir = join(runsDir, runName);
      if (!statSync(runDir).isDirectory()) {
        fail(study, `runs/${runName}: only per-run directories belong here`);
        continue;
      }
      for (const entry of readdirSync(runDir)) {
        if (!RUN_ENTRIES.has(entry)) fail(study, `runs/${runName}/${entry}: unknown entry`);
      }
      const rowPath = join(runDir, "row.json");
      const row = existsSync(rowPath) ? verifyRow(rowPath) : null;
      checkProviderArtifact(study, runDir, row);
      checkFinalTreeArtifact(study, runDir, row);
      const evalPath = join(runDir, "evaluator.json");
      if (existsSync(evalPath)) {
        validateAgainst(study, "evaluator", evalPath, readJson(study, evalPath));
      }
    }
  }

  const attemptsDir = join(dir, "attempts");
  if (existsSync(attemptsDir)) {
    for (const name of readdirSync(attemptsDir).sort()) {
      const path = join(attemptsDir, name);
      if (!name.endsWith(".json") || !statSync(path).isFile()) {
        fail(study, `attempts/${name}: only attempt .json files belong here`);
        continue;
      }
      validateAgainst(study, "attempt", path, readJson(study, path));
    }
  }

  if (expectedIds !== null) {
    for (const id of expectedIds) {
      if (!seenIds.has(id)) fail(study, `expected logical run ${id} has no row`);
    }
  }
  if (expectedRuns !== null && expectedIds !== null && expectedIds.size !== expectedRuns) {
    fail(study, `randomization names ${expectedIds.size} runs but the freeze expects ${expectedRuns}`);
  }

  // A verdict requires the complete matrix (§22.6). RESULT.json sitting beside
  // missing rows is the exact artifact the analyzer must never have produced.
  if (existsSync(join(dir, "RESULT.json")) && expectedIds !== null) {
    const missing = [...expectedIds].filter((id) => !seenIds.has(id));
    if (missing.length > 0) {
      fail(study, `RESULT.json exists but ${missing.length} expected row(s) are missing — a verdict from an incomplete matrix`);
    }
  }
};

const main = () => {
  const root = process.argv[2] ?? DEFAULT_ROOT;
  if (!existsSync(root)) {
    console.log(`cdeb verify: no studies at ${root} — nothing to verify`);
    return 0;
  }
  const entries = readdirSync(root).sort();
  const skipped = [];
  const studies = [];
  for (const name of entries) {
    const path = join(root, name);
    if (!statSync(path).isDirectory()) {
      fail("(root)", `unknown file "${name}" — the CDEB root holds study directories only`);
      continue;
    }
    if (NON_STUDY_DIRS.has(name)) {
      skipped.push(name);
      continue;
    }
    studies.push(name);
    verifyStudy(root, name);
  }
  if (skipped.length > 0) {
    console.log(`cdeb verify: not a study, skipped: ${skipped.join(", ")}`);
  }

  if (findings.length > 0) {
    for (const finding of findings) console.error(`cdeb verify: ${finding}`);
    console.error(`cdeb verify: ${findings.length} finding(s)`);
    return 1;
  }
  console.log(`cdeb verify: ${studies.length} study(ies) verified clean`);
  return 0;
};

process.exit(main());
