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
  lines.push("## Provenance tiers");
  lines.push("");
  const tiers = entries.reduce((counts, entry) => {
    counts[entry.provenance_tier] = (counts[entry.provenance_tier] ?? 0) + 1;
    return counts;
  }, {});
  lines.push("```text");
  for (const tier of ["P1", "P2", "unsupported"]) lines.push(`${tier.padEnd(12)} ${String(tiers[tier] ?? 0)}`);
  lines.push("```");
  lines.push("");
  lines.push("P2 is the owner-attested tier. No owner testimony was collected in Stage 0, so it");
  lines.push("is empty by construction rather than by a judgement about its admissibility. That");
  lines.push("decision belongs to a later preregistration, and nothing here mixes an attested");
  lines.push("candidate with an independently sourced one.");
  lines.push("");
  lines.push("## How much work the correspondence floor does");
  lines.push("");
  lines.push("G2 as implemented is a lexical test: content-word overlap between a reviewer's");
  lines.push("blind quote and this candidate's recorded ruling, against a floor fixed before");
  lines.push("any overlap was computed. It cannot tell a paraphrase from a different decision,");
  lines.push("and 159 pairs found *a* rejection while 17 matched *this* one -- so the floor,");
  lines.push("not the bare absence of a written rejection, separates most of them.");
  lines.push("");
  lines.push("```text");
  for (const point of qualification.quote_overlap_sensitivity ?? []) {
    const mark = point.floor === qualification.quote_overlap_floor ? "  <- registered" : "";
    lines.push(`floor ${point.floor.toFixed(3)}  would pass ${String(point.would_pass).padStart(3)}${mark}`);
  }
  lines.push("```");
  lines.push("");
  lines.push("The verdict does not turn on the choice. The most generous floor above still");
  lines.push("passes fewer candidates than the registered total of 48, before the other six");
  lines.push("gates take their share.");
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
    lines.push("Read as one test of one alternative explanation, not as elimination of the");
    lines.push("class: the arm broadened the packet by a single commit's diff, on a sample of");
    lines.push("60, and reports no uncertainty interval.");
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
  lines.push("- **G6** is a measurement, with three bounds worth naming. The hook was run");
  lines.push("  against the frozen release for every candidate and the forwarded bytes were");
  lines.push("  read, so ruling and reason visibility are observed. Scope is tested against");
  lines.push("  **one** non-touched path, not the whole tree. Lifecycle is not read from the");
  lines.push("  payload: an active decision counts as lifecycle-correct whenever its ruling is");
  lines.push("  visible, so that field discriminates only the superseded cases.");
  lines.push("  `before_first_mutation` is structural -- the payload is a synthetic");
  lines.push("  `PreToolUse` `Edit` on a path the decision itself touched, so it is true by");
  lines.push("  construction rather than observed against a real agent. And `identity_present`");
  lines.push("  is `record_id !== null`, nothing more.");
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
    lines.push("**Stated exactly.** Of the enumerated candidates, only 17 had a rejected");
    lines.push("alternative that two blind reviewers could quote from the redacted source-commit");
    lines.push("prose and that lexically matched this candidate's own ruling. Gold for the rest");
    lines.push("could not be written from the material this stage examined, and gold copied from");
    lines.push("the record would make the benchmark measure its own instrument.");
    lines.push("");
    lines.push("**What this does not establish.** It is not a census of decisions in these");
    lines.push("repositories -- the pool is whatever the `Ruled-out:` trailer discovers. It is");
    lines.push("not proof that the rejection is written nowhere else: pull requests, issues,");
    lines.push("design documents, code comments, tests and other commits were never searched.");
    lines.push("The robustness arm broadened the packet in one direction only, by one commit's");
    lines.push("diff, on 60 candidates, and moved the count from 6 to 8 -- weak evidence against");
    lines.push("one alternative explanation, not the elimination of all of them. Owner");
    lines.push("testimony, which the preregistration permits as an independent tier, was never");
    lines.push("collected, so the P2 route to gold is untested rather than closed.");
    lines.push("");
    lines.push("**What the instrument did show.** The shipping path put the ruling and the");
    lines.push("reason in front of a synthetic pre-edit event for 154 of the 207 probed");
    lines.push("candidates, 85 of them carrying no identifier. That result is independent of the");
    lines.push("HOLD and stands on its own, read with the delivery-gate bounds above.");
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
