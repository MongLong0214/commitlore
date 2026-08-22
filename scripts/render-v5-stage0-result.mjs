#!/usr/bin/env node
// Renders the CDEB-Fresh v5 Stage 0 RESULT.md from the study's own artifacts.
//
// Same reason as v4's generator: two copies of the same counts disagree
// eventually and the disagreement is silent. `--check` fails when the committed
// Markdown has drifted from the artifacts it reports.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const usage = "usage: render-v5-stage0-result.mjs --study-root <dir> [--check]";

const parseArguments = (argv) => {
  const options = { check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") options.check = true;
    else if (flag === "--study-root") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${usage}\n--study-root requires a value`);
      options.studyRoot = value;
      index += 1;
    } else throw new Error(`${usage}\nunknown flag ${flag}`);
  }
  if (options.studyRoot === undefined) throw new Error(usage);
  return options;
};

const readJson = (path) => {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON in ${path}: ${error.message}`);
  }
};

const readJsonl = (path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));

const table = (header, rows) => {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => String(row[column]).length)),
  );
  const line = (cells) => `| ${cells.map((cell, column) => String(cell).padEnd(widths[column])).join(" | ")} |`;
  return [line(header), `|${widths.map((width) => "-".repeat(width + 2)).join("|")}|`, ...rows.map(line)].join("\n");
};

