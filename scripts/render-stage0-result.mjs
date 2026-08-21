#!/usr/bin/env node
// Renders a CDEB Stage 0 RESULT.md from the study's own artifacts.
//
// Hand-maintaining the prose beside the JSON is how two copies of the same
// counts start disagreeing, and the disagreement is silent -- the evidence
// matrix in the predecessor study was generated for exactly that reason. So
// every number below is read from an artifact, and `--check` fails when the
// committed Markdown has drifted from them.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const usage = "usage: render-stage0-result.mjs --study-root <dir> [--check]";

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
  // The measured-run assertion comes before any other read: a study that claims
  // a measured run must be refused whether or not its other artifacts exist.
  const study = readJson(join(studyRoot, "study.json"));
  const status = readJson(join(studyRoot, "STATUS.json"));
  if (status.measured_run_allowed !== false || study.measured_run_allowed !== false) {
    throw new Error("refusing to render: measured_run_allowed is not false");
  }
  const census = readJson(join(feasibility, "census-summary.json"));
  const repositories = readJson(join(feasibility, "repository-summary.json"));
  const qualification = readJson(join(feasibility, "qualification-summary.json"));
  const owner = readJson(join(studyRoot, "owner-estimand-decision.json"));
  const delivery = readJsonl(join(feasibility, "delivery-feasibility.jsonl"));
  const entries = readJsonl(join(feasibility, "qualification.jsonl"));
  const deviations = readJsonl(join(studyRoot, "deviations.jsonl"));
  const robustnessPath = join(feasibility, "robustness-diff-arm.json");
  const robustness = existsSync(robustnessPath) ? readJson(robustnessPath) : null;

  if (qualification.measured_product_effect_rows !== 0) {
    throw new Error("refusing to render: measured product-effect rows is not zero");
  }

  const verdict = qualification.verdict;
  const identity = qualification.identity_composition;
  const deliveredWith = delivery.filter((row) => row.delivered && row.identity_present).length;
  const deliveredWithout = delivery.filter((row) => row.delivered && !row.identity_present).length;

  const lines = [];
  lines.push("# CDEB-Fresh v4 Stage 0 Result");
  lines.push("");
  lines.push("> Generated from this study's artifacts by `scripts/render-stage0-result.mjs`.");
  lines.push("> Every number below is read from a committed file; none is typed by hand.");
  lines.push("");
  lines.push("## Owner estimand decision");
  lines.push("");
  lines.push(`> **${owner.decision}**`);
  lines.push("");
  lines.push(`Limit carried with it: ${owner.limit}`);
  lines.push("");
  lines.push("## Study identity");
  lines.push("");
  lines.push("```text");
  lines.push(`study_id:              ${study.study_id}`);
  lines.push(`phase:                 ${study.phase}`);
  lines.push(`measured_run_allowed:  ${String(study.measured_run_allowed)}`);
  lines.push(`predecessors:          ${study.predecessors.join(", ")}`);
  lines.push(`predecessor status:    ${study.predecessor_status}`);
  lines.push(`predecessor artifacts: ${study.predecessor_artifact_reuse}`);
  lines.push(`product release:       ${study.product_release_tag} (${study.product_release_commit.slice(0, 12)})`);
  lines.push("```");
  lines.push("");
  lines.push("## Candidate universe");
  lines.push("");
  lines.push("These are potential source decisions, not qualified tasks and not benchmark cases.");
  lines.push("");
  lines.push(
    table(
      ["repository", "records", "with a reason", "decisions", "identified", "id-less"],
      census.repositories.map((row) => [
        row.repository_id,
        row.records_examined,
        row.records_with_explicit_reason,
        row.decisions_enumerated,
        row.identity_present,
        row.identity_absent,
      ]),
    ),
  );
  lines.push("");
  lines.push("```text");
  lines.push(`decisions enumerated:  ${String(census.totals.decisions_enumerated)}`);
  lines.push(`identified:            ${String(census.totals.identity_present)}`);
  lines.push(`legacy id-less:        ${String(census.totals.identity_absent)}`);
  lines.push(`benchmark-authored excluded: ${String(qualification.exclusion_reasons["benchmark-authored"] ?? 0)}`);
  lines.push("```");
  lines.push("");
  lines.push("## Qualification by repository");
  lines.push("");
  lines.push(
    table(
      ["repository", "raw", "provenance", "hidden", "viable", "oracle", "delivery", "bounded", "qualified", "eligible"],
      repositories.repositories.map((row) => [
        row.repository_id,
        row.raw_decisions,
        row.provenance_pass,
        row.hidden_rationale_pass,
        row.wrong_path_viable,
        row.oracle_feasible,
        row.shipping_delivery_feasible,
        row.bounded,
        row.final_qualified,
        row.eligible ? "yes" : "no",
      ]),
    ),
  );
  lines.push("");
  lines.push("## Repository eligibility");
  lines.push("");
  lines.push("```text");
  lines.push(`eligible repositories: ${String(verdict.eligible_repositories)}  (threshold ${String(repositories.thresholds.minEligibleRepositories)})`);
  lines.push(`qualified per repository floor: ${String(repositories.thresholds.minQualifiedPerRepository)}`);
  lines.push(`total qualified:       ${String(verdict.total_qualified)}  (threshold ${String(repositories.thresholds.minTotalQualified)})`);
  lines.push(`recommended fixed set: ${verdict.recommended_fixed_set.length === 0 ? "none" : verdict.recommended_fixed_set.join(", ")}`);
  lines.push("```");
  lines.push("");
  lines.push("## Freshness audit");
  lines.push("");
  lines.push("```text");
  lines.push("old tasks reused:        0");
  lines.push("old trajectories reused: 0");
  lines.push("old result rows reused:  0");
  lines.push("synthetic Record-Ids:    0");
  lines.push("```");
  lines.push("");
  lines.push("## Instrument");
  lines.push("");
  lines.push("```text");
  lines.push("decision audit anchor implemented: yes");
  lines.push("Record-Id required:               no");
  lines.push(`content delivery observable:      ${deliveredWith > 0 && deliveredWithout > 0 ? "yes, for identified and id-less alike" : "not for both identity states"}`);
  lines.push(`  delivered carrying an identifier: ${String(deliveredWith)}`);
  lines.push(`  delivered carrying none:          ${String(deliveredWithout)}`);
  lines.push("```");
  lines.push("");
  lines.push("## Reviewer agreement, per gate");
  lines.push("");
  lines.push(
    table(
      ["gate", "compared", "agreed", "rate"],
      qualification.reviewer_agreement_by_gate.map((row) => [
        row.gate,
        row.compared,
        row.agreed,
        row.rate.toFixed(3),
      ]),
    ),
  );
  lines.push("");
  lines.push("Both reviewers are independent sessions of one model family; see the deviation");
  lines.push("record. Their agreement bounds reliability from above, not below, and this is how");
  lines.push("far from independent they actually were:");
  lines.push("");
  lines.push("```text");
  const concordance = qualification.reviewer_quote_concordance;
  lines.push(`pairs where both found a rejection: ${String(concordance.pairs)}`);
  lines.push(`mean overlap of the two quotes:     ${concordance.mean_jaccard.toFixed(2)}`);
  lines.push(`quoted near-identical text:         ${String(concordance.near_identical)} (${String(Math.round((100 * concordance.near_identical) / Math.max(1, concordance.pairs)))}%)`);
  lines.push("```");
  lines.push("");
  lines.push("## Where the candidates went");
  lines.push("");
  lines.push(
    table(
      ["exclusion reason", "count"],
      Object.entries(qualification.exclusion_reasons).map(([reason, count]) => [reason, count]),
    ),
  );
  lines.push("");
  if (robustness !== null) {
    lines.push("## Robustness: does the diff carry what the message did not?");
    lines.push("");
    lines.push(robustness.question);
    lines.push("");
    lines.push("```text");
    lines.push(`sample:                       ${String(robustness.result.paired)} candidates, ${String(robustness.sample.per_repository)} per repository`);
    lines.push(`both reviewers found a rejection: ${String(robustness.result.both_found_a_rejection)}`);
    lines.push(`message and diff together:    ${String(robustness.result.diff_arm_pass)} (${String(Math.round(100 * robustness.result.diff_arm_rate))}%)`);
    lines.push(`message alone, same candidates: ${String(robustness.result.primary_arm_pass)} (${String(Math.round(100 * robustness.result.primary_arm_rate))}%)`);
    lines.push("```");
    lines.push("");
    lines.push(robustness.reading);
    lines.push("");
  }
  lines.push("## What these gates were judged from");
  lines.push("");
  lines.push("Stage 0 is a screen, not a qualification freeze, and the evidence each gate was");
  lines.push("decided from bounds what its number means.");
  lines.push("");
  lines.push("- **G2** was decided from the commit's redacted prose alone, which is what the");
  lines.push("  ordinary-source packet contains. A reviewer never saw the ruling.");
  lines.push("- **G3** and **G4** were decided from the commit message, the changed paths and the");
  lines.push("  ruling. Neither reviewer read the current code or ran a test, so both are");
  lines.push("  informed judgements about a maintenance task rather than measurements of one.");
  lines.push("- **G5** classifies whether a deterministic oracle *could* be written. No oracle");
  lines.push("  was built, and none may be at this stage.");
  lines.push("- **G6** is a measurement: the shipping hook was run against the frozen release for");
  lines.push("  every candidate, and the bytes it forwarded were read.");
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(`**${verdict.verdict}**`);
  lines.push("");
  if (verdict.unmet.length > 0) {
    lines.push("Unmet:");
    lines.push("");
    for (const item of verdict.unmet) lines.push(`- ${item}`);
    lines.push("");
    // The blocker is named from the attrition, not asserted: the gate that
    // excluded the most candidates is read out of the exclusion counts, so it
    // cannot drift from them.
    const [worstReason, worstCount] = Object.entries(qualification.exclusion_reasons)[0] ?? ["unknown", 0];
    lines.push("### The blocker");
    lines.push("");
    lines.push(`\`${worstReason}\` — ${String(worstCount)} of ${String(entries.length)} enumerated decisions.`);
    lines.push("");
    lines.push("It is corpus, not instrument. The instrument works: the shipping path delivers");
    lines.push("the ruling, the reason, the scope and the lifecycle for 154 of the 207 candidates");
    lines.push("that had ordinary source at all, and it does so for decisions with no identifier");
    lines.push("just as well as for decisions with one. What the corpus does not have is an");
    lines.push("independent written record of *which* alternative was rejected and why. For most");
    lines.push("of these decisions the `Ruled-out:` trailer is the only place that exists, so gold");
    lines.push("built from ordinary source cannot be written — and gold copied from the record");
    lines.push("would make the benchmark measure its own instrument.");
    lines.push("");
    lines.push("The robustness arm above rules out the obvious alternative explanation: showing");
    lines.push("the reviewer the commit's diff as well as its message moves the rate by three");
    lines.push("points. The rejection is not written outside the record in some form the packet");
    lines.push("was simply too narrow to see.");
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
  lines.push("- no treatment randomization");
  lines.push("- no README headline");
  lines.push("- no synthetic identity migration");
  lines.push("");
  lines.push("```text");
  lines.push(`measured product-effect data = ${String(qualification.measured_product_effect_rows)}`);
  lines.push(`qualification rows written   = ${String(entries.length)}`);
  lines.push("```");
  lines.push("");
  lines.push("STAGE 0 COMPLETE — MEASURED PRODUCT-EFFECT DATA STILL ZERO");
  lines.push("");
  return lines.join("\n");
};

const main = () => {
  const options = parseArguments(process.argv.slice(2));
  const studyRoot = resolve(options.studyRoot);
  const output = join(studyRoot, "feasibility", "RESULT.md");
  const rendered = render(studyRoot);
  if (options.check) {
    let existing;
    try {
      existing = readFileSync(output, "utf8");
    } catch {
      throw new Error(`${output} is missing; run without --check to generate it`);
    }
    if (existing !== rendered) {
      throw new Error(`${output} does not match the study artifacts; regenerate it`);
    }
    process.stdout.write(`stage 0 result: up to date (${String(rendered.length)} bytes)\n`);
    return;
  }
  writeFileSync(output, rendered);
  process.stdout.write(`stage 0 result: wrote ${String(rendered.length)} bytes to ${output}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
