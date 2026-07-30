/** Core types for the CommitLore protocol. See spec/SPEC.md §3. */

/** Keys the core interprets. Anything else is either an extension or a violation. */
export const KNOWN_KEYS = [
  'Limit',
  'Ruled-out',
  'Warn',
  'Blast',
  'Undo',
  'Certainty',
  'Verified',
  'Unverified',
  'Record-Id',
  'Follows',
  'Supersedes',
  'Expires',
  'Evidence',
  'Provenance',
  'CommitLore-Version',
] as const;

export type KnownKey = (typeof KNOWN_KEYS)[number];

/** Keys that may appear at most once per record (SPEC §3, §6 cardinality). */
export const SINGLE_VALUED: ReadonlySet<string> = new Set<string>([
  'Blast',
  'Undo',
  'Certainty',
  'Record-Id',
  'Expires',
  'Provenance',
  'CommitLore-Version',
]);

/** Keys whose validated values cannot carry prose. */
export const STRUCTURAL_TRAILER_KEYS: ReadonlySet<string> = new Set([
  'Blast',
  'Undo',
  'Certainty',
  'Record-Id',
  'Supersedes',
  'Follows',
  'Provenance',
  'CommitLore-Version',
]);

/** Keys omitted from the injection projection because they do not repay their token cost. */
export const INJECT_OMITTED_KEYS: ReadonlySet<string> = new Set([
  'Record-Id',
  'Supersedes',
  'Follows',
  'Expires',
  'Provenance',
  'Evidence',
  'CommitLore-Version',
]);

/**
 * Trailers whose meaning was already fixed by git or code-review tooling
 * before this protocol existed, and which assert nothing SPEC §3 gives a
 * vocabulary slot to. `Co-authored-by:` says who touched a commit, not why
 * it happened; `Signed-off-by:` is a DCO attestation; the rest are the same
 * shape. None of them is a limit, a ruled-out alternative or a warning, so
 * ingesting one as a record manufactures a claim the line never made and
 * crowds out whatever a path's real records have to say (bug-issue-150).
 *
 * This is a denylist, not a second `KNOWN_KEYS`. A project can still invent
 * its own trailer today — `Ticket:`, `Design-Doc:`, anything — and it reaches
 * the "other" bucket unrecognized but not misrepresented, because CommitLore
 * has no opinion about a key nobody else has claimed. It does have an opinion
 * about a key someone *else* already gave a fixed, unrelated meaning: never a
 * record, no matter what else the commit carries.
 *
 * `Fixes:` and `Closes:` are deliberately not here. They name the issue a
 * change addresses, which is closer to decision context than to attribution —
 * an agent reading "Fixes #123" learns something a co-author's name never
 * tells it — so they are left to land in "other" like any trailer this
 * protocol simply has no vocabulary slot for yet, rather than being silently
 * discarded alongside pure attribution.
 *
 * Matched case-insensitively via {@link isConventionalTrailerKey}: SPEC's own
 * key match is case-sensitive (§3), but that is a different question — this
 * set is not SPEC vocabulary, and `Co-authored-by`, `Co-Authored-By` and
 * `Co-authored-By` all reach a commit message from GitHub, git and various
 * editors for the identical trailer (bug-issue-150's own report shows all
 * three in one repository).
 */
const CONVENTIONAL_TRAILER_LIST = [
  'Co-authored-by',
  'Signed-off-by',
  'Reviewed-by',
  'Acked-by',
  'Tested-by',
  'Reported-by',
  'Suggested-by',
  'Cc',
  'Change-Id',
] as const;

export const CONVENTIONAL_TRAILER_KEYS: ReadonlySet<string> = new Set(
  CONVENTIONAL_TRAILER_LIST.map((key) => key.toLowerCase()),
);

/** Lowercased key -> the canonical spelling used in reports (e.g. `commitlore index --stats`). */
const CONVENTIONAL_TRAILER_CANONICAL: ReadonlyMap<string, string> = new Map(
  CONVENTIONAL_TRAILER_LIST.map((key) => [key.toLowerCase(), key]),
);

/** Whether `key` names a reserved trailer from {@link CONVENTIONAL_TRAILER_KEYS}, case-insensitively. */
export const isConventionalTrailerKey = (key: string): boolean =>
  CONVENTIONAL_TRAILER_KEYS.has(key.toLowerCase());

/** The canonical spelling for a conventional key, regardless of how this occurrence was cased. */
export const canonicalConventionalTrailerKey = (key: string): string =>
  CONVENTIONAL_TRAILER_CANONICAL.get(key.toLowerCase()) ?? key;

export const BLAST_VALUES = ['local', 'module', 'system'] as const;
export const UNDO_VALUES = ['easy', 'costly', 'permanent'] as const;
export const CERTAINTY_VALUES = ['firm', 'tentative', 'guess'] as const;
export const PROVENANCE_PREFIXES = ['authored', 'inherited', 'reconstructed', 'unknown'] as const;

export type Blast = (typeof BLAST_VALUES)[number];
export type Undo = (typeof UNDO_VALUES)[number];
export type Certainty = (typeof CERTAINTY_VALUES)[number];

export const RECORD_ID_RE = /^r-[a-z0-9]{6,}$/;
export const EXTENSION_KEY_RE = /^X-[A-Za-z][A-Za-z0-9-]*$/;

/** One parsed trailer line, after folding. */
export interface Trailer {
  key: string;
  value: string;
}

/** A commit as the protocol sees it. */
export interface ParsedCommit {
  sha: string;
  subject: string;
  body: string;
  trailers: Trailer[];
}

/** How a record came to exist — the provenance axis of trust grading (SPEC §7). */
export type Provenance =
  | { kind: 'authored' }
  | { kind: 'inherited'; sha: string }
  | { kind: 'reconstructed' }
  | { kind: 'unknown' };

/** The lifecycle axis of trust grading (SPEC §7). Computed by the stale engine. */
export type Lifecycle = 'active' | 'superseded' | 'expired';

/**
 * The knowledge unit: every trailer attached to one commit.
 * Grading and path fields are filled by later layers, so they stay optional here.
 */
export interface Record {
  trailers: Trailer[];
  sha?: string;
  recordId?: string;
  provenance?: Provenance;
  lifecycle?: Lifecycle;
  /** Where the record was read from — commit message or the notes mirror. */
  source?: 'commit' | 'notes';
  /** Paths touched by the commit, when the caller resolved them. */
  paths?: string[];
}

/** A validation failure. Shape is consumed programmatically by the repair loop (SPEC §6). */
export interface Violation {
  key: string;
  value: string;
  rule: 'unknown-key' | 'enum' | 'format' | 'cardinality' | 'dangling-ref' | 'duplicate-id';
  got: string;
  want: string;
}
