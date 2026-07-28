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
 *
 * ## One block per inherited record (bug-issue-60)
 *
 * This module used to fold every source record in the range into one merged
 * record: the branch's `Limit:`s, `Warn:`s and the rest all landed in a single
 * trailer block, `Record-Id:` was kept only when the range declared exactly
 * one, and `Provenance: inherited <sha>` named the newest source commit
 * regardless of how many records actually contributed. Two commits sharing a
 * `Record-Id` — an ordinary lifecycle update across a branch — is one record
 * and folds correctly. Two commits declaring *different* ids are two separate
 * decisions, and folding them into one record with a single identity was
 * always wrong: it either kept one id and silently discarded the other's
 * (findable-only-by-`Follows:` identity gone for good) or, with two or more,
 * kept neither.
 *
 * `planSquash` now produces one block per distinct record (`SquashPlan.blocks`
 * — SPEC §2.4's multi-record grammar), each keeping its own `Record-Id` when
 * the sources declared one, and its own `Provenance: inherited <sha>` naming
 * *that record's* newest source, never a different record's. `renderMessage`
 * and `attachToNotes` write the blocks as separate, blank-line-separated
 * paragraphs, so `commitlore validate`/`context`/the index recover every one
 * of them individually (`core/trailers.ts` `parseRecordBlocks`,
 * `core/index-db.ts`, `core/notes.ts` `readRecordBlocks`/`writeRecordBlocks`).
 *
 * `X-Inherited-From` — the old format's only way to say which source commit
 * an inherited record with an ambiguous identity actually came from — is no
 * longer written: a canonical `Provenance:` inside each record's own block
 * says that now, correctly, without an extension. `attachToNotes` still
 * reads an old note through the ordinary trailer parser and never rejects
 * one that carries the old key, because `X-<Name>:` is preserved and never
 * interpreted by the core (SPEC §3.2) — an already-published note keeps
 * resolving exactly as it did before this change.
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
    /**
     * One resolved trailer array per inherited record (SPEC §2.4), in the
     * order each record's identity first appears in the range — an
     * unidentified source contributes its own block at its own position.
     * Every block carries its own `Record-Id` (when the sources declared one)
     * and its own `Provenance: inherited <sha>`, naming that record's newest
     * source and no other's. Written out as separate paragraphs by
     * `renderMessage` / `attachToNotes`.
     */
    blocks: Trailer[][];
    /** Same `Record-Id`, contradictory content. Warned about, never silent. */
    conflicts: RecordConflict[];
    /** One entry per source record, in range order. */
    provenance: ProvenanceEntry[];
}
/**
 * The extension the pre-multi-record format used to carry per-source
 * provenance in the mirror, back when one ambiguous `Record-Id` situation
 * forced every inherited record into a single merged block (see this
 * module's own doc comment). `attachToNotes` no longer writes it — each
 * block's own `Provenance:` says the same thing correctly, without an
 * extension — but a note published before this change still carries it, and
 * nothing here refuses that note: `X-<Name>:` is preserved and never
 * interpreted by the core (SPEC §3.2), so it reads back exactly as before.
 * Exported for exactly that: tests and callers that need to construct or
 * recognize the old shape.
 */
export declare const INHERITED_FROM_KEY = "X-Inherited-From";
/**
 * Reads the records of every commit in `range`, oldest first — the order the
 * merge rules mean by "latest".
 *
 * Both channels of SPEC §1 are read for each commit: the message's own record
 * blocks and the notes mirror's, matched and merged by `mergeCommitBlocks`. A
 * record that only ever existed as a note — one an earlier `squash-preserve`
 * attached, or one `harvest` wrote out of band — is inherited exactly like one
 * in a message, because the protocol does not rank the two sources.
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
 * Folds the range's collected records into one block per distinct record —
 * findings 2 and 3 of bug-issue-60, together: identity survives (a group's
 * `Record-Id`, when it has one, is carried on its own block, never dropped
 * for ambiguity — there is nothing ambiguous about it once records are not
 * folded across identities), and `Provenance: inherited <sha>` names that
 * block's own newest source, correct for every block instead of true for at
 * most one.
 *
 * Blocks are ordered identified groups first (each at the position its
 * identity first appears in the range), then unidentified singleton records
 * last, in their own range order. That placement is not cosmetic: SPEC §2.4's
 * multi-record grammar recovers a *non-final* block only when it declares a
 * `Record-Id` (there being no other way to tell it apart from an incidental
 * `Key: value`-shaped body paragraph — see `parseRecordBlocks`). Putting the
 * unidentified ones last means that when there is exactly one, it is the
 * message's own last paragraph and needs no identity to be found again — the
 * ordinary, unconditional way `parseCommitMessage` has always recognized a
 * trailer block. When there is more than one, only the last survives a later
 * re-parse of the stored text; the plan computed here still names all of
 * them (`SquashPlan.blocks`, `warningsFor` in `commands/squash-preserve.ts`).
 */
export declare const planSquash: (records: CollectedRecord[]) => SquashPlan;
/**
 * Rewrites a merge message draft so it carries the inherited records: the
 * prose of `base` with its trailing record-block paragraphs replaced by the
 * plan's, one block per paragraph, blank-line separated (SPEC §2.4).
 *
 * Replaced, not appended — running this twice on the same draft has to produce
 * the same message, because a re-run of the Action on an amended PR is ordinary
 * and a second set of blocks would leave the first as prose (B2), where
 * nothing would ever read it again.
 *
 * A plan with no blocks returns `base` untouched. Emptying somebody's merge
 * message because there was nothing to inherit is not an improvement.
 */
export declare const renderMessage: (base: string, plan: SquashPlan) => string;
/**
 * Mirrors the inherited records onto the merge commit (SPEC §1: notes are "the
 * destination for records inherited across squash merges").
 *
 * One note, one block per inherited record (SPEC §2.4, `writeRecordBlocks`) —
 * the same shape `renderMessage` writes into a commit message, so a consumer
 * reading either channel recovers the same records with the same identities
 * and the same per-record provenance. Earlier versions of this function also
 * wrote `X-Inherited-From:` here to carry per-source provenance the message
 * channel's single `Provenance:` could not hold; that extension is no longer
 * needed (see this module's doc comment) and is not written by this version.
 *
 * Refuses to write when the plan inherited nothing: `git notes add` reads an
 * empty body as a deletion, and a plan with no blocks must not remove a note
 * somebody else put there.
 */
export declare const attachToNotes: (targetSha: string, plan: SquashPlan, opts?: AttachOptions) => void;
