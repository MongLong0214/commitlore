export interface Machine {
  readonly platform: string;
  readonly release: string;
  readonly arch: string;
  readonly cpu: string;
  readonly logical_cpus: number;
  readonly memory_bytes: number;
  readonly node: string;
  readonly git: string;
}

export interface BaseRow {
  readonly schema_version: 1;
  readonly harness_commit: string;
  readonly harness_digest: string;
  readonly dist_digest: string;
  readonly measured_at: string;
  readonly machine: Machine;
}

export interface Timing {
  readonly runs: number;
  readonly warmups: number;
  readonly p50_ms: number;
  readonly p95_ms: number;
  readonly min_ms: number;
  readonly max_ms: number;
}

export type QueryCommand = 'context' | 'limits' | 'ruled-out' | 'guard';
export type QueryMode = 'indexed' | 'no-index';

export interface QueryLatencyRow extends BaseRow {
  readonly metric: 'query_latency';
  readonly commits: number;
  readonly records: number;
  readonly command: QueryCommand;
  readonly mode: QueryMode;
  readonly timing: Timing;
}

export interface IndexCostRow extends BaseRow {
  readonly metric: 'index_cost';
  readonly commits: number;
  readonly records: number;
  readonly build_ms: number;
  readonly size_bytes: number;
  readonly bytes_per_record: number;
}

export type SurvivalOperation =
  | 'interactive-rebase'
  | 'rebase-onto'
  | 'squash-merge'
  | 'cherry-pick'
  | 'filter-branch'
  | 'rename'
  | 'rename-heavy-edit';

export interface SurvivalRow extends BaseRow {
  readonly metric: 'record_survival';
  readonly operation: SurvivalOperation;
  readonly outcome: 'history-retention' | 'path-reachability';
  readonly measurement: 'historyCount' | 'pathCount';
  readonly survived: number;
  readonly total: number;
  readonly rate: number;
}

export interface InjectionDetectionRow extends BaseRow {
  readonly metric: 'injection_detection';
  readonly corpus: string;
  readonly positives: number;
  readonly negatives: number;
  readonly true_positives: number;
  readonly false_negatives: number;
  readonly false_positives: number;
  readonly true_negatives: number;
  readonly true_positive_rate: number;
  readonly false_positive_rate: number;
  /**
   * The issue #70 set: written without reading `INJECTION_PATTERNS`, reported
   * separately from the pattern-authored corpus above because a corpus scored
   * by its own authors cannot stand in for a detection-rate claim.
   */
  readonly adversarial_corpus: string;
  readonly adversarial_source: string;
  readonly adversarial_total: number;
  readonly adversarial_detected: number;
}

export interface GuardScoreBand {
  readonly min: number;
  readonly max: number;
  readonly firings: number;
  readonly correct: number;
}

export interface GuardThresholdPoint {
  readonly threshold: number;
  readonly true_positives: number;
  readonly false_positives: number;
  readonly false_negatives: number;
  readonly true_negatives: number;
  readonly precision: number | null;
  readonly recall: number;
  readonly f1: number | null;
  readonly firings: number;
  readonly correct_silences: number;
}

export interface PrecisionInterval {
  readonly level: 0.95;
  readonly lower: number;
  readonly upper: number;
}

export interface GuardQualityRow extends BaseRow {
  readonly metric: 'guard_quality';
  readonly corpus: string;
  readonly threshold: number;
  readonly true_positives: number;
  readonly false_positives: number;
  readonly false_negatives: number;
  readonly true_negatives: number;
  readonly precision: number;
  readonly recall: number;
  /** True positives + false positives; the denominator the bands partition. */
  readonly firings: number;
  readonly bands: readonly GuardScoreBand[];
  readonly curve_step: number;
  readonly curve: readonly GuardThresholdPoint[];
  readonly precision_interval: PrecisionInterval;
}

export type HookName = 'commit-msg' | 'pre-tool-use-inject';

export interface HookOverheadRow extends BaseRow {
  readonly metric: 'hook_overhead';
  readonly hook: HookName;
  readonly without_hook: Timing;
  readonly with_hook: Timing;
  readonly delta_p50_ms: number;
  readonly delta_p95_ms: number;
}

export interface HarvestCapture {
  readonly output_bytes: number;
  readonly output_tokens: number;
  readonly timing: Timing;
}

export interface VerificationCapture {
  readonly input_bytes: number;
  readonly input_tokens: number;
  readonly timing: Timing;
}

export interface CacheReadCapture {
  readonly input_bytes: number;
  readonly input_tokens: number;
}

export interface CaptureCostRow extends BaseRow {
  readonly metric: 'capture_cost';
  readonly fixture: string;
  readonly accepted_records: number;
  readonly rejected_records: number;
  readonly harvest: HarvestCapture;
  readonly verify: VerificationCapture;
  /** Transcript + diff re-read by verification after harvest already supplied them. */
  readonly cache_read: CacheReadCapture;
  readonly marginal_tokens_per_accepted_record: number;
  readonly tokens_including_cache_reads_per_accepted_record: number;
}

export type NoiseRoute =
  | 'inject-everything'
  | 'top-k-lexical'
  | 'commitlore-path-lifecycle';

export interface NoiseExposureRow extends BaseRow {
  readonly metric: 'noise_exposure';
  readonly distractors: number;
  readonly corpus_records: number;
  readonly route: NoiseRoute;
  readonly visible_records: number;
  readonly visible_tokens: number;
  readonly relevant_records: number;
  readonly relevant_total: 2;
  readonly timing: Timing;
}

export interface DensityRow extends BaseRow {
  readonly metric: 'rationale_density';
  readonly history_ref: string;
  readonly commits_examined: number;
  readonly merge_commits: number;
  readonly authored_commits: number;
  readonly record_bearing_commits: number;
  readonly authored_record_bearing_commits: number;
  readonly structured_trailers: number;
  readonly non_empty_body_lines: number;
  readonly record_bearing_rate: number;
  readonly authored_record_bearing_rate: number;
  readonly trailers_per_commit: number;
  readonly structured_trailer_line_share: number;
}

export type DeterministicRow =
  | QueryLatencyRow
  | IndexCostRow
  | SurvivalRow
  | InjectionDetectionRow
  | GuardQualityRow
  | HookOverheadRow
  | CaptureCostRow
  | NoiseExposureRow
  | DensityRow;

export type RowBase = Pick<
  BaseRow,
  'schema_version' | 'harness_commit' | 'harness_digest' | 'dist_digest' | 'measured_at' | 'machine'
>;
