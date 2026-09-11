/**
 * #311: a pending capture transaction was the one thing in the system you could
 * not review. `.git/commitlore/pending/<nonce>.json` held the answer to "did my
 * capture record anything?", and reaching it meant pointing a JSON parser at
 * another tool's `.git` subdirectory -- which is what a CLI exists to prevent, and
 * which breaks silently on any field rename.
 *
 * Two derived facts carry most of the value and neither is in the file:
 *  - `stale`: `base_head` no longer matches HEAD, so the transaction will not
 *    apply to the commit being written. Today that is a silent no-op.
 *  - `gc_eligible`: whether `capture gc` would ever remove this file. #367 made
 *    that a question about the phase alone; before it, a `verified` transaction
 *    with `expires_at: null` was never collected at all.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runPendingList, runPendingRemove, runPendingShow } from '../src/commands/pending.js';
import { prepareCaptureContext } from '../src/core/capture-prepare.js';
import { consumePending } from '../src/core/pending.js';
import { PACKAGE_ROOT } from '../src/core/paths.js';

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

/** A repository with one prepared capture transaction. */
const repoWithTransaction = (): { cwd: string; nonce: string } => {
  const cwd = mkdtempSync(join(tmpdir(), 'commitlore-311-'));
  scratch.push(cwd);
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', ...args], { cwd });
  };
  execFileSync('git', ['init', '--quiet'], { cwd });
  writeFileSync(join(cwd, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '--quiet', '-m', 'seed');
  writeFileSync(join(cwd, 'a.txt'), 'a\nb\n');
  git('add', 'a.txt');
  const prepared = prepareCaptureContext({ cwd, transcript: 'we chose X because Y\n' });
  return { cwd, nonce: prepared.nonce };
};

