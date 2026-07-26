/**
 * The stale engine (SPEC §5): the lifecycle fold that `Record-Id:`,
 * `Supersedes:` and `Expires:` resolve against, plus the `dangling-ref`
 * violation class of SPEC §6 — the one class `validateRecord` structurally
 * cannot see, because it asks whether a reference resolves somewhere in
 * *history*, not whether a single record is well-formed.
 *
 * The fold never reads the system clock. Every judgement is made against
 * `FoldOptions.at`, injected by the caller, and every date comparison is done
 * in UTC (`Date.parse` of an explicit `Z` instant — never `new Date(y, m, d)`
 * or any `getFullYear`-family call, which would consult the local zone). A CI
 * runner in UTC and a laptop in KST therefore fold the same stream to the same
 * states, and a test pinned to a fixed instant cannot rot as the date changes.
 *
 * `spec/contract-cases/stale-*.yaml` is the authority for every rule below;
 * this module is the implementation of those cases, not the definition.
 */

import {
  RECORD_ID_RE,
  SINGLE_VALUED,
  type Lifecycle,
  type Record,
  type Trailer,
  type Violation,
} from './types.js';

const RECORD_ID_KEY = 'Record-Id';
const SUPERSEDES_KEY = 'Supersedes';
const FOLLOWS_KEY = 'Follows';
const EXPIRES_KEY = 'Expires';

/** The only flag the core raises today. `flags` stays open for later routes. */
export const REVIEW_FLAG = 'review';

/** `want` text for a dangling reference, fixed by spec/fixtures/invalid/05. */
const DANGLING_WANT = 'an existing Record-Id in history';

const DAY_MS = 86_400_000;

/** Shape-only gate for a date-form `Expires:`; realness is checked separately. */
const DATE_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A record plus the instant its commit was made — the axis the fold orders by.
 *
 * `committedAt` is optional so a plain `Record[]` (SPEC's knowledge unit, which
 * carries no time) is still a legal input: records without an instant keep
 * their input order, which is what a caller streaming straight out of
 * `git log` already has.
 */
export interface StaleRecord extends Record {
  /** ISO 8601 commit instant, e.g. `2026-01-10T00:00:00Z`. */
  committedAt?: string;
}

/** One record's folded state at the evaluation instant. */
export interface RecordState {
  recordId: string;
  /** The latest commit that declared this `Record-Id` ('' if the caller gave none). */
  sha: string;
  lifecycle: Lifecycle;
  /** Open set; today only `review` (a condition-form `Expires:`). */
  flags: string[];
  /**
   * What the record resolves to across every commit that declared it:
   * non-repeatable keys take the latest commit's value in place, repeatable
   * keys accumulate in first-seen order. `Record-Id` is omitted — identity is
   * `recordId`, not payload.
   */
  resolvedTrailers: Trailer[];
  /** The commit that retired this record, when one did. */
  supersededBy?: string;
  /** The resolved `Expires:` value verbatim — a date or a free-text condition. */
  expiresAt?: string;
}

export interface FoldOptions {
  /** The instant to evaluate against. Callers inject it; the fold never invents one. */
  at: Date;
}

const trailerValue = (trailers: Trailer[], key: string): string | undefined =>
  trailers.find((trailer) => trailer.key === key)?.value;

/** Epoch ms of a record's commit, or `undefined` when it has no usable instant. */
const instantOf = (record: StaleRecord): number | undefined => {
  if (record.committedAt === undefined) return undefined;
  const parsed = Date.parse(record.committedAt);
  return Number.isNaN(parsed) ? undefined : parsed;
};

interface TimedRecord {
  record: StaleRecord;
  /** Epoch ms; `-Infinity` for a record the caller gave no instant for. */
  at: number;
}

/**
 * Orders the stream oldest → newest by `committedAt`.
 *
 * A record with no instant inherits the last one seen, so a stream that is
 * already chronological (every `git log` walk, reversed) is left untouched and
 * a stream with no instants at all keeps its input order exactly. Ties break on
 * input position, which keeps the comparator total — the alternative,
 * branching on `undefined` inside the comparator, is inconsistent and sorts
 * differently depending on how the engine happens to pair elements.
 */
