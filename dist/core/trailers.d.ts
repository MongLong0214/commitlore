/**
 * Trailer parsing and canonical serialization (SPEC §2).
 *
 * Parsing is delegated wholesale to `git interpret-trailers --parse`. There is
 * deliberately no regex here that decides what a trailer is: SPEC §2.1 B3
 * (a `Key: value` line followed by prose is *not* a trailer block) is
 * unreproducible by line matching, and getting it wrong manufactures false
 * context for agents.
 */
import { type Trailer } from './types.js';
/**
 * Parses a commit message into its trailers, in the order they appear (B5).
 *
 * A message with no trailer paragraph yields `[]` — that is a commit which
 * recorded nothing, not an error (SPEC §2.1 B7, §4).
 */
export declare const parseCommitMessage: (msg: string) => Trailer[];
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
 */
export declare const parseRecordBlocks: (message: string) => Trailer[][];
