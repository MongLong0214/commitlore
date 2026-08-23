#!/usr/bin/env node
/**
 * Mutates each registered guard and requires its named Vitest test to fail.
 *
 * The outcome is checked against a committed baseline. Known gaps remain
 * visible in the complete table, but only a change from that baseline fails:
 * regressions make the job red and improvements require the baseline to move.
 */

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  ALL_OUTCOMES,
  BASELINE_OUTCOMES,
  REGISTRATION_DEFECTS,
  classifyRun,
  severestOutcome,
} from "./guard-outcomes.mjs";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const REGISTRY_PATH = resolve(ROOT, "bench/cdeb/guards/registry.json");
const BASELINE_PATH = resolve(ROOT, "bench/cdeb/guards/baseline.json");
const backupRoot = mkdtempSync(resolve(tmpdir(), "commitlore-guard-mutations-"));
let activeRestore = null;

const restoreActive = () => {
  if (activeRestore === null) return;
  try {
    copyFileSync(activeRestore.backup, activeRestore.target);
  } finally {
    activeRestore = null;
  }
};

process.on("exit", restoreActive);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restoreActive();
    process.exit(128);
  });
}
process.on("uncaughtException", (error) => {
  restoreActive();
  throw error;
});

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const requireString = (value, label) => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
};

const readRegistry = () => {
  const parsed = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.properties)) {
    throw new Error(`${relative(ROOT, REGISTRY_PATH)} must contain version 1 and a properties array`);
  }
  return parsed.properties.map((property, propertyIndex) => {
    const label = `properties[${propertyIndex}]`;
    if (!isRecord(property) || !Array.isArray(property.mutations)) throw new Error(`${label} must be an object with mutations`);
    return {
      guardId: requireString(property.guard_id, `${label}.guard_id`),
      claim: requireString(property.claim, `${label}.claim`),
      testFile: requireString(property.test_file, `${label}.test_file`),
      testName: requireString(property.test_name, `${label}.test_name`),
      mutations: property.mutations.map((mutation, mutationIndex) => {
        const mutationLabel = `${label}.mutations[${mutationIndex}]`;
        if (!isRecord(mutation) || mutation.must_fail_test !== true) throw new Error(`${mutationLabel}.must_fail_test must be true`);
        return {
          id: requireString(mutation.mutation_id, `${mutationLabel}.mutation_id`),
          file: requireString(mutation.file, `${mutationLabel}.file`),
          find: requireString(mutation.find, `${mutationLabel}.find`),
          replace: requireString(mutation.replace, `${mutationLabel}.replace`),
          why: requireString(mutation.why, `${mutationLabel}.why`),
          testName: mutation.test_name === undefined ? undefined : requireString(mutation.test_name, `${mutationLabel}.test_name`),
        };
      }),
    };
  });
};

const OUTCOMES = BASELINE_OUTCOMES;

const readBaseline = () => {
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.properties)) {
    throw new Error(`${relative(ROOT, BASELINE_PATH)} must contain version 1 and a properties array`);
  }
  const entries = new Map();
  for (const [index, property] of parsed.properties.entries()) {
    const label = `properties[${String(index)}]`;
    if (!isRecord(property)) throw new Error(`${label} must be an object`);
    const guardId = requireString(property.guard_id, `${label}.guard_id`);
    const outcome = requireString(property.outcome, `${label}.outcome`);
    if (!OUTCOMES.has(outcome)) throw new Error(`${label}.outcome must be one of ${[...OUTCOMES].join(", ")}`);
    if (entries.has(guardId)) throw new Error(`${label}.guard_id duplicates ${guardId}`);
    const reason = property.reason === undefined ? undefined : requireString(property.reason, `${label}.reason`);
    if (outcome !== "bound" && reason === undefined) throw new Error(`${label}.reason is required for a baseline gap`);
    entries.set(guardId, { outcome, reason });
  }
  return entries;
};

const countOccurrences = (source, find) => {
  let count = 0;
  let offset = 0;
  while (true) {
    const found = source.indexOf(find, offset);
    if (found === -1) return count;
    count += 1;
    offset = found + find.length;
  }
};

