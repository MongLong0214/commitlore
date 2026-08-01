import { writeFileSync } from 'node:fs';

import { renderEconomicCase } from './economics.ts';
import type {
  CaptureCostRow,
  DecisionDeliveryRow,
  DensityRow,
  DeterministicRow,
  GuardQualityRow,
  HookOverheadRow,
  IndexCostRow,
  InjectionDetectionRow,
  NoiseExposureRow,
  QueryLatencyRow,
  SurvivalRow,
} from './types.ts';

export const ADDRESSABILITY_STATEMENT =
  'This measures addressability, not abundance: prose rationale is not machine-addressable while structured trailers are.';

export const DENSITY_CITATIONS = [
  '[CoMRAT (MSR 2025)](https://arxiv.org/abs/2506.10986)',
  '[Commit Message Matters (ICSE 2023)](https://dl.acm.org/doi/abs/10.1109/ICSE48619.2023)',
  '[What Makes a Good Commit Message? (ICSE 2022)](https://arxiv.org/abs/2202.02974)',
  '[Linux OOM-Killer rationale dataset (ICPC 2024)](https://arxiv.org/abs/2403.18832)',
] as const;

export const SCOPE_SENTENCE =
  'These numbers say what CommitLore costs and what it catches. They say nothing about whether recorded context helps an agent; M4 is registered for that question and may still come back null.';

export const EXPOSURE_SCOPE_SENTENCE =
  'This section measures exposure only, not token cost, billed cost, or accuracy.';
export const DENSITY_SCOPE_SENTENCE =
  'These numbers measure structured addressability. They say nothing about semantic rationale abundance or agent benefit.';
export const DELIVERY_SCOPE_SENTENCE =
  'These numbers measure what each route hands a fresh agent before its first edit. Delivery is a ceiling on recovery: an agent cannot recover a record it was never given, and being given one is no evidence it was read. The method is registered in `bench/DECISION-DELIVERY.md`.';

export const percentile = (samples: readonly number[], proportion: number): number => {
  if (samples.length === 0) throw new Error('cannot take a percentile of zero samples');
  if (!(proportion > 0 && proportion <= 1)) {
    throw new Error(`percentile proportion must be in (0, 1], got ${proportion}`);
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(proportion * sorted.length) - 1] ?? Number.NaN;
};

const distinct = (
  rows: readonly DeterministicRow[],
  field: 'harness_commit' | 'dist_digest' | 'measured_at',
): readonly string[] => [...new Set(rows.map((row) => row[field]))].sort();

export const assertSingleProvenance = (rows: readonly DeterministicRow[]): void => {
  const commits = distinct(rows, 'harness_commit');
  const digests = distinct(rows, 'dist_digest');
  const measuredAt = distinct(rows, 'measured_at');
  const machines = new Set(
    rows.map(({ machine }) =>
      JSON.stringify([
        machine.platform,
        machine.release,
        machine.arch,
        machine.cpu,
        machine.logical_cpus,
        machine.memory_bytes,
        machine.node,
        machine.git,
      ]),
    ),
  );
  if (rows.length === 0) throw new Error('refusing to report an empty deterministic dataset');
  if (
    commits.length === 1 &&
    digests.length === 1 &&
    measuredAt.length === 1 &&
    machines.size === 1
  ) {
    return;
  }
  throw new Error(
    'refusing mixed deterministic provenance: ' +
      `${commits.length} harness_commit (${commits.join(', ')}); ` +
      `${digests.length} dist_digest (${digests.join(', ')}); ` +
      `${measuredAt.length} measured_at (${measuredAt.join(', ')}); ` +
      `${machines.size} machine descriptor(s)`,
  );
};

const fixed = (value: number, digits = 2): string => value.toFixed(digits);
const percent = (value: number): string => `${fixed(value * 100, 1)}%`;
const optionalPercent = (value: number | null): string => (value === null ? 'n/a' : percent(value));
const COMMIT_MSG_P50_MS = 185.85;
const PRE_TOOL_USE_P50_MS = 102.4;

