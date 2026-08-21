#!/usr/bin/env node
/**
 * Mutates each registered guard and requires its named Vitest test to fail.
 *
 * This runner intentionally treats an unavailable mutation as a finding. A
 * test that cannot be made to prove its claimed property has no control, even
 * when the ordinary green suite makes the mechanism look covered.
 */

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const REGISTRY_PATH = resolve(ROOT, "bench/cdeb/guards/registry.json");
const backupRoot = mkdtempSync(resolve(tmpdir(), "commitlore-guard-mutations-"));
let activeRestore = null;

const hardFailure = (message) => {
  process.exitCode = 1;
  process.stdout.write(`${message}\n`);
};

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

let total = 0;
let bound = 0;
let inert = 0;
let unavailable = 0;
let uncovered = 0;

try {
  for (const property of readRegistry()) {
    if (property.mutations.length === 0) {
      uncovered += 1;
      hardFailure(`UNCOVERED: ${property.guardId}: property has zero mutations; no expressible control — ${property.claim}`);
      continue;
    }
    for (const mutation of property.mutations) {
      total += 1;
      const applied = applyMutation(mutation);
      if (!applied.applied) {
        unavailable += 1;
        hardFailure(`NO EXPRESSIBLE CONTROL: ${property.guardId}/${mutation.id}: mutation could not be applied — ${applied.reason}; ${mutation.why}`);
        continue;
      }
      try {
        const result = runTest(property.testFile, mutation.testName ?? property.testName);
        if (result.error !== undefined) {
          unavailable += 1;
          hardFailure(`NO EXPRESSIBLE CONTROL: ${property.guardId}/${mutation.id}: mutation could not be applied — Vitest could not start: ${result.error.message}; ${mutation.why}`);
        } else if (result.status !== 0) {
          bound += 1;
          process.stdout.write(`BOUND: ${property.guardId}/${mutation.id}: mutation applied, test failed — ${mutation.why}\n`);
        } else {
          inert += 1;
          hardFailure(`INERT: ${property.guardId}/${mutation.id}: mutation applied, test PASSED — ${mutation.why}`);
        }
      } finally {
        restoreActive();
      }
    }
  }
} finally {
  restoreActive();
  rmSync(backupRoot, { recursive: true, force: true });
}

process.stdout.write(`SUMMARY: ${String(bound)} bound, ${String(inert)} inert, ${String(unavailable)} unavailable, ${String(uncovered)} uncovered, ${String(total)} mutations run\n`);
