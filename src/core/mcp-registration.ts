/**
 * Repository-scoped MCP registration.
 *
 * `.mcp.json` is deliberately a repository file, not an edit to a host's
 * private configuration. It lets a host that elects to load repository MCP
 * configuration discover CommitLore's capture tools after a clone, while
 * leaving hosts that keep their configuration elsewhere alone.
 *
 * The command is the portable `commitlore mcp` pair. It is the same PATH-based
 * resolution route the installed Git hooks use after their per-machine pin,
 * rather than an absolute path to the machine that happened to run `init`.
 * Because this file is committed, such a path would break for the next clone.
 */

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { execGit } from './git.js';

/** The conventional repository configuration a repository-scoped host reads. */
export const MCP_REGISTRATION_FILE = '.mcp.json';

/** The key, command, and argv registered by `commitlore init`. */
export const MCP_SERVER_KEY = 'commitlore';
export const MCP_SERVER_COMMAND = 'commitlore';
export const MCP_SERVER_ARGS = ['mcp'] as const;

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The repository root, or null when `cwd` is outside one. */
const repositoryRoot = (cwd: string): string | null => {
  const result = execGit(['rev-parse', '--show-toplevel'], { cwd });
  if (result.code !== 0) return null;
  const root = result.stdout.trim();
  return root === '' ? null : root;
};

/** Absolute repository registration path, or null outside a repository. */
export const mcpRegistrationPath = (cwd: string): string | null => {
  const root = repositoryRoot(cwd);
  return root === null ? null : join(root, MCP_REGISTRATION_FILE);
};

/**
 * Whether the repository advertises this server at all. Registration is not
 * proof that a host loaded it or invoked a tool; doctor reports that distinction
 * separately. Keeping this reader beside the writer stops their file/key
 * interpretation from drifting apart.
 */
export const registersCommitloreMcpServer = (cwd: string): boolean => {
  const path = mcpRegistrationPath(cwd);
  if (path === null) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return false;
  }
  if (!isJsonObject(parsed)) return false;
  const servers = parsed['mcpServers'];
  return isJsonObject(servers) && Object.hasOwn(servers, MCP_SERVER_KEY);
};

export interface McpRegistrationSuccess {
  ok: true;
  /** Absolute path that was inspected or written. */
  path: string;
  /** Whether a new file was created, an existing one was merged, or it was already present. */
  state: 'created' | 'merged' | 'already-registered';
  /** False only when the repository already held its own entry. */
  changed: boolean;
}

export interface McpRegistrationFailure {
  ok: false;
  /** Null only when `cwd` was not inside a Git repository. */
  path: string | null;
  /** The named reason the existing file was left untouched. */
  error: string;
}

export type McpRegistrationResult = McpRegistrationSuccess | McpRegistrationFailure;

// ---------------------------------------------------------------------------
// Text-preserving JSON insertion
// ---------------------------------------------------------------------------

/** Whitespace recognised by JSON (not every JavaScript whitespace character). */
const skipJsonWhitespace = (source: string, index: number): number => {
  let next = index;
  while (next < source.length && (source[next] === ' ' || source[next] === '\n' || source[next] === '\r' || source[next] === '\t')) {
    next += 1;
  }
  return next;
};

/** End offset (exclusive) of a JSON string. The source was already JSON.parse'd. */
const scanJsonString = (source: string, start: number): number => {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === '"') return index + 1;
    index += 1;
  }
  return source.length;
};

/** End offset (exclusive) of one JSON value. */
const scanJsonValue = (source: string, start: number): number => {
  const first = source[start];
  if (first === '"') return scanJsonString(source, start);

  if (first === '{') {
    let index = skipJsonWhitespace(source, start + 1);
    if (source[index] === '}') return index + 1;
    for (;;) {
      index = scanJsonString(source, index);
      index = skipJsonWhitespace(source, index + 1); // colon
      index = skipJsonWhitespace(source, index);
      index = scanJsonValue(source, index);
      index = skipJsonWhitespace(source, index);
      if (source[index] === '}') return index + 1;
      index = skipJsonWhitespace(source, index + 1); // comma
    }
  }

  if (first === '[') {
    let index = skipJsonWhitespace(source, start + 1);
    if (source[index] === ']') return index + 1;
    for (;;) {
      index = scanJsonValue(source, index);
      index = skipJsonWhitespace(source, index);
      if (source[index] === ']') return index + 1;
      index = skipJsonWhitespace(source, index + 1); // comma
    }
  }

  let index = start;
  while (index < source.length && ![' ', '\n', '\r', '\t', ',', '}', ']'].includes(source[index] ?? '')) {
    index += 1;
  }
  return index;
};

