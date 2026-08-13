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
/**
 * `<sha>` in `Provenance: inherited <sha>`, as SPEC §3 writes it. Bounds are
 * git's, not ours: 4 is the shortest abbreviation git will emit
 * (`core.abbrev`), 64 is a full SHA-256. A-F is accepted because git's
 * object-name alphabet is hexadecimal and case-insensitive; squash-preserve
 * writes whatever `git rev-parse` emits (lowercase), but a hand-copied id
 * may be upper, and SPEC §3 writes `<sha>` with no case constraint.
 *
 * This is the **trailer grammar** and nothing else. It admits abbreviations on
 * purpose, because a person writing a record may reasonably paste a short id.
 * It therefore cannot answer whether a value is an object id the product may
 * store, compare, or hand to git as an identity — {@link isFullObjectId} does
 * that. `spec/schema/record.schema.json` carries a synchronised copy of
 * {@link PROVENANCE_VALUE_PATTERN}; the two must stay identical.
 */
export const GIT_OBJECT_ID_PATTERN = '[0-9a-fA-F]{4,64}';
/**
 * A full git object id is exactly 40 hex (SHA-1) or exactly 64 hex (SHA-256).
 * Nothing lies between: 41 through 63 name no object format git has, and
 * anything shorter is an abbreviation — a request to resolve, not an identity.
 *
 * Kept separate from {@link GIT_OBJECT_ID_PATTERN} deliberately. One shared
 * `{4,64}` predicate reads as "is this hex-ish", and under it a truncated or
 * corrupted id passes as canonical and is then persisted and compared as
 * though it named an object; the failure surfaces later, somewhere else, as a
 * record bound to nothing. Persisted and internal state is checked with this.
 * A revision a user typed goes through `resolveRevision` first, which asks git
 * to turn it into exactly one full id or refuse.
 */
export const FULL_OBJECT_ID_PATTERN = '(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})';
/** Anchored form of {@link FULL_OBJECT_ID_PATTERN}. One definition, every reader. */
export const FULL_OBJECT_ID_RE = new RegExp(`^${FULL_OBJECT_ID_PATTERN}$`);
/** Whether `value` is a full SHA-1 or SHA-256 object id (exact 40 or exact 64 hex). */
export const isFullObjectId = (value) => FULL_OBJECT_ID_RE.test(value);
/** The schema `pattern` and the parser read this string. There is no third copy. */
export const PROVENANCE_VALUE_PATTERN = `^(authored|drafted|reconstructed|unknown|inherited ${GIT_OBJECT_ID_PATTERN})$`;
export const PROVENANCE_VALUE_RE = new RegExp(PROVENANCE_VALUE_PATTERN);
export const PROVENANCE_FORMAT_WANT = PROVENANCE_PREFIXES.map((kind) => kind === 'inherited' ? 'inherited <sha>' : kind).join(' | ');
export const RECORD_ID_RE = /^r-[a-z0-9]{6,}$/;
export const EXTENSION_KEY_RE = /^X-[A-Za-z][A-Za-z0-9-]*$/;
/**
 * Reads a `Provenance:` value. Schema, grade and query all call this; a
 * suffix the schema would refuse must not become `inherited` on a consumer
 * route. Unrecognised input is `undefined` so the caller can choose
 * `unknown` (grade) or omit the field (query).
 */
export const parseProvenance = (value) => {
    if (value === undefined)
        return undefined;
    const trimmed = value.trim();
    if (!PROVENANCE_VALUE_RE.test(trimmed))
        return undefined;
    if (trimmed.startsWith('inherited ')) {
        return { kind: 'inherited', sha: trimmed.slice('inherited '.length) };
    }
    if (trimmed === 'authored' ||
        trimmed === 'drafted' ||
        trimmed === 'reconstructed' ||
        trimmed === 'unknown') {
        return { kind: trimmed };
    }
    return undefined;
};
//# sourceMappingURL=types.js.map