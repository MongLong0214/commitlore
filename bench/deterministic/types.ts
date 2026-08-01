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

/**
 * The information a fresh agent has in front of it before its first edit.
 *
 * Every delivering family appears twice, once at the shipped token budget and
 * once with none. Comparing a budgeted route against an unbudgeted one
 * confounds the cap with the mechanism, and no reader can separate them
 * afterwards; `budget_tokens` on the row says which of the two a figure is.
 */
export type DeliveryRoute =
  | 'code-only'
  | 'git-log-path-budgeted'
  | 'git-log-path'
  | 'every-record-budgeted'
  | 'every-record-unbudgeted'
  | 'commitlore'
  | 'commitlore-unbudgeted';

/**
 * `authored` excludes paths the repository's own `.gitattributes` declares
 * generated; `all-tracked` keeps them. The second exists so the exclusion is a
 * reported sensitivity rather than a silent choice.
 */
export type DeliveryPopulation = 'authored' | 'all-tracked';

/** Corpus facts, identical across routes and populations of one run. */
export interface DeliveryCensus {
  readonly commits_examined: number;
  readonly merge_commits: number;
  readonly record_bearing_commits: number;
  readonly records: number;
  readonly active_records: number;
  readonly superseded_records: number;
  readonly expired_records: number;
  /** Records whose declaring commits changed no path — a merge changes none. */
  readonly records_without_paths: number;
  /** Retirements the block walk resolved, against a raw line scan of the same messages. */
  readonly supersedes_trailers_parsed: number;
  readonly supersedes_lines_scanned: number;
  readonly expires_trailers_parsed: number;
  readonly expires_lines_scanned: number;
  readonly tracked_paths: number;
  readonly generated_paths: number;
}

export interface DecisionDeliveryRow extends BaseRow {
  readonly metric: 'decision_delivery';
  readonly history_ref: string;
  /** HEAD's committer instant; the lifecycle fold and the projections share it. */
  readonly evaluated_at: string;
  readonly census: DeliveryCensus;
  readonly population: DeliveryPopulation;
  /** Tracked paths this population admits, before the active-record filter. */
  readonly candidate_paths: number;
  readonly paths_without_active_record: number;
  readonly evaluation_paths: number;
  /** The primary denominator: active records summed over the evaluation paths. */
  readonly path_active_total: number;
  /** Gold (path, record) pairs reachable only through a rename. */
  readonly rename_only_attachments: number;
  readonly repo_active_total: number;
  readonly route: DeliveryRoute;
  /** The injection budget in effect, or null for a route that has none. */
  readonly budget_tokens: number | null;
  readonly delivered_total: number;
  readonly recovered: number;
  readonly path_recall: number;
  readonly macro_path_recall: number;
  readonly repo_recall: number;
  readonly precision: number;
  readonly superseded_delivered: number;
  readonly expired_delivered: number;
  readonly stale_delivered: number;
  readonly stale_share: number;
  readonly off_path_delivered: number;
  /** Delivered ids the census does not know. A parser disagreement shows up here. */
  readonly unknown_delivered: number;
  /** Delivered lines whose record declared no id, so nothing can be scored against them. */
  readonly unidentified_delivered: number;
  readonly withheld_records: number;
  readonly delivered_tokens: number;
  readonly paths_complete: number;
  readonly paths_zero: number;
}

/** A distribution reported in full, because a mean over a skewed sample hides it. */
export interface LedgerStats {
  readonly count: number;
  readonly total: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly min: number;
  readonly max: number;
}

/** One delivery route's cost restated per read, derived from a committed run. */
export interface LedgerReadRoute {
  readonly route: DeliveryRoute;
  readonly budget_tokens: number | null;
  readonly evaluation_paths: number;
  readonly delivered_tokens: number;
  /** `delivered_tokens / evaluation_paths` — an identity on the source row. */
  readonly tokens_per_read: number;
  readonly path_recall: number;
  readonly recovered: number;
  readonly path_active_total: number;
}

/**
 * Break-even against one comparator, under both accountings of the write side.
 *
 * `null` on every read count and `exists: false` when the comparator delivers
 * no more tokens than the shipped route: there is then no saving to amortize a
 * write cost against, and no quantity of reads produces one. That is recorded
 * as a named refusal rather than as a negative or an enormous number.
 */
