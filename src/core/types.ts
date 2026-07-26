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
  rule: 'unknown-key' | 'enum' | 'format' | 'cardinality' | 'dangling-ref';
  got: string;
  want: string;
}