const chronological = (records: StaleRecord[]): TimedRecord[] => {
  let carried = Number.NEGATIVE_INFINITY;
  const keyed = records.map((record, index) => {
    const at = instantOf(record);
    if (at !== undefined) carried = at;
    return { record, index, at: carried };
  });

  return keyed
    .sort((a, b) => {
      if (a.at === b.at) return a.index - b.index;
      return a.at < b.at ? -1 : 1;
    })
    .map(({ record, at }) => ({ record, at }));
};

/**
 * The instant a date-form `Expires:` stops being active: 00:00:00Z of the day
 * *after* the stated UTC day. `Expires: 2026-02-15` means "stops being active
 * after the 15th", so 2026-02-15T00:00:00Z is still active and
 * 2026-02-16T00:00:00Z is expired — the boundary pinned by
 * `spec/contract-cases/stale-expires-boundary.yaml`.
 *
 * `undefined` means "not a date, never auto-expires": a free-text condition
 * (SPEC §3.2), and equally a date-shaped value that is not a real date
 * (`2026-13-45`). The latter is a `format` violation for `commitlore validate`
 * to report — not a licence for this engine to retire a record on a guess.
 */
const expiryEndOf = (value: string | undefined): number | undefined => {
  if (value === undefined || !DATE_SHAPE_RE.test(value)) return undefined;
  const start = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(start)) return undefined;
  if (new Date(start).toISOString().slice(0, 10) !== value) return undefined;
  return start + DAY_MS;
};

/**
 * Merges one commit's trailers into a record's resolved set. Non-repeatable
 * keys (SPEC §3 cardinality) are replaced in place so the latest commit wins
 * without reordering the record; repeatable keys accumulate, skipping values
 * already present — a follow-up commit that re-declares a record repeats its
 * context, and duplicating it in the resolved view is noise, not data.
 */
const mergeTrailers = (into: Trailer[], from: Trailer[]): void => {
  for (const trailer of from) {
    if (trailer.key === RECORD_ID_KEY) continue;

    if (SINGLE_VALUED.has(trailer.key)) {
      const at = into.findIndex((existing) => existing.key === trailer.key);
      if (at === -1) into.push({ ...trailer });
      else into[at] = { ...trailer };
      continue;
    }

    const duplicate = into.some(
      (existing) => existing.key === trailer.key && existing.value === trailer.value,
    );
    if (!duplicate) into.push({ ...trailer });
  }
};

interface Declaration {
  recordId: string;
  sha: string;
  trailers: Trailer[];
}

/** Collapses every commit that declared a `Record-Id` into one entry, latest wins. */
const declarations = (ordered: TimedRecord[]): Map<string, Declaration> => {
  const found = new Map<string, Declaration>();

  for (const { record } of ordered) {
    const recordId = trailerValue(record.trailers, RECORD_ID_KEY);
    if (recordId === undefined) continue;

    const declaration = found.get(recordId) ?? { recordId, sha: '', trailers: [] };
    if (record.sha !== undefined) declaration.sha = record.sha;
    mergeTrailers(declaration.trailers, record.trailers);
    found.set(recordId, declaration);
  }

  return found;
};

/**
 * Maps every retired `Record-Id` to the commit that retired it. The earliest
 * retiring commit wins: that is when the record stopped being active.
 */
const supersessions = (ordered: TimedRecord[]): Map<string, string> => {
  const found = new Map<string, string>();

  for (const { record } of ordered) {
    for (const trailer of record.trailers) {
      if (trailer.key !== SUPERSEDES_KEY) continue;
      if (found.has(trailer.value)) continue;
      found.set(trailer.value, record.sha ?? '');
    }
  }

  return found;
};

