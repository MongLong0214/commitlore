/**
 * T-1602 (#742): ask git, once a day, and never fail because of it.
 *
 * Every test here runs against a real local repository rather than the
 * network, which `COMMITLORE_INSTALL_SOURCE` makes possible and which is why
 * the ticket asks for that switch to be honoured first.
 *
 * The six failure paths are six tests, not one. They are six different code
 * paths and a single shared `catch` would hide which one ran -- and the whole
 * point of separating `unreachable` from `refused` is that they buy different
 * amounts of silence.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cachePath,
  fetchTags,
  latestRelease,
  sourceUrl,
  ttlFor,
  type CheckOutcome,
} from '../src/core/latest-release.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `cl-latest-${label}-`));

/** A real remote, with real tags, that costs nothing and reaches no network. */
const remoteWithTags = (tags: readonly string[]): string => {
  const dir = join(scratch('remote'), 'origin');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', dir]);
  const work = join(scratch('work'), 'work');
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', work]);
  execFileSync('git', ['-C', work, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', work, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', work, 'commit', '--allow-empty', '--quiet', '-m', 'root']);
  for (const tag of tags) execFileSync('git', ['-C', work, 'tag', tag]);
  execFileSync('git', ['-C', work, 'remote', 'add', 'origin', dir]);
  execFileSync('git', ['-C', work, 'push', '--quiet', '--tags', 'origin', 'main']);
  return dir;
};

describe('T-1602 resolving the newest release', () => {
  it('honours COMMITLORE_INSTALL_SOURCE, which is what lets every other test avoid the network', () => {
    expect(sourceUrl({ COMMITLORE_INSTALL_SOURCE: '/somewhere/else.git' })).toBe('/somewhere/else.git');
    expect(sourceUrl({})).toContain('commitlore');
  });

  it('picks the newest release tag from a real remote', async () => {
    const url = remoteWithTags(['v1.1.9', 'v1.1.10', 'v1.2.0-rc.1', 'nightly']);
    const outcome = await fetchTags(url);
    expect(outcome).toEqual({ kind: 'resolved', tag: 'v1.1.10' });
  });

  it('says no-tag-matched when the remote answers with nothing that is a release', async () => {
    const url = remoteWithTags(['nightly', 'v1.2', 'v1.2.0-rc.1']);
    const outcome = await fetchTags(url);
    expect(outcome.kind).toBe('no-tag-matched');
  });

  it('says refused when the remote answers and declines', async () => {
    const outcome = await fetchTags(join(scratch('missing'), 'not-a-repository.git'));
    expect(outcome.kind).toBe('refused');
  });

  // Not "either is fine". An unreachable remote waits an hour and a refusal
  // waits a day, so calling a DNS failure a refusal buys a day of silence
  // about the staleness this feature exists to expose. `git` exits non-zero
  // for both and says which in its stderr.
  it('calls a name that does not resolve unreachable, not refused', async () => {
    const outcome = await fetchTags('https://commitlore.invalid/x.git', { timeoutMs: 8_000 });
    expect(outcome.kind).toBe('unreachable');
  });

  it('calls a remote that answered and declined refused, not unreachable', async () => {
    const outcome = await fetchTags(join(scratch('declined'), 'not-a-repository.git'));
    expect(outcome.kind).toBe('refused');
  });

  it('never throws, whatever it is handed', async () => {
    for (const url of ['', '::::', 'file:///dev/null']) {
      await expect(fetchTags(url, { timeoutMs: 4_000 })).resolves.toBeTruthy();
    }
  });
});

describe('T-1602 the switches that express a decision', () => {
  it.each(['COMMITLORE_NO_UPDATE_CHECK', 'DO_NOT_TRACK', 'NO_UPDATE_NOTIFIER'])(
    '%s stops the check entirely',
    async (name) => {
      const result = await latestRelease({ env: { [name]: '1' }, home: scratch('off') });
      expect(result.outcome).toEqual({ kind: 'disabled', by: name });
    },
  );

  // The two switches are not the same switch. Someone who declines automatic
  // action has not asked to stop being told.
  it('COMMITLORE_NO_AUTO_UPDATE does not stop the check', async () => {
    const url = remoteWithTags(['v2.0.0']);
    const result = await latestRelease({
      env: { COMMITLORE_NO_AUTO_UPDATE: '1', COMMITLORE_INSTALL_SOURCE: url },
      home: scratch('noauto'),
    });
    expect(result.outcome).toEqual({ kind: 'resolved', tag: 'v2.0.0' });
  });
});

