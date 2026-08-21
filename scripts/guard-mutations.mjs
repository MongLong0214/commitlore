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

const OUTCOMES = new Set(["bound", "inert", "unavailable", "uncovered"]);

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

const runTest = (testFile, testName) =>
  spawnSync("npx", ["vitest", "run", testFile, "-t", testName], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

const measurements = [];
let total = 0;
let boundControls = 0;
let inertControls = 0;
let unavailableControls = 0;

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
    for (const mutation of property.mutations) {
      total += 1;
      const applied = applyMutation(mutation);
      if (!applied.applied) {
        unavailableControls += 1;
        controlOutcomes.push("unavailable");
        details.push(`${mutation.id}: mutation could not be applied — ${applied.reason}; ${mutation.why}`);
        continue;
      }
      try {
        const result = runTest(property.testFile, mutation.testName ?? property.testName);
        if (result.error !== undefined) {
          unavailableControls += 1;
          controlOutcomes.push("unavailable");
          details.push(`${mutation.id}: Vitest could not start — ${result.error.message}; ${mutation.why}`);
        } else if (result.status !== 0) {
          boundControls += 1;
          controlOutcomes.push("bound");
          details.push(`${mutation.id}: mutation applied, test failed — ${mutation.why}`);
        } else {
          inertControls += 1;
          controlOutcomes.push("inert");
          details.push(`${mutation.id}: mutation applied, test passed — ${mutation.why}`);
        }
      } finally {
        restoreActive();
      }
    }
    const outcome = controlOutcomes.includes("unavailable")
      ? "unavailable"
      : controlOutcomes.includes("inert")
        ? "inert"
        : "bound";
    measurements.push({ ...property, outcome, detail: details.join("; ") });
  }
} finally {
  restoreActive();
  rmSync(backupRoot, { recursive: true, force: true });
}

const baseline = readBaseline();
const byOutcome = new Map([...OUTCOMES].map((outcome) => [outcome, []]));
for (const measurement of measurements) byOutcome.get(measurement.outcome).push(measurement);

process.stdout.write("OUTCOME TABLE:\n");
for (const outcome of ["bound", "inert", "unavailable", "uncovered"]) {
  const rows = byOutcome.get(outcome);
  process.stdout.write(`${outcome.toUpperCase()} (${String(rows.length)}):\n`);
  for (const row of rows) {
    const baselineReason = baseline.get(row.guardId)?.reason;
    const suffix = baselineReason === undefined ? row.detail : baselineReason;
    process.stdout.write(`  ${row.guardId}: ${row.claim} — ${suffix}\n`);
  }
}
process.stdout.write(`CONTROL SUMMARY: ${String(boundControls)} bound, ${String(inertControls)} inert, ${String(unavailableControls)} unavailable, ${String(byOutcome.get("uncovered").length)} uncovered, ${String(total)} mutations run\n`);

const failures = [];
const measuredIds = new Set(measurements.map((measurement) => measurement.guardId));
for (const measurement of measurements) {
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
