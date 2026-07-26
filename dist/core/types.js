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
export const BLAST_VALUES = ['local', 'module', 'system'];
export const UNDO_VALUES = ['easy', 'costly', 'permanent'];
export const CERTAINTY_VALUES = ['firm', 'tentative', 'guess'];
export const PROVENANCE_PREFIXES = ['authored', 'inherited', 'reconstructed', 'unknown'];
export const RECORD_ID_RE = /^r-[a-z0-9]{6,}$/;
export const EXTENSION_KEY_RE = /^X-[A-Za-z][A-Za-z0-9-]*$/;
//# sourceMappingURL=types.js.map