interface ObjectMember {
  key: string;
  keyStart: number;
  valueStart: number;
  valueEnd: number;
}

/** Direct members of the object whose opening `{` and exclusive end are known. */
const objectMembers = (source: string, objectStart: number, objectEnd: number): ObjectMember[] => {
  const members: ObjectMember[] = [];
  let index = skipJsonWhitespace(source, objectStart + 1);

  while (index < objectEnd - 1) {
    const keyStart = index;
    const keyEnd = scanJsonString(source, keyStart);
    const key = JSON.parse(source.slice(keyStart, keyEnd)) as string;
    index = skipJsonWhitespace(source, keyEnd);
    index = skipJsonWhitespace(source, index + 1); // colon
    const valueStart = index;
    const valueEnd = scanJsonValue(source, valueStart);
    members.push({ key, keyStart, valueStart, valueEnd });
    index = skipJsonWhitespace(source, valueEnd);
    if (source[index] === '}') break;
    index = skipJsonWhitespace(source, index + 1); // comma
  }

  return members;
};

/** The indentation in force at one source offset. */
const indentationAt = (source: string, offset: number): string => {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  const indent = source.slice(lineStart, offset);
  return /^[ \t]*$/.test(indent) ? indent : '';
};

/** Prefer the file's own indentation unit; two spaces is the project default. */
const indentationUnit = (source: string): string => {
  const match = source.match(/(?:^|\n)([ \t]+)"/);
  if (match?.[1] !== undefined) return match[1].includes('\t') ? '\t' : ' '.repeat(Math.min(match[1].length, 2));
  return '  ';
};

const lineEnding = (source: string): string => (source.includes('\r\n') ? '\r\n' : '\n');

const compactServer = (): string =>
  JSON.stringify({ command: MCP_SERVER_COMMAND, args: MCP_SERVER_ARGS });

const prettyServer = (memberIndent: string, unit: string, eol: string): string => {
  const fieldIndent = `${memberIndent}${unit}`;
  return [
    '{',
    `${fieldIndent}"command": "${MCP_SERVER_COMMAND}",`,
    `${fieldIndent}"args": ["mcp"]`,
    `${memberIndent}}`,
  ].join(eol);
};

const compactServerMap = (): string =>
  JSON.stringify({ [MCP_SERVER_KEY]: { command: MCP_SERVER_COMMAND, args: MCP_SERVER_ARGS } });

const prettyServerMap = (memberIndent: string, unit: string, eol: string): string => {
  const serverIndent = `${memberIndent}${unit}`;
  const fieldIndent = `${serverIndent}${unit}`;
  return [
    '{',
    `${serverIndent}"${MCP_SERVER_KEY}": {`,
    `${fieldIndent}"command": "${MCP_SERVER_COMMAND}",`,
    `${fieldIndent}"args": ["mcp"]`,
    `${serverIndent}}`,
    `${memberIndent}}`,
  ].join(eol);
};

/**
 * Add one direct member without reserialising the object around it.
 *
 * JSON serializers would preserve values but erase every existing whitespace,
 * key ordering choice, and compact server definition. Inserting only the new
 * bytes keeps every existing member byte-for-byte intact, including unknown
 * fields a host owns. The source was already parsed, so this scanner never has
 * to guess whether braces inside a string are structural.
 */
const insertObjectMember = (
  source: string,
  objectStart: number,
  objectEnd: number,
  key: string,
  value: (memberIndent: string, unit: string, eol: string, compact: boolean) => string,
): string => {
  const members = objectMembers(source, objectStart, objectEnd);
  const content = source.slice(objectStart + 1, objectEnd - 1);
  const multiline = /\r?\n/.test(content);
  const unit = indentationUnit(source);

  if (!multiline) {
    const member = `"${key}":${value('', unit, lineEnding(source), true)}`;
    const insertion = members.length === 0 ? member : `,${member}`;
    const index = members.length === 0 ? objectStart + 1 : objectEnd - 1;
    return `${source.slice(0, index)}${insertion}${source.slice(index)}`;
  }

  const eol = lineEnding(source);
  const memberIndent = members.length > 0 ? indentationAt(source, members[0]!.keyStart) : `${indentationAt(source, objectEnd - 1)}${unit}`;
  const member = `"${key}": ${value(memberIndent, unit, eol, false)}`;
  if (members.length === 0) {
    // Insert before the object's existing closing whitespace, leaving it intact.
    return `${source.slice(0, objectStart + 1)}${eol}${memberIndent}${member}${source.slice(objectStart + 1)}`;
  }

  // Insert before whitespace preceding `}` so the old member and the old close
  // indentation remain exactly where they were.
  const trailingWhitespace = content.match(/[ \t\r\n]*$/)?.[0] ?? '';
  const index = objectEnd - 1 - trailingWhitespace.length;
  return `${source.slice(0, index)},${eol}${memberIndent}${member}${source.slice(index)}`;
};

/** Atomic replacement so an interrupted registration never leaves invalid JSON. */
const writeAtomic = (path: string, contents: string): void => {
  let mode: number | undefined;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    mode = undefined;
  }

  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(temporary, contents, mode === undefined ? {} : { mode });
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary was never created or is already gone.
    }
    throw error;
  }
};

