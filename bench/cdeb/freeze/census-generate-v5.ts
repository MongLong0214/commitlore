/**
 * Regenerates the census artifacts from the ledger, or checks them for drift.
 *
 * `--check` is the mode that matters. The census artifacts drifted once, in the
 * direction that flattered nothing in particular -- three overturned negatives
 * sat in the summary because the summary was maintained by hand and a pull
 * request's prose had become the source of truth. Nobody noticed for days,
 * because a stale number looks exactly like a fresh one.
 *
 * So the artifacts are derived and CI recomputes them. If the file on disk is
 * not what the ledger implies, the build fails and says which candidate moved.
 *
 * Usage:
 *   node --experimental-strip-types bench/cdeb/freeze/census-generate-v5.ts --study-root <dir> [--check]
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertAdjudicationConsistent, canonicalAdjudication, type RevivalAttempt } from "./adjudicate-v5.ts";
import {
  buildCensusReport,
  descriptiveResult,
  FLOOR_BUILDABLE_PER_REPOSITORY,
  FLOOR_CONFIRMATORY_RESERVE_TOTAL,
} from "./census-report-v5.ts";
import {
  assertBaselineIsSemantic,
  validateReceipt,
  type AcceptanceBaseline,
  type AcceptanceReceipt,
} from "./acceptance-receipt-v5.ts";
import {
  censusRowsFrom,
  reduceLedger,
  summarize,
  type CensusRow,
  type LedgerRow,
} from "./census-ledger-v5.ts";

/** A ledger row as stored: raw receipts, no validity claimed. */
type RawLedgerRow = Omit<LedgerRow, "attempts"> & {
  readonly attempts: readonly (Omit<RevivalAttempt, "receipt"> & { readonly receipt: AcceptanceReceipt })[];
};

interface Population {
  readonly candidate_id: string;
  readonly repository_id: string;
}

const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);

/**
 * The census row shape as registered in buildability-reasons.schema.json.
 *
 * The census and the G4 ledger speak different vocabularies on purpose. The
 * ledger records whether a wrong path is still buildable; the census records a
 * disposition from the closed nine-reason list the SSOT fixed in section 6.1.
 * G4 feeds the census only where it produces an exclusion -- passing G4 does not
 * make a candidate BUILDABLE, because BUILDABLE additionally needs a frozen
 * record-blind task, a validated oracle, two compliant controls and a firewall
 * manifest, none of which G4 says anything about.
 */
interface CensusFileRow {
  readonly schema_version: number;
  readonly study_id: string;
  readonly stage: string;
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly screen: unknown;
  disposition: string | null;
  decided_at: string | null;
  evidence: string | null;
  attempt_log_digest?: string | null;
}

/**
 * Digest of the attempts behind an exclusion.
 *
 * Taken over the attempts as recorded, which each carry a receipt holding
 * sha256 of the run's stdout and stderr. So the digest chains down to the bytes
 * the acceptance command actually produced rather than standing in for them.
 */
const attemptLogDigest = (attempts: unknown): string =>
  createHash("sha256").update(JSON.stringify(attempts)).digest("hex");

/** What each G4 disposition contributes to the census, if anything. */
const CENSUS_EXCLUSION: Readonly<Record<string, string | null>> = {
  // Violable is a precondition for BUILDABLE, not a grant of it.
  FUNCTIONALLY_VIOLABLE: null,
  NO_PASSING_REVIVAL_FOUND_WITHIN_SEARCH_BUDGET: "NOT_BUILDABLE:no-functionally-passing-violation",
  SEMANTIC_BOUNDARY_AMBIGUOUS: "NOT_BUILDABLE:record-semantic-boundary-ambiguous",
  FUNCTIONAL_ACCEPTANCE_NONDETERMINISTIC: "NOT_BUILDABLE:functional-acceptance-not-deterministic",
  ACCEPTANCE_SCOPE_CONFLICT: "NOT_BUILDABLE:scope-not-isolatable",
  ORACLE_NOT_BUILDABLE: "NOT_BUILDABLE:oracle-not-discriminative",
  TASK_NOT_BUILDABLE: "NOT_BUILDABLE:neutral-task-not-derivable",
  FIREWALL_NOT_BUILDABLE: "NOT_BUILDABLE:firewall-provenance-not-demonstrable",
  VOID_INVALID_ACCEPTANCE: null,
  OTHER_REGISTERED_REASON: null,
};

/** Dispositions only a G4 adjudication can produce, so only G4 may keep them. */
const G4_OWNED: ReadonlySet<string> = new Set(
  Object.values(CENSUS_EXCLUSION).filter((value): value is string => value !== null),
);

const stableJsonl = (rows: readonly CensusFileRow[]): string =>
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

