#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const VERDICTS = new Set([
  "SUPPORTED",
  "SUPPORTED_WITH_SCOPE",
  "OVERSTATED",
  "MISATTRIBUTED",
  "NOT_CAUSAL",
  "NOT_LOAD_BEARING",
]);
const STATUSES = new Set(["resolved", "unresolved"]);

const usage = () => {
  throw new Error("usage: node scripts/render-evidence-matrix.mjs --input <matrix.json> --output <matrix.md> [--check]");
};

const parseArgs = (argv) => {
  const options = { check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--input" || argument === "--output") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) usage();
      options[argument.slice(2)] = value;
      index += 1;
    } else usage();
  }
  if (typeof options.input !== "string" || typeof options.output !== "string") usage();
  return options;
};

const requireString = (value, label) => {
  if (typeof value !== "string" || value === "") throw new Error(`evidence matrix: ${label} must be a non-empty string`);
  return value;
};

export const parseEvidenceMatrix = (bytes) => {
  let matrix;
  try {
    matrix = JSON.parse(bytes);
  } catch (error) {
    throw new Error(`evidence matrix: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof matrix !== "object" || matrix === null || Array.isArray(matrix) || matrix.schema_version !== 1) {
    throw new Error("evidence matrix: expected schema_version 1 object");
  }
  const studyId = requireString(matrix.study_id, "study_id");
  if (!Array.isArray(matrix.claims)) throw new Error("evidence matrix: claims must be an array");
  const ids = new Set();
  const claims = matrix.claims.map((claim, index) => {
    if (typeof claim !== "object" || claim === null || Array.isArray(claim)) throw new Error(`evidence matrix: claim ${String(index + 1)} must be an object`);
    const id = requireString(claim.claim_id, `claim ${String(index + 1)} claim_id`);
    if (ids.has(id)) throw new Error(`evidence matrix: duplicate claim_id ${id}`);
    ids.add(id);
    const verdict = requireString(claim.verdict, `claim ${id} verdict`);
    if (!VERDICTS.has(verdict)) throw new Error(`evidence matrix: claim ${id} has unknown verdict ${verdict}`);
    const status = requireString(claim.status, `claim ${id} status`);
    if (!STATUSES.has(status)) throw new Error(`evidence matrix: claim ${id} has unknown status ${status}`);
    return {
      claim_id: id,
      claim_text: requireString(claim.claim_text, `claim ${id} claim_text`),
      source_id: requireString(claim.source_id, `claim ${id} source_id`),
      verdict,
      status,
      scope_note: requireString(claim.scope_note, `claim ${id} scope_note`),
    };
  });
  return { studyId, claims };
};

const escapeInline = (value) => value.replaceAll("`", "\\`");

/** The matrix's canonical scope note contains the final adjudication rationale and its scope. */
export const renderEvidenceMatrix = (matrix) => {
  const resolved = matrix.claims.filter((claim) => claim.status === "resolved").length;
  const unresolved = matrix.claims.length - resolved;
  const verdicts = [...VERDICTS].map((verdict) => [verdict, matrix.claims.filter((claim) => claim.verdict === verdict).length]);
  const lines = [
    `# Evidence matrix — ${matrix.studyId}`,
    "",
    `Total claims: ${String(matrix.claims.length)}`,
    `Resolved: ${String(resolved)}`,
    `Unresolved: ${String(unresolved)}`,
    "",
    "## Verdict summary",
    "",
    "| Verdict | Claims |",
    "| --- | ---: |",
    ...verdicts.map(([verdict, count]) => `| \`${verdict}\` | ${String(count)} |`),
  ];
  for (const claim of matrix.claims) {
    const rationale = claim.scope_note.trimEnd();
    lines.push(
      "",
      `## ${claim.claim_id}`,
      "",
      `- Statement: ${claim.claim_text}`,
      `- Final verdict: \`${claim.verdict}\``,
      `- Status: \`${claim.status}\``,
      `- Source id: \`${claim.source_id}\``,
      `- Adjudication reasoning: ${rationale}`,
      `- Scope note: ${rationale}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const rendered = renderEvidenceMatrix(parseEvidenceMatrix(readFileSync(options.input, "utf8")));
  if (options.check) {
    let existing;
    try {
      existing = readFileSync(options.output, "utf8");
    } catch (error) {
      throw new Error(`evidence matrix: cannot read generated Markdown ${options.output}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (existing !== rendered) throw new Error(`evidence matrix: generated Markdown differs from ${options.output}; rerun without --check`);
    return;
  }
  writeFileSync(options.output, rendered, "utf8");
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