/**
 * Folds a record stream into one state per `Record-Id`, as history stood at
 * `opts.at`.
 *
 * "As history stood" is the whole contract of `at`: a commit made after that
 * instant has not happened yet, so it neither declares a record nor retires
 * one (SPEC §5 — a supersession applies "from this commit forward"). Replaying
 * the same stream at an earlier instant therefore shows the record still
 * active, which is what makes `--at` a time machine rather than a filter.
 *
 * Commits carrying no `Record-Id:` produce no state — they are still read for
 * their `Supersedes:` trailers, which is how a retiring commit that declares
 * nothing of its own still retires its target. States come back in order of
 * first declaration.
 *
 * `superseded` outranks `expired` when both apply: retiring a record is a
 * deliberate act, and naming the commit that did it says more than the date
 * that would have caught up with it anyway. No contract case pins this yet.
 */
export const foldLifecycle = (records: StaleRecord[], opts: FoldOptions): RecordState[] => {
  const cutoff = opts.at.getTime();
  // An Invalid Date would compare false against every instant and quietly fold
  // the whole stream to nothing — "no records" is the one wrong answer that
  // looks like a healthy repository.
  if (Number.isNaN(cutoff)) throw new Error('foldLifecycle: opts.at is not a valid Date');

  const ordered = chronological(records).filter((entry) => entry.at <= cutoff);
  const retired = supersessions(ordered);

  return [...declarations(ordered).values()].map((declaration) => {
    const supersededBy = retired.get(declaration.recordId);
    const expiresAt = trailerValue(declaration.trailers, EXPIRES_KEY);
    const expiryEnd = expiryEndOf(expiresAt);
    const expired = expiryEnd !== undefined && cutoff >= expiryEnd;

    const lifecycle: Lifecycle =
      supersededBy !== undefined ? 'superseded' : expired ? 'expired' : 'active';

    // A condition-form Expires never auto-expires; it asks a human. Once the
    // record is retired the question is moot, so the flag is dropped with it.
    const review = lifecycle === 'active' && expiresAt !== undefined && expiryEnd === undefined;

    return {
      recordId: declaration.recordId,
      sha: declaration.sha,
      lifecycle,
      flags: review ? [REVIEW_FLAG] : [],
      resolvedTrailers: declaration.trailers,
      ...(supersededBy === undefined ? {} : { supersededBy }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
  });
};

/**
 * Reports every `Supersedes:`/`Follows:` that points at a `Record-Id` no record
 * in the stream declares (SPEC §6 `dangling-ref`).
 *
 * This is the cross-record half of validation: `validateRecord` sees one record
 * and cannot answer it, so a syntactically valid reference to nothing passes
 * there by design and is caught here instead. Scope is the stream it is handed
 * — a partial history yields partial answers, and the caller owns the window.
 *
 * References that are not syntactically valid `Record-Id` values are left
 * alone: those are `format` violations, already reported by `validateRecord`,
 * and reporting them twice under two rules makes the repair loop chase one
 * line with two fixes.
 */
export const findDanglingRefs = (records: StaleRecord[]): Violation[] => {
  const declared = new Set<string>();
  for (const record of records) {
    const recordId = trailerValue(record.trailers, RECORD_ID_KEY);
    if (recordId !== undefined) declared.add(recordId);
  }

  const violations: Violation[] = [];
  for (const record of records) {
    for (const trailer of record.trailers) {
      if (trailer.key !== SUPERSEDES_KEY && trailer.key !== FOLLOWS_KEY) continue;
      if (!RECORD_ID_RE.test(trailer.value)) continue;
      if (declared.has(trailer.value)) continue;
      violations.push({
        key: trailer.key,
        value: trailer.value,
        rule: 'dangling-ref',
        got: trailer.value,
        want: DANGLING_WANT,
      });
    }
  }

  return violations;
};

/** Whether a state belongs in a stale report: retired, expired, or flagged. */
export const isStale = (state: RecordState): boolean =>
  state.lifecycle !== 'active' || state.flags.length > 0;