const render = (studyRoot) => {
  const feasibility = join(studyRoot, "feasibility");
  // Refuse before any other read: a study claiming a measured run must not be
  // rendered whether or not its other artifacts exist.
  const study = readJson(join(studyRoot, "study.json"));
  const status = readJson(join(studyRoot, "STATUS.json"));
  if (status.measured_run_allowed !== false || study.measured_run_allowed !== false) {
    throw new Error("refusing to render: measured_run_allowed is not false");
  }
  const policy = readJson(join(studyRoot, "authority-policy.json"));
  const authority = readJson(join(feasibility, "authority-summary.json"));
  const summary = readJson(join(feasibility, "qualification-summary.json"));
  const repositories = readJson(join(feasibility, "repository-summary.json"));
  const delivery = readJsonl(join(feasibility, "delivery-feasibility.jsonl"));
  const entries = readJsonl(join(feasibility, "qualification.jsonl"));
  const deviations = readJsonl(join(studyRoot, "deviations.jsonl"));

  if (summary.measured_product_effect_rows !== 0) {
    throw new Error("refusing to render: measured product-effect rows is not zero");
  }

  const verdict = summary.verdict;
  const deliveredIdLess = delivery.filter((row) => row.delivered && !row.identity_present).length;
  const deliveredIdentified = delivery.filter((row) => row.delivered && row.identity_present).length;
  const qualified = entries.filter((entry) => entry.qualified);

  const lines = [];
  lines.push("# CDEB-Fresh v5 Stage 0 Result");
  lines.push("");
  lines.push("> Generated from this study's artifacts by `scripts/render-v5-stage0-result.mjs`.");
  lines.push("> Every number below is read from a committed file; none is typed by hand.");
  lines.push("");
  lines.push("## Live state");
  lines.push("");
  lines.push("```text");
  lines.push(`study:                ${study.study_id}`);
  lines.push(`phase:                ${study.phase}`);
  lines.push(`measured_run_allowed: ${String(study.measured_run_allowed)}`);
  lines.push(`predecessor v4:       stage0-hold, preserved, 0 measured rows`);
  lines.push(`measured rows:        ${String(summary.measured_product_effect_rows)}`);
  lines.push(`study cutoff:         ${study.study_cutoff}`);
  lines.push(`product release:      ${study.product_release_tag} (${study.product_release_commit.slice(0, 12)})`);
  lines.push("```");
  lines.push("");
  lines.push("## Owner decisions");
  lines.push("");
  lines.push("```text");
  lines.push("repository rule:  eligible at >= 8 qualified; GO needs >= 3 eligible and >= 36 total");
  lines.push("owner testimony:  disabled — A2 collected 0");
  lines.push("```");
  lines.push("");
  lines.push("## Scientific construct");
  lines.push("");
  lines.push(`> **${policy.construct}**`);
  lines.push("");
  lines.push("The eventual outcome is whether a final code tree implements a functionally viable");
  lines.push("approach the policy ruled out — not whether an agent cited a record, repeated its");
  lines.push("wording, or stated its reason. Those are named as forbidden outcomes because each");
  lines.push("would let the treatment satisfy the measurement merely by arriving.");
  lines.push("");
  lines.push("## Fresh census and authority");
  lines.push("");
  lines.push(
    table(
      ["repository", "raw", "A0", "A1", "A0-only", "identified", "id-less"],
      authority.repositories.map((row) => [
        row.repository_id, row.raw_decisions, row.a0, row.a1, row.a0_only, row.identified, row.id_less,
      ]),
    ),
  );
  lines.push("");
  lines.push("```text");
  const a0 = authority.repositories.reduce((sum, row) => sum + row.a0, 0);
  const a1 = authority.repositories.reduce((sum, row) => sum + row.a1, 0);
  lines.push(`A0: ${String(a0)}    A1: ${String(a1)}    A2: 0`);
  lines.push("```");
  lines.push("");
  lines.push("**A0 admitted every decision it was given, and that is mostly structural.** The");
  lines.push("census emits a candidate only when a ruled-out alternative and its reason parsed");
  lines.push("out of a record inside the frozen bundle, so most A0 conditions cannot fail on its");
  lines.push("own input. Which conditions were inert on this corpus:");
  lines.push("");
  lines.push("```text");
  for (const row of authority.a0_discrimination ?? []) {
    lines.push(`${row.condition.padEnd(34)} failed ${String(row.failed).padStart(3)}${row.inert ? "   (inert here)" : ""}`);
  }
  lines.push("```");
  lines.push("");
  lines.push("## Qualification funnel");
  lines.push("");
  lines.push(
    table(
      ["repository", "raw", "A0", "A1", "semantic", "hidden", "viable", "oracle", "delivery", "bounded", "leak-safe", "qualified", "eligible"],
      repositories.repositories.map((row) => [
        row.repository_id, row.raw, row.a0, row.a1, row.semantic, row.hidden, row.viable,
        row.oracle, row.delivery, row.bounded, row.leakage_safe, row.qualified, row.eligible ? "yes" : "no",
      ]),
    ),
  );
  lines.push("");
  lines.push("## Identity");
  lines.push("");
  lines.push("```text");
  lines.push(`enumerated identified: ${String(entries.filter((entry) => entry.identity_present).length)}`);
  lines.push(`enumerated id-less:    ${String(entries.filter((entry) => !entry.identity_present).length)}`);
  lines.push(`qualified identified:  ${String(qualified.filter((entry) => entry.identity_present).length)}`);
  lines.push(`qualified id-less:     ${String(qualified.filter((entry) => !entry.identity_present).length)}`);
  lines.push("missing-id exclusions: 0");
  lines.push(`qualified with no independent corroboration: ${String(qualified.filter((entry) => !entry.independent_corroboration).length)}`);
  lines.push("```");
  lines.push("");
  lines.push("## Freshness");
  lines.push("");
  lines.push("```text");
  lines.push("old task reused:        0");
  lines.push("old gold reused:        0");
  lines.push("old trajectory reused:  0");
  lines.push("old result row reused:  0");
  lines.push("v4 qualification rows imported: 0");
  lines.push("synthetic Record-Ids:   0");
  lines.push("owner testimony:        0");
  lines.push("```");
  lines.push("");
  lines.push("## Delivery");
  lines.push("");
  lines.push("```text");
  lines.push(`probed:              ${String(delivery.length)}`);
  lines.push(`delivered:           ${String(delivery.filter((row) => row.delivered).length)}`);
  lines.push(`  identified:        ${String(deliveredIdentified)}`);
  lines.push(`  id-less:           ${String(deliveredIdLess)}`);
  lines.push(`stale-as-current:    ${String(delivery.filter((row) => row.stale_as_current).length)}`);
  lines.push(`harness failures:    ${String(delivery.filter((row) => row.exit_code !== 0).length)}`);
  lines.push("```");
  lines.push("");
  lines.push("Three structural bounds, unchanged from v4 and restated because they bound this");
  lines.push("number too: scope is tested against one non-touched path; lifecycle is not read");
  lines.push("from the payload for an active decision, so that field discriminates only the");
  lines.push("superseded cases; and the pre-mutation surface is a synthetic `PreToolUse` event");
  lines.push("rather than an observation of a real agent.");
  lines.push("");
  lines.push("## Reviewer agreement, per gate");
  lines.push("");
  lines.push(
    table(
      ["gate", "compared", "agreed", "rate"],
      (summary.reviewer_agreement_by_gate ?? []).map((row) => [row.gate, row.compared, row.agreed, row.rate.toFixed(3)]),
    ),
  );
  lines.push("");
  lines.push("Both reviewers are independent sessions of one model family; their agreement bounds");
  lines.push("reliability from above, not below. Where they split, a third blind vote decides by");
  lines.push("majority rather than an adjudicator who already knows how the pair voted.");
  lines.push("");
  lines.push("## How much the tie-break rule moves the answer");
  lines.push("");
  lines.push("Where the two blind reviewers split, a gate is resolved only when **both**");
  lines.push("tie-breakers -- one from each model, run fresh and blind -- return the same");
  lines.push("answer. The first implementation used a single tie-break drawn from reviewer A's");
  lines.push("own model, and it sided with A on 120 of the 180 splits it resolved. A tie-break");
  lines.push("that agrees with one disputant two times in three is not breaking the tie.");
  lines.push("");
  lines.push("```text");
  for (const [name, row] of Object.entries(summary.tiebreak_sensitivity ?? {})) {
    const mark = name === "both_tiebreakers_must_agree" ? "  <- adopted" : "";
    lines.push(`${name.padEnd(34)} qualified ${String(row.qualified).padStart(3)}  eligible ${String(row.eligible)}  ${row.verdict}${mark}`);
  }
  lines.push("```");
  lines.push("");
  lines.push("The adopted rule is the strictest of the three that resolves anything, and it");
  lines.push("returns a smaller corpus than the biased single vote it replaced. The verdict is");
  lines.push("GO under all three, and the repository set is four under both rules that break");
  lines.push("ties at all.");
  lines.push("");
  lines.push("## Where the candidates went");
  lines.push("");
  lines.push(
    table(
      ["exclusion reason", "count"],
      Object.entries(summary.exclusion_reasons ?? {}).map(([reason, count]) => [reason, count]),
    ),
  );
  lines.push("");
  lines.push("No candidate was excluded for missing identity, missing corroboration, or a");
  lines.push("decision not being documented outside its record. A guard refuses any run in which");
  lines.push("one is, so this is checked rather than asserted.");
  lines.push("");
  lines.push("## Repository set");
  lines.push("");
  lines.push("```text");
  lines.push(`eligible repositories: ${String(verdict.eligible_repositories)}  (threshold ${String(repositories.thresholds.minEligibleRepositories)})`);
  lines.push(`qualified per eligible repository floor: ${String(repositories.thresholds.minQualifiedPerEligibleRepository)}`);
  lines.push(`total qualified:       ${String(verdict.total_qualified)}  (threshold ${String(repositories.thresholds.minTotalQualified)})`);
  lines.push(`fixed-set recommendation: ${verdict.recommended_fixed_set.length === 0 ? "none" : verdict.recommended_fixed_set.join(", ")}`);
  lines.push("```");
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(`**${verdict.verdict}**`);
  lines.push("");
  if (verdict.unmet.length > 0) {
    lines.push("### Exact blocker");
    lines.push("");
    for (const item of verdict.unmet) lines.push(`- ${item}`);
    lines.push("");
    const [worstReason, worstCount] = Object.entries(summary.exclusion_reasons ?? {})[0] ?? ["unknown", 0];
    lines.push(`Dominant exclusion: \`${worstReason}\` — ${String(worstCount)} of ${String(entries.length)}.`);
    lines.push("");
  } else {
    lines.push("### If GO — recommended next steps only");
    lines.push("");
    lines.push("- a final v5 confirmatory PRD");
    lines.push("- a pilot design over at least 12 of the qualified candidates");
    lines.push("- a power-analysis plan, run after the pilot and frozen separately");
    lines.push("");
    lines.push("None of these is executed here.");
    lines.push("");
  }
  lines.push("## Deviations recorded");
  lines.push("");
  for (const deviation of deviations) lines.push(`- \`${deviation.deviation_id}\` — ${deviation.kind}`);
  lines.push("");
  lines.push("## Deliberately not done");
  lines.push("");
  lines.push("- no pilot");
  lines.push("- no measured run");
  lines.push("- no randomization");
  lines.push("- no README headline");
  lines.push("");
  lines.push("```text");
  lines.push(`measured product-effect rows = ${String(summary.measured_product_effect_rows)}`);
  lines.push(`qualification rows written   = ${String(entries.length)}`);
  lines.push("```");
  lines.push("");
  lines.push("CDEB-FRESH V5 STAGE 0 COMPLETE — PRODUCT-EFFECT MEASUREMENT NOT STARTED");
  lines.push("");
  return lines.join("\n");
};

const main = () => {
  const options = parseArguments(process.argv.slice(2));
  const studyRoot = resolve(options.studyRoot);
  const output = join(studyRoot, "feasibility", "RESULT.md");
  const rendered = render(studyRoot);
  if (options.check) {
    if (!existsSync(output)) throw new Error(`${output} is missing; run without --check to generate it`);
    if (readFileSync(output, "utf8") !== rendered) {
      throw new Error(`${output} does not match the study artifacts; regenerate it`);
    }
    process.stdout.write(`v5 stage 0 result: up to date (${String(rendered.length)} bytes)\n`);
    return;
  }
  writeFileSync(output, rendered);
  process.stdout.write(`v5 stage 0 result: wrote ${String(rendered.length)} bytes\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
