/**
 * #416: the notes mirror was written locally and never published. `doctor
 * --fix` writes the fetch refspec, so a clone *receives* the mirror on any
 * `git fetch`; nothing ever sent one. `PRD-F3` asks for a confirmed round trip
 * between teammates, and the round trip had no second half.
 *
 * The tests below are a real round trip: two clones of a local bare "remote",
 * a record written in one, and an assertion that the other can read it after
 * doing nothing but `git fetch`. Nothing here touches a network.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { NOTES_REF, NOTES_REFSPEC, forcesNotes, readRecord, writeRecord } from '../src/core/notes.js';
import { syncNotes } from '../src/core/sync.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const temp = (label: string): string => {
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

const clone = (source: string, label: string): string => {
  const dir = temp(label);
  git(dir, ['clone', '--quiet', source, '.']);
  git(dir, ['config', 'user.email', `${label}@example.invalid`]);
  git(dir, ['config', 'user.name', label]);
  // What `doctor --fix` writes, taken from the constant rather than retyped.
  // Hardcoding it here is how the first version of this file reproduced #417 by
  // accident: the literal carried a `+` the shipped refspec no longer has.
  git(dir, ['config', '--add', 'remote.origin.fetch', NOTES_REFSPEC]);
  return dir;
};

/** A bare "remote" with one commit, plus two clones of it. */
const team = (label: string): { origin: string; alice: string; bob: string } => {
  const origin = createTestRepo({ path: temp(`${label}-origin`), bare: true });
  const seed = createTestRepo({ path: temp(`${label}-seed`) });
  git(seed, ['config', 'user.email', 'seed@example.invalid']);
  git(seed, ['config', 'user.name', 'seed']);
  writeFileSync(join(seed, 'src.ts'), 'export const a = 1;\n');
  git(seed, ['add', '-A']);
  git(seed, ['commit', '--quiet', '-m', 'init']);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  return { origin, alice: clone(origin, `${label}-alice`), bob: clone(origin, `${label}-bob`) };
};

const record = (text: string): { key: string; value: string }[] => [
  { key: 'Warn', value: text },
  { key: 'Provenance', value: 'authored' },
];

