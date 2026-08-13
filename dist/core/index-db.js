/**
 * The derived SQLite index (ADR-0003).
 *
 * git is the truth: the records live in commit trailers and in
 * `refs/notes/commitlore`. Everything here is a cache of what those two
 * sources already say, and it is designed to be thrown away — a corrupt file,
 * an unknown schema version, or a rewritten history are all rebuild reasons,
 * never failures. `scanTrailers` answers the same questions with no database
 * at all, and the two MUST agree; that equivalence is the reason the fallback
 * exists.
 *
 * ## Where the trailers come from
 *
 * Trailer boundaries are decided by git, never here (SPEC §2.1 B3). The batch
 * reader uses `%(trailers:only,unfold)` in a `git log` format, which is the
 * same `trailer_info` parser that backs `git interpret-trailers --parse` — the
 * B3 prose paragraph yields zero trailers through both. One `git log` per
 * batch of commits replaces one process per commit, which is the difference
 * between indexing 100k commits and not finishing.
 *
 * `trailer.separators` is pinned for the same reason `trailers.ts` pins it: it
 * is repo-configurable and rewrites what git accepts as a separator.
 *
 * ## Trailer x path cardinality
 *
 * A record belongs to a commit; a commit touches many paths. Writing one row
 * per (trailer, path) multiplies a 10-trailer record across a 200-file commit
 * into 2000 rows, and a merge commit makes that far worse. Paths are therefore
 * normalized into `commit_paths(commit_sha, path)` and joined at query time,
 * and the `trailers.path` column of the original T-203 sketch does not exist.
 * Paths are stored only for commits that actually carry a trailer: a path on a
 * record-less commit answers no question this index is asked.
 *
 * ## Ordering
 *
 * `(committed_ts DESC, commit_sha ASC, source ASC, seq ASC)` — a total order,
 * since `(commit_sha, source, seq)` is unique. Committer date is stored twice:
 * `committed_at` (`%cI`, what a human reads) and `committed_ts` (`%ct`, what
 * sorts). ISO-8601 strings carry a UTC offset and do not sort correctly across
 * timezones, so the integer is the ordering key.
 *
 * ## Text search
 *
 * The one text predicate is a case-insensitive substring over `value`, and it
 * is defined by JavaScript's `toLowerCase()` on both sides: values are stored
 * pre-folded in `value_lc`, and SQLite's own `lower()` (ASCII-only) is never
 * called. Otherwise `Ä` would fold in the scan path and not in the SQL path.
 * FTS5 (trigram) is a candidate prefilter for that same predicate and can only
 * make the query faster, never different — the authoritative `instr` test is
 * applied on top of it, and it is used only where trigram LIKE is exactly
 * substring matching (printable ASCII, >= 3 characters, no LIKE wildcards).
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { execGit, execGitOrThrow, historyAvailability } from './git.js';
import { parseRecordBlocks } from './trailers.js';
import { canonicalConventionalTrailerKey, isConventionalTrailerKey, isCommitLoreKey, } from './types.js';
/**
 * Resolved on first use, not at import.
 *
 * ADR-0003 makes the index a derived cache and ADR-0002 requires the CLI to
 * degrade to `--no-index` when the SQLite binding is unavailable. Requiring it
 * at module scope broke both: importing this file threw before any caller
 * could choose the fallback, so a missing binding took down `validate`,
 * `guard` and `parse` — none of which touch the index at all.
 *
 * That is not hypothetical. It is what a distribution without node_modules
 * does, which is exactly the shape this project now ships (ADR-0011) — and it
 * is also what a Node build without SQLite support, or a Node 22 minor older
 * than 22.13, would do to `node:sqlite` today.
 */
let cachedCtor = null;
const loadDatabaseCtor = () => {
    if (cachedCtor !== null)
        return cachedCtor;
    try {
        // `createRequire` only needs *a* valid absolute path here, not a
        // meaningful one — `node:sqlite` is a builtin, so resolution never
        // touches the filesystem relative to it. `process.execPath` over
        // `import.meta.url` on purpose: it stays a real path under every format
        // this module ships in, including a CommonJS bundle, where a CJS
        // `import.meta` is empty and would throw here instead.
        const nodeSqlite = createRequire(process.execPath)('node:sqlite');
        cachedCtor = nodeSqlite.DatabaseSync;
        return cachedCtor;
    }
    catch (cause) {
        throw new Error('the SQLite index needs node:sqlite, which this Node build does not provide — rerun with ' +
            '--no-index, or use a Node build with SQLite support to get the index back ' +
            `(${cause instanceof Error ? cause.message : String(cause)})`);
    }
};
/**
 * Bumped whenever a stored row stops meaning what it meant — a changed table
 * shape, **or** a changed rule about which rows belong here at all. A mismatch
 * is not an error: the index is derived, so the old file is deleted and rebuilt
 * (ADR-0003). Without it, a user upgrading the CLI silently reads a table that
 * no longer means what the code thinks it means.
 *
 * "Shape only" was the earlier reading, and it is what caused #406. #335 added
 * the `isCommitLoreKey` gate and changed no column, so the version stayed at 2
 * and every v0.5.0 index was accepted as current. The other rebuild trigger is
 * `lastIndexedSha !== head`, which cannot see a classifier change, so the
 * commits were never re-read: ordinary conventional-commit trailers kept being
 * served as records under the exact rule #335 was closed to enforce. `doctor`
 * compares the cache against HEAD and never against the classifier, so the one
 * check a user would run reported the stale index `ok`.
 *
 * v2 adds `trailers.block`: a message MAY now carry several record blocks
 * (SPEC §2.4, bug-issue-60), and rows from different blocks on the same
 * commit need a column of their own to stay apart — `seq` alone repeats
 * across blocks.
 *
 * v3 changes no column. It retires every index built before #335's classifier
 * gate, which is the only way those rows can be re-read.
 *
 * v4 adds `trailers.signature_status`, Git's `%G?` result for the commit read
 * in the same batched pass as its trailers. Signature verification is an
 * opt-in grading condition, so serving a v3 row without this fact could
 * incorrectly promote a record after a repository enables that mode.
 */
export const SCHEMA_VERSION = 4;
export const NOTES_REF = 'refs/notes/commitlore';
/** Commits per `git log` invocation. Bounds peak output size, not correctness. */
const LOG_BATCH = 1024;
/**
 * Batch size once a scan is running against a deadline.
 *
 * Small enough that the deadline is checked often enough to be a deadline —
 * `LOG_BATCH` exceeds the commit count of most repositories, so a budgeted scan
 * using it never reached a second iteration and never stopped.
 */
const BUDGETED_LOG_BATCH = 64;
/** `git log` output can be large; 256 MiB leaves room for a wide merge commit. */
const LOG_MAX_BUFFER = 256 * 1024 * 1024;
const GIT_NO_SUCH_REF = 1;
const RECORD_SEP = '\x01';
const FIELD_SEP = '\0';
const TRAILER_SEP = '\x1e';
const KV_SEP = '\x1f';
/** Matches a record header: an object id (SHA-1 or SHA-256) then a field separator. */
const RECORD_HEADER_RE = /^[0-9a-f]{40,64}\0/;
/** Trailers only, unfolded (B4), with separators that cannot occur in a value. */
const TRAILERS_ATOM = '%(trailers:only=true,unfold=true,key_value_separator=%x1f,separator=%x1e)';
const SEPARATOR_PIN = ['-c', 'trailer.separators=:'];
/**
 * A note body is a bare trailer block, which git reads as a subject rather
 * than as trailers: a lone paragraph is the subject, and a message with only a
 * subject has no trailer block. Every reader of the mirror therefore parses the
 * note as the last paragraph of a synthetic message.
 *
 * Only the presence of a subject line matters, never its text, so this is a
 * shared convention rather than a shared constant — nothing breaks if
 * `notes.ts` (T-301) spells its own differently. Prepending is harmless for a
 * note that already carries a subject: the block is still the last paragraph.
 */
