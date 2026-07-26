/**
 * Squash inheritance (T-302, ADR-0004, PRD-F3 AC 1·2).
 *
 * A squash merge collapses a branch into one commit and destroys every trailer
 * block on it. What GitHub writes is a bulleted list of subjects, and a
 * `Key: value` line sitting inside prose is not a trailer block (SPEC §2.1 B3),
 * so `git interpret-trailers` finds nothing on the merge commit. That is defect
 * D3 — the reason "records are permanent" was a false claim before this module
 * existed, and the reason squash cannot simply be forbidden: the protocol has
 * to adapt to the workflow, not the other way round (ADR-0004 Ruled-out).
 *
 * The repair is in two halves, kept as separate functions so the GitHub Action
 * (T-602) can drive them with no CLI in the loop:
 *
 *   plan    `collectRange` -> `planSquash`      pure; reads git, writes nothing
 *   apply   `renderMessage` / `attachToNotes`   one returns text, one writes notes
 *
 * Both destinations are used because neither survives alone: the message block
 * is what path-scoped queries read (`commitlore limits -- <path>`), and the
 * notes mirror is what survives the next `rebase -i` (SPEC §1).
 *
 * Nothing here talks to a network. Writing `refs/notes/commitlore` is local;
 * publishing it is the user's or the Action's decision.
 */
import { type Trailer } from './types.js';
export interface SquashOptions {
    cwd?: string;
}
export interface AttachOptions extends SquashOptions {
    /** Replace an existing note on the target. Without it, one is an error. */
    force?: boolean;
}
/** One source commit's record, as the range gave it up. */
export interface CollectedRecord {
    /** The original commit — the sha the squash is about to make unreachable. */
    sha: string;
    trailers: Trailer[];
    recordId?: string;
}
/** Two commits declared the same `Record-Id` with different content. */
export interface RecordConflict {
    recordId: string;
    /** The source commit whose version won — the latest one in the range. */
    kept: string;
    /** The source commits whose versions differed from it. */
    dropped: readonly string[];
}
/** Where one inherited record lived before the squash. */
export interface ProvenanceEntry {
    recordId?: string;
    fromSha: string;
}
export interface SquashPlan {
    sources: CollectedRecord[];
    /** The final trailers, after dedupe and conflict resolution. */
    merged: Trailer[];
    /** Same `Record-Id`, contradictory content. Warned about, never silent. */
    conflicts: RecordConflict[];
    /** One entry per source record, in range order. */
    provenance: ProvenanceEntry[];
}
/**
 * The repeatable extension that carries per-source provenance in the mirror.
 *
 * `Provenance:` cannot do this job. It is single-valued (SPEC §3.2) and its
 * grammar admits exactly one sha — `^(authored|reconstructed|unknown|inherited
 * [0-9a-f]{7,40})$` in `spec/schema/record.schema.json` — so a record that
 * inherited from four commits has no legal way to say so with that key. An
 * `X-<Name>:` extension is repeatable and is preserved verbatim by every
 * conforming implementation (SPEC §3.2, §8), which makes it the only place the
 * per-source mapping can live without producing a record that fails
 * `commitlore validate`. See `attachToNotes`.
 */
export declare const INHERITED_FROM_KEY = "X-Inherited-From";
/**
 * Reads the records of every commit in `range`, oldest first — the order the
 * merge rules mean by "latest".
 *
 * Both channels of SPEC §1 are read for each commit: the message block and the
 * notes mirror, merged with `(key, value)` duplicates dropped. A record that
 * only ever existed as a note — one an earlier `squash-preserve` attached, or
 * one `harvest` wrote out of band — is inherited exactly like one in a message,
 * because the protocol does not rank the two sources.
 *
 * Commits that recorded nothing are absent from the result rather than present
 * and empty: they contribute no trailers and no provenance, and listing them
 * would put commits in `plan.sources` that no record came from (SPEC §4 — a
 * commit with no trailers is a commit that recorded nothing, not an error).
 *
 * Throws when `range` is not a range or names nothing; the caller turns that
 * into a usage exit. An empty range is not an error here — it yields `[]`, and
 * only the command knows whether that is worth failing over.
 */
