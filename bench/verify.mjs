#!/usr/bin/env node
// Schema gate for bench/results/*.jsonl (T-701 AC). Plain ESM so it runs with
// no build step and no type stripping.
//
// Run it with no arguments to gate the whole directory (`npm run bench:verify`,
// and the CI step of the same name). Named files are a narrower manual run and
// are judged by the identical rules, so a local verdict and CI's cannot differ.
//
// =====================================================================
// WHICH FILES THIS GATE COVERS, AND WHY THAT IS A RULE AND NOT A LIST
// =====================================================================
//
// #392: nothing ran this file. It had no npm script and no CI step, so the
// schema drifted five fields behind the runner and
// bench/results/m5-off-design-20-tasks.jsonl sat in the tree failing for two
// days before anyone looked. #390 fixed that drift; this is the reason it went
// unnoticed. docs/RELEASE-GATE.md: "A gate nobody can check is a slogan."
//
// Wiring it up needs an answer to "over which files?", and the answer has to
// hold for the next results file, committed by someone who has never read this
// comment. So the scope is default-in: every `*.jsonl` in bench/results/, with
// nothing to register and nothing to remember. A new file is inside the gate
// the moment it is committed. Neither of the two exemptions below can be
// reached by forgetting something -- both are properties of the rows
// themselves, both are decided per row rather than per filename, and both are
// printed on every run, so a reader can check the scope by running the gate
// instead of by trusting this paragraph.
//
// A declared list of filenames was the obvious alternative and is the one thing
// that cannot work here: it is opt-in wearing a different hat. A file left off
// it is silently ungated, which is the failure being fixed.
//
// ---------------------------------------------------------------------
// Exemption 1 -- a file whose every row carries `schema_version` is not a
// run record, and this schema does not describe it.
// ---------------------------------------------------------------------
//
// bench/results/ holds two row families that share a directory and nothing
// else. Run records (`RunRecord` in bench/types.ts, written by bench/runner.ts)
// are what result.schema.json describes -- its own description says "One line =
// one (task, condition, seed) run". Metric rows (`BaseRow` in
// bench/deterministic/types.ts, written by bench/deterministic.ts and
// bench/external/run.ts) are one row per measurement and have never carried a
// run id, a task or a condition. Checking those against this schema is not a
// drift check, it is a category error, and it would fail 7 of the 17 files here
// forever.
//
// `schema_version` is the discriminator because it is already on the rows and
// both sides guarantee the answer: `BaseRow` declares `readonly
// schema_version: 1`, so every metric row has it, and result.schema.json is
// `additionalProperties: false` with no such property, so no valid run record
// can. Note the direction -- the marker belongs to the *other* family, so the
// gate reads its absence as inclusion. Keying inclusion on its presence would
// select exactly the files this schema cannot describe.
//
// A file carrying it on some rows and not others is failed rather than
// classified. That is a corrupt file, and it also closes the only accident by
// which a run-record file could drift out of this gate: leaving is not an
// omission, it takes adding a field to every row, which the schema then rejects
// the moment anyone points the gate at the file directly.
//
// ---------------------------------------------------------------------
// Exemption 2 -- the two provenance fields are not required of rows that
// were recorded before those fields existed.
// ---------------------------------------------------------------------
//
// 1073fa4 ("A benchmark row now has to prove which binary produced it",
// 2026-07-27T02:56:12Z) made `harness_commit` and `dist_digest` required. Six
// matrices were measured before it and cannot be corrected: bench/results/
// holds committed measurements, and ADR-0018 is the reason a superseded or
// invalidated matrix stays in the tree rather than being deleted. Failing an
// old file for lacking a field that did not exist is not a finding.
//
// Those files are not skipped, and the schema is not weakened to admit them.
// Every other constraint still applies to them -- every type, every pattern,
// and the closed property set -- and exactly two `required` entries are dropped,
// for rows that identify themselves as old by their own `started_at`. The
// schema file is untouched; the relaxation is built here, at the gate, from the
// schema as committed.
//
// The exemption cannot creep into the present, which is what makes it a rule
// rather than a description of today: `started_at` comes from the clock when
// the runner writes the row, so no new file can fall before a cutoff in the
// past. And the cutoff is not a judgement call -- the last row without
// provenance started at 2026-07-27T02:21:50.808Z, the first row with it at
// 2026-07-27T07:21:31.025Z, and the commit that introduced the requirement
// sits inside that gap. A row with no parseable `started_at` is treated as
// current and gets no relaxation, so a malformed row fails rather than
// qualifying for an exemption by being unreadable.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { Ajv } from "ajv";
import addFormats from "ajv-formats";

const SCHEMA_PATH = path.join(import.meta.dirname, "schema", "result.schema.json");
const RESULTS_DIR = path.join(import.meta.dirname, "results");

