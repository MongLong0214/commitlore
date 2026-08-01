/**
 * The query engine behind `context`, `limits`, `ruled-out` and `warnings`
 * (SPEC §5 — the consumer routes for `Limit:`, `Ruled-out:` and `Warn:`).
 *
 * Three things make this more than a filter over `index-db.ts`.
 *
 * ## Path scope follows renames
 *
 * `--follow` is the default, because a decision recorded against `a.ts` is
 * still about the file after it becomes `c/d.ts` — a path query that stops at
 * the rename silently reports "no constraints" for a file that has them, which
 * is the one wrong answer that looks like a healthy repository (D4).
 *
 * git does the following, not this module: `git log --follow --name-only`
 * reports the name the file carried at each commit, and that set of names is
 * what the index is then asked about. Resolving *names* rather than a set of
 * commits keeps the index's own path predicate in play, so a record on a merge
 * commit (indexed by its first-parent diff) is still found even where
 * `--follow`'s history simplification would not have walked it.
 *
 * `--follow` accepts exactly one pathspec — `git log --follow -- a b` exits
 * 128. Several paths therefore run without it, and say so: quietly answering a
 * different question than the flag advertises is worse than a rename that was
 * not followed.
 *
 * ## The lifecycle fold is global, the path scope is not
 *
 * A record about `src/auth/` can be retired by a `Supersedes:` on a commit that
 * touched only `docs/`. Folding just the path-scoped stream would therefore
 * report a retired record as active. The fold (`core/stale.ts`) runs over the
 * whole repository and only the *display* set is path-scoped.
 *
 * That global pass fetches `Record-Id`, `Supersedes` and `Expires` and nothing
 * else — every key the fold reads — so it stays an indexed key lookup rather
 * than a full table scan. Records carrying none of the three cannot be
 * superseded or expire, and default to `active`.
 *
 * ## Identity, not commits
 *
 * `Record-Id:` is the unit (SPEC §3.2): the same record re-declared across
 * commits, or mirrored into `refs/notes/commitlore`, is one record. Records
 * without one are keyed by their commit and source instead, so nothing can
 * `Supersedes:` them (correct — they have no identity to name) while a
 * date-form `Expires:` still retires them through the same fold.
 */
import { execGit, hasShallowHistory, historyAvailability, SHALLOW_HISTORY_CAVEAT, } from './git.js';
import { closeIndex, ensureIndex, queryTrailers, scanTrailers, } from './index-db.js';
import { authorsOf, gradeRecord, restrictGrade } from './grade.js';
import { NOTES_REF, notesAvailability } from './notes.js';
import { foldLifecycle, hasAmbiguousIdCollision, } from './stale.js';
import { SINGLE_VALUED, } from './types.js';
export const LIMIT_KEY = 'Limit';
export const RULED_OUT_KEY = 'Ruled-out';
export const WARN_KEY = 'Warn';
const RECORD_ID_KEY = 'Record-Id';
const PROVENANCE_KEY = 'Provenance';
/** Every key `foldLifecycle` reads. The global pass fetches exactly these. */
const LIFECYCLE_KEYS = [RECORD_ID_KEY, 'Supersedes', 'Expires'];
/**
 * Identity prefix for a record that declared no `Record-Id`. A colon cannot
 * appear in `r-[a-z0-9]{6,}` (SPEC §3.2), so a synthetic key can never collide
 * with a real one or be reachable from a `Supersedes:`.
 */
const SYNTHETIC_PREFIX = 'commit:';
/**
 * Upper bound on the names one path resolves to. A rename chain is a handful
 * of names; anything past this is a pathspec that matched the whole tree, and
 * one query per name would be the slow path pretending to be the fast one.
 */
const MAX_ALIASES = 64;
const errorMessage = (error) => error instanceof Error ? error.message : String(error);
/** Trailing slashes would make `src/` and `src` different prefixes. */
const normalizePath = (path) => path.replace(/\/+$/, '');
const normalizePaths = (opts) => {
    const raw = [...(opts.path === undefined ? [] : [opts.path]), ...(opts.paths ?? [])];
    const kept = [];
    for (const entry of raw) {
        const path = normalizePath(entry.trim());
        // `.` and `` name the whole repository, which is the unscoped query.
        if (path === '' || path === '.')
            continue;
        if (!kept.includes(path))
            kept.push(path);
    }
    return kept;
};
const scanSource = (cwd, diagnostics) => ({
    fetch: (query) => scanTrailers(query, { cwd }),
    fromIndex: false,
    close: () => { },
    diagnostics,
});
/**
 * Opens the index, falling back to the scan path on any failure.
 *
 * The index is derived and disposable (ADR-0003), so a missing native module,
 * a read-only checkout, or a file this build cannot open are all reasons to
 * answer more slowly — never reasons to refuse to answer. The fallback is
 * reported, because "slower" and "wrong" must not look alike from the outside.
 */
