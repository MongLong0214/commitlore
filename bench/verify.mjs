#!/usr/bin/env node
// Schema gate for bench/results/*.jsonl (T-701 AC). Plain ESM so it runs with
// no build step and no type stripping.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { Ajv } from "ajv";
import addFormats from "ajv-formats";

const SCHEMA_PATH = path.join(import.meta.dirname, "schema", "result.schema.json");

const formatErrors = (errors) =>
  (errors ?? [])
    .map((error) => `${error.instancePath === "" ? "/" : error.instancePath} ${error.message}`)
    .join("; ");

const main = () => {
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (files.length === 0) {
    process.stderr.write("usage: verify.mjs <results.jsonl> [more.jsonl ...]\n");
    return 2;
  }

  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8")));

  let checked = 0;
  let failed = 0;

  for (const file of files) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      process.stderr.write(`verify: no such file: ${resolved}\n`);
      return 2;
    }
    const lines = fs.readFileSync(resolved, "utf8").split("\n");
    let rowsInFile = 0;
    let failedInFile = 0;

    lines.forEach((line, index) => {
      if (line.trim() === "") return;
      rowsInFile += 1;
      checked += 1;
      let row;
      try {
        row = JSON.parse(line);
      } catch (error) {
        failedInFile += 1;
        process.stderr.write(`FAIL ${resolved}:${index + 1} invalid JSON — ${error.message}\n`);
        return;
      }
      if (!validate(row)) {
        failedInFile += 1;
        process.stderr.write(`FAIL ${resolved}:${index + 1} ${formatErrors(validate.errors)}\n`);
      }
    });

    if (rowsInFile === 0) {
      // An empty results file is a failed run, not a passing verification.
      process.stderr.write(`FAIL ${resolved} contains no rows\n`);
      failedInFile += 1;
    } else if (failedInFile === 0) {
      process.stdout.write(`ok   ${resolved} — ${rowsInFile} rows\n`);
    }
    failed += failedInFile;
  }

  if (failed > 0) {
    process.stderr.write(`\nverify: ${failed} problem(s) across ${checked} rows\n`);
    return 1;
  }
  process.stdout.write(`\nverify: ${checked} rows valid against ${path.basename(SCHEMA_PATH)}\n`);
  return 0;
};

process.exitCode = main();
