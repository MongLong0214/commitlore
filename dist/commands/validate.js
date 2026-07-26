/**
 * `commitlore validate` — machine refusal of malformed records (SPEC §6).
 *
 * Three contracts hold this command in place, because a hook and a CI job both
 * branch on them:
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
 * Scope: single-record rules only. `dangling-ref` asks whether a
 * `Supersedes:`/`Follows:` target exists elsewhere in history — a cross-record
 * question owned by the stale engine (T-205), not by this command.
 */
import { readFileSync } from 'node:fs';
import { execGit } from '../core/git.js';
import { validateRecord } from '../core/schema.js';
import { parseCommitMessage } from '../core/trailers.js';
import { SINGLE_VALUED } from '../core/types.js';
import { scanForSecrets, formatFindings } from '../core/secret-guard.js';
const USAGE = 'usage: commitlore validate [--message-file <file> | --commit <sha> | --range <a>..<b>] [--json]';
const MODE_FLAGS = {
    messageFile: '--message-file',
    commit: '--commit',
    range: '--range',
};
const MODE_KEYS = ['messageFile', 'commit', 'range'];
const usageError = (message) => ({
    code: 2,
    stdout: '',
    stderr: `commitlore: ${message}\n${USAGE}\n`,
    violations: [],
    secrets: [],
});
const messageOf = (error) => error instanceof Error ? error.message : String(error);
const firstLine = (text) => (text.trim().split('\n')[0] ?? '').trim();
/** Git may hand back CRLF; git's own trailer values never carry the CR. */
const stripCr = (line) => (line.endsWith('\r') ? line.slice(0, -1) : line);
/** Continuation lines begin with whitespace and fold into the previous value (SPEC §2.1 B4). */
const CONTINUATION = /^[ \t]/;
const LEADING_WHITESPACE = /^[ \t]+/;
/**
 * `git interpret-trailers` skips comment lines, so a message straight out of
 * `.git/COMMIT_EDITMSG` can have them interleaved with trailers.
 */
const isComment = (line) => line.startsWith('#');
/**
 * Tries to read `trailers` off `lines` starting at `start`, reproducing git's
 * unfold (value, then each continuation appended after a single space) and
 * comparing the result to what git actually returned.
 *
 * Returns the 1-based start line of each trailer, or null if the lines at
 * `start` are not exactly this trailer list. The value comparison is what makes
 * this safe: a shape that merely looks like the block is rejected.
 */