const freshConfig = (): string =>
  `${JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: { command: MCP_SERVER_COMMAND, args: MCP_SERVER_ARGS } } }, null, 2)}\n`;

/**
 * Register CommitLore without ever replacing an entry an operator already
 * chose. A malformed or incompatible file is left untouched and returned as a
 * named failure for `init` to report without making the installation unusable.
 */
export const registerCommitloreMcpServer = (cwd: string): McpRegistrationResult => {
  const path = mcpRegistrationPath(cwd);
  if (path === null) {
    return { ok: false, path: null, error: 'no git repository found here — MCP registration needs a repository' };
  }

  if (!existsSync(path)) {
    try {
      writeAtomic(path, freshConfig());
      return { ok: true, path, state: 'created', changed: true };
    } catch (error) {
      return { ok: false, path, error: `${MCP_REGISTRATION_FILE} could not be written: ${messageOf(error)}` };
    }
  }

  try {
    if (lstatSync(path).isSymbolicLink()) {
      return { ok: false, path, error: `${MCP_REGISTRATION_FILE} is a symbolic link — left unchanged` };
    }
  } catch (error) {
    return { ok: false, path, error: `${MCP_REGISTRATION_FILE} could not be inspected: ${messageOf(error)}` };
  }

  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    return { ok: false, path, error: `${MCP_REGISTRATION_FILE} could not be read: ${messageOf(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return { ok: false, path, error: `${MCP_REGISTRATION_FILE} is not valid JSON — left unchanged: ${messageOf(error)}` };
  }
  if (!isJsonObject(parsed)) {
    return { ok: false, path, error: `${MCP_REGISTRATION_FILE} must contain a JSON object — left unchanged` };
  }

  const rootStart = skipJsonWhitespace(source, 0);
  const rootEnd = scanJsonValue(source, rootStart);
  const rootMembers = objectMembers(source, rootStart, rootEnd);
  const mcpMembers = rootMembers.filter((member) => member.key === 'mcpServers');
  const mcpMember = mcpMembers[mcpMembers.length - 1];
  const servers = parsed['mcpServers'];

  if (isJsonObject(servers) && Object.hasOwn(servers, MCP_SERVER_KEY)) {
    return { ok: true, path, state: 'already-registered', changed: false };
  }
  if (servers !== undefined && !isJsonObject(servers)) {
    return {
      ok: false,
      path,
      error: `${MCP_REGISTRATION_FILE} has an "mcpServers" value that is not an object — left unchanged`,
    };
  }

  let next: string;
  if (mcpMember === undefined) {
    next = insertObjectMember(source, rootStart, rootEnd, 'mcpServers', (_indent, unit, eol, compact) =>
      compact ? compactServerMap() : prettyServerMap(_indent, unit, eol),
    );
  } else {
    next = insertObjectMember(source, mcpMember.valueStart, mcpMember.valueEnd, MCP_SERVER_KEY, (indent, unit, eol, compact) =>
      compact ? compactServer() : prettyServer(indent, unit, eol),
    );
  }

  try {
    writeAtomic(path, next);
    return { ok: true, path, state: 'merged', changed: true };
  } catch (error) {
    return { ok: false, path, error: `${MCP_REGISTRATION_FILE} could not be written: ${messageOf(error)}` };
  }
};
