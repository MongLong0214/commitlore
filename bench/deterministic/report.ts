import { writeFileSync } from 'node:fs';

import type {
  DeterministicRow,
  GuardQualityRow,
  HookOverheadRow,
  IndexCostRow,
  InjectionDetectionRow,
  NoiseExposureRow,
  QueryLatencyRow,
  SurvivalRow,
} from './types.ts';

export const SCOPE_SENTENCE =
  'These numbers say what CommitLore costs and what it catches. They say nothing about whether recorded context helps an agent; M4 is registered for that question and may still come back null.';

export const EXPOSURE_SCOPE_SENTENCE =
  'This section measures exposure only, not token cost, billed cost, or accuracy.';

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

const indexSection = (rows: readonly IndexCostRow[]): string[] => {
  if (rows.length === 0) return [];
  return [
    '## 6. Index cost',
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
    '## 7. Irrelevant decision-context exposure',
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

export const renderDeterministicReport = (rows: readonly DeterministicRow[]): string => {
  assertSingleProvenance(rows);
  const first = rows[0];
  if (first === undefined) throw new Error('unreachable empty dataset');
  const machine = first.machine;
  const lines = [
    '# CommitLore deterministic measurements',
    '',
    `Provenance: commit \`${first.harness_commit}\`; dist sha256 \`${first.dist_digest}\`.`,
    '',
    `Machine: ${machine.cpu}, ${machine.logical_cpus} logical CPUs, ` +
      `${fixed(machine.memory_bytes / 1024 ** 3, 1)} GiB RAM, ${machine.platform} ${machine.release} ` +
      `(${machine.arch}), Node ${machine.node}, ${machine.git}.`,
    '',
    SCOPE_SENTENCE,
    '',
    ...latencySection(rows.filter((row): row is QueryLatencyRow => row.metric === 'query_latency')),
    ...survivalSection(rows.filter((row): row is SurvivalRow => row.metric === 'record_survival')),
    ...injectionSection(
      rows.filter((row): row is InjectionDetectionRow => row.metric === 'injection_detection'),
    ),
    ...guardSection(rows.filter((row): row is GuardQualityRow => row.metric === 'guard_quality')),
    ...hookSection(rows.filter((row): row is HookOverheadRow => row.metric === 'hook_overhead')),
    ...indexSection(rows.filter((row): row is IndexCostRow => row.metric === 'index_cost')),
    ...exposureSection(rows.filter((row): row is NoiseExposureRow => row.metric === 'noise_exposure')),
  ];
  return `${lines.join('\n').trim()}\n`;
};

export const writeDeterministicReport = (
  path: string,
  rows: readonly DeterministicRow[],
): void => {
  writeFileSync(path, renderDeterministicReport(rows));
};
