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
import { LIMIT_KEY, RULED_OUT_KEY, WARN_KEY, runQuery, valuesOf, } from '../core/query.js';
/** Identity is printed in its own column, never as a trailer line. */
const RECORD_ID_KEY = 'Record-Id';
const SECTIONS = [
    { label: 'limits', key: LIMIT_KEY },
    { label: 'ruled-out', key: RULED_OUT_KEY },
    { label: 'warnings', key: WARN_KEY },
];
const SECTION_KEYS = SECTIONS.map((section) => section.key);
/** Repeatable option accumulator, as `commands/inject.ts` uses. */
const collect = (value, previous) => [...previous, value];
// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------
/**
 * Resolves `--at`. Defaulting to now belongs here and nowhere deeper: the
 * engine takes the instant as an argument precisely so that no test of it
 * depends on the day it runs.
 */
const evaluationInstant = (raw) => {
    if (raw === undefined)
        return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`--at is not a valid ISO 8601 instant: ${raw}`);
    }
    return parsed;
};
const recordLimit = (raw) => {
    if (raw === undefined)
        return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`--limit is not a non-negative integer: ${raw}`);
    }
    return parsed;
};
const queryOptions = (paths, options, keys) => {
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
const otherTrailers = (record) => record.trailers.filter((trailer) => trailer.key !== RECORD_ID_KEY && !SECTION_KEYS.includes(trailer.key));
const countKey = (records, key) => records.reduce((total, record) => total + valuesOf(record, key).length, 0);
const toJsonRecord = (record) => ({
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
export const toJson = (command, result) => ({
    command,
    at: result.at.toISOString(),
    paths: result.paths,
    aliases: result.aliases,
    follow: result.follow,
    fromIndex: result.fromIndex,
    scanned: result.scanned,
    counts: {
        records: result.records.length,
        limits: countKey(result.records, LIMIT_KEY),
        ruledOut: countKey(result.records, RULED_OUT_KEY),
        warnings: countKey(result.records, WARN_KEY),
        other: result.records.reduce((total, record) => total + otherTrailers(record).length, 0),
    },
    history: result.history,
    notes: result.notes,
    diagnostics: result.diagnostics,
    records: result.records.map(toJsonRecord),
});
// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
const shortSha = (sha) => (sha.length > 8 ? sha.slice(0, 8) : sha);
const scopeSuffix = (result) => result.paths.length === 0 ? '' : ` for ${result.paths.join(', ')}`;
/**
 * Whether the index answered, and how much was read to answer. Both belong in
 * the header: an agent that gets a thin answer needs to know whether it was
 * reading a stale index or an empty repository.
 */
const provenanceSuffix = (result) => `${result.fromIndex ? 'index' : 'no index'}, ${result.scanned} commit record(s) scanned`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
/**
 * Marks anything the caller would otherwise have to infer: a record that is no
 * longer active (only reachable with `--all-history`), and the review flag a
 * condition-form `Expires:` raises.
 */
const stateTag = (record) => {
    const tags = [
        ...(record.lifecycle === 'active' ? [] : [record.lifecycle]),
        ...record.flags,
    ];
    return tags.length === 0 ? '' : `(${tags.join(', ')})  `;
};
const trustTag = (record) => record.trust === undefined ? '' : `[${record.trust}]  `;
const idColumn = (record, width) => (record.recordId ?? '-').padEnd(width);
const idWidth = (records) => records.reduce((width, record) => Math.max(width, (record.recordId ?? '-').length), 1);
/**
 * One line per trailer value, not per record: a commit that recorded three
 * `Limit:` lines constrains three different things, and collapsing them into
 * one row would hide two of them (SPEC §2.1 B5 keeps every repeat for exactly
 * this reason).
 */
const valueLines = (records, key, withTrust) => {
    const width = idWidth(records);
    return records.flatMap((record) => valuesOf(record, key).map((value) => `  ${idColumn(record, width)}  ${shortSha(record.sha)}  ` +
        `${stateTag(record)}${withTrust ? trustTag(record) : ''}${value}`));
};
const otherLines = (records) => {
    const width = idWidth(records);
    return records.flatMap((record) => otherTrailers(record).map((trailer) => `  ${idColumn(record, width)}  ${shortSha(record.sha)}  ` +
        `${stateTag(record)}${trailer.key}: ${trailer.value}`));
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
const emptyLine = (result, what) => result.history === 'unavailable'
    ? `git could not read this repository, so there is no answer about ${what}${scopeSuffix(result)} — ` +
        'this is unknown, not empty\n'
    : result.notes === 'unfetched'
        ? `no active ${what}${scopeSuffix(result)} — but the notes mirror has not been ` +
            'fetched here, so this is not the same as "none exist" (commitlore doctor --fix)\n'
        : `no active ${what}${scopeSuffix(result)}\n`;
/** `limits`, `ruled-out` and `warnings`: one section, no header block. */
export const formatKind = (result, section) => {
    const lines = valueLines(result.records, section.key, section.key === WARN_KEY);
    if (lines.length === 0)
        return emptyLine(result, `${section.key} records`);
    const header = `${plural(lines.length, section.label.replace(/s$/, ''), section.label)}` +
        `${scopeSuffix(result)} as of ${result.at.toISOString()} (${provenanceSuffix(result)})`;
    return `${[header, '', ...lines].join('\n')}\n`;
};
/**
 * `context`: every kind at once, under the summary header the ticket asks for
 * — how many of each kind are active, the instant they were judged at, and
 * whether the index answered.
 */
export const formatContext = (result) => {
    const sections = SECTIONS.map((section) => ({
        label: section.label,
        lines: valueLines(result.records, section.key, section.key === WARN_KEY),
    }));
    const other = otherLines(result.records);
    const total = sections.reduce((sum, section) => sum + section.lines.length, 0) + other.length;
    if (total === 0)
        return emptyLine(result, 'records');
    const summary = [
        ...sections.map((section) => `${section.lines.length} ${section.label}`),
        `${other.length} other`,
    ].join(', ');
    const header = `context${scopeSuffix(result)} as of ${result.at.toISOString()} — ${summary} ` +
        `in ${plural(result.records.length, 'record', 'records')} (${provenanceSuffix(result)})`;
    const body = [...sections, { label: 'other', lines: other }].flatMap((section) => section.lines.length === 0 ? [] : ['', section.label, ...section.lines]);
    return `${[header, ...body].join('\n')}\n`;
};
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
const emit = (name, result, options, render) => {
    // Diagnostics go to stderr in both modes: they describe how the answer was
    // produced, and a caller piping `--json` into a parser must still see them.
    for (const diagnostic of result.diagnostics) {
        process.stderr.write(`commitlore: ${diagnostic}\n`);
    }
    process.stdout.write(options.json === true ? `${JSON.stringify(toJson(name, result), null, 2)}\n` : render(result));
    // Fail closed. An answer git could not produce must not exit 0: a caller that
    // branches on the exit code — a hook, a CI step, a shell `&&` — would read
    // success and an empty list as "this path has no constraints".
    if (result.history === 'unavailable')
        process.exitCode = 1;
};
const define = (program, name, description, keys, render) => {
    program
        .command(name)
        .description(description)
        .argument('[paths...]', 'limit the answer to these paths (renames are followed)')
        .option('--json', 'emit the answer as JSON')
        .option('--all-history', 'include superseded and expired records, each labelled')
        .option('--no-index', 'answer from git alone, without the SQLite index')
        .option('--at <instant>', 'evaluate as of an ISO 8601 instant (default: now)')
        .option('--limit <n>', 'return at most n records')
        .option('--trusted-author <author>', 'an author whose records may render as instructions (repeatable)', collect, [])
        .action((paths, options) => {
        try {
            emit(name, runQuery(queryOptions(paths, options, keys)), options, render);
        }
        catch (error) {
            process.stderr.write(`commitlore: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        }
    });
};
export const register = (program) => {
    define(program, 'context', 'every active record for a path: limits, ruled-out alternatives and warnings', undefined, formatContext);
    for (const section of SECTIONS) {
        define(program, section.label, `the active ${section.key}: records for a path`, [section.key], (result) => formatKind(result, section));
    }
};
//# sourceMappingURL=query.js.map