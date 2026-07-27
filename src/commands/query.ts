/**
 * The four consumer-route commands of SPEC §5:
 *
 *   commitlore context   [-- <path>]   every kind, with an active summary header
 *   commitlore limits    [-- <path>]   Limit:
 *   commitlore ruled-out [-- <path>]   Ruled-out:
 *   commitlore warnings  [-- <path>]   Warn:, with its trust grade (SPEC §7)
 *
 * All four are the same query with a different key filter, so they share one
 * option set, one JSON schema and one renderer. The engine is `core/query.ts`;
 * this file is the impure shell around it — argument parsing, the default
 * evaluation instant, and formatting.
 *
 * Exit status is 0 even when nothing comes back. A path with no records is the
 * normal state of most of a repository (SPEC §4: a commit that recorded
 * nothing is not an error), and a query that exits non-zero on an empty answer
 * would make every agent treat "nothing to know here" as a failure.
 */

import type { Command } from 'commander';

import { BLOCKED_RECORD_WITHHELD } from '../core/grade.js';
import {
  LIMIT_KEY,
  RULED_OUT_KEY,
  WARN_KEY,
  runQuery,
  valuesOf,
  type GradedRecord,
  type QueryOptions,
  type QueryResult,
  type TrustGrade,
} from '../core/query.js';
import { BOOKKEEPING_KEYS, type Lifecycle, type Trailer } from '../core/types.js';

/** Identity is printed in its own column, never as a trailer line. */
const RECORD_ID_KEY = 'Record-Id';

interface Section {
  /** The heading `context` prints, and the name of the command that isolates it. */
  label: string;
  key: string;
}

const SECTIONS: readonly Section[] = [
  { label: 'limits', key: LIMIT_KEY },
  { label: 'ruled-out', key: RULED_OUT_KEY },
  { label: 'warnings', key: WARN_KEY },
];

const SECTION_KEYS: readonly string[] = SECTIONS.map((section) => section.key);

export const withholdBlocked = (result: QueryResult): QueryResult => {
  const blocked = result.records.filter(
    (record) => record.trust === 'blocked' && record.withheldTrailerKeys === undefined,
  );
  if (blocked.length === 0) return result;

  const keys = [
    ...new Set(blocked.flatMap((record) => record.matchedTrailerKeys ?? [])),
  ].sort();
  const source =
    keys.length === 1 ? `${keys[0]} trailer` : keys.length > 1 ? `${keys.join(', ')} trailers` : 'a trailer';
  const records = result.records.map((record) =>
    record.trust !== 'blocked' || record.withheldTrailerKeys !== undefined
      ? record
      : {
          ...record,
          withheldTrailerKeys: [
            ...new Set(
              record.trailers
                .filter((trailer) => !BOOKKEEPING_KEYS.has(trailer.key))
                .map((trailer) => trailer.key),
            ),
          ],
          trailers: record.trailers.filter((trailer) => BOOKKEEPING_KEYS.has(trailer.key)),
        },
  );

  return {
    ...result,
    records,
    diagnostics: [
      ...result.diagnostics,
      `withheld the content of ${blocked.length} record(s) graded blocked: a ${source} matching an ` +
        'injection pattern is reported, never quoted (SPEC §7)',
    ],
  };
};

interface QueryCommandOptions {
  json?: boolean;
  allHistory?: boolean;
  /** Commander's negatable `--no-index`: `true` unless the flag was given. */
  index?: boolean;
  at?: string;
  limit?: string;
  /** Repeatable `--trusted-author`, collected in order. */
  trustedAuthor?: string[];
}

/** Repeatable option accumulator, as `commands/inject.ts` uses. */
const collect = (value: string, previous: string[]): string[] => [...previous, value];

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------

/**
 * Resolves `--at`. Defaulting to now belongs here and nowhere deeper: the
 * engine takes the instant as an argument precisely so that no test of it
 * depends on the day it runs.
 */