const openSource = (cwd, noIndex) => {
    if (noIndex)
        return scanSource(cwd, []);
    try {
        const { handle } = ensureIndex({ cwd });
        return {
            fetch: (query) => queryTrailers(handle, query),
            fromIndex: true,
            close: () => closeIndex(handle),
            diagnostics: [],
        };
    }
    catch (error) {
        return scanSource(cwd, [
            `the index is unavailable (${errorMessage(error)}); answering with a full scan`,
        ]);
    }
};
// ---------------------------------------------------------------------------
// Path scope
// ---------------------------------------------------------------------------
const RECORD_SEP = '\x01';
const FIELD_SEP = '\0';
/**
 * The same two bytes as git's own format escapes. They cannot be written
 * literally: `spawnSync` refuses an argument containing a NUL, so the
 * separators reach git as `%x01`/`%x00` and come back as bytes.
 */
const LOG_FORMAT = '--format=%x01%H%x00';
/**
 * Every name one path has carried, newest first, via `git log --follow`.
 *
 * `-z` is what makes a path containing a newline survive the round trip; the
 * separator git writes between the format output and the name list is the one
 * leading `\n` stripped here.
 */
const followedNames = (cwd, path) => {
    const result = execGit(['log', '--follow', '-z', '--name-only', LOG_FORMAT, '--', path], {
        cwd,
    });
    // A path git cannot resolve, or a repository with no commits, is not an
    // error here: it is a scope that no record falls into.
    if (result.code !== 0)
        return [];
    const names = [];
    for (const chunk of result.stdout.split(RECORD_SEP)) {
        const fields = chunk.split(FIELD_SEP);
        for (const field of fields.slice(1)) {
            const name = field.startsWith('\n') ? field.slice(1) : field;
            if (name !== '' && !names.includes(name))
                names.push(name);
        }
    }
    return names;
};
/**
 * Turns the requested paths into the names the index is asked about.
 *
 * Names already covered by the requested path's own prefix are dropped: they
 * add a query that can only return rows the prefix match already returns, and
 * for a directory pathspec that would be one query per file in the tree.
 */
/** How many parent directories are probed for the "did you mean" hint. */
const MAX_ANCESTOR_PROBES = 4;
/**
 * Whether the walked history mentions a path at all.
 *
 * Deliberately not a working-tree check: a deleted file has legitimate history
 * and legitimate records, and `stat` would call it missing (#307). This asks the
 * same history the query walks -- HEAD's -- so the answer describes the same
 * corpus the record count came from.
 */
const historyMentions = (cwd, path) => {
    const result = execGit(['log', '-1', '--format=%H', '--', path], { cwd });
    return result.code === 0 && result.stdout.trim() !== '';
};
/**
 * Says an empty answer is uninformative when the path was never in the history.
 *
 * `records: 0` reads as "nothing was recorded here, proceed". That is right for a
 * path that exists and recorded nothing, and wrong for a typo or a since-renamed
 * path, where the zero carries no information at all. Only the second case gets a
 * diagnostic.
 *
 * The nearest ancestor that does have history is named when there is one, because
 * that is what closes the loop in practice: the reporter's containing directory
 * held 15 records while the queried file had never existed.
 */