/**
 * The human-readable report.
 *
 * Deliberately reports the negative under its full name every time it appears.
 * The short name is what travels, and the short name is the one that made a
 * bounded search sound like a property of the tree.
 */
const renderReport = (
  g4: Readonly<Record<string, number>>,
  byRepository: Readonly<Record<string, Readonly<Record<string, number>>>>,
  census: Readonly<Record<string, number>>,
  generatedFrom: string,
  floors: ReturnType<typeof buildCensusReport>,
): string => {
  const repositories = Object.keys(byRepository).sort();
  const total = Object.values(g4).reduce((sum, count) => sum + count, 0);
  const violable = g4["FUNCTIONALLY_VIOLABLE"] ?? 0;
  const adjudicated = total - (g4["VOID_INVALID_ACCEPTANCE"] ?? 0) - (g4["UNDECIDED"] ?? 0);
  return [
    "<!-- generated by bench/cdeb/freeze/census-generate-v5.ts; edit the ledger, not this file -->",
    "",
    "# CDEB-Fresh v5 — Stage 1-r1 G4 adjudication",
    "",
    `Derived from \`${generatedFrom}\`. Every number is recomputed from the`,
    "append-only adjudication ledger; nothing here is maintained by hand.",
    "",
    `- candidates: **${String(total)}**`,
    `- adjudicated: **${String(adjudicated)}**`,
    `- confirmed functionally violable: **${String(violable)}**`,
    adjudicated === 0
      ? "- observed functional violability rate: not computable yet"
      : `- observed functional violability rate: **${((violable / adjudicated) * 100).toFixed(0)}%**`,
    "",
    "## G4 adjudication",
    "",
    "| disposition | candidates |",
    "| --- | ---: |",
    ...Object.entries(g4)
      .sort(([, left], [, right]) => right - left)
      .map(([key, count]) => `| \`${key}\` | ${String(count)} |`),
    "",
    "## By repository",
    "",
    ...repositories.flatMap((repository) => [
      `### ${repository}`,
      "",
      ...Object.entries(byRepository[repository] ?? {})
        .sort(([, left], [, right]) => right - left)
        .map(([key, count]) => `- \`${key}\`: ${String(count)}`),
      "",
    ]),
    "## Census dispositions this produced",
    "",
    "| disposition | candidates |",
    "| --- | ---: |",
    ...Object.entries(census)
      .sort(([, left], [, right]) => right - left)
      .map(([key, count]) => `| \`${key ?? "null"}\` | ${String(count)} |`),
    "",
    "## Registered floor",
    "",
    `The estimand is an equal-weight average over four fixed repositories, so the floor is judged per`,
    `stratum: **${String(FLOOR_BUILDABLE_PER_REPOSITORY)}** functionally violable candidates in each, and`,
    `**${String(FLOOR_CONFIRMATORY_RESERVE_TOTAL)}** in the confirmatory reserve after the pilot takes three`,
    "from each. A pooled share is the wrong number to judge feasibility by: a corpus can be mostly violable",
    "overall and still fail, if the share is carried by the repositories with the most candidates.",
    "",
    `- verdict: **${floors.verdict}**`,
    `- confirmatory reserve: **${String(floors.confirmatory_reserve_total)}**`,
    "",
    "| repository | candidates | adjudicated | violable | meets floor | still needed |",
    "| --- | ---: | ---: | ---: | :-: | ---: |",
    ...floors.repositories.map(
      (r) =>
        `| ${r.repository_id} | ${String(r.candidates)} | ${String(r.adjudicated)} | ` +
        `${String(r.functionally_violable)} | ${r.meets_floor ? "yes" : "no"} | ${String(r.still_needed)} |`,
    ),
    "",
    ...(floors.reasons.length === 0 ? [] : ["Why it is not met:", "", ...floors.reasons.map((r) => `- ${r}`), ""]),
    floors.verdict === "INCOMPLETE"
      ? "The census is unfinished, so this is a progress report and not a result. The remaining candidates are " +
        "not a random sample of the finished ones -- the slowest repository finishes last, and it is the one " +
        "whose floor is least certain."
      : floors.verdict === "TERMINAL_HOLD"
        ? "TERMINAL_HOLD. The floors were registered before any candidate was adjudicated and do not move to " +
          "fit the corpus. Recomputing the study over the repositories that did qualify would be a different " +
          "study with the same name."
        : "The registered floors are met and the study may proceed to task and oracle freeze.",
    "",
    "## Descriptive result",
    "",
    descriptiveResult(floors),
    "",
    "## How to read these",
    "",
    "`NO_PASSING_REVIVAL_FOUND_WITHIN_SEARCH_BUDGET` is a statement about this",
    "search, not about the tree. Each one required at least three structurally",
    "distinct revival shapes to fail before it was recorded, and a shape nobody",
    "tried is not a shape that does not exist. An earlier revision of this study",
    "called the same outcome TREE_ENFORCED, which reads as a demonstrated",
    "property; it was not one, and the rename is the correction.",
    "",
    "`FUNCTIONALLY_VIOLABLE` is not BUILDABLE. It clears G4 and nothing else: a",
    "candidate still needs a record-blind frozen task, a validated oracle, two",
    "compliant controls and a firewall manifest before it can carry an episode.",
    "",
    "`VOID_INVALID_ACCEPTANCE` rows are adjudications whose acceptance run could",
    "not be verified. They are preserved and never reused, and the candidates",
    "they touched are counted as undecided rather than as negatives.",
    "",
    "Per-repository counts sit beside different acceptance commands and are not",
    "compared to each other: the commands differ in scope, so a lower violable",
    "rate may mean a stricter repository or a wider suite.",
    "",
  ].join("\n");
};