const latencySection = (rows: readonly QueryLatencyRow[]): string[] => {
  if (rows.length === 0) return [];
  return [
    '## 1. Query latency at scale',
    '',
    'Method: one discarded warmup, then the stated run count per CLI command and mode. Indexed mode uses a completed rebuild; `--no-index` scans Git directly.',
    '',
    '| commits | records | command | mode | runs | p50 ms | p95 ms |',
    '|---:|---:|---|---|---:|---:|---:|',
    ...rows.map(
      (row) =>
        `| ${row.commits} | ${row.records} | ${row.command} | ${row.mode} | ${row.timing.runs} | ` +
        `${fixed(row.timing.p50_ms)} | ${fixed(row.timing.p95_ms)} |`,
    ),
    '',
  ];
};

const survivalSection = (rows: readonly SurvivalRow[]): string[] => {
  if (rows.length === 0) return [];
  return [
    '## 2. Record survival',
    '',
    'Method: history-retention rows count `Record-Id` values in `HEAD` with `historyCount`; path-reachability rows query the new path through the shipped CLI with `pathCount`. These are distinct outcomes and are never averaged.',
    '',
    'The local `squash-merge` row exercises the installed `prepare-commit-msg` hook. GitHub’s server-side squash button runs no local hook, remains uncovered, and still loses records. `rename-heavy-edit` is a path lookup miss, not preservation: its record remains in Git history and is retrievable by commit or `Record-Id`.',
    '',
    '| operation | outcome | counter | survived / total | rate |',
    '|---|---|---|---:|---:|',
    ...rows.map(
      (row) => `| ${row.operation} | ${row.outcome} | ${row.measurement} | ${row.survived} / ${row.total} | ${percent(row.rate)} |`,
    ),
    '',
  ];
};

const band = (value: number): string => fixed(value, 2);

const injectionSection = (rows: readonly InjectionDetectionRow[]): string[] => {
  const row = rows[0];
  if (row === undefined) return [];
  const adversarialRate =
    row.adversarial_total === 0 ? 0 : row.adversarial_detected / row.adversarial_total;
  return [
    '## 3. Injection detection',
    '',
    `Method: scan the labelled payload and benign-record corpus in \`${row.corpus}\` with the shipped \`INJECTION_PATTERNS\`.`,
    '',
    `This corpus is pattern-authored: the same people who wrote \`INJECTION_PATTERNS\` wrote the ` +
      'payloads scored against it, so a high score here shows the patterns match what their own ' +
      'authors anticipated — it is not a real-world detection-rate claim, and is not to be quoted ' +
      'as one (README included).',
    '',
    `True positives: **${row.true_positives}/${row.positives} (${percent(row.true_positive_rate)})**. ` +
      `False positives: **${row.false_positives}/${row.negatives} (${percent(row.false_positive_rate)})**. ` +
      `False negatives: ${row.false_negatives}; true negatives: ${row.true_negatives}.`,
    '',
    `A second, independently authored corpus (\`${row.adversarial_corpus}\`, ${row.adversarial_source}, ` +
      'written without reading `INJECTION_PATTERNS`) is reported separately, never combined with the ' +
      `figure above: **${row.adversarial_detected}/${row.adversarial_total} (${percent(adversarialRate)})** ` +
      'detected today. Before the #70 fix, that independently written set scored **4/6 (66.7%)** — the gap ' +
      'this suite exists to catch. Neither number estimates the scanner\'s real-world detection rate.',
    '',
  ];
};