/** Commit 1073fa4, which made both fields below `required`. */
const PROVENANCE_REQUIRED_FROM = Date.parse("2026-07-27T02:56:12Z");
const PROVENANCE_FIELDS = ["harness_commit", "dist_digest"];

const formatErrors = (errors) =>
  (errors ?? [])
    .map((error) => `${error.instancePath === "" ? "/" : error.instancePath} ${error.message}`)
    .join("; ");

/** Every `*.jsonl` directly in bench/results/, sorted so the output is stable. */
const scopeFiles = () =>
  fs
    .readdirSync(RESULTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(RESULTS_DIR, entry.name))
    .sort();

const isPreProvenance = (row) => {
  const startedAt = Date.parse(row?.started_at ?? "");
  return Number.isFinite(startedAt) && startedAt < PROVENANCE_REQUIRED_FROM;
};

const main = () => {
  const named = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  let files;
  if (named.length > 0) {
    files = named.map((file) => path.resolve(file));
  } else {
    if (!fs.existsSync(RESULTS_DIR)) {
      process.stderr.write(`verify: no results directory at ${RESULTS_DIR}\n`);
      return 2;
    }
    files = scopeFiles();
    // A gate that finds nothing to check must not report success -- the same
    // reading the empty-file case below already takes.
    if (files.length === 0) {
      process.stderr.write(`verify: no *.jsonl in ${RESULTS_DIR}; the gate checked nothing\n`);
      return 2;
    }
  }

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const relaxed = {
    ...schema,
    $id: `${schema.$id}#pre-provenance`,
    required: schema.required.filter((name) => !PROVENANCE_FIELDS.includes(name)),
  };
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const validatePreProvenance = ajv.compile(relaxed);

  let checked = 0;
  let failed = 0;
  let skipped = 0;

  for (const resolved of files) {
    if (!fs.existsSync(resolved)) {
      process.stderr.write(`verify: no such file: ${resolved}\n`);
      return 2;
    }
    const lines = fs.readFileSync(resolved, "utf8").split("\n");
    const rows = [];
    let failedInFile = 0;
    let rowsInFile = 0;

    lines.forEach((line, index) => {
      if (line.trim() === "") return;
      rowsInFile += 1;
      let row;
      try {
        row = JSON.parse(line);
      } catch (error) {
        failedInFile += 1;
        process.stderr.write(`FAIL ${resolved}:${index + 1} invalid JSON — ${error.message}\n`);
        return;
      }
      rows.push({ row, line: index + 1 });
    });

    if (rowsInFile === 0) {
      // An empty results file is a failed run, not a passing verification.
      process.stderr.write(`FAIL ${resolved} contains no rows\n`);
      failed += 1;
      continue;
    }
    if (failedInFile > 0) {
      failed += failedInFile;
      continue;
    }

    const versioned = rows.filter(({ row }) => row?.schema_version !== undefined).length;
    if (versioned === rows.length) {
      skipped += 1;
      process.stdout.write(
        `skip ${resolved} — ${rows.length} metric row(s) (schema_version present); ` +
          `result.schema.json describes run records\n`,
      );
      continue;
    }
    if (versioned > 0) {
      process.stderr.write(
        `FAIL ${resolved} mixes ${versioned} row(s) carrying schema_version with ` +
          `${rows.length - versioned} that do not; one file, one row family\n`,
      );
      failed += 1;
      continue;
    }

    let legacy = 0;
    for (const { row, line } of rows) {
      checked += 1;
      const old = isPreProvenance(row);
      if (old) legacy += 1;
      const check = old ? validatePreProvenance : validate;
      if (!check(row)) {
        failedInFile += 1;
        process.stderr.write(`FAIL ${resolved}:${line} ${formatErrors(check.errors)}\n`);
      }
    }

    if (failedInFile === 0) {
      // The exemption is named on the passing line, not only in the comment
      // above: a reader who runs the gate sees which rows were held to a
      // shorter list of requirements and how many.
      const note =
        legacy === 0
          ? ""
          : ` (${legacy} recorded before 1073fa4: ${PROVENANCE_FIELDS.join(", ")} not yet required)`;
      process.stdout.write(`ok   ${resolved} — ${rows.length} rows${note}\n`);
    }
    failed += failedInFile;
  }

  if (failed > 0) {
    process.stderr.write(`\nverify: ${failed} problem(s) across ${checked} rows\n`);
    return 1;
  }
  process.stdout.write(
    `\nverify: ${checked} rows in ${files.length - skipped} file(s) valid against ` +
      `${path.basename(SCHEMA_PATH)}; ${skipped} metric-row file(s) out of scope\n`,
  );
  return 0;
};

process.exitCode = main();
