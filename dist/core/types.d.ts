/** Core types for the CommitLore protocol. See spec/SPEC.md §3. */
/** Keys the core interprets. Anything else is either an extension or a violation. */
export declare const KNOWN_KEYS: readonly ["Limit", "Ruled-out", "Warn", "Blast", "Undo", "Certainty", "Verified", "Unverified", "Record-Id", "Follows", "Supersedes", "Expires", "Evidence", "Provenance", "CommitLore-Version"];
export type KnownKey = (typeof KNOWN_KEYS)[number];
/** Keys that may appear at most once per record (SPEC §3, §6 cardinality). */
export declare const SINGLE_VALUED: ReadonlySet<string>;
/** Keys whose validated values cannot carry prose. */
export declare const STRUCTURAL_TRAILER_KEYS: ReadonlySet<string>;
/** Keys omitted from the injection projection because they do not repay their token cost. */
export declare const INJECT_OMITTED_KEYS: ReadonlySet<string>;
/**
 * Whether a key belongs to this protocol's vocabulary — SPEC §3's fifteen keys,
 * or an `X-<Name>:` organization extension, which §3 gives a slot of its own.
 *
 * This answers a question {@link CONVENTIONAL_TRAILER_KEYS} does not. That set
 * decides which trailers to drop *inside* a record, and it is deliberately a
 * denylist so a project's own `Ticket:` survives alongside a `Limit:`. But a
 * block carrying no key from this vocabulary is not a record at all, and
 * treating it as one manufactures a claim its lines never made: on a repository
 * using conventional commits and holding zero records, `sha256:`, `Tests:` and
 * `fix:` were indexed and served to an agent as recorded decisions (#335).
 *
 * Case-sensitive, because SPEC §3's key match is. `limit:` is not `Limit:`.
 */
export declare const isCommitLoreKey: (key: string) => boolean;
export declare const CONVENTIONAL_TRAILER_KEYS: ReadonlySet<string>;
/** Whether `key` names a reserved trailer from {@link CONVENTIONAL_TRAILER_KEYS}, case-insensitively. */
export declare const isConventionalTrailerKey: (key: string) => boolean;
/** The canonical spelling for a conventional key, regardless of how this occurrence was cased. */
export declare const canonicalConventionalTrailerKey: (key: string) => string;
export declare const BLAST_VALUES: readonly ["local", "module", "system"];
export declare const UNDO_VALUES: readonly ["easy", "costly", "permanent"];
export declare const CERTAINTY_VALUES: readonly ["firm", "tentative", "guess"];
export declare const PROVENANCE_PREFIXES: readonly ["authored", "drafted", "inherited", "reconstructed", "unknown"];
/**
 * `<sha>` in `Provenance: inherited <sha>` is a git object id. Bounds are
 * git's, not ours: 4 is the shortest abbreviation git will emit
 * (`core.abbrev`), 64 is a full SHA-256. A-F is accepted because git's
 * object-name alphabet is hexadecimal and case-insensitive; squash-preserve
 * writes whatever `git rev-parse` emits (lowercase), but a hand-copied id
 * may be upper, and SPEC §3 writes `<sha>` with no case constraint.
 */
export declare const GIT_OBJECT_ID_PATTERN = "[0-9a-fA-F]{4,64}";
/** The schema `pattern` and the parser read this string. There is no third copy. */
export declare const PROVENANCE_VALUE_PATTERN = "^(authored|drafted|reconstructed|unknown|inherited [0-9a-fA-F]{4,64})$";
export declare const PROVENANCE_VALUE_RE: RegExp;
export declare const PROVENANCE_FORMAT_WANT: string;
export type Blast = (typeof BLAST_VALUES)[number];
export type Undo = (typeof UNDO_VALUES)[number];
export type Certainty = (typeof CERTAINTY_VALUES)[number];
export declare const RECORD_ID_RE: RegExp;
export declare const EXTENSION_KEY_RE: RegExp;
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
export type Provenance = {
    kind: 'authored';
}
/**
 * Produced by the capture pipeline from a transcript and staged without a
 * person reading it (ADR-0030). Real, verified against its sources, and
 * capped at `claim` — the same treatment `reconstructed` gets, for the same
 * reason: nobody stood behind the wording.
 */
 | {
    kind: 'drafted';
} | {
    kind: 'inherited';
    sha: string;
} | {
    kind: 'reconstructed';
} | {
    kind: 'unknown';
};
/**
 * Reads a `Provenance:` value. Schema, grade and query all call this; a
 * suffix the schema would refuse must not become `inherited` on a consumer
 * route. Unrecognised input is `undefined` so the caller can choose
 * `unknown` (grade) or omit the field (query).
 */
export declare const parseProvenance: (value: string | undefined) => Provenance | undefined;
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