const guardSection = (rows: readonly GuardQualityRow[]): string[] => {
  const row = rows[0];
  if (row === undefined) return [];
  return [
    '## 4. Guard precision and recall',
    '',
    `Method: replay the existing labelled task artifacts in \`${row.corpus}\` through the shipped guard across the full **0.00–1.00** score range in **${row.curve_step.toFixed(2)}** steps. The shipped default is **${row.threshold}**.`,
    '',
    `Corpus limit: **${row.true_positives + row.false_positives + row.false_negatives + row.true_negatives} labelled decisions**. At the default, precision is ${row.true_positives}/${row.firings}; its 95% Wilson interval is **${percent(row.precision_interval.lower)}–${percent(row.precision_interval.upper)}**.`,
    '',
    '| threshold | precision | recall | F1 | firings | correct silences |',
    '|---:|---:|---:|---:|---:|---:|',
    ...row.curve.map(
      (entry) =>
        `| ${fixed(entry.threshold)} | ${optionalPercent(entry.precision)} | ${percent(entry.recall)} | ` +
        `${optionalPercent(entry.f1)} | ${entry.firings} | ${entry.correct_silences} |`,
    ),
    '',
    '| score band | firings | correct |',
    '|---|---:|---:|',
    ...row.bands
      .slice()
      .reverse()
      .map(
        (entry) =>
          `| [${band(entry.min)}, ${band(entry.max)}${entry.max >= 1 ? ']' : ')'} | ${entry.firings} | ${entry.correct} |`,
      ),
    '',
    `Default-point recall: **${percent(row.recall)}** (${row.true_positives} TP, ${row.false_negatives} FN). ` +
      `Correct silence: ${row.true_negatives}.`,
    'Ground truth is the frozen corpus label; the suite does not relabel archived agent output after seeing the guard result.',
    'No guard precision figure is carried into the README until the corpus is large enough for one to mean something.',
    '',
  ];
};

const hookSection = (rows: readonly HookOverheadRow[]): string[] => {
  if (rows.length === 0) return [];
  return [
    '## 5. Hook overhead',
    '',
    'Method: time the same operation with and without the installed hook after one discarded warmup; commit-msg wraps an empty Git commit, and PreToolUse wraps the same file write with the shipped inject hook.',
    '',
    '| hook | runs | without p50 / p95 ms | with p50 / p95 ms | delta p50 / p95 ms |',
    '|---|---:|---:|---:|---:|',
    ...rows.map(
      (row) =>
        `| ${row.hook} | ${row.with_hook.runs} | ${fixed(row.without_hook.p50_ms)} / ` +
        `${fixed(row.without_hook.p95_ms)} | ${fixed(row.with_hook.p50_ms)} / ` +
        `${fixed(row.with_hook.p95_ms)} | ${fixed(row.delta_p50_ms)} / ${fixed(row.delta_p95_ms)} |`,
    ),
    '',
  ];
};

const captureSection = (rows: readonly CaptureCostRow[]): string[] => {
  if (rows.length === 0) return [];
  return [
    '## 6. Record capture cost',
    '',
    'Method: run the shipped local `harvest --prompt-only` and `harvest-verify --json` commands against the truthful harvest-verifier fixture after one discarded warmup; the harvest contract is what the session receives and verification input is the draft, transcript, and diff it re-reads.',
    '',
    '| fixture | accepted / rejected records | harvest bytes / tokens | harvest p50 / p95 ms | verify bytes / tokens | verify p50 / p95 ms | cache-read bytes / tokens | marginal / including-cache tokens per accepted record |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(
      (row) =>
        `| ${row.fixture} | ${row.accepted_records} / ${row.rejected_records} | ` +
        `${row.harvest.output_bytes} / ${row.harvest.output_tokens} | ` +
        `${fixed(row.harvest.timing.p50_ms)} / ${fixed(row.harvest.timing.p95_ms)} | ` +
        `${row.verify.input_bytes} / ${row.verify.input_tokens} | ` +
        `${fixed(row.verify.timing.p50_ms)} / ${fixed(row.verify.timing.p95_ms)} | ` +
        `${row.cache_read.input_bytes} / ${row.cache_read.input_tokens} | ` +
        `${fixed(row.marginal_tokens_per_accepted_record)} / ` +
        `${fixed(row.tokens_including_cache_reads_per_accepted_record)} |`,
    ),
    '',
    'The two floors bracket the same deterministic work. Marginal tokens exclude the transcript and diff that verification re-reads after harvest already supplied them; including-cache tokens count that prefix again. A cache-aware bill charges such reads at a fraction of the full input rate, so the figures do not contradict each other.',
    '',
    'Model generation tokens are not measured: this benchmark makes no model call, so the model\'s cost to compose a draft sits on top of both floors.',
    '',
    ...rows.map(
      (row) =>
        `The denominator is ${row.accepted_records} accepted record(s); this fixture had ${row.rejected_records} rejected record(s). A rejected draft that is rewritten raises verification input tokens while the accepted-record denominator stays fixed.`,
    ),
    '',
    ...rows.map(
      (row) =>
        `Common commit cost: a commit with no record pays the existing \`commit-msg\` p50 overhead of **${fixed(COMMIT_MSG_P50_MS)} ms**. ` +
        `A record-bearing commit has a **${fixed(COMMIT_MSG_P50_MS + row.harvest.timing.p50_ms + row.verify.timing.p50_ms)} ms** serial p50 component sum ` +
        '(commit-msg + harvest + verify); it is not a jointly sampled percentile. ' +
        `The separate PreToolUse injection p50 is **${fixed(PRE_TOOL_USE_P50_MS)} ms**. ` +
        'Both existing hook figures are cited from `bench/results/deterministic-20260727T174801Z.md`, not remeasured here.',
    ),
    '',
  ];
};

