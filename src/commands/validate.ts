/**
 * `commitlore validate` — machine refusal of malformed records (SPEC §6).
 *
 * Three contracts hold this command in place, because a hook and a CI job both
 * branch on them (SPEC §10):
 *
 *   exit 0  no violations
 *   exit 1  violations found
 *   exit 2  usage or input error (bad flags, unreadable file, unknown revision)
 *
 * 1 must mean "the record is wrong" and nothing else, so an unreadable
 * `--message-file` is 2, not 1 — otherwise a broken invocation reads as a
 * rejected commit.
 *
 * The command never edits its input (SPEC §6: implementations MUST NOT silently
 * repair). It reads, reports, and exits.
 *
 * Shape checks run for every input. Reference checks additionally run when the
 * input mode identifies a repository.
 */

import { readFileSync } from 'node:fs';

import type { Command } from 'commander';

import { collectRecords } from './stale.js';
import { execGit, hasShallowHistory } from '../core/git.js';
import { closeIndex, ensureIndex, indexUnread, queryTrailers } from '../core/index-db.js';
import { notesAvailability } from '../core/notes.js';
import { isMissingInstalledFile } from '../core/paths.js';
import { CONSUMER_SCAN_BUDGET_MS, RULED_OUT_KEY } from '../core/query.js';
import { validateRecord } from '../core/schema.js';
import {
  findDanglingRefs,
  findIdCollisions,
  isSuccessionDeclared,
  UNIQUE_ID_WANT,
  type StaleRecord,
} from '../core/stale.js';
import {
  labelRecordBlocks,
  parseCommitMessage,
  parseRecordBlocks,
  splitRuledOut,
} from '../core/trailers.js';
import { KNOWN_KEYS, SINGLE_VALUED, type Trailer, type Violation } from '../core/types.js';
import { scanForSecrets, formatFindings, type SecretFinding } from '../core/secret-guard.js';

/**
 * A violation plus where it was found. `line` is 1-based and counts lines of
 * the original message, because the repair loop moves an editor cursor by it.
 * Both fields are omitted rather than guessed when they cannot be established
 * (see `locateTrailerLines` and `lineForViolation`).
 */
export interface LocatedViolation extends Violation {
  sha?: string;
  line?: number;
}

export interface ValidateInput {
  messageFile?: string;
  commit?: string;
  range?: string;
  json?: boolean;
  cwd?: string;
  /** Injectable so tests never depend on the process's real stdin. */
  readStdin?: () => string;
  /**
   * Wall-clock ceiling on a cold index build. The commit-msg hook passes
   * `CONSUMER_SCAN_BUDGET_MS`; tests inject a spent budget or a fake clock.
   */
  scanBudgetMs?: number;
  /** The clock `scanBudgetMs` is read against. Defaults to `Date.now`. */
  scanNow?: () => number;
}

/** Exit code, plus the streams the caller writes. Returned rather than printed so tests can drive the command in-process. */
export interface ValidateResult {
  /** 0 clean, 1 violations, 2 usage, 3 broken installation (#533). */
  code: 0 | 1 | 2 | 3;
  stdout: string;
  stderr: string;
  violations: LocatedViolation[];
  /**
   * Credentials found in the message. Separate from `violations` because they
   * are not a protocol violation -- the record can be perfectly well-formed and
   * still be inscribing a secret into history permanently (ADR-0005).
   */
  secrets: SecretFinding[];
  checks: ValidationCheck[];
}

export const CHECK_CLASS_NEEDS = {
  shape: 'message',
  reference: 'repository',
  conservation: 'before and after',
} as const;

export type CheckClass = keyof typeof CHECK_CLASS_NEEDS;
export type CheckStatus = 'ok' | 'failed' | 'not-checked';

export interface ValidationCheck {
  class: Exclude<CheckClass, 'conservation'>;
  status: CheckStatus;
  reason?: string;
}

/** One commit message to check, with its sha when the input mode knows one. */
interface MessageSource {
  sha?: string;
  message: string;
}

const USAGE =
  'usage: commitlore validate [--message-file <file> | --commit <sha> | --range <a>..<b>] [--json]';

const MODE_FLAGS = {
  messageFile: '--message-file',
  commit: '--commit',
  range: '--range',
} as const;

type ModeKey = keyof typeof MODE_FLAGS;

const MODE_KEYS: ModeKey[] = ['messageFile', 'commit', 'range'];

const usageError = (message: string): ValidateResult => ({
  code: 2,
  stdout: '',
  stderr: `commitlore: ${message}\n${USAGE}\n`,
  violations: [],
  secrets: [],
  checks: [],
});

/**
 * Exit 3 for an operational failure, distinct from 2 for a usage error.
 *
 * This is the first of the codes #543 asks for, taken here because #533 is
 * where the conflation actually reaches a user. The rest of that taxonomy —
 * NoRecord, RecordRejected, InternalError, shared across the CLI, the hooks
 * and the MCP server — is still open.
 */
const installationError = (message: string): ValidateResult => ({
  code: 3,
  stdout: '',
  stderr: `commitlore: ${message}\n`,
  violations: [],
  secrets: [],
  checks: [],
});

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const firstLine = (text: string): string => (text.trim().split('\n')[0] ?? '').trim();

/** Git may hand back CRLF; git's own trailer values never carry the CR. */
const stripCr = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line);

