/**
 * Trailer parsing and canonical serialization (SPEC §2).
 *
 * Parsing is delegated wholesale to `git interpret-trailers --parse`. There is
 * deliberately no regex here that decides what a trailer is: SPEC §2.1 B3
 * (a `Key: value` line followed by prose is *not* a trailer block) is
 * unreproducible by line matching, and getting it wrong manufactures false
 * context for agents.
 */
import { execGitOrThrow } from './git.js';
import { KNOWN_KEYS } from './types.js';
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
const PARSE_ARGS = [
    '-c',
    'trailer.separators=:',
    'interpret-trailers',
    '--parse',
    '--no-divider',
];
/** Continuation lines in a canonical block are indented by two spaces (SPEC §2.3). */
const CONTINUATION_INDENT = '  ';
/**
 * Parses one `git interpret-trailers --parse` output line. git normalizes
 * every trailer to `Key: value` (B6), emitting a trailing space for an empty
 * value; the `Key:` form is tolerated defensively.
 */
const parseOutputLine = (line) => {
    const separator = line.indexOf(': ');
    if (separator !== -1) {
        return { key: line.slice(0, separator), value: line.slice(separator + 2) };
    }
    if (line.endsWith(':')) {
        return { key: line.slice(0, -1), value: '' };
    }
    throw new Error(`git interpret-trailers emitted an unparseable line: ${JSON.stringify(line)}`);
};
/**
 * Parses a commit message into its trailers, in the order they appear (B5).
 *
 * A message with no trailer paragraph yields `[]` — that is a commit which
 * recorded nothing, not an error (SPEC §2.1 B7, §4).
 */
export const parseCommitMessage = (msg) => {
    const stdout = execGitOrThrow(PARSE_ARGS, { stdin: msg });
    return stdout
        .split('\n')
        .filter((line) => line.length > 0)
        .map(parseOutputLine);
};
const serializeOne = (trailer) => {
    const [first = '', ...continuations] = trailer.value.split('\n');
    const lines = [
        `${trailer.key}: ${first}`,
        ...continuations.map((line) => `${CONTINUATION_INDENT}${line.trim()}`),
    ];
    return `${lines.join('\n')}\n`;
};
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
export const serializeTrailers = (trailers) => {
    const known = new Set(KNOWN_KEYS);
    const ordered = [];
    for (const key of KNOWN_KEYS) {
        for (const trailer of trailers) {
            if (trailer.key === key)
                ordered.push(trailer);
        }
    }
    for (const trailer of trailers) {
        if (!known.has(trailer.key))
            ordered.push(trailer);
    }
    return ordered.map(serializeOne).join('');
};
//# sourceMappingURL=trailers.js.map