const indexSection = (rows: readonly IndexCostRow[]): string[] => {
  if (rows.length === 0) return [];
  return [
    '## 7. Index cost',
    '',
    'Method: rebuild the derived index once in each fresh synthetic history, time the rebuild, then measure the on-disk database size after the process exits.',
    '',
    '| commits | records | build ms | size bytes | bytes / record |',
    '|---:|---:|---:|---:|---:|',
    ...rows.map(
      (row) =>
        `| ${row.commits} | ${row.records} | ${fixed(row.build_ms)} | ${row.size_bytes} | ` +
        `${fixed(row.bytes_per_record)} |`,
    ),
    '',
  ];
};

const exposureSection = (rows: readonly NoiseExposureRow[]): string[] => {
  if (rows.length === 0) return [];
  return [
    '## 8. Irrelevant decision-context exposure',
    '',
    EXPOSURE_SCOPE_SENTENCE,
    '',
    'Fixture: exactly two active records apply to `src/core/decision-context.ts`; each corpus adds the stated fixed-seed distractors with the same trailer vocabulary, plausible repository paths, and overlapping decision-context language.',
    'Routes: `inject everything`; `top-k lexical` (k=2, case-insensitive query-token frequency over path and record text); and the shipped CommitLore injection path scope plus lifecycle filter. The current CLI has neither a pointer nor pull delivery route, so neither is simulated here.',
    '',
    '| distractors | corpus records | route | model-visible records | model-visible tokens | relevant density | runs | p50 ms | p95 ms |',
    '|---:|---:|---|---:|---:|---|---:|---:|---:|',
    ...rows.map((row) => {
      const density = row.visible_records === 0 ? 0 : row.relevant_records / row.visible_records;
      return `| ${row.distractors} | ${row.corpus_records} | ${row.route} | ${row.visible_records} | ` +
        `${row.visible_tokens} | ${row.relevant_records} of ${row.visible_records} (${percent(density)}) | ` +
        `${row.timing.runs} | ${fixed(row.timing.p50_ms)} | ${fixed(row.timing.p95_ms)} |`;
    }),
    '',
  ];
};

const POPULATION_LABEL: { readonly [K in DecisionDeliveryRow['population']]: string } = {
  authored: 'authored paths (`.gitattributes` generated paths excluded)',
  'all-tracked': 'every tracked path, generated included',
};

