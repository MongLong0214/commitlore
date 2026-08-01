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
import { BLOCKED_RECORD_WITHHELD } from '../core/grade.js';
import { LIMIT_KEY, RULED_OUT_KEY, WARN_KEY, runQuery, valuesOf, } from '../core/query.js';
import { validateRecord } from '../core/schema.js';
import { splitRuledOut } from '../core/trailers.js';
import { STRUCTURAL_TRAILER_KEYS } from '../core/types.js';
/** Identity is printed in its own column, never as a trailer line. */
const RECORD_ID_KEY = 'Record-Id';
/** Usage error: no repository, an unparseable flag (SPEC §10) -- not a finding. */
const USAGE_EXIT_CODE = 2;
const INCOMPLETE_EXIT_CODE = 3;
const SECTIONS = [
    { label: 'limits', key: LIMIT_KEY },
    { label: 'ruled-out', key: RULED_OUT_KEY },
    { label: 'warnings', key: WARN_KEY },
];
const SECTION_KEYS = SECTIONS.map((section) => section.key);
export const withholdBlocked = (result) => {
    const blocked = result.records.filter((record) => record.trust === 'blocked' && record.withheldTrailerKeys === undefined);
    if (blocked.length === 0)
        return result;
    const collisions = blocked.filter((record) => record.identityCollision === true);
    const injectionBlocked = blocked.filter((record) => record.identityCollision !== true);
    const keys = [
        ...new Set(injectionBlocked.flatMap((record) => record.matchedTrailerKeys ?? [])),
    ].sort();
    const source = keys.length === 1 ? `${keys[0]} trailer` : keys.length > 1 ? `${keys.join(', ')} trailers` : 'a trailer';
    const records = result.records.map((record) => {
        if (record.trust !== 'blocked' || record.withheldTrailerKeys !== undefined)
            return record;
        const trailers = record.trailers.filter((trailer) => STRUCTURAL_TRAILER_KEYS.has(trailer.key) && validateRecord([trailer]).length === 0);
        const recordId = trailers.find((trailer) => trailer.key === RECORD_ID_KEY)?.value;
        const provenanceValue = trailers.find((trailer) => trailer.key === 'Provenance')?.value;
        const { recordId: _unsafeRecordId, provenanceValue: _unsafeProvenanceValue, expiresAt: _unsafeExpiresAt, ...safeRecord } = record;
        return {
            ...safeRecord,
            ...(recordId === undefined ? {} : { recordId }),
            ...(provenanceValue === undefined ? {} : { provenanceValue }),
            withheldTrailerKeys: [
                ...new Set(record.trailers
                    .filter((trailer) => !trailers.includes(trailer))
                    .map((trailer) => trailer.key)),
            ],
            trailers,
        };
    });
    return {
        ...result,
        records,
        diagnostics: [
            ...result.diagnostics,
            ...(injectionBlocked.length === 0
                ? []
                : [
                    `withheld the content of ${injectionBlocked.length} record(s) graded blocked: a ${source} matching an ` +
                        'injection pattern is reported, never quoted (SPEC §7)',
                ]),
            ...(collisions.length === 0
                ? []
                : [
                    // Not "a divergent note": a Record-Id also collides when one
                    // message declares it twice (bug-issue-92) and when two commits
                    // made in the same second declare it with different values
                    // (issue #350). Naming only the first cause sends a reader
                    // hunting for a note that is not there.
                    `withheld the content of ${collisions.length} record(s) whose Record-Id is declared ` +
                        'more than once with no way to tell which declaration is current',
                ]),
        ],
    };
};
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
        // A caller who typed a path meant that path, so an empty answer has to say
        // whether the path was ever there (#307). The hook path deliberately does
        // not set this: a new file has no history and that is not a finding.
        explainEmptyResult: true,
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
    identityCollision: record.identityCollision === true,
    provenance: record.provenanceValue ?? null,
    supersededBy: record.supersededBy ?? null,
    expiresAt: record.expiresAt ?? null,
    paths: record.paths,
    trailers: record.trailers,
});
export const toJson = (command, result) => {
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
            other: presented.records.reduce((total, record) => total + otherTrailers(record).length, 0),
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
const blockedMessage = (record) => record.identityCollision === true
    ? 'Record content was withheld because its Record-Id collides.'
    : BLOCKED_RECORD_WITHHELD;
const idColumn = (record, width) => (record.recordId ?? '-').padEnd(width);
const idWidth = (records) => records.reduce((width, record) => Math.max(width, (record.recordId ?? '-').length), 1);
/**
 * Issue #372: a `Ruled-out:` value with a second `|` is printed verbatim, and
 * verbatim it reads exactly like one whose separator landed where the author
 * meant it to. The consumer routes match on the alternative alone, so the
 * split — not the value — is what a reader has to be able to check, and this
 * is the surface where a record already in history can still be checked at
 * all. `commitlore validate` refuses the provably-wrong subset at commit time,
 * but it cannot reach back into records already written.
 */
const separatorNote = (key, value) => {
    if (key !== RULED_OUT_KEY)
        return '';
    const split = splitRuledOut(value);
    if (!split.ambiguous)
        return '';
    return `  (more than one "|" — alternative: ${JSON.stringify(split.alternative)})`;
};
/**
 * One line per trailer value, not per record: a commit that recorded three
 * `Limit:` lines constrains three different things, and collapsing them into
 * one row would hide two of them (SPEC §2.1 B5 keeps every repeat for exactly
 * this reason).
 */
const valueLines = (records, key) => {
    const width = idWidth(records);
    return records.flatMap((record) => {
        const withheld = record.trust === 'blocked';
        const values = withheld
            ? record.withheldTrailerKeys?.includes(key) === true
                ? [blockedMessage(record)]
                : []
            : valuesOf(record, key);
        return values.map((value) => `  ${idColumn(record, width)}  ${shortSha(record.sha)}  ` +
            `${stateTag(record)}${trustTag(record)}${value}` +
            // A withheld record's line is a notice, not a value; annotating it
            // would describe the notice's own punctuation.
            (withheld ? '' : separatorNote(key, value)));
    });
};
const otherLines = (records) => {
    const width = idWidth(records);
    return records.flatMap((record) => {
        const withheld = record.trust === 'blocked' &&
            record.withheldTrailerKeys?.some((key) => !SECTION_KEYS.includes(key)) === true
            ? [blockedMessage(record)]
            : [];
        const values = [
            ...withheld,
            ...otherTrailers(record).map((trailer) => `${trailer.key}: ${trailer.value}`),
        ];
        return values.map((value) => `  ${idColumn(record, width)}  ${shortSha(record.sha)}  ` +
            `${stateTag(record)}${trustTag(record)}${value}`);
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
const emptyLine = (result, what) => result.history === 'unavailable'
    ? `git could not read this repository, so there is no answer about ${what}${scopeSuffix(result)} — ` +
        'this is unknown, not empty\n'
    : result.notes === 'unfetched'
        ? `no active ${what}${scopeSuffix(result)} — but the notes mirror has not been ` +
            'fetched here, so this is not the same as "none exist" (commitlore doctor --fix)\n'
        : `no active ${what}${scopeSuffix(result)}\n`;
/** `limits`, `ruled-out` and `warnings`: one section, no header block. */
export const formatKind = (result, section) => {
    const presented = withholdBlocked(result);
    const lines = valueLines(presented.records, section.key);
    if (lines.length === 0)
        return emptyLine(presented, `${section.key} records`);
    const header = `${plural(lines.length, section.label.replace(/s$/, ''), section.label)}` +
        `${scopeSuffix(presented)} as of ${presented.at.toISOString()} (${provenanceSuffix(presented)})`;
    return `${[header, '', ...lines].join('\n')}\n`;
};
/**
 * `context`: every kind at once, under the summary header the ticket asks for
 * — how many of each kind are active, the instant they were judged at, and
 * whether the index answered.
 */
export const formatContext = (result) => {
    const presented = withholdBlocked(result);
    const sections = SECTIONS.map((section) => ({
        label: section.label,
        lines: valueLines(presented.records, section.key),
    }));
    const other = otherLines(presented.records);
    const total = sections.reduce((sum, section) => sum + section.lines.length, 0) + other.length;
    if (total === 0)
        return emptyLine(presented, 'records');
    const summary = [
        ...sections.map((section) => `${section.lines.length} ${section.label}`),
        `${other.length} other`,
    ].join(', ');
    const header = `context${scopeSuffix(presented)} as of ${presented.at.toISOString()} — ${summary} ` +
        `in ${plural(presented.records.length, 'record', 'records')} (${provenanceSuffix(presented)})`;
    const body = [...sections, { label: 'other', lines: other }].flatMap((section) => section.lines.length === 0 ? [] : ['', section.label, ...section.lines]);
    return `${[header, ...body].join('\n')}\n`;
};
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
const emit = (name, result, options, render) => {
    const presented = withholdBlocked(result);
    // Diagnostics go to stderr in both modes: they describe how the answer was
    // produced, and a caller piping `--json` into a parser must still see them.
    for (const diagnostic of presented.diagnostics) {
        process.stderr.write(`commitlore: ${diagnostic}\n`);
    }
    process.stdout.write(options.json === true
        ? `${JSON.stringify(toJson(name, presented), null, 2)}\n`
        : render(presented));
    // Exit 2 means git could not answer at all -- no repository is a usage
    // error (SPEC §10), not a finding; exit 3 means git answered from a
    // known-incomplete store, matching guard so callers can distinguish the two.
    if (presented.history === 'unavailable')
        process.exitCode = USAGE_EXIT_CODE;
    else if (presented.notes === 'unfetched')
        process.exitCode = INCOMPLETE_EXIT_CODE;
};
const define = (program, name, description, keys, render) => {
    program
        .command(name)
        .description(description)
        .argument('[paths...]', 'limit paths; renames follow only when one path is given')
        .option('--json', 'emit the answer as JSON')
        .option('--all-history', 'include superseded and expired records, each labelled')
        .option('--no-index', 'answer from git alone, without the SQLite index')
        .option('--at <instant>', 'evaluate as of an ISO 8601 instant (default: now)')
        .option('--limit <n>', 'return at most n records')
        .option('--trusted-author <author>', 'an author whose records may render as instructions (repeatable)', collect, [])
        .addHelpText('after', '\nExit codes: 0 answered (with or without records), 2 could not run (no repository, a bad flag), ' +
        '3 answered, but the notes mirror has not been fetched (SPEC §10).')
        .action((paths, options) => {
        try {
            emit(name, runQuery(queryOptions(paths, options, keys)), options, render);
        }
        catch (error) {
            process.stderr.write(`commitlore: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = USAGE_EXIT_CODE;
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