const NOTE_SUBJECT = 'commitlore note';
/**
 * A merge commit shows no diff by default, so a record inscribed on a merge
 * would be invisible to every path-scoped query. First-parent is the diff a
 * merge actually introduced to the branch it landed on.
 */
const DIFF_MERGES = '--diff-merges=first-parent';
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS trailers (
  id           INTEGER PRIMARY KEY,
  commit_sha   TEXT    NOT NULL,
  block        INTEGER NOT NULL DEFAULT 0,
  seq          INTEGER NOT NULL,
  key          TEXT    NOT NULL,
  value        TEXT    NOT NULL,
  value_lc     TEXT    NOT NULL,
  committed_at TEXT    NOT NULL,
  committed_ts INTEGER NOT NULL,
  provenance   TEXT,
  signature_status TEXT NOT NULL,
  source       TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS trailers_identity ON trailers (commit_sha, source, block, seq);
CREATE INDEX IF NOT EXISTS trailers_key ON trailers (key);
CREATE INDEX IF NOT EXISTS trailers_order ON trailers (committed_ts DESC, commit_sha, source, block, seq);

CREATE TABLE IF NOT EXISTS commit_paths (
  commit_sha TEXT NOT NULL,
  path       TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS commit_paths_identity ON commit_paths (commit_sha, path);
CREATE INDEX IF NOT EXISTS commit_paths_path ON commit_paths (path);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
`;
const REQUIRED_TABLES = ['trailers', 'commit_paths', 'meta'];
const errorMessage = (error) => error instanceof Error ? error.message : String(error);
/**
 * Absolute path of the index file. `--git-path` is what makes this correct
 * inside a linked worktree or a submodule, where `.git` is a file pointing
 * elsewhere.
 */
export const indexDbPath = (cwd = process.cwd()) => {
    const reported = execGitOrThrow(['rev-parse', '--git-path', 'commitlore/index.db'], {
        cwd,
    }).trim();
    return resolve(cwd, reported);
};
// ---------------------------------------------------------------------------
// Reading records out of git
// ---------------------------------------------------------------------------
/**
 * Splits a `%x01`-prefixed log stream into per-record chunks.
 *
 * A `\x01` inside a trailer value would otherwise split one record in two.
 * Chunks that do not open with an object id are stitched back onto the record
 * being built, which restores the byte the split consumed.
 */
const splitRecords = (stdout) => {
    const records = [];
    for (const chunk of stdout.split(RECORD_SEP)) {
        if (RECORD_HEADER_RE.test(chunk)) {
            records.push(chunk);
            continue;
        }
        const previous = records.length - 1;
        const carried = records[previous];
        if (carried !== undefined)
            records[previous] = `${carried}${RECORD_SEP}${chunk}`;
    }
    return records;
};
/** `Key\x1fvalue\x1eKey\x1fvalue` -> trailers, in message order (B5). */
const parseTrailerField = (field) => {
    if (field === '')
        return [];
    return field.split(TRAILER_SEP).map((entry) => {
        const separator = entry.indexOf(KV_SEP);
        if (separator === -1)
            return { key: entry, value: '' };
        return { key: entry.slice(0, separator), value: entry.slice(separator + 1) };
    });
};
const recordExclusion = (counts, key) => {
    if (counts === undefined)
        return;
    const canonical = canonicalConventionalTrailerKey(key);
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
};
/**
 * Drops trailers whose meaning git or code-review tooling already fixed
 * (`types.ts` `CONVENTIONAL_TRAILER_KEYS`), applied at every point raw git
 * output turns into a candidate record. A commit whose only trailer is one of
 * these therefore never counts as carrying a record at all — the filter runs
 * before anything downstream asks "does this commit have a trailer block",
 * not after (bug-issue-150).
 */
const stripConventional = (trailers, counts) => {
    const kept = trailers.filter((trailer) => {
        if (!isConventionalTrailerKey(trailer.key))
            return true;
        recordExclusion(counts, trailer.key);
        return false;
    });
    // A block with no key from this protocol's vocabulary is not a record, and
    // indexing it manufactures a claim its lines never made. The denylist above
    // cannot decide this: it answers "which trailers belong in a record", and a
    // repository using conventional commits produced `sha256:`, `Tests:` and
    // `fix:` rows on a repository holding zero records -- served to an agent, via
    // `context`, as recorded decisions (#335).
    //
    // Applied here rather than at each call site because this runs at every point
    // raw git output becomes a candidate record, which is exactly the boundary the
    // question belongs on.
    if (!kept.some((trailer) => isCommitLoreKey(trailer.key))) {
        for (const trailer of kept)
            recordExclusion(counts, trailer.key);
        return [];
    }
    return kept;
};
/**
 * `--name-only -z` emits a newline between the format output and the path
 * list. Paths themselves are raw (that is what `-z` buys), so only that
 * separator is stripped.
 */
const parsePathFields = (fields) => {
    const paths = [];
    for (const field of fields) {
        const path = field.startsWith('\n') ? field.slice(1) : field;
        if (path !== '')
            paths.push(path);
    }
    return paths;
};
const chunked = (items, size) => {
    const batches = [];
    for (let start = 0; start < items.length; start += size) {
        batches.push(items.slice(start, start + size));
    }
    return batches;
};
const gitLogByShas = (cwd, shas, format, extra) => execGit([
    ...SEPARATOR_PIN,
    'log',
    '--no-walk=unsorted',
    '--stdin',
    '--no-notes',
    ...extra,
    `--format=${format}`,
], { cwd, stdin: `${shas.join('\n')}\n`, maxBuffer: LOG_MAX_BUFFER });
/** sha -> sorted paths, for the commits that carry a record. */
const readPaths = (cwd, shas) => {
    const byCommit = new Map();
    if (shas.length === 0)
        return byCommit;
    const result = gitLogByShas(cwd, shas, `%x01%H%x00`, ['-z', '--name-only', DIFF_MERGES]);
    if (result.code !== 0) {
        throw Object.assign(new Error(`git log --name-only failed: ${result.stderr.trim()}`), {
            code: result.code,
            stderr: result.stderr,
        });
    }
    for (const record of splitRecords(result.stdout)) {
        const fields = record.split(FIELD_SEP);
        const sha = fields[0];
        if (sha === undefined)
            continue;
        byCommit.set(sha, parsePathFields(fields.slice(1)).sort());
    }
    return byCommit;
};
/**
 * Full messages for exactly the commits named, batched the same way
 * `readPaths` batches its own second pass.
 */
const readFullMessages = (cwd, shas) => {
    const byCommit = new Map();
    if (shas.length === 0)
        return byCommit;
    for (const batch of chunked(shas, LOG_BATCH)) {
        const result = gitLogByShas(cwd, batch, `%x01%H%x00%B%x00`, []);
        if (result.code !== 0) {
            throw Object.assign(new Error(`git log --format=%B failed: ${result.stderr.trim()}`), {
                code: result.code,
                stderr: result.stderr,
            });
        }
        for (const record of splitRecords(result.stdout)) {
            const fields = record.split(FIELD_SEP);
            const [sha, message] = fields;
            if (sha === undefined || message === undefined)
                continue;
            byCommit.set(sha, message);
        }
    }
    return byCommit;
};
/**
 * Splits every already-detected record-bearing commit into its record blocks
 * (SPEC §2.4). The bulk atom pass above answers "does this commit carry a
 * trailer at all" from `%(trailers:...)`, which — like `git interpret-trailers`
 * itself — only ever sees the message's last paragraph (B1). Recovering the
 * earlier blocks needs the full message text, so this is a second, narrower
 * pass restricted to the commits the first pass already flagged as carrying
 * something: the same shape as `readPaths`, for the same reason — the pass
 * that would dominate output size on a large repository is the one kept to
 * the sliver of commits that recorded anything.
 *
 * A commit whose atom-based trailers and full-message trailers disagree in
 * count never happens: both are `git`'s own `trailer_info` over the same
 * bytes. When `parseRecordBlocks` finds only the one block the atom pass
 * already had, the original record is kept untouched rather than rebuilt, so
 * this pass changes nothing for the overwhelming majority of commits that
 * never carry more than one block.
 *
 * The last recovered block is never re-derived from `parseRecordBlocks` even
 * when there are several: it is by construction the same bytes as
 * `record.trailers`, which the caller already ran through `stripConventional`
 * (bug-issue-150). Reusing it rather than re-stripping a fresh copy is what
 * keeps a reserved trailer in that position from being counted twice against
 * `excluded`. Only the *earlier* blocks are new here, so only they are
 * stripped in this pass.
 */
const explodeRecordBlocks = (cwd, records, excluded) => {
    const messages = readFullMessages(cwd, records.map((record) => record.sha));
    return records.flatMap((record) => {
        const message = messages.get(record.sha);
        if (message === undefined)
            return [record];
        const blocks = parseRecordBlocks(message);
        if (blocks.length <= 1)
            return [record];
        const earlierBlocks = blocks
            .slice(0, -1)
            .map((block) => stripConventional(block, excluded))
            // A recovered earlier block always declares a Record-Id (the grammar's
            // own gate, `trailers.ts` `parseRecordBlocks`), and that key is never
            // reserved, so this can only ever drop nothing — kept for the same
            // reason the last block's empty case is handled by the caller: a block
            // is a record only once it survives the same filter every other
            // trailer source does.
            .filter((trailers) => trailers.length > 0);
        return [
            ...earlierBlocks.map((trailers, block) => ({ ...record, block, trailers })),
            { ...record, block: earlierBlocks.length, trailers: record.trailers },
        ];
    });
};
/**
 * Reads the given commits, in one `git log` per batch, keeping only those that
 * carry at least one trailer that is not reserved for attribution or process
 * bookkeeping (`stripConventional`, bug-issue-150). A second pass resolves
 * paths for exactly those commits — the pass that would dominate output size
 * on a large repository is the one restricted to the ~1% of commits that
 * recorded anything. A third pass (`explodeRecordBlocks`) recovers additional
 * record blocks for that same sliver of commits (SPEC §2.4).
 */
const readCommitRecords = (cwd, shas, excluded, budget, cost) => {
    const records = [];
    let read = 0;
    // A batch is the unit all three passes below share, so a deadline can only be
    // honoured between batches — and `LOG_BATCH` is larger than most repositories
    // have commits, which made a single batch the whole scan and the check below
    // unreachable. Under a budget the work is cut into slices small enough for
    // the deadline to mean something, at the cost of more `git log` invocations
    // on a run that has already decided it would rather stop early than wait.
    const batchSize = budget === undefined ? LOG_BATCH : BUDGETED_LOG_BATCH;
    for (const batch of chunked(shas, batchSize)) {
        if (budget !== undefined && (budget.now ?? Date.now)() > budget.deadline) {
            if (cost !== undefined)
                cost.unreadCommits = shas.length - read;
            return records;
        }
        read += batch.length;
        const result = gitLogByShas(cwd, batch, `%x01%H%x00%ct%x00%cI%x00%G?%x00${TRAILERS_ATOM}%x00`, []);
        if (result.code !== 0) {
            throw Object.assign(new Error(`git log failed: ${result.stderr.trim()}`), {
                code: result.code,
                stderr: result.stderr,
            });
        }
        const batchRecords = [];
        for (const record of splitRecords(result.stdout)) {
            const fields = record.split(FIELD_SEP);
            const [sha, rawTs, committedAt, signatureStatus, trailerField] = fields;
            if (sha === undefined || rawTs === undefined || committedAt === undefined)
                continue;
            // The raw count decides whether this commit is worth a full-message
            // re-read below (it might still recover an earlier block); the
            // *stripped* count decides whether this position is itself a record. A
            // commit whose only trailer is `Co-authored-by:` still needs the
            // re-read, because an earlier squashed block might carry a real one.
            const rawTrailers = parseTrailerField(trailerField ?? '');
            if (rawTrailers.length === 0)
                continue;
            batchRecords.push({
                sha,
                block: 0,
                committedAt,
                committedTs: Number.parseInt(rawTs, 10),
                signatureStatus: signatureStatus?.trim() ?? '',
                source: 'commit',
                trailers: stripConventional(rawTrailers, excluded),
                paths: [],
            });
        }
        // A block whose only trailers were reserved strips to empty here; that is
        // "recorded nothing" (SPEC §4), not a record, so it is dropped rather
        // than indexed as one (bug-issue-150).
        // Checked again before the expensive part of the batch, not only before the
        // batch. The first pass above is one `git log` over 64 commits and is
        // cheap; `explodeRecordBlocks` spawns a process per record and `readPaths`
        // diffs every commit in the batch, and together they took 2.7s on an
        // 823-commit repository -- so a deadline enforced only between batches
        // overshot a three-second budget to six. Bailing here drops this batch
        // whole rather than resolving half of it, which is what keeps the records
        // that are kept internally consistent.
        if (budget !== undefined && (budget.now ?? Date.now)() > budget.deadline) {
            if (cost !== undefined)
                cost.unreadCommits = shas.length - read + batch.length;
            return records;
        }
        const exploded = explodeRecordBlocks(cwd, batchRecords, excluded).filter((record) => record.trailers.length > 0);
        const paths = readPaths(cwd, batchRecords.map((record) => record.sha));
        for (const record of exploded)
            record.paths = paths.get(record.sha) ?? [];
        records.push(...exploded);
    }
    return records;
};
/**
 * Reads `refs/notes/commitlore` as a second record source (ADR-0003: notes are
 * truth, not cache).
 *
 * This is the T-301 wiring point. It deliberately does not import
 * `src/core/notes.ts`: that module is being written in parallel and owns
 * *writing* notes and the fetch refspec, while indexing only needs to read the
 * ref, so the two are coupled through git rather than through each other. When
 * T-301 lands a reader, the body of this function is the only thing that
 * changes — `indexNotes` and the `source = 'notes'` rows it produces stay.
 *
 * Note text goes through `parseRecordBlocks` (T-201, SPEC §2.4) under the
 * synthetic subject of `NOTE_SUBJECT`, which costs one process per note (or a
 * handful more, for each earlier block a note happens to carry). Notes are
 * sparse by construction, and correctness here is worth more than the
 * batching: a note is a message, and only git decides where its trailer block
 * starts.
 *
 * Every block also goes through `stripConventional` (bug-issue-150) before
 * the empty check below, the same as the commit-message path. CommitLore
 * itself never writes a reserved trailer into a note, but a note is still
 * text an external tool or a hand edit can put anything into, and a mirror
 * that trusted its own source more than it trusts a commit message would be
 * the one place this bug could survive its own fix.
 *
 * `reachable` is the HEAD walk the caller already made, and every note outside
 * it is dropped (bug-issue-351). A note is keyed by object name and knows
 * nothing about refs, so it outlives the commit it annotates: `reset --hard`,
 * an abandoned branch and a rebase all leave the object addressable and the
 * note readable. Serving those is not a stale extra row — the abandoned
 * record's `Supersedes:` retires the record that is still live, so one
 * unreachable note silences a reachable one. The commit source has never had
 * this problem because it only ever reads `rev-list HEAD`, and
 * `commands/stale.ts` filters its notes the same way; without this the two
 * answered differently on the same repository.
 */
const readNoteRecords = (cwd, reachable, excluded, budget, cost) => {
    const listed = execGitOrThrow(['notes', `--ref=${NOTES_REF}`, 'list'], { cwd });
    const annotated = listed
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => line.split(' ')[1] ?? '')
        .filter((sha) => sha !== '' && reachable.has(sha));
    if (annotated.length === 0)
        return [];
    /* Notes may annotate any object. `git log` refuses a blob, so one bad note
       would otherwise take the whole index down. A pruned object is the same
       shape — `git gc` deletes an unreachable commit and leaves the note behind,
       and `--batch-check` answers `missing` for it — so the reachability filter
       above and this one agree once gc has run, and only the filter above tells
       them apart before it. */
    const typed = execGitOrThrow(['cat-file', '--batch-check'], {
        cwd,
        stdin: `${annotated.join('\n')}\n`,
    });
    const commits = typed
        .split('\n')
        .filter((line) => line.endsWith(' commit') || line.includes(' commit '))
        .map((line) => line.split(' ')[0] ?? '')
        .filter((sha) => sha !== '');
    if (commits.length === 0)
        return [];
    const records = [];
    let read = 0;
    // The same ceiling the commit scan honours. Budgeting only that half left the
    // notes pass unbounded, and `scanTrailers` always runs it afterwards — so a
    // repository with many notes could stall an edit well past the budget while
    // the number reported as "unread" stayed 0.
    const batchSize = budget === undefined ? LOG_BATCH : BUDGETED_LOG_BATCH;
    for (const batch of chunked(commits, batchSize)) {
        if (budget !== undefined && (budget.now ?? Date.now)() > budget.deadline) {
            if (cost !== undefined)
                cost.unreadNotes = commits.length - read;
            return records;
        }
        read += batch.length;
        const result = gitLogByShas(cwd, batch, '%x01%H%x00%ct%x00%cI%x00%G?%x00%N%x00', [
            `--notes=${NOTES_REF}`,
        ]);
        if (result.code !== 0) {
            throw Object.assign(new Error(`git log --notes failed: ${result.stderr.trim()}`), {
                code: result.code,
                stderr: result.stderr,
            });
        }
        const batchRecords = [];
        for (const record of splitRecords(result.stdout)) {
            const fields = record.split(FIELD_SEP);
            const [sha, rawTs, committedAt, signatureStatus, noteText] = fields;
            if (sha === undefined || rawTs === undefined || committedAt === undefined)
                continue;
            if (noteText === undefined || noteText.trim() === '')
                continue;
            // A note may itself carry several record blocks (SPEC §2.4): squash
            // inheritance writes one per source record (`core/squash.ts`).
            const blocks = parseRecordBlocks(`${NOTE_SUBJECT}\n\n${noteText}`);
            blocks.forEach((rawTrailers, block) => {
                const trailers = stripConventional(rawTrailers, excluded);
                if (trailers.length === 0)
                    return;
                batchRecords.push({
                    sha,
                    block,
                    committedAt,
                    committedTs: Number.parseInt(rawTs, 10),
                    signatureStatus: signatureStatus?.trim() ?? '',
                    source: 'notes',
                    trailers,
                    paths: [],
                });
            });
        }
        const paths = readPaths(cwd, batchRecords.map((record) => record.sha));
        for (const record of batchRecords)
            record.paths = paths.get(record.sha) ?? [];
        records.push(...batchRecords);
    }
    return records;
};
const revParse = (cwd, rev) => {
    const result = execGit(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd });
    if (result.code === GIT_NO_SUCH_REF && result.stderr.trim() === '')
        return null;
    if (result.code !== 0) {
        throw Object.assign(new Error(`git could not resolve ${rev}: ${result.stderr.trim()}`), {
            code: result.code,
            stderr: result.stderr,
        });
    }
    const sha = result.stdout.trim();
    return sha === '' ? null : sha;
};
/** Unlike `revParse`, does not peel to a commit — a notes ref points at a tree. */
const revParseRef = (cwd, ref) => {
    const result = execGit(['rev-parse', '--verify', '--quiet', ref], { cwd });
    if (result.code === GIT_NO_SUCH_REF && result.stderr.trim() === '')
        return null;
    if (result.code !== 0) {
        throw Object.assign(new Error(`git could not resolve ${ref}: ${result.stderr.trim()}`), {
            code: result.code,
            stderr: result.stderr,
        });
    }
    const sha = result.stdout.trim();
    return sha === '' ? null : sha;
};
const revList = (cwd, range) => execGitOrThrow(['rev-list', range], { cwd, maxBuffer: LOG_MAX_BUFFER })
    .split('\n')
    .filter((line) => line !== '');
/**
 * Every commit HEAD reaches — the one definition of "in this history" both
 * record sources are filtered against (bug-issue-351). An unborn HEAD reaches
 * nothing, which `revList` would raise on rather than answer.
 *
 * Callers that already hold the walk pass it directly instead of calling this;
 * it exists for `indexNotes`, which re-reads the mirror without one.
 */
const reachableFromHead = (cwd) => revParse(cwd, 'HEAD') === null ? [] : revList(cwd, 'HEAD');
// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------
const tableExists = (db, name) => db
    .prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type IN ('table','view') AND name = ?`)
    .get(name)?.n === 1;
/**
 * FTS5 is a compile-time option and the trigram tokenizer is version-gated, so
 * availability is established by trying, not by asking. A build without either
 * gets the LIKE path and identical answers.
 */
const detectFts = (db) => {
    try {
        db.prepare(`SELECT rowid FROM trailers_fts WHERE value_lc LIKE '%commitlore%' LIMIT 1`).all();
        return true;
    }
    catch {
        return false;
    }
};
const enableFts = (db) => {
    try {
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS trailers_fts USING fts5(value_lc, tokenize='trigram')`);
    }
    catch {
        return false;
    }
    return detectFts(db);
};
const readMeta = (db, key) => db.prepare('SELECT v FROM meta WHERE k = ?').get(key)?.v ??
    null;
const writeMeta = (db, key, value) => {
    db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(key, value);
};
/** How many commits a budgeted rebuild left unread. 0 means the index is whole. */
const UNREAD_COMMITS_META = 'unread_commits';
const persistUnread = (db, unread) => {
    writeMeta(db, UNREAD_COMMITS_META, unread > 0 ? String(unread) : null);
};
/**
 * Commits a previous budgeted rebuild left unread, persisted so a later query
 * can say so without walking history again. 0 when the index is whole.
 */
export const indexUnread = (handle) => {
    const raw = readMeta(handle.db, UNREAD_COMMITS_META);
    if (raw === null || raw === '')
        return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
/**
 * Opening a database must never overwrite what it says about itself. Stamping
 * the current version here unconditionally would erase the very mismatch the
 * health check exists to find, and the caller would then read another
 * release's tables as if they were ours.
 */
const initMeta = (db, key, value) => {
    db.prepare('INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)').run(key, value);
};
const createSchema = (db) => {
    db.exec(SCHEMA_SQL);
    initMeta(db, 'schema_version', String(SCHEMA_VERSION));
};
/**
 * `node:sqlite` has no `db.transaction()` (ADR-0012's API-surface table): the
 * closest primitive is `BEGIN`/`COMMIT`/`ROLLBACK`, and those do not nest —
 * SQLite refuses a second `BEGIN` inside an open transaction. `better-sqlite3`
 * gave `.transaction()` savepoint semantics for nesting, and the ADR's
 * call-graph check found real nesting: `rebuildIndex` opens a transaction and
 * calls `insertRecords`, which opens its own; `indexNotes` opens a transaction
 * and calls both `deleteNoteRows` and `insertRecords`, each of which opens its
 * own. Flattening that silently would turn a partial failure into a partial
 * write — the exact failure mode ADR-0003 built the index to avoid.
 *
 * This reproduces the savepoint behaviour: depth 0 opens a real transaction,
 * depth 1+ opens a named `SAVEPOINT` and releases or rolls back to it on exit,
 * leaving the outer transaction open either way. Depth is tracked per
 * database in JS rather than read back from SQLite (`db.isTransaction` would
 * also work, but only since Node 22.16 — the 22.23.2 floor already guarantees
 * it, although this implementation does not need that newer primitive).
 */
const transactionDepth = new WeakMap();
const runInTransaction = (db, fn) => {
    const depth = transactionDepth.get(db) ?? 0;
    const savepoint = `commitlore_sp_${depth}`;
    db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
    transactionDepth.set(db, depth + 1);
    try {
        const result = fn();
        db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
        return result;
    }
    catch (error) {
        db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`);
        if (depth !== 0)
            db.exec(`RELEASE ${savepoint}`);
        throw error;
    }
    finally {
        transactionDepth.set(db, depth);
    }
};
/**
 * Decides whether the FTS5 prefilter may be used, and keeps it truthful.
 *
 * `meta.fts` records whether the rows currently in `trailers` were mirrored
 * into `trailers_fts`. It is not the same question as "does this build have
 * FTS5": an index written by a build without FTS5 and then opened by one with
 * it has an empty virtual table, and prefiltering against it would silently
 * drop every match. Where the two disagree and the handle can write, the
 * mirror is rebuilt; where it cannot, the prefilter stays off and the plain
 * substring predicate answers alone.
 */
