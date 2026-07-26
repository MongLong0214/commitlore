/**
 * The notes mirror (SPEC §1, ADR-0004).
 *
 * Records live in two places: the commit message, and `refs/notes/commitlore`.
 * The mirror exists because the message is destroyed by ordinary workflows —
 * squash merges collapse it, `rebase -i` and `amend` rewrite it. Notes are
 * keyed by object name and survive all of that.
 *
 * The note body is the canonical trailer block of SPEC §2.3, byte for byte:
 * `serializeTrailers` writes it and `git interpret-trailers --parse` reads it,
 * exactly as for a commit message. There is no second format.
 */
import type { Trailer } from './types.js';
/** The mirror's ref. Not configurable: it is part of the protocol (SPEC §1). */
export declare const NOTES_REF = "refs/notes/commitlore";
/**
 * The fetch refspec a clone needs before it can see anyone else's records.
 * `git fetch` does not fetch notes by default, so a fresh clone reads an empty
 * mirror until this is configured — `commitlore doctor --fix` adds it.
 */
export declare const NOTES_REFSPEC = "+refs/notes/commitlore:refs/notes/commitlore";
export interface NotesOptions {
    cwd?: string;
}
export interface WriteRecordOptions extends NotesOptions {
    /** Overwrite an existing note. Without it, an existing note is an error. */
    force?: boolean;
}
/**
 * Attaches `trailers` to `sha` in the mirror, as the canonical block.
 *
 * Fails if the object already carries a note, unless `force` is set: a record
 * is a claim someone made, and replacing one silently would let a later write
 * erase an earlier decision with no trace. Overwriting is available, but it
 * has to be asked for.
 *
 * Writing an empty record is refused — `git notes add` reads an empty body as
 * "delete this note", so an accidental empty write would remove the record it
 * was meant to add. Deletion is not part of this module.
 */
export declare const writeRecord: (sha: string, trailers: Trailer[], opts?: WriteRecordOptions) => void;
/**
 * Reads the record mirrored for `sha`, or `[]` when the object carries no note.
 * An object with no note is not an error — most commits record nothing
 * (SPEC §4).
 *
 * The returned trailers MAY duplicate the ones in the commit's own message:
 * the mirror is a second channel for the same record, not a disjoint store.
 * Merging the two sources and dropping duplicates belongs to the query engine
 * (T-204) and the inheritance path (T-302), not here.
 */
export declare const readRecord: (sha: string, opts?: NotesOptions) => Trailer[];
/**
 * Every object name that carries a note, in `git notes list` order.
 *
 * A repository whose mirror has never been written, or one that has not
 * fetched it yet, has no such ref — that yields `[]`, not an error.
 */
export declare const listRecordShas: (opts?: NotesOptions) => string[];
