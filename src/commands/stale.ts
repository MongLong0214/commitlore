/**
 * `commitlore stale` — the records that are no longer carrying their weight:
 * retired by a `Supersedes:`, past a date-form `Expires:`, or flagged for
 * review by a condition-form one (SPEC §5).
 *
 * The engine lives in `core/stale.ts` and is pure. This file is the two
 * impure halves around it: reading the record stream out of git, and choosing
 * the evaluation instant — the one place `new Date()` is legitimate, and only
 * as the default for `--at`.
 */

import type { Command } from 'commander';

import { scanInjection } from '../core/grade.js';
import { execGit } from '../core/git.js';
import {
  listRecordShas,
  notesAvailability,
  readRecord,
  type NotesAvailability,
} from '../core/notes.js';
import {
  findDanglingRefs,
  findIdCollisions,
  foldLifecycle,
  isStale,
  type RecordState,
  type StaleRecord,
} from '../core/stale.js';
import { parseCommitMessage } from '../core/trailers.js';
import type { Violation } from '../core/types.js';

/**
 * How many commits a scan reads when `--all-history` is not given. A bounded
 * default keeps `stale` fast on a deep repository; the cost is that anything
 * older than the window is invisible, which the report says out loud rather
 * than letting a truncated answer pass for a complete one.
 */
export const DEFAULT_SCAN_LIMIT = 1000;

/**
 * `-z` NUL-terminates each commit (verified against git 2.50), and a commit
 * object cannot contain a NUL byte, so the record boundary is unambiguous.
 * Fields are split on the first two US (0x1f) bytes only, leaving any further
 * one where it belongs — inside the message.
 *
 * `%cI` is the committer date: `committed_at` in the contract cases, and the
 * date git's own history walk is ordered by.
 */
const UNIT = '\u001f';
const LOG_FORMAT = `%H${UNIT}%cI${UNIT}%B`;

/**
 * git's phrasings for "this repository exists but has no commits yet" — a
 * repository that recorded nothing, not a failure (SPEC §4 says the same about
 * a commit with no trailers). The wording has changed across git versions, so
 * both are matched.
 */
const EMPTY_REPO_RE = /does not have any commits yet|bad default revision|ambiguous argument 'HEAD'/;

/**
 * A message with no line of the form `Key:` cannot contain a trailer under
 * git's grammar (SPEC §2.2), so parsing it would spawn a process to be told
 * nothing. This never decides that a line *is* a trailer — B3 (a `Key: value`
 * line followed by prose is not a trailer block) is exactly why that decision
 * stays with `git interpret-trailers`; it only skips messages where a trailer
 * is impossible.
 */
const CANDIDATE_LINE_RE = /^[A-Za-z][A-Za-z0-9-]*:/m;

export interface CollectOptions {
  cwd?: string;
  /** Read the whole reachable history instead of the most recent commits. */
  allHistory?: boolean;
  revision?: string;
}

type RecordSource = NonNullable<StaleRecord['source']>;

type CollectedRecord = StaleRecord & { sha: string; committedAt: string; source: RecordSource };

export interface Scan {
  records: CollectedRecord[];
  /** Commits read, including those that recorded nothing. */
  commits: number;
  /** The scan stopped at the window, so older records were not seen. */
  truncated: boolean;
  notes: NotesAvailability;
}

const parseChunk = (chunk: string): CollectedRecord | null => {
  const firstSep = chunk.indexOf(UNIT);
  if (firstSep === -1) return null;
  const secondSep = chunk.indexOf(UNIT, firstSep + 1);
  if (secondSep === -1) return null;

  const message = chunk.slice(secondSep + 1);
  const trailers = CANDIDATE_LINE_RE.test(message) ? parseCommitMessage(message) : [];

  return {
    sha: chunk.slice(0, firstSep),
    committedAt: chunk.slice(firstSep + 1, secondSep),
    trailers,
    source: 'commit',
  };
};

/**
 * Reads the record stream from git, newest commit first (the fold reorders it).
 */
