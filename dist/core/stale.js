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
/**
 * Exported so `commands/validate.ts` can report the exact same wording for
 * the same `duplicate-id` rule when it detects a same-message collision
 * directly from `core/trailers.ts`'s `labelRecordBlocks` (bug-issue-145) — one
 * rule should read the same regardless of which check found it.
 */
export const UNIQUE_ID_WANT = 'exactly one record per Record-Id';
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
 *
 * That tie-break is a contract on the caller, not an implementation detail:
 * `committedAt` comes from `%ct`, which has one-second resolution, so two
 * commits made in the same second are equal on the only axis this orders by
 * and input position is all that is left. **Callers must feed oldest-first.**
 * A `git log` walk never emits a parent before its child, so reversing one
 * yields a real topological order and "latest declaration wins" then means
 * what it says; feeding the walk unreversed inverts it (issue #350). Where a
 * caller has no topological order to give — the index stores none — the tie is
 * deterministic but arbitrary, which is why {@link instantConflicts} refuses
 * to let an arbitrary choice decide a record's content.
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
        const recordId = trailerValue(record.trailers, RECORD_ID_KEY);
        for (const trailer of record.trailers) {
            if (trailer.key !== SUPERSEDES_KEY)
                continue;
            // A duplicate declaration can name its own id to resolve that duplicate;
            // it updates the record and does not retire the resolved identity.
            if (trailer.value === recordId)
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
    const undecidable = undecidableExpiry(ordered);
    return [...declarations(ordered).values()].map((declaration) => {
        const supersededBy = retired.get(declaration.recordId);
        const expiresAt = trailerValue(declaration.trailers, EXPIRES_KEY);
        // An expiry the stream cannot order is not an expiry this engine may
        // compute: the two candidate dates can be opposite answers, and `undefined`
        // routes the record to the same `review` flag a condition-form `Expires:`
        // gets — a question for a human, not a retirement on a coin flip.
        const expiryEnd = undecidable.has(declaration.recordId)
            ? undefined
            : expiryEndOf(expiresAt);
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
const groupsByRecordId = (records) => {
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
    return groups;
};
/**
 * The non-repeatable keys on which two commits made in the same second give
 * one `Record-Id` different answers.
 *
 * `committedAt` carries `%ct`, one second of resolution, so commits inside one
 * second are equal on the axis {@link chronological} orders by and no ordering
 * of the stream can say which declaration is the later one. Where they agree
 * there is nothing to decide. Where they disagree, "latest wins" has no latest
 * to name and the two answers can be opposite — `Expires: 2026-12-31` against
 * `Expires: 2026-01-31` is a constraint that is live all year or lapsed months
 * ago, decided by nothing but which record the caller happened to hand over
 * last (issue #350). Repeatable keys are excluded: they accumulate rather than
 * replace, so every order folds to the same set.
 *
 * Two shas are required, so a single commit declaring one identity twice stays
 * {@link sharesACommit}'s to report. `notes` records are excluded because a
 * mirror always shares its commit's instant *and* its sha; a note that has
 * drifted from its commit is already ambiguous under the payload rule below.
 */
const instantConflicts = (group) => {
    const shas = new Map();
    const values = new Map();
    for (const record of group) {
        if (record.source === 'notes' || record.sha === undefined)
            continue;
        const at = instantOf(record);
        if (at === undefined)
            continue;
        let commits = shas.get(at);
        if (commits === undefined) {
            commits = new Set();
            shas.set(at, commits);
        }
        commits.add(record.sha);
        let keys = values.get(at);
        if (keys === undefined) {
            keys = new Map();
            values.set(at, keys);
        }
        for (const trailer of record.trailers) {
            if (trailer.key === RECORD_ID_KEY || !SINGLE_VALUED.has(trailer.key))
                continue;
            let seen = keys.get(trailer.key);
            if (seen === undefined) {
                seen = new Set();
                keys.set(trailer.key, seen);
            }
            seen.add(trailer.value);
        }
    }
    const conflicts = new Set();
    for (const [at, keys] of values) {
        if ((shas.get(at)?.size ?? 0) < 2)
            continue;
        for (const [key, seen] of keys)
            if (seen.size > 1)
                conflicts.add(key);
    }
    return conflicts;
};
/** The `Record-Id`s whose `Expires:` the stream cannot order, and so cannot resolve. */
const undecidableExpiry = (ordered) => {
    const found = new Set();
    const groups = groupsByRecordId(ordered.map(({ record }) => record));
    for (const [recordId, group] of groups) {
        if (instantConflicts(group).has(EXPIRES_KEY))
            found.add(recordId);
    }
    return found;
};
const hasAmbiguousGroup = (group) => sharesACommit(group) ||
    instantConflicts(group).size > 0 ||
    (group.some((record) => record.source === 'notes') &&
        new Set(group.map(payloadSignature)).size > 1);
/** Whether a record cannot be safely merged because its identity is ambiguous. */
export const hasAmbiguousIdCollision = (records) => [...groupsByRecordId(records).values()].some(hasAmbiguousGroup);
/** A later commit may explicitly replace a duplicated identity with Supersedes. */
const hasDeclaredSuccession = (recordId, ordered) => {
    let declarations = 0;
    for (const { record } of ordered) {
        if (trailerValue(record.trailers, RECORD_ID_KEY) === recordId)
            declarations += 1;
        if (declarations >= 2 &&
            record.source !== 'notes' &&
            record.trailers.some((trailer) => trailer.key === SUPERSEDES_KEY && trailer.value === recordId)) {
            return true;
        }
    }
    return false;
};
/**
 * Whether a `Record-Id` that appears more than once in `records` has a later
 * commit declaring `Supersedes:` for it, making the duplication an intentional
 * succession rather than an error.
 *
 * Ambiguity takes unconditional precedence: a same-message duplicate or a
 * divergent notes mirror cannot be resolved by a later succession (the group
 * is inherently unresolvable), so this predicate returns `false` for them
 * exactly as `findIdCollisions` does. Placing the check here rather than in
 * the caller ensures every call site — `stale`, `validate`, and any future
 * third — shares the same rule and cannot diverge (bug-issue-187, packet
 * item 2).
 *
 * Exported so `commands/validate.ts` can apply the same predicate
 * `findIdCollisions` uses internally, against a record stream that includes
 * commits beyond what the individual source commit can see (bug-issue-187).
 */
export const isSuccessionDeclared = (recordId, records) => {
    const group = groupsByRecordId(records).get(recordId);
    if (group !== undefined && hasAmbiguousGroup(group))
        return false;
    return hasDeclaredSuccession(recordId, chronological(records));
};
/**
 * A Record-Id belongs to exactly one record unless a later commit declares
 * `Supersedes:` for it. Same-message duplicates and divergent notes are still
 * collisions: neither is a later authored succession.
 *
 * **Divergent, not merely repeated** (#430). This counted commit-sourced
 * records and never compared them, which is stricter than SPEC §3.2:
 *
 * > A `Record-Id` MUST resolve to exactly one logical record. Re-declaring that
 * > record in later commits is a lifecycle update … A note MUST NOT add or
 * > replace content under an id declared by a commit message; that is an
 * > identity collision, not an update.
 *
 * — and than §6's own example of the violation, "a note adds **different
 * content** under a `Record-Id` already declared by a commit". The concept was
 * already here, one branch up in `hasAmbiguousGroup`, applied only when a note
 * was involved: the spec's rule serving half the cases it governs.
 *
 * The visible cost was that a commit carrying a record could never be amended.
 * During an amend HEAD is still the commit being replaced, so the group holds
 * its record and the incoming one — byte-identical — and the count fired. No
 * hook can tell `commit-msg` that an amend is happening, and with this rule
 * none has to.
 *
 * Byte-identical is deliberately narrower than §3.2 allows. A "lifecycle
 * update" may legitimately carry changes, and deciding which ones stay updates
 * is a wider question; requiring identity cannot overshoot the spec while it is
 * open.
 */
export const findIdCollisions = (records) => {
    const groups = groupsByRecordId(records);
    const ordered = chronological(records);
    return [...groups]
        .filter(([recordId, group]) => {
        if (hasAmbiguousGroup(group))
            return true;
        const declared = group.filter((record) => record.source !== 'notes');
        // Identical payloads are one record re-declared (§3.2) — **unless the id
        // has been retired somewhere in this history.** Once something declares
        // `Supersedes:` for it, a further declaration is ambiguous about whether
        // the id is active, and that ambiguity is about lifecycle rather than
        // content: two byte-identical declarations straddling a supersession are
        // still two answers to "is this in force". So the count rule stands
        // wherever the id was ever superseded, and `hasDeclaredSuccession` keeps
        // deciding, as before, whether the supersession came late enough to
        // forgive the duplicate it followed.
        const retiredSomewhere = ordered.some(({ record }) => record.source !== 'notes' &&
            record.trailers.some((trailer) => trailer.key === SUPERSEDES_KEY && trailer.value === recordId));
        // And the payload has to exist. Two blocks carrying nothing but an id are
        // not one record re-declared; they are an id with no record attached, and
        // reading them as identical would be true only vacuously. Flagging them
        // keeps a real signal — that shape is a copy-paste, not a lifecycle
        // update — and costs nothing here, because an amend re-declares content.
        const signatures = new Set(declared.map(payloadSignature));
        const identical = signatures.size === 1 && !signatures.has('');
        return (declared.length > 1 &&
            (retiredSomewhere || !identical) &&
            !hasDeclaredSuccession(recordId, ordered));
    })
        .map(([recordId]) => ({
        key: RECORD_ID_KEY,
        value: recordId,
        rule: 'duplicate-id',
        got: recordId,
        want: UNIQUE_ID_WANT,
    }));
};
/**
 * Whether two or more *commit*-sourced records in the group share a `sha` —
 * the same message declaring the same `Record-Id` more than once. A note
 * always shares its commit's `sha` too (that is what mirroring means), so
 * this only counts `commit`-sourced entries: a clean note mirroring its one
 * commit must not trip it, and stays gated on payload drift exactly as
 * before.
 */
const sharesACommit = (group) => {
    const seen = new Set();
    for (const record of group) {
        if (record.source !== 'commit' || record.sha === undefined)
            continue;
        if (seen.has(record.sha))
            return true;
        seen.add(record.sha);
    }
    return false;
};
/** Whether a state belongs in a stale report: retired, expired, or flagged. */
export const isStale = (state) => state.lifecycle !== 'active' || state.flags.length > 0;
//# sourceMappingURL=stale.js.map