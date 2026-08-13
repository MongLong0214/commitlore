/**
 * #551: a fresh clone can see the commits but not the notes mirror, so a
 * notes-only record must be reported as unavailable rather than as empty.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { formatContext } from '../src/commands/query.js';
import { execGit } from '../src/core/git.js';
import { NOTES_REF, NOTES_REFSPEC, writeRecord } from '../src/core/notes.js';
import { runQuery } from '../src/core/query.js';
import type { Trailer } from '../src/core/types.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** `realpathSync` because macOS reports `/var` for a `/private/var` tmpdir. */
const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[], stdin?: string): string => {
  const result = execGit(args, {
    cwd,
    ...(stdin === undefined ? {} : { stdin }),
  });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout;
};

const initBare = (label: string): string => {
  const dir = tempDir(label);
  return createTestRepo({ path: dir, bare: true });
};

const clone = (source: string, label: string): string => {
  const parent = tempDir(label);
  return createTestRepo({ path: join(parent, 'clone'), source });
};

const RECORD_PATH = 'src/queue/worker.ts';

const NOTE_RECORD: Trailer[] = [
  { key: 'Limit', value: 'the queue worker owns retries' },
  { key: 'Record-Id', value: 'r-twoclone551' },
];

const COMMIT_RECORD: Trailer[] = [
  { key: 'Limit', value: 'the commit carries the queue constraint' },
  { key: 'Record-Id', value: 'r-twocmt551' },
];

const writeWorker = (cwd: string): void => {
  const path = join(cwd, RECORD_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'worker\n');
};

interface NotesFixture {
  readonly cloneB: string;
  readonly record: Trailer[];
}

const notesFixture = (label: string): NotesFixture => {
  const origin = initBare(`${label}-origin`);
  const cloneA = clone(origin, `${label}-a`);

  writeWorker(cloneA);
  git(cloneA, ['add', '--', RECORD_PATH]);
  git(cloneA, ['commit', '--quiet', '--message', 'add the queue worker']);
  const sha = git(cloneA, ['rev-parse', 'HEAD']).trim();

  writeRecord(sha, NOTE_RECORD, { cwd: cloneA });
  git(cloneA, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  git(cloneA, ['push', '--quiet', 'origin', NOTES_REF]);

  return { cloneB: clone(origin, `${label}-b`), record: NOTE_RECORD };
};

const messageFixture = (label: string): string => {
  const origin = initBare(`${label}-origin`);
  const cloneA = clone(origin, `${label}-a`);

  writeWorker(cloneA);
  git(cloneA, ['add', '--', RECORD_PATH]);
  git(
    cloneA,
    ['commit', '--quiet', '--file', '-'],
    `add the queue worker\n\nLimit: ${COMMIT_RECORD[0]?.value}\nRecord-Id: ${COMMIT_RECORD[1]?.value}\n`,
  );
  git(cloneA, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);

  return clone(origin, `${label}-b`);
};

const queryPath = (cwd: string) =>
  runQuery({ cwd, path: RECORD_PATH, noIndex: true });

const exactConfigPattern = (value: string): string =>
  `^${value.replace(/[\\.*+?[\]^$(){}|]/g, '\\$&')}$`;

describe('two-clone notes availability', () => {
  it('clone B without bootstrap refuses rather than answering empty', () => {
    const fixture = notesFixture('without-bootstrap');
    const result = queryPath(fixture.cloneB);
    const rendered = formatContext(result);

    expect(result.records).toEqual([]);
    expect(result.notes).toBe('unfetched');
    expect(rendered).toContain(
      'the notes mirror has not been fetched here, so this is not the same as "none exist"',
    );
  });

  it('clone B after the documented bootstrap receives the record', () => {
    const fixture = notesFixture('with-bootstrap');

    git(fixture.cloneB, ['config', '--add', 'remote.origin.fetch', NOTES_REFSPEC]);
    git(fixture.cloneB, ['fetch', '--quiet', 'origin']);

    const result = queryPath(fixture.cloneB);
    const [record] = result.records;

    expect(result.notes).toBe('present');
    expect(result.records).toHaveLength(1);
    expect(record).toMatchObject({
      source: 'notes',
      paths: [RECORD_PATH],
      trailers: fixture.record,
    });
  });

  it('removing the refspec returns clone B to refusal', () => {
    const fixture = notesFixture('remove-bootstrap');

    git(fixture.cloneB, ['config', '--add', 'remote.origin.fetch', NOTES_REFSPEC]);
    git(fixture.cloneB, ['fetch', '--quiet', 'origin']);
    git(fixture.cloneB, [
      'config',
      '--unset-all',
      'remote.origin.fetch',
      exactConfigPattern(NOTES_REFSPEC),
    ]);
    git(fixture.cloneB, ['update-ref', '-d', NOTES_REF]);

    const result = queryPath(fixture.cloneB);
    const rendered = formatContext(result);

    expect(result.records).toEqual([]);
    expect(result.notes).toBe('unfetched');
    expect(rendered).toContain(
      'the notes mirror has not been fetched here, so this is not the same as "none exist"',
    );
  });

  it('a record in the commit message alone needs no bootstrap', () => {
    const cloneB = messageFixture('message-only');
    const result = queryPath(cloneB);
    const [record] = result.records;

    expect(result.records).toHaveLength(1);
    expect(record).toMatchObject({
      source: 'commit',
      paths: [RECORD_PATH],
      trailers: COMMIT_RECORD,
    });
  });
});
