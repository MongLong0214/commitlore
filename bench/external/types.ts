/**
 * Row shapes for the external-corpus measurement registered in
 * `bench/EXTERNAL-CORPUS.md`.
 *
 * Every row carries the corpus it describes rather than relying on file order,
 * because these results are explicitly *not* poolable: §4's figures are
 * per-repository by design, and a reader who averages them has answered a
 * different question from the one asked.
 */

import type { BaseRow, DecisionDeliveryRow } from '../deterministic/types.ts';

/**
 * What a corpus is, pinned. `ref` is the SHA the method document names; the
 * harness refuses to measure a tree that does not resolve to it.
 */
export interface CorpusIdentity {
  readonly name: string;
  readonly upstream: string;
  readonly licence: string;
  readonly ref: string;
  readonly commits: number;
  readonly first_commit_at: string;
  readonly last_commit_at: string;
  /** True for this repository's calibration row (§3), false for the four externals. */
  readonly calibration: boolean;
}

/** `authored` excludes the repository's own declared generated paths. */
export type CoveragePopulation = 'authored' | 'all-tracked';

/**
 * §4: the record-free skeleton of `git-log-path-budgeted`. The share of a
 * path's commits whose message is wholly inside the 800-token prefix of
 * `git log --format=%B -- P`.
 *
 * This is not recall and must not be read as one; §4.4 states the assumption
 * between the two and the calibration row measures its size.
 */
export interface BudgetedLogCoverageRow extends BaseRow {
  readonly metric: 'budgeted_log_coverage';
  readonly corpus: CorpusIdentity;
  readonly population: CoveragePopulation;
  readonly budget_tokens: number;
  readonly tracked_paths: number;
  readonly generated_paths: number;
  /** Paths this population admits, before the "has a log" filter. */
  readonly candidate_paths: number;
  readonly evaluation_paths: number;
  readonly commits_total: number;
  readonly commits_delivered: number;
  readonly commit_coverage: number;
  readonly macro_commit_coverage: number;
  readonly paths_complete: number;
  readonly paths_zero: number;
  readonly full_tokens: number;
  readonly budgeted_tokens: number;
  readonly median_commits_per_path: number;
  readonly median_full_tokens_per_path: number;
  readonly p90_full_tokens_per_path: number;
}

/**
 * §5: the funnel from revert candidates to written records. Every filter is
 * counted so a reader can see which one did the work, and the two alternative
 * return-check thresholds are reported so the 0.5 in §5.4 is auditable rather
 * than merely declared.
 */
export interface RevertBackfillRow extends BaseRow {
  readonly metric: 'revert_backfill';
  readonly corpus: CorpusIdentity;
  readonly candidates: number;
  readonly dropped_not_exactly_one: number;
  readonly dropped_unresolvable: number;
  readonly dropped_merge: number;
  readonly dropped_self_reverted: number;
  readonly dropped_too_little_content: number;
  readonly dropped_returned: number;
  readonly accepted: number;
  /** Survivors had the return threshold been 0.25 or 0.75 instead of 0.5. */
  readonly accepted_at_return_threshold_025: number;
  readonly accepted_at_return_threshold_075: number;
  readonly return_threshold: number;
  readonly records_written: number;
  readonly reason_absent: number;
  readonly reason_truncated: number;
  readonly notes_paths_touched: number;
}

/** §6: the registered delivery metric, run on the backfilled corpus. */
export type ExternalDeliveryRow = DecisionDeliveryRow & {
  readonly corpus: CorpusIdentity;
};

export type ExternalRow = BudgetedLogCoverageRow | RevertBackfillRow | ExternalDeliveryRow;
