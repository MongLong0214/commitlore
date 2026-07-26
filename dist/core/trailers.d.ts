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