const pathPresenceDiagnostics = (cwd, paths) => {
    // One path only: with several, `git log --follow` is already off and the caller
    // has been told so, and a per-path probe would multiply git calls.
    if (paths.length !== 1)
        return [];
    const [path = ''] = paths;
    if (path === '' || path === '.')
        return [];
    if (historyMentions(cwd, path))
        return [];
    let hint = '';
    let ancestor = path;
    for (let probe = 0; probe < MAX_ANCESTOR_PROBES; probe += 1) {
        const cut = ancestor.lastIndexOf('/');
        if (cut <= 0)
            break;
        ancestor = ancestor.slice(0, cut);
        if (historyMentions(cwd, ancestor)) {
            hint = `; ${ancestor} does have history, so query that if the name has changed`;
            break;
        }
    }
    return [
        `${path} matched no blob in the walked history, so 0 records is uninformative rather than ` +
            `a statement that nothing was recorded${hint}`,
    ];
};
const resolveScope = (cwd, paths) => {
    if (paths.length === 0)
        return { aliases: [], follow: false, diagnostics: [] };
    if (paths.length > 1) {
        return {
            aliases: [...paths],
            follow: false,
            diagnostics: [
                `git log --follow accepts exactly one pathspec, so renames are not followed for ${paths.length} paths; ` +
                    'query one path at a time to follow its rename chain',
            ],
        };
    }
    const [path = ''] = paths;
    const aliases = [path];
    const diagnostics = [];
    for (const name of followedNames(cwd, path)) {
        if (name === path || name.startsWith(`${path}/`))
            continue;
        if (aliases.length >= MAX_ALIASES) {
            diagnostics.push(`${path} resolved to more than ${MAX_ALIASES} historical names; only the first ${MAX_ALIASES} were queried`);
            break;
        }
        aliases.push(name);
    }
    return { aliases, follow: true, diagnostics };
};
/** The total order both `queryTrailers` and `scanTrailers` already return. */
const compareRows = (a, b) => {
    if (a.committedTs !== b.committedTs)
        return b.committedTs - a.committedTs;
    if (a.sha !== b.sha)
        return a.sha < b.sha ? -1 : 1;
    if (a.source !== b.source)
        return a.source < b.source ? -1 : 1;
    if (a.block !== b.block)
        return a.block - b.block;
    return a.seq - b.seq;
};
/**
 * Fetches the display rows: one query per alias, unioned. Both row sources
 * answer the same `TrailerQuery`, which is what keeps the index path and the
 * `--no-index` path returning the same records.
 */
const collectRows = (source, aliases) => {
    if (aliases.length === 0)
        return source.fetch({});
    const seen = new Set();
    const rows = [];
    for (const alias of aliases) {
        for (const row of source.fetch({ path: alias })) {
            // Must match the row's real identity, the `trailers` table's own unique
            // index: `(commit_sha, source, block, seq)`. `seq` alone restarts at 0
            // within every block (SPEC §2.4), so a commit with two blocks has a
            // `seq: 1` row in *each* block. Without `block` here, a later alias
            // pass reads block 1's row as a repeat of block 0's row and drops it —
            // which is how two blocks sharing a `Record-Id` silently read as one
            // record at a scoped path (bug-issue-92).
            const identity = `${row.sha}\u0000${row.source}\u0000${row.block}\u0000${row.seq}`;
            if (seen.has(identity))
                continue;
            seen.add(identity);
            rows.push(row);
        }
    }
    return rows.sort(compareRows);
};
const groupByCommit = (rows) => {
    const found = new Map();
    for (const row of rows) {
        const key = `${row.sha}\u0000${row.source}\u0000${row.block}`;
        const existing = found.get(key);
        if (existing === undefined) {
            found.set(key, {
                sha: row.sha,
                block: row.block,
                source: row.source,
                mirrored: false,
                committedAt: row.committedAt,
                committedTs: row.committedTs,
                trailers: [{ key: row.key, value: row.value }],
                paths: [...row.paths],
            });
            continue;
        }
        existing.trailers.push({ key: row.key, value: row.value });
    }
    return [...found.values()];
};
const trailerValue = (trailers, key) => {
    const found = trailers.find((trailer) => trailer.key === key)?.value;
    return found === undefined || found === '' ? undefined : found;
};
/** `Record-Id:` when the record declared one, else a key nothing can reference. */
const identityOf = (record) => trailerValue(record.trailers, RECORD_ID_KEY) ??
    `${SYNTHETIC_PREFIX}${record.sha}:${record.source}:${record.block}`;
/**
 * A commit's instant in epoch ms, or `undefined` when git gave an unusable one.
 * Parsing `committedAt` rather than scaling `committedTs` keeps this in exact
 * step with the fold, which reads the same string.
 */
const instantOf = (record) => {
    const parsed = Date.parse(record.committedAt);
    return Number.isNaN(parsed) ? undefined : parsed;
};
/**
 * Folds an unidentified notes mirror into the same commit's record. Notes may
 * add transport metadata, which is preserved without turning the mirror into a
 * second record.
 *
 * A commit MAY now carry several blocks (SPEC §2.4), so a sha can map to
 * several candidate commit-sourced records rather than one. A notes block
 * folds into the first one whose own trailers are all present in the notes
 * block's trailers -- content, not block position, decides the match, since
 * nothing guarantees the two channels enumerate their blocks in the same
 * order. A notes block that matches no unclaimed commit block (or that
 * declares its own `Record-Id`, resolved separately by identity) survives as
 * its own record.
 */
