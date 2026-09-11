/**
 * Trailer parsing and canonical serialization (SPEC §2).
 *
 * Parsing is delegated wholesale to `git interpret-trailers --parse`. There is
 * deliberately no regex here that decides what a trailer is: SPEC §2.1 B3
 * (a `Key: value` line followed by prose is *not* a trailer block) is
 * unreproducible by line matching, and getting it wrong manufactures false
 * context for agents.
 */
import { type ExecGitOptions } from './git.js';
import { type Trailer } from './types.js';
/**
 * `--parse` is `--only-trailers --only-input --unfold`: emit only the trailer
 * block, apply no configured trailer rules, and fold continuations (B4).
 * `--no-divider` keeps a `---` line from being treated as a message divider.
 *
 * `trailer.separators` is pinned because it is repo-configurable and rewrites
 * both what git accepts and how it prints: in a repo with
 * `trailer.separators = "=:"`, `Limit: x` comes back as `Limit= x`. The
 * protocol's separator is `:` (SPEC §2.2 EBNF), so it is fixed here rather
 * than inherited from whatever repo the CLI happens to run in.
 */
export declare const SEPARATOR_PIN: string[];
/**
 * The same parser, reached through `git log` instead of one process per
 * message: `%(trailers)` is `trailer_info_get` over the commit's message with
 * `no_divider` set, which is what `--parse --no-divider` asks of
 * `interpret-trailers`. `only` drops non-trailer lines and `unfold` joins
 * continuations (B4), so a message's own block (B1) comes back byte-equal to
 * `parseCommitMessage` — `test/trailer-atom.test.ts` holds the two to that over
 * this repository's whole history and over the hazard cases the equivalence
 * was doubted on. `core/index-db.ts` has read every record through this atom
 * since the index existed.
 *
 * The separators are bytes a trailer value has no business containing, but git
 * does not escape, so a value that does contain one would split wrong. That is
 * why {@link atomIsAmbiguous} exists: a reader consults it first and pays the
 * process for exactly those messages.
 */
export declare const TRAILERS_ATOM = "%(trailers:only=true,unfold=true,key_value_separator=%x1f,separator=%x1e)";
/** Whether `message` carries a byte the atom uses as a separator, so its atom output cannot be framed. */
export declare const atomIsAmbiguous: (message: string) => boolean;
/** `Key\x1fvalue\x1eKey\x1fvalue` -> trailers, in message order (B5). Empty field, no trailers. */
export declare const parseTrailersAtom: (field: string) => Trailer[];
/**
 * The atom for every commit a `git log` walk visits, in one process: sha ->
 * raw field. `selection` is what follows `log` to choose and order the walk —
 * the same arguments the caller gave the walk that fetched the messages, so
 * the two visit the same shas.
 *
 * A walk that fails answers an empty map. Every message then goes through the
 * process, which is the oracle, so a failure here costs the processes it
 * would have saved and never an answer.
 */
export declare const readTrailersAtom: (selection: readonly string[], opts?: ExecGitOptions) => Map<string, string>;
/**
 * `parseRecordBlocks` with the message's own block taken from the atom when
 * the caller holds one and the message cannot confuse its framing; otherwise
 * exactly `parseRecordBlocks(message)`. The one entry point for a reader that
 * ran {@link readTrailersAtom}, so no reader composes the grammar itself.
 */
export declare const parseRecordBlocksWithAtom: (message: string, atom: string | undefined) => Trailer[][];
/**
 * Parses a commit message into its trailers, in the order they appear (B5).
 *
 * A message with no trailer paragraph yields `[]` — that is a commit which
 * recorded nothing, not an error (SPEC §2.1 B7, §4).
 */
export declare const parseCommitMessage: (msg: string) => Trailer[];
export interface RuledOutValue {
    /** Everything before the first separator, trimmed. */
    alternative: string;
    /** Everything after it, trimmed. Empty only when `malformed`. */
    reason: string;
    /** No separator at all. SPEC §3.1 requires one; `commitlore validate` refuses it. */
    malformed: boolean;
    /**
     * More than one `|`, so the half the parser took as the alternative may not
     * be the half the author meant. Reported, never resolved: nothing in the
     * value says which pipe was the separator.
     */
    ambiguous: boolean;
    /**
     * The alternative half opens a code span that closes after the separator —
     * an odd number of backticks before the first `|`. Unlike `ambiguous` this
     * is not a judgement about intent: the span crosses the separator, so the
     * separator was taken out of quoted text and the alternative is a fragment.
     */
    unterminatedCodeSpan: boolean;
}
/**
 * Splits a `Ruled-out:` value into the alternative and the reason (SPEC §3.1).
 *
 * The **first** `|` separates and there is no escape, so a reason may contain
 * pipes and an alternative may not. Which end to split from was settled by
 * counting this repository's own records rather than by intuition (issue
 * #372): of 620 distinct `Ruled-out:` values, three carry more than one pipe,
 * and two of the three carry it in the reason — `||` in shell prose,
 * `.mjs|.js` in a filename alternation. Splitting on the last pipe would
 * destroy those two to rescue the third, so the first pipe stays the
 * separator and the ambiguity is reported instead.
 *
 * Reporting rather than repairing is the same disposition SPEC §6 takes on
 * every other malformed value: a consumer that guessed would produce an
 * alternative no author wrote, and `commitlore guard` matches on exactly that
 * string.
 */