/** Continuation lines begin with whitespace and fold into the previous value (SPEC §2.1 B4). */
const CONTINUATION = /^[ \t]/;

const LEADING_WHITESPACE = /^[ \t]+/;

/**
 * `git interpret-trailers` skips comment lines, so a message straight out of
 * `.git/COMMIT_EDITMSG` can have them interleaved with trailers.
 */
const isComment = (line: string): boolean => line.startsWith('#');

/**
 * Matches the subject line `git merge` and GitHub's PR-merge button write on
 * their own, never something a person typed as a trailer.
 *
 * This is text, not `git log --format=%P` parent-counting (bug-issue-90): SPEC
 * §6.1 defines Shape as needing "the message alone" and running "anywhere,
 * including stdin," so whether a paragraph is platform-generated prose cannot
 * depend on repository state a `--message-file`/stdin caller never has —
 * otherwise the same message gets a different Shape verdict depending on how
 * it arrived, which is the defect this pattern replaces. The subject line
 * itself is exactly the signal available in every input mode alike.
 */
const MERGE_TITLE =
  /^Merge (pull request #\d+ from \S+|branch '[^']+'|remote-tracking branch '[^']+'|tag '[^']+')(?: into \S+)?$/;

const looksLikeMergeTitle = (message: string): boolean => MERGE_TITLE.test(firstLine(message));

/**
 * Tries to read `trailers` off `lines` starting at `start`, reproducing git's
 * unfold (value, then each continuation appended after a single space) and
 * comparing the result to what git actually returned.
 *
 * Returns the 1-based start line of each trailer, or null if the lines at
 * `start` are not exactly this trailer list. The value comparison is what makes
 * this safe: a shape that merely looks like the block is rejected.
 */
const matchTrailersAt = (lines: string[], start: number, trailers: Trailer[]): number[] | null => {
  const found: number[] = [];
  let cursor = start;

  for (const trailer of trailers) {
    while (cursor < lines.length && isComment(lines[cursor] ?? '')) cursor += 1;

    const line = lines[cursor];
    const prefix = `${trailer.key}:`;
    if (line === undefined || !line.startsWith(prefix)) return null;

    let value = line.slice(prefix.length).replace(LEADING_WHITESPACE, '');
    found.push(cursor + 1);
    cursor += 1;

    while (cursor < lines.length && CONTINUATION.test(lines[cursor] ?? '')) {
      value += ` ${(lines[cursor] ?? '').replace(LEADING_WHITESPACE, '')}`;
      cursor += 1;
    }

    if (value !== trailer.value) return null;
  }

  return found;
};

/**
 * Maps each trailer git returned to its 1-based line in the original message.
 *
 * This does not decide what a trailer is — git already did that, and SPEC §2.1
 * B3 exists to forbid re-deciding it by line matching. It only asks where the
 * block git found begins, by scanning candidate starts from the end of the
 * message (the trailer block is the last paragraph, B1/B2) and accepting the
 * first candidate whose unfolded values reproduce git's output exactly.
 *
 * Returns all-undefined when no candidate reproduces the parse, so a caller
 * emits no line rather than a guessed one.
 */
const locateTrailerLines = (message: string, trailers: Trailer[]): (number | undefined)[] => {
  if (trailers.length === 0) return [];

  const lines = message.split('\n').map(stripCr);
  for (let start = lines.length - 1; start >= 0; start -= 1) {
    const matched = matchTrailersAt(lines, start, trailers);
    if (matched !== null) return matched;
  }
  return trailers.map(() => undefined);
};

interface UnparsedTrailerWarning {
  line: number;
  key: string;
  tabIndented: boolean;
}

const knownTrailerCandidate = (
  line: string,
): Pick<UnparsedTrailerWarning, 'key' | 'tabIndented'> | undefined => {
  const tabIndented = line.startsWith('\t');
  const candidate = tabIndented ? line.replace(/^\t+/, '') : line;
  const key = KNOWN_KEYS.find((known) => candidate.startsWith(`${known}: `));
  return key === undefined ? undefined : { key, tabIndented };
};

const locateUnparsedTrailerWarnings = (
  message: string,
  blocks: readonly Trailer[][],
): UnparsedTrailerWarning[] => {
  const lines = message.split('\n').map(stripCr);
  const contentLines = lines.filter((line) => line !== '' && !isComment(line));
  if (
    contentLines.length > 0 &&
    contentLines.every((line) => knownTrailerCandidate(line) !== undefined)
  ) {
    return [];
  }

  // A line already accounted for by any recovered block (SPEC §2.4) is not an
  // unparsed one, even when that block sits earlier than the message's own
  // last paragraph.
  const parsedLines = new Set(blocks.flatMap((block) => locateTrailerLines(message, block)));
  return lines.flatMap((line, index) => {
    const candidate = knownTrailerCandidate(line);
    if (candidate === undefined || parsedLines.has(index + 1)) return [];
    return [{ line: index + 1, ...candidate }];
  });
};

/**
 * Finds which trailer a violation came from, so it can carry that trailer's
 * line. `validateRecord` reports the rule, not the position, and the mapping
 * back is only unambiguous in two shapes:
 *
 * - `cardinality`: `got` is the occurrence number of that key, which names the
 *   exact trailer.
 * - everything else: a single trailer matches the reported key and value.
 *
 * Two byte-identical trailers therefore yield no line. That is the correct
 * answer — any number picked between them would be invented.
 */
const lineForViolation = (
  violation: Violation,
  trailers: Trailer[],
  lines: (number | undefined)[],
): number | undefined => {
  const indexesWithKey = trailers.flatMap((trailer, index) =>
    trailer.key === violation.key ? [index] : [],
  );

  if (violation.rule === 'cardinality' && SINGLE_VALUED.has(violation.key)) {
    const occurrence = Number(violation.got);
    if (!Number.isInteger(occurrence)) return undefined;
    const index = indexesWithKey[occurrence - 1];
    if (index === undefined || trailers[index]?.value !== violation.value) return undefined;
    return lines[index];
  }

  const matches = indexesWithKey.filter((index) => trailers[index]?.value === violation.value);
  const only = matches.length === 1 ? matches[0] : undefined;
  return only === undefined ? undefined : lines[only];
};

/**
 * Validates one recovered block (SPEC §2.4) against its own line positions,
 * shaped the same way `LocatedViolation` is everywhere else.
 */
const violationsForBlock = (source: MessageSource, trailers: Trailer[]): LocatedViolation[] => {
  const lines = locateTrailerLines(source.message, trailers);
  return validateRecord(trailers).map((violation) => {
    const line = lineForViolation(violation, trailers, lines);
    return {
      ...(source.sha === undefined ? {} : { sha: source.sha }),
      ...(line === undefined ? {} : { line }),
      ...violation,
    };
  });
};

/**
 * A `Record-Id` declared by more than one block of the *same* message (SPEC
 * §2.4) is shape-only information: `commitlore parse`'s `labelRecordBlocks`
 * (`core/trailers.ts`) already computes it from the message alone, on every
 * block, via its `identityCollision` flag. This calls that computation
 * directly rather than re-deriving "do two blocks in this message declare the
 * same id" a second way — a second detector for the same rule is how the two
 * commands read the same message differently (bug-issue-145).
 *
 * Scoped to sources with no resolved `sha`: once a commit is known,
 * `checkReferences` below already reports the identical collision through
 * `findIdCollisions`'s same-commit branch, complete with its own line
 * attribution (bug-issue-92) — running this too would report the same
 * collision twice for the same commit.
 *
 * For a `--message-file`/stdin source — what a commit-msg hook always hands
 * `validate`, and the shape SPEC §6.1 requires working from "the message
 * alone" — this is the detector that always runs, since `checkReferences`
 * needs a repository and answers `not-checked` on stdin, outside one, or with
 * the notes mirror unfetched. It is not the only one that can run, though:
 * `findIdCollisions` also groups such a message's blocks as two
 * commit-sourced records and reports the collision, a branch that needs no
 * shared `sha` at all. That overlap is why `runValidate` drops a reference
 * violation identical to one already reported here (bug-issue-365), rather
 * than either side of it standing down.
 */
const identityCollisionViolations = (source: MessageSource): LocatedViolation[] => {
  if (source.sha !== undefined) return [];

  return labelRecordBlocks(source.message).flatMap((block) => {
    if (!block.identityCollision) return [];
    const id = block.trailers.find((trailer) => trailer.key === 'Record-Id')?.value;
    if (id === undefined) return [];

    const lines = locateTrailerLines(source.message, block.trailers);
    const index = block.trailers.findIndex((trailer) => trailer.key === 'Record-Id');
    const line = lines[index];

    return [
      {
        ...(line === undefined ? {} : { line }),
        key: 'Record-Id',
        value: id,
        rule: 'duplicate-id' as const,
        got: id,
        want: UNIQUE_ID_WANT,
      },
    ];
  });
};

/**
 * The half of issue #372 that cannot be a violation.
 *
 * A `Ruled-out:` value carrying a second `|` may be split in the wrong place —
 * the alternative the record rules out is then a fragment, `commitlore guard`
 * matches the fragment instead of the alternative, and nothing in the output
 * says so. Refusing every such value was measured against this repository's
 * own history first: of 620 distinct `Ruled-out:` values, three carry more
 * than one pipe and two of those three are *correct*, their extra pipe living
 * in the reason (`||`, `.mjs|.js`). Rejecting the class would invalidate two
 * well-formed records to catch one broken one.
 *
 * So it warns, and the warning quotes the alternative the split produced —
 * the author is the only party who can tell whether that is the one they
 * meant, and the commit-msg hook is the last moment they can still fix it.
 * The subset that *is* provably wrong (a code span the separator cut open) is
 * a `format` violation and is skipped here so it is not reported twice.
 */
const ambiguousSeparatorWarnings = (
  source: MessageSource,
  trailers: readonly Trailer[],
  lines: readonly (number | undefined)[],
): string[] =>
  trailers.flatMap((trailer, index) => {
    if (trailer.key !== RULED_OUT_KEY) return [];
    const split = splitRuledOut(trailer.value);
    if (!split.ambiguous || split.unterminatedCodeSpan) return [];
    const at = lines[index];
    const where = `${source.sha?.slice(0, 10) ?? 'commit'}${at === undefined ? '' : `:${at}`}`;
    return [
      `commitlore: ${where}: Ruled-out: has more than one "|" and there is no escape, so the ` +
        `first one separates: alternative ${JSON.stringify(split.alternative)}. If that is not ` +
        'the split you meant, rephrase so only the separator is a pipe (SPEC §3.1)',
    ];
  });

/**
 * Validates every record block a message carries (SPEC §2.4), not only the
 * one git recognizes as the message's own last paragraph.
 *
 * The message's own last paragraph keeps its existing, unchanged treatment:
 * `nonTrailerParagraph` still exists to tell "a real trailer block with a bad
 * key" from "GitHub wrote a PR title here and it happens to contain a colon"
 * (bug-issue-76) — a merge commit's platform-generated last paragraph is not
 * additionally re-checked as if it declared a `Record-Id`, because it never
 * claims to be a record at all. The merge subject is recognized from
 * `source.message` itself (`looksLikeMergeTitle`), not from the repository,
 * so this excuse applies the same way to every input mode (bug-issue-90).
 *
 * Earlier blocks the multi-record grammar recovers do not get that special
 * case: `parseRecordBlocks` only accepts one when it is entirely
 * trailer-shaped and declares an identity, so an earlier block reaching this
 * function has already committed to being a record. A malformed one is
 * reported as such rather than silently excused.
 */
const inspectSource = (
  source: MessageSource,
): { violations: LocatedViolation[]; warnings: string[] } => {
  const trailers = parseCommitMessage(source.message);
  const blocks = parseRecordBlocks(source.message);
  const earlierBlocks = trailers.length === 0 ? blocks : blocks.slice(0, -1);

  const lines = locateTrailerLines(source.message, trailers);
  const rawViolations = validateRecord(trailers);
  const firstTrailerLine = lines[0];
  const nonTrailerParagraph =
    looksLikeMergeTitle(source.message) &&
    firstTrailerLine !== undefined &&
    rawViolations.length > 0 &&
    rawViolations.length === trailers.length &&
    rawViolations.every((violation) => violation.rule === 'unknown-key')
      ? source.message
          .split('\n')
          .map(stripCr)
          .slice(firstTrailerLine - 1)
          .filter((line) => line !== '')
          .join('\n')
      : undefined;

  const lastViolations = (nonTrailerParagraph === undefined ? rawViolations : []).map(
    (violation) => {
      const line = lineForViolation(violation, trailers, lines);
      return {
        ...(source.sha === undefined ? {} : { sha: source.sha }),
        ...(line === undefined ? {} : { line }),
        ...violation,
      };
    },
  );
  const earlierViolations = earlierBlocks.flatMap((block) => violationsForBlock(source, block));
  // A same-message Record-Id collision is reported before any other shape
  // finding, the same way `commitlore parse` surfaces it on stderr ahead of
  // the parsed blocks — it is the fact most likely to explain the others.
  const violations = [
    ...identityCollisionViolations(source),
    ...earlierViolations,
    ...lastViolations,
  ];

  const warnings = locateUnparsedTrailerWarnings(source.message, blocks).map((warning) =>
    warning.tabIndented
      ? `commitlore: line ${warning.line} looks like a ${warning.key} trailer, but git did not parse it; remove the leading tab`
      : `commitlore: line ${warning.line} looks like a ${warning.key} trailer, but git did not parse it; the trailer block needs a blank line before it`,
  );
  if (nonTrailerParagraph !== undefined) {
    warnings.push(
      `commitlore: ${source.sha?.slice(0, 10) ?? 'commit'}:${firstTrailerLine}: final paragraph does not look like a CommitLore trailer block; saw ${JSON.stringify(nonTrailerParagraph)}`,
    );
  }
  warnings.push(...ambiguousSeparatorWarnings(source, trailers, lines));

  return { violations, warnings };
};

const locateReferenceViolations = (
  source: MessageSource,
  trailers: Trailer[],
  violations: Violation[],
): LocatedViolation[] => {
  const lines = locateTrailerLines(source.message, trailers);
  return violations.map((violation) => {
    const line = lineForViolation(violation, trailers, lines);
    return {
      ...(source.sha === undefined ? {} : { sha: source.sha }),
      ...(line === undefined ? {} : { line }),
      ...violation,
    };
  });
};

/** Resolves a revision to a full sha so the reported `sha` is unambiguous. */
const resolveCommit = (ref: string, cwd: string): string => {
  const result = execGit(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd });
  if (result.code !== 0) {
    throw new Error(`cannot resolve commit ${JSON.stringify(ref)}: ${firstLine(result.stderr)}`);
  }
  return result.stdout.trim();
};

