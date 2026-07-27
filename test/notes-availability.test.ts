/**
 * Telling "there are no records" apart from "you have not fetched them".
 *
 * `git fetch` does not fetch notes. A plain clone of a repository full of
 * records therefore answers "no active records" — byte-identical to the answer
 * from a repository where nobody ever wrote one. An agent reads that as
 * "nothing was ruled out and nothing is off limits", which is the most
 * dangerous sentence this tool can produce, and it produced it silently.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { notesAvailability, coversNotes, NOTES_REF, writeRecord } from '../src/core/notes.js';
import { runQuery } from '../src/core/query.js';
import { createTestRepo } from './git-fixtures.js';

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-notes-'));
  temporaries.push(dir);
  createTestRepo({ path: dir });
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'seed']);
  return dir;
};

/** An origin holding one record in its notes mirror, and nothing in its messages. */
const originWithRecords = (): string => {
  const dir = makeRepo();
  writeRecord(
    git(dir, ['rev-parse', 'HEAD']).trim(),
    [
      { key: 'Limit', value: 'the vendor SSO ships no refresh token' },
      { key: 'Provenance', value: 'authored' },
      { key: 'Record-Id', value: 'r-note01' },
    ],
    { cwd: dir },
  );
  return dir;
};

const clone = (origin: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-clone-'));
  temporaries.push(dir);
  rmSync(dir, { recursive: true, force: true });
  return createTestRepo({ path: dir, source: origin });
};

describe('notesAvailability', () => {
  it('reports present when the mirror ref exists here', () => {
    expect(notesAvailability({ cwd: originWithRecords() })).toBe('present');
  });

  it('reports absent for a repository with no mirror and no remote', () => {
    // Nowhere for unseen records to be, so an empty answer is a true empty.
    expect(notesAvailability({ cwd: makeRepo() })).toBe('absent');
  });

  it('reports unfetched for a plain clone of a repository that has records', () => {
    expect(notesAvailability({ cwd: clone(originWithRecords()) })).toBe('unfetched');
  });

  it('reports absent once the refspec covers the mirror, even before fetching', () => {
    // The distinction is "could this repository have missed records", not
    // "does it have them": a configured clone that fetched nothing found nothing.
    const dir = clone(makeRepo());
    git(dir, ['config', '--add', 'remote.origin.fetch', `+${NOTES_REF}:${NOTES_REF}`]);
    expect(notesAvailability({ cwd: dir })).toBe('absent');
  });

  it('reports present after the refspec is added and the notes are fetched', () => {
    const dir = clone(originWithRecords());
    git(dir, ['config', '--add', 'remote.origin.fetch', `+${NOTES_REF}:${NOTES_REF}`]);
    git(dir, ['fetch', '-q', 'origin']);
    expect(notesAvailability({ cwd: dir })).toBe('present');
  });
});

describe('coversNotes', () => {
  it('accepts the exact refspec', () => {
    expect(coversNotes(`+${NOTES_REF}:${NOTES_REF}`)).toBe(true);
  });

  it('accepts a wildcard that already contains the mirror', () => {
    expect(coversNotes('+refs/notes/*:refs/notes/*')).toBe(true);
    expect(coversNotes('+refs/*:refs/*')).toBe(true);
  });

  it('rejects a refspec that lands somewhere else', () => {
    expect(coversNotes('+refs/heads/*:refs/remotes/origin/*')).toBe(false);
    expect(coversNotes('+refs/notes/other:refs/notes/other')).toBe(false);
  });
});

describe('an unfetched mirror does not read as an empty repository', () => {
  it('is the same records and the same empty count, and a different state', () => {
    const unfetched = runQuery({ cwd: clone(originWithRecords()), noIndex: true });
    const trulyEmpty = runQuery({ cwd: makeRepo(), noIndex: true });

    expect(unfetched.records).toEqual([]);
    expect(trulyEmpty.records).toEqual([]);
    // Identical answers on every axis a consumer had before this field existed.
    expect(unfetched.notes).toBe('unfetched');
    expect(trulyEmpty.notes).toBe('absent');
  });

  it('says so in the diagnostics, naming the fix', () => {
    const result = runQuery({ cwd: clone(originWithRecords()), noIndex: true });
    const said = result.diagnostics.join(' ');
    expect(said).toContain('has not been fetched');
    expect(said).toContain('commitlore doctor --fix');
  });

  it('stays quiet when there is nothing to warn about', () => {
    expect(runQuery({ cwd: makeRepo(), noIndex: true }).diagnostics).toEqual([]);
    expect(runQuery({ cwd: originWithRecords(), noIndex: true }).diagnostics).toEqual([]);
  });

  it('finds the records once they are fetched, and stops warning', () => {
    const dir = clone(originWithRecords());
    git(dir, ['config', '--add', 'remote.origin.fetch', `+${NOTES_REF}:${NOTES_REF}`]);
    git(dir, ['fetch', '-q', 'origin']);

    const result = runQuery({ cwd: dir, noIndex: true });
    expect(result.notes).toBe('present');
    expect(result.diagnostics).toEqual([]);
    expect(result.records.map((record) => record.recordId)).toEqual(['r-note01']);
  });
});