export declare const splitRuledOut: (value: string) => RuledOutValue;
/**
 * Serializes trailers into the canonical block of SPEC §2.3: one `Key: value`
 * per line, known keys in the vocabulary order of SPEC §3, extension (`X-`)
 * and unrecognized keys after them in their original order, repeats of the
 * same key in their original order (B5), and a trailing newline.
 *
 * Values are expected to be unfolded, as `parseCommitMessage` returns them. A
 * value that still contains newlines is re-folded with two-space continuation
 * lines.
 *
 * Returns `''` for an empty record — a zero-trailer commit has no block.
 */
export declare const serializeTrailers: (trailers: Trailer[]) => string;
/**
 * Parses a message into its record blocks (SPEC §2.4).
 *
 * A record block is a contiguous run of trailer lines terminated by
 * `Record-Id:`. A message MAY carry several — squash-preserve emits one per
 * inherited record (`core/squash.ts`), and GitHub's squash button produces
 * one per original commit whenever it pastes full commit messages into the
 * merge body (the trailer text survives; only recognizing it does not,
 * bug-issue-60).
 *
 * The message's own trailer block — the last paragraph, exactly as B1 defines
 * it — is always one block, with or without a `Record-Id` (SPEC §4 allows
 * omitting it). That is `parseCommitMessage`'s existing, unchanged behavior:
 * this function never overrides what the last paragraph means, which is why a
 * single-record message parses identically to before this function existed —
 * backward compatibility is a property of the grammar, not a special case
 * bolted on top of it. A message with at most one `Record-Id` anywhere always
 * has exactly one block, for the same reason: there is nothing to draw a
 * boundary between.
 *
 * Every OTHER paragraph is a candidate *earlier* block. It is accepted only
 * when, tested on its own (`asIsolatedBlock`), it is entirely trailer-shaped
 * AND it declares a `Record-Id`. The `Record-Id` gate is what keeps an
 * incidental `Key: value`-shaped body paragraph from being promoted into a
 * record it never claimed to be — SPEC §2.1 B2's own worked example
 * (`Context:` / `Source:`, neither in the vocabulary, neither carrying an
 * identity) stays body prose under this function exactly as it does under
 * `parseCommitMessage` alone. Every paragraph is tested, not just the ones
 * contiguous with the tail: GitHub interleaves each squashed commit's own
 * subject line between trailer blocks, and a contiguous walk from the end
 * would stop at the first one and miss everything earlier.
 *
 * Returned in the order the blocks appear in the message.
 *
 * `opts.last` is the message's own block when the caller already holds it —
 * read from {@link TRAILERS_ATOM} in the `git log` that fetched the message,
 * one process for the walk instead of one per commit. It replaces only where
 * the last block's bytes come from; which paragraphs are tested, and whether
 * the result is accepted, is decided here for every caller alike, so a reader
 * with the atom and a reader without it compose the grammar in one place.
 */
export declare const parseRecordBlocks: (message: string, opts?: {
    last?: Trailer[];
}) => Trailer[][];
/** One block from `parseRecordBlocks`, labeled for display (`commitlore parse`). */
export interface LabeledBlock {
    /** Whether this is the message's own trailer block (the last paragraph, SPEC §2.1 B1) rather than an earlier one the grammar recovered (SPEC §2.4). */
    own: boolean;
    /** This block's `Record-Id` is also declared by another block in the same message. */
    identityCollision: boolean;
    trailers: Trailer[];
}
/**
 * `parseRecordBlocks`, labeled with which block is the message's own and
 * whether any block's `Record-Id` collides with another block's, both in the
 * same message.
 *
 * The collision check here is deliberately local to one message. It is not
 * `core/stale.ts` `findIdCollisions`: that function's job is detecting drift
 * between a notes mirror and the commit it mirrors, so a group with no
 * `notes`-sourced record in it never trips it — two commit-sourced blocks
 * that declare the same `Record-Id` inside one message pass through it
 * unflagged (confirmed by `commitlore context` and `commitlore validate`,
 * neither of which reports one either; bug-issue-89). Whether that identity
 * later collides with something elsewhere in the repository is a question
 * only `context`/`validate` can answer, because it needs the rest of
 * history; whether two blocks *in the message being written right now*
 * already collide needs none of that, and is exactly what someone running
 * `commitlore parse` on a draft message before committing it wants to know.
 */
export declare const labelRecordBlocks: (message: string) => LabeledBlock[];