export interface LedgerBreakEven {
  readonly comparator: DeliveryRoute;
  readonly comparator_tokens_per_read: number;
  readonly shipped_tokens_per_read: number;
  readonly saving_tokens_per_read: number;
  readonly exists: boolean;
  readonly undefined_because: string | null;
  readonly reads_with_diff: number | null;
  readonly reads_scaffold_only: number | null;
  readonly passes_with_diff: number | null;
  readonly passes_scaffold_only: number | null;
  /**
   * Delivered-token reduction against this comparator, as a proportion of the
   * comparator. Negative when the shipped route costs more, which is the
   * honest reading against a route that delivers nothing.
   */
  readonly reduction_against_comparator: number | null;
}

/**
 * A delivered-token reduction with its denominator named on the same object.
 *
 * A percentage whose denominator is elsewhere is the figure this market
 * publishes and this project should not, so the denominator route, its token
 * count and its recall all travel with the number.
 */
export interface LedgerReduction {
  readonly subject: DeliveryRoute;
  readonly denominator: DeliveryRoute;
  readonly subject_tokens_per_read: number;
  readonly denominator_tokens_per_read: number;
  /** `1 − subject/denominator`. Negative when the subject costs more. */
  readonly reduction: number | null;
  /** How many times the denominator's per-read cost the subject's goes into. */
  readonly ratio: number | null;
  readonly subject_recall: number;
  readonly denominator_recall: number;
  readonly subject_recovered: number;
  readonly denominator_recovered: number;
  /**
   * Whether the two routes recovered the same **count** of gold pairs. The
   * delivery row records counts, not sets, so this is not set identity and is
   * not named as if it were.
   */
  readonly equal_recovered_count: boolean;
  /** Why this pair is worth reading, registered before the run. */
  readonly note: string;
}

/** Provenance of the committed delivery run the read side is derived from. */
export interface LedgerReadSource {
  readonly file: string;
  readonly harness_commit: string;
  readonly harness_digest: string | null;
  readonly dist_digest: string;
  readonly measured_at: string;
  readonly population: DeliveryPopulation;
  readonly shipped_route: DeliveryRoute;
}

export interface TokenLedgerRow extends BaseRow {
  readonly metric: 'token_ledger';
  readonly history_ref: string;
  /** The product's own constant, so both sides of the ratio share a unit. */
  readonly chars_per_token: number;

  // --- write side, measured with no model call -----------------------------
  /** `buildHarvestPrompt` with an empty transcript and an empty diff. */
  readonly prompt_scaffold_chars: number;
  readonly prompt_scaffold_bytes: number;
  readonly prompt_scaffold_tokens: number;
  readonly commits_examined: number;
  readonly merge_commits: number;
  /** Record-bearing single-parent commits: one capture each. */
  readonly captures_measured: number;
  readonly records_on_measured_captures: number;
  /** Record-bearing commits excluded for having no single parent, counted by reason. */
  readonly records_on_merge_commits: number;
  readonly records_on_root_commits: number;
  readonly diff_tokens: LedgerStats;
  readonly prompt_tokens: LedgerStats;
  readonly write_floor_tokens_with_diff: number;
  readonly write_floor_tokens_scaffold_only: number;
  readonly write_floor_tokens_per_capture_with_diff: number;
  readonly write_floor_tokens_per_record_with_diff: number;
  /** Model tokens verification spends. Measured, not assumed — see the two fields below. */
  readonly verify_model_tokens: number;
  readonly verify_model_calls: number;
  /** Built modules reachable from the verify entry points, and network hits in them. */
  readonly verify_modules_scanned: number;
  readonly verify_network_references: number;
  /** The write terms this run did not measure, named on the row itself. */
  readonly unmeasured_write_terms: readonly string[];

  // --- read side, derived from a committed decision_delivery run -----------
  readonly read_source: LedgerReadSource;
  readonly reads: readonly LedgerReadRoute[];
  readonly reductions: readonly LedgerReduction[];
  readonly break_even: readonly LedgerBreakEven[];
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
  | DecisionDeliveryRow
  | TokenLedgerRow
  | DensityRow;

export type RowBase = Pick<
  BaseRow,
  'schema_version' | 'harness_commit' | 'harness_digest' | 'dist_digest' | 'measured_at' | 'machine'
>;
