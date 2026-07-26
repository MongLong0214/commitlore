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
];
/** Keys that may appear at most once per record (SPEC §3, §6 cardinality). */
export const SINGLE_VALUED = new Set([
    'Blast',
    'Undo',
    'Certainty',
    'Record-Id',
    'Expires',
    'Provenance',
    'CommitLore-Version',
]);
/**
 * Keys carried for the machinery, not for the reader — identity, supersession
 * and provenance have done their work before a record reaches a consumer route.
 *
 * Shared rather than private to `inject.ts`, where it was written, because
 * "what is payload" has to mean the same thing in every route that withholds a
 * payload. `inject` strips these to save budget; the MCP server strips
 * everything *but* these when a record grades `blocked`, so that the fact of the
 * record survives and its content does not. Two definitions would let a key be
 * bookkeeping on one route and quotable attack text on the other.
 */
export const BOOKKEEPING_KEYS = new Set([
    'Record-Id',
    'Supersedes',
    'Follows',
    'Expires',
    'Provenance',
    'Evidence',
    'CommitLore-Version',
]);
export const BLAST_VALUES = ['local', 'module', 'system'];
export const UNDO_VALUES = ['easy', 'costly', 'permanent'];
export const CERTAINTY_VALUES = ['firm', 'tentative', 'guess'];
export const PROVENANCE_PREFIXES = ['authored', 'inherited', 'reconstructed', 'unknown'];
export const RECORD_ID_RE = /^r-[a-z0-9]{6,}$/;
export const EXTENSION_KEY_RE = /^X-[A-Za-z][A-Za-z0-9-]*$/;
//# sourceMappingURL=types.js.map