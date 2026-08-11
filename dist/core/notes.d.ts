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
 *
 * **Deliberately not forced** (#417). This carried a leading `+` and therefore
 * overwrote the local mirror with the remote's on every fetch, diverged or not.
 * A note is not a cache — the note *is* the record — so that destroyed records
 * rather than invalidating a derived file, silently and with exit 0. Writing a
 * record and pulling before pushing it was enough to lose it.
 *
 * Unforced costs one thing and buys one thing. A fast-forward still applies
 * without ceremony, which is the ordinary case; the only fetch that behaves
 * differently is one where the local ref holds commits the remote does not —
 * exactly the fetch where forcing destroys something. The cost is a visible
 * `! [rejected]` there, and `commitlore sync` is what resolves it.
 */
export declare const NOTES_REFSPEC = "refs/notes/*:refs/notes/*";
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
 * Attaches several record blocks to `sha` in one note (SPEC §2.4) — each
 * block its own canonical trailer paragraph, blank-line separated, so a
 * `parseRecordBlocks` read (`readRecordBlocks` below, and `core/index-db.ts`)
 * recovers every one of them individually rather than folding them back into
 * one flat trailer list. `writeRecord` cannot do this: it calls
 * `serializeTrailers` once over the whole array, which reorders into SPEC §3
 * vocabulary order and would scramble two blocks' trailers together.
 */
export declare const writeRecordBlocks: (sha: string, blocks: readonly Trailer[][], opts?: WriteRecordOptions) => void;
/**
 * Reads the record mirrored for `sha`, or `[]` when the object carries no note.
 * An object with no note is not an error — most commits record nothing
 * (SPEC §4).
 *
 * The returned trailers MAY duplicate the ones in the commit's own message:
 * the mirror is a second channel for the same record, not a disjoint store.
 * Merging the two sources and dropping duplicates belongs to the query engine
 * (T-204) and the inheritance path (T-302), not here.
 *
 * A note carrying several record blocks (SPEC §2.4, `writeRecordBlocks`)
 * answers here as one flat list — the message's own last paragraph, exactly
 * as `parseCommitMessage` sees it elsewhere. Callers that need every block
 * individually want `readRecordBlocks`.
 */
export declare const readRecord: (sha: string, opts?: NotesOptions) => Trailer[];
/**
 * Reads every record block mirrored for `sha` (SPEC §2.4), or `[]` when the
 * object carries no note. Unlike `readRecord`, a note squash-preserve wrote
 * with `writeRecordBlocks` comes back as one array per block rather than
 * folded flat.
 */
export declare const readRecordBlocks: (sha: string, opts?: NotesOptions) => Trailer[][];
/**
 * Every object name that carries a note, in `git notes list` order.
 *
 * A repository whose mirror has never been written, or one that has not
 * fetched it yet, has no such ref — that yields `[]`, not an error.
 */
export declare const listRecordShas: (opts?: NotesOptions) => string[];
/**
 * What a consumer route can conclude from an empty answer.
 *
 * - `present`    — the mirror ref exists here; an empty answer means empty
 * - `absent`     — no mirror ref, and local doctor evidence says every
 *                  configured remote advertised none: an empty answer means empty
 * - `unfetched`  — no mirror ref, and the remote state is not established
 *                  locally. Records may exist upstream. An empty answer means
 *                  *unknown*.
 *
 * The third case is the one that matters and the reason this exists. `git fetch`
 * does not fetch notes by default, so a plain `git clone` of a repository full
 * of records reads zero of them — and "no active records" is the single most
 * dangerous answer this tool can give, because an agent reads it as "nothing was
 * ruled out and nothing is off limits". `commitlore doctor` has always warned
 * about the missing refspec, but doctor is a command a person runs and the query
 * is what an agent runs.
 */
export type NotesAvailability = 'present' | 'absent' | 'unfetched';
/**
 * A `doctor --fix` observation is scoped to one remote name and value-bound to
 * its configured URL. Remote names may contain punctuation that is not valid
 * in a git-config variable, so encode their UTF-8 bytes instead of interpolating
 * the name into the key.
 */
export declare const notesAbsenceEvidenceKey: (remote: string) => string;
export declare const listRemotes: (opts: NotesOptions) => string[];
export declare const fetchRefspecs: (remote: string, opts: NotesOptions) => string[];
/**
 * Whether `doctor --fix` last established, for this exact configured remote,
 * that it advertised no notes mirror. This is deliberately a local-config
 * lookup: consumer routes must not put a network round trip before an edit.
 */
export declare const hasNotesAbsenceEvidence: (remote: string, opts?: NotesOptions) => boolean;
/**
 * Whether a configured refspec lands the mirror where we read it.
 *
 * `NOTES_REFSPEC` is what `doctor --fix` writes, but a repository that already
 * fetches `refs/notes/*` — or all of `refs/*` — is equally configured and must
 * not be told it is missing anything.
 */
export declare const coversNotes: (refspec: string) => boolean;
/**
 * Whether a configured refspec would overwrite the local mirror (#417).
 *
 * `coversNotes` asks whether the mirror lands where we read it. This asks
 * whether getting it there may destroy a record on the way.
 */
export declare const forcesNotes: (refspec: string) => boolean;
/**
 * Whether this repository can answer for the notes mirror, and if not, why.
 *
 * Reads local refs and config only — no network, no fetch. Config describes
 * what this clone intends to fetch; it does not prove what a remote advertised.
 * `doctor --fix` records a URL-bound absence observation after its remote probe.
 * Without that observation (including no configured remote), absence is not
 * evidence that there is nothing upstream, so the answer stays incomplete.
 */
export declare const notesAvailability: (opts?: NotesOptions) => NotesAvailability;
