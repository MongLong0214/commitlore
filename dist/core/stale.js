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
import { RECORD_ID_RE, SINGLE_VALUED, } from './types.js';
const RECORD_ID_KEY = 'Record-Id';
const SUPERSEDES_KEY = 'Supersedes';
const FOLLOWS_KEY = 'Follows';
const EXPIRES_KEY = 'Expires';
/** The only flag the core raises today. `flags` stays open for later routes. */
export const REVIEW_FLAG = 'review';
/** `want` text for a dangling reference, fixed by spec/fixtures/invalid/05. */
const DANGLING_WANT = 'an existing Record-Id in history';
const UNIQUE_ID_WANT = 'exactly one record per Record-Id';
const DAY_MS = 86_400_000;
/** Shape-only gate for a date-form `Expires:`; realness is checked separately. */
const DATE_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;
const trailerValue = (trailers, key) => trailers.find((trailer) => trailer.key === key)?.value;
/** Epoch ms of a record's commit, or `undefined` when it has no usable instant. */
const instantOf = (record) => {
    if (record.committedAt === undefined)
        return undefined;
    const parsed = Date.parse(record.committedAt);
    return Number.isNaN(parsed) ? undefined : parsed;
};
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
const chronological = (records) => {
    let carried = Number.NEGATIVE_INFINITY;
    const keyed = records.map((record, index) => {
        const at = instantOf(record);
        if (at !== undefined)
            carried = at;
        return { record, index, at: carried };
    });
    return keyed
        .sort((a, b) => {
        if (a.at === b.at)
            return a.index - b.index;
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
const expiryEndOf = (value) => {
    if (value === undefined || !DATE_SHAPE_RE.test(value))
        return undefined;
    const start = Date.parse(`${value}T00:00:00Z`);
    if (Number.isNaN(start))
        return undefined;
    if (new Date(start).toISOString().slice(0, 10) !== value)
        return undefined;
    return start + DAY_MS;
};
/**
 * Merges one commit's trailers into a record's resolved set. Non-repeatable
 * keys (SPEC §3 cardinality) are replaced in place so the latest commit wins
 * without reordering the record; repeatable keys accumulate, skipping values
 * already present — a follow-up commit that re-declares a record repeats its
 * context, and duplicating it in the resolved view is noise, not data.
 */
const mergeTrailers = (into, from) => {
    for (const trailer of from) {
        if (trailer.key === RECORD_ID_KEY)
            continue;
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
/** Collapses every commit that declared a `Record-Id` into one entry, latest wins. */
const declarations = (ordered) => {
    const found = new Map();
    for (const { record } of ordered) {
        const recordId = trailerValue(record.trailers, RECORD_ID_KEY);
        if (recordId === undefined)
            continue;
        const declaration = found.get(recordId) ?? { recordId, sha: '', trailers: [] };
        if (record.sha !== undefined)
            declaration.sha = record.sha;
        mergeTrailers(declaration.trailers, record.trailers);
        found.set(recordId, declaration);
    }
    return found;
};
/**
 * Maps every retired `Record-Id` to the commit that retired it. The earliest
 * retiring commit wins: that is when the record stopped being active.
 */
const supersessions = (ordered) => {
    const found = new Map();
    for (const { record } of ordered) {
        for (const trailer of record.trailers) {
            if (trailer.key !== SUPERSEDES_KEY)
                continue;
            if (found.has(trailer.value))
                continue;
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
export const foldLifecycle = (records, opts) => {
    const cutoff = opts.at.getTime();
    // An Invalid Date would compare false against every instant and quietly fold
    // the whole stream to nothing — "no records" is the one wrong answer that
    // looks like a healthy repository.
    if (Number.isNaN(cutoff))
        throw new Error('foldLifecycle: opts.at is not a valid Date');
    const ordered = chronological(records).filter((entry) => entry.at <= cutoff);
    const retired = supersessions(ordered);
    return [...declarations(ordered).values()].map((declaration) => {
        const supersededBy = retired.get(declaration.recordId);
        const expiresAt = trailerValue(declaration.trailers, EXPIRES_KEY);
        const expiryEnd = expiryEndOf(expiresAt);
        const expired = expiryEnd !== undefined && cutoff >= expiryEnd;
        const lifecycle = supersededBy !== undefined ? 'superseded' : expired ? 'expired' : 'active';
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
export const findDanglingRefs = (records, referencedBy = records) => {
    const declared = new Set();
    for (const record of records) {
        const recordId = trailerValue(record.trailers, RECORD_ID_KEY);
        if (recordId !== undefined)
            declared.add(recordId);
    }
    const violations = [];
    for (const record of referencedBy) {
        for (const trailer of record.trailers) {
            if (trailer.key !== SUPERSEDES_KEY && trailer.key !== FOLLOWS_KEY)
                continue;
            if (!RECORD_ID_RE.test(trailer.value))
                continue;
            if (declared.has(trailer.value))
                continue;
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
const payloadSignature = (record) => record.trailers
    .filter((trailer) => trailer.key !== RECORD_ID_KEY)
    .map((trailer) => `${trailer.key}\u0000${trailer.value}`)
    .sort()
    .join('\u0001');
/**
 * A note may mirror a commit byte-for-byte, but it may not add or replace
 * content under an identity already declared elsewhere. Commit-only
 * re-declarations remain lifecycle updates (SPEC §5).
 */
export const findIdCollisions = (records) => {
    const groups = new Map();
    for (const record of records) {
        const recordId = trailerValue(record.trailers, RECORD_ID_KEY);
        if (recordId === undefined)
            continue;
        const group = groups.get(recordId);
        if (group === undefined)
            groups.set(recordId, [record]);
        else
            group.push(record);
    }
    return [...groups]
        .filter(([, group]) => {
        if (!group.some((record) => record.source === 'notes'))
            return false;
        return new Set(group.map(payloadSignature)).size > 1;
    })
        .map(([recordId]) => ({
        key: RECORD_ID_KEY,
        value: recordId,
        rule: 'duplicate-id',
        got: recordId,
        want: UNIQUE_ID_WANT,
    }));
};
/** Whether a state belongs in a stale report: retired, expired, or flagged. */
export const isStale = (state) => state.lifecycle !== 'active' || state.flags.length > 0;
//# sourceMappingURL=stale.js.map