describe('#416 the notes mirror completes a round trip between two clones', () => {
  it('a record written in one clone is readable in the other', () => {
    const { alice, bob } = team('roundtrip');
    const sha = git(alice, ['rev-parse', 'HEAD']).trim();

    writeRecord(sha, record('do not widen the retry window past 30s'), { cwd: alice });

    // The control: before publishing, the teammate has nothing. This is the
    // state the issue reports — a record that exists on one machine only.
    git(bob, ['fetch', '--quiet', 'origin']);
    expect(readRecord(sha, { cwd: bob })).toEqual([]);

    const results = syncNotes({ cwd: alice });
    expect(results.map((r) => r.outcome)).toEqual(['pushed']);

    git(bob, ['fetch', '--quiet', 'origin']);
    const read = readRecord(sha, { cwd: bob });
    expect(read.map((t) => t.value)).toContain('do not widen the retry window past 30s');
  });

  it('a second sync with nothing new reports in-sync and transfers nothing', () => {
    const { alice } = team('idempotent');
    const sha = git(alice, ['rev-parse', 'HEAD']).trim();
    writeRecord(sha, record('one'), { cwd: alice });

    expect(syncNotes({ cwd: alice }).map((r) => r.outcome)).toEqual(['pushed']);
    expect(syncNotes({ cwd: alice }).map((r) => r.outcome)).toEqual(['in-sync']);
  });

  it('collects a mirror this clone does not have', () => {
    const { alice, bob } = team('collect');
    const sha = git(alice, ['rev-parse', 'HEAD']).trim();
    writeRecord(sha, record('from alice'), { cwd: alice });
    syncNotes({ cwd: alice });

    expect(syncNotes({ cwd: bob }).map((r) => r.outcome)).toEqual(['fetched']);
    expect(readRecord(sha, { cwd: bob }).map((t) => t.value)).toContain('from alice');
  });

  /**
   * The case that would lose a record if a fetch overwrote the working ref.
   * Both sides annotate different commits, so neither is an ancestor of the
   * other and the union is the only merge that keeps both.
   */
  it('keeps both sides when each clone wrote a different record', () => {
    const { alice, bob } = team('union');
    const first = git(alice, ['rev-parse', 'HEAD']).trim();

    writeFileSync(join(alice, 'src.ts'), 'export const a = 2;\n');
    git(alice, ['add', '-A']);
    git(alice, ['commit', '--quiet', '-m', 'second']);
    const second = git(alice, ['rev-parse', 'HEAD']).trim();
    git(alice, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    git(bob, ['fetch', '--quiet', 'origin']);

    writeRecord(first, record('from alice'), { cwd: alice });
    writeRecord(second, record('from bob'), { cwd: bob });

    expect(syncNotes({ cwd: alice }).map((r) => r.outcome)).toEqual(['pushed']);
    // Bob has a record alice never saw, and alice has published one bob never
    // saw. Neither side may win outright.
    expect(syncNotes({ cwd: bob }).map((r) => r.outcome)).toEqual(['merged']);

    expect(readRecord(first, { cwd: bob }).map((t) => t.value)).toContain('from alice');
    expect(readRecord(second, { cwd: bob }).map((t) => t.value)).toContain('from bob');

    // A plain fetch fast-forwards alice onto the merge, because the merge has
    // her side as a parent. The sync that follows has nothing left to do, which
    // is the shipped refspec doing the collecting on its own.
    git(alice, ['fetch', '--quiet', 'origin']);
    expect(syncNotes({ cwd: alice }).map((r) => r.outcome)).toEqual(['in-sync']);
    expect(readRecord(second, { cwd: alice }).map((t) => t.value)).toContain('from bob');
  });

  it('a repository with no remote reports nothing rather than failing', () => {
    const dir = createTestRepo({ path: temp('noremote') });
    git(dir, ['config', 'user.email', 'a@example.invalid']);
    git(dir, ['config', 'user.name', 'a']);
    writeFileSync(join(dir, 'src.ts'), 'x\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '--quiet', '-m', 'init']);
    expect(syncNotes({ cwd: dir })).toEqual([]);
  });

  it('a remote with no mirror yet is not an error', () => {
    const { bob } = team('emptyremote');
    expect(syncNotes({ cwd: bob }).map((r) => r.outcome)).toEqual(['nothing-to-do']);
  });

  it('--dry-run changes nothing on either side', () => {
    const { alice, bob } = team('dryrun');
    const sha = git(alice, ['rev-parse', 'HEAD']).trim();
    writeRecord(sha, record('unpublished'), { cwd: alice });

    expect(syncNotes({ cwd: alice, dryRun: true }).map((r) => r.outcome)).toEqual(['pushed']);

    git(bob, ['fetch', '--quiet', 'origin']);
    expect(readRecord(sha, { cwd: bob })).toEqual([]);
  });

  it('--fetch-only collects without publishing', () => {
    const { alice, bob } = team('fetchonly');
    const sha = git(alice, ['rev-parse', 'HEAD']).trim();
    writeRecord(sha, record('kept local'), { cwd: alice });

    expect(syncNotes({ cwd: alice, fetchOnly: true }).map((r) => r.outcome)).toEqual(['in-sync']);
    git(bob, ['fetch', '--quiet', 'origin']);
    expect(readRecord(sha, { cwd: bob })).toEqual([]);
  });

  /**
   * A fetch that landed on the working ref would discard local notes that had
   * not been published yet — silently, and before anything could merge them.
   * `syncRemote` fetches to a scratch ref for exactly this reason, and this
   * pins it.
   */
  it('collecting never discards an unpublished local record', () => {
    const { alice, bob } = team('nolose');
    const sha = git(alice, ['rev-parse', 'HEAD']).trim();

    writeFileSync(join(alice, 'other.ts'), 'x\n');
    git(alice, ['add', '-A']);
    git(alice, ['commit', '--quiet', '-m', 'second']);
    const second = git(alice, ['rev-parse', 'HEAD']).trim();
    git(alice, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    git(bob, ['fetch', '--quiet', 'origin']);

    // Bob publishes first, so the remote is ahead of alice's mirror.
    writeRecord(sha, record('from bob'), { cwd: bob });
    syncNotes({ cwd: bob });

    // Alice has an unpublished record of her own on a different commit. The two
    // mirrors have now diverged, so the shipped refspec refuses rather than
    // overwriting — `git fetch` exits non-zero here and that is the fix, not a
    // fault. `execGit` directly rather than the throwing helper, because the
    // rejection is the expected outcome.
    writeRecord(second, record('alice unpublished'), { cwd: alice });
    const fetched = execGit(['fetch', 'origin'], { cwd: alice });
    expect(fetched.code, 'a diverged notes fetch must be refused, not forced').not.toBe(0);
    expect(fetched.stderr).toMatch(/rejected/);

    syncNotes({ cwd: alice });
    expect(readRecord(second, { cwd: alice }).map((t) => t.value)).toContain('alice unpublished');
    expect(readRecord(sha, { cwd: alice }).map((t) => t.value)).toContain('from bob');
  });

  /**
   * #417, pinned at the constant. The shipped refspec carried a leading `+`,
   * which made every `git fetch` overwrite the local mirror with the remote's
   * — destroying a record written here and not yet pushed, silently and with
   * exit 0. The first version of the helper above retyped that literal instead
   * of importing it, and reproduced the bug by accident.
   */
  it('the shipped fetch refspec cannot overwrite the local mirror', () => {
    expect(forcesNotes(NOTES_REFSPEC)).toBe(false);
    // The predicate is not vacuous: it recognises what used to ship.
    expect(forcesNotes('+refs/notes/*:refs/notes/*')).toBe(true);
    expect(forcesNotes('+refs/notes/commitlore:refs/notes/commitlore')).toBe(true);
    // And does not fire on an unrelated forced refspec.
    expect(forcesNotes('+refs/heads/*:refs/remotes/origin/*')).toBe(false);
  });

  it('leaves the working notes ref intact when it refuses', () => {
    // A remote that cannot be reached at all: nothing is written either way.
    const { alice } = team('unreachable');
    const sha = git(alice, ['rev-parse', 'HEAD']).trim();
    writeRecord(sha, record('local only'), { cwd: alice });
    const before = git(alice, ['rev-parse', NOTES_REF]).trim();

    git(alice, ['remote', 'set-url', 'origin', join(temp('gone'), 'nowhere.git')]);
    const results = syncNotes({ cwd: alice });
    expect(results.map((r) => r.outcome)).toEqual(['failed']);
    expect(git(alice, ['rev-parse', NOTES_REF]).trim()).toBe(before);
    expect(readRecord(sha, { cwd: alice }).map((t) => t.value)).toContain('local only');
  });
});
