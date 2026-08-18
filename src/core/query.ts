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

import {
  execGit,
  hasShallowHistory,
  historyAvailability,
  SHALLOW_HISTORY_CAVEAT,
  type HistoryAvailability,
} from './git.js';
import {
  closeIndex,
  ensureIndex,
  filterTrailers,
  indexUnread,
  queryTrailers,
  scanTrailers,
  type ScanCost,
  type IndexedTrailer,
  type RecordSource,
  type TrailerQuery,
} from './index-db.js';
import {
  authorsOf,
  gradeDeclarations,
  gradeRecord,
  noteAuthorsOf,
  restrictGrade,
  signerFingerprintsOf,
  type Grade,
} from './grade.js';
import { NOTES_REF, notesAvailability, type NotesAvailability } from './notes.js';
import {
  foldLifecycle,
  hasAmbiguousIdCollision,
  type RecordState,
  type StaleRecord,
} from './stale.js';
import {
  SINGLE_VALUED,
  parseProvenance,
  type Lifecycle,
  type Record,
  type Trailer,
} from './types.js';

export const LIMIT_KEY = 'Limit';
export const RULED_OUT_KEY = 'Ruled-out';
export const WARN_KEY = 'Warn';

/**
 * How long a consumer route may spend building a missing index, or scanning
 * when it cannot write one.
 *
 * Three seconds is long enough that a repository of ordinary size is still
 * answered in full, and short enough that a 21k-commit repository costs a
 * pause rather than four minutes. Exceeding it is never silent: `unreadCommits`
 * is set and the answer names `commitlore init`.
 */
export const CONSUMER_SCAN_BUDGET_MS = 3_000;

const RECORD_ID_KEY = 'Record-Id';
const PROVENANCE_KEY = 'Provenance';

/** Every key `foldLifecycle` reads. The global pass fetches exactly these. */
const LIFECYCLE_KEYS: readonly string[] = [RECORD_ID_KEY, 'Supersedes', 'Expires'];

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

/**
 * Trust grade, the output half of SPEC §7. `blocked` is reserved: the minimal
 * rule below never produces it.
 */
export type TrustGrade = 'directive' | 'claim' | 'blocked';

export interface QueryOptions {
  /**
   * Whether an empty answer should say if the path was never in the history (#307).
   *
   * On for the surfaces a caller queries deliberately -- `context` and MCP -- where
   * `records: 0` for a path that never existed is a false observation waiting to be
   * written down.
   *
   * Off for the `PreToolUse` injection path, where a file being created for the
   * first time legitimately has no history, so the diagnostic would fire on every
   * new file and the hook's contract is silence when there is nothing to say.
   */
  explainEmptyResult?: boolean;
  /** A single path to scope to. Sugar for `paths: [path]`. */
  path?: string;
  /** Several paths. Renames are followed only for one (see `QueryResult.follow`). */
  paths?: readonly string[];
  /** Trailer keys the caller wants; a record carrying none of them is dropped. */
  keys?: readonly string[];
  /** Keep superseded and expired records too, each with its lifecycle attached. */
  allHistory?: boolean;
  /** Answer from git alone, with no SQLite index. Same answers, slower. */
  noIndex?: boolean;
  /**
   * Wall-clock ceiling, in milliseconds, on a cold index build and on the
   * no-index scan.
   *
   * Absent means unbounded, which is right for `index` and `init`. Consumer
   * routes — `context`, injection, the commit-msg hook — set it so a
   * repository that has never been indexed costs a bounded pause and a
   * labelled partial answer, not minutes of silence. A budget that trips is
   * always reported in `unreadCommits` and `diagnostics`; a truncated answer
   * that looked complete would be worse than a slow one.
   */
  scanBudgetMs?: number;
  /**
   * The clock `scanBudgetMs` is read against. Defaults to `Date.now`.
   *
   * Injectable because a budget that expires *partway* through is otherwise a
   * race against the machine — the case this repository has already had a
   * vacuous CI pass on.
   */
  scanNow?: () => number;
  /** The instant to evaluate against. Defaults to now. */
  at?: Date;
  /** Maximum records returned, applied after ordering. */
  limit?: number;
  /**
   * Author strings this repository configures for directives (SPEC §7), as `inject` takes them.
   *
   * Omitting it is the fail-closed answer, not the permissive one: a `Warn:`
   * from an author the caller cannot vouch for grades `claim`, never
   * `directive`. That is the same default `commitlore inject` has always had,
   * and the two routes disagreeing was the defect this option closes.
  */
  trustedAuthors?: readonly string[];
  /** Opt-in: an otherwise eligible directive must have Git's verified `G` status. */
  requireSignedDirective?: boolean;
  /** Git `%GF` signing-key fingerprints authorized by repository policy. */
  trustedSignerFingerprints?: readonly string[];
  cwd?: string;
}

