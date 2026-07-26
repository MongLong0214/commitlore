/**
 * T-301 acceptance criterion: a record written to the notes mirror in one
 * clone is readable in another, and the mirror stores the canonical block of
 * SPEC §2.3 rather than a format of its own.
 *
 * Every repository here is a throwaway under `os.tmpdir()`, including the
 * "remote", which is a local bare repo — nothing in these tests touches a
 * network or the repository the suite runs in.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runDoctor } from '../src/commands/doctor.js';
import { execGit } from '../src/core/git.js';
import { NOTES_REF, listRecordShas, readRecord, writeRecord } from '../src/core/notes.js';
import { serializeTrailers } from '../src/core/trailers.js';
import type { Trailer } from '../src/core/types.js';

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

const git = (cwd: string, args: string[]): string => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout;
};

const configure = (dir: string): string => {
  git(dir, ['config', 'user.email', 'test@commitlore.invalid']);
  git(dir, ['config', 'user.name', 'CommitLore Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
};

/** An empty `--template` keeps git's sample hooks out of `.git/hooks/`. */
const initRepo = (label: string): string => {
  const dir = tempDir(label);
  git(dir, ['init', '--quiet', `--template=${tempDir(`${label}-template`)}`, '--initial-branch=main']);
  return configure(dir);
};

const initBare = (label: string): string => {
  const dir = tempDir(label);
  git(dir, ['init', '--bare', '--quiet', '--initial-branch=main']);
  return dir;
};

const commit = (dir: string, subject: string): string => {
  git(dir, ['commit', '--quiet', '--allow-empty', '-m', subject]);
  return git(dir, ['rev-parse', 'HEAD']).trim();
};

const clone = (source: string, label: string): string => {
  const parent = tempDir(label);
  const dir = join(parent, 'clone');
  git(parent, ['clone', '--quiet', `--template=${tempDir(`${label}-template`)}`, source, dir]);
  return configure(dir);
};

const RECORD: Trailer[] = [
  { key: 'Limit', value: 'only 3 workers on the queue' },
  { key: 'Blast', value: 'local' },
  { key: 'Record-Id', value: 'r-a1b2c3' },
];

const CANONICAL = 'Limit: only 3 workers on the queue\nBlast: local\nRecord-Id: r-a1b2c3\n';