const syncFts = (db, requested, writable) => {
    if (!writable)
        return requested && detectFts(db) && readMeta(db, 'fts') === '1';
    if (!requested || !enableFts(db)) {
        writeMeta(db, 'fts', '0');
        return false;
    }
    if (readMeta(db, 'fts') !== '1') {
        runInTransaction(db, () => {
            db.exec('DELETE FROM trailers_fts');
            db.exec('INSERT INTO trailers_fts (rowid, value_lc) SELECT id, value_lc FROM trailers');
            writeMeta(db, 'fts', '1');
        });
    }
    return true;
};
/**
 * Why this index cannot be trusted, or `null`. Every answer is a rebuild
 * reason — the index is derived, so there is no such thing as an unrecoverable
 * one (ADR-0003).
 */
const healthProblem = (db) => {
    try {
        if (!tableExists(db, 'meta'))
            return 'index has no meta table';
        const version = readMeta(db, 'schema_version');
        if (version === null)
            return 'index has no schema version';
        if (version !== String(SCHEMA_VERSION)) {
            return `index was built by schema v${version}, this build expects v${SCHEMA_VERSION}`;
        }
        for (const table of REQUIRED_TABLES) {
            if (!tableExists(db, table))
                return `index is missing the ${table} table`;
        }
        // `node:sqlite` has no `.pragma()` shorthand (ADR-0012); a pragma is a
        // normal query here rather than the `{ simple: true }` scalar
        // better-sqlite3 gave.
        const check = db.prepare('PRAGMA quick_check(1)').get();
        if (check?.quick_check !== 'ok') {
            return `sqlite quick_check reported: ${String(check?.quick_check)}`;
        }
        return null;
    }
    catch (error) {
        return `index is unreadable: ${errorMessage(error)}`;
    }
};
/**
 * How long a contended connection waits before giving up (#420).
 *
 * SQLite's default is 0: a busy database fails immediately, and `openSource`
 * then answers from a full scan. Correct, but expensive — at 100,000 commits an
 * indexed `context` is 496 ms p50 against 86,673 ms for the scan
 * (`docs/evidence.md`) — and routine, because the PreToolUse hook fires per
 * edit and an agent touching several files runs several of them at once. Eight
 * concurrent cold starts put four of them on the scan path.
 *
 * The bound separates two cases rather than being generous. An **incremental**
 * update takes milliseconds, so this absorbs it. A **full rebuild** on a large
 * repository takes seconds, and waiting one out inside a hook the agent is
 * blocked on is worse than scanning — so this expires first on purpose and lets
 * the existing fallback answer.
 */
