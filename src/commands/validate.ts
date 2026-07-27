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
import { execGit } from '../core/git.js';
import { closeIndex, ensureIndex, queryTrailers } from '../core/index-db.js';
import { notesAvailability } from '../core/notes.js';
import { validateRecord } from '../core/schema.js';
import {
  findDanglingRefs,
  findIdCollisions,
  type StaleRecord,
} from '../core/stale.js';
import { parseCommitMessage } from '../core/trailers.js';
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
}

/** Exit code, plus the streams the caller writes. Returned rather than printed so tests can drive the command in-process. */
export interface ValidateResult {
  code: 0 | 1 | 2;
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
  merge?: boolean;
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
  trailers: Trailer[],
): UnparsedTrailerWarning[] => {
  const lines = message.split('\n').map(stripCr);
  const contentLines = lines.filter((line) => line !== '' && !isComment(line));
  if (
    contentLines.length > 0 &&
    contentLines.every((line) => knownTrailerCandidate(line) !== undefined)
  ) {
    return [];
  }

  const parsedLines = new Set(locateTrailerLines(message, trailers));
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

const inspectSource = (
  source: MessageSource,
): { violations: LocatedViolation[]; warnings: string[] } => {
  const trailers = parseCommitMessage(source.message);
  const lines = locateTrailerLines(source.message, trailers);
  const rawViolations = validateRecord(trailers);
  const firstTrailerLine = lines[0];
  const nonTrailerParagraph =
    source.merge === true &&
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

  const violations = (nonTrailerParagraph === undefined ? rawViolations : []).map((violation) => {
    const line = lineForViolation(violation, trailers, lines);
    return {
      ...(source.sha === undefined ? {} : { sha: source.sha }),
      ...(line === undefined ? {} : { line }),
      ...violation,
    };
  });

  const warnings = locateUnparsedTrailerWarnings(source.message, trailers).map((warning) =>
    warning.tabIndented
      ? `commitlore: line ${warning.line} looks like a ${warning.key} trailer, but git did not parse it; remove the leading tab`
      : `commitlore: line ${warning.line} looks like a ${warning.key} trailer, but git did not parse it; the trailer block needs a blank line before it`,
  );
  if (nonTrailerParagraph !== undefined) {
    warnings.push(
      `commitlore: ${source.sha?.slice(0, 10) ?? 'commit'}:${firstTrailerLine}: final paragraph does not look like a CommitLore trailer block; saw ${JSON.stringify(nonTrailerParagraph)}`,
    );
  }

  return { violations, warnings };
};

const locateReferenceViolations = (
  source: MessageSource,
  violations: Violation[],
): LocatedViolation[] => {
  const trailers = parseCommitMessage(source.message);
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
  const result = execGit(['log', '-1', '--format=%P%x00%B', sha, '--'], { cwd });
  if (result.code !== 0) {
    throw new Error(`cannot read commit ${sha}: ${firstLine(result.stderr)}`);
  }
  const [parents = '', message = ''] = result.stdout.split('\0');
  return {
    sha,
    message,
    merge: parents.split(' ').filter(Boolean).length > 1,
  };
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

const repositoryAvailable = (cwd: string): boolean =>
  execGit(['rev-parse', '--git-dir'], { cwd }).code === 0;

const indexedHeadRecords = (cwd: string): StaleRecord[] => {
  const { handle } = ensureIndex({ cwd });
  try {
    const records = new Map<string, StaleRecord>();
    for (const row of queryTrailers(handle)) {
      const identity = `${row.sha}\0${row.source}`;
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
    return [...records.values()];
  } finally {
    closeIndex(handle);
  }
};

const recordsFor = (
  source: MessageSource,
  cwd: string,
): { records: StaleRecord[]; notes: ReturnType<typeof notesAvailability> } => {
  if (source.sha !== undefined) {
    return collectRecords({ cwd, allHistory: true, revision: source.sha });
  }
  try {
    return { records: indexedHeadRecords(cwd), notes: notesAvailability({ cwd }) };
  } catch {
    return collectRecords({ cwd, allHistory: true, revision: 'HEAD' });
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
    for (const source of sources) {
      const trailers = parseCommitMessage(source.message);
      const candidate: StaleRecord = {
        trailers,
        source: 'commit',
        ...(source.sha === undefined ? {} : { sha: source.sha }),
      };
      const scan = recordsFor(source, cwd);
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
      const prior = repositoryRecords.filter((record) => record.sha !== source.sha);
      const dangling = findDanglingRefs(prior, [candidate]);
      const recordId = trailers.find((trailer) => trailer.key === 'Record-Id')?.value;
      const collisions =
        recordId === undefined
          ? []
          : findIdCollisions([...repositoryRecords, candidate]).filter(
              (violation) => violation.value === recordId,
            );
      violations.push(...locateReferenceViolations(source, [...dangling, ...collisions]));
    }

    return {
      check: { class: 'reference', status: violations.length === 0 ? 'ok' : 'failed' },
      violations,
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
  return check.status === 'not-checked'
    ? `${name} not checked (${check.reason ?? 'required information unavailable'})`
    : `${name} ${check.status}`;
};

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
    return usageError(messageOf(error));
  }

  const references = checkReferences(input, sources, cwd);
  const violations = [...shapeViolations, ...references.violations];
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
      stdout: `${JSON.stringify({ checks, violations, secrets })}\n`,
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
      '\nWith no input flag the message is read from stdin.\nExit codes: 0 clean, 1 violations found, 2 usage or input error (SPEC §10).',
    )
    .action((flags: ValidateFlags) => {
      const result = runValidate({
        ...(flags.messageFile === undefined ? {} : { messageFile: flags.messageFile }),
        ...(flags.commit === undefined ? {} : { commit: flags.commit }),
        ...(flags.range === undefined ? {} : { range: flags.range }),
        ...(flags.json === undefined ? {} : { json: flags.json }),
      });

      if (result.stdout !== '') process.stdout.write(result.stdout);
      if (result.stderr !== '') process.stderr.write(result.stderr);
      if (result.code !== 0) process.exitCode = result.code;
    });
};