const foldMirroredNotes = (records) => {
    const commits = new Map();
    for (const record of records) {
        if (record.source !== 'commit')
            continue;
        const list = commits.get(record.sha) ?? [];
        list.push(record);
        commits.set(record.sha, list);
    }
    const claimed = new Set();
    return records.filter((record) => {
        if (record.source !== 'notes')
            return true;
        if (trailerValue(record.trailers, RECORD_ID_KEY) !== undefined)
            return true;
        const candidates = commits.get(record.sha);
        if (candidates === undefined)
            return true;
        const contents = new Set(record.trailers.map((trailer) => `${trailer.key}\u0000${trailer.value}`));
        const commit = candidates.find((candidate) => !claimed.has(candidate) &&
            candidate.trailers.every((trailer) => contents.has(`${trailer.key}\u0000${trailer.value}`)));
        if (commit === undefined)
            return true;
        mergeTrailers(commit.trailers, record.trailers);
        commit.mirrored = true;
        claimed.add(commit);
        return false;
    });
};
// ---------------------------------------------------------------------------
// The lifecycle fold, over the whole repository
// ---------------------------------------------------------------------------
/**
 * Rewrites a record's `Record-Id:` to its resolved identity so the fold groups
 * unidentified records too. The synthetic id never reaches the output: it is
 * an input to `foldLifecycle`, which drops `Record-Id` from what it resolves.
 */
const withIdentity = (record) => {
    const identity = identityOf(record);
    const rest = record.trailers.filter((trailer) => trailer.key !== RECORD_ID_KEY);
    return [{ key: RECORD_ID_KEY, value: identity }, ...rest];
};
/**
 * Oldest commit first — the order `foldLifecycle` and `mergeByIdentity` both
 * read, so the lifecycle and the payload of one answer cannot come from
 * opposite ends of a tie.
 *
 * Both row sources return newest first (`ORDER BY committed_ts DESC,
 * commit_sha ASC` in `core/index-db.ts`), and the fold breaks a same-second
 * tie on input position, so handing over the rows as fetched resolved "latest
 * declaration wins" to whichever commit sha happened to sort last — a coin
 * flip dressed as a rule (issue #350). Reversed, it is deterministic, and it
 * is *only* deterministic: neither the index nor `scanTrailers` stores an
 * ordinal that says which of two commits in one second came first, so `sha`
 * here breaks the tie without claiming to mean anything. What keeps that from
 * being a quiet guess is `core/stale.ts`'s `instantConflicts`, which refuses
 * the tie outright when the two declarations disagree.
 */
const oldestFirst = (a, b) => {
    if (a.committedTs !== b.committedTs)
        return a.committedTs - b.committedTs;
    if (a.sha !== b.sha)
        return a.sha < b.sha ? -1 : 1;
    if (a.source !== b.source)
        return a.source < b.source ? -1 : 1;
    return a.block - b.block;
};
/**
 * Folds every record in the repository, so a supersession from outside the
 * path scope still retires what it names (SPEC §5).
 */
const foldStates = (source, at, cutoff) => {
    const records = groupByCommit(source.fetch({ keys: LIFECYCLE_KEYS })).sort(oldestFirst);
    const stream = records
        .filter((record) => {
        const instant = instantOf(record);
        return instant === undefined || instant <= cutoff;
    })
        .map((record) => ({
        sha: record.sha,
        committedAt: record.committedAt,
        source: record.source,
        trailers: withIdentity(record),
    }));
    return new Map(foldLifecycle(stream, { at }).map((state) => [state.recordId, state]));
};
// ---------------------------------------------------------------------------
// Merging one identity's commit records into one graded record
// ---------------------------------------------------------------------------
/**
 * Merges one commit's trailers into a record's resolved set: non-repeatable
 * keys (SPEC §3) are replaced in place so the latest declaration wins without
 * reordering, repeatable keys accumulate and skip values already present.
 *
 * `core/stale.ts` folds trailers the same way and does not export it. Reaching
 * into that module is not an option here, because the fold deliberately drops
 * `Record-Id` — identity is not payload there, and it is exactly the payload a
 * consumer route needs to print.
 */
