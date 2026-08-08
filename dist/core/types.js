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
/** Keys whose validated values cannot carry prose. */
export const STRUCTURAL_TRAILER_KEYS = new Set([
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
export const INJECT_OMITTED_KEYS = new Set([
    'Record-Id',
    'Supersedes',
    'Follows',
    'Expires',
    'Provenance',
    'Evidence',
    'CommitLore-Version',
]);
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
export const isCommitLoreKey = (key) => KNOWN_KEYS.includes(key) || /^X-./.test(key);
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
];
export const CONVENTIONAL_TRAILER_KEYS = new Set(CONVENTIONAL_TRAILER_LIST.map((key) => key.toLowerCase()));
/** Lowercased key -> the canonical spelling used in reports (e.g. `commitlore index --stats`). */
const CONVENTIONAL_TRAILER_CANONICAL = new Map(CONVENTIONAL_TRAILER_LIST.map((key) => [key.toLowerCase(), key]));
/** Whether `key` names a reserved trailer from {@link CONVENTIONAL_TRAILER_KEYS}, case-insensitively. */
export const isConventionalTrailerKey = (key) => CONVENTIONAL_TRAILER_KEYS.has(key.toLowerCase());
/** The canonical spelling for a conventional key, regardless of how this occurrence was cased. */
export const canonicalConventionalTrailerKey = (key) => CONVENTIONAL_TRAILER_CANONICAL.get(key.toLowerCase()) ?? key;
export const BLAST_VALUES = ['local', 'module', 'system'];
export const UNDO_VALUES = ['easy', 'costly', 'permanent'];
export const CERTAINTY_VALUES = ['firm', 'tentative', 'guess'];
export const PROVENANCE_PREFIXES = ['authored', 'drafted', 'inherited', 'reconstructed', 'unknown'];
export const RECORD_ID_RE = /^r-[a-z0-9]{6,}$/;
export const EXTENSION_KEY_RE = /^X-[A-Za-z][A-Za-z0-9-]*$/;
//# sourceMappingURL=types.js.map