/**
 * The append-only adjudication ledger and the reducer that reads it.
 *
 * The census drifted once and the drift was invisible from inside: three
 * candidates sat in buildability-summary.json as NOT_BUILDABLE for days after
 * the verdicts behind them had been overturned, because the summary was written
 * by hand from whatever the last pull request had said. Prose became the source
 * of truth, and prose does not recompute.
 *
 * So the chain runs one way and only one way:
 *
 *     ledger (append-only)  ->  reducer  ->  census  ->  summary  ->  report
 *
 * Nothing downstream is edited. A verdict is changed by appending a new row,
 * never by rewriting the old one, and the reducer decides which row is current.
 * The earlier verdicts stay readable: an overturned negative is one of the most
 * informative things in this study, and deleting it would erase the evidence
 * that the search budget was once too small.
 */

import { canonicalAdjudication, type Adjudication, type CandidateAdjudication } from "./adjudicate-v5.ts";

export const LEDGER_STATES = ["CURRENT", "SUPERSEDED"] as const;
export type LedgerState = (typeof LEDGER_STATES)[number];

export interface LedgerRow extends CandidateAdjudication {
  /** Monotone position in the append-only file. Assigned by the reducer, never by a worker. */
  readonly sequence?: number;
}

export interface ReducedCandidate {
  readonly candidate_id: string;
  readonly repository_id: string;
  /** The row that decides this candidate now, or null when nothing does. */
  readonly current: LedgerRow | null;
  readonly superseded: readonly LedgerRow[];
  /**
   * The disposition to report. Null means undecided -- which is what a
   * candidate whose only verdict was voided goes back to being.
   */
  readonly disposition: Adjudication | null;
}

/**
 * A void supersedes what came before it and decides nothing itself.
 *
 * This is the whole reason the reducer exists rather than a `last row wins`
 * one-liner. When the seven sandbox-tainted agent-control-plane verdicts were
 * voided, the candidates did not become negatives and did not keep their old
 * verdicts -- they became unadjudicated again, which is a state the summary has
 * to be able to represent or it will quietly report a smaller corpus.
 */
const DECIDES = (row: LedgerRow): boolean => canonicalAdjudication(row.adjudication) !== "VOID_INVALID_ACCEPTANCE";

/**
 * Folds the append-only ledger into one current state per candidate.
 *
 * Order is the file's order. A ledger that is not append-only breaks this, and
 * `assertLedgerIsAppendOnly` is what stands between the two.
 */
export const reduceLedger = (
  rows: readonly LedgerRow[],
  population: readonly { readonly candidate_id: string; readonly repository_id: string }[],
): ReducedCandidate[] => {
  const byCandidate = new Map<string, LedgerRow[]>();
  rows.forEach((row, index) => {
    const stamped: LedgerRow = { ...row, sequence: index };
    const existing = byCandidate.get(row.candidate_id);
    if (existing === undefined) byCandidate.set(row.candidate_id, [stamped]);
    else existing.push(stamped);
  });

  return population.map((member) => {
    const history = byCandidate.get(member.candidate_id) ?? [];
    const last = history.length === 0 ? null : history[history.length - 1] ?? null;
    const current = last !== null && DECIDES(last) ? last : null;
    return {
      candidate_id: member.candidate_id,
      repository_id: member.repository_id,
      current,
      superseded: history.filter((row) => row !== current),
      disposition: current === null ? null : canonicalAdjudication(current.adjudication),
    };
  });
};

/**
 * Refuses a ledger that was edited rather than appended to.
 *
 * Compares the new file against the committed one prefix-wise. An append leaves
 * every earlier line byte-identical; anything else means a verdict was changed
 * in place, which is the failure this whole chain exists to prevent -- and it
 * would be invisible in a diff that only ever gets read as "the numbers moved".
 */
export const assertLedgerIsAppendOnly = (previous: readonly string[], next: readonly string[]): void => {
  if (next.length < previous.length) {
    throw new Error(
      `ledger: the new ledger has ${String(next.length)} rows where the committed one has ` +
        `${String(previous.length)}. Verdicts are superseded by appending, never by removal`,
    );
  }
  for (const [index, line] of previous.entries()) {
    if (next[index] === line) continue;
    throw new Error(
      `ledger: row ${String(index + 1)} was rewritten. An overturned verdict is appended as a new row so the ` +
        `earlier one stays readable -- that a negative was once recorded is part of what the census found`,
    );
  }
};

export interface CensusRow {
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly disposition: Adjudication | null;
  readonly decided_by: string | null;
  readonly superseded_count: number;
}

export const censusRowsFrom = (reduced: readonly ReducedCandidate[]): CensusRow[] =>
  reduced.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    repository_id: candidate.repository_id,
    disposition: candidate.disposition,
    decided_by: candidate.current === null ? null : candidate.current.adjudicated_at,
    superseded_count: candidate.superseded.length,
  }));

export interface CensusSummary {
  readonly total: number;
  readonly decided: number;
  readonly undecided: number;
  readonly by_disposition: Readonly<Record<string, number>>;
  readonly by_repository: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Candidates whose current verdict replaced an earlier, different one. */
  readonly overturned: number;
}

export const summarize = (reduced: readonly ReducedCandidate[]): CensusSummary => {
  const byDisposition: Record<string, number> = {};
  const byRepository: Record<string, Record<string, number>> = {};
  let decided = 0;
  let overturned = 0;

  for (const candidate of reduced) {
    const key = candidate.disposition ?? "UNDECIDED";
    byDisposition[key] = (byDisposition[key] ?? 0) + 1;
    byRepository[candidate.repository_id] ??= {};
    const repository = byRepository[candidate.repository_id];
    if (repository !== undefined) repository[key] = (repository[key] ?? 0) + 1;
    if (candidate.disposition !== null) decided += 1;
    if (
      candidate.superseded.some(
        (row) => canonicalAdjudication(row.adjudication) !== candidate.disposition,
      )
    ) {
      overturned += 1;
    }
  }

  return {
    total: reduced.length,
    decided,
    undecided: reduced.length - decided,
    by_disposition: byDisposition,
    by_repository: byRepository,
    overturned,
  };
};