describe('notes mirror', () => {
  it('round-trips a record through the mirror', () => {
    const repo = initRepo('notes-roundtrip');
    const sha = commit(repo, 'change something');

    writeRecord(sha, RECORD, { cwd: repo });

    expect(readRecord(sha, { cwd: repo })).toEqual(RECORD);
  });

  it('stores the canonical block byte for byte, in vocabulary order', () => {
    const repo = initRepo('notes-canonical');
    const sha = commit(repo, 'change something');

    // Deliberately out of vocabulary order on the way in.
    writeRecord(sha, [RECORD[2] as Trailer, RECORD[1] as Trailer, RECORD[0] as Trailer], {
      cwd: repo,
    });

    const body = git(repo, ['notes', `--ref=${NOTES_REF}`, 'show', sha]);
    expect(body).toBe(CANONICAL);
    expect(body).toBe(serializeTrailers(RECORD));
    expect(serializeTrailers(readRecord(sha, { cwd: repo }))).toBe(CANONICAL);
  });

  it('returns [] for a commit that carries no note', () => {
    const repo = initRepo('notes-absent');
    const sha = commit(repo, 'recorded nothing');

    expect(readRecord(sha, { cwd: repo })).toEqual([]);
  });

  it('returns [] for a commit with no note even when other commits have one', () => {
    const repo = initRepo('notes-absent-mixed');
    const withNote = commit(repo, 'first');
    const withoutNote = commit(repo, 'second');
    writeRecord(withNote, RECORD, { cwd: repo });

    expect(readRecord(withoutNote, { cwd: repo })).toEqual([]);
    expect(readRecord(withNote, { cwd: repo })).toEqual(RECORD);
  });

  it('throws for an object that does not exist instead of reporting absence', () => {
    const repo = initRepo('notes-unknown-object');
    commit(repo, 'only commit');

    expect(() => readRecord('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', { cwd: repo })).toThrow();
    expect(() => readRecord('not-a-sha', { cwd: repo })).toThrow();
  });

  it('does not overwrite an existing note silently', () => {
    const repo = initRepo('notes-no-clobber');
    const sha = commit(repo, 'change something');
    writeRecord(sha, RECORD, { cwd: repo });

    const replacement: Trailer[] = [{ key: 'Limit', value: 'rewritten' }];
    expect(() => writeRecord(sha, replacement, { cwd: repo })).toThrow(/exists|existing/i);
    expect(readRecord(sha, { cwd: repo })).toEqual(RECORD);
  });

  it('overwrites an existing note when force is asked for', () => {
    const repo = initRepo('notes-force');
    const sha = commit(repo, 'change something');
    writeRecord(sha, RECORD, { cwd: repo });

    const replacement: Trailer[] = [{ key: 'Limit', value: 'rewritten' }];
    writeRecord(sha, replacement, { cwd: repo, force: true });

    expect(readRecord(sha, { cwd: repo })).toEqual(replacement);
  });

  it('refuses to write an empty record, which git would read as a deletion', () => {
    const repo = initRepo('notes-empty');
    const sha = commit(repo, 'change something');
    writeRecord(sha, RECORD, { cwd: repo });

    expect(() => writeRecord(sha, [], { cwd: repo, force: true })).toThrow(/empty/i);
    expect(readRecord(sha, { cwd: repo })).toEqual(RECORD);
  });

  it('lists the objects that carry a record, and nothing when the ref is absent', () => {
    const repo = initRepo('notes-list');
    const first = commit(repo, 'first');
    const second = commit(repo, 'second');

    expect(listRecordShas({ cwd: repo })).toEqual([]);

    writeRecord(first, RECORD, { cwd: repo });
    writeRecord(second, [{ key: 'Warn', value: 'read the migration note' }], { cwd: repo });

    expect(listRecordShas({ cwd: repo }).sort()).toEqual([first, second].sort());
  });

  it('survives a history rewrite that destroys the commit message', () => {
    const repo = initRepo('notes-rewrite');
    const sha = commit(repo, 'change something');
    writeRecord(sha, RECORD, { cwd: repo });

    // amend rewrites the commit; the note stays attached to the old object,
    // which is why the mirror is a second channel and not a cache.
    git(repo, ['commit', '--quiet', '--amend', '--allow-empty', '-m', 'rewritten subject']);
    expect(git(repo, ['rev-parse', 'HEAD']).trim()).not.toBe(sha);

    expect(readRecord(sha, { cwd: repo })).toEqual(RECORD);
  });

  it(
    'carries a record from one clone to another through a remote (T-301 AC)',
    () => {
      const remote = initBare('notes-remote');
      const cloneA = clone(remote, 'notes-clone-a');

      const sha = commit(cloneA, 'add the worker pool');
      writeRecord(sha, RECORD, { cwd: cloneA });
      git(cloneA, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
      git(cloneA, ['push', '--quiet', 'origin', NOTES_REF]);

      const cloneB = clone(remote, 'notes-clone-b');
      // A fresh clone does not fetch notes: the mirror is invisible until
      // doctor configures the refspec.
      expect(readRecord(sha, { cwd: cloneB })).toEqual([]);

      const report = runDoctor({ cwd: cloneB, fix: true });
      const refspec = report.checks.find((entry) => entry.id === 'notes-refspec');
      expect(refspec?.status).toBe('ok');
      expect(refspec?.fixed).toBe(true);

      git(cloneB, ['fetch', '--quiet', 'origin']);

      expect(readRecord(sha, { cwd: cloneB })).toEqual(RECORD);
      expect(listRecordShas({ cwd: cloneB })).toEqual([sha]);
      expect(serializeTrailers(readRecord(sha, { cwd: cloneB }))).toBe(CANONICAL);
    },
    30_000,
  );
});