export declare const collectRange: (range: string, opts?: SquashOptions) => CollectedRecord[];
/**
 * Folds the source records into the one record the merge commit will carry.
 *
 * `records` is expected oldest first, as `collectRange` returns it; "latest"
 * everywhere below means "later in that order".
 *
 * Dedupe:
 * - **Repeatable keys** accumulate, dropping exact `(key, value)` repeats. That
 *   is the content dedupe for records with no `Record-Id`, and it is also what
 *   happens inside a `Record-Id` group — a record refined across three commits
 *   contributes each distinct `Limit:` once, matching how the stale engine
 *   already resolves a re-declared record (`core/stale.ts`).
 * - **Single-valued keys** collect every candidate and are resolved once, by
 *   `RESOLVERS`. The merged record is one record, so it may carry at most one
 *   of each (SPEC §4) — folding them any other way produces output that fails
 *   `commitlore validate`.
 * - **Conflicts** are reported at `Record-Id` granularity and never resolved
 *   silently: `conflicts` names the commit whose version was kept and the ones
 *   that differed, and the caller prints them.
 *
 * Identity is the one thing a squash can genuinely lose. `Record-Id` is
 * single-valued, so when the range declared two of them neither can be the
 * merge record's identity, and inventing or arbitrarily picking one would
 * re-attribute context to a record that never carried it. The rule is
 * therefore: keep the `Record-Id` when the range declared exactly one, omit it
 * otherwise. Every identity, kept or not, survives in `provenance` and reaches
 * the mirror through `attachToNotes`, so the mapping from a record to where it
 * lived stays auditable even when it stops being declared. SPEC §3.3 wants an
 * identity to be stable across a squash, and this delivers that for the case
 * that matters most — one record refined over a branch — while refusing to fake
 * it for the case a single-record note cannot represent.
 *
 * `Provenance:` is not inherited from the sources: a source's value describes
 * the source. The merge record's own value is `inherited <sha>` naming the
 * newest source commit — the one sha that reaches the whole squashed branch
 * through its ancestry, and the only one the key's grammar has room for.
 */
export declare const planSquash: (records: CollectedRecord[]) => SquashPlan;
/**
 * Rewrites a merge message draft so it carries the inherited record: the prose
 * of `base` with its trailer block replaced by the plan's canonical one.
 *
 * Replaced, not appended — running this twice on the same draft has to produce
 * the same message, because a re-run of the Action on an amended PR is ordinary
 * and a second block would leave the first one as prose (B2), where nothing
 * would ever read it again.
 *
 * A plan with no trailers returns `base` untouched. Emptying somebody's merge
 * message because there was nothing to inherit is not an improvement.
 */
export declare const renderMessage: (base: string, plan: SquashPlan) => string;
/**
 * Mirrors the inherited record onto the merge commit (SPEC §1: notes are "the
 * destination for records inherited across squash merges").
 *
 * The note is the plan's canonical block plus one `X-Inherited-From:` per
 * source record — `<record-id> <sha>` when the source declared an id, `<sha>`
 * when it did not. That is where "which original did this come from" is
 * answered per record: the message can only carry one `Provenance: inherited
 * <sha>` (see `INHERITED_FROM_KEY`), so the message says *that* the record was
 * inherited and the mirror says *from what*. Both halves validate — `X-<Name>`
 * is repeatable and preserved verbatim by the core (SPEC §3.2) — so a merge
 * commit produced here passes `commitlore validate` on both channels.
 *
 * Refuses to write an empty record: `git notes add` reads an empty body as a
 * deletion, and a plan with nothing in it must not remove a note somebody else
 * put there.
 */
export declare const attachToNotes: (targetSha: string, plan: SquashPlan, opts?: AttachOptions) => void;
