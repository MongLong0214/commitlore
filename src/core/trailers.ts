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
import { KNOWN_KEYS, type Trailer } from './types.js';

const RECORD_ID_KEY = 'Record-Id';

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

/** Loose on purpose: see `parseRecordBlocks`. */
const MENTIONS_RECORD_ID = /record-id/i;

/** Continuation lines in a canonical block are indented by two spaces (SPEC §2.3). */
const CONTINUATION_INDENT = '  ';

/**
 * Parses one `git interpret-trailers --parse` output line. git normalizes
 * every trailer to `Key: value` (B6), emitting a trailing space for an empty
 * value; the `Key:` form is tolerated defensively.
 */
const parseOutputLine = (line: string): Trailer => {
  const separator = line.indexOf(': ');
  if (separator !== -1) {
    return { key: line.slice(0, separator), value: line.slice(separator + 2) };
  }
  if (line.endsWith(':')) {
    return { key: line.slice(0, -1), value: '' };
  }
  throw new Error(
    `git interpret-trailers emitted an unparseable line: ${JSON.stringify(line)}`,
  );
};

/**
 * Parses a commit message into its trailers, in the order they appear (B5).
 *
 * A message with no trailer paragraph yields `[]` — that is a commit which
 * recorded nothing, not an error (SPEC §2.1 B7, §4).
 */
export const parseCommitMessage = (msg: string): Trailer[] => {
  const stdout = execGitOrThrow(PARSE_ARGS, { stdin: msg });
  return stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map(parseOutputLine);
};

/** SPEC §3.1: `Ruled-out: alternative | reason`. */
const RULED_OUT_SEPARATOR = '|';

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
export const splitRuledOut = (value: string): RuledOutValue => {
  const at = value.indexOf(RULED_OUT_SEPARATOR);
  const head = at === -1 ? value : value.slice(0, at);
  return {
    alternative: head.trim(),
    reason: at === -1 ? '' : value.slice(at + 1).trim(),
    malformed: at === -1,
    ambiguous: at !== -1 && value.includes(RULED_OUT_SEPARATOR, at + 1),
    unterminatedCodeSpan: at !== -1 && (head.match(/`/g) ?? []).length % 2 === 1,
  };
};

const serializeOne = (trailer: Trailer): string => {
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
export const serializeTrailers = (trailers: Trailer[]): string => {
  const known = new Set<string>(KNOWN_KEYS);
  const ordered: Trailer[] = [];

  for (const key of KNOWN_KEYS) {
    for (const trailer of trailers) {
      if (trailer.key === key) ordered.push(trailer);
    }
  }
  for (const trailer of trailers) {
    if (!known.has(trailer.key)) ordered.push(trailer);
  }

  return ordered.map(serializeOne).join('');
};

// ---------------------------------------------------------------------------
// Multi-record grammar (SPEC §2.4, bug-issue-60)
// ---------------------------------------------------------------------------

/**
 * A message's paragraphs, in order: maximal runs of non-blank lines,
 * separated by one or more fully blank lines (SPEC §2.2's `blank = LF, LF`).
 * This decides nothing about trailers — it is the same paragraph boundary
 * B1/B2 already rely on, made explicit so it can be walked.
 */
const splitParagraphs = (message: string): string[] =>
  message
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .filter((paragraph) => paragraph.trim() !== '');

/**
 * Whether `paragraph`, taken on its own, is entirely a trailer block.
 *
 * Delegates to `parseCommitMessage` under a synthetic one-line subject, which
 * makes `paragraph` the last (and only) paragraph of a two-paragraph message —
 * exactly the shape B1 already judges. No line is ever classified by matching
 * a regex against it; git decides, the same as everywhere else in this module
 * (SPEC §2.1 B3).
 */
const asIsolatedBlock = (paragraph: string): Trailer[] =>
  parseCommitMessage(`x\n\n${paragraph}`);

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
export const parseRecordBlocks = (message: string): Trailer[][] => {
  const last = parseCommitMessage(message);
  const paragraphs = splitParagraphs(message);
  const earlier = paragraphs.slice(0, -1);

  const extra: Trailer[][] = [];
  for (const paragraph of earlier) {
    // The `Record-Id` test used to run *after* `asIsolatedBlock`, so every
    // earlier paragraph paid a `git interpret-trailers` process to be told no
    // and have its answer discarded. On this repository that was 3900 spawns
    // to keep 33 blocks, and it is most of what made a rebuild take 23s.
    //
    // Checking the raw text first cannot skip a block the parse would have
    // kept: a trailer key is always at the start of a line in the source, and
    // folding continues *values*, so a paragraph whose text does not mention
    // the key at all cannot yield a trailer that has it. The match is
    // deliberately loose -- case-insensitive, unanchored -- because being
    // wrong in the direction of one extra parse costs 8ms and being wrong the
    // other way loses a record.
    if (!MENTIONS_RECORD_ID.test(paragraph)) continue;
    const candidate = asIsolatedBlock(paragraph);
    if (candidate.length === 0) continue;
    if (!candidate.some((trailer) => trailer.key === RECORD_ID_KEY)) continue;
    extra.push(candidate);
  }

  return last.length === 0 ? extra : [...extra, last];
};

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
export const labelRecordBlocks = (message: string): LabeledBlock[] => {
  const blocks = parseRecordBlocks(message);
  const ids = blocks.map(
    (block) => block.find((trailer) => trailer.key === RECORD_ID_KEY)?.value,
  );

  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const id of ids) {
    if (id === undefined) continue;
    if (seen.has(id)) duplicated.add(id);
    seen.add(id);
  }

  return blocks.map((trailers, index) => {
    const id = ids[index];
    return {
      own: index === blocks.length - 1,
      identityCollision: id !== undefined && duplicated.has(id),
      trailers,
    };
  });
};