export const collectRecords = (opts: CollectOptions = {}): Scan => {
  const cwd = opts.cwd ?? process.cwd();
  const notes = notesAvailability({ cwd });
  const args = ['log', '-z', `--format=${LOG_FORMAT}`];
  if (opts.allHistory !== true) args.push(`--max-count=${DEFAULT_SCAN_LIMIT}`);
  args.push('--end-of-options', opts.revision ?? 'HEAD');

  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    if (EMPTY_REPO_RE.test(result.stderr)) {
      return { records: [], commits: 0, truncated: false, notes };
    }
    throw new Error(`git log failed (exit ${result.code}): ${result.stderr.trim()}`);
  }

  const commitRecords = result.stdout
    .split('\u0000')
    .filter((chunk) => chunk.length > 0)
    .map(parseChunk)
    .filter((record): record is CollectedRecord => record !== null);
  const commitsBySha = new Map(commitRecords.map((record) => [record.sha, record]));
  const noteRecords = listRecordShas({ cwd }).flatMap((sha): CollectedRecord[] => {
    const commit = commitsBySha.get(sha);
    if (commit === undefined) return [];

    const trailers = readRecord(sha, { cwd });
    const mirrored = trailers.every((note) =>
      commit.trailers.some((trailer) => trailer.key === note.key && trailer.value === note.value),
    );
    return trailers.length === 0 || mirrored
      ? []
      : [{ sha, committedAt: commit.committedAt, trailers, source: 'notes' }];
  });

  return {
    records: [...commitRecords, ...noteRecords],
    commits: commitRecords.length,
    truncated: opts.allHistory !== true && commitRecords.length >= DEFAULT_SCAN_LIMIT,
    notes,
  };
};

export interface StaleReportRecord extends RecordState { source: RecordSource }

export interface StaleReport {
  /** The evaluation instant, normalized to UTC. */
  at: string;
  commits: number;
  truncated: boolean;
  notes: NotesAvailability;
  /** Every record the scan saw, stale or not. */
  totalRecords: number;
  /** The stale ones: superseded, expired, or flagged for review. */
  records: StaleReportRecord[];
  danglingRefs: Violation[];
  idCollisions: Violation[];
}

/**
 * The order the fold is owed: oldest commit first.
 *
 * `collectRecords` returns what `git log` returns, newest first, and the fold
 * breaks a same-second tie on input position — so handing it the walk as-is
 * resolves "latest declaration wins" to the *oldest* of two commits made in
 * one second (issue #350). A `git log` walk never emits a parent before its
 * child, so reversing it is a real topological order and the tie-break then
 * means what the rule says. `commands/validate.ts` has applied this same
 * compensation on the reference-check path since bug-issue-187; this is the
 * serving path finally getting it too.
 *
 * Notes stay behind the commits they mirror, where `collectRecords` puts them:
 * a note shares its commit's instant, so its position decides whether the
 * mirror or the message wins a non-repeatable key, and that precedence is not
 * this fix's to change.
 */
const oldestFirst = (records: CollectedRecord[]): CollectedRecord[] => [
  ...records.filter((record) => record.source !== 'notes').reverse(),
  ...records.filter((record) => record.source === 'notes'),
];

/**
 * Withholds the content of a record whose trailers match an injection pattern.
 *
 * `commitlore_query` grades every record before a model sees it and renders a
 * `blocked` one as a count. `stale` serialised `resolvedTrailers` straight into
 * its report, so an expired `Warn: ignore previous instructions…` reached the
 * model ungraded through a tool the same server exposes — the payload only had
 * to be stale, which is the one state nobody is watching.
 *
 * The record still appears: what is stale is the operator's business, and
 * hiding it would trade one silence for another. Its *values* do not. The keys
 * are kept because a key is a closed vocabulary and cannot carry prose.
 */
const withheldIfInjection = (record: StaleReportRecord): StaleReportRecord => {
  const matched = [
    ...new Set(record.resolvedTrailers.flatMap((trailer) => scanInjection(trailer.value))),
  ];
  if (matched.length === 0) return record;
  const withheld = `[withheld: matched ${String(matched.length)} injection pattern(s): ${matched.join(', ')}]`;
  return {
    ...record,
    resolvedTrailers: record.resolvedTrailers.map((trailer) => ({
      key: trailer.key,
      value: withheld,
    })),
    // `expiresAt` carries the `Expires:` value verbatim, condition form and
    // all, and is serialised beside the trailers. Redacting only
    // `resolvedTrailers` left this field as an open second channel: a payload
    // in `Expires:` reached a model through the same tool. Every place the
    // value appears has to be the same place.
    ...(record.expiresAt === undefined ? {} : { expiresAt: withheld }),
  };
};