const BUSY_TIMEOUT_MS = 500;
const openDatabaseFile = (path, readonly) => {
    const Ctor = loadDatabaseCtor();
    const db = new Ctor(path, { readOnly: readonly });
    // `node:sqlite` has no `.pragma()` helper (ADR-0012); a pragma is just SQL.
    //
    // Set on readers too: WAL lets readers and one writer run together, but a
    // reader still meets `SQLITE_BUSY` while the writer checkpoints.
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    if (!readonly) {
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA synchronous = NORMAL');
    }
    return db;
};
const removeDatabaseFile = (path) => {
    for (const suffix of ['', '-wal', '-shm'])
        rmSync(`${path}${suffix}`, { force: true });
};
/**
 * Opens the index, creating it if absent. A file that SQLite refuses to open
 * at all is deleted and recreated rather than reported: the bytes are a cache.
 */
export const openIndex = (opts = {}) => {
    const cwd = opts.cwd ?? process.cwd();
    const readonly = opts.readonly ?? false;
    const ftsRequested = opts.fts ?? true;
    const path = indexDbPath(cwd);
    if (!readonly)
        mkdirSync(dirname(path), { recursive: true });
    let db;
    let discardedReason = null;
    try {
        db = openDatabaseFile(path, readonly);
    }
    catch (error) {
        if (readonly) {
            throw Object.assign(new Error(`cannot open the index at ${path}: ${errorMessage(error)}`), { path });
        }
        discardedReason = `the index file could not be opened (${errorMessage(error)})`;
        removeDatabaseFile(path);
        db = openDatabaseFile(path, readonly);
    }
    if (!readonly)
        createSchema(db);
    const handle = {
        db,
        path,
        cwd,
        readonly,
        ftsRequested,
        discardedReason,
        fts: syncFts(db, ftsRequested, !readonly),
    };
    return handle;
};
export const closeIndex = (handle) => {
    handle.db.close();
};
/**
 * Deletes the file and starts over. Used when the schema version moved or the
 * file is unreadable — dropping tables is not enough, because a file written
 * by a future version may hold objects this build has never heard of.
 */