const mergeTrailers = (into, from) => {
    for (const trailer of from) {
        if (SINGLE_VALUED.has(trailer.key)) {
            const at = into.findIndex((existing) => existing.key === trailer.key);
            if (at === -1)
                into.push({ ...trailer });
            else
                into[at] = { ...trailer };
            continue;
        }
        const duplicate = into.some((existing) => existing.key === trailer.key && existing.value === trailer.value);
        if (!duplicate)
            into.push({ ...trailer });
    }
};
const parseProvenance = (value) => {
    if (value === undefined)
        return undefined;
    const trimmed = value.trim();
    if (trimmed === 'authored')
        return { kind: 'authored' };
    if (trimmed === 'reconstructed')
        return { kind: 'reconstructed' };
    if (trimmed === 'unknown')
        return { kind: 'unknown' };
    if (trimmed === 'inherited' || trimmed.startsWith('inherited ')) {
        return { kind: 'inherited', sha: trimmed.slice('inherited'.length).trim() };
    }
    // Anything else is an `enum` violation for `commitlore validate` to report.
    // Guessing what it meant here would launder a malformed claim into a grade.
    return undefined;
};
/**
 * Grading is `core/grade.ts` — this route does not have its own rule.
 *
 * It used to. A placeholder here graded every record `directive` unless it
 * *admitted* to being reconstructed or of unknown origin, and `grade.ts` was
 * reached only by `inject` and `guard`. CLI `query` and the MCP server both come
 * through this function, so a `Warn:` written by anyone at all — including
 * whoever opened the last pull request — was handed to an agent as an
 * instruction, while the same record injected through the hook was correctly
 * downgraded to a claim. Two implementations of one policy is one implementation
 * and one hole.
 *
 * The author is fetched here rather than carried on `CommitRecord` because the
 * index does not store it: one `git show -s` over the surviving shas costs a
 * single spawn and cannot go stale against the commits it just read.
 */
const gradeMerged = (merged, cwd, at, trustedAuthors) => {
    if (merged.length === 0)
        return;
    const authors = authorsOf(cwd, merged.flatMap((record) => record.shas));
    for (const record of merged) {
        const shas = record.shas.length > 0 ? record.shas : [record.sha];
        let grade;
        for (const sha of shas) {
            const author = authors.get(sha);
            const one = gradeRecord({ trailers: record.trailers }, {
                at,
                ...(author === undefined ? {} : { author }),
                ...(trustedAuthors === undefined ? {} : { trustedAuthors }),
            });
            grade = grade === undefined ? one : restrictGrade(grade, one);
        }
        const resolved = grade ?? gradeRecord(record, { at, ...(trustedAuthors === undefined ? {} : { trustedAuthors }) });
        record.trust = resolved.trust;
        if (resolved.matchedTrailerKeys !== undefined) {
            record.matchedTrailerKeys = resolved.matchedTrailerKeys;
        }
    }
};
const mergeByIdentity = (records, states) => {
    const groups = new Map();
    for (const record of records) {
        const identity = identityOf(record);
        const existing = groups.get(identity);
        if (existing === undefined)
            groups.set(identity, [record]);
        else
            existing.push(record);
    }
    const merged = [];
    for (const [identity, group] of groups) {
        const ordered = [...group].sort(oldestFirst);
        const latest = ordered[ordered.length - 1];
        if (latest === undefined)
            continue;
        const trailers = [];
        const paths = new Set();
        const sources = [];
        const shas = [];
        for (const record of ordered) {
            mergeTrailers(trailers, record.trailers);
            for (const path of record.paths)
                paths.add(path);
            if (!sources.includes(record.source))
                sources.push(record.source);
            if (record.mirrored && !sources.includes('notes'))
                sources.push('notes');
            if (!shas.includes(record.sha))
                shas.push(record.sha);
        }
        const state = states.get(identity);
        const recordId = trailerValue(trailers, RECORD_ID_KEY);
        const provenanceValue = trailerValue(trailers, PROVENANCE_KEY);
        const provenance = parseProvenance(provenanceValue);
        const identityCollision = hasAmbiguousIdCollision(ordered);
        merged.push({
            trailers,
            sha: latest.sha,
            shas,
            source: sources.includes('commit') ? 'commit' : 'notes',
            sources,
            paths: [...paths].sort(),
            committedAt: latest.committedAt,
            committedTs: latest.committedTs,
            lifecycle: state?.lifecycle ?? 'active',
            flags: state?.flags ?? [],
            // `trust` is filled in by `gradeMerged` once the commit authors are
            // known. Left unset here rather than defaulted: a record that has not
            // been graded and a record graded `directive` must not look alike.
            ...(recordId === undefined ? {} : { recordId }),
            ...(provenance === undefined ? {} : { provenance }),
            ...(provenanceValue === undefined ? {} : { provenanceValue }),
            ...(identityCollision ? { identityCollision: true } : {}),
            ...(state?.supersededBy === undefined ? {} : { supersededBy: state.supersededBy }),
            ...(state?.expiresAt === undefined ? {} : { expiresAt: state.expiresAt }),
        });
    }
    return merged;
};
/** Newest record first; identity breaks the tie so the order is total. */
const compareRecords = (a, b) => {
    if (a.committedTs !== b.committedTs)
        return b.committedTs - a.committedTs;
    if (a.sha !== b.sha)
        return a.sha < b.sha ? -1 : 1;
    const left = a.recordId ?? '';
    const right = b.recordId ?? '';
    return left < right ? -1 : left > right ? 1 : 0;
};
const carriesKey = (record, keys) => {
    if (keys === undefined || keys.length === 0)
        return true;
    return record.trailers.some((trailer) => keys.includes(trailer.key));
};
/**
 * Answers one path-scoped, lifecycle-filtered query.
 *
 * The evaluation instant defaults to now here and nowhere deeper, so that no
 * test of the fold depends on the day it runs. A commit dated after that
 * instant has not happened yet and is invisible to both the fold and the
 * display set — `--at` is a time machine, and a stream where the two disagreed
 * would report records whose supersessions had not been read.
 */