const applyMutation = (mutation) => {
  const target = resolve(ROOT, mutation.file);
  if (!isAbsolute(target) || !target.startsWith(`${ROOT}/`) || !existsSync(target)) {
    return { applied: false, reason: `target ${mutation.file} does not exist inside the repository` };
  }
  const original = readFileSync(target, "utf8");
  const matches = countOccurrences(original, mutation.find);
  if (matches !== 1) {
    return { applied: false, reason: `find matched ${String(matches)} times (expected exactly 1)` };
  }
  const backup = resolve(backupRoot, `${String(Date.now())}-${mutation.id}`);
  copyFileSync(target, backup);
  activeRestore = { target, backup };
  try {
    const mutated = original.replace(mutation.find, mutation.replace);
    writeFileSync(target, mutated, "utf8");
    return { applied: true, target };
  } catch (error) {
    restoreActive();
    return { applied: false, reason: `write failed: ${error instanceof Error ? error.message : String(error)}` };
  }
};

let runCounter = 0;

// Returns how many tests actually executed, not just the exit code. `vitest run
// -t <name>` exits 0 when the name matches nothing -- it skips the whole file and
// reports success -- so the exit code alone cannot tell a mutation nothing
// reacted to from a test name that no longer resolves. Renaming a test is
// routine, and under the old reading that silently downgraded its guard.
const runTest = (testFile, testName) => {
  runCounter += 1;
  const outputFile = resolve(backupRoot, `vitest-${String(runCounter)}.json`);
  const args = ["vitest", "run", testFile, "--reporter=json", `--outputFile=${outputFile}`];
  if (testName !== null) args.push("-t", testName);
  const spawned = spawnSync("npx", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (spawned.error !== undefined) return { started: false, reason: spawned.error.message };
  if (!existsSync(outputFile)) {
    return { started: false, reason: `vitest exited ${String(spawned.status)} without writing a report` };
  }
  let report;
  try {
    report = JSON.parse(readFileSync(outputFile, "utf8"));
  } catch (error) {
    return { started: false, reason: `vitest report was not readable JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const assertions = Array.isArray(report.testResults)
    ? report.testResults.flatMap((file) => (Array.isArray(file.assertionResults) ? file.assertionResults : []))
    : [];
  const executed = assertions.filter((assertion) => assertion.status !== "skipped" && assertion.status !== "pending");
  const failed = executed.filter((assertion) => assertion.status === "failed");
  return {
    started: true,
    executed: executed.length,
    failed: failed.length,
    failedNames: failed.map((assertion) => assertion.fullName ?? assertion.title ?? "(unnamed test)"),
  };
};

const describe = (outcome, mutation, property, named, filtered, whole) => {
  if (outcome === "unavailable") {
    return `${mutation.id}: Vitest could not start — ${filtered.reason}; ${mutation.why}`;
  }
  if (outcome === "unresolved") {
    return `${mutation.id}: no test in ${property.testFile} matches "${named}", so nothing was run; the registration names a test that does not exist`;
  }
  if (outcome === "bound") return `${mutation.id}: mutation applied, test failed — ${mutation.why}`;
  if (outcome === "misfiled") {
    return `${mutation.id}: "${named}" passed, but the mutation failed ${whole.failedNames.join(", ")}; register it against the test that actually fails`;
  }
  return `${mutation.id}: mutation applied, no test in ${property.testFile} failed — ${mutation.why}`;
};

const measurements = [];
let total = 0;
const controlTally = new Map(ALL_OUTCOMES.map((outcome) => [outcome, 0]));

try {
  for (const property of readRegistry()) {
    if (property.mutations.length === 0) {
      measurements.push({
        ...property,
        outcome: "uncovered",
        detail: "property has zero mutations; no expressible control",
      });
      continue;
    }
    const controlOutcomes = [];
    const details = [];
    const record = (outcome, detail) => {
      controlTally.set(outcome, controlTally.get(outcome) + 1);
      controlOutcomes.push(outcome);
      details.push(detail);
    };
    for (const mutation of property.mutations) {
      total += 1;
      const applied = applyMutation(mutation);
      if (!applied.applied) {
        record("unavailable", `${mutation.id}: mutation could not be applied — ${applied.reason}; ${mutation.why}`);
        continue;
      }
      try {
        const named = mutation.testName ?? property.testName;
        const filtered = runTest(property.testFile, named);
        // The unfiltered run is only needed to tell misfiled from inert, and the
        // clean tree is green, so a failure in it is caused by the mutation.
        const whole =
          filtered.started && filtered.executed > 0 && filtered.failed === 0
            ? runTest(property.testFile, null)
            : undefined;
        const outcome = classifyRun(filtered, whole);
        record(outcome, describe(outcome, mutation, property, named, filtered, whole));
      } finally {
        restoreActive();
      }
    }
    const outcome = severestOutcome(controlOutcomes);
    measurements.push({ ...property, outcome, detail: details.join("; ") });
  }
} finally {
  restoreActive();
  rmSync(backupRoot, { recursive: true, force: true });
}

const baseline = readBaseline();
const byOutcome = new Map(ALL_OUTCOMES.map((outcome) => [outcome, []]));
for (const measurement of measurements) byOutcome.get(measurement.outcome).push(measurement);

process.stdout.write("OUTCOME TABLE:\n");
for (const outcome of ["bound", "misfiled", "unresolved", "inert", "unavailable", "uncovered"]) {
  const rows = byOutcome.get(outcome);
  process.stdout.write(`${outcome.toUpperCase()} (${String(rows.length)}):\n`);
  for (const row of rows) {
    // A registration defect has no legitimate baseline entry, so its own detail
    // is the only account of it; for the recorded gaps the baseline reason is
    // the considered one and supersedes the generated line.
    const baselineReason = REGISTRATION_DEFECTS.has(outcome) ? undefined : baseline.get(row.guardId)?.reason;
    const suffix = baselineReason === undefined ? row.detail : baselineReason;
    process.stdout.write(`  ${row.guardId}: ${row.claim} — ${suffix}\n`);
  }
}
const tallyText = ["bound", "misfiled", "unresolved", "inert", "unavailable"]
  .map((outcome) => `${String(controlTally.get(outcome))} ${outcome}`)
  .join(", ");
process.stdout.write(`CONTROL SUMMARY: ${tallyText}, ${String(byOutcome.get("uncovered").length)} uncovered, ${String(total)} mutations run\n`);

const failures = [];
const measuredIds = new Set(measurements.map((measurement) => measurement.guardId));
for (const measurement of measurements) {
  // A registration defect fails on sight and is never reconciled against the
  // baseline. Recording one would ratchet in a guard whose stated coverage
  // cannot be checked -- exactly the state the baseline exists to make visible.
  if (REGISTRATION_DEFECTS.has(measurement.outcome)) {
    failures.push(`REGISTRATION DEFECT: ${measurement.guardId}: ${measurement.detail}`);
    continue;
  }
  const expected = baseline.get(measurement.guardId);
  if (expected === undefined) {
    if (measurement.outcome === "uncovered") {
      failures.push(`REGRESSION: ${measurement.guardId}: new property has zero mutations and is absent from the baseline`);
    } else {
      failures.push(`BASELINE DISAGREES WITH MEASUREMENT: ${measurement.guardId}: measured ${measurement.outcome}, but the property is absent from the baseline`);
    }
    continue;
  }
  if (expected.outcome === measurement.outcome) continue;
  if (expected.outcome !== "bound" && measurement.outcome === "bound") {
    failures.push(`BASELINE DISAGREES WITH MEASUREMENT: ${measurement.guardId}: baseline records ${expected.outcome}, measurement is bound; tighten the baseline to record the repaired guard`);
  } else if (expected.outcome === "bound") {
    failures.push(`REGRESSION: BASELINE DISAGREES WITH MEASUREMENT: ${measurement.guardId}: baseline records bound, measurement is ${measurement.outcome}`);
  } else {
    failures.push(`BASELINE DISAGREES WITH MEASUREMENT: ${measurement.guardId}: baseline records ${expected.outcome}, measurement is ${measurement.outcome}`);
  }
}
for (const guardId of baseline.keys()) {
  if (!measuredIds.has(guardId)) failures.push(`BASELINE DISAGREES WITH REGISTRY: ${guardId}: baseline property is no longer registered`);
}

if (failures.length > 0) {
  process.stdout.write("RATCHET FAILURES:\n");
  for (const failure of failures) process.stdout.write(`  ${failure}\n`);
  process.exitCode = 1;
}