const main = (): number => {
  const argv = process.argv.slice(2);
  const rootIndex = argv.indexOf("--study-root");
  if (rootIndex === -1 || argv[rootIndex + 1] === undefined) {
    console.error("census-generate: --study-root <dir> is required");
    return 2;
  }
  const stage = join(argv[rootIndex + 1] as string, "stage1-r1");
  const check = argv.includes("--check");

  const ledgerPath = join(stage, "g4-adjudication.jsonl");
  // The generated files must not depend on how the generator was invoked. An
  // absolute --study-root put an absolute path into the summary and the report,
  // so the same ledger produced different bytes depending on the caller and the
  // drift check failed against artifacts that were not drifting.
  const ledgerLabel = "bench/cdeb/studies/cdeb-fresh-v5/stage1-r1/g4-adjudication.jsonl";
  const censusPath = join(stage, "buildability-census.jsonl");
  const summaryPath = join(stage, "buildability-summary.json");
  const reportPath = join(stage, "CENSUS-REPORT.md");

  // The ledger stores raw receipts, and validity is computed here rather than
  // stored. A ledger that carried `receipt_valid` would be a ledger whose writer
  // decides whether its own evidence counts, which is the arrangement the seven
  // voided verdicts came out of.
  const registered = JSON.parse(readFileSync(join(stage, "registered-acceptance.json"), "utf8")) as {
    repositories: Record<string, { command: string; command_sha256: string; cwd: string;
      expected_failure_ids: string[] | null;
      baseline: { total: number; passed: number; failed: number; skipped: number;
        expected_failure_ids: string[] } | null }>;
  };

  const rawLedger = readJsonl<RawLedgerRow>(ledgerPath);
  const ledger: LedgerRow[] = [];
  for (const [index, row] of rawLedger.entries()) {
    canonicalAdjudication(row.adjudication);
    const spec = registered.repositories[row.repository_id];
    const hydrated: LedgerRow = {
      ...row,
      attempts: row.attempts.map((attempt) => {
        if (spec?.baseline == null) {
          throw new Error(
            `census-generate: ${row.repository_id} has no registered baseline, so its receipts cannot be checked`,
          );
        }
        const baseline: AcceptanceBaseline = {
          repository_id: row.repository_id,
          total: spec.baseline.total,
          passed: spec.baseline.passed,
          failed: spec.baseline.failed,
          skipped: spec.baseline.skipped,
          expected_failure_ids: spec.baseline.expected_failure_ids,
          captured_at: "",
          tree_oid: "registered",
        };
        assertBaselineIsSemantic(baseline);
        return {
          ...attempt,
          receipt: validateReceipt(
            attempt.receipt,
            {
              repository_id: row.repository_id,
              command: spec.command,
              command_sha256: spec.command_sha256,
              cwd: spec.cwd,
              expected_failure_ids: spec.expected_failure_ids ?? [],
            },
            baseline,
          ),
        };
      }),
    };
    try {
      assertAdjudicationConsistent(hydrated);
    } catch (error) {
      console.error(
        `census-generate: ledger row ${String(index + 1)} (${row.candidate_id}) is not admissible -- ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
    ledger.push(hydrated);
  }

  // The census file is the frozen corpus and its screen data. The generator
  // rewrites only the three decision fields; everything else is carried through
  // untouched, because the screen was measured once and is not a function of
  // adjudication.
  const censusFile = readJsonl<CensusFileRow>(censusPath);
  const population: Population[] = censusFile.map((row) => ({
    candidate_id: row.candidate_id,
    repository_id: row.repository_id,
  }));

  const reduced = reduceLedger(ledger, population);
  const byCandidate = new Map(reduced.map((candidate) => [candidate.candidate_id, candidate]));

  const g4Counts: Record<string, number> = {};
  const byRepository: Record<string, Record<string, number>> = {};
  const censusCounts: Record<string, number> = {};

  const nextCensus: CensusFileRow[] = censusFile.map((row) => {
    const candidate = byCandidate.get(row.candidate_id);
    const g4 = candidate?.disposition ?? "UNDECIDED";
    g4Counts[g4] = (g4Counts[g4] ?? 0) + 1;
    byRepository[row.repository_id] ??= {};
    const bucket = byRepository[row.repository_id];
    if (bucket !== undefined) bucket[g4] = (bucket[g4] ?? 0) + 1;

    const exclusion = candidate?.disposition == null ? null : CENSUS_EXCLUSION[candidate.disposition] ?? null;
    const key = exclusion ?? "null";
    censusCounts[key] = (censusCounts[key] ?? 0) + 1;
    if (exclusion === null) {
      // Not decided by G4 now. A disposition the census carries on other
      // grounds -- a screen, a firewall finding -- stays: G4 has nothing to say
      // about it. But a disposition that only G4 can produce, with no current
      // G4 verdict behind it, is a verdict that was superseded and never
      // cleared. That is the drift this generator exists to end: three of these
      // sat in the summary for days after the adjudications behind them had
      // been overturned.
      if (row.disposition !== null && G4_OWNED.has(row.disposition)) {
        censusCounts["null"] = (censusCounts["null"] ?? 0) + 1;
        censusCounts[row.disposition] = (censusCounts[row.disposition] ?? 1) - 1;
        return { ...row, disposition: null, decided_at: null, evidence: null, attempt_log_digest: null };
      }
      return row;
    }
    return {
      ...row,
      disposition: exclusion,
      decided_at: candidate?.current?.adjudicated_at ?? row.decided_at,
      evidence:
        `G4 adjudication ${candidate?.disposition ?? ""} at ledger row for ${row.candidate_id}: ` +
        `${String(candidate?.current?.attempts.length ?? 0)} receipted attempt(s), ` +
        `${String(candidate?.superseded.length ?? 0)} superseded verdict(s). See g4-adjudication.jsonl.`,
      attempt_log_digest: attemptLogDigest(candidate?.current?.attempts ?? []),
    };
  });

  const floors = buildCensusReport(
    ledger.filter((row) => row.adjudication !== "VOID_INVALID_ACCEPTANCE"),
    population,
    Object.fromEntries(Object.entries(registered.repositories).map(([name, spec]) => [name, spec.command])),
  );

  const summary = {
    total: nextCensus.length,
    buildable: nextCensus.filter((row) => row.disposition === "BUILDABLE").length,
    not_buildable: nextCensus.filter((row) => (row.disposition ?? "").startsWith("NOT_BUILDABLE")).length,
    undecided: nextCensus.filter((row) => row.disposition === null).length,
    by_reason: nextCensus.reduce<Record<string, number>>((counts, row) => {
      if (!(row.disposition ?? "").startsWith("NOT_BUILDABLE")) return counts;
      const reason = (row.disposition as string).slice("NOT_BUILDABLE:".length);
      counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    }, {}),
  };

  const wanted: Array<readonly [string, string]> = [
    [censusPath, stableJsonl(nextCensus)],
    [
      summaryPath,
      JSON.stringify(
        {
          schema_version: 1,
          study_id: "cdeb-fresh-v5",
          stage: "stage1-r1",
          generated_from: ledgerLabel,
          census_complete: summary.undecided === 0,
          summary,
        },
        null,
        2,
      ) + "\n",
    ],
    [reportPath, renderReport(g4Counts, byRepository, censusCounts, ledgerLabel, floors)],
  ];

  if (!check) {
    for (const [path, content] of wanted) writeFileSync(path, content);
    console.log(`census-generate: wrote ${String(wanted.length)} artifact(s) from ${String(ledger.length)} ledger row(s)`);
    return 0;
  }

  const drifted: string[] = [];
  for (const [path, content] of wanted) {
    let actual = "";
    try {
      actual = readFileSync(path, "utf8");
    } catch {
      drifted.push(`${path} is missing`);
      continue;
    }
    if (actual !== content) drifted.push(path);
  }
  if (drifted.length > 0) {
    console.error(
      `census-generate: ${String(drifted.length)} artifact(s) do not match the ledger: ${drifted.join(", ")}. ` +
        `Regenerate with npm run bench:cdeb:v5:census -- the ledger is the source of truth and these files are not ` +
        `edited by hand`,
    );
    return 1;
  }
  console.log(`census-generate: artifacts match the ledger (${String(ledger.length)} row(s))`);
  return 0;
};

process.exit(main());