const evaluationInstant = (raw: string | undefined): Date | undefined => {
  if (raw === undefined) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`--at is not a valid ISO 8601 instant: ${raw}`);
  }
  return parsed;
};

const recordLimit = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--limit is not a non-negative integer: ${raw}`);
  }
  return parsed;
};

const queryOptions = (
  paths: string[],
  options: QueryCommandOptions,
  keys: readonly string[] | undefined,
): QueryOptions => {
  const at = evaluationInstant(options.at);
  const limit = recordLimit(options.limit);
  // Same spelling and same default as `commitlore inject`: with no trusted
  // author, a `Warn:` grades `claim`. The two routes must answer alike, or the
  // grade means one thing on the hook and another on the terminal.
  const trustedAuthors = options.trustedAuthor ?? [];
  return {
    paths,
    allHistory: options.allHistory === true,
    noIndex: options.index === false,
    ...(trustedAuthors.length === 0 ? {} : { trustedAuthors }),
    ...(keys === undefined ? {} : { keys }),
    ...(at === undefined ? {} : { at }),
    ...(limit === undefined ? {} : { limit }),
  };
};

// ---------------------------------------------------------------------------
// JSON — the schema agents consume, so every field is always present
// ---------------------------------------------------------------------------

export interface JsonRecord {
  recordId: string | null;
  sha: string;
  shas: string[];
  committedAt: string;
  source: string;
  sources: string[];
  lifecycle: Lifecycle;
  flags: string[];
  trust: TrustGrade | null;
  provenance: string | null;
  supersededBy: string | null;
  expiresAt: string | null;
  paths: string[];
  trailers: Trailer[];
}

export interface JsonOutput {
  command: string;
  at: string;
  paths: string[];
  aliases: string[];
  follow: boolean;
  fromIndex: boolean;
  scanned: number;
  counts: {
    records: number;
    limits: number;
    ruledOut: number;
    warnings: number;
    other: number;
  };
  /**
   * `present` | `absent` | `unfetched` — whether the notes mirror could be read.
   *
   * A machine consumer needs this next to `counts.records`: zero records with
   * `notes: "unfetched"` is an unknown, not an empty, and the two are otherwise
   * the same bytes.
   */
  /**
   * `ready` | `empty` | `unavailable`. On `unavailable` the `records` array is
   * not a statement about this repository — git could not answer.
   */
  history: string;
  notes: string;
  diagnostics: string[];
  records: JsonRecord[];
}

const otherTrailers = (record: GradedRecord): Trailer[] =>
  record.trailers.filter(
    (trailer) => trailer.key !== RECORD_ID_KEY && !SECTION_KEYS.includes(trailer.key),
  );

const countKey = (records: readonly GradedRecord[], key: string): number =>
  records.reduce((total, record) => total + valuesOf(record, key).length, 0);

const toJsonRecord = (record: GradedRecord): JsonRecord => ({
  recordId: record.recordId ?? null,
  sha: record.sha,
  shas: record.shas,
  committedAt: record.committedAt,
  source: record.source,
  sources: record.sources,
  lifecycle: record.lifecycle,
  flags: record.flags,
  trust: record.trust ?? null,
  provenance: record.provenanceValue ?? null,
  supersededBy: record.supersededBy ?? null,
  expiresAt: record.expiresAt ?? null,
  paths: record.paths,
  trailers: record.trailers,
});

export const toJson = (command: string, result: QueryResult): JsonOutput => {
  const presented = withholdBlocked(result);
  return {
    command,
    at: presented.at.toISOString(),
    paths: presented.paths,
    aliases: presented.aliases,
    follow: presented.follow,
    fromIndex: presented.fromIndex,
    scanned: presented.scanned,
    counts: {
      records: presented.records.length,
      limits: countKey(presented.records, LIMIT_KEY),
      ruledOut: countKey(presented.records, RULED_OUT_KEY),
      warnings: countKey(presented.records, WARN_KEY),
      other: presented.records.reduce(
        (total, record) => total + otherTrailers(record).length,
        0,
      ),
    },
    history: presented.history,
    notes: presented.notes,
    diagnostics: presented.diagnostics,
    records: presented.records.map(toJsonRecord),
  };
};

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const shortSha = (sha: string): string => (sha.length > 8 ? sha.slice(0, 8) : sha);

const scopeSuffix = (result: QueryResult): string =>
  result.paths.length === 0 ? '' : ` for ${result.paths.join(', ')}`;

/**
 * Whether the index answered, and how much was read to answer. Both belong in
 * the header: an agent that gets a thin answer needs to know whether it was
 * reading a stale index or an empty repository.
 */
const provenanceSuffix = (result: QueryResult): string =>
  `${result.fromIndex ? 'index' : 'no index'}, ${result.scanned} commit record(s) scanned`;

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Marks anything the caller would otherwise have to infer: a record that is no
 * longer active (only reachable with `--all-history`), and the review flag a
 * condition-form `Expires:` raises.
 */
const stateTag = (record: GradedRecord): string => {
  const tags = [
    ...(record.lifecycle === 'active' ? [] : [record.lifecycle]),
    ...record.flags,
  ];
  return tags.length === 0 ? '' : `(${tags.join(', ')})  `;
};

const trustTag = (record: GradedRecord): string =>
  record.trust === undefined ? '' : `[${record.trust}]  `;

const idColumn = (record: GradedRecord, width: number): string =>
  (record.recordId ?? '-').padEnd(width);

const idWidth = (records: readonly GradedRecord[]): number =>
  records.reduce((width, record) => Math.max(width, (record.recordId ?? '-').length), 1);

/**
 * One line per trailer value, not per record: a commit that recorded three
 * `Limit:` lines constrains three different things, and collapsing them into
 * one row would hide two of them (SPEC §2.1 B5 keeps every repeat for exactly
 * this reason).
 */
const valueLines = (
  records: readonly GradedRecord[],
  key: string,
): string[] => {
  const width = idWidth(records);
  return records.flatMap((record) => {
    const values =
      record.trust === 'blocked'
        ? record.withheldTrailerKeys?.includes(key) === true
          ? [BLOCKED_RECORD_WITHHELD]
          : []
        : valuesOf(record, key);
    return values.map(
      (value) =>
        `  ${idColumn(record, width)}  ${shortSha(record.sha)}  ` +
        `${stateTag(record)}${trustTag(record)}${value}`,
    );
  });
};

const otherLines = (records: readonly GradedRecord[]): string[] => {
  const width = idWidth(records);
  return records.flatMap((record) => {
    const withheld =
      record.trust === 'blocked' &&
      record.withheldTrailerKeys?.some((key) => !SECTION_KEYS.includes(key)) === true
        ? [BLOCKED_RECORD_WITHHELD]
        : [];
    const values = [
      ...withheld,
      ...otherTrailers(record).map((trailer) => `${trailer.key}: ${trailer.value}`),
    ];
    return values.map(
      (value) =>
        `  ${idColumn(record, width)}  ${shortSha(record.sha)}  ` +
        `${stateTag(record)}${trustTag(record)}${value}`,
    );
  });
};

/**
 * The empty answer, and the one qualifier it must never omit.
 *
 * "no active records" is the most consequential sentence this command prints:
 * an agent reads it as "nothing was ruled out here". When the notes mirror has
 * not been fetched, that sentence is not merely unhelpful, it is wrong — the
 * records exist, upstream, and `git clone` does not bring them. The qualifier
 * goes on the same line as the claim it qualifies, because a diagnostic on
 * stderr is not read by whoever is reading stdout.
 */
const emptyLine = (result: QueryResult, what: string): string =>
  result.history === 'unavailable'
    ? `git could not read this repository, so there is no answer about ${what}${scopeSuffix(result)} — ` +
      'this is unknown, not empty\n'
    : result.notes === 'unfetched'
    ? `no active ${what}${scopeSuffix(result)} — but the notes mirror has not been ` +
      'fetched here, so this is not the same as "none exist" (commitlore doctor --fix)\n'
    : `no active ${what}${scopeSuffix(result)}\n`;

/** `limits`, `ruled-out` and `warnings`: one section, no header block. */
export const formatKind = (result: QueryResult, section: Section): string => {
  const presented = withholdBlocked(result);
  const lines = valueLines(presented.records, section.key);
  if (lines.length === 0) return emptyLine(presented, `${section.key} records`);

  const header =
    `${plural(lines.length, section.label.replace(/s$/, ''), section.label)}` +
    `${scopeSuffix(presented)} as of ${presented.at.toISOString()} (${provenanceSuffix(presented)})`;
  return `${[header, '', ...lines].join('\n')}\n`;
};

/**
 * `context`: every kind at once, under the summary header the ticket asks for
 * — how many of each kind are active, the instant they were judged at, and
 * whether the index answered.
 */
export const formatContext = (result: QueryResult): string => {
  const presented = withholdBlocked(result);
  const sections = SECTIONS.map((section) => ({
    label: section.label,
    lines: valueLines(presented.records, section.key),
  }));
  const other = otherLines(presented.records);
  const total = sections.reduce((sum, section) => sum + section.lines.length, 0) + other.length;

  if (total === 0) return emptyLine(presented, 'records');

  const summary = [
    ...sections.map((section) => `${section.lines.length} ${section.label}`),
    `${other.length} other`,
  ].join(', ');

  const header =
    `context${scopeSuffix(presented)} as of ${presented.at.toISOString()} — ${summary} ` +
    `in ${plural(presented.records.length, 'record', 'records')} (${provenanceSuffix(presented)})`;

  const body = [...sections, { label: 'other', lines: other }].flatMap((section) =>
    section.lines.length === 0 ? [] : ['', section.label, ...section.lines],
  );

  return `${[header, ...body].join('\n')}\n`;
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const emit = (
  name: string,
  result: QueryResult,
  options: QueryCommandOptions,
  render: (result: QueryResult) => string,
): void => {
  const presented = withholdBlocked(result);
  // Diagnostics go to stderr in both modes: they describe how the answer was
  // produced, and a caller piping `--json` into a parser must still see them.
  for (const diagnostic of presented.diagnostics) {
    process.stderr.write(`commitlore: ${diagnostic}\n`);
  }
  process.stdout.write(
    options.json === true
      ? `${JSON.stringify(toJson(name, presented), null, 2)}\n`
      : render(presented),
  );
  // Fail closed. An answer git could not produce must not exit 0: a caller that
  // branches on the exit code — a hook, a CI step, a shell `&&` — would read
  // success and an empty list as "this path has no constraints".
  if (presented.history === 'unavailable') process.exitCode = 1;
};

const define = (
  program: Command,
  name: string,
  description: string,
  keys: readonly string[] | undefined,
  render: (result: QueryResult) => string,
): void => {
  program
    .command(name)
    .description(description)
    .argument('[paths...]', 'limit the answer to these paths (renames are followed)')
    .option('--json', 'emit the answer as JSON')
    .option('--all-history', 'include superseded and expired records, each labelled')
    .option('--no-index', 'answer from git alone, without the SQLite index')
    .option('--at <instant>', 'evaluate as of an ISO 8601 instant (default: now)')
    .option('--limit <n>', 'return at most n records')
    .option(
      '--trusted-author <author>',
      'an author whose records may render as instructions (repeatable)',
      collect,
      [],
    )
    .action((paths: string[], options: QueryCommandOptions) => {
      try {
        emit(name, runQuery(queryOptions(paths, options, keys)), options, render);
      } catch (error) {
        process.stderr.write(
          `commitlore: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    });
};

export const register = (program: Command): void => {
  define(
    program,
    'context',
    'every active record for a path: limits, ruled-out alternatives and warnings',
    undefined,
    formatContext,
  );
  for (const section of SECTIONS) {
    define(
      program,
      section.label,
      `the active ${section.key}: records for a path`,
      [section.key],
      (result) => formatKind(result, section),
    );
  }
};