const deliveryTable = (rows: readonly DecisionDeliveryRow[]): string[] => [
  '| route | budget | path recall | macro path recall | repo-wide recall | precision | stale delivered | stale share | delivered records | delivered tokens | paths at 1.0 | paths at 0 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...rows.map(
    (row) =>
      `| ${row.route} | ${row.budget_tokens === null ? '—' : row.budget_tokens} | ` +
      `**${percent(row.path_recall)}** | ${percent(row.macro_path_recall)} | ${percent(row.repo_recall)} | ` +
      `${percent(row.precision)} | ${row.stale_delivered} | ${percent(row.stale_share)} | ` +
      `${row.delivered_total} | ${row.delivered_tokens} | ${row.paths_complete} | ${row.paths_zero} |`,
  ),
  '',
];

const deliverySection = (rows: readonly DecisionDeliveryRow[]): string[] => {
  const first = rows[0];
  if (first === undefined) return [];
  const census = first.census;
  const populations = [...new Set(rows.map((row) => row.population))];
  return [
    '## 9. Active-record delivery before the first edit',
    '',
    DELIVERY_SCOPE_SENTENCE,
    '',
    `Method: build an answer key from \`git log ${first.history_ref}\` with Git's own trailer parser and a second implementation of the SPEC §5 lifecycle fold (\`bench/deterministic/census.ts\`, which imports nothing from the product). Fold at **${first.evaluated_at}**, HEAD's committer instant, which is also the instant the projections evaluate at. Then, for every evaluation path, hand each route its text and count the record ids in it. A record is recovered when its id appears; there is no partial credit.`,
    '',
    `Corpus: **${census.records} records** over ${census.commits_examined} commits (${census.merge_commits} merges, ${census.record_bearing_commits} carrying a record) — **${census.active_records} active, ${census.superseded_records} superseded, ${census.expired_records} expired**. ${census.tracked_paths} paths are tracked at HEAD and ${census.generated_paths} of them are declared generated by the repository's own \`.gitattributes\`.`,
    '',
    `Answer-key checks: the block walk resolved ${census.supersedes_trailers_parsed} \`Supersedes:\` trailer(s) against ${census.supersedes_lines_scanned} found by a raw line scan of the same messages, and ${census.expires_trailers_parsed} \`Expires:\` against ${census.expires_lines_scanned}. ${census.records_without_paths} record(s) sit on commits that changed no path — a merge changes none — so no path-scoped route can reach them.`,
    '',
    ...populations.flatMap((population) => {
      const scoped = rows.filter((row) => row.population === population);
      const head = scoped[0];
      if (head === undefined) return [];
      return [
        `**Population: ${POPULATION_LABEL[population]}.** ${head.evaluation_paths} of ${head.candidate_paths} candidate paths carry at least one active record; the other ${head.paths_without_active_record} have a \`0/0\` recall and are not scored. The primary denominator is **${head.path_active_total}** (path, active record) pairs, of which ${head.rename_only_attachments} are reachable only through a rename. The repository-wide denominator is ${head.repo_active_total} active records per path.`,
        '',
        ...deliveryTable(scoped),
      ];
    }),
    'Path recall is the primary figure and its denominator is the active records attached to the path being edited. Repo-wide recall uses every active record in the repository as the denominator for every path; it is reported so the denominator choice is auditable, not because it is the right question to ask of a path-scoped route.',
    '',
    'The stale column is the error term the issue asks for: a record the repository has retired and a route surfaced anyway.',
    '',
  ];
};

