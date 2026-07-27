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
export declare const BLAST_VALUES: readonly ["local", "module", "system"];
export declare const UNDO_VALUES: readonly ["easy", "costly", "permanent"];
export declare const CERTAINTY_VALUES: readonly ["firm", "tentative", "guess"];
export declare const PROVENANCE_PREFIXES: readonly ["authored", "inherited", "reconstructed", "unknown"];
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
} | {
    kind: 'inherited';
    sha: string;
} | {
    kind: 'reconstructed';
} | {
    kind: 'unknown';
};
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
