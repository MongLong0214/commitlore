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
import { identityCarriesInjection, scanInjection, scanTrailer } from '../core/grade.js';
import { execGit, canonicalCommittedAt } from '../core/git.js';
import { listRecordShas, notesAvailability, noteMessages, } from '../core/notes.js';
import { findDanglingRefs, findIdCollisions, foldLifecycle, isStale, } from '../core/stale.js';
import { isolateBlocks, parseRecordBlocks, parseRecordBlocksWithAtom, readTrailersAtom, } from '../core/trailers.js';
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
const RECORD_ID_KEY = 'Record-Id';
/**
 * #914: what an unresolved reference is owed instead of `dangling-ref`'s "an
 * existing Record-Id in history". The window did not carry the declaration and
 * the message search did not find one; neither of those is history denying it.
 */
const UNRESOLVED_WANT = 'undetermined — the scanned window does not carry this Record-Id and no commit message ' +
    'declares it; a declaration in the notes mirror outside the window would not be found ' +
    'here, so run with --all-history to decide';
export const newCollectCache = () => ({
    commits: new Map(),
    notes: new Map(),
    blocks: new Map(),
    last: new Map(),
});
/**
 * Every record block in the message, not just the last one (#898).
 *
 * This used `parseCommitMessage`, which is git's view: the last paragraph only.
 * A squash that preserves each source record as its own block therefore reached
 * the fold as a single record carrying the final block, and every id declared in
 * an earlier block was invisible. A `Follows:` pointing at one of them was then
 * reported as `dangling-ref` — "want an existing Record-Id in history" — about a
 * record present in the very same commit.
 *
 * `validate` already reads every block through `parseRecordBlocks`, and so does
 * the index, which is why the two disagreed on one commit: `validate -c HEAD`
 * said references ok while `stale` called the same reference dangling.
 *
 * A commit with no blocks still yields one record with no trailers, so the
 * commit count and the notes-mirror comparison below keep their shape.
 */
const parseChunk = (chunk, cache, atoms, isolated) => {
    const firstSep = chunk.indexOf(UNIT);
    if (firstSep === -1)
        return [];
    const secondSep = chunk.indexOf(UNIT, firstSep + 1);
    if (secondSep === -1)
        return [];
    const sha = chunk.slice(0, firstSep);
    const cached = cache?.get(sha);
    // Keyed on the sha alone because the rest of the chunk is a function of it:
    // `%cI` and `%B` of one commit are the same bytes on every walk.
    if (cached !== undefined)
        return cached;
    const committedAt = canonicalCommittedAt(chunk.slice(firstSep + 1, secondSep));
    const message = chunk.slice(secondSep + 1);
    const blocks = CANDIDATE_LINE_RE.test(message)
        ? parseRecordBlocksWithAtom(message, atoms?.get(sha), isolated)
        : [];
    const records = blocks.length === 0
        ? [{ sha, committedAt, trailers: [], source: 'commit' }]
        : blocks.map((trailers) => ({ sha, committedAt, trailers, source: 'commit' }));
    cache?.set(sha, records);
    return records;
};
/**
 * Reads the record stream from git, newest commit first (the fold reorders it).
 */