const resetIndexFile = (handle) => {
    handle.db.close();
    removeDatabaseFile(handle.path);
    handle.db = openDatabaseFile(handle.path, false);
    createSchema(handle.db);
    handle.discardedReason = null;
    handle.fts = syncFts(handle.db, handle.ftsRequested, true);
};
/**
 * Inserts records in one transaction.
 *
 * The unique index on `(commit_sha, source, seq)` is an assertion, not a merge
 * strategy: an incremental range never contains an already-indexed commit, so
 * a conflict means the baseline was wrong. The caller turns that throw into a
 * rebuild.
 */
const insertRecords = (handle, records) => {
    const insertTrailer = handle.db.prepare(`INSERT INTO trailers
       (commit_sha, block, seq, key, value, value_lc, committed_at, committed_ts, provenance, signature_status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertFts = handle.fts
        ? handle.db.prepare('INSERT INTO trailers_fts (rowid, value_lc) VALUES (?, ?)')
        : null;
    const insertPath = handle.db.prepare('INSERT OR IGNORE INTO commit_paths (commit_sha, path) VALUES (?, ?)');
    const counts = { trailers: 0, paths: 0 };
    runInTransaction(handle.db, () => {
        for (const record of records) {
            const provenance = record.trailers.find((trailer) => trailer.key === 'Provenance')?.value ?? null;
            record.trailers.forEach((trailer, seq) => {
                const valueLc = trailer.value.toLowerCase();
                const inserted = insertTrailer.run(record.sha, record.block, seq, trailer.key, trailer.value, valueLc, record.committedAt, record.committedTs, provenance, record.signatureStatus, record.source);
                insertFts?.run(inserted.lastInsertRowid, valueLc);
                counts.trailers += 1;
            });
            for (const path of record.paths) {
                counts.paths += Number(insertPath.run(record.sha, path).changes);
            }
        }
    });
    return counts;
};
const deleteNoteRows = (handle) => {
    runInTransaction(handle.db, () => {
        if (handle.fts) {
            handle.db.exec(`DELETE FROM trailers_fts WHERE rowid IN (SELECT id FROM trailers WHERE source = 'notes')`);
        }
        handle.db.exec(`DELETE FROM trailers WHERE source = 'notes'`);
    });
};
/**
 * Brings the `source = 'notes'` rows in line with `refs/notes/commitlore`.
 *
 * Notes are re-read whole whenever the ref moves. A note can be rewritten in
 * place, so there is no "new notes only" range the way there is for commits,
 * and notes are sparse enough that whole is cheap.
 */
export const indexNotes = (handle, opts = {}, excluded) => {
    const refSha = revParseRef(handle.cwd, NOTES_REF);
    const indexed = readMeta(handle.db, 'notes_ref_sha');
    if (!(opts.force ?? false) && refSha === indexed)
        return 0;
    const records = refSha === null
        ? []
        : readNoteRecords(handle.cwd, new Set(reachableFromHead(handle.cwd)), excluded);
    return runInTransaction(handle.db, () => {
        deleteNoteRows(handle);
        const counts = insertRecords(handle, records);
        writeMeta(handle.db, 'notes_ref_sha', refSha);
        return counts.trailers;
    });
};
const emptyStats = (handle, started) => ({
    rebuilt: false,
    rebuildReason: null,
    commitsScanned: 0,
    trailersIndexed: 0,
    pathsIndexed: 0,
    notesScanned: 0,
    noteTrailersIndexed: 0,
    headSha: null,
    fts: handle.fts,
    elapsedMs: Date.now() - started,
    trailersExcluded: 0,
    excludedKeys: [],
});
/** Folds an `ExclusionCounts` accumulator into the two report fields it backs. */
const applyExclusions = (stats, excluded) => {
    stats.trailersExcluded = [...excluded.values()].reduce((sum, count) => sum + count, 0);
    stats.excludedKeys = [...excluded.keys()].sort();
};
const requireWritable = (handle) => {
    if (handle.readonly)
        throw new Error('the index was opened read-only');
};
/**
 * Rebuilds from scratch: every commit reachable from HEAD, plus every note.
 * This is always safe and always sufficient — it is what makes the index
 * disposable (ADR-0003).
 */
export const rebuildIndex = (handle, opts = {}) => {
    requireWritable(handle);
    const started = Date.now();
    const head = revParse(handle.cwd, 'HEAD');
    const shas = head === null ? [] : revList(handle.cwd, 'HEAD');
    const excluded = new Map();
    // A caller that did not pass `cost` still needs the unread count written to
    // meta, so a later query can label the partial index. The object they did
    // pass is mutated in place; this local one is only for the persist.
    const cost = opts.cost ?? { unreadCommits: 0, unreadNotes: 0 };
    const records = readCommitRecords(handle.cwd, shas, excluded, opts.budget, cost);
    const notesRef = revParseRef(handle.cwd, NOTES_REF);
    const noteRecords = notesRef === null ? [] : readNoteRecords(handle.cwd, new Set(shas), excluded, opts.budget, cost);
    const unread = cost.unreadCommits + cost.unreadNotes;
    const stats = {
        ...emptyStats(handle, started),
        rebuilt: true,
        rebuildReason: opts.reason ?? null,
        headSha: head,
        commitsScanned: shas.length - cost.unreadCommits,
        notesScanned: noteRecords.length,
    };
    runInTransaction(handle.db, () => {
        if (handle.fts)
            handle.db.exec('DELETE FROM trailers_fts');
        handle.db.exec('DELETE FROM trailers');
        handle.db.exec('DELETE FROM commit_paths');
        handle.db.exec(`DELETE FROM meta WHERE k <> 'schema_version'`);
        const counts = insertRecords(handle, records);
        stats.trailersIndexed = counts.trailers;
        stats.pathsIndexed = counts.paths;
        const noteCounts = insertRecords(handle, noteRecords);
        stats.noteTrailersIndexed = noteCounts.trailers;
        stats.pathsIndexed += noteCounts.paths;
        // HEAD even when unread > 0: new commits after this point are a
        // `last..HEAD` incremental, which is the cheap half. The unread older
        // commits stay unread until `index`/`init` rebuilds without a budget, and
        // `unread_commits` is what stops that from reading as a complete index.
        writeMeta(handle.db, 'last_indexed_sha', head);
        writeMeta(handle.db, 'notes_ref_sha', notesRef);
        persistUnread(handle.db, unread);
    });
    applyExclusions(stats, excluded);
    stats.elapsedMs = Date.now() - started;
    return stats;
};
/**
 * Why an incremental update cannot be trusted, or `null`. Each answer names a
 * condition under which `last..HEAD` would not describe the difference between
 * the index and the repository.
 */
const incrementalProblem = (handle, head, last) => {
    if (last === null)
        return 'the index has no baseline commit';
    if (last === head)
        return null;
    if (revParse(handle.cwd, last) === null) {
        return `the last indexed commit ${last.slice(0, 12)} is gone (history was rewritten)`;
    }
    const ancestor = execGit(['merge-base', '--is-ancestor', last, head], { cwd: handle.cwd });
    if (ancestor.code !== 0) {
        return `HEAD no longer descends from the last indexed commit ${last.slice(0, 12)}`;
    }
    return null;
};
/**
 * Incremental update: only `last_indexed_sha..HEAD` is read. Falls back to a
 * full rebuild whenever that range would not describe reality — a corrupt
 * file, a schema version this build does not know, a rewritten history. The
 * reason is reported in `IndexStats.rebuildReason` so the caller can say so.
 */
export const updateIndex = (handle, opts = {}) => {
    requireWritable(handle);
    const started = Date.now();
    // A consumer may rebuild when it has a budget: the wait is then bounded and
    // the unread count is persisted, which is the #522 contract. Without a
    // budget the full rebuild is still `index`/`init` work, and `openCurrentIndex`
    // refuses it.
    const allowRebuild = opts.allowRebuild ?? true;
    const rebuildOpts = {
        ...(opts.budget === undefined ? {} : { budget: opts.budget }),
        ...(opts.cost === undefined ? {} : { cost: opts.cost }),
    };
    const rebuildOrRefuse = (reason) => {
        if (!allowRebuild)
            throw new Error(reason);
        return rebuildIndex(handle, { reason, ...rebuildOpts });
    };
    const discarded = handle.discardedReason;
    if (discarded !== null) {
        handle.discardedReason = null;
        return rebuildOrRefuse(discarded);
    }
    const problem = healthProblem(handle.db);
    if (problem !== null) {
        if (!allowRebuild)
            throw new Error(problem);
        resetIndexFile(handle);
        return rebuildIndex(handle, { reason: problem, ...rebuildOpts });
    }
    if (opts.force ?? false)
        return rebuildIndex(handle, { reason: 'rebuild requested', ...rebuildOpts });
    const excluded = new Map();
    const head = revParse(handle.cwd, 'HEAD');
    if (head === null) {
        /* An empty repository is not an error; it is a repository with no records. */
        const stats = emptyStats(handle, started);
        writeMeta(handle.db, 'last_indexed_sha', null);
        stats.noteTrailersIndexed = indexNotes(handle, {}, excluded);
        applyExclusions(stats, excluded);
        stats.elapsedMs = Date.now() - started;
        return stats;
    }
    const last = readMeta(handle.db, 'last_indexed_sha');
    const blocker = incrementalProblem(handle, head, last);
    if (blocker !== null)
        return rebuildOrRefuse(blocker);
    // A budgeted consumer rebuild stamps last_indexed_sha = HEAD so new commits
    // stay incremental, and persists unread_commits so the answer stays labelled.
    // `index`/`init` pass no budget: they are the command the label names, so a
    // leftover unread count here is a rebuild they still owe, not a no-op.
    if (opts.budget === undefined && indexUnread(handle) > 0) {
        return rebuildIndex(handle, { reason: 'finish a budgeted partial index', ...rebuildOpts });
    }
    const stats = { ...emptyStats(handle, started), headSha: head };
    if (last !== null && last !== head) {
        const shas = revList(handle.cwd, `${last}..HEAD`);
        stats.commitsScanned = shas.length;
        const records = readCommitRecords(handle.cwd, shas, excluded);
        try {
            const counts = insertRecords(handle, records);
            stats.trailersIndexed = counts.trailers;
            stats.pathsIndexed = counts.paths;
        }
        catch (error) {
            return rebuildOrRefuse(`incremental insert conflicted with existing rows (${errorMessage(error)})`);
        }
        writeMeta(handle.db, 'last_indexed_sha', head);
    }
    stats.noteTrailersIndexed = indexNotes(handle, {}, excluded);
    applyExclusions(stats, excluded);
    stats.elapsedMs = Date.now() - started;
    return stats;
};
/** Opens the index and brings it up to date. The one call a query command needs. */
export const ensureIndex = (opts = {}) => {
    const handle = openIndex(opts);
    try {
        return {
            handle,
            stats: updateIndex(handle, {
                ...(opts.budget === undefined ? {} : { budget: opts.budget }),
                ...(opts.cost === undefined ? {} : { cost: opts.cost }),
            }),
        };
    }
    catch (error) {
        closeIndex(handle);
        throw error;
    }
};
/**
 * Opens an index for a consumer query, catching it up but never rebuilding it.
 *
 * The distinction is the whole point of #522. An incremental update reads
 * `last_indexed_sha..HEAD`, so its cost is the commits made since the last
 * query — on a repository being worked in, a handful. A full rebuild reads the
 * entire history: 186 seconds on a 21,000-commit repository, which a
 * before-change hook cannot wait for and which a caller's timeout will kill,
 * leaving the next edit to start cold again.
 *
 * So this refuses exactly the unbounded case and keeps the bounded one. Not
 * catching up at all would be the same defect wearing different clothes: an
 * index one commit behind would be unusable, and every query after every commit
 * would fall back to reading the whole history — worse, in steady state, than
 * what this set out to fix. The incremental range is always a subset of that
 * history, so taking it is never the slower choice.
 *
 * Refusing is an error rather than a stale read. The caller falls back to git,
 * which remains the authority, and no answer ever comes from a cache that
 * missed a commit or a notes update.
 */
export const openCurrentIndex = (opts = {}) => {
    // Opening creates the file, and a query that leaves an empty index behind has
    // changed the repository to answer a read. Refuse before that happens: with
    // no baseline there is nothing to catch up from, and only `index` or `init`
    // may build one.
    const cwd = opts.cwd ?? process.cwd();
    if (!existsSync(indexDbPath(cwd)))
        throw new Error('the index has no baseline commit');
    const handle = openIndex(opts);
    try {
        if (handle.discardedReason !== null)
            throw new Error(handle.discardedReason);
        const problem = healthProblem(handle.db);
        if (problem !== null)
            throw new Error(problem);
        const head = revParse(handle.cwd, 'HEAD');
        if (head !== null) {
            const blocker = incrementalProblem(handle, head, readMeta(handle.db, 'last_indexed_sha'));
            if (blocker !== null)
                throw new Error(blocker);
        }
        // Bounded: the ranges read here are `last..HEAD` and the notes tree, both
        // of which a full rebuild would read as part of a much larger whole.
        updateIndex(handle, { allowRebuild: false });
        const indexedHead = readMeta(handle.db, 'last_indexed_sha');
        if (indexedHead !== head) {
            throw new Error(`index is at ${indexedHead?.slice(0, 12) ?? '(no baseline)'} but HEAD is ` +
                `${head?.slice(0, 12) ?? '(unborn)'}`);
        }
        const notesRef = revParseRef(handle.cwd, NOTES_REF);
        if (readMeta(handle.db, 'notes_ref_sha') !== notesRef) {
            throw new Error('index does not match refs/notes/commitlore');
        }
        return handle;
    }
    catch (error) {
        closeIndex(handle);
        throw error;
    }
};
// ---------------------------------------------------------------------------
// Querying — the index path and the no-index path, which must agree
// ---------------------------------------------------------------------------
/** Trailing slashes would make `src/` and `src` different prefixes. */
const normalizePath = (path) => path.replace(/\/+$/, '');
const compareTrailers = (a, b) => {
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
 * FTS5 trigram is exactly substring matching only for a printable-ASCII term
 * of at least three characters, and `%`/`_`/`\` would turn the LIKE pattern
 * into a wildcard. Outside that envelope the plain `instr` predicate runs
 * alone — slower, never different.
 */
const ftsEligible = (term) => term.length >= 3 && /^[ -~]+$/.test(term) && !/[%_\\]/.test(term);
const attachPaths = (handle, rows) => {
    const shas = [...new Set(rows.map((row) => row.commit_sha))];
    const byCommit = new Map();
    if (shas.length === 0)
        return byCommit;
    for (const batch of chunked(shas, 500)) {
        const placeholders = batch.map(() => '?').join(', ');
        const found = handle.db
            .prepare(`SELECT commit_sha, path FROM commit_paths WHERE commit_sha IN (${placeholders})`)
            .all(...batch);
        for (const row of found) {
            const existing = byCommit.get(row.commit_sha);
            if (existing === undefined)
                byCommit.set(row.commit_sha, [row.path]);
            else
                existing.push(row.path);
        }
    }
    for (const paths of byCommit.values())
        paths.sort();
    return byCommit;
};
/**
 * Reads the index. Answers exactly what `scanTrailers` answers for the same
 * query — the SQL below is the fast spelling of the predicate in
 * `matchesQuery`, and `test/index-db.test.ts` holds the two to it.
 */
export const queryTrailers = (handle, query = {}) => {
    const conditions = [];
    const params = [];
    const keys = query.keys;
    if (keys !== undefined && keys.length > 0) {
        conditions.push(`t.key IN (${keys.map(() => '?').join(', ')})`);
        params.push(...keys);
    }
    if (query.source !== undefined) {
        conditions.push('t.source = ?');
        params.push(query.source);
    }
    if (query.sha !== undefined && query.sha !== '') {
        conditions.push('substr(t.commit_sha, 1, ?) = ?');
        params.push(query.sha.length, query.sha);
    }
    if (query.text !== undefined && query.text !== '') {
        const term = query.text.toLowerCase();
        if (handle.fts && ftsEligible(term)) {
            conditions.push('t.id IN (SELECT rowid FROM trailers_fts WHERE value_lc LIKE ?)');
            params.push(`%${term}%`);
        }
        conditions.push('instr(t.value_lc, ?) > 0');
        params.push(term);
    }
    if (query.path !== undefined && query.path !== '') {
        const path = normalizePath(query.path);
        conditions.push(`EXISTS (SELECT 1 FROM commit_paths p
                WHERE p.commit_sha = t.commit_sha
                  AND (p.path = ? OR substr(p.path, 1, ?) = ?))`);
        params.push(path, path.length + 1, `${path}/`);
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
    const limit = query.limit === undefined ? '' : 'LIMIT ?';
    if (query.limit !== undefined)
        params.push(query.limit);
    const rows = handle.db
        .prepare(`SELECT t.id, t.commit_sha, t.block, t.seq, t.key, t.value, t.committed_at, t.committed_ts,
              t.provenance, t.signature_status, t.source
         FROM trailers t
         ${where}
        ORDER BY t.committed_ts DESC, t.commit_sha ASC, t.source ASC, t.block ASC, t.seq ASC
        ${limit}`)
        .all(...params);
    const paths = attachPaths(handle, rows);
    return rows.map((row) => ({
        sha: row.commit_sha,
        block: row.block,
        seq: row.seq,
        key: row.key,
        value: row.value,
        committedAt: row.committed_at,
        committedTs: row.committed_ts,
        provenance: row.provenance,
        signatureStatus: row.signature_status,
        source: row.source === 'notes' ? 'notes' : 'commit',
        paths: paths.get(row.commit_sha) ?? [],
    }));
};
/** The predicate `queryTrailers` spells in SQL. Kept in one place on purpose. */
const matchesQuery = (trailer, query) => {
    const keys = query.keys;
    if (keys !== undefined && keys.length > 0 && !keys.includes(trailer.key))
        return false;
    if (query.source !== undefined && trailer.source !== query.source)
        return false;
    if (query.sha !== undefined && query.sha !== '') {
        if (trailer.sha.slice(0, query.sha.length) !== query.sha)
            return false;
    }
    if (query.text !== undefined && query.text !== '') {
        if (!trailer.value.toLowerCase().includes(query.text.toLowerCase()))
            return false;
    }
    if (query.path !== undefined && query.path !== '') {
        const path = normalizePath(query.path);
        const touched = trailer.paths.some((candidate) => candidate === path || candidate.startsWith(`${path}/`));
        if (!touched)
            return false;
    }
    return true;
};
/** Applies the scan path's predicate to already-materialized trailer rows. */
export const filterTrailers = (trailers, query = {}) => {
    const matched = trailers.filter((trailer) => matchesQuery(trailer, query)).sort(compareTrailers);
    return query.limit === undefined ? matched : matched.slice(0, query.limit);
};
const toIndexedTrailers = (records) => records.flatMap((record) => {
    const provenance = record.trailers.find((t) => t.key === 'Provenance')?.value ?? null;
    return record.trailers.map((trailer, seq) => ({
        sha: record.sha,
        block: record.block,
        seq,
        key: trailer.key,
        value: trailer.value,
        committedAt: record.committedAt,
        committedTs: record.committedTs,
        provenance,
        signatureStatus: record.signatureStatus,
        source: record.source,
        paths: record.paths,
    }));
});
/**
 * Answers a query with no database at all, by walking `git rev-list` and
 * reading the same batched `git log` the indexer reads. Slower on a large
 * repository, identical in what it returns — which is the whole point of a
 * derived index (ADR-0003, PRD-F2 AC 4).
 */
export const scanTrailers = (query = {}, opts = {}) => {
    const cwd = opts.cwd ?? process.cwd();
    if (historyAvailability(cwd) === 'unavailable')
        return [];
    const head = revParse(cwd, 'HEAD');
    const shas = head === null ? [] : (revList(cwd, 'HEAD') ?? []);
    const records = [
        ...readCommitRecords(cwd, shas, undefined, opts.budget, opts.cost),
        ...readNoteRecords(cwd, new Set(shas), undefined, opts.budget, opts.cost),
    ];
    return filterTrailers(toIndexedTrailers(records), query);
};
/** Every row, ordered, for the identity assertions the tests make. */
export const dumpIndex = (handle) => queryTrailers(handle);
/** What the index believes about itself. Consumed by `commitlore index --stats`. */
export const indexInfo = (handle) => ({
    path: handle.path,
    fts: handle.fts,
    schemaVersion: readMeta(handle.db, 'schema_version'),
    lastIndexedSha: readMeta(handle.db, 'last_indexed_sha'),
    notesRefSha: readMeta(handle.db, 'notes_ref_sha'),
    trailers: handle.db.prepare('SELECT count(*) AS n FROM trailers').get()
        ?.n ?? 0,
    commits: handle.db
        .prepare('SELECT count(DISTINCT commit_sha) AS n FROM trailers')
        .get()?.n ?? 0,
    paths: handle.db.prepare('SELECT count(*) AS n FROM commit_paths').get()
        ?.n ?? 0,
});
//# sourceMappingURL=index-db.js.map