const readCommitSource = (sha: string, cwd: string): MessageSource => {
  const result = execGit(['log', '-1', '--format=%B', sha, '--'], { cwd });
  if (result.code !== 0) {
    throw new Error(`cannot read commit ${sha}: ${firstLine(result.stderr)}`);
  }
  return { sha, message: result.stdout };
};

const readRange = (range: string, cwd: string): MessageSource[] => {
  const result = execGit(['rev-list', '--reverse', '--end-of-options', range, '--'], { cwd });
  if (result.code !== 0) {
    throw new Error(`cannot walk range ${JSON.stringify(range)}: ${firstLine(result.stderr)}`);
  }
  return result.stdout
    .split('\n')
    .filter((sha) => sha.length > 0)
    .map((sha) => readCommitSource(sha, cwd));
};

const readMessageFile = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${JSON.stringify(path)}: ${messageOf(error)}`);
  }
};

const readStdinSync = (): string => {
  try {
    return readFileSync(0, 'utf8');
  } catch (error) {
    throw new Error(`cannot read the commit message from stdin: ${messageOf(error)}`);
  }
};

const collectSources = (input: ValidateInput, cwd: string): MessageSource[] => {
  if (input.messageFile !== undefined) return [{ message: readMessageFile(input.messageFile) }];
  if (input.commit !== undefined) {
    const sha = resolveCommit(input.commit, cwd);
    return [readCommitSource(sha, cwd)];
  }
  if (input.range !== undefined) return readRange(input.range, cwd);
  return [{ message: (input.readStdin ?? readStdinSync)() }];
};

interface ReferenceCheck {
  check: ValidationCheck;
  violations: LocatedViolation[];
}

/**
 * Why the reference check has no verdict on a shallow clone. Deliberately
 * names the boundary rather than the record: the record is the one thing this
 * clone cannot say anything about.
 */
const SHALLOW_REFERENCE_REASON =
  'shallow history — a Record-Id declared below the clone boundary is not visible here ' +
  '(fix: git fetch --unshallow)';

const PARTIAL_INDEX_REASON =
  'the index is incomplete — a time budget left commits unread, so a Follows: or Supersedes: ' +
  'target may exist in history this check did not read (fix: commitlore init)';

const repositoryAvailable = (cwd: string): boolean =>
  execGit(['rev-parse', '--git-dir'], { cwd }).code === 0;

const indexedHeadRecords = (
  cwd: string,
  input: Pick<ValidateInput, 'scanBudgetMs' | 'scanNow'> = {},
): { records: StaleRecord[]; unreadCommits: number } => {
  const clock = input.scanNow ?? Date.now;
  const cost = { unreadCommits: 0, unreadNotes: 0 };
  const { handle } = ensureIndex({
    cwd,
    cost,
    ...(input.scanBudgetMs === undefined
      ? {}
      : { budget: { deadline: clock() + input.scanBudgetMs, now: clock } }),
  });
  try {
    const records = new Map<string, StaleRecord>();
    for (const row of queryTrailers(handle)) {
      // `block` is part of the row's identity, not decoration: the index's
      // own unique key is `(commit_sha, source, block, seq)` and `query.ts`
      // groups on all of it for the same reason. Folded to `(sha, source)`,
      // every block of a multi-block commit collapses into one record, and
      // `trailerValue` reads only the *first* `Record-Id` of that record — so
      // block 1's identity never reaches the declared set and a `Follows:`
      // naming it reads as dangling (bug-issue-352). Multi-block commits are
      // what squash inheritance produces, so this is the common shape, not an
      // exotic one.
      const identity = `${row.sha}\u0000${row.source}\u0000${row.block}`;
      const existing = records.get(identity);
      if (existing !== undefined) {
        existing.trailers.push({ key: row.key, value: row.value });
        continue;
      }
      records.set(identity, {
        sha: row.sha,
        committedAt: row.committedAt,
        source: row.source,
        trailers: [{ key: row.key, value: row.value }],
      });
    }
    return {
      records: [...records.values()],
      unreadCommits: Math.max(indexUnread(handle), cost.unreadCommits + cost.unreadNotes),
    };
  } finally {
    closeIndex(handle);
  }
};

const recordsFor = (
  source: MessageSource,
  cwd: string,
  input: Pick<ValidateInput, 'scanBudgetMs' | 'scanNow'> = {},
): {
  records: StaleRecord[];
  notes: ReturnType<typeof notesAvailability>;
  unreadCommits: number;
} => {
  if (source.sha !== undefined) {
    return { ...collectRecords({ cwd, allHistory: true, revision: source.sha }), unreadCommits: 0 };
  }
  try {
    const indexed = indexedHeadRecords(cwd, input);
    return {
      records: indexed.records,
      notes: notesAvailability({ cwd }),
      unreadCommits: indexed.unreadCommits,
    };
  } catch {
    return { ...collectRecords({ cwd, allHistory: true, revision: 'HEAD' }), unreadCommits: 0 };
  }
};

const reachableShas = (revision: string, cwd: string): Set<string> => {
  const result = execGit(['rev-list', revision], { cwd });
  if (result.code !== 0) {
    throw new Error(firstLine(result.stderr) || `cannot walk revision ${revision}`);
  }
  return new Set(result.stdout.trim().split('\n').filter(Boolean));
};

const checkReferences = (
  input: ValidateInput,
  sources: MessageSource[],
  cwd: string,
): ReferenceCheck => {
  if (
    input.messageFile === undefined &&
    input.commit === undefined &&
    input.range === undefined
  ) {
    return {
      check: { class: 'reference', status: 'not-checked', reason: 'no repository' },
      violations: [],
    };
  }
  if (!repositoryAvailable(cwd)) {
    return {
      check: { class: 'reference', status: 'not-checked', reason: 'no repository' },
      violations: [],
    };
  }

  try {
    const violations: LocatedViolation[] = [];

    // When validating a range, collect the full record set reachable from the
    // range endpoint so that `isSuccessionDeclared` can see succession
    // declarations made later in the range than the commit currently being
    // checked (bug-issue-187). Without this, a `Supersedes:` that post-dates
    // the colliding commit is invisible and the collision is reported even
    // though it has been resolved.
    const tipSha =
      input.range !== undefined && sources.length > 0
        ? sources[sources.length - 1]!.sha
        : undefined;
    let tipAllRecords: StaleRecord[] | undefined;
    let unreadCommits = 0;
    if (tipSha !== undefined) {
      const tipScan = recordsFor({ sha: tipSha, message: '' }, cwd, input);
      if (tipScan.notes === 'unfetched') {
        return {
          check: {
            class: 'reference',
            status: 'not-checked',
            reason: 'notes mirror not fetched',
          },
          violations: [],
        };
      }
      const tipReachable = reachableShas(tipSha, cwd);
      // Reverse so that same-second commits resolve ties in topological
      // (oldest-first) order inside `chronological` — `collectRecords`
      // returns newest-first from `git log`.
      tipAllRecords = tipScan.records
        .filter(
          (record) => record.sha !== undefined && tipReachable.has(record.sha),
        )
        .reverse();
    }

    for (const source of sources) {
      // A message may carry several record blocks (SPEC §2.4); each is its
      // own reference-checkable record. SPEC §2.4 closes with the rule that
      // decides how they see each other: `Follows:` and `Supersedes:` resolve
      // against `Record-Id`s "regardless of which block declared them; the
      // grammar does not scope identity resolution to one block or one
      // message". So a block's declared set is `prior` *plus its siblings* —
      // `prior` alone excludes every record on `source.sha`, which is correct
      // for the commit's own record and wrong for the block beside it
      // (bug-issue-352).
      const blocks = parseRecordBlocks(source.message);
      const scan = recordsFor(source, cwd, input);
      if (scan.unreadCommits > unreadCommits) unreadCommits = scan.unreadCommits;
      if (scan.notes === 'unfetched') {
        return {
          check: {
            class: 'reference',
            status: 'not-checked',
            reason: 'notes mirror not fetched',
          },
          violations: [],
        };
      }

      const reachable = reachableShas(source.sha ?? 'HEAD', cwd);
      const repositoryRecords = scan.records.filter(
        (record) => record.sha !== undefined && reachable.has(record.sha),
      );
      // #638: a message with no sha of its own is being written for a commit
      // that does not exist yet, and `git commit --amend` is one of those. The
      // rule that should apply is "ignore a declaration that will not remain
      // in history" — during an amend HEAD is exactly that — but a commit-msg
      // hook cannot observe whether it is amending. Git offers no signal: no
      // environment variable, the same COMMIT_EDITMSG either way, and
      // comparing against HEAD's message fails the moment the author edits it,
      // which is this case.
      //
      // So the declaration on HEAD is not counted. That gives up one thing:
      // re-declaring HEAD's id with a different payload on the very next
      // commit now passes. The payload rule in `core/stale.ts` already forgives
      // the identical-payload half of that, so the loss is narrow, and it is a
      // check missing something rather than a check being wrong.
      const headSha = source.sha === undefined ? execGit(['rev-parse', 'HEAD'], { cwd }).stdout.trim() : '';
      const prior = repositoryRecords.filter((record) => record.sha !== source.sha);
      // Only `duplicate-id` ignores HEAD. `Follows:` and `Supersedes:` still
      // resolve against it — a record naming an id declared on HEAD is not
      // dangling, and removing HEAD from `prior` outright turned every such
      // reference into one.
      const priorForCollisions =
        headSha === '' ? prior : prior.filter((record) => record.sha !== headSha);
      // This message's own blocks, exactly once each — not `repositoryRecords`,
      // which already carries the single last-paragraph record `collectRecords`
      // derives for `source.sha`. Two blocks sharing a `Record-Id` inside one
      // message must collide with *each other* (bug-issue-92); pairing
      // `repositoryRecords` with a per-block `candidate` below would instead
      // pair the message's last block with a second copy of itself and never
      // see an earlier block at all. A notes mirror on this same commit is
      // carried over from `repositoryRecords` rather than rebuilt, so a
      // divergent note still collides with the message's own block exactly as
      // it did before this message could carry more than one (bug-issue-74).
      const ownBlocks: StaleRecord[] = blocks.map((trailers) => ({
        trailers,
        source: 'commit' as const,
        ...(source.sha === undefined ? {} : { sha: source.sha }),
      }));
      const ownNotes = repositoryRecords.filter(
        (record) => record.sha === source.sha && record.source === 'notes',
      );
      const ownRecords: StaleRecord[] = [...ownBlocks, ...ownNotes];

      for (const [index, candidate] of ownBlocks.entries()) {
        const trailers = candidate.trailers;
        // The candidate's siblings, not the candidate itself: a record that
        // names its own `Record-Id` in `Follows:` still resolves to nothing,
        // and self-reference is a defect the truncation argument does not
        // cover.
        const siblings = ownBlocks.filter((_, other) => other !== index);
        const dangling = findDanglingRefs([...prior, ...siblings, ...ownNotes], [candidate]);
        const recordId = trailers.find((trailer) => trailer.key === 'Record-Id')?.value;
        const collisions =
          recordId === undefined
            ? []
            : findIdCollisions([...priorForCollisions, ...ownRecords])
                .filter((violation) => violation.value === recordId)
                // When tip-scoped records are available (--range mode), filter
                // out collisions that have been resolved by a Supersedes:
                // declaration later in the range. This gives validate the same
                // succession awareness stale already has (bug-issue-187).
                .filter(
                  (violation) =>
                    tipAllRecords === undefined ||
                    !isSuccessionDeclared(violation.value, tipAllRecords),
                );
        violations.push(
          ...locateReferenceViolations(source, trailers, [...dangling, ...collisions]),
        );
      }
    }

    // A shallow clone is missing ancestors, and "no record in history declares
    // this id" is the one reference answer that reads directly off the
    // ancestors. So a `dangling-ref` here is not a verdict about the record —
    // it is the boundary of the clone, and blocking a commit on it rejects a
    // valid record for the shape of the checkout.
    //
    // Only that rule is withdrawn. `duplicate-id` between a message's own
    // blocks, or against a note on the same commit, is answered from the
    // message alone and truncation cannot touch it — and that is exactly the
    // multi-block squash shape this command exists to catch. Withdrawing the
    // whole class would be a skip with no cause.
    //
    // The dangling-ref test comes first because it is free and the shallow test
    // is not: `hasShallowHistory` spawns `git rev-parse`, and this function runs
    // inside the commit-msg hook on every commit. The overwhelmingly common case
    // is a clean record with nothing to explain, and it should pay nothing.
    const danglingPresent = violations.some((violation) => violation.rule === 'dangling-ref');
    const shallow = danglingPresent && hasShallowHistory(cwd);
    const partial = unreadCommits > 0;
    // A dangling-ref against a partial or shallow corpus is not a verdict
    // about the record: the target may sit in the unread or uncloned half.
    // Duplicate ids we *did* see are still failures.
    const withdrawDangling = shallow || (partial && danglingPresent);
    const reported = withdrawDangling
      ? violations.filter((violation) => violation.rule !== 'dangling-ref')
      : violations;
    const reasons = [
      ...(partial ? [PARTIAL_INDEX_REASON] : []),
      ...(shallow ? [SHALLOW_REFERENCE_REASON] : []),
    ];

    return {
      check: {
        class: 'reference',
        // `not-checked` rather than `ok` when something was withheld: the
        // green would be the part a reader carries away, and this command has
        // no verdict to offer on the reference it could not resolve. A commit
        // accepted against a partial index must not read as fully checked.
        status: reported.length > 0 ? 'failed' : reasons.length > 0 ? 'not-checked' : 'ok',
        ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
      },
      violations: reported,
    };
  } catch (error) {
    return {
      check: {
        class: 'reference',
        status: 'not-checked',
        reason: `repository scan failed: ${firstLine(messageOf(error))}`,
      },
      violations: [],
    };
  }
};

const formatCheck = (check: ValidationCheck): string => {
  const name = check.class === 'reference' ? 'references' : check.class;
  if (check.status === 'not-checked') {
    return `${name} not checked (${check.reason ?? 'required information unavailable'})`;
  }
  // A reason on a decided check names what the verdict does *not* cover, so it
  // is printed too — a partial answer that reads as a whole one is the failure
  // this command is least able to afford.
  return check.reason === undefined
    ? `${name} ${check.status}`
    : `${name} ${check.status} (${check.reason})`;
};

/**
 * A violation's identity as the two output surfaces see it: every field that
 * reaches the formatted line and the `--json` object. Two violations equal
 * under this key are one instruction printed twice, not two edits — nothing a
 * reader or the repair loop could tell apart, let alone act on separately.
 */
const violationIdentity = (violation: LocatedViolation): string =>
  JSON.stringify([
    violation.sha ?? null,
    violation.line ?? null,
    violation.rule,
    violation.key,
    violation.value,
    violation.got,
    violation.want,
  ]);

/** `a1b2c3d4e5:12: enum Blast — got "wide", want "local|module|system"` */
const formatViolation = (violation: LocatedViolation): string => {
  const parts: string[] = [];
  if (violation.sha !== undefined) parts.push(violation.sha.slice(0, 10));
  if (violation.line !== undefined) parts.push(String(violation.line));
  const where = parts.length === 0 ? '' : `${parts.join(':')}: `;
  const got = JSON.stringify(violation.got);
  const want = JSON.stringify(violation.want);
  return `${where}${violation.rule} ${violation.key} — got ${got}, want ${want}`;
};

/**
 * Validates one or more commit messages. Never throws for an input problem:
 * every failure comes back as a `code`, so the caller decides how to exit.
 */
export const runValidate = (input: ValidateInput = {}): ValidateResult => {
  const given = MODE_KEYS.filter((key) => input[key] !== undefined);
  if (given.length > 1) {
    const flags = given.map((key) => MODE_FLAGS[key]).join(', ');
    return usageError(`${flags} are mutually exclusive — pass exactly one`);
  }
  if (input.range !== undefined && !input.range.includes('..')) {
    // Without this, a typo'd single ref would silently validate all of history.
    return usageError(`--range expects <a>..<b>, got ${JSON.stringify(input.range)}`);
  }

  const cwd = input.cwd ?? process.cwd();

  let shapeViolations: LocatedViolation[];
  let warnings: string[];
  let secrets: SecretFinding[];
  let sources: MessageSource[];
  try {
    sources = collectSources(input, cwd);
    const inspections = sources.map(inspectSource);
    shapeViolations = inspections.flatMap((inspection) => inspection.violations);
    warnings = inspections.flatMap((inspection) => inspection.warnings);
    // A credential in a commit message is inscribed permanently -- rewriting
    // history does not reach the clones and forks that already have it. So the
    // scan runs on the same path as validation, which is what the commit-msg
    // hook calls, and blocks before the message is ever written (ADR-0005).
    secrets = sources.flatMap((source) => scanForSecrets(source.message));
  } catch (error) {
    // Not every exception here is the caller's fault, and saying so with a
    // usage line is how a broken installation came to read as a bad commit
    // message (#533). A missing shipped file is an installation problem: it
    // gets its own exit code and no usage line, because there is nothing the
    // caller could retype to fix it.
    if (isMissingInstalledFile(error)) return installationError(messageOf(error));
    return usageError(messageOf(error));
  }

  const references = checkReferences(input, sources, cwd);
  // Shape and reference are independent detectors that overlap on one finding:
  // a `Record-Id` repeated across a message's own blocks is caught by
  // `identityCollisionViolations` from the message alone, and by
  // `findIdCollisions` inside `checkReferences`, which sees those same blocks
  // as sibling records. Concatenating the two lists reported one collision
  // twice, counted it twice in the summary, and handed the repair loop two
  // identical instructions for one edit (bug-issue-365).
  //
  // Deduped here rather than by making one of the two checks stay silent on
  // `duplicate-id`, because neither can be the one that goes quiet. The shape
  // half is the only half that survives the `unfetched` and shallow gates and
  // the stdin mode that identifies no repository at all — the common local
  // case, and the one the commit-msg hook runs. The reference half is the only
  // half that answers for a resolved `sha` (where the shape half deliberately
  // stands down, since `findIdCollisions` reports it there with the same line
  // attribution), and the only half that can see a collision against a note or
  // an earlier commit at all. The overlap is not the defect; the second copy
  // is.
  //
  // Scoped to the seam between the two lists and keyed on every field that
  // reaches the output, so the multiplicity each check produces on its own is
  // untouched: still one `duplicate-id` per colliding block, still one
  // `cardinality` per extra occurrence. The shape copy is the one kept —
  // shape is the check that ran unconditionally.
  const alreadyReported = new Set(shapeViolations.map(violationIdentity));
  const violations = [
    ...shapeViolations,
    ...references.violations.filter(
      (violation) => !alreadyReported.has(violationIdentity(violation)),
    ),
  ];
  const checks: ValidationCheck[] = [
    {
      class: 'shape',
      status: shapeViolations.length > 0 || secrets.length > 0 ? 'failed' : 'ok',
    },
    references.check,
  ];
  const status = `${checks.map(formatCheck).join(' · ')}\n`;
  const failed = violations.length > 0 || secrets.length > 0;
  const warningText = warnings.length === 0 ? '' : `${warnings.join('\n')}\n`;

  if (input.json === true) {
    return {
      code: failed ? 1 : 0,
      // `examined` is how many messages were actually read. Without it a
      // report of an empty range is indistinguishable from a clean one — both
      // are `ok`/`ok` with no violations — so a gate reading this JSON can
      // report success having checked nothing (the shape #542 was about, one
      // level along).
      stdout: `${JSON.stringify({ examined: sources.length, checks, violations, secrets })}\n`,
      stderr: warningText,
      violations,
      secrets,
      checks,
    };
  }

  if (!failed) {
    return { code: 0, stdout: status, stderr: warningText, violations, secrets, checks };
  }

  const parts: string[] = [status.trimEnd()];
  if (violations.length > 0) parts.push(violations.map(formatViolation).join('\n'));
  if (secrets.length > 0) parts.push(formatFindings(secrets));

  const notes: string[] = [];
  if (violations.length > 0) {
    const plural = violations.length === 1 ? '' : 's';
    notes.push(`${violations.length} violation${plural} (SPEC §6)`);
  }
  if (secrets.length > 0) {
    const plural = secrets.length === 1 ? '' : 's';
    notes.push(`${secrets.length} possible credential${plural} (ADR-0005)`);
  }

  return {
    code: 1,
    stdout: `${parts.join('\n')}\n`,
    stderr: `${warningText}commitlore: ${notes.join(', ')} — the message was not modified\n`,
    violations,
    secrets,
    checks,
  };
};

/** Commander's parsed flags for this command. */
interface ValidateFlags {
  messageFile?: string;
  commit?: string;
  range?: string;
  json?: boolean;
}

export const register = (program: Command): void => {
  program
    .command('validate')
    .description('check commit trailers against the protocol (SPEC §6)')
    .option('-f, --message-file <file>', 'validate a commit message file (a commit-msg hook passes one)')
    .option('-c, --commit <sha>', 'validate the message of one commit')
    .option('-r, --range <a..b>', 'validate every commit message in a range')
    .option('--json', 'emit violations as JSON for the repair loop')
    .addHelpText(
      'after',
      '\nWith no input flag the message is read from stdin.\nExit codes: 0 clean, 1 violations found, 2 usage or input error (SPEC §10),\n3 this installation is missing a file it ships, so nothing was examined.',
    )
    .action((flags: ValidateFlags) => {
      const result = runValidate({
        ...(flags.messageFile === undefined ? {} : { messageFile: flags.messageFile }),
        ...(flags.commit === undefined ? {} : { commit: flags.commit }),
        ...(flags.range === undefined ? {} : { range: flags.range }),
        ...(flags.json === undefined ? {} : { json: flags.json }),
        // The commit-msg hook is this command with `--message-file`. Four
        // minutes to accept one commit is worse than a partial check that
        // says it is partial.
        scanBudgetMs: CONSUMER_SCAN_BUDGET_MS,
      });

      if (result.stdout !== '') process.stdout.write(result.stdout);
      if (result.stderr !== '') process.stderr.write(result.stderr);
      if (result.code !== 0) process.exitCode = result.code;
    });
};
