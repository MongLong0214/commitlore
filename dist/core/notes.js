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
import { execGit, execGitOrThrow } from './git.js';
import { parseCommitMessage, parseRecordBlocks, serializeTrailers } from './trailers.js';
/** The mirror's ref. Not configurable: it is part of the protocol (SPEC §1). */
export const NOTES_REF = 'refs/notes/commitlore';
/**
 * The fetch refspec a clone needs before it can see anyone else's records.
 * `git fetch` does not fetch notes by default, so a fresh clone reads an empty
 * mirror until this is configured — `commitlore doctor --fix` adds it.
 */
export const NOTES_REFSPEC = '+refs/notes/*:refs/notes/*';
/** `git notes --ref=` accepts a full ref; passing it avoids any expansion. */
const REF_ARG = `--ref=${NOTES_REF}`;
/**
 * `git notes show` reports "no note for this object" with exit 1 and dies with
 * 128 for everything else (bad repo, unreadable ref). The code is the
 * discriminator rather than the stderr text, which git translates.
 */
const NO_NOTE_EXIT = 1;
/**
 * A note body is a bare trailer block, but `git interpret-trailers --parse`
 * reads the first paragraph of its input as the subject and would return
 * nothing for one. The block is parsed as the last paragraph of a synthetic
 * message; the subject itself never appears in the output.
 */
const SYNTHETIC_SUBJECT = 'commitlore notes mirror';
const gitOptions = (opts, stdin) => ({
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    ...(stdin === undefined ? {} : { stdin }),
});
/**
 * Resolves `sha` to a full object name, throwing if it names nothing in this
 * repository. Every entry point resolves first, so a typo'd or absent object
 * fails loudly instead of being reported as "this commit has no record", and
 * so no caller-supplied string is ever passed to git where it could be read as
 * an option (`--end-of-options` covers the resolve itself).
 */
const resolveObject = (sha, opts) => execGitOrThrow(['rev-parse', '--verify', '--end-of-options', `${sha}^{object}`], gitOptions(opts)).trim();
/** Writes `body` as the note on `sha`, sharing the add/force/error plumbing every writer needs. */
const writeBody = (sha, body, opts) => {
    if (body === '') {
        throw new Error(`refusing to write an empty record to ${NOTES_REF} for ${sha}: an empty note body deletes the note`);
    }
    const object = resolveObject(sha, opts);
    const args = ['notes', REF_ARG, 'add'];
    if (opts.force === true)
        args.push('--force');
    args.push('--file', '-', '--end-of-options', object);
    const result = execGit(args, gitOptions(opts, body));
    if (result.code !== 0) {
        throw Object.assign(new Error(`failed to write the record for ${object} to ${NOTES_REF} (exit ${result.code}): ${result.stderr.trim()}`), { code: result.code, stderr: result.stderr });
    }
};
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
export const writeRecord = (sha, trailers, opts = {}) => writeBody(sha, serializeTrailers(trailers), opts);
/**
 * Attaches several record blocks to `sha` in one note (SPEC §2.4) — each
 * block its own canonical trailer paragraph, blank-line separated, so a
 * `parseRecordBlocks` read (`readRecordBlocks` below, and `core/index-db.ts`)
 * recovers every one of them individually rather than folding them back into
 * one flat trailer list. `writeRecord` cannot do this: it calls
 * `serializeTrailers` once over the whole array, which reorders into SPEC §3
 * vocabulary order and would scramble two blocks' trailers together.
 */