const densitySection = (rows: readonly DensityRow[]): string[] => {
  const row = rows[0];
  if (row === undefined) return [];
  return [
    '## 10. Addressable rationale density',
    '',
    `Method: \`git log ${row.history_ref}\` supplies commit messages at run time. Git parses each record block; the denominator is non-empty body lines, excluding the subject.`,
    '',
    `CoMRAT defines rationale density and decision density with rationale and decision sentences per commit message (${DENSITY_CITATIONS[0]}). This benchmark does not infer those semantic sentences: it reports structured trailer lines and record-bearing messages instead.`,
    '',
    '| population | commits examined | commits carrying a record | record-bearing rate | structured trailers | trailers / commit | structured trailer share of non-empty body lines |',
    '|---|---:|---:|---:|---:|---:|---:|',
    `| all commits | ${row.commits_examined} | ${row.record_bearing_commits} | ${percent(row.record_bearing_rate)} | ${row.structured_trailers} | ${fixed(row.trailers_per_commit)} | ${percent(row.structured_trailer_line_share)} |`,
    `| authored (non-merge) commits | ${row.authored_commits} | ${row.authored_record_bearing_commits} | ${percent(row.authored_record_bearing_rate)} | — | — | — |`,
    '',
    `Merge commits: ${row.merge_commits} of ${row.commits_examined} examined. This repository merges with \`--no-ff\`, so merge commits are generated by policy and carry no record by design.`,
    '',
    ADDRESSABILITY_STATEMENT,
    `The Linux OOM-Killer dataset reports 98.9% of commits containing a rationale sentence (${DENSITY_CITATIONS[3]}), above this repository's ${percent(row.record_bearing_rate)} record-bearing rate across all commits (${percent(row.authored_record_bearing_rate)} among authored non-merge commits); CommitLore does not claim more rationale than that disciplined project. The Linux figure counts rationale sentences while this figure counts record-bearing messages — the units differ.`,
    '',
    `Published context: roughly 44% of commit messages omit either the what or the why (${DENSITY_CITATIONS[1]}; ${DENSITY_CITATIONS[2]}).`,
    '',
  ];
};

export const renderDeterministicReport = (rows: readonly DeterministicRow[]): string => {
  assertSingleProvenance(rows);
  const first = rows[0];
  if (first === undefined) throw new Error('unreachable empty dataset');
  const machine = first.machine;
  // A single-metric dataset is not a suite. The economic case summarises costs
  // from another run's file, and appending it to a one-metric report attaches
  // figures the reader did not ask for and this dataset did not produce.
  const metrics = new Set(rows.map((row) => row.metric));
  const lines = [
    '# CommitLore deterministic measurements',
    '',
    `Provenance: commit \`${first.harness_commit}\`; dist sha256 \`${first.dist_digest}\`.`,
    '',
    `Machine: ${machine.cpu}, ${machine.logical_cpus} logical CPUs, ` +
      `${fixed(machine.memory_bytes / 1024 ** 3, 1)} GiB RAM, ${machine.platform} ${machine.release} ` +
      `(${machine.arch}), Node ${machine.node}, ${machine.git}.`,
    '',
    rows.every((row) => row.metric === 'rationale_density')
      ? DENSITY_SCOPE_SENTENCE
      : rows.every((row) => row.metric === 'decision_delivery')
        ? DELIVERY_SCOPE_SENTENCE
        : SCOPE_SENTENCE,
    '',
    ...latencySection(rows.filter((row): row is QueryLatencyRow => row.metric === 'query_latency')),
    ...survivalSection(rows.filter((row): row is SurvivalRow => row.metric === 'record_survival')),
    ...injectionSection(
      rows.filter((row): row is InjectionDetectionRow => row.metric === 'injection_detection'),
    ),
    ...guardSection(rows.filter((row): row is GuardQualityRow => row.metric === 'guard_quality')),
    ...hookSection(rows.filter((row): row is HookOverheadRow => row.metric === 'hook_overhead')),
    ...captureSection(rows.filter((row): row is CaptureCostRow => row.metric === 'capture_cost')),
    ...indexSection(rows.filter((row): row is IndexCostRow => row.metric === 'index_cost')),
    ...exposureSection(rows.filter((row): row is NoiseExposureRow => row.metric === 'noise_exposure')),
    ...deliverySection(
      rows.filter((row): row is DecisionDeliveryRow => row.metric === 'decision_delivery'),
    ),
    ...densitySection(rows.filter((row): row is DensityRow => row.metric === 'rationale_density')),
    ...(metrics.size === 1 ? [] : renderEconomicCase()),
  ];
  return `${lines.join('\n').trim()}\n`;
};

export const writeDeterministicReport = (
  path: string,
  rows: readonly DeterministicRow[],
): void => {
  writeFileSync(path, renderDeterministicReport(rows));
};