const matchTrailersAt = (lines, start, trailers) => {
    const found = [];
    let cursor = start;
    for (const trailer of trailers) {
        while (cursor < lines.length && isComment(lines[cursor] ?? ''))
            cursor += 1;
        const line = lines[cursor];
        const prefix = `${trailer.key}:`;
        if (line === undefined || !line.startsWith(prefix))
            return null;
        let value = line.slice(prefix.length).replace(LEADING_WHITESPACE, '');
        found.push(cursor + 1);
        cursor += 1;
        while (cursor < lines.length && CONTINUATION.test(lines[cursor] ?? '')) {
            value += ` ${(lines[cursor] ?? '').replace(LEADING_WHITESPACE, '')}`;
            cursor += 1;
        }
        if (value !== trailer.value)
            return null;
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
const locateTrailerLines = (message, trailers) => {
    if (trailers.length === 0)
        return [];
    const lines = message.split('\n').map(stripCr);
    for (let start = lines.length - 1; start >= 0; start -= 1) {
        const matched = matchTrailersAt(lines, start, trailers);
        if (matched !== null)
            return matched;
    }
    return trailers.map(() => undefined);
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
const lineForViolation = (violation, trailers, lines) => {
    const indexesWithKey = trailers.flatMap((trailer, index) => trailer.key === violation.key ? [index] : []);
    if (violation.rule === 'cardinality' && SINGLE_VALUED.has(violation.key)) {
        const occurrence = Number(violation.got);
        if (!Number.isInteger(occurrence))
            return undefined;
        const index = indexesWithKey[occurrence - 1];
        if (index === undefined || trailers[index]?.value !== violation.value)
            return undefined;
        return lines[index];
    }
    const matches = indexesWithKey.filter((index) => trailers[index]?.value === violation.value);
    const only = matches.length === 1 ? matches[0] : undefined;
    return only === undefined ? undefined : lines[only];
};
const locateViolations = (source) => {
    const trailers = parseCommitMessage(source.message);
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
/** Resolves a revision to a full sha so the reported `sha` is unambiguous. */
const resolveCommit = (ref, cwd) => {
    const result = execGit(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd });
    if (result.code !== 0) {
        throw new Error(`cannot resolve commit ${JSON.stringify(ref)}: ${firstLine(result.stderr)}`);
    }
    return result.stdout.trim();
};
const readCommitMessage = (sha, cwd) => {
    const result = execGit(['log', '-1', '--format=%B', sha, '--'], { cwd });
    if (result.code !== 0) {
        throw new Error(`cannot read commit ${sha}: ${firstLine(result.stderr)}`);
    }
    return result.stdout;
};
const readRange = (range, cwd) => {
    const result = execGit(['rev-list', '--reverse', '--end-of-options', range, '--'], { cwd });
    if (result.code !== 0) {
        throw new Error(`cannot walk range ${JSON.stringify(range)}: ${firstLine(result.stderr)}`);
    }
    return result.stdout
        .split('\n')
        .filter((sha) => sha.length > 0)
        .map((sha) => ({ sha, message: readCommitMessage(sha, cwd) }));
};
const readMessageFile = (path) => {
    try {
        return readFileSync(path, 'utf8');
    }
    catch (error) {
        throw new Error(`cannot read ${JSON.stringify(path)}: ${messageOf(error)}`);
    }
};
const readStdinSync = () => {
    try {
        return readFileSync(0, 'utf8');
    }
    catch (error) {
        throw new Error(`cannot read the commit message from stdin: ${messageOf(error)}`);
    }
};
const collectSources = (input, cwd) => {
    if (input.messageFile !== undefined)
        return [{ message: readMessageFile(input.messageFile) }];
    if (input.commit !== undefined) {
        const sha = resolveCommit(input.commit, cwd);
        return [{ sha, message: readCommitMessage(sha, cwd) }];
    }
    if (input.range !== undefined)
        return readRange(input.range, cwd);
    return [{ message: (input.readStdin ?? readStdinSync)() }];
};
/** `a1b2c3d4e5:12: enum Blast — got "wide", want "local|module|system"` */
const formatViolation = (violation) => {
    const parts = [];
    if (violation.sha !== undefined)
        parts.push(violation.sha.slice(0, 10));
    if (violation.line !== undefined)
        parts.push(String(violation.line));
    const where = parts.length === 0 ? '' : `${parts.join(':')}: `;
    const got = JSON.stringify(violation.got);
    const want = JSON.stringify(violation.want);
    return `${where}${violation.rule} ${violation.key} — got ${got}, want ${want}`;
};
/**
 * Validates one or more commit messages. Never throws for an input problem:
 * every failure comes back as a `code`, so the caller decides how to exit.
 */
export const runValidate = (input = {}) => {
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
    let violations;
    let secrets;
    try {
        const sources = collectSources(input, cwd);
        violations = sources.flatMap(locateViolations);
        // A credential in a commit message is inscribed permanently -- rewriting
        // history does not reach the clones and forks that already have it. So the
        // scan runs on the same path as validation, which is what the commit-msg
        // hook calls, and blocks before the message is ever written (ADR-0005).
        secrets = sources.flatMap((source) => scanForSecrets(source.message));
    }
    catch (error) {
        return usageError(messageOf(error));
    }
    const failed = violations.length > 0 || secrets.length > 0;
    if (input.json === true) {
        return {
            code: failed ? 1 : 0,
            stdout: `${JSON.stringify({ violations, secrets })}\n`,
            stderr: '',
            violations,
            secrets,
        };
    }
    if (!failed)
        return { code: 0, stdout: '', stderr: '', violations, secrets };
    const parts = [];
    if (violations.length > 0)
        parts.push(violations.map(formatViolation).join('\n'));
    if (secrets.length > 0)
        parts.push(formatFindings(secrets));
    const notes = [];
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
        stderr: `commitlore: ${notes.join(', ')} — the message was not modified\n`,
        violations,
        secrets,
    };
};
export const register = (program) => {
    program
        .command('validate')
        .description('check commit trailers against the protocol (SPEC §6)')
        .option('-f, --message-file <file>', 'validate a commit message file (a commit-msg hook passes one)')
        .option('-c, --commit <sha>', 'validate the message of one commit')
        .option('-r, --range <a..b>', 'validate every commit message in a range')
        .option('--json', 'emit violations as JSON for the repair loop')
        .addHelpText('after', '\nWith no input flag the message is read from stdin.\nExit codes: 0 clean, 1 violations found, 2 usage or input error.')
        .action((flags) => {
        const result = runValidate({
            ...(flags.messageFile === undefined ? {} : { messageFile: flags.messageFile }),
            ...(flags.commit === undefined ? {} : { commit: flags.commit }),
            ...(flags.range === undefined ? {} : { range: flags.range }),
            ...(flags.json === undefined ? {} : { json: flags.json }),
        });
        if (result.stdout !== '')
            process.stdout.write(result.stdout);
        if (result.stderr !== '')
            process.stderr.write(result.stderr);
        if (result.code !== 0)
            process.exitCode = result.code;
    });
};
//# sourceMappingURL=validate.js.map