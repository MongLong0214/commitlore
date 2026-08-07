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
//     (total_token_volume vs the raw category sum; decision_safe_success vs
//     stop_reason/functional_pass/rejected_decision_revived — §14.7)
//   - a duplicate logical_run_id fails
//   - if randomization.json names the expected logical runs, a missing or
//     extra row fails; RESULT.json with an incomplete matrix fails (§22.6)
//
// Exit 0: every study verifies, or there are no studies. Exit 1 otherwise.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
 * §14.7: stored derived fields are recomputed from their raw inputs. Schema
 * validity proves the shape; only recomputation proves the value.
 */
const checkDerived = (study, path, row) => {
  const u = row.usage;
  const sum = u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
  if (u.total_token_volume !== sum) {
    fail(study, `${path}: total_token_volume ${u.total_token_volume} != raw category sum ${sum}`);
  }
  const recomputed =
    row.stop_reason === "completed" &&
    row.evaluation.functional_pass === true &&
    row.evaluation.rejected_decision_revived === false;
  if (row.decision_safe_success !== recomputed) {
    fail(study, `${path}: decision_safe_success ${row.decision_safe_success} != recomputed ${recomputed} from stop_reason/evaluation`);
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

  const freezePath = join(dir, "public-freeze.json");
  let expectedRuns = null;
  if (existsSync(freezePath)) {
    const freeze = readJson(study, freezePath);
    if (freeze !== null && validateAgainst(study, "study", freezePath, freeze)) {
      expectedRuns = freeze.expected_logical_runs;
    }
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
    if (!validateAgainst(study, "result", path, row)) return;
    checkDerived(study, path, row);
    if (seenIds.has(row.logical_run_id)) {
      fail(study, `duplicate logical_run_id ${row.logical_run_id} in ${path} and ${seenIds.get(row.logical_run_id)}`);
    } else {
      seenIds.set(row.logical_run_id, path);
    }
    if (expectedIds !== null && !expectedIds.has(row.logical_run_id)) {
      fail(study, `${path}: logical_run_id ${row.logical_run_id} is not in the randomization's expected set`);
    }
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
      if (existsSync(rowPath)) verifyRow(rowPath);
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
  const studies = readdirSync(root).sort();
  for (const name of studies) {
    const path = join(root, name);
    if (!statSync(path).isDirectory()) {
      fail("(root)", `unknown file "${name}" — the CDEB root holds study directories only`);
      continue;
    }
    verifyStudy(root, name);
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