/**
 * A record as a consumer route sees it: the protocol's `Record`, resolved
 * across every commit and source that declared it, with the lifecycle and
 * trust axes of SPEC §7 attached.
 */
export interface GradedRecord extends Record {
  /** The latest commit that declared this record. */
  sha: string;
  /** Every commit that declared it, oldest first. */
  shas: string[];
  source: RecordSource;
  /** Every source that contributed — a mirrored record has both. */
  sources: RecordSource[];
  paths: string[];
  lifecycle: Lifecycle;
  committedAt: string;
  committedTs: number;
  /** Open set from the stale engine; today only `review`. */
  flags: string[];
  /** The `Provenance:` value verbatim, when the record carried one. */
  provenanceValue?: string;
  trust?: TrustGrade;
  identityCollision?: boolean;
  /** Internal grading input; JSON renderers deliberately do not expose this cache fact. */
  commitSignatures: ReadonlyMap<string, string>;
  matchedTrailerKeys?: string[];
  /** Payload key names retained only so a redacted record remains visible in its sections. */
  withheldTrailerKeys?: string[];
  supersededBy?: string;
  expiresAt?: string;
}

export interface QueryResult {
  records: GradedRecord[];
  /** Whether the SQLite index answered. `false` means the scan fallback did. */
  fromIndex: boolean;
  /** Commit records read before filtering — what the answer was drawn from. */
  scanned: number;
  /** Complete history scans attempted for this query; zero when the index answered. */
  corpusPasses: number;
  /** The instant everything was evaluated against. */
  at: Date;
  /** The paths the caller asked for, normalized. */
  paths: string[];
  /** The names actually queried: `paths` plus whatever renames resolved to. */
  aliases: string[];
  /** Whether renames were followed. `false` when several paths were given. */
  follow: boolean;
  /**
   * Whether git could read this repository's history at all.
   *
   * `unavailable` means the records below are **not** a statement about what
   * this repository contains — git could not answer. Every consumer must treat
   * that as a refusal rather than an empty answer, which is why it is a field
   * and not a log line: `scanTrailers` used to take `null` from `git rev-parse`
   * and return `[]`, so a broken git produced "no constraints" with exit 0.
   */
  /**
   * Whether this answer read everything it was asked about (#631).
   *
   * `history` and `notes` describe the sources, and both stay healthy when a
   * consumer route stops at `CONSUMER_SCAN_BUDGET_MS` — the sources are fine,
   * the index is short. A client checking only those reads a truncated answer
   * as a whole one, which is how the CLI and MCP were seen answering the same
   * question with nine records and with two.
   */
  coverage: 'complete' | 'partial';