export const collectRecords = (opts = {}) => {
    const cwd = opts.cwd ?? process.cwd();
    // The mirror is a property of the repository, not of the revision walked, so
    // one invocation reads it once however many walks it makes.
    const mirror = opts.cache?.repository ??
        { shas: listRecordShas({ cwd }), availability: notesAvailability({ cwd }) };
    if (opts.cache !== undefined)
        opts.cache.repository = mirror;
    const notes = mirror.availability;
    const selection = [];
    if (opts.allHistory !== true)
        selection.push(`--max-count=${DEFAULT_SCAN_LIMIT}`);
    selection.push('--end-of-options', opts.revision ?? 'HEAD');
    const result = execGit(['log', '-z', `--format=${LOG_FORMAT}`, ...selection], { cwd });
    if (result.code !== 0) {
        if (EMPTY_REPO_RE.test(result.stderr)) {
            return { records: [], commits: 0, truncated: false, notes };
        }
        throw new Error(`git log failed (exit ${result.code}): ${result.stderr.trim()}`);
    }
    const chunks = result.stdout
        .split('\u0000')
        .filter((chunk) => chunk.length > 0);
    // One more process for the walk buys the last block of every commit in it
    // (`TRAILERS_ATOM`, git's parser through `git log`), so a message pays a
    // process only for the earlier blocks of SPEC §2.4, or when it carries a
    // byte the atom cannot frame. On this repository that was 1285 processes
    // per full walk, now under a hundred. Run only when at least two uncached
    // messages would read it: for one, the walk costs the process it saves, and
    // for none nothing would read the answer.
    const commitCache = opts.cache?.commits;
    const wouldUseAtom = chunks.filter((chunk) => {
        const at = chunk.indexOf(UNIT);
        if (at === -1 || commitCache?.has(chunk.slice(0, at)) === true)
            return false;
        const second = chunk.indexOf(UNIT, at + 1);
        return second !== -1 && CANDIDATE_LINE_RE.test(chunk.slice(second + 1));
    }).length;
    const atoms = wouldUseAtom >= 2 ? readTrailersAtom(selection, { cwd }) : undefined;
    // The atom removes the process for each message's OWN block; every earlier
    // paragraph was still one apiece. Attributed by stack on a 39-commit
    // `validate --range`: of 245 `git interpret-trailers` processes, 156 were
    // those probes and 111 of them arrived through here. They go in one
    // invocation, the same way `explodeRecordBlocks` and `readNotesFor` take
    // them.
    //
    // Offered only the messages this walk has not already answered from the
    // cache, so a walk that is entirely cached probes nothing.
    const uncachedMessages = chunks
        .map((chunk) => {
        const at = chunk.indexOf(UNIT);
        if (at === -1 || commitCache?.has(chunk.slice(0, at)) === true)
            return null;
        const second = chunk.indexOf(UNIT, at + 1);
        return second === -1 ? null : chunk.slice(second + 1);
    })
        .filter((message) => message !== null && CANDIDATE_LINE_RE.test(message));
    const isolated = uncachedMessages.length > 0 ? isolateBlocks(uncachedMessages) : undefined;
    const commitRecords = chunks.flatMap((chunk) => parseChunk(chunk, commitCache, atoms, isolated));
    // One commit may now contribute several records, so anything that counts
    // commits counts distinct shas. Counting records here would report a
    // multi-block repository as larger than it is, and would trip the truncation
    // flag below on a history well short of the scan limit.
    const shas = new Set(commitRecords.map((record) => record.sha));
    // The mirror comparison is against everything the commit declares, across all
    // of its blocks -- a note mirroring one block of a squash must still count as
    // mirrored.
    //
    // `folds` is the other half of that question, and the half the union cannot
    // answer: which records the commit side actually *produces*. One block yields
    // one record, identified by the first `Record-Id` in it, so a commit whose
    // blocks were flattened into one -- which is what a squash composed outside
    // this project does -- declares sixteen identities in its trailers and yields
    // a single record. Judged by the union alone, every well-formed block of the
    // note is a subset of that and is dropped as a duplicate, and fifteen records
    // that exist only in the mirror disappear (#1015).
    const trailersBySha = new Map();
    for (const record of commitRecords) {
        const firstId = record.trailers.find((trailer) => trailer.key === RECORD_ID_KEY)?.value;
        const existing = trailersBySha.get(record.sha);
        if (existing === undefined) {
            trailersBySha.set(record.sha, {
                committedAt: record.committedAt,
                trailers: [...record.trailers],
                folds: new Set(firstId === undefined ? [] : [firstId]),
            });
        }
        else {
            existing.trailers.push(...record.trailers);
            if (firstId !== undefined)
                existing.folds.add(firstId);
        }
    }
    // Every note this walk still has to read, read once, so their paragraph
    // probes can share one process the way the commit messages' do. Pairing this
    // with `readRecordBlocks` would read each note twice, so the parse below
    // works from the map rather than going back to git.
    const noteCache = opts.cache?.notes;
    const noteShas = mirror.shas.filter((sha) => trailersBySha.has(sha) && noteCache?.has(sha) !== true);
    const noteText = noteShas.length > 0 ? noteMessages(noteShas, { cwd }) : new Map();
    const isolatedNotes = noteText.size > 0 ? isolateBlocks([...noteText.values()]) : undefined;
    const noteRecords = mirror.shas.flatMap((sha) => {
        const commit = trailersBySha.get(sha);
        if (commit === undefined)
            return [];
        // Every block of the note, not git's last paragraph. A note written by
        // `squash-preserve --target` carries one block per inherited record (SPEC
        // §1, §2.4; `core/notes.ts` `writeRecordBlocks`), and the index reads all
        // of them back. Reading the note through `readRecord` -- `parseCommitMessage`,
        // the last paragraph -- left every earlier block invisible here and only
        // here: the #898 shape, on the mirror instead of the message.
        const cachedNote = noteCache?.get(sha);
        const message = noteText.get(sha);
        const blocks = cachedNote ??
            (message === undefined
                ? []
                : parseRecordBlocks(message, isolatedNotes === undefined ? {} : { isolated: isolatedNotes }));
        if (cachedNote === undefined)
            noteCache?.set(sha, blocks);
        // Each block is its own record, and each is judged a mirror on its own
        // against everything the commit declares -- so a block that mirrors one
        // block of a squash is dropped while a block the message never carried
        // stays, whichever order they appear in.
        return blocks.flatMap((trailers) => {
            const noteId = trailers.find((trailer) => trailer.key === RECORD_ID_KEY)?.value;
            // A block that declares an identity is a duplicate only when the commit
            // side yields a record for *that identity*. Being a subset of the
            // commit's trailers is not enough: a flattened block contains every
            // identity and yields one, so the subset test drops the only well-formed
            // copies there are.
            //
            // A block that declares none keeps the old test, which is the only
            // question available for it.
            const sameText = trailers.every((note) => commit.trailers.some((trailer) => trailer.key === note.key && trailer.value === note.value));
            // Both conditions, and each rules out a different failure.
            //
            // Without the identity test, a flattened commit block contains every
            // identity and the subset test drops the only well-formed copies there
            // are. Without the text test, a note that *claims* an identity the commit
            // declares is dropped even when it says something else -- which is the
            // divergent-note collision `validate` and `stale` both exist to report,
            // and dropping it silently was the regression the first version of this
            // introduced.
            const mirrored = noteId === undefined ? sameText : commit.folds.has(noteId) && sameText;
            return trailers.length === 0 || mirrored
                ? []
                : [{ sha, committedAt: commit.committedAt, trailers, source: 'notes' }];
        });
    });
    return {
        records: [...commitRecords, ...noteRecords],
        commits: shas.size,
        truncated: opts.allHistory !== true && shas.size >= DEFAULT_SCAN_LIMIT,
        notes,
    };
};
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
const oldestFirst = (records) => [
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
 * hiding it would trade one silence for another. Its *values* do not. Keys are
 * kept because a listed key without its value cannot reconstruct the pair the
 * scanner matched; identity is not a key, and `foldLifecycle` strips
 * `Record-Id` out of `resolvedTrailers` before this scan, so a payload that
 * lives only in the id has to be scanned — and redacted — on its own (#596).
 */
const withheldIfInjection = (record) => {
    const identityHits = identityCarriesInjection(record.recordId)
        ? [...new Set([...scanInjection(record.recordId), ...scanInjection(`Record-Id: ${record.recordId}`)])]
        : [];
    const matched = [
        ...new Set([
            ...record.resolvedTrailers.flatMap((trailer) => scanTrailer(trailer)),
            ...identityHits,
        ]),
    ];
    if (matched.length === 0)
        return record;
    const withheld = `[withheld: matched ${String(matched.length)} injection pattern(s): ${matched.join(', ')}]`;
    return {
        ...record,
        // A withheld record whose id is still printed is not withheld.
        recordId: identityHits.length > 0 ? withheld : record.recordId,
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
/**
 * Ids this repository declares anywhere reachable from HEAD, for a handful of
 * ids the scanned window did not cover (#914).
 *
 * `stale`'s default window is the most recent 1000 commits, and a `Follows:`
 * inside it may point at a `Record-Id` declared below it — in the reporter's
 * repository, a reference at the surface pointing at a definition at commit 1397
 * of 1554. The window is the caller's, and `findDanglingRefs` says so in as many
 * words: it answers about the stream it is handed. Presenting that answer as
 * `dangling-ref` — "want an existing Record-Id in history" — turned a fact about
 * a window into an assertion about history, which is the inference this project
 * refuses everywhere else and tells its own callers not to make.
 *
 * Targeted rather than a second full scan: only ids already suspected are looked
 * up, so a clean repository pays nothing and a suspicious one pays one `git log`
 * per id instead of re-reading every commit the window skipped.
 */
const declaredAnywhere = (cwd, ids) => {
    /*
     * Resolved by re-collecting the whole history through the same reader, rather
     * than by asking git to search commit text for the id.
     *
     * Message-pattern search is banned under `src/` and `test/source-guards.test.ts`
     * enforces the ban by scanning for the option's name: such a search matches
     * commit *text*, so a `Record-Id:` line written inside a prose paragraph would
     * answer "declared" for something that is not a trailer at all. Trailer
     * boundaries are git's to decide (SPEC §2.1 B3), and the first draft of this
     * function got that wrong — the guard caught it. Going through `collectRecords`
     * means the answer comes from the same parser, over the same two sources
     * (commit messages and the notes mirror) as the windowed scan it corrects, so
     * the two cannot disagree about what counts as a declaration.
     */
    const full = collectRecords({
        ...(cwd === undefined ? {} : { cwd }),
        allHistory: true,
    });
    const declared = new Set();
    for (const record of full.records) {
        for (const trailer of record.trailers) {
            if (trailer.key === RECORD_ID_KEY)
                declared.add(trailer.value);
        }
    }
    return new Set(ids.filter((id) => declared.has(id)));
};
export const buildReport = (scan, at, 
/**
 * Where to resolve a reference the window did not cover. Omitted by callers
 * that hold no repository — they get `unresolvedRefs` rather than an assertion
 * neither of us can support.
 */
resolveIn) => {
    const ordered = oldestFirst(scan.records);
    const states = foldLifecycle(ordered, { at });
    const stale = states.filter(isStale).map((state) => {
        const record = scan.records.find((candidate) => candidate.sha === state.sha &&
            candidate.trailers.some((trailer) => trailer.key === 'Record-Id' && trailer.value === state.recordId));
        if (record === undefined)
            throw new Error(`no source for stale record ${state.recordId}`);
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
        ...partitionRefs(findDanglingRefs(ordered), scan, resolveIn),
        idCollisions: findIdCollisions(ordered),
        unfoldedDeclarations: unfoldedDeclarations(ordered),
    };
};
/**
 * Splits the window's candidates into what history denies and what it cannot
 * answer (#914).
 *
 * A complete scan asserts freely: nothing was skipped, so absence is absence.
 * A truncated one resolves each candidate against history by id and keeps only
 * those history really has no declaration for; anything still unaccounted for
 * moves to `unresolvedRefs`, because a declaration living only in a note outside
 * the window would not be found by a message search and must not be reported as
 * proven missing.
 */
const partitionRefs = (candidates, scan, resolveIn) => {
    if (!scan.truncated || candidates.length === 0) {
        return { danglingRefs: candidates, unresolvedRefs: [] };
    }
    if (resolveIn === undefined) {
        return {
            danglingRefs: [],
            unresolvedRefs: candidates.map((violation) => ({ ...violation, want: UNRESOLVED_WANT })),
        };
    }
    const ids = [...new Set(candidates.map((violation) => violation.got))];
    const declared = declaredAnywhere(resolveIn.cwd, ids);
    // Both places a declaration can live have now been searched over the whole
    // history — commit messages by id, and the notes mirror — so an id still
    // missing is missing, and the assertion `dangling-ref` makes is supported. A
    // default run therefore stays useful to a CI job instead of deferring every
    // answer to `--all-history`.
    return {
        danglingRefs: candidates.filter((violation) => !declared.has(violation.got)),
        unresolvedRefs: [],
    };
};
/**
 * Declarations the fold will not take, because their block declares several.
 *
 * `foldLifecycle` reads one `Record-Id` per record and a record here is a
 * *block*, so a block carrying several leaves the rest with no lifecycle state.
 * That is not the fold being wrong -- `Record-Id` is single-valued, the block is
 * malformed, and `validate` reports it as `cardinality`. What was wrong is that
 * nothing said so: a repository declaring 52 ids reported 32 records and no
 * difference (#1015).
 *
 * The first declaration is the one the fold keeps, matching `trailerValue`, so
 * `unread` is every other one in the order the block declares them. If that
 * choice ever changes, this has to change with it or the report names the wrong
 * ids -- which is worse than naming none.
 */
const unfoldedDeclarations = (records) => {
    const declarationsIn = (record) => record.trailers.filter((trailer) => trailer.key === RECORD_ID_KEY).map((trailer) => trailer.value);
    /*
     * Which ids the fold actually reaches, before deciding what it missed.
     *
     * The first version asked only "is this the second or later id in its block?"
     * and was wrong by fifteen of thirty-two on the first repository it ran on. A
     * squash's records live in the commit message *and* in the notes mirror, and
     * the note carries them correctly -- one id per block. So an id buried in a
     * malformed commit block is very often the first id of a well-formed note
     * block, which means it folds and has a lifecycle after all.
     *
     * Reporting it anyway sends the reader to repair something that is already
     * right, which is worse than the silence this replaced: a wrong number in a
     * report about missing records is the one thing that cannot be tolerated here.
     */
    const folded = new Set();
    for (const record of records) {
        const ids = declarationsIn(record);
        // `foldLifecycle` takes what `trailerValue` returns, which is the first.
        if (ids.length > 0)
            folded.add(ids[0]);
    }
    const rows = [];
    for (const record of records) {
        const ids = declarationsIn(record);
        if (ids.length < 2)
            continue;
        const unread = ids.slice(1).filter((id) => !folded.has(id));
        // A block whose every buried id folds elsewhere has lost nothing. It is
        // still malformed, and `validate` still says so -- that is `validate`'s row
        // to write, not this one's.
        if (unread.length === 0)
            continue;
        rows.push({
            sha: record.sha,
            source: record.source,
            declared: ids.length,
            unread,
        });
    }
    return rows;
};
const shortSha = (sha) => (sha.length > 8 ? sha.slice(0, 8) : sha);
const location = (state) => `${state.recordId}  ${shortSha(state.sha)}  [${state.source}]`;
const section = (title, lines) => lines.length === 0 ? [] : ['', title, ...lines.map((line) => `  ${line}`)];
export const formatReport = (report) => {
    const superseded = report.records.filter((state) => state.lifecycle === 'superseded');
    const expired = report.records.filter((state) => state.lifecycle === 'expired');
    const review = report.records.filter((state) => state.lifecycle === 'active');
    const lines = [
        `stale at ${report.at} — ${superseded.length} superseded, ${expired.length} expired, ` +
            `${review.length} for review, of ${report.totalRecords} record(s) in ${report.commits} commit(s)`,
        ...section('superseded', superseded.map((state) => `${location(state)}  by ${shortSha(state.supersededBy ?? '')}`)),
        ...section('expired', expired.map((state) => `${location(state)}  ${state.expiresAt ?? ''}`)),
        ...section('review', review.map((state) => `${location(state)}  ${state.expiresAt ?? ''}`)),
        ...section('dangling refs', report.danglingRefs.map((violation) => `${violation.key}: ${violation.got}  want ${violation.want}`)),
        ...section('unresolved refs', report.unresolvedRefs.map((violation) => `${violation.key}: ${violation.got}  ${violation.want}`)),
        ...section('id collisions', report.idCollisions.map((violation) => `${violation.key}: ${violation.got}  want ${violation.want}`)),
        // Named rather than omitted, the way `unresolved refs` names a window this
        // could not cover. The fix is `validate`, which is where the violation is
        // defined, so the row says that rather than leaving the reader to guess
        // what a declaration the fold skipped is supposed to mean (#1015).
        ...section('declarations not folded', report.unfoldedDeclarations.map((row) => `${shortSha(row.sha)}${row.source === 'notes' ? ' (note)' : ''}  ` +
            `${String(row.unread.length)} of ${String(row.declared)} unread: ${row.unread.join(', ')}`)),
    ];
    if (report.unfoldedDeclarations.length > 0) {
        const unread = report.unfoldedDeclarations.reduce((sum, row) => sum + row.unread.length, 0);
        lines.push('', `note: ${String(unread)} declaration(s) have no lifecycle because their block declares ` +
            'more than one Record-Id, which is a cardinality violation — run commitlore validate ' +
            'on the commits above.');
    }
    if (report.truncated) {
        lines.push('', `note: only the most recent ${DEFAULT_SCAN_LIMIT} commits were scanned; run with --all-history for the whole record.`);
    }
    if (report.notes === 'unfetched') {
        lines.push('', 'note: the notes mirror has not been fetched, so this scan is incomplete; run commitlore doctor --fix and fetch again.');
    }
    return `${lines.join('\n')}\n`;
};
/**
 * Resolves `--at`. Defaulting to now belongs here and nowhere deeper: the fold
 * takes the instant as an argument precisely so that no test of it depends on
 * the day it runs.
 */
const evaluationInstant = (raw) => {
    if (raw === undefined)
        return new Date();
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
export const register = (program) => {
    program
        .command('stale')
        .description('list records that are superseded, expired, or flagged for review')
        .option('--json', 'emit the report as JSON')
        .option('--at <instant>', 'evaluate as of an ISO 8601 instant (default: now)')
        .option('--all-history', `scan the whole history instead of the most recent ${DEFAULT_SCAN_LIMIT} commits`)
        .addHelpText('after', '\nExit codes: 0 ran (stale reports findings in its output, it does not gate on them), ' +
        '2 a usage error -- an unparseable --at, or git could not answer (SPEC §10).')
        .action((options) => {
        try {
            const at = evaluationInstant(options.at);
            const scan = collectRecords(options.allHistory === true ? { allHistory: true } : { allHistory: false });
            // #914: resolve in this repository, so a truncated window reports what
            // history denies rather than what the window happened not to reach.
            const report = buildReport(scan, at, {});
            process.stdout.write(options.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
        }
        catch (error) {
            process.stderr.write(`commitlore: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 2;
        }
    });
};
//# sourceMappingURL=stale.js.map