export const runQuery = (opts = {}) => {
    const cwd = opts.cwd ?? process.cwd();
    const at = opts.at ?? new Date();
    const cutoff = at.getTime();
    if (Number.isNaN(cutoff))
        throw new Error('runQuery: opts.at is not a valid Date');
    const paths = normalizePaths(opts);
    const source = openSource(cwd, opts.noIndex === true);
    const diagnostics = [...source.diagnostics];
    try {
        const scope = resolveScope(cwd, paths);
        diagnostics.push(...scope.diagnostics);
        if (opts.explainEmptyResult === true)
            diagnostics.push(...pathPresenceDiagnostics(cwd, paths));
        const states = foldStates(source, at, cutoff);
        const commitRecords = groupByCommit(collectRows(source, scope.aliases));
        const visible = foldMirroredNotes(commitRecords.filter((record) => {
            const instant = instantOf(record);
            return instant === undefined || instant <= cutoff;
        }));
        const records = mergeByIdentity(visible, states)
            .filter((record) => opts.allHistory === true || record.lifecycle === 'active')
            .filter((record) => carriesKey(record, opts.keys))
            .sort(compareRecords);
        // After the filters, so the one `git show` prices only the records that survive.
        gradeMerged(records, cwd, at, opts.trustedAuthors);
        for (const record of records) {
            if (record.identityCollision !== true)
                continue;
            record.trust = 'blocked';
            record.matchedTrailerKeys = [RECORD_ID_KEY];
        }
        // Config only — no network. Cheap enough to run on every answer, and the
        // answer it qualifies is the empty one, which is the answer nobody inspects.
        const history = historyAvailability(cwd);
        if (history === 'unavailable') {
            diagnostics.push('git could not read this repository, so this is not an answer about its contents — ' +
                'treat it as unknown, not as empty');
        }
        const shallow = hasShallowHistory(cwd);
        if (shallow)
            diagnostics.push(`${SHALLOW_HISTORY_CAVEAT} (fix: git fetch --unshallow)`);
        const notes = notesAvailability({ cwd });
        if (notes === 'unfetched') {
            diagnostics.push('the notes mirror has not been fetched here, so this answer may be missing records ' +
                `that exist upstream (git fetch does not fetch ${NOTES_REF} by default). ` +
                'fix: commitlore doctor --fix, then git fetch');
        }
        return {
            records: opts.limit === undefined ? records : records.slice(0, Math.max(0, Math.trunc(opts.limit))),
            fromIndex: source.fromIndex,
            scanned: commitRecords.length,
            at,
            paths,
            aliases: scope.aliases,
            follow: scope.follow,
            history,
            shallow,
            notes,
            diagnostics,
        };
    }
    finally {
        source.close();
    }
};
/** The values a record carries under one key, in order (SPEC §2.1 B5). */
export const valuesOf = (record, key) => record.trailers.filter((trailer) => trailer.key === key).map((trailer) => trailer.value);
//# sourceMappingURL=query.js.map