  history: HistoryAvailability;
  shallow: boolean;
  /**
   * Whether the notes mirror could be read here, and if not, why.
   *
   * A typed field rather than only a diagnostic string, because the case it
   * exists for is an *empty* answer: `git fetch` does not fetch notes, so a
   * plain clone of a repository full of records answers "no active records" —
   * byte-identical to the answer from a repository where nobody ever wrote one.
   * An agent reads that as "nothing was ruled out", which is the most dangerous
   * sentence this tool can produce. `unfetched` says the answer is unknown, not
   * empty, and a consumer can branch on it without parsing prose.
   */
  notes: NotesAvailability;
  /**
   * Commits a scan budget left unread, and therefore records this answer may be
   * missing.
   *
   * A typed field for the same reason `notes` is one: the symptom is a
   * *smaller* answer, not an error, and "fewer records" is byte-identical to
   * "this repository recorded less". Set when this call's budget tripped, or
   * when a previous budgeted build persisted a partial index. A caller that
   * sees anything but 0 must say so rather than present a truncated answer as
   * the whole of what a path is subject to.
   */
  unreadCommits: number;
  /** Anything the caller should be told about how the answer was produced. */
  diagnostics: string[];
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Trailing slashes would make `src/` and `src` different prefixes. */
const normalizePath = (path: string): string => path.replace(/\/+$/, '');

const normalizePaths = (opts: QueryOptions): string[] => {
  const raw = [...(opts.path === undefined ? [] : [opts.path]), ...(opts.paths ?? [])];
  const kept: string[] = [];
  for (const entry of raw) {
    const path = normalizePath(entry.trim());
    // `.` and `` name the whole repository, which is the unscoped query.
    if (path === '' || path === '.') continue;
    if (!kept.includes(path)) kept.push(path);
  }
  return kept;
};

// ---------------------------------------------------------------------------
// Where the trailers come from — index first, scan as the fallback
// ---------------------------------------------------------------------------

interface RowSource {
  fetch: (query: TrailerQuery) => IndexedTrailer[];
  fromIndex: boolean;
  /** Complete scans attempted while answering this one query. */
  corpusPasses: () => number;
  /** Commits a scan budget left unread. 0 when nothing was truncated. */
  unreadCommits: () => number;
  close: () => void;
  diagnostics: string[];
}

const scanSource = (
  cwd: string,
  diagnostics: string[],
  budgetMs?: number,
  now?: () => number,
): RowSource => {
  let rows: IndexedTrailer[] | undefined;
  let corpusPasses = 0;
  const cost: ScanCost = { unreadCommits: 0, unreadNotes: 0 };
  const clock = now ?? Date.now;

  return {
    fetch: (query) => {
      if (rows === undefined) {
        // The lifecycle fold is repository-wide, so a correct no-index answer
        // must inspect the whole history. Materialize it once, then apply each
        // lifecycle/display alias predicate in memory; re-reading git for each
        // fetch made a single path query parse that corpus repeatedly.
        rows = scanTrailers(
          {},
          budgetMs === undefined
            ? { cwd }
            : { cwd, budget: { deadline: clock() + budgetMs, now: clock }, cost },
        );
        corpusPasses += 1;
      }
      return filterTrailers(rows, query);
    },
    fromIndex: false,
    corpusPasses: () => corpusPasses,
    unreadCommits: () => cost.unreadCommits + cost.unreadNotes,
    close: () => {},
    diagnostics,
  };
};

/**
 * Opens the index, building one when it is missing, and falls back to a scan
 * only when writing is impossible or the caller asked for `--no-index`.
 *
 * The earlier contract refused to create the file: a consumer query that
 * found no index walked history every time and persisted nothing, so on a
 * 21k-commit repository `context` was a permanent four-minute command until
 * `validate` or `init` happened to build one. Building here turns that into a
 * one-time cost. A budget, when the caller set one, stops the first call
 * from blocking for minutes; what it did not read is persisted as
 * `unread_commits` so the next call is fast and still labelled incomplete.
 */
const openSource = (
  cwd: string,
  noIndex: boolean,
  budgetMs?: number,
  now?: () => number,
): RowSource => {
  if (noIndex) return scanSource(cwd, [], budgetMs, now);
  const cost: ScanCost = { unreadCommits: 0, unreadNotes: 0 };
  const clock = now ?? Date.now;
  try {
    const { handle } = ensureIndex({
      cwd,
      ...(budgetMs === undefined
        ? {}
        : { budget: { deadline: clock() + budgetMs, now: clock }, cost }),
    });
    // `ensureIndex` is inside the `try`; `fetch` runs after it returns, so a
    // database that goes bad between opening and reading escapes this catch.
    // That used to be masked: `healthProblem` walked every b-tree before any
    // answer, so damage was turned into a rebuild before a query could hit
    // it. With that walk moved off the read path (#782) the escape is real,
    // and it lands in the worst possible place -- `inject --hook-input`
    // fail-opens to empty stdout, so a corrupt index would read to the agent
    // exactly like a path with no records.
    //
    // Corruption is not an outage here (ADR-0003); it is a reason to stop
    // trusting the derived cache. So the first bad read falls back to the
    // scan for the rest of this query, and says so.
    const diagnostics: string[] = [];
    let fallback: RowSource | null = null;
    const scanInstead = (error: unknown): RowSource => {
      if (fallback === null) {
        fallback = scanSource(cwd, [], budgetMs, now);
        diagnostics.push(
          `the index could not be read (${errorMessage(error)}); answering with a full scan`,
        );
      }
      return fallback;
    };
    return {
      fetch: (query) => {
        if (fallback !== null) return fallback.fetch(query);
        try {
          return queryTrailers(handle, query);
        } catch (error) {
          return scanInstead(error).fetch(query);
        }
      },
      fromIndex: true,
      corpusPasses: () => 0,
      unreadCommits: () => Math.max(indexUnread(handle), cost.unreadCommits + cost.unreadNotes),
      close: () => closeIndex(handle),
      diagnostics,
    };
  } catch (error) {
    return scanSource(
      cwd,
      [`the index is unavailable (${errorMessage(error)}); answering with a full scan`],
      budgetMs,
      now,
    );
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

interface Scope {
  aliases: string[];
  follow: boolean;
  diagnostics: string[];
}

/**
 * Every name one path has carried, newest first, via `git log --follow`.
 *
 * `-z` is what makes a path containing a newline survive the round trip; the
 * separator git writes between the format output and the name list is the one
 * leading `\n` stripped here.
 */
const followedNames = (cwd: string, path: string): string[] => {
  const result = execGit(['log', '--follow', '-z', '--name-only', LOG_FORMAT, '--', path], {
    cwd,
  });
  // A path git cannot resolve, or a repository with no commits, is not an
  // error here: it is a scope that no record falls into.
  if (result.code !== 0) return [];

  const names: string[] = [];
  for (const chunk of result.stdout.split(RECORD_SEP)) {
    const fields = chunk.split(FIELD_SEP);
    for (const field of fields.slice(1)) {
      const name = field.startsWith('\n') ? field.slice(1) : field;
      if (name !== '' && !names.includes(name)) names.push(name);
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
const historyMentions = (cwd: string, path: string): boolean => {
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
const pathPresenceDiagnostics = (cwd: string, paths: readonly string[]): string[] => {
  // One path only: with several, `git log --follow` is already off and the caller
  // has been told so, and a per-path probe would multiply git calls.
  if (paths.length !== 1) return [];
  const [path = ''] = paths;
  if (path === '' || path === '.') return [];
  if (historyMentions(cwd, path)) return [];

  let hint = '';
  let ancestor = path;
  for (let probe = 0; probe < MAX_ANCESTOR_PROBES; probe += 1) {
    const cut = ancestor.lastIndexOf('/');
    if (cut <= 0) break;
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

const resolveScope = (cwd: string, paths: readonly string[]): Scope => {
  if (paths.length === 0) return { aliases: [], follow: false, diagnostics: [] };

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
  const diagnostics: string[] = [];

  for (const name of followedNames(cwd, path)) {
    if (name === path || name.startsWith(`${path}/`)) continue;
    if (aliases.length >= MAX_ALIASES) {
      diagnostics.push(
        `${path} resolved to more than ${MAX_ALIASES} historical names; only the first ${MAX_ALIASES} were queried`,
      );
      break;
    }
    aliases.push(name);
  }

  return { aliases, follow: true, diagnostics };
};

// ---------------------------------------------------------------------------
// Rows -> commit records
// ---------------------------------------------------------------------------

/**
 * One record block from one commit and one source, before identities are
 * resolved. A commit contributes more than one of these only when its
 * message or its mirrored note carries more than one record block
 * (SPEC §2.4) — `block` is what keeps those apart; it is not part of a
 * record's own identity and never reaches `GradedRecord`.
 */
interface CommitRecord {
  sha: string;
  block: number;
  source: RecordSource;
  mirrored: boolean;
  committedAt: string;
  committedTs: number;
  signatureStatus: string;
  trailers: Trailer[];
  paths: string[];
}

/** The total order both `queryTrailers` and `scanTrailers` already return. */
const compareRows = (a: IndexedTrailer, b: IndexedTrailer): number => {
  if (a.committedTs !== b.committedTs) return b.committedTs - a.committedTs;
  if (a.sha !== b.sha) return a.sha < b.sha ? -1 : 1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.block !== b.block) return a.block - b.block;
  return a.seq - b.seq;
};

/**
 * Fetches the display rows: one query per alias, unioned. Both row sources
 * answer the same `TrailerQuery`, which is what keeps the index path and the
 * `--no-index` path returning the same records.
 */
const collectRows = (source: RowSource, aliases: readonly string[]): IndexedTrailer[] => {
  if (aliases.length === 0) return source.fetch({});

  const seen = new Set<string>();
  const rows: IndexedTrailer[] = [];
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
      if (seen.has(identity)) continue;
      seen.add(identity);
      rows.push(row);
    }
  }
  return rows.sort(compareRows);
};

const groupByCommit = (rows: readonly IndexedTrailer[]): CommitRecord[] => {
  const found = new Map<string, CommitRecord>();
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
        signatureStatus: row.signatureStatus,
        trailers: [{ key: row.key, value: row.value }],
        paths: [...row.paths],
      });
      continue;
    }
    existing.trailers.push({ key: row.key, value: row.value });
  }
  return [...found.values()];
};

const trailerValue = (trailers: readonly Trailer[], key: string): string | undefined => {
  const found = trailers.find((trailer) => trailer.key === key)?.value;
  return found === undefined || found === '' ? undefined : found;
};

/** `Record-Id:` when the record declared one, else a key nothing can reference. */
const identityOf = (record: CommitRecord): string =>
  trailerValue(record.trailers, RECORD_ID_KEY) ??
  `${SYNTHETIC_PREFIX}${record.sha}:${record.source}:${record.block}`;

/**
 * A commit's instant in epoch ms, or `undefined` when git gave an unusable one.
 * Parsing `committedAt` rather than scaling `committedTs` keeps this in exact
 * step with the fold, which reads the same string.
 */
const instantOf = (record: CommitRecord): number | undefined => {
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
const foldMirroredNotes = (records: readonly CommitRecord[]): CommitRecord[] => {
  const commits = new Map<string, CommitRecord[]>();
  for (const record of records) {
    if (record.source !== 'commit') continue;
    const list = commits.get(record.sha) ?? [];
    list.push(record);
    commits.set(record.sha, list);
  }
  const claimed = new Set<CommitRecord>();

  return records.filter((record) => {
    if (record.source !== 'notes') return true;
    if (trailerValue(record.trailers, RECORD_ID_KEY) !== undefined) return true;
    const candidates = commits.get(record.sha);
    if (candidates === undefined) return true;
    const contents = new Set(
      record.trailers.map((trailer) => `${trailer.key}\u0000${trailer.value}`),
    );
    const commit = candidates.find(
      (candidate) =>
        !claimed.has(candidate) &&
        candidate.trailers.every((trailer) => contents.has(`${trailer.key}\u0000${trailer.value}`)),
    );
    if (commit === undefined) return true;
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
const withIdentity = (record: CommitRecord): Trailer[] => {
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
const oldestFirst = (a: CommitRecord, b: CommitRecord): number => {
  if (a.committedTs !== b.committedTs) return a.committedTs - b.committedTs;
  if (a.sha !== b.sha) return a.sha < b.sha ? -1 : 1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  return a.block - b.block;
};

/**
 * Folds every record in the repository, so a supersession from outside the
 * path scope still retires what it names (SPEC §5).
 */
const foldStates = (source: RowSource, at: Date, cutoff: number): Map<string, RecordState> => {
  const records = groupByCommit(source.fetch({ keys: LIFECYCLE_KEYS })).sort(oldestFirst);
  const stream: StaleRecord[] = records
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
const mergeTrailers = (into: Trailer[], from: readonly Trailer[]): void => {
  for (const trailer of from) {
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
const gradeMerged = (
  merged: GradedRecord[],
  cwd: string,
  at: Date,
  trustedAuthors: readonly string[] | undefined,
  requireSignedDirective: boolean,
  trustedSignerFingerprints: readonly string[] | undefined,
): void => {
  if (merged.length === 0) return;
  const authors = authorsOf(
    cwd,
    merged.flatMap((record) => record.shas),
  );
  const signerFingerprints =
    requireSignedDirective ? signerFingerprintsOf(cwd, merged.flatMap((record) => record.shas)) : new Map();
  // Walked only when something actually came from the mirror, so a repository
  // with no notes pays nothing for the check (#409).
  const noteAuthors = merged.some((record) => record.sources.includes('notes'))
    ? noteAuthorsOf(cwd)
    : new Map();
  for (const record of merged) {
    const shas = record.shas.length > 0 ? record.shas : [record.sha];
    const resolved = gradeDeclarations(
      { trailers: record.trailers } as Record,
      {
        shas,
        sources: record.sources,
        commitAuthors: authors,
        commitSignatures: record.commitSignatures,
        commitSignerFingerprints: signerFingerprints,
        noteAuthors,
      },
      {
        at,
        ...(trustedAuthors === undefined ? {} : { trustedAuthors }),
        ...(requireSignedDirective ? { requireSignedDirective: true } : {}),
        ...(trustedSignerFingerprints === undefined ? {} : { trustedSignerFingerprints }),
      },
    );
    record.trust = resolved.trust;
    if (resolved.matchedTrailerKeys !== undefined) {
      record.matchedTrailerKeys = resolved.matchedTrailerKeys;
    }
  }
};

const mergeByIdentity = (
  records: readonly CommitRecord[],
  states: ReadonlyMap<string, RecordState>,
): GradedRecord[] => {
  const groups = new Map<string, CommitRecord[]>();
  for (const record of records) {
    const identity = identityOf(record);
    const existing = groups.get(identity);
    if (existing === undefined) groups.set(identity, [record]);
    else existing.push(record);
  }

  const merged: GradedRecord[] = [];
  for (const [identity, group] of groups) {
    const ordered = [...group].sort(oldestFirst);
    const latest = ordered[ordered.length - 1];
    if (latest === undefined) continue;

    const trailers: Trailer[] = [];
    const paths = new Set<string>();
    const sources: RecordSource[] = [];
    const shas: string[] = [];
    for (const record of ordered) {
      mergeTrailers(trailers, record.trailers);
      for (const path of record.paths) paths.add(path);
      if (!sources.includes(record.source)) sources.push(record.source);
      if (record.mirrored && !sources.includes('notes')) sources.push('notes');
      if (!shas.includes(record.sha)) shas.push(record.sha);
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
      commitSignatures: new Map(
        group
          .filter((record) => record.source === 'commit')
          .map((record) => [record.sha, record.signatureStatus]),
      ),
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
const compareRecords = (a: GradedRecord, b: GradedRecord): number => {
  if (a.committedTs !== b.committedTs) return b.committedTs - a.committedTs;
  if (a.sha !== b.sha) return a.sha < b.sha ? -1 : 1;
  const left = a.recordId ?? '';
  const right = b.recordId ?? '';
  return left < right ? -1 : left > right ? 1 : 0;
};

const carriesKey = (record: GradedRecord, keys: readonly string[] | undefined): boolean => {
  if (keys === undefined || keys.length === 0) return true;
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
export const runQuery = (opts: QueryOptions = {}): QueryResult => {
  const cwd = opts.cwd ?? process.cwd();
  const at = opts.at ?? new Date();
  const cutoff = at.getTime();
  if (Number.isNaN(cutoff)) throw new Error('runQuery: opts.at is not a valid Date');

  const paths = normalizePaths(opts);
  const scope = resolveScope(cwd, paths);
  const source = openSource(cwd, opts.noIndex === true, opts.scanBudgetMs, opts.scanNow);
  const diagnostics = [...source.diagnostics, ...scope.diagnostics];

  try {
    if (opts.explainEmptyResult === true) diagnostics.push(...pathPresenceDiagnostics(cwd, paths));

    const states = foldStates(source, at, cutoff);
    const commitRecords = groupByCommit(collectRows(source, scope.aliases));
    const visible = foldMirroredNotes(
      commitRecords.filter((record) => {
        const instant = instantOf(record);
        return instant === undefined || instant <= cutoff;
      }),
    );

    const records = mergeByIdentity(visible, states)
      .filter((record) => opts.allHistory === true || record.lifecycle === 'active')
      .filter((record) => carriesKey(record, opts.keys))
      .sort(compareRecords);
    // After the filters, so the one `git show` prices only the records that survive.
    gradeMerged(
      records,
      cwd,
      at,
      opts.trustedAuthors,
      opts.requireSignedDirective === true,
      opts.trustedSignerFingerprints,
    );
    for (const record of records) {
      if (record.identityCollision !== true) continue;
      record.trust = 'blocked';
      record.matchedTrailerKeys = [RECORD_ID_KEY];
    }

    // Config only — no network. Cheap enough to run on every answer, and the
    // answer it qualifies is the empty one, which is the answer nobody inspects.
    const history = historyAvailability(cwd);
    if (history === 'unavailable') {
      diagnostics.push(
        'git could not read this repository, so this is not an answer about its contents — ' +
          'treat it as unknown, not as empty',
      );
    }

    const unread = source.unreadCommits();
    if (unread > 0) {
      diagnostics.push(
        source.fromIndex
          ? `the index is incomplete: the build stopped after its time budget with ` +
              `${String(unread)} commit(s) or note(s) unread — records in them are missing from this answer. ` +
              'fix: commitlore init (or commitlore index) to finish the index'
          : `this repository has no index, and the scan stopped after its time budget with ` +
              `${String(unread)} commit(s) or note(s) unread — records in them are missing from this answer. ` +
              'fix: commitlore init (or commitlore index) to build the index once',
      );
    }

    const shallow = hasShallowHistory(cwd);
    if (shallow) diagnostics.push(`${SHALLOW_HISTORY_CAVEAT} (fix: git fetch --unshallow)`);

    const notes = notesAvailability({ cwd });
    if (notes === 'unfetched') {
      diagnostics.push(
        'the notes mirror has not been fetched here, so this answer may be missing records ' +
          `that exist upstream (git fetch does not fetch ${NOTES_REF} by default). ` +
          'fix: commitlore doctor --fix, then git fetch',
      );
    }

    return {
      records:
        opts.limit === undefined ? records : records.slice(0, Math.max(0, Math.trunc(opts.limit))),
      fromIndex: source.fromIndex,
      scanned: commitRecords.length,
      corpusPasses: source.corpusPasses(),
      at,
      paths,
      aliases: scope.aliases,
      follow: scope.follow,
      history,
      shallow,
      notes,
      unreadCommits: unread,
      coverage: unread > 0 ? 'partial' : 'complete',
      diagnostics,
    };
  } finally {
    source.close();
  }
};

/** The values a record carries under one key, in order (SPEC §2.1 B5). */
export const valuesOf = (record: GradedRecord, key: string): string[] =>
  record.trailers.filter((trailer) => trailer.key === key).map((trailer) => trailer.value);