/** The on-disk file for a nonce, without going through the store. */
const pendingFile = (cwd: string, nonce: string): string => {
  const relative = execFileSync('git', ['rev-parse', '--git-path', 'commitlore/pending'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  return join(cwd, relative, `${nonce}.json`);
};

describe('#311 pending transactions are reviewable with the CLI', () => {
  it('lists a prepared transaction with its phase, record count and base', () => {
    const { cwd, nonce } = repoWithTransaction();
    const listed = runPendingList({ cwd });
    expect(listed.transactions).toHaveLength(1);
    const [only] = listed.transactions;
    expect(only?.nonce).toBe(nonce);
    expect(only?.phase).toBe('prepared');
    expect(only?.records).toBe(0);
    expect(only?.base_head).toMatch(/^[0-9a-f]{40}$/);
    expect(only?.stale).toBe(false);
  });

  it('reports an empty list rather than failing when nothing is pending', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'commitlore-311-empty-'));
    scratch.push(cwd);
    execFileSync('git', ['init', '--quiet'], { cwd });
    execFileSync('git', ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', 'commit', '--quiet', '--allow-empty', '-m', 'seed'], { cwd });
    expect(runPendingList({ cwd }).transactions).toEqual([]);
  });

  it('reports an unreadable pending directory as unknown, not empty', () => {
    const { cwd } = repoWithTransaction();
    const pendingDir = join(cwd, '.git', 'commitlore', 'pending');
    chmodSync(pendingDir, 0o000);
    try {
      const result = runPendingList({ cwd });
      expect(result).toMatchObject({
        state: 'unreadable',
        transactions: [],
        unreadable: [],
      });
      expect(result.error).toBe('EACCES');
      expect(runPendingShow({ cwd, nonce: 'a' }).error).toMatch(/pending state could not be read/i);
    } finally {
      chmodSync(pendingDir, 0o700);
    }
  });

  it('marks a transaction stale once HEAD has moved past its base', () => {
    const { cwd } = repoWithTransaction();
    execFileSync('git', ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', 'commit', '--quiet', '-m', 'second'], { cwd });
    const [only] = runPendingList({ cwd }).transactions;
    expect(only?.stale).toBe(true);
  });

  it('does not mark a consumed transaction stale — HEAD moved because it landed (#584)', () => {
    // A consumed transaction's base_head is behind HEAD by construction: the
    // commit named in `consumed_by` is what moved HEAD past it. Comparing the
    // two without asking the phase made every completed capture report itself
    // as one that never reached a commit, here and in doctor, which reads this
    // same listing.
    const { cwd, nonce } = repoWithTransaction();
    const relative = execFileSync('git', ['rev-parse', '--git-path', 'commitlore/pending'], {
      cwd,
      encoding: 'utf8',
    }).trim();
    const path = join(cwd, relative, `${nonce}.json`);
    // `consumePending` only accepts `applied` — where prepare-commit-msg leaves
    // a transaction whose record is already in the message being written.
    const record: Record<string, unknown> = JSON.parse(readFileSync(path, 'utf8'));
    record['phase'] = 'applied';
    writeFileSync(path, JSON.stringify(record, null, 2));

    execFileSync(
      'git',
      ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', 'commit', '--quiet', '-m', 'carries the record'],
      { cwd },
    );
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    expect(consumePending(nonce, head, { cwd })).toBe(true);

    const [listed] = runPendingList({ cwd }).transactions;
    expect(listed?.phase).toBe('consumed');
    expect(listed?.stale).toBe(false);
    // `show` derives the same fact from its own call: one rule, both sites.
    expect(runPendingShow({ cwd, nonce }).transaction?.stale).toBe(false);
  });

  it('shows one transaction by a nonce prefix', () => {
    const { cwd, nonce } = repoWithTransaction();
    const shown = runPendingShow({ cwd, nonce: nonce.slice(0, 8) });
    expect(shown.transaction?.nonce).toBe(nonce);
    expect(shown.transaction?.source_hashes).toBeDefined();
  });

  it('says a nonce matched nothing instead of throwing', () => {
    const { cwd } = repoWithTransaction();
    const shown = runPendingShow({ cwd, nonce: 'ffffffff' });
    expect(shown.transaction).toBeNull();
    expect(shown.error).toMatch(/no pending transaction/i);
  });

  it('refuses an ambiguous prefix by naming the candidates', () => {
    const { cwd } = repoWithTransaction();
    // A second transaction whose nonce shares no prefix would not collide, so the
    // ambiguity is provoked with the shortest possible prefix instead.
    prepareCaptureContext({ cwd, transcript: 'a second session\n' });
    const shown = runPendingShow({ cwd, nonce: '' });
    expect(shown.transaction).toBeNull();
    expect(shown.error).toMatch(/ambiguous|matched 2/i);
  });

  it('reports a transaction with no expiry as collectable anyway (#367)', () => {
    const { cwd } = repoWithTransaction();
    const [only] = runPendingList({ cwd }).transactions;
    expect(only?.expires_at).toBeNull();
    expect(only?.gc_eligible).toBe(true);
  });
});

/**
 * #367: gc collects an abandoned transaction a day after HEAD leaves it behind.
 * `rm` is for the user who wants the file gone before then — the affordance the
 * command was missing entirely, since `ls` and `show` could name a leaked file
 * and nothing could remove it.
 */
describe('#367 pending rm', () => {
  const setPhase = (cwd: string, nonce: string, phase: string): void => {
    const path = pendingFile(cwd, nonce);
    const record: Record<string, unknown> = JSON.parse(readFileSync(path, 'utf8'));
    record['phase'] = phase;
    writeFileSync(path, JSON.stringify(record, null, 2));
  };

  it('removes a prepared transaction named by a nonce prefix', () => {
    const { cwd, nonce } = repoWithTransaction();
    const result = runPendingRemove({ cwd, nonce: nonce.slice(0, 8) });
    expect(result.removed).toBe(nonce);
    expect(result.phase).toBe('prepared');
    expect(result.error).toBeNull();
    expect(existsSync(pendingFile(cwd, nonce))).toBe(false);
    expect(runPendingList({ cwd }).transactions).toEqual([]);
  });

  it('removes a verified transaction — the ordinary skipped capture', () => {
    const { cwd, nonce } = repoWithTransaction();
    setPhase(cwd, nonce, 'verified');
    expect(runPendingRemove({ cwd, nonce }).removed).toBe(nonce);
    expect(existsSync(pendingFile(cwd, nonce))).toBe(false);
  });

  it.each(['staged', 'applied'])('refuses to remove a %s transaction, and says why', (phase) => {
    const { cwd, nonce } = repoWithTransaction();
    setPhase(cwd, nonce, phase);
    const result = runPendingRemove({ cwd, nonce });
    expect(result.removed).toBeNull();
    expect(result.phase).toBe(phase);
    expect(result.error).toContain(phase);
    expect(result.error).toMatch(/post-commit/i);
    expect(existsSync(pendingFile(cwd, nonce))).toBe(true);
  });

  it('refuses a file it cannot read, rather than guessing at its phase', () => {
    const { cwd, nonce } = repoWithTransaction();
    writeFileSync(pendingFile(cwd, nonce), 'not valid json {{{');
    const result = runPendingRemove({ cwd, nonce });
    expect(result.removed).toBeNull();
    expect(result.error).toMatch(/phase is unknown/i);
    expect(existsSync(pendingFile(cwd, nonce))).toBe(true);
  });

  it('says a nonce matched nothing instead of throwing', () => {
    const { cwd } = repoWithTransaction();
    const result = runPendingRemove({ cwd, nonce: 'ffffffff' });
    expect(result.removed).toBeNull();
    expect(result.error).toMatch(/no pending transaction/i);
  });

  it('refuses an ambiguous prefix by naming the candidates', () => {
    const { cwd } = repoWithTransaction();
    prepareCaptureContext({ cwd, transcript: 'a second session\n' });
    const result = runPendingRemove({ cwd, nonce: '' });
    expect(result.removed).toBeNull();
    expect(result.error).toMatch(/ambiguous|matched 2/i);
    expect(runPendingList({ cwd }).transactions).toHaveLength(2);
  });
});

/**
 * #920 reported `pending show` emitting a trailing comma after
 * `guard_advisory.gaps`, which no strict parser accepts. The reporter's situation
 * is the one that makes it expensive: `pending show` is the only way to read a
 * capture that never reached a commit, so a caller that checks `JSON.parse` and
 * gives up concludes the transaction is corrupt while the records sit intact.
 *
 * The serializer is `JSON.stringify` at every exit, and no shape produced here
 * reproduces it -- so these cases pin the property rather than a fix, across the
 * phases the advisory block is populated for. They spawn the built CLI on purpose:
 * `runPendingShow` returns an object, and the defect reported is in the bytes.
 */
describe('#920 pending show emits strictly parseable JSON', () => {
  const CLI = join(PACKAGE_ROOT, 'dist', 'commitlore.mjs');

  const show = (cwd: string, args: string[]): string => {
    const result = spawnSync(process.execPath, [CLI, 'pending', 'show', ...args], {
      cwd,
      encoding: 'utf8',
    });
    // stderr carries the cold-path index notice; only stdout is the document.
    return result.stdout;
  };

  it.each(['prepared', 'verified', 'staged', 'applied', 'consumed'])(
    'parses in phase %s, in both output modes',
    (phase) => {
      const { cwd, nonce } = repoWithTransaction();
      const file = pendingFile(cwd, nonce);
      const record = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      record['phase'] = phase;
      writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

      const human = show(cwd, [nonce]);
      const structured = show(cwd, [nonce, '--json']);

      expect(human).not.toBe('');
      expect(() => JSON.parse(human)).not.toThrow();
      expect(() => JSON.parse(structured)).not.toThrow();
      // The block #920 names must be present, or this case pins nothing.
      expect(JSON.parse(human)).toHaveProperty('guard_advisory.gaps');
    },
  );

  it('parses when the transaction carries records and trailers', () => {
    const { cwd, nonce } = repoWithTransaction();
    const file = pendingFile(cwd, nonce);
    const record = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    record['records'] = [
      {
        subject: 'fix: a thing',
        trailers: [
          { key: 'Record-Id', value: 'r-abc123' },
          // A value carrying the punctuation a hand-rolled serializer would trip on.
          { key: 'Ruled-out', value: 'the other way | it emits "gaps": [], and then a comma' },
        ],
      },
    ];
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

    const out = show(cwd, [nonce]);
    const parsed = JSON.parse(out) as { records: { trailers: unknown[] }[] };
    expect(parsed.records[0]?.trailers).toHaveLength(2);
  });
});