describe('T-1602 the cache', () => {
  it('spawns once inside the interval and again after it', async () => {
    const url = remoteWithTags(['v3.0.0']);
    const home = scratch('interval');
    const env = { COMMITLORE_INSTALL_SOURCE: url };
    let clock = 1_000_000;

    const first = await latestRelease({ env, home, now: () => clock });
    expect(first.cached).toBe(false);

    const second = await latestRelease({ env, home, now: () => clock });
    expect(second.cached).toBe(true);

    clock += DAY + 1;
    const third = await latestRelease({ env, home, now: () => clock });
    expect(third.cached).toBe(false);
  });

  it.each([
    ['a truncated file', '{"version":1,"checked'],
    ['an empty file', ''],
    ['a future schema', '{"version":99,"checkedAt":1,"ttlMs":1,"outcome":{"kind":"resolved","tag":"v9.9.9"}}'],
    ['a JSON scalar', '"nope"'],
  ])('reads %s as absent rather than failing', async (_label, contents) => {
    const url = remoteWithTags(['v4.0.0']);
    const home = scratch('bad-cache');
    const path = cachePath(home);
    mkdirSync(join(home, '.cache', 'commitlore'), { recursive: true });
    writeFileSync(path, contents, 'utf8');

    const result = await latestRelease({ env: { COMMITLORE_INSTALL_SOURCE: url }, home });
    expect(result.outcome).toEqual({ kind: 'resolved', tag: 'v4.0.0' });
  });

  it('does not corrupt the cache when two checks run at once', async () => {
    const url = remoteWithTags(['v5.0.0']);
    const home = scratch('concurrent');
    const env = { COMMITLORE_INSTALL_SOURCE: url };
    const results = await Promise.all([
      latestRelease({ env, home, now: () => 1 }),
      latestRelease({ env, home, now: () => 1 }),
    ]);
    for (const r of results) expect(r.outcome).toEqual({ kind: 'resolved', tag: 'v5.0.0' });
    expect(JSON.parse(readFileSync(cachePath(home), 'utf8'))).toMatchObject({ version: 1 });
    expect(existsSync(`${cachePath(home)}.${String(process.pid)}.tmp`)).toBe(false);
  });
});

describe('T-1602 a failed check is cached by kind', () => {
  const entry = (outcome: CheckOutcome, ttlMs: number) => ({ version: 1, checkedAt: 0, outcome, ttlMs });

  it('backs off from an hour to a day for a remote it cannot reach', () => {
    const first = ttlFor({ kind: 'unreachable', detail: '' }, null);
    expect(first).toBe(HOUR);
    const second = ttlFor({ kind: 'unreachable', detail: '' }, entry({ kind: 'unreachable', detail: '' }, first));
    expect(second).toBe(2 * HOUR);
    const ceiling = ttlFor({ kind: 'unreachable', detail: '' }, entry({ kind: 'unreachable', detail: '' }, DAY));
    expect(ceiling).toBe(DAY);
  });

  it('waits the full day for a settled refusal', () => {
    expect(ttlFor({ kind: 'refused', detail: '' }, null)).toBe(DAY);
  });

  // A parse failure is a bug in this code, not weather. Burying it for a day
  // hides it, so it is retried within the hour.
  it('retries within the hour when nothing in the output was a tag', () => {
    expect(ttlFor({ kind: 'no-tag-matched', detail: '' }, null)).toBe(HOUR);
  });

  it('does not let a brief outage buy a day of silence', () => {
    expect(ttlFor({ kind: 'unreachable', detail: '' }, null)).toBeLessThan(DAY);
  });
});

describe('T-1602 cancellation', () => {
  // Driven by an injected timer rather than a real one: a property timed
  // against a real clock passes vacuously on a slow machine.
  //
  // The mock fires only the first timer it is handed -- the timeout -- and
  // ignores the grace timer that the kill path then schedules. A first draft
  // re-fired whatever it held on every `setTimer` call, so the timeout
  // callback scheduled a grace timer which re-entered the timeout callback,
  // and the suite spun until it was killed. A test double that calls back into
  // the thing it is doubling needs a stop.
  it('gives up on a remote that never answers, without waiting for a real timeout', async () => {
    const url = remoteWithTags(['v6.0.0']);
    let fired = false;
    const outcome = await fetchTags(url, {
      timeoutMs: 50,
      setTimer: (fn, ms) => {
        if (!fired && ms === 50) {
          fired = true;
          queueMicrotask(fn);
        }
        return { unref: () => undefined };
      },
      clearTimer: () => undefined,
    });
    expect(outcome.kind).toBe('unreachable');
    expect(outcome.kind === 'unreachable' && outcome.detail).toContain('50ms');
  });

  it('leaves no child behind after many checks', async () => {
    const url = remoteWithTags(['v7.0.0']);
    const before = execFileSync('sh', ['-c', 'ps -o stat= -p $$ >/dev/null; ps -A -o stat= | grep -c Z || true'], { encoding: 'utf8' }).trim();
    await Promise.all(Array.from({ length: 8 }, () => fetchTags(url)));
    const after = execFileSync('sh', ['-c', 'ps -A -o stat= | grep -c Z || true'], { encoding: 'utf8' }).trim();
    expect(Number(after)).toBeLessThanOrEqual(Number(before) + 1);
  });
});