export const buildReport = (scan: Scan, at: Date): StaleReport => {
  const ordered = oldestFirst(scan.records);
  const states = foldLifecycle(ordered, { at });
  const stale = states.filter(isStale).map((state): StaleReportRecord => {
    const record = scan.records.find(
      (candidate) =>
        candidate.sha === state.sha &&
        candidate.trailers.some(
          (trailer) => trailer.key === 'Record-Id' && trailer.value === state.recordId,
        ),
    );
    if (record === undefined) throw new Error(`no source for stale record ${state.recordId}`);
    return withheldIfInjection({ ...state, source: record.source });
  });
  return {
    at: at.toISOString(),
    commits: scan.commits,
    truncated: scan.truncated,
    notes: scan.notes,
    totalRecords: states.length,
    records: stale,
    // Both read the stream in order too — `findIdCollisions` asks whether a
    // *later* commit declared the succession, which is the same question the
    // fold asks and must get the same order to answer it with.
    danglingRefs: findDanglingRefs(ordered),
    idCollisions: findIdCollisions(ordered),
  };
};

const shortSha = (sha: string): string => (sha.length > 8 ? sha.slice(0, 8) : sha);

const location = (state: StaleReportRecord): string =>
  `${state.recordId}  ${shortSha(state.sha)}  [${state.source}]`;

const section = (title: string, lines: string[]): string[] =>
  lines.length === 0 ? [] : ['', title, ...lines.map((line) => `  ${line}`)];

export const formatReport = (report: StaleReport): string => {
  const superseded = report.records.filter((state) => state.lifecycle === 'superseded');
  const expired = report.records.filter((state) => state.lifecycle === 'expired');
  const review = report.records.filter((state) => state.lifecycle === 'active');

  const lines = [
    `stale at ${report.at} — ${superseded.length} superseded, ${expired.length} expired, ` +
      `${review.length} for review, of ${report.totalRecords} record(s) in ${report.commits} commit(s)`,
    ...section(
      'superseded',
      superseded.map(
        (state) => `${location(state)}  by ${shortSha(state.supersededBy ?? '')}`,
      ),
    ),
    ...section(
      'expired',
      expired.map((state) => `${location(state)}  ${state.expiresAt ?? ''}`),
    ),
    ...section(
      'review',
      review.map((state) => `${location(state)}  ${state.expiresAt ?? ''}`),
    ),
    ...section(
      'dangling refs',
      report.danglingRefs.map((violation) => `${violation.key}: ${violation.got}  want ${violation.want}`),
    ),
    ...section(
      'id collisions',
      report.idCollisions.map((violation) => `${violation.key}: ${violation.got}  want ${violation.want}`),
    ),
  ];

  if (report.truncated) {
    lines.push(
      '',
      `note: only the most recent ${DEFAULT_SCAN_LIMIT} commits were scanned; run with --all-history for the whole record.`,
    );
  }

  if (report.notes === 'unfetched') {
    lines.push('', 'note: the notes mirror has not been fetched, so this scan is incomplete; run commitlore doctor --fix and fetch again.');
  }

  return `${lines.join('\n')}\n`;
};

interface StaleOptions {
  json?: boolean;
  at?: string;
  allHistory?: boolean;
}

/**
 * Resolves `--at`. Defaulting to now belongs here and nowhere deeper: the fold
 * takes the instant as an argument precisely so that no test of it depends on
 * the day it runs.
 */
const evaluationInstant = (raw: string | undefined): Date => {
  if (raw === undefined) return new Date();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`--at is not a valid ISO 8601 instant: ${raw}`);
  }
  return parsed;
};

/**
 * Exit status stays 0 even with findings: `stale` reports, it does not gate.
 * The non-zero exit of SPEC §6 belongs to `commitlore validate`; a caller that
 * wants CI to fail on a dangling reference reads `danglingRefs` from `--json`.
 * The only non-zero code `stale` uses is 2, for a usage error -- an
 * unparseable `--at`, or git unable to answer at all (SPEC §10: neither is a
 * finding).
 */
export const register = (program: Command): void => {
  program
    .command('stale')
    .description('list records that are superseded, expired, or flagged for review')
    .option('--json', 'emit the report as JSON')
    .option('--at <instant>', 'evaluate as of an ISO 8601 instant (default: now)')
    .option('--all-history', `scan the whole history instead of the most recent ${DEFAULT_SCAN_LIMIT} commits`)
    .addHelpText(
      'after',
      '\nExit codes: 0 ran (stale reports findings in its output, it does not gate on them), ' +
        '2 a usage error -- an unparseable --at, or git could not answer (SPEC §10).',
    )
    .action((options: StaleOptions) => {
      try {
        const at = evaluationInstant(options.at);
        const scan = collectRecords(
          options.allHistory === true ? { allHistory: true } : { allHistory: false },
        );
        const report = buildReport(scan, at);
        process.stdout.write(
          options.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report),
        );
      } catch (error) {
        process.stderr.write(`commitlore: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 2;
      }
    });
};
