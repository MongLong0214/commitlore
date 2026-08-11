/**
 * The repository-owned instruction block that makes capture reach every host
 * which honours AGENTS.md.  The source lives in the shipped AGENTS.md rather
 * than in a second prose copy: separate copies would drift, and an install
 * that still carries the old procedure would look successful until a commit
 * silently misses its record.
 */

import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENTS_SECTION_BEGIN = '<!-- commitlore:begin -->';
export const AGENTS_SECTION_END = '<!-- commitlore:end -->';

export interface AgentsGuidanceResult {
  readonly state: 'created' | 'added' | 'updated' | 'unchanged' | 'invalid' | 'write-failed';
  readonly path: string;
  readonly error: string | null;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The unbundled command runs from `dist/core`; the bundled command runs from
 * `dist/commitlore.mjs`.  Both distributions keep AGENTS.md beside `dist/`.
 */
const shippedAgentsPath = (): string => {
  const source = fileURLToPath(import.meta.url);
  const here = dirname(source);
  return basename(here) === 'dist'
    ? resolve(here, '..', 'AGENTS.md')
    : resolve(here, '..', '..', 'AGENTS.md');
};

export const readCommitloreAgentsSection = (): string => {
  const contents = readFileSync(shippedAgentsPath(), 'utf8');
  const start = contents.indexOf(AGENTS_SECTION_BEGIN);
  const end = contents.indexOf(AGENTS_SECTION_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`the shipped AGENTS.md has no complete ${AGENTS_SECTION_BEGIN} section`);
  }
  return contents.slice(start, end + AGENTS_SECTION_END.length).trimEnd() + '\n';
};

const markerCount = (contents: string, marker: string): number => contents.split(marker).length - 1;

/** Write beside the target and rename, so an interrupted init never truncates a user's instructions. */
const replaceFile = (path: string, contents: string): void => {
  const mode = statSync(path).mode & 0o777;
  const temporary = `${path}.commitlore-incoming-${process.pid}`;
  try {
    writeFileSync(temporary, contents, { mode });
    renameSync(temporary, path);
  } catch (error) {
    try {
      if (existsSync(temporary)) rmSync(temporary, { force: true });
    } catch {
      // The target was left alone; a failed temporary cleanup changes no guidance.
    }
    throw error;
  }
};

/**
 * Installs or refreshes only CommitLore's marked section.  An unmarked file is
 * wholly somebody else's: its exact bytes stay as a prefix, and a malformed
 * marker pair is reported rather than guessed at or overwritten.
 */
export const installAgentsGuidance = (cwd: string): AgentsGuidanceResult => {
  const path = join(cwd, 'AGENTS.md');
  let section: string;
  try {
    section = readCommitloreAgentsSection();
  } catch (error) {
    return { state: 'write-failed', path, error: messageOf(error) };
  }

  if (!existsSync(path)) {
    try {
      writeFileSync(path, section);
      return { state: 'created', path, error: null };
    } catch (error) {
      return { state: 'write-failed', path, error: messageOf(error) };
    }
  }

  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    return { state: 'write-failed', path, error: messageOf(error) };
  }

  const begins = markerCount(contents, AGENTS_SECTION_BEGIN);
  const ends = markerCount(contents, AGENTS_SECTION_END);
  if (begins !== ends || begins > 1) {
    return {
      state: 'invalid',
      path,
      error: `expected zero or one complete ${AGENTS_SECTION_BEGIN} section, found ${begins} begin and ${ends} end marker(s)`,
    };
  }

  let next: string;
  let state: AgentsGuidanceResult['state'];
  if (begins === 0) {
    next = `${contents}${contents.endsWith('\n') ? '\n' : '\n\n'}${section}`;
    state = 'added';
  } else {
    const start = contents.indexOf(AGENTS_SECTION_BEGIN);
    const end = contents.indexOf(AGENTS_SECTION_END) + AGENTS_SECTION_END.length;
    next = `${contents.slice(0, start)}${section.trimEnd()}${contents.slice(end)}`;
    state = 'updated';
  }

  if (next === contents) return { state: 'unchanged', path, error: null };
  try {
    replaceFile(path, next);
    return { state, path, error: null };
  } catch (error) {
    return { state: 'write-failed', path, error: messageOf(error) };
  }
};