export const writeRecordBlocks = (sha, blocks, opts = {}) => writeBody(sha, blocks.map(serializeTrailers).join('\n'), opts);
/** The raw note body on `sha`, or `null` when the object carries none. */
const showNote = (sha, opts) => {
    const object = resolveObject(sha, opts);
    const result = execGit(['notes', REF_ARG, 'show', '--end-of-options', object], gitOptions(opts));
    if (result.code === NO_NOTE_EXIT)
        return null;
    if (result.code !== 0) {
        throw Object.assign(new Error(`failed to read the record for ${object} from ${NOTES_REF} (exit ${result.code}): ${result.stderr.trim()}`), { code: result.code, stderr: result.stderr });
    }
    return result.stdout;
};
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
export const readRecord = (sha, opts = {}) => {
    const note = showNote(sha, opts);
    return note === null ? [] : parseCommitMessage(`${SYNTHETIC_SUBJECT}\n\n${note}`);
};
/**
 * Reads every record block mirrored for `sha` (SPEC §2.4), or `[]` when the
 * object carries no note. Unlike `readRecord`, a note squash-preserve wrote
 * with `writeRecordBlocks` comes back as one array per block rather than
 * folded flat.
 */
export const readRecordBlocks = (sha, opts = {}) => {
    const note = showNote(sha, opts);
    return note === null ? [] : parseRecordBlocks(`${SYNTHETIC_SUBJECT}\n\n${note}`);
};
/**
 * Every object name that carries a note, in `git notes list` order.
 *
 * A repository whose mirror has never been written, or one that has not
 * fetched it yet, has no such ref — that yields `[]`, not an error.
 */
export const listRecordShas = (opts = {}) => {
    const stdout = execGitOrThrow(['notes', REF_ARG, 'list'], gitOptions(opts));
    return stdout
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
        // `<note object> <annotated object>` — the second column is the commit.
        const [, object = ''] = line.split(' ');
        return object;
    })
        .filter((object) => object.length > 0);
};
export const listRemotes = (opts) => {
    const result = execGit(['remote'], gitOptions(opts));
    if (result.code !== 0)
        return [];
    return result.stdout.split('\n').filter((line) => line.length > 0);
};
export const fetchRefspecs = (remote, opts) => {
    // Exit 1 means "key not set", which is an answer, not a failure.
    const result = execGit(['config', '--get-all', `remote.${remote}.fetch`], gitOptions(opts));
    if (result.code !== 0)
        return [];
    return result.stdout.split('\n').filter((line) => line.length > 0);
};
/**
 * Whether a configured refspec lands the mirror where we read it.
 *
 * `NOTES_REFSPEC` is what `doctor --fix` writes, but a repository that already
 * fetches `refs/notes/*` — or all of `refs/*` — is equally configured and must
 * not be told it is missing anything.
 */
export const coversNotes = (refspec) => {
    const [, destination = ''] = refspec.replace(/^\+/, '').split(':');
    if (destination === NOTES_REF)
        return true;
    return destination.endsWith('/*') && NOTES_REF.startsWith(destination.slice(0, -1));
};
/**
 * Whether this repository can answer for the notes mirror, and if not, why.
 *
 * Reads git config only — no network, no fetch. A repository with no remote at
 * all reports `absent`: there is nowhere for unseen records to be, so an empty
 * answer is a true empty.
 *
 * A remote plus no local notes ref is `unfetched`, and the refspec does not
 * change that. It used to: a repository whose refspec covered notes but had
 * never fetched them reported `absent`, which is the state `doctor --fix`
 * creates — it writes the refspec and fetches nothing. So the remedy this tool
 * prescribes turned an honest "records may exist upstream" into a confident
 * "this repository has none", while the records stayed exactly as invisible.
 * The warning disappeared and the cause did not, which is the failure shape
 * #296 already cost this project once.
 *
 * Whether a refspec covers notes is still worth reporting — it decides whether
 * a fetch would help — but it is a separate question from whether an empty
 * answer can be trusted, and only the second one belongs here.
 */
export const notesAvailability = (opts = {}) => {
    const ref = execGit(['rev-parse', '--verify', '--quiet', NOTES_REF], gitOptions(opts));
    if (ref.code === 0)
        return 'present';
    return listRemotes(opts).length === 0 ? 'absent' : 'unfetched';
};
//# sourceMappingURL